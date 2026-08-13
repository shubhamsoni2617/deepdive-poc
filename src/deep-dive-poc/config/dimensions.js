/**
 * Dimension configuration — the single source of truth for the pivot's
 * dimensions, their drill levels, defaults, and display labels.
 *
 * Adding a new dimension or level is a data change here; the model/columns
 * layers are generic and consume this config without hard-coding dimension
 * names (beyond the special-cased measures/metrics dimensions).
 */

export const DIMENSIONS = {
  PRODUCT: "product",
  STORE: "store",
  TIME: "time",
  MEASURES: "measures",
  METRICS: "metrics",
};

/** Dimensions that are not real grouping dimensions but pivot the value cells. */
export const VALUE_DIMENSIONS = [DIMENSIONS.MEASURES, DIMENSIONS.METRICS];

export const isValueDimension = (dim) => VALUE_DIMENSIONS.includes(dim);

export const PRODUCT_LEVELS = [
  { key: "division", label: "Division" },
  { key: "department", label: "Department" },
  { key: "class", label: "Class" },
  { key: "sku", label: "SKU" },
];

export const STORE_LEVELS = [
  { key: "channel", label: "Channel" },
  { key: "state", label: "State" },
  { key: "storeId", label: "Store ID" },
];

export const TIME_LEVELS = [
  { key: "quarter", label: "Quarter" },
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
];

export const MEASURE_LEVELS = [
  { key: "slsU", label: "WCF", locked: true },
  { key: "mfp", label: "MFP" },
  { key: "ly", label: "LY" },
  { key: "varLY", label: "Var LY(%)" },
];

/** Measure values as they appear in the raw data rows. */
export const MEASURES = ["WCF", "LY", "MFP"];

/** Map a selectable measure-level key to its data value (r.measure). */
export const MEASURE_LEVEL_TO_ROW = { slsU: "WCF", mfp: "MFP", ly: "LY" };

// Metric definitions (label/editable/aggregation/format) live in ./metrics so
// there is exactly one source of truth. METRIC_LEVELS is re-exported here only
// to keep LEVELS_BY_DIMENSION assembled in one place.
export { METRIC_LEVELS } from "./metrics.js";
import { METRIC_LEVELS } from "./metrics.js";

export const LEVELS_BY_DIMENSION = {
  [DIMENSIONS.PRODUCT]: PRODUCT_LEVELS,
  [DIMENSIONS.STORE]: STORE_LEVELS,
  [DIMENSIONS.TIME]: TIME_LEVELS,
  [DIMENSIONS.MEASURES]: MEASURE_LEVELS,
  [DIMENSIONS.METRICS]: METRIC_LEVELS,
};

export const DEFAULT_LEVELS = {
  [DIMENSIONS.PRODUCT]: ["division", "department", "sku"],
  [DIMENSIONS.STORE]: ["channel", "storeId"],
  [DIMENSIONS.TIME]: ["week"],
  [DIMENSIONS.MEASURES]: ["slsU", "mfp"],
  [DIMENSIONS.METRICS]: ["slsU", "aur"],
};

export const DIMENSION_LABELS = {
  [DIMENSIONS.PRODUCT]: "Product",
  [DIMENSIONS.STORE]: "Location",
  [DIMENSIONS.TIME]: "Time",
  [DIMENSIONS.MEASURES]: "Measure",
  [DIMENSIONS.METRICS]: "Metrics",
};

export const getDimensionLabel = (dim) => DIMENSION_LABELS[dim] || dim;

export const getLevelLabel = (dim, levelKey) =>
  LEVELS_BY_DIMENSION[dim]?.find((l) => l.key === levelKey)?.label || levelKey;

/** Selected level keys for a dimension, defaulting to all of its levels. */
export const selectedLevelsFor = (dim, levels) =>
  levels?.[dim] || (LEVELS_BY_DIMENSION[dim] || []).map((l) => l.key);
