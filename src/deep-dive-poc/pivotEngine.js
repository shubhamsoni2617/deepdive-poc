import { LEVELS_BY_DIMENSION } from "./constants";

export function getDimensionFields(arrangement, levels) {
  const rowFields = [];
  arrangement.rows.forEach((dim) => {
    if (dim === "metrics") {
      rowFields.push({ dimension: dim, field: "metric" });
      return;
    }
    if (dim === "measures") {
      rowFields.push({ dimension: dim, field: "measure" });
      return;
    }
    const selected = levels[dim] || LEVELS_BY_DIMENSION[dim].map((l) => l.key);
    selected.forEach((key) => rowFields.push({ dimension: dim, field: key }));
  });

  const columnFields = [];
  arrangement.columns.forEach((dim) => {
    if (dim === "metrics") {
      columnFields.push({ dimension: dim, field: "metric" });
      return;
    }
    if (dim === "measures") {
      columnFields.push({ dimension: dim, field: "measure" });
      return;
    }
    const selected = levels[dim] || LEVELS_BY_DIMENSION[dim].map((l) => l.key);
    selected.forEach((key) =>
      columnFields.push({ dimension: dim, field: key }),
    );
  });

  return { rowFields, columnFields };
}

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
      if (field) {
        filter[field] = value;
      }
    });
  }

  return filter;
}

export function isCellEditable(params, rowFields, columnFields) {
  const colDef = params.column?.getColDef?.();
  if (colDef?.field !== "slsU") return false;

  const filter = getCellFilter(params, rowFields, columnFields);
  if (filter.measure !== "WCF") return false;

  // Require the cell to be at a specific measure, not a measure grand total.
  return true;
}

export function updateBaseData(records, filter, newValue) {
  const editableMetric = "slsU";

  const matches = records.filter((r) =>
    Object.entries(filter).every(([field, value]) => r[field] === value),
  );

  if (matches.length === 0) return records;

  const currentSum = matches.reduce((sum, r) => sum + r[editableMetric], 0);
  const delta = newValue - currentSum;

  if (Math.abs(delta) < 1e-9) return records;

  const newRecords = records.map((r) => ({ ...r }));

  matches.forEach((match) => {
    const idx = newRecords.findIndex((r) => r.id === match.id);
    if (idx === -1) return;
    const record = newRecords[idx];

    let proportion = 0;
    if (currentSum === 0) {
      proportion = 1 / matches.length;
    } else {
      proportion = record[editableMetric] / currentSum;
    }

    const newMetric = Math.max(0, record[editableMetric] + delta * proportion);
    record[editableMetric] = newMetric;

    // Recalculate derived metrics while keeping price/cost constant.
    record["sls$"] = newMetric * record.aur;
    record["gm$"] = newMetric * (record.aur - record.auc);
    record["gm%"] =
      record["sls$"] > 0 ? (record["gm$"] / record["sls$"]) * 100 : 0;
  });

  return newRecords;
}

export function flipArrangement(arrangement) {
  return {
    ...arrangement,
    rows: arrangement.columns,
    columns: arrangement.rows,
  };
}

export function formatNumber(value, digits = 0) {
  if (value == null || Number.isNaN(value)) return "-";
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatCurrency(value) {
  if (value == null || Number.isNaN(value)) return "-";
  return `$${formatNumber(value, 0)}`;
}

export function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return "-";
  return `${Number(value).toFixed(1)}%`;
}
