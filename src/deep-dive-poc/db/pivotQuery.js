/**
 * Selection-driven aggregation engine.
 *
 * Consumes the Deep Dive pivot payload (filters, grid_filters, dimension axes,
 * hierarchy aggregations, forecast_attributes, metrics, time_period, meta) and
 * aggregates the granular fact table (./deepDiveDb.js) into the row/column
 * response shape agreed with the backend.
 *
 * Model rules encoded here:
 *  - Any row dimension (product / store / time) can be the drilled axis; its
 *    `*_hierarchy_aggregation` sets the level to return. Only ONE of
 *    product/store is expanded at a time (a frontend rule; the engine simply
 *    groups by whatever aggregations are non-null).
 *  - A null aggregation => that dimension rolls up to a single "Total" node.
 *  - Value dims (measure/metric): when on the row axis they become the nested
 *    `metrics`/`measures` object; when on the column axis they become nesting
 *    keys. The nesting order under each row always follows the column
 *    (`axis:"x"`) order, outer → inner. Time on a column axis contributes the
 *    week/month/quarter bucket keys.
 */

import {
  getFacts,
  addComponents,
  emptyComponents,
  computeMetric,
  DIM_LEVELS,
  MEASURES as ALL_MEASURES,
} from "./deepDiveDb";

// Dimension name -> response block key. Store renders as "location".
const BLOCK_KEY = { product: "product", store: "location", time: "time" };

// Dimension name -> its `*_hierarchy_aggregation` payload field.
const AGG_FIELD = {
  product: "product_hierarchy_aggregation",
  store: "location_hierarchy_aggregation",
  time: "time_hierarchy_aggregation",
};

const isValueDim = (d) => d === "measure" || d === "metric";

/** Ordered level attributes for a dimension, honoring a payload override map. */
function orderedLevels(dim, payload) {
  if (dim === "product" && payload.product_hierarchy_levels) {
    return orderMap(payload.product_hierarchy_levels);
  }
  if (dim === "store" && payload.location_hierarchy_levels) {
    return orderMap(payload.location_hierarchy_levels);
  }
  return DIM_LEVELS[dim] || [];
}

/** Turn { l1:"country", l2:"state", ... } into ["country","state", ...]. */
function orderMap(levelMap) {
  return Object.keys(levelMap)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .map((k) => levelMap[k]);
}

/** Apply cascaded `in` filters (page filters + grid_filters) to the facts. */
function applyFilterList(facts, filterList) {
  if (!filterList || !filterList.length) return facts;
  return facts.filter((f) =>
    filterList.every((flt) => {
      const val = f[flt.attribute_name];
      if (val === undefined) return true; // unknown attribute -> ignore
      return (flt.values || []).map(String).includes(String(val));
    }),
  );
}

/** Distinct, stably-sorted values of a field within a fact set. */
function distinct(facts, field) {
  const set = new Set();
  facts.forEach((f) => set.add(f[field]));
  return Array.from(set).sort((a, b) =>
    String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
  );
}

/** Split the `dimension` array into ordered y (rows) and x (columns) lists. */
function splitAxes(dimension = []) {
  const byOrder = (a, b) => Number(a.order) - Number(b.order);
  const y = dimension
    .filter((d) => d.axis === "y")
    .sort(byOrder)
    .map((d) => d.dimension);
  const x = dimension
    .filter((d) => d.axis === "x")
    .sort(byOrder)
    .map((d) => d.dimension);
  return { y, x };
}

/**
 * Build a per-row-group index: measure -> weekKey -> summed components. All
 * column resolution (measure/metric/time bucket) reads from this cheaply.
 */
function indexGroupFacts(groupFacts) {
  const index = {};
  groupFacts.forEach((f) => {
    const byMeasure = index[f.measure] || (index[f.measure] = {});
    const wk = f.fiscal_year_week;
    byMeasure[wk] = addComponents(byMeasure[wk] || emptyComponents(), f);
  });
  return index;
}

/** Sum components across a set of weeks for one measure. */
function sumForWeeks(index, measure, weeks) {
  const acc = emptyComponents();
  const byMeasure = index[measure];
  if (!byMeasure) return acc;
  weeks.forEach((wk) => {
    const c = byMeasure[wk];
    if (c) addComponents(acc, c);
  });
  return acc;
}

/**
 * Main entry. Returns { grid_id, parent_grid_id, context, rows, pagination,
 * meta } aggregated from the fact table per the payload selection.
 */
export function runPivotQuery(payload = {}) {
  const {
    filters = [],
    grid_filters = [],
    grid_id = null,
    parent_grid_id = null,
    dimension = [],
    forecast_attributes = ALL_MEASURES,
    metrics = ["sls_u"],
    time_period = {},
    fiscal_ids = [],
    meta = {},
  } = payload;

  const measures = forecast_attributes;
  const { y: yDims, x: xDims } = splitAxes(dimension);

  // ---- 1. Scope the facts: page filters + drill path + week range + measures.
  let facts = getFacts();
  facts = applyFilterList(facts, filters);
  facts = applyFilterList(facts, grid_filters);

  const weekKeys = (fiscal_ids.length
    ? fiscal_ids
    : (time_period.fiscal_mapping || []).map((m) => m.fiscal_year_week)
  ).map(Number);
  const weekSet = new Set(weekKeys);
  if (weekSet.size) facts = facts.filter((f) => weekSet.has(f.fiscal_year_week));
  facts = facts.filter((f) => measures.includes(f.measure));

  // week -> { month, quarter } for column-side time bucketing.
  const weekMeta = new Map();
  (time_period.fiscal_mapping || []).forEach((m) =>
    weekMeta.set(Number(m.fiscal_year_week), m),
  );

  // ---- 2. Row axes: tree/time dims (grouped or Total) + value dims (nested).
  const rowTreeDims = yDims.filter((d) => !isValueDim(d));
  const rowValueDims = yDims.filter(isValueDim);

  // For each row tree/time dim, resolve the grouping field (or Total).
  const rowAxisSpecs = rowTreeDims.map((dim) => {
    const aggAttr = payload[AGG_FIELD[dim]] || null;
    const levels = orderedLevels(dim, payload);
    const groupField = aggAttr; // null => Total (single node)
    const values = groupField ? distinct(facts, groupField) : ["Total"];
    return { dim, aggAttr, levels, groupField, values };
  });

  // Cartesian product of the grouped row-axis values => one combo per row.
  let combos = [[]];
  rowAxisSpecs.forEach((spec) => {
    const next = [];
    combos.forEach((chosen) =>
      spec.values.forEach((v) => next.push([...chosen, { spec, value: v }])),
    );
    combos = next;
  });

  // ---- 3. Column nesting levels (value dims + time), outer -> inner.
  const colLevels = xDims.map((dim) => {
    if (dim === "measure") return { type: "measure", values: measures };
    if (dim === "metric") return { type: "metric", values: metrics };
    // time on columns: bucket weeks at the requested aggregation.
    const aggAttr = payload[AGG_FIELD.time] || "fiscal_year_week";
    return { type: "time", aggAttr };
  });

  const timeOnCols = colLevels.some((l) => l.type === "time");

  // ---- 4. Build each row.
  const buildValueTree = (index, levelIdx, ctx) => {
    if (levelIdx >= colLevels.length) {
      // Leaf: need a fixed measure + metric; weeks default to all in range.
      const weeks = ctx.weeks || weekKeys;
      const comp = sumForWeeks(index, ctx.measure, weeks);
      return computeMetric(ctx.metric, comp);
    }
    const level = colLevels[levelIdx];
    const obj = {};
    if (level.type === "measure") {
      level.values.forEach((m) => {
        obj[m] = buildValueTree(index, levelIdx + 1, { ...ctx, measure: m });
      });
    } else if (level.type === "metric") {
      level.values.forEach((mk) => {
        obj[mk] = buildValueTree(index, levelIdx + 1, { ...ctx, metric: mk });
      });
    } else {
      // time buckets: group the in-range weeks by the aggregation attribute.
      const buckets = new Map();
      weekKeys.forEach((wk) => {
        const meta2 = weekMeta.get(wk) || {};
        const bucket =
          level.aggAttr === "fiscal_year_week"
            ? wk
            : meta2[level.aggAttr] ?? wk;
        if (!buckets.has(bucket)) buckets.set(bucket, []);
        buckets.get(bucket).push(wk);
      });
      Array.from(buckets.keys())
        .sort((a, b) => Number(a) - Number(b))
        .forEach((bucket) => {
          obj[bucket] = buildValueTree(index, levelIdx + 1, {
            ...ctx,
            weeks: buckets.get(bucket),
          });
        });
    }
    return obj;
  };

  // Wrap the value payload: row value-dim => metrics/measures object; else cells.
  const wrapValue = (index) => {
    if (rowValueDims.length) {
      const first = rowValueDims[0];
      const wrapperKey = first === "measure" ? "measures" : "metrics";
      const values = first === "measure" ? measures : metrics;
      const obj = {};
      values.forEach((v) => {
        const seedCtx = first === "measure" ? { measure: v } : { metric: v };
        obj[v] = buildValueTree(index, 0, seedCtx);
      });
      return { [wrapperKey]: obj };
    }
    return { cells: buildValueTree(index, 0, {}) };
  };

  const blockFor = (spec, value) => {
    const isTotal = !spec.groupField;
    const levels = spec.levels;
    let aggregation_level = null;
    let next_level = null;
    let has_children = true;
    if (isTotal) {
      next_level = levels[0] || null;
      has_children = !!next_level;
    } else {
      aggregation_level = spec.groupField;
      const idx = levels.indexOf(spec.groupField);
      next_level = idx >= 0 && idx + 1 < levels.length ? levels[idx + 1] : null;
      has_children = !!next_level;
    }
    return {
      aggregation_level,
      value: isTotal ? "Total" : value,
      has_children,
      next_level,
    };
  };

  const allRows = combos.map((combo) => {
    // Scope facts to this row combo's grouped fields.
    let groupFacts = facts;
    combo.forEach(({ spec, value }) => {
      if (spec.groupField) {
        groupFacts = groupFacts.filter(
          (f) => String(f[spec.groupField]) === String(value),
        );
      }
    });
    const index = indexGroupFacts(groupFacts);

    const row = {};
    combo.forEach(({ spec, value }) => {
      row[BLOCK_KEY[spec.dim]] = blockFor(spec, value);
    });
    // Ensure product/location blocks always present (Total) even if not on y.
    Object.assign(row, wrapValue(index));
    return row;
  });

  // ---- 5. Pagination.
  const limit = meta.limit || allRows.length || 1;
  const page = meta.page || 1;
  const paginate = meta.paginated_rows !== false; // default true
  const start = paginate ? (page - 1) * limit : 0;
  const pageRows = paginate ? allRows.slice(start, start + limit) : allRows;

  return {
    grid_id,
    parent_grid_id,
    context: {
      row_axes: rowTreeDims,
      aggregations: Object.fromEntries(
        rowTreeDims.map((d) => [d, payload[AGG_FIELD[d]] || null]),
      ),
      grid_filters,
    },
    rows: pageRows,
    pagination: {
      page,
      limit,
      total_rows: allRows.length,
      has_more: paginate ? start + limit < allRows.length : false,
    },
    meta: {
      time_on_columns: timeOnCols,
      available_measures: measures,
      available_metrics: metrics,
      editable_metrics: ["sls_u"],
      ratio_metrics: ["aur", "auc", "gm_pct"],
    },
  };
}
