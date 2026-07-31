/**
 * Backward-compatible facade for grid/column building, now split across
 * ./columns/* and ./grid/*.
 */

export { buildManualColumnKey } from "./columns/columnKey";
export { metricsIsOutermost } from "./model/arrangement";
export {
  buildColDefs,
  buildDimensionColDefs,
} from "./columns/pivotColumns";
export { buildManualColDefs } from "./columns/manualColumns";
export { buildGridOptions } from "./grid/gridOptions";
