/**
 * Contract row builder — general, `dimension`-array driven.
 *
 * The response shape is derived entirely from the request `dimension` array
 * (each entry: { order, dimension, axis }). Sorting each axis by `order`:
 *   - Hierarchy x-dims (product / store) become DIRECT KEYS on every response
 *     row — they identify the row.
 *   - VALUE dims (measure / time / metric) form the nested value block, in
 *     x-order (outer) then y-order (inner), down to a numeric leaf.
 *   - The block's field name follows its OUTER dim: measure -> `measures`,
 *     metric -> `metrics`. Metric leaf keys are lowercase (sls_u, aur, …).
 *
 * Nothing is pre-aggregated: every leaf value is summed from the granular
 * facts on demand and ratio metrics are recomputed from summed components so
 * numbers are correct at any level.
 *
 * Row shape (value block attaches to the LAST x-dim):
 *   // last x = a value dim (e.g. measure) -> top-level block
 *   { grid_id, product, location, measures: { <measure>: { <week>: { <metric>: number } } } }
 *   // last x = a hierarchy (e.g. store) -> block nested INSIDE that block
 *   { grid_id, product, location: { …identity, measures: { <measure>: { <week>: { <metric>: number } } } } }
 *
 * Envelope: { message, status, rows }.
 */

import {
  getFacts,
  emptyComponents,
  addComponents,
  computeMetric,
} from "./deepDiveDb.js";

// Time level name -> fact field.
const TIME_FIELD = {
  quarter: "fiscal_year_quarter",
  month: "fiscal_year_month",
  week: "fiscal_year_week",
};

const isTotal = (v) =>
  v == null || v === "" || String(v).toLowerCase() === "total";

/** Ordered hierarchy attributes from a { l1: attr, l2: attr, ... } map. */
function orderedAttrs(map) {
  if (!map) return [];
  return Object.keys(map)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .map((k) => map[k]);
}

function applyFilterList(facts, list) {
  if (!list || !list.length) return facts;
  return facts.filter((f) =>
    list.every((flt) => {
      const v = f[flt.attribute_name];
      if (v === undefined) return true;
      return (flt.values || []).map(String).includes(String(v));
    }),
  );
}

function distinct(facts, field) {
  const s = new Set();
  facts.forEach((f) => s.add(f[field]));
  return Array.from(s).sort((a, b) =>
    String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
  );
}

/** has_children / next_level for a hierarchy level attribute. */
function levelInfo(attrs, level) {
  const idx = attrs.indexOf(level);
  const next = idx >= 0 && idx + 1 < attrs.length ? attrs[idx + 1] : null;
  return { has_children: !!next, next_level: next };
}

const numericSort = (a, b) => {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};

const distinctSorted = (facts, field) =>
  distinct(facts, field).sort(numericSort);

/** Split the `dimension` array into ordered x/y dimension-name lists. */
function splitDimensions(dimension) {
  const dims = Array.isArray(dimension) ? dimension : [];
  const byAxis = (ax) =>
    dims
      .filter((d) => d && d.axis === ax)
      .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
      .map((d) => String(d.dimension));
  return { xDims: byAxis("x"), yDims: byAxis("y") };
}

/** Normalise a dimension name to its response key + hierarchy config. */
function hierInfo(dimName, payload) {
  if (dimName === "product") {
    return {
      responseKey: "product",
      attrs: orderedAttrs(payload.product_hierarchy_levels),
      agg: isTotal(payload.product_hierarchy_aggregation)
        ? null
        : payload.product_hierarchy_aggregation,
    };
  }
  // "store" (contract) and "location" (app) share the location hierarchy.
  return {
    responseKey: "location",
    attrs: orderedAttrs(payload.location_hierarchy_levels),
    agg: isTotal(payload.location_hierarchy_aggregation)
      ? null
      : payload.location_hierarchy_aggregation,
  };
}

const isHierDim = (d) => d === "product" || d === "store" || d === "location";

// Row (grouping) dims enumerate response rows. Time joins product/store here
// when it is on the x-axis (in rows); it is NOT a value dim in that case.
const isRowDim = (d) => isHierDim(d) || d === "time";

/**
 * Enumerate the members of a hierarchy dimension over the given facts.
 * A "total" (undrilled) dimension yields a single { value: "Total" } node.
 */
function enumerateHier(info, facts) {
  const { responseKey, attrs, agg } = info;
  if (!agg) {
    return [
      {
        responseKey,
        block: {
          aggregation_level: null,
          value: "Total",
          has_children: attrs.length > 0,
          next_level: attrs[0] || null,
        },
        facts,
      },
    ];
  }
  const meta = levelInfo(attrs, agg);
  return distinctSorted(facts, agg).map((member) => ({
    responseKey,
    block: {
      aggregation_level: agg,
      attribute_name: agg,
      value: member,
      has_children: meta.has_children,
      next_level: meta.next_level,
    },
    facts: facts.filter((f) => String(f[agg]) === String(member)),
  }));
}

/**
 * Enumerate weeks as rows: one { time } block per fiscal_year_week. Time in rows
 * is a non-drillable grouping dim (week leaf), so has_children is false.
 */
function enumerateTime(facts) {
  return distinctSorted(facts, "fiscal_year_week").map((week) => ({
    responseKey: "time",
    block: {
      aggregation_level: "week",
      attribute_name: "fiscal_year_week",
      value: week,
      has_children: false,
      next_level: null,
    },
    facts: facts.filter((f) => String(f.fiscal_year_week) === String(week)),
  }));
}

/** Sum fact components then compute a single metric value (raw metric key). */
function metricValue(facts, metric) {
  const comp = emptyComponents();
  facts.forEach((f) => addComponents(comp, f));
  return computeMetric(metric, comp);
}

/** Value dims that pivot the cells (vs hierarchy dims that identify rows). */
const isValueDimName = (d) => d === "measure" || d === "time" || d === "metric";

/** Nest facts by the selected time levels, continuing into `cont` at the leaf. */
function nestTime(timeLevels, ti, facts, cont) {
  if (ti >= timeLevels.length) return cont(facts);
  const field = TIME_FIELD[String(timeLevels[ti]).toLowerCase()];
  if (!field) return nestTime(timeLevels, ti + 1, facts, cont);
  const out = {};
  distinctSorted(facts, field).forEach((val) => {
    const sub = facts.filter((f) => String(f[field]) === String(val));
    out[val] = nestTime(timeLevels, ti + 1, sub, cont);
  });
  return out;
}

/**
 * Build the value block by nesting the value dims IN ORDER (measure/time/metric),
 * carrying the fixed measure + metric down to a numeric leaf. Facts are narrowed
 * by measure and week as we descend so ratio metrics recompute correctly.
 */
function buildValueTree(dims, idx, facts, payload, ctx) {
  if (idx >= dims.length) {
    const metric = ctx.metric || (payload.metrics || [])[0] || "sls_u";
    return metricValue(facts, metric);
  }
  const dim = dims[idx];
  const next = (f, c) => buildValueTree(dims, idx + 1, f, payload, c);

  if (dim === "measure") {
    const out = {};
    (payload.measures || []).forEach((meas) => {
      out[meas] = next(
        facts.filter((f) => f.measure === meas),
        {
          ...ctx,
          measure: meas,
        },
      );
    });
    return out;
  }
  if (dim === "metric") {
    const out = {};
    (payload.metrics || []).forEach((mk) => {
      out[mk] = next(facts, { ...ctx, metric: mk });
    });
    return out;
  }
  if (dim === "time") {
    return nestTime(payload.time_order_selected || [], 0, facts, (f) =>
      next(f, ctx),
    );
  }
  // Unknown value dim: skip a level.
  return next(facts, ctx);
}

/** Deterministic, readable per-row id from its x-dim identity blocks. */
function makeGridId(accBlocks) {
  const parts = accBlocks.map(
    (m) => `${m.block.aggregation_level || "total"}=${m.block.value}`,
  );
  const next = accBlocks.map((m) => m.block.next_level || "-").join(",");
  return `${parts.join("|")}::${next}`;
}

/** Scope facts by filters + drill filters + week range + measures. */
function scopeFacts(payload, factsOverride) {
  let facts = factsOverride || getFacts();
  facts = applyFilterList(facts, payload.filters || []);
  facts = applyFilterList(facts, payload.grid_filters || []);
  const weeks = (
    payload.fiscal_ids?.length
      ? payload.fiscal_ids
      : (payload.time_period?.fiscal_mapping || []).map(
          (m) => m.fiscal_year_week,
        )
  ).map(Number);
  if (weeks.length) {
    const set = new Set(weeks);
    facts = facts.filter((f) => set.has(Number(f.fiscal_year_week)));
  }
  const measures = payload.measures || [];
  if (measures.length)
    facts = facts.filter((f) => measures.includes(f.measure));
  return facts;
}

/**
 * Build the row-array response for one drill level, driven by `dimension`.
 * @param payload the contract request
 * @param factsOverride pre-scoped facts (e.g. from SQL); filters re-applied.
 */
export function runContractRows(payload = {}, factsOverride = null) {
  let { xDims, yDims } = splitDimensions(payload.dimension);
  // Sensible defaults if no dimension array is supplied.
  if (!xDims.length) xDims = ["product", "location", "measure"];
  if (!yDims.length) yDims = ["time", "metric"];

  // Row (grouping) x-dims identify each row (product/store/time); value dims
  // (measure/metric on x, plus measure/metric/time on y) form the nested value
  // block. Time on x is a row dim, NOT a value dim. The outer value dim sets the
  // block field name.
  const rowKeyDims = xDims.filter(isRowDim);
  const valueDims = [
    ...xDims.filter((d) => d === "measure" || d === "metric"),
    ...yDims.filter(isValueDimName),
  ];
  const fieldName = valueDims[0] === "metric" ? "metrics" : "measures";

  // The value block attaches to the LAST x-dim. When that dim is a row dim
  // (hierarchy or time), nest the block INSIDE that dim's identity block (e.g.
  // under `location` or `time`); otherwise it is a top-level row field.
  const lastX = xDims[xDims.length - 1];
  const nestInHier = isRowDim(lastX) && rowKeyDims.length > 0;

  const facts = scopeFacts(payload, factsOverride);
  const rows = [];

  // Recurse the cartesian product of the row-key (x) hierarchy dimensions.
  const walk = (idx, curFacts, acc) => {
    if (idx >= rowKeyDims.length) {
      const row = { grid_id: makeGridId(acc) };
      acc.forEach((m) => {
        row[m.responseKey] = m.block;
      });
      const tree = buildValueTree(valueDims, 0, curFacts, payload, {});
      if (nestInHier) {
        // Mutating the last hierarchy's block also updates row[responseKey]
        // (same object reference), nesting the value tree under it.
        acc[acc.length - 1].block[fieldName] = tree;
      } else {
        row[fieldName] = tree;
      }
      rows.push(row);
      return;
    }
    const dim = rowKeyDims[idx];
    const members =
      dim === "time"
        ? enumerateTime(curFacts)
        : enumerateHier(hierInfo(dim, payload), curFacts);
    members.forEach((m) => {
      walk(idx + 1, m.facts, [...acc, m]);
    });
  };
  walk(0, facts, []);

  return { message: "Successful", status: true, rows };
}
