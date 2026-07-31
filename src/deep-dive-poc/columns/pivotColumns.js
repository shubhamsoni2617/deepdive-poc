/**
 * Column defs for the native AG Grid pivot path (measures/metrics NOT in rows).
 * Builds the hidden dimension grouping/pivot defs plus the value columns, and
 * the pivot-result post-processors that apply header labels + shading.
 */

import {
  DIMENSION_LABELS,
  LEVELS_BY_DIMENSION,
  selectedLevelsFor,
} from "../config/dimensions";
import {
  METRIC_LEVELS,
  formatMetricValue,
  sumComponents,
} from "../config/metrics";
import { formatNumber } from "../format/formatters";
import { getDimensionFields } from "../model/dimensionFields";
import { metricsIsOutermost } from "../model/arrangement";
import { isCellEditable } from "../model/edits";
import { formatMonthValue, formatPivotHeader } from "./headerFormat";
import {
  NUMERIC_CELL_CLASS,
  NUMERIC_HEADER_CLASS,
  shadeByValue,
} from "./shading";

// Numeric fields that only drive value columns, never grouping.
const measureValueFields = new Set(["mfp", "ly", "varLY"]);

// Per-metric column widths (view concern; keeps the original layout).
const METRIC_WIDTH = {
  slsU: 120,
  sls$: 130,
  cogs: 120,
  aur: 110,
  auc: 110,
  gm$: 120,
  "gm%": 100,
};

/** Component object from a raw record (unit of aggregation for value columns). */
const recordComponents = (r) => ({
  slsU: r.slsU || 0,
  sls$: r["sls$"] || 0,
  gm$: r.gm$ || 0,
  mfp: r.mfp || 0,
  ly: r.ly || 0,
  varLY: r.varLY || 0,
  _n: 1,
});

function metricsIsOutermostCol(arrangement) {
  return metricsIsOutermost(arrangement);
}

export function buildDimensionColDefs(arrangement, levels) {
  const defs = [];
  const seen = new Set();

  const processDim = (dim, isRow) => {
    if (dim === "metrics") {
      const metricsOutermost = !isRow && metricsIsOutermostCol(arrangement);
      if ((isRow || metricsOutermost) && !seen.has("metric")) {
        seen.add("metric");
        defs.push({
          field: "metric",
          headerName: "Metric",
          rowGroup: isRow,
          pivot: metricsOutermost,
          hide: true,
          enableRowGroup: true,
          enablePivot: true,
          suppressMovable: true,
        });
      }
      return;
    }

    if (dim === "measures") {
      if (!seen.has("measure")) {
        seen.add("measure");
        defs.push(
          isRow
            ? {
                field: "measure",
                headerName: "Measure",
                rowGroup: false,
                pivot: false,
                hide: false,
                pinned: "left",
                width: 140,
                suppressMovable: true,
                lockPosition: true,
              }
            : {
                field: "measure",
                headerName: "Measure",
                rowGroup: false,
                pivot: true,
                hide: true,
                enableRowGroup: true,
                enablePivot: true,
                suppressMovable: true,
              },
        );
      }
      return;
    }

    selectedLevelsFor(dim, levels).forEach((key) => {
      if (seen.has(key)) return;
      if (measureValueFields.has(key)) return;
      seen.add(key);

      const levelMeta = LEVELS_BY_DIMENSION[dim]?.find((l) => l.key === key);
      const def = {
        field: key,
        headerName: levelMeta?.label || key,
        rowGroup: isRow,
        pivot: !isRow,
        hide: true,
        enableRowGroup: true,
        enablePivot: true,
        suppressMovable: true,
      };
      if (key === "month") {
        def.valueFormatter = (params) => formatMonthValue(params.value);
      }
      defs.push(def);
    });
  };

  arrangement.rows.forEach((dim) => processDim(dim, true));
  arrangement.columns.forEach((dim) => processDim(dim, false));

  return defs;
}

export function buildColDefs(arrangement, levels) {
  const { rowFields, columnFields } = getDimensionFields(arrangement, levels);
  const dimCols = buildDimensionColDefs(arrangement, levels);

  const selectedMetrics = levels.metrics || [];
  const metricsInRows = arrangement.rows.includes("metrics");
  const metricsOutermostCol = metricsIsOutermostCol(arrangement);

  // Unpivoted single-value column: data has one row per metric, so a single
  // "Total" column formats each row against its own metricKey.
  if (metricsInRows || metricsOutermostCol) {
    const metricAggFunc = (params) => {
      let slsU = 0,
        sls$ = 0,
        gm$ = 0;
      let metricKey = null;
      (params.rowNode?.allLeafChildren || []).forEach((child) => {
        const d = child.data;
        if (!d) return;
        if (!metricKey) metricKey = d.metricKey;
        slsU += d._slsU || 0;
        sls$ += d._sls$ || 0;
        gm$ += d._gm$ || 0;
      });
      return { slsU, sls$, gm$, metricKey };
    };
    const metricValueFormatter = (params) => {
      const v = params.value;
      if (!v || typeof v !== "object") return "-";
      return formatMetricValue(v.metricKey, {
        slsU: v.slsU,
        sls$: v.sls$,
        gm$: v.gm$,
      });
    };
    return [
      ...dimCols,
      {
        colId: "metricValue",
        headerName: "Total",
        valueGetter: (params) => {
          const d = params.data;
          if (!d) return null;
          return {
            slsU: d._slsU,
            sls$: d._sls$,
            gm$: d._gm$,
            metricKey: d.metricKey,
          };
        },
        aggFunc: metricAggFunc,
        valueFormatter: metricValueFormatter,
        cellDataType: false,
        width: 130,
        cellClass: NUMERIC_CELL_CLASS,
        headerClass: NUMERIC_HEADER_CLASS,
      },
    ];
  }

  // One column per selected metric, in the canonical metric order. Every column
  // aggregates raw components and formats through the metric registry; the
  // editable metric stays a real numeric field so cell editing works.
  const valueCols = METRIC_LEVELS.filter((m) =>
    selectedMetrics.includes(m.key),
  ).map((m) => {
    const base = {
      colId: m.key,
      headerName: m.label,
      width: METRIC_WIDTH[m.key] || 120,
      cellClass: NUMERIC_CELL_CLASS,
      headerClass: NUMERIC_HEADER_CLASS,
    };
    if (m.key === "slsU") {
      return {
        ...base,
        field: "slsU",
        aggFunc: "sum",
        editable: (params) => isCellEditable(params, rowFields, columnFields),
        valueFormatter: (params) => formatNumber(params.value),
        cellDataType: "number",
      };
    }
    return {
      ...base,
      valueGetter: (params) =>
        params.data ? recordComponents(params.data) : null,
      aggFunc: (params) => sumComponents(params.values),
      valueFormatter: (params) => formatMetricValue(m.key, params.value),
      cellDataType: false,
    };
  });

  return [...dimCols, ...valueCols];
}

/** Apply alternating shading to a pivot value column based on its top key. */
export function processPivotResultColDef(colDef) {
  const pivotKeys = colDef.pivotKeys || [];
  if (pivotKeys.length === 0) return;
  const band = shadeByValue(pivotKeys[0]);
  colDef.cellClass = () => [NUMERIC_CELL_CLASS, band.cell];
  colDef.headerClass = [NUMERIC_HEADER_CLASS, band.header];
}

/** Label + shade a pivot column group. */
export function processPivotResultColGroupDef(colGroupDef) {
  const pivotKeys = colGroupDef.pivotKeys;
  if (!pivotKeys?.length) return;
  colGroupDef.headerName = formatPivotHeader(pivotKeys[pivotKeys.length - 1]);
  const band = shadeByValue(pivotKeys[0]);
  const isTopLevel = pivotKeys.length === 1;
  colGroupDef.headerClass = isTopLevel
    ? `${band.header} pvt-header-group-top`
    : band.header;
}
