/**
 * Cell-edit domain logic: resolving the data filter a cell represents,
 * deciding editability, and redistributing an edited total back onto the
 * underlying records (keeping price/cost constant, recomputing derived
 * metrics).
 */

import { EDITABLE_METRIC } from "../config/metrics";

export function getCellFilter(params, rowFields, columnFields) {
  const filter = {};

  // Walk row node parents to collect row group keys.
  let node = params.node;
  while (node && node.parent) {
    if (node.field != null && node.key != null) {
      filter[node.field] = node.key;
    }
    node = node.parent;
  }

  // Collect pivot keys from the column.
  const colDef = params.column?.getColDef?.();
  if (colDef?.pivotKeys && columnFields.length > 0) {
    colDef.pivotKeys.forEach((value, idx) => {
      const field = columnFields[idx]?.field;
      if (field) filter[field] = value;
    });
  }

  return filter;
}

export function isCellEditable(params, rowFields, columnFields) {
  const colDef = params.column?.getColDef?.();
  if (colDef?.field !== EDITABLE_METRIC) return false;

  const filter = getCellFilter(params, rowFields, columnFields);
  return filter.measure === "WCF";
}

export function updateBaseData(records, filter, newValue) {
  const matches = records.filter((r) =>
    Object.entries(filter).every(([field, value]) => r[field] === value),
  );
  if (matches.length === 0) return records;

  const currentSum = matches.reduce((sum, r) => sum + r[EDITABLE_METRIC], 0);
  const delta = newValue - currentSum;
  if (Math.abs(delta) < 1e-9) return records;

  const newRecords = records.map((r) => ({ ...r }));

  matches.forEach((match) => {
    const idx = newRecords.findIndex((r) => r.id === match.id);
    if (idx === -1) return;
    const record = newRecords[idx];

    const proportion =
      currentSum === 0
        ? 1 / matches.length
        : record[EDITABLE_METRIC] / currentSum;

    const newMetric = Math.max(
      0,
      record[EDITABLE_METRIC] + delta * proportion,
    );
    record[EDITABLE_METRIC] = newMetric;

    // Recompute derived metrics with price/cost held constant.
    record["sls$"] = newMetric * record.aur;
    record["gm$"] = newMetric * (record.aur - record.auc);
    record["gm%"] =
      record["sls$"] > 0 ? (record["gm$"] / record["sls$"]) * 100 : 0;
  });

  return newRecords;
}
