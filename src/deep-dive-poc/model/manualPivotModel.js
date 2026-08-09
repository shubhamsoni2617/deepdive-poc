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

// Path-segment separators (control chars, safe vs data values). LOC_MARK
// separates the product path from the nested location path in a combined key.
export const PATH_SEP = "\u0001";
const CELL_SEP = "\u0002";
export const LOC_MARK = "\u0003";

export const cellKey = (pathKey, measure) => `${pathKey}${CELL_SEP}${measure}`;

/** Column prefix keys for a record (every prefix so collapsed groups roll up). */
function colKeysForRecord(r, colLevelFields) {
  const colValues = colLevelFields.map((f) => r[f]);
  if (colLevelFields.length === 0) return [buildManualColumnKey(colValues)];
  // Always include the empty (all-time) prefix so a collapsed outer value-dim
  // group (e.g. a collapsible Measure) can roll up across every column period.
  const keys = [buildManualColumnKey([])];
  for (let n = 1; n <= colLevelFields.length; n++) {
    keys.push(buildManualColumnKey(colValues.slice(0, n)));
  }
  return keys;
}

/** Aggregate a record list into { measure -> { colKey: components } }. */
function aggregateByMeasure(records, colLevelFields) {
  const byMeasure = {};
  records.forEach((r) => {
    const cbm = byMeasure[r.measure] || (byMeasure[r.measure] = {});
    colKeysForRecord(r, colLevelFields).forEach((ck) => {
      cbm[ck] = addRecordComponents(cbm[ck] || emptyComponents(), r);
    });
  });
  return byMeasure;
}

/** Group records by a field, returning entries in stable alphabetical order. */
function groupByField(records, field) {
  const map = new Map();
  const order = [];
  records.forEach((r) => {
    const v = r[field] ?? "";
    if (!map.has(v)) {
      map.set(v, []);
      order.push(v);
    }
    map.get(v).push(r);
  });
  order.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return order.map((v) => ({ value: v, records: map.get(v) }));
}

/**
 * Build the nested tree for a secondary row axis (any row dimension after the
 * first). Each axis is INDEPENDENT: it hangs a collapsible "Total" root under
 * every node of the previous axis, and — if there is another axis after it —
 * nests that next axis under every one of its own nodes in turn. This is what
 * makes e.g. Time appear under every Product AND every Location level.
 *
 * @param records        records scoped to the parent node
 * @param secondaryGroups array of field-lists, one per secondary axis
 * @param groupIdx       index into `secondaryGroups` (0 = first secondary axis)
 * @param ancestorKey    full expand-key of the parent node (axes joined by
 *                        LOC_MARK), used to build unique per-row expand keys
 * @returns the single "Total" root node for this axis
 */
function buildAxisTree(
  records,
  secondaryGroups,
  groupIdx,
  colLevelFields,
  ancestorKey,
) {
  const fields = secondaryGroups[groupIdx];
  const axisIdx = groupIdx + 1; // axis 0 is the Product tree
  const hasNext = groupIdx + 1 < secondaryGroups.length;

  const makeNode = (recs, path, depth, value, children) => {
    const fullKey = `${ancestorKey}${LOC_MARK}${path}`;
    return {
      axisIdx,
      fullKey,
      depth,
      value,
      cellsByMeasure: aggregateByMeasure(recs, colLevelFields),
      children,
      // Chevron in this column reflects only same-axis children; the next axis
      // renders in its own column with its own always-visible Total.
      hasChildren: children.length > 0,
      childAxis: hasNext
        ? buildAxisTree(
            recs,
            secondaryGroups,
            groupIdx + 1,
            colLevelFields,
            fullKey,
          )
        : null,
    };
  };

  const buildLevels = (recs, levelIdx, parentPath) => {
    if (levelIdx >= fields.length) return [];
    const field = fields[levelIdx];
    return groupByField(recs, field).map(({ value, records: sub }) => {
      const path = parentPath
        ? `${parentPath}${PATH_SEP}${value}`
        : String(value);
      const children = buildLevels(sub, levelIdx + 1, path);
      return makeNode(sub, path, levelIdx + 1, value, children);
    });
  };

  // Total root (depth 0, empty path) aggregating all records for this axis.
  return makeNode(records, "", 0, "Total", buildLevels(records, 0, ""));
}

/**
 * Aggregate records into the manual-pivot structures.
 *
 * The FIRST row dimension (`axisFieldGroups[0]`) is a drillable tree shown in
 * the Product column. Every remaining row dimension becomes its own INDEPENDENT
 * axis (own column, own expand state), nested under every node of the axis
 * before it — so e.g. Time is available at every Product and Location level.
 *
 * @returns { colCombos, productTree, hasLocation, numAxes }
 */
export function buildManualPivotModel({
  filteredRecords,
  axisFieldGroups = [],
  colLevelFields,
}) {
  const productFields = axisFieldGroups[0] || [];
  const secondaryGroups = axisFieldGroups.slice(1);

  const colComboMap = new Map(); // colKey -> ordered col field values
  filteredRecords.forEach((r) => {
    const colValues = colLevelFields.map((f) => r[f]);
    const colKey = buildManualColumnKey(colValues);
    if (!colComboMap.has(colKey)) colComboMap.set(colKey, colValues);
  });

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

  const hasLocation = secondaryGroups.length > 0;

  const buildProduct = (records, levelIdx, parentPk) => {
    const field = productFields[levelIdx];
    return groupByField(records, field).map(({ value, records: sub }) => {
      const pk = parentPk ? `${parentPk}${PATH_SEP}${value}` : String(value);
      const children =
        levelIdx + 1 < productFields.length
          ? buildProduct(sub, levelIdx + 1, pk)
          : [];
      return {
        axisIdx: 0,
        fullKey: pk,
        depth: levelIdx,
        value,
        cellsByMeasure: aggregateByMeasure(sub, colLevelFields),
        children,
        hasChildren: children.length > 0,
        childAxis: hasLocation
          ? buildAxisTree(sub, secondaryGroups, 0, colLevelFields, pk)
          : null,
      };
    });
  };

  const productTree = productFields.length
    ? buildProduct(filteredRecords, 0, "")
    : [];

  return {
    colCombos,
    productTree,
    hasLocation,
    numAxes: axisFieldGroups.length,
  };
}

/**
 * Flatten the manual-pivot axis trees into visible rows given the expand state.
 * Each innermost node emits one row per inner combo (measure and/or metric).
 * Every row carries a `__axis` array — one entry per row dimension — so each
 * dimension renders in its own tree column with its own label/chevron/indent.
 * A node's label shows only on the first row that belongs to it (cell-merge).
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
  const { productTree } = manualPivot;
  const out = [];
  let nodeCounter = 0;
  const shown = new Set(); // fullKeys whose label has already been rendered

  const listFor = (dim) =>
    dim === "measures"
      ? orderedMeasures.map((v) => ({ kind: "measure", value: v }))
      : innerMetricKeys.map((v) => ({ kind: "metric", value: v }));

  const buildCombos = () => {
    if (rowInnerDims.length === 0) {
      return [{ grpFirst: true, grpLast: true }];
    }
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

  // Emit the inner (measure/metric) combo rows for one full axis chain. Values
  // come from the innermost node in the chain. On the first combo row, every
  // not-yet-shown axis node claims its label (cell-merge / row spanning).
  const emitCombos = (chain) => {
    const innermost = chain[chain.length - 1];
    const cellsByMeasure = innermost.cellsByMeasure || {};
    const alt = nodeCounter % 2 === 1;
    nodeCounter += 1;
    combos.forEach((combo, ci) => {
      const measure = combo.measure ?? orderedMeasures[0];
      const axis = chain.map((node) => ({
        label: node.value,
        depth: node.depth,
        hasChildren: node.hasChildren,
        expanded: expandedKeys.has(node.fullKey),
        pathKey: node.fullKey,
        show: ci === 0 && !shown.has(node.fullKey),
      }));
      if (ci === 0) chain.forEach((node) => shown.add(node.fullKey));
      out.push({
        id: `${chain.map((n) => n.fullKey).join("|")}${CELL_SEP}${
          combo.measure ?? ""
        }${CELL_SEP}${combo.metricKey ?? ""}`,
        __axis: axis,
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
  };

  // Walk one node: descend into its next axis (if any) to reach the innermost
  // row, then — if the node is expanded — descend into its own same-axis
  // children (which replace it in the same column at a deeper indent).
  const walkNode = (node, ancestors) => {
    const chain = [...ancestors, node];
    if (node.childAxis) {
      walkNode(node.childAxis, chain);
    } else {
      emitCombos(chain);
    }
    if (expandedKeys.has(node.fullKey) && node.children.length > 0) {
      node.children.forEach((child) => walkNode(child, ancestors));
    }
  };

  (productTree || []).forEach((prod) => walkNode(prod, []));
  return out;
}
