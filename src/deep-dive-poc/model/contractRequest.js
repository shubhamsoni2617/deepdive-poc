/**
 * Contract-request builder — turns the pivot panel's { arrangement, levels }
 * into everything the server-driven grid needs:
 *
 *   - the generic `/pivot` payload pieces (dimension array, hierarchy level
 *     maps, starting aggregations, measures, metrics, time order), and
 *   - a render classification (which dims are drillable row hierarchies, which
 *     are inner-row value dims, which are column value dims) so the grid can
 *     lay itself out for ANY selection.
 *
 * The backend (runContractRows) is already fully generic: it derives the whole
 * response from the `dimension` array. So making the POC serve "any
 * combination" is purely a matter of building that array + level maps from the
 * user's selection instead of hard-coding them.
 *
 * NOTE (time): for now the time dimension only ever resolves to `week`
 * (month/quarter handled later), so a present time dim contributes a single
 * `week` nesting level.
 */

import { DIMENSIONS } from "../config/dimensions.js";
import { MEASURE_LEVEL_TO_ROW } from "../config/dimensions.js";
import { CLIENT_TO_CONTRACT_METRIC } from "../config/contractMetrics.js";

/** Panel level-key -> seeded DB attribute, per hierarchy dimension. */
export const PRODUCT_LEVEL_ATTR = {
  division: "l1_name",
  department: "l3_name",
  class: "l4_name",
  sku: "product_code",
};
export const STORE_LEVEL_ATTR = {
  country: "country",
  state: "state",
  city: "city",
  store: "store_code",
};

/** The two drillable hierarchy dimensions and their config. */
const HIER = {
  [DIMENSIONS.PRODUCT]: {
    dim: "product", // contract dimension name
    responseKey: "product", // key on each response row
    levelsKey: "product_hierarchy_levels",
    aggKey: "product_hierarchy_aggregation",
    attrOf: PRODUCT_LEVEL_ATTR,
  },
  [DIMENSIONS.STORE]: {
    dim: "store",
    responseKey: "location",
    levelsKey: "location_hierarchy_levels",
    aggKey: "location_hierarchy_aggregation",
    attrOf: STORE_LEVEL_ATTR,
  },
};

const isHier = (d) => d === DIMENSIONS.PRODUCT || d === DIMENSIONS.STORE;

/**
 * Canonical value-block nesting order. The response `measures` block always
 * nests measure ▸ (week) and the metric object is the leaf, so navigation keys
 * are read in this order (absent dims skipped). Metrics is ALWAYS the leaf.
 */
export const CELL_DIMS = {
  [DIMENSIONS.MEASURES]: { key: "measure", label: "Measure", nest: 0 },
  [DIMENSIONS.TIME]: { key: "week", label: "Week", nest: 1 },
  [DIMENSIONS.METRICS]: { key: "metric", label: "Metric", nest: 2 },
};

const orderedMap = (attrs) =>
  attrs.reduce((m, attr, i) => {
    m[`l${i + 1}`] = attr;
    return m;
  }, {});

/** Selected level KEYS for a dim, in the dimension's canonical order. */
function selectedAttrs(dim, levels) {
  const cfg = HIER[dim];
  const sel = levels?.[dim] || [];
  const canonical = Object.keys(cfg.attrOf);
  return canonical.filter((k) => sel.includes(k)).map((k) => cfg.attrOf[k]);
}

/**
 * Build the full request + render config from the current pivot selection.
 *
 * @param {{rows:string[],columns:string[]}} arrangement
 * @param {Record<string,string[]>} levels
 * @returns {{
 *   payloadBase: object,          // static payload pieces (levels, aggs, measures, metrics, time, dimension)
 *   hierDims: {dim,responseKey,attrs,startAgg}[],  // drillable row hierarchies (ordered)
 *   innerRowDims: string[],       // value dims rendered as inner rows (arrangement order)
 *   colDims: string[],            // value dims rendered as column groups (arrangement order)
 *   blockLevels: string[],        // value-block nesting keys (rows then cols, outer->inner)
 *   valueBlockField: string,      // response field for the block ("measures"/"metrics")
 *   valueBlockHostKey: ?string,   // response key the block nests under, or null if top-level
 *   measures: string[],           // measure data-values (WCF/MFP)
 *   metrics: string[],            // contract metric keys (sls_u/aur/…)
 *   timeOrder: string[],          // ['week'] when time present, else []
 * }}
 */
export function buildRequestConfig(arrangement, levels) {
  const rows = arrangement?.rows || [];
  const cols = arrangement?.columns || [];

  // Hierarchy dims are always drillable ROW columns regardless of where the
  // panel places them (rows-first ordering). Full column-axis drilling is out
  // of scope; data stays correct, layout normalizes to row hierarchies.
  const hierDimNames = [
    ...rows.filter(isHier),
    ...cols.filter(isHier).filter((d) => !rows.includes(d)),
  ];

  // Time is a REAL grouping dimension (config/dimensions VALUE_DIMENSIONS excludes
  // it), so in ROWS it enumerates rows like product/store and is NOT a value-block
  // level. In COLUMNS it still nests as the `week` level. Value dims proper are
  // measure/metric, which pivot the cells (inner rows / column groups).
  const timeInRows = rows.includes(DIMENSIONS.TIME);
  const isValueDim = (d) =>
    d === DIMENSIONS.MEASURES ||
    d === DIMENSIONS.TIME ||
    d === DIMENSIONS.METRICS;
  // Row value dims exclude time (a grouping row dim); column value dims keep it.
  const rowValueDims = rows.filter(
    (d) => isValueDim(d) && d !== DIMENSIONS.TIME,
  );
  const colValueDims = cols.filter(isValueDim);
  const innerRowDims = rowValueDims;
  const colDims = colValueDims;

  const timePresent =
    rows.includes(DIMENSIONS.TIME) || cols.includes(DIMENSIONS.TIME);

  // Measures (data values) + metrics (contract keys) from the selection.
  const measures = (levels?.[DIMENSIONS.MEASURES] || [])
    .map((k) => MEASURE_LEVEL_TO_ROW[k])
    .filter(Boolean);
  const metrics = (levels?.[DIMENSIONS.METRICS] || [])
    .map((k) => CLIENT_TO_CONTRACT_METRIC[k])
    .filter(Boolean);

  // Per-hierarchy config: ordered selected attrs + starting aggregation.
  const hierDims = hierDimNames.map((name) => {
    const cfg = HIER[name];
    const attrs = selectedAttrs(name, levels);
    // The location (store) hierarchy starts collapsed at "total"; expanding a
    // node advances to the first selected level (country) and cascades from
    // there. Only on expand is the selected level passed to the API.
    const startAgg = cfg.dim === "store" ? "total" : attrs[0] || "total";
    return {
      dim: cfg.dim,
      responseKey: cfg.responseKey,
      attrs,
      startAgg,
      drillable: true,
    };
  });
  // Time in rows is the innermost, non-drillable grouping dim (weeks as rows).
  // Appended last so it hosts the value block (last x-dim rule).
  if (timeInRows) {
    hierDims.push({
      dim: "time",
      responseKey: "time",
      attrs: [],
      startAgg: "week",
      drillable: false,
    });
  }

  // --- static payload pieces -------------------------------------------------
  const payloadBase = {
    product_hierarchy_levels: {},
    location_hierarchy_levels: {},
    product_hierarchy_aggregation: "total",
    location_hierarchy_aggregation: "total",
    measures,
    metrics,
    time_order_selected: timePresent ? ["week"] : [],
  };
  hierDimNames.forEach((name, i) => {
    const cfg = HIER[name];
    payloadBase[cfg.levelsKey] = orderedMap(hierDims[i].attrs);
    payloadBase[cfg.aggKey] = hierDims[i].startAgg;
  });

  // --- value-block nesting (contract) ---------------------------------------
  // Nesting order = row value-dims (outer) then column value-dims. The FIRST
  // value dim is the block's outer key; its field name is "measures" (measure
  // outer) or "metrics" (metric outer). navigate() reads cells in this order.
  const VALUE_DIM_NAME = {
    [DIMENSIONS.MEASURES]: "measure",
    [DIMENSIONS.TIME]: "time",
    [DIMENSIONS.METRICS]: "metric",
  };
  const blockLevelDims = [...rowValueDims, ...colValueDims].filter((d) => {
    if (d === DIMENSIONS.MEASURES) return measures.length > 0;
    if (d === DIMENSIONS.METRICS) return metrics.length > 0;
    if (d === DIMENSIONS.TIME) return timePresent;
    return false;
  });
  const blockLevels = blockLevelDims.map((d) => CELL_DIMS[d].key);
  const valueBlockField =
    blockLevelDims[0] === DIMENSIONS.METRICS ? "metrics" : "measures";

  // Where the value block lives in the response. When the LAST x-dim is a
  // hierarchy (no value dim in rows), the block is nested INSIDE that
  // hierarchy's identity block (e.g. under `location`); otherwise it is a
  // top-level field. This host key tells the reader where to find it.
  const valueBlockHostKey =
    rowValueDims.length === 0 && hierDims.length
      ? hierDims[hierDims.length - 1].responseKey
      : null;

  // --- generic dimension array ----------------------------------------------
  // X: row hierarchies then row value-dims (last x value-dim = block outer key).
  // Y: column value-dims, in column order (the inner nesting levels).
  const dimension = [];
  let xOrder = 1;
  hierDims.forEach((h) =>
    dimension.push({ order: String(xOrder++), dimension: h.dim, axis: "x" }),
  );
  rowValueDims.forEach((d) =>
    dimension.push({
      order: String(xOrder++),
      dimension: VALUE_DIM_NAME[d],
      axis: "x",
    }),
  );
  colValueDims.forEach((d, i) =>
    dimension.push({
      order: String(i + 1),
      dimension: VALUE_DIM_NAME[d],
      axis: "y",
    }),
  );
  payloadBase.dimension = dimension;

  return {
    payloadBase,
    hierDims,
    innerRowDims,
    colDims,
    blockLevels,
    valueBlockField,
    valueBlockHostKey,
    measures,
    metrics,
    timeOrder: payloadBase.time_order_selected,
  };
}

/** Stable string identity for a request config (drives refetch). */
export function requestConfigKey(cfg) {
  return JSON.stringify([
    cfg.hierDims.map((h) => [h.dim, h.attrs]),
    cfg.innerRowDims,
    cfg.colDims,
    cfg.blockLevels,
    cfg.valueBlockField,
    cfg.valueBlockHostKey,
    cfg.measures,
    cfg.metrics,
    cfg.timeOrder,
  ]);
}
