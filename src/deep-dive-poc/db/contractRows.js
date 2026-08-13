/**
 * Contract row builder — general, `dimension`-array driven.
 *
 * The response shape is derived entirely from the request `dimension` array
 * (each entry: { order, dimension, axis }). Sorting each axis by `order`:
 *   - X-dims EXCEPT the last become DIRECT KEYS on every response row
 *     (e.g. `product`, `location`) — they identify the row.
 *   - The LAST x-dim's members become the LEAF keys of the value block
 *     (e.g. `metric` -> { sls_u, aur, ... }).
 *   - All Y-dims nest, in order, inside the `measures` value block
 *     (e.g. measure -> time(quarter/month/week) -> { metric: value }).
 *
 * Nothing is pre-aggregated: every leaf value is summed from the granular
 * facts on demand and ratio metrics are recomputed from summed components so
 * numbers are correct at any level.
 *
 * Row shape:
 *   {
 *     grid_id: "<deterministic id>",
 *     product:  { aggregation_level, attribute_name, value, has_children, next_level },
 *     location: { aggregation_level, value, has_children, next_level },
 *     measures: { <measure>: { <q>: { <m>: { <w>: { <metric>: value } } } } }
 *   }
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

/** Leaf metric object from summed components (raw metric keys). */
function leafObject(facts, leafDim, payload) {
  const comp = emptyComponents();
  facts.forEach((f) => addComponents(comp, f));
  if (leafDim === "measure") {
    // Leaf keyed by measures (rare arrangement) — value = first metric.
    const metric = (payload.metrics || [])[0] || "sls_u";
    const out = {};
    (payload.measures || []).forEach((meas) => {
      const c = emptyComponents();
      facts
        .filter((f) => f.measure === meas)
        .forEach((f) => addComponents(c, f));
      out[meas] = computeMetric(metric, c);
    });
    return out;
  }
  // Default / leafDim === "metric": one entry per requested metric.
  const out = {};
  (payload.metrics || []).forEach((m) => {
    out[m] = computeMetric(m, comp);
  });
  return out;
}

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

/** Recursively nest the y-dimensions, then emit the leaf metric object. */
function nestY(yDims, i, facts, payload, leafDim) {
  if (i >= yDims.length) return leafObject(facts, leafDim, payload);
  const dim = yDims[i];
  const next = (f) => nestY(yDims, i + 1, f, payload, leafDim);

  if (dim === "measure") {
    const out = {};
    (payload.measures || []).forEach((meas) => {
      out[meas] = next(facts.filter((f) => f.measure === meas));
    });
    return out;
  }
  if (dim === "time") {
    return nestTime(payload.time_order_selected || [], 0, facts, next);
  }
  if (isHierDim(dim)) {
    const out = {};
    enumerateHier(hierInfo(dim, payload), facts).forEach((m) => {
      out[m.block.value] = next(m.facts);
    });
    return out;
  }
  // Unknown y-dim: skip a level.
  return next(facts);
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
  if (!xDims.length) xDims = ["product", "location", "metric"];
  if (!yDims.length) yDims = ["measure", "time"];

  // X-dims except the last identify each row; the last is the metric leaf.
  const rowKeyDims = xDims.slice(0, -1).filter(isHierDim);
  const leafDim = xDims[xDims.length - 1];

  const facts = scopeFacts(payload, factsOverride);
  const rows = [];

  // Recurse the cartesian product of the row-key (x) hierarchy dimensions.
  const walk = (idx, curFacts, acc) => {
    if (idx >= rowKeyDims.length) {
      const row = { grid_id: makeGridId(acc) };
      acc.forEach((m) => {
        row[m.responseKey] = m.block;
      });
      row.measures = nestY(yDims, 0, curFacts, payload, leafDim);
      rows.push(row);
      return;
    }
    const info = hierInfo(rowKeyDims[idx], payload);
    enumerateHier(info, curFacts).forEach((m) => {
      walk(idx + 1, m.facts, [...acc, m]);
    });
  };
  walk(0, facts, []);

  return { message: "Successful", status: true, rows };
}
