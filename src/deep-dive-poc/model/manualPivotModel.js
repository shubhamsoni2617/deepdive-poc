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
  const keys = [];
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
 * Build the nested Location tree for a product node's records:
 * a synthetic "Total" root (aggregate over all locations) whose children are
 * the first location level (Channel), each drilling to the next (Store).
 */
function buildLocTree(records, locationFields, colLevelFields) {
  const build = (recs, levelIdx, parentLocPk) => {
    if (levelIdx >= locationFields.length) return [];
    const field = locationFields[levelIdx];
    return groupByField(recs, field).map(({ value, records: sub }) => ({
      locPathKey: parentLocPk
        ? `${parentLocPk}${PATH_SEP}${value}`
        : String(value),
      depth: levelIdx + 1,
      value,
      cellsByMeasure: aggregateByMeasure(sub, colLevelFields),
      children: build(
        sub,
        levelIdx + 1,
        parentLocPk ? `${parentLocPk}${PATH_SEP}${value}` : String(value),
      ),
    }));
  };
  return {
    locPathKey: "",
    depth: 0,
    value: "Total",
    cellsByMeasure: aggregateByMeasure(records, colLevelFields),
    children: build(records, 0, ""),
  };
}

/**
 * Aggregate records into the manual-pivot structures.
 *
 * The FIRST row dimension (`productFields`) is a drillable tree shown in the
 * Product column. All remaining row dimensions (`locationFields`) form an
 * independent Location tree nested under EVERY product node: a collapsible
 * "Total" that expands to the first location level, then the next, etc.
 *
 * @returns { colCombos, productTree, hasLocation }
 */
export function buildManualPivotModel({
  filteredRecords,
  productFields = [],
  locationFields = [],
  colLevelFields,
}) {
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

  const hasLocation = locationFields.length > 0;

  const buildProduct = (records, levelIdx, parentPk) => {
    const field = productFields[levelIdx];
    return groupByField(records, field).map(({ value, records: sub }) => {
      const pk = parentPk ? `${parentPk}${PATH_SEP}${value}` : String(value);
      return {
        pathKey: pk,
        depth: levelIdx,
        value,
        cellsByMeasure: aggregateByMeasure(sub, colLevelFields),
        locTree: hasLocation
          ? buildLocTree(sub, locationFields, colLevelFields)
          : null,
        children:
          levelIdx + 1 < productFields.length
            ? buildProduct(sub, levelIdx + 1, pk)
            : [],
      };
    });
  };

  const productTree = productFields.length
    ? buildProduct(filteredRecords, 0, "")
    : [];

  return { colCombos, productTree, hasLocation };
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
  const { productTree, hasLocation } = manualPivot;
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

  // Emit the inner (measure/metric) combo rows for one node, given the product
  // + location context. `prodShow` marks the single row that carries the
  // Product label/chevron; `locShow` (ci===0) carries the Location label.
  const emitCombos = ({ prod, loc, prodShow }) => {
    const cellsByMeasure = (loc || prod).cellsByMeasure || {};
    const alt = nodeCounter % 2 === 1;
    nodeCounter += 1;
    combos.forEach((combo, ci) => {
      const measure = combo.measure ?? orderedMeasures[0];
      out.push({
        id: `${prod.pathKey}${LOC_MARK}${loc ? loc.locPathKey : ""}${CELL_SEP}${
          combo.measure ?? ""
        }${CELL_SEP}${combo.metricKey ?? ""}`,
        // Product column context
        __prodPathKey: prod.pathKey,
        __prodDepth: prod.depth,
        __prodLabel: prod.value,
        __prodHasChildren: prod.children.length > 0,
        __prodExpanded: expandedKeys.has(prod.pathKey),
        __prodShow: prodShow && ci === 0,
        // Location column context
        __hasLocation: hasLocation,
        __locPathKey: loc ? `${prod.pathKey}${LOC_MARK}${loc.locPathKey}` : "",
        __locDepth: loc ? loc.depth : 0,
        __locLabel: loc ? loc.value : "",
        __locHasChildren: loc ? loc.children.length > 0 : false,
        __locExpanded: loc
          ? expandedKeys.has(`${prod.pathKey}${LOC_MARK}${loc.locPathKey}`)
          : false,
        __locShow: ci === 0,
        // Inner measure/metric row context
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

  const walkProduct = (nodes) => {
    (nodes || []).forEach((prod) => {
      if (prod.locTree) {
        // The location "Total" root's first row also carries the Product label.
        let firstOfProduct = true;
        const walkLoc = (locNode) => {
          emitCombos({ prod, loc: locNode, prodShow: firstOfProduct });
          firstOfProduct = false;
          const locKey = `${prod.pathKey}${LOC_MARK}${locNode.locPathKey}`;
          if (expandedKeys.has(locKey)) locNode.children.forEach(walkLoc);
        };
        walkLoc(prod.locTree);
      } else {
        emitCombos({ prod, loc: null, prodShow: true });
      }
      if (expandedKeys.has(prod.pathKey) && prod.children.length > 0) {
        walkProduct(prod.children);
      }
    });
  };

  walkProduct(productTree);
  return out;
}
