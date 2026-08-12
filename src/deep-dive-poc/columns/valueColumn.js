/**
 * Value-column factory for the manual pivot.
 *
 * Every numeric leaf column in the grid — regardless of which value dimension
 * (measure/metric) is inner/outer or in rows/columns — is the same shape:
 * read a component object off the row, format it through the metric registry,
 * and carry the standard numeric cell/header classes. This module is the single
 * source of truth for that shape (DRY / SRP), so the builders in
 * `manualColumns.js` only describe WHICH value each column reads, not HOW a
 * value column is assembled.
 */

import { formatMetricValue } from "../config/metrics";
import { NUMERIC_CELL_CLASS, NUMERIC_HEADER_CLASS } from "./shading";

/** Normalise a colDef `class` field (string | string[] | undefined) to array. */
export const toClassArray = (c) => (Array.isArray(c) ? c : c ? [c] : []);

/**
 * Component-object readers for the two storage shapes a row can carry.
 * Each returns `(params) => componentObject | null`.
 */
// Value keyed only by the column combo (metric fixed at build time).
export const readCells = (key) => (p) => p.data.__cells[key];

// Value keyed by an explicit measure then the column combo.
export const readByMeasure = (measure, key) => (p) => {
  const bm = p.data.__cellsByMeasure?.[measure];
  return bm ? bm[key] : null;
};

// Value keyed by the ROW's own measure (used when measure is a row dimension).
export const readByRowMeasure = (key) => (p) => {
  const bm = p.data.__cellsByMeasure?.[p.data.measure];
  return bm ? bm[key] : null;
};

/**
 * Build a numeric value (leaf) column.
 *
 * @param {object}   o
 * @param {string}   o.colId
 * @param {string}   [o.headerName]
 * @param {string}   o.gCls        group (header) shading class
 * @param {string}   o.cCls        cell shading class
 * @param {string}   [o.groupShow] AG Grid columnGroupShow ("open"|"closed")
 * @param {function} o.read        row -> component object (see readers above)
 * @param {string}   [o.metricKey] fixed metric for formatting; when null the
 *                                 row's own `metricKey` is used.
 */
export const makeValueCol = ({
  colId,
  headerName = "",
  gCls,
  cCls,
  groupShow,
  read,
  metricKey = null,
}) => {
  const col = {
    colId,
    headerName,
    valueGetter: (p) => (p.data ? read(p) || null : null),
    valueFormatter: (p) =>
      p.value ? formatMetricValue(metricKey ?? p.data?.metricKey, p.value) : "",
    cellDataType: false,
    width: 100,
    cellClass: [NUMERIC_CELL_CLASS, cCls],
    headerClass: [NUMERIC_HEADER_CLASS, gCls],
  };
  if (groupShow) col.columnGroupShow = groupShow;
  return col;
};
