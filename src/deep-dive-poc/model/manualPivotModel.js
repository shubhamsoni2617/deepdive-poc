/**
 * Manual-pivot data model.
 *
 * The manual pivot renders a pure dimension hierarchy as a flat, manually
 * expanded, cell-spanned grid where the measure/metric is innermost. This
 * module contains the two pure transforms:
 *   buildManualPivotModel — aggregate records into a tree + per-cell components
 *   buildManualRows       — flatten the tree into visible grid rows
 */

import { buildManualColumnKey } from "../columns/columnKey";
import { addRecordComponents, emptyComponents } from "../config/metrics";

// Path-segment and cell-key separators (control chars, safe vs data values).
export const PATH_SEP = "\u0001";
const CELL_SEP = "\u0002";

export const cellKey = (pathKey, measure) => `${pathKey}${CELL_SEP}${measure}`;

/**
 * Aggregate records into the manual-pivot structures.
 * @returns { colCombos, childrenOrder, cellMap, maxDepth }
 */
export function buildManualPivotModel({
  filteredRecords,
  rowLevelFields,
  colLevelFields,
}) {
  const colComboMap = new Map(); // colKey -> ordered col field values
  const childrenOrder = new Map(); // parentPathKey -> ordered [childValue]
  const childSeen = new Map(); // parentPathKey -> Set(childValue)
  const cellMap = new Map(); // cellKey -> { colKey: components }
  const maxDepth = Math.max(1, rowLevelFields.length);

  const addChild = (parentPk, value) => {
    let seen = childSeen.get(parentPk);
    if (!seen) {
      seen = new Set();
      childSeen.set(parentPk, seen);
      childrenOrder.set(parentPk, []);
    }
    if (!seen.has(value)) {
      seen.add(value);
      childrenOrder.get(parentPk).push(value);
    }
  };

  filteredRecords.forEach((r) => {
    const colValues = colLevelFields.map((f) => r[f]);
    const colKey = buildManualColumnKey(colValues);
    if (!colComboMap.has(colKey)) colComboMap.set(colKey, colValues);

    // Aggregate into every column prefix so a collapsed column group can show a
    // rolled-up summary column.
    const colKeys = [];
    if (colLevelFields.length === 0) {
      colKeys.push(colKey);
    } else {
      for (let n = 1; n <= colLevelFields.length; n++) {
        colKeys.push(buildManualColumnKey(colValues.slice(0, n)));
      }
    }

    for (let d = 1; d <= maxDepth; d++) {
      const prefix = rowLevelFields.slice(0, d).map((f) => r[f]);
      const value = prefix[d - 1] ?? "";
      const parentPk = prefix.slice(0, d - 1).join(PATH_SEP);
      const pk = prefix.join(PATH_SEP);
      addChild(parentPk, value);

      const key = cellKey(pk, r.measure);
      let cells = cellMap.get(key);
      if (!cells) {
        cells = {};
        cellMap.set(key, cells);
      }
      colKeys.forEach((ck) => {
        cells[ck] = addRecordComponents(cells[ck] || emptyComponents(), r);
      });
    }
  });

  // Stable alphabetical display order per level.
  childrenOrder.forEach((arr) =>
    arr.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  );

  const colCombos = Array.from(colComboMap.entries()).map(([key, values]) => ({
    key,
    values,
  }));
  colCombos.sort((a, b) => {
    for (let i = 0; i < a.values.length; i++) {
      const av = String(a.values[i] ?? "");
      const bv = String(b.values[i] ?? "");
      if (av !== bv) return av < bv ? -1 : 1;
    }
    return 0;
  });

  return { colCombos, childrenOrder, cellMap, maxDepth };
}

/**
 * Flatten the manual-pivot tree into visible rows given the expand state.
 * Each dimension node emits one row per inner combo (measure and/or metric);
 * the first row carries the label + chevron and spans the rest.
 */
export function buildManualRows({
  manualPivot,
  expandedKeys,
  orderedMeasures,
  innerIsMetric,
  bothInner,
  innerMetricKeys,
  rowInnerDims,
}) {
  if (!manualPivot) return null;
  const { childrenOrder, cellMap, maxDepth } = manualPivot;
  const out = [];
  let nodeCounter = 0;

  const listFor = (dim) =>
    dim === "measures"
      ? orderedMeasures.map((v) => ({ kind: "measure", value: v }))
      : innerMetricKeys.map((v) => ({ kind: "metric", value: v }));

  const buildCombos = () => {
    if (bothInner) {
      const outerList = listFor(rowInnerDims[0]);
      const innerList = listFor(rowInnerDims[1]);
      const combos = [];
      outerList.forEach((o) => {
        innerList.forEach((i2, ii) => {
          const both = { [o.kind]: o.value, [i2.kind]: i2.value };
          combos.push({
            measure: both.measure,
            metricKey: both.metric,
            grpFirst: ii === 0,
            grpLast: ii === innerList.length - 1,
          });
        });
      });
      return combos;
    }
    const single = innerIsMetric
      ? innerMetricKeys.map((v) => ({ metricKey: v }))
      : orderedMeasures.map((v) => ({ measure: v }));
    return single.map((c) => ({ ...c, grpFirst: true, grpLast: true }));
  };

  const combos = buildCombos();

  const walk = (parentPk, depth) => {
    const children = childrenOrder.get(parentPk) || [];
    children.forEach((value) => {
      const pk = parentPk ? `${parentPk}${PATH_SEP}${value}` : value;
      const hasChildren =
        depth + 1 < maxDepth && (childrenOrder.get(pk)?.length || 0) > 0;
      const expanded = expandedKeys.has(pk);
      const alt = nodeCounter % 2 === 1;
      nodeCounter += 1;

      const cellsByMeasure = {};
      orderedMeasures.forEach((m) => {
        cellsByMeasure[m] = cellMap.get(cellKey(pk, m)) || {};
      });

      combos.forEach((combo, ci) => {
        const measure = combo.measure ?? orderedMeasures[0];
        out.push({
          id: `${pk}${CELL_SEP}${combo.measure ?? ""}${CELL_SEP}${
            combo.metricKey ?? ""
          }`,
          __pathKey: pk,
          __depth: depth,
          __label: value,
          __hasChildren: hasChildren,
          __expanded: expanded,
          __isFirst: ci === 0,
          __isLast: ci === combos.length - 1,
          __grpFirst: combo.grpFirst,
          __grpLast: combo.grpLast,
          __alt: alt,
          __cellsByMeasure: cellsByMeasure,
          measure: combo.measure,
          metricKey: combo.metricKey,
          __cells: cellsByMeasure[measure] || {},
        });
      });
      if (expanded && hasChildren) walk(pk, depth + 1);
    });
  };
  walk("", 0);
  return out;
}
