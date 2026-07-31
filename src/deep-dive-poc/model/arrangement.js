/**
 * Arrangement domain logic — pure functions describing how a given
 * rows/columns arrangement should behave, with no grid or React knowledge.
 */

import { DIMENSIONS } from "../config/dimensions";

const { MEASURES, METRICS, TIME } = DIMENSIONS;

export function flipArrangement(arrangement) {
  return {
    ...arrangement,
    rows: arrangement.columns,
    columns: arrangement.rows,
  };
}

/**
 * True when the metrics dimension has higher column priority than any other
 * (non-metrics) column dimension, i.e. metrics should form the outermost
 * column groups.
 */
export function metricsIsOutermost(arrangement) {
  const cols = arrangement.columns || [];
  const metricsIdx = cols.indexOf(METRICS);
  if (metricsIdx === -1) return false;
  const otherPivotDims = cols.filter((d) => d !== METRICS);
  return (
    otherPivotDims.length > 0 && metricsIdx < cols.indexOf(otherPivotDims[0])
  );
}

/**
 * Classify an arrangement into the flags the model/columns layers switch on.
 * Centralises the measures/metrics placement rules that were previously
 * recomputed inline in several files.
 */
export function classifyArrangement(arrangement) {
  const rows = arrangement.rows || [];
  const columns = arrangement.columns || [];

  const measuresInRows = rows.includes(MEASURES);
  const metricsInRows = rows.includes(METRICS);
  const metricsOutermostCol = metricsIsOutermost(arrangement);

  // Manual (custom) pivot: measures or metrics is a row dimension.
  const manualPivotActive = measuresInRows || metricsInRows;
  // In the manual pivot, metrics is the innermost row dim only when measures
  // is not also in rows.
  const metricsInRowsManual = metricsInRows && !measuresInRows;
  const innerIsMetric = metricsInRows && !measuresInRows;
  const bothInner = measuresInRows && metricsInRows;

  const measureOrMetricInCols =
    columns.includes(MEASURES) || columns.includes(METRICS);

  // Real grouping dimensions in columns (excluding time + value dims).
  const groupingColDims = columns.filter(
    (d) => d !== MEASURES && d !== METRICS && d !== TIME,
  );

  return {
    measuresInRows,
    metricsInRows,
    metricsInRowsManual,
    metricsOutermostCol,
    manualPivotActive,
    innerIsMetric,
    bothInner,
    measureOrMetricInCols,
    groupingColDims,
  };
}
