/**
 * Unpivot records into one row per selected metric. Used when metrics is a row
 * dimension or the outermost column dimension, where each metric needs to be a
 * distinct AG Grid group/pivot value. Additive components (_slsU/_sls$/_gm$)
 * are carried for the custom aggregation.
 */

import { METRIC_REGISTRY } from "../config/metrics";

export function unpivotByMetric(filteredRecords, selectedMetrics) {
  const out = [];
  filteredRecords.forEach((r) => {
    selectedMetrics.forEach((metricKey) => {
      out.push({
        ...r,
        metric: METRIC_REGISTRY[metricKey]?.label || metricKey,
        metricKey,
        _slsU: r.slsU || 0,
        _sls$: r["sls$"] || 0,
        _gm$: r["gm$"] || 0,
      });
    });
  });
  return out;
}
