import { LEVELS_BY_DIMENSION, MEASURE_LEVELS, METRICS } from "./constants";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  getDimensionFields,
  isCellEditable,
} from "./pivotEngine";
import ProductTreeCell from "./ProductTreeCell";

const DIMENSION_LABELS = {
  product: "Product",
  store: "Location",
  time: "Time",
  measures: "Measure",
  metrics: "Metrics",
};

const LEVEL_LABEL = {};
Object.values(LEVELS_BY_DIMENSION).forEach((levels) => {
  levels.forEach((l) => {
    LEVEL_LABEL[l.key] = l.label;
  });
});

// Builds a stable key from an ordered list of column-dimension values.
export function buildManualColumnKey(values) {
  return values.join("||");
}

// Sums component objects (used as aggFunc for manual value columns).
// AG Grid passes a params object whose `values` is the array of child values.
function sumComponents(params) {
  const acc = { slsU: 0, sls$: 0, gm$: 0, mfp: 0, ly: 0, varLY: 0, _n: 0 };
  (params?.values || []).forEach((v) => {
    if (v && typeof v === "object") {
      acc.slsU += v.slsU || 0;
      acc["sls$"] += v["sls$"] || 0;
      acc.gm$ += v.gm$ || 0;
      acc.mfp += v.mfp || 0;
      acc.ly += v.ly || 0;
      acc.varLY += v.varLY || 0;
      acc._n += v._n || 0;
    }
  });
  return acc;
}

// Metric definitions for the manual pivot. Each computes a display value from
// an aggregated component object produced by sumComponents.
const MANUAL_METRICS = [
  { key: "slsU", label: "Sls U", fmt: (c) => formatNumber(c.slsU) },
  {
    key: "sls$",
    label: "Sls $",
    fmt: (c) => formatCurrency(c["sls$"]),
  },
  {
    key: "cogs",
    label: "COGS",
    fmt: (c) => formatCurrency((c["sls$"] || 0) - (c.gm$ || 0)),
  },
  {
    key: "aur",
    label: "AUR",
    fmt: (c) => (c.slsU ? formatCurrency(c["sls$"] / c.slsU) : "-"),
  },
  {
    key: "auc",
    label: "AUC",
    fmt: (c) => (c.slsU ? formatCurrency((c["sls$"] - c.gm$) / c.slsU) : "-"),
  },
  { key: "gm$", label: "GM $", fmt: (c) => formatCurrency(c.gm$) },
  {
    key: "gm%",
    label: "GM %",
    fmt: (c) => (c["sls$"] ? formatPercent((c.gm$ / c["sls$"]) * 100) : "-"),
  },
  { key: "mfp", label: "MFP", fmt: (c) => formatNumber(c.mfp) },
  { key: "ly", label: "LY", fmt: (c) => formatNumber(c.ly) },
  {
    key: "varLY",
    label: "Var LY(%)",
    fmt: (c) => (c._n ? formatPercent(c.varLY / c._n) : "-"),
  },
];

const varianceAggFunc = (params) => {
  let current = 0;
  let ly = 0;
  let measure = null;
  (params.values || []).forEach((v) => {
    if (v && typeof v === "object") {
      current += v.current || 0;
      ly += v.ly || 0;
      if (measure == null) measure = v.measure;
    }
  });
  return { current, ly, measure };
};

const varianceValueFormatter = (params) => {
  const { current, ly, measure } = params.value || {};
  if (measure !== "WCF" || !ly) return "-";
  return formatPercent(((current - ly) / ly) * 100);
};

const weightedDollarAggFunc = (params) => {
  let slsU = 0;
  let sls$ = 0;
  (params.values || []).forEach((v) => {
    if (v && typeof v === "object") {
      slsU += v.slsU || 0;
      sls$ += v.sls$ || 0;
    }
  });
  return { slsU, sls$ };
};

const aurValueFormatter = (params) => {
  const { slsU, sls$ } = params.value || {};
  if (!slsU) return "-";
  return formatCurrency(sls$ / slsU);
};

const aucAggFunc = (params) => {
  let slsU = 0;
  let sls$ = 0;
  let gm$ = 0;
  (params.values || []).forEach((v) => {
    if (v && typeof v === "object") {
      slsU += v.slsU || 0;
      sls$ += v.sls$ || 0;
      gm$ += v.gm$ || 0;
    }
  });
  return { slsU, sls$, gm$ };
};

const aucValueFormatter = (params) => {
  const { slsU, sls$, gm$ } = params.value || {};
  if (!slsU) return "-";
  return formatCurrency((sls$ - gm$) / slsU);
};

const gmPctAggFunc = (params) => {
  let sls$ = 0;
  let gm$ = 0;
  (params.values || []).forEach((v) => {
    if (v && typeof v === "object") {
      sls$ += v.sls$ || 0;
      gm$ += v.gm$ || 0;
    }
  });
  return { sls$, gm$ };
};

const gmPctValueFormatter = (params) => {
  const { sls$, gm$ } = params.value || {};
  if (!sls$) return "-";
  return formatPercent((gm$ / sls$) * 100);
};

function formatWeekHeader(value) {
  if (typeof value === "string") {
    const match = value.match(/^W(\d+):\s*(.+)$/);
    if (match) return `W${parseInt(match[1], 10)}: ${match[2].trim()}`;
  }
  return value;
}

function formatMonthValue(value) {
  if (typeof value === "string" && value.includes("-")) {
    return value.split("-")[1];
  }
  return value;
}

function formatPivotHeader(value) {
  // Only shorten month-style values ("2025-01" -> "01"). Other hyphenated
  // values such as store ids ("CA-01") must be shown verbatim.
  if (typeof value === "string" && /^\d{4}-\d{2}/.test(value)) {
    return value.split("-")[1];
  }
  return value;
}

// Numeric measure fields that should only control value columns, not be used for grouping
const measureValueFields = new Set(["mfp", "ly", "varLY"]);

export function buildDimensionColDefs(arrangement, levels) {
  const defs = [];
  const seen = new Set();

  // Process rows first, then columns — but process columns in priority order.
  // The order that pivot:true defs appear determines the ag-Grid pivot grouping hierarchy
  // (first pivot def = outermost group).
  const rowDims = arrangement.rows;
  const colDims = arrangement.columns; // already in priority order (index 0 = highest)

  const processDim = (dim, isRow) => {
    const selected = levels[dim] || LEVELS_BY_DIMENSION[dim].map((l) => l.key);

    // For metrics dimension: when in rows, data is unpivoted so use 'metric' field for row grouping.
    // When in columns with highest priority (outermost), data is also unpivoted and 'metric' becomes a pivot field.
    // When in columns but NOT outermost, value columns handle metrics directly (no grouping field needed).
    if (dim === "metrics") {
      const metricsOutermost = !isRow && metricsIsOutermost(arrangement);
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

    // For measures dimension:
    // When in rows, show as a visible flat column (not grouped) per Figma design.
    // When in columns, use as a pivot field.
    if (dim === "measures") {
      if (!seen.has("measure")) {
        seen.add("measure");
        if (isRow) {
          defs.push({
            field: "measure",
            headerName: "Measure",
            rowGroup: false,
            pivot: false,
            hide: false,
            pinned: "left",
            width: 140,
            suppressMovable: true,
            lockPosition: true,
          });
        } else {
          defs.push({
            field: "measure",
            headerName: "Measure",
            rowGroup: false,
            pivot: true,
            hide: true,
            enableRowGroup: true,
            enablePivot: true,
            suppressMovable: true,
          });
        }
      }
      return;
    }

    selected.forEach((key) => {
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

  // Process row dimensions first (order within rows determines row grouping priority)
  rowDims.forEach((dim) => processDim(dim, true));

  // Process column dimensions in priority order (first = outermost pivot group)
  colDims.forEach((dim) => processDim(dim, false));

  return defs;
}

const numericCellClass = "ag-right-aligned-cell";
const numericHeaderClass = "ag-right-aligned-header";

export function buildColDefs(arrangement, levels, visibleMetrics) {
  const { rowFields, columnFields } = getDimensionFields(arrangement, levels);
  const dimCols = buildDimensionColDefs(arrangement, levels);

  // Measure selections control row filtering (in useDeepDivePivot).
  // Value columns are driven solely by selected metrics (pivot is source of truth).
  const selectedMetrics = levels.metrics || [];
  const metricsInRows = arrangement.rows.includes("metrics");
  const metricsOutermostCol = metricsIsOutermost(arrangement);

  // When metrics is in rows OR metrics is outermost in columns,
  // data is unpivoted — use single value column with custom agg
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
      const { slsU, sls$, gm$, metricKey } = v;
      switch (metricKey) {
        case "slsU":
          return formatNumber(slsU);
        case "sls$":
          return formatCurrency(sls$);
        case "cogs":
          return formatCurrency(sls$ - gm$);
        case "aur":
          return slsU ? formatCurrency(sls$ / slsU) : "-";
        case "auc":
          return slsU ? formatCurrency((sls$ - gm$) / slsU) : "-";
        case "gm$":
          return formatCurrency(gm$);
        case "gm%":
          return sls$ ? formatPercent((gm$ / sls$) * 100) : "-";
        default:
          return "-";
      }
    };
    const valueCols = [
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
        cellClass: numericCellClass,
        headerClass: numericHeaderClass,
      },
    ];
    return [...dimCols, ...valueCols];
  }

  // Only selected metrics determine which value columns appear
  let effectiveMetrics = [...selectedMetrics];

  const valueCols = [
    {
      colId: "slsU",
      field: "slsU",
      headerName: METRICS.find((m) => m.key === "slsU")?.label || "Units",
      aggFunc: "sum",
      editable: (params) => isCellEditable(params, rowFields, columnFields),
      valueFormatter: (params) => formatNumber(params.value),
      cellDataType: "number",
      width: 120,
      cellClass: numericCellClass,
      headerClass: numericHeaderClass,
    },
    {
      colId: "varLYPct",
      headerName: "Var LY %",
      valueGetter: (params) => {
        const d = params.data;
        if (!d) return null;
        return { current: d.slsU, ly: d.ly_slsU, measure: d.measure };
      },
      aggFunc: varianceAggFunc,
      valueFormatter: varianceValueFormatter,
      cellDataType: false,
      width: 110,
      cellClass: numericCellClass,
      headerClass: numericHeaderClass,
    },
    {
      colId: "sls$",
      field: "sls$",
      headerName: METRICS.find((m) => m.key === "sls$")?.label || "Sls $",
      aggFunc: "sum",
      valueFormatter: (params) => formatCurrency(params.value),
      cellDataType: "number",
      width: 130,
      cellClass: numericCellClass,
      headerClass: numericHeaderClass,
    },
    {
      colId: "cogs",
      headerName: METRICS.find((m) => m.key === "cogs")?.label || "COGS",
      valueGetter: (params) => {
        const d = params.data;
        if (!d) return null;
        return { sls$: d["sls$"], gm$: d["gm$"] };
      },
      aggFunc: gmPctAggFunc,
      valueFormatter: (params) => {
        const { sls$, gm$ } = params.value || {};
        if (sls$ == null) return "-";
        return formatCurrency((sls$ || 0) - (gm$ || 0));
      },
      cellDataType: false,
      width: 120,
      cellClass: numericCellClass,
      headerClass: numericHeaderClass,
    },
    {
      colId: "aur",
      headerName: "AUR",
      valueGetter: (params) => {
        const d = params.data;
        if (!d) return null;
        return { slsU: d.slsU, sls$: d["sls$"] };
      },
      aggFunc: weightedDollarAggFunc,
      valueFormatter: aurValueFormatter,
      cellDataType: false,
      width: 110,
      cellClass: numericCellClass,
      headerClass: numericHeaderClass,
    },
    {
      colId: "auc",
      headerName: "AUC",
      valueGetter: (params) => {
        const d = params.data;
        if (!d) return null;
        return { slsU: d.slsU, sls$: d["sls$"], gm$: d["gm$"] };
      },
      aggFunc: aucAggFunc,
      valueFormatter: aucValueFormatter,
      cellDataType: false,
      width: 110,
      cellClass: numericCellClass,
      headerClass: numericHeaderClass,
    },
    {
      colId: "gm$",
      field: "gm$",
      headerName: METRICS.find((m) => m.key === "gm$")?.label || "GM $",
      aggFunc: "sum",
      valueFormatter: (params) => formatCurrency(params.value),
      cellDataType: "number",
      width: 120,
      cellClass: numericCellClass,
      headerClass: numericHeaderClass,
    },
    {
      colId: "gm%",
      headerName: METRICS.find((m) => m.key === "gm%")?.label || "GM %",
      valueGetter: (params) => {
        const d = params.data;
        if (!d) return null;
        return { sls$: d["sls$"], gm$: d["gm$"] };
      },
      aggFunc: gmPctAggFunc,
      valueFormatter: gmPctValueFormatter,
      cellDataType: false,
      width: 100,
      cellClass: numericCellClass,
      headerClass: numericHeaderClass,
    },
    {
      colId: "mfp",
      field: "mfp",
      headerName: "MFP",
      aggFunc: "sum",
      valueFormatter: (params) => formatNumber(params.value),
      cellDataType: "number",
      width: 120,
      cellClass: numericCellClass,
      headerClass: numericHeaderClass,
    },
    {
      colId: "ly",
      field: "ly",
      headerName: "LY",
      aggFunc: "sum",
      valueFormatter: (params) => formatNumber(params.value),
      cellDataType: "number",
      width: 120,
      cellClass: numericCellClass,
      headerClass: numericHeaderClass,
    },
    {
      colId: "varLY",
      field: "varLY",
      headerName: "Var LY(%)",
      aggFunc: "avg",
      valueFormatter: (params) => formatPercent(params.value),
      cellDataType: "number",
      width: 120,
      cellClass: numericCellClass,
      headerClass: numericHeaderClass,
    },
  ].filter((col) => effectiveMetrics.includes(col.colId));
  return [...dimCols, ...valueCols];
}

/**
 * Determine if metrics has higher column priority than other pivot dimensions.
 * When true, data is unpivoted and 'metric' becomes a pivot field so that
 * metrics form the outermost column groups.
 */
export function metricsIsOutermost(arrangement) {
  const cols = arrangement.columns || [];
  const metricsIdx = cols.indexOf("metrics");
  if (metricsIdx === -1) return false;
  // Metrics is outermost if it appears before any other non-metrics column dimension
  const otherPivotDims = cols.filter((d) => d !== "metrics");
  return (
    otherPivotDims.length > 0 && metricsIdx < cols.indexOf(otherPivotDims[0])
  );
}

function formatColValue(field, value) {
  if (field === "week") return formatWeekHeader(value);
  if (field === "month") return formatMonthValue(value);
  return value;
}

/**
 * Manual pivot column defs (used when measures is in rows).
 * pivotMode is OFF so custom group columns work: one tree column for
 * product/store + a dedicated Measure column + manually-built value columns.
 */
export function buildManualColDefs({
  arrangement,
  levels,
  manualPivot,
  colLevelFields,
}) {
  const rowDims = arrangement.rows.filter(
    (d) => d !== "measures" && d !== "metrics",
  );
  // No real row dimensions (only Measure/Metric in rows) => no tree column.
  const hasRowDims = rowDims.length > 0;
  const mainHeader = rowDims.map((d) => DIMENSION_LABELS[d] || d).join(" - ");

  // Inner (innermost row) dimension: metrics takes over only when measures is
  // not also in rows. When metrics is inner, the value columns are the selected
  // measures; otherwise the value columns are the selected metrics.
  const measuresInRows = arrangement.rows.includes("measures");
  const metricsInRows = arrangement.rows.includes("metrics");
  const innerIsMetric = metricsInRows && !measuresInRows;
  // Both measures AND metrics in rows: two pinned columns (order follows the
  // row arrangement); each grid row is a single (measure, metric) combination.
  const bothInner = measuresInRows && metricsInRows;
  const innerDimOrder = arrangement.rows.filter(
    (d) => d === "measures" || d === "metrics",
  );

  // Selected measures as { dataValue, label } (dataValue matches r.measure).
  const MEASURE_KEY_TO_ROW = { slsU: "WCF", mfp: "MFP", ly: "LY" };
  const measureCols = (
    levels.measures && levels.measures.length
      ? levels.measures
      : ["slsU", "mfp"]
  )
    .map((k) => ({
      dataValue: MEASURE_KEY_TO_ROW[k],
      label: MEASURE_LEVELS.find((m) => m.key === k)?.label || k,
    }))
    .filter((m) => m.dataValue);

  // Product/Location tree column. Flat rows carry __pathKey; cell spanning
  // merges the measure rows of each dimension node so the label shows once.
  const treeCol = {
    colId: "ddGroupTree",
    headerName: mainHeader,
    pinned: "left",
    minWidth: 240,
    suppressMovable: true,
    cellRenderer: ProductTreeCell,
    // Fake merge: the label/chevron render only on the first measure row of a
    // node; classes hide the internal dividers so it reads as one merged cell.
    cellClassRules: {
      // Reactive markers (cellClassRules always apply). Used by CSS :has() on
      // the row to strip the row-separator borders and merge a node's rows.
      "dd-tnl": (p) => p.data && p.data.__isLast === false, // not last
      "dd-tnf": (p) => p.data && p.data.__isFirst === false, // not first
      "dd-nodestart": (p) => p.data && p.data.__isFirst === true, // node start
    },
    cellClass: "dd-tree-col",
  };

  const measureLabelOf = (p) => (p.data ? p.data.measure || "" : "");
  const metricLabelOf = (p) =>
    p.data
      ? MANUAL_METRICS.find((m) => m.key === p.data.metricKey)?.label ||
        p.data.metricKey ||
        ""
      : "";

  // Build a pinned inner column (Measure or Metric). When `outer` is true (the
  // first of the two both-inner columns), the label renders only on the first
  // row of each outer group and the cell merges across the group's inner rows.
  const makeInnerCol = (kind, outer) => ({
    colId: kind === "measure" ? "ddMeasure" : "ddMetric",
    headerName: kind === "measure" ? "Measure" : "Metric",
    valueGetter: (p) => {
      if (!p.data) return "";
      if (outer && !p.data.__grpFirst) return "";
      return kind === "measure" ? measureLabelOf(p) : metricLabelOf(p);
    },
    pinned: "left",
    width: 140,
    minWidth: 110,
    suppressMovable: true,
    cellClass: outer ? "dd-outer-cell" : "dd-measure-cell",
    ...(outer
      ? {
          cellClassRules: {
            // Separator only at outer-group boundaries (not every inner row).
            "dd-grplast": (p) =>
              p.data && p.data.__grpLast && p.data.__isLast === false,
          },
        }
      : {}),
  });

  // Dedicated inner column(s). Both in rows => two columns in arrangement order.
  const innerCols = bothInner
    ? [
        makeInnerCol(
          innerDimOrder[0] === "measures" ? "measure" : "metric",
          true,
        ),
        makeInnerCol(
          innerDimOrder[1] === "measures" ? "measure" : "metric",
          false,
        ),
      ]
    : [makeInnerCol(innerIsMetric ? "metric" : "measure", false)];

  // Which metrics to show as value columns (selected metrics dimension).
  const selectedMetrics =
    levels.metrics && levels.metrics.length ? levels.metrics : ["slsU"];

  const colCombos = manualPivot?.colCombos || [];

  // Build the leaf value columns for a single column combo.
  //  • Measure inner (default): one column per selected metric; the value is
  //    that metric computed from the row's measure components.
  //  • Metric inner: one column per selected measure; the value is the row's
  //    metric computed from that measure's components.
  // When groupShow ('open' | 'closed') is provided the columns participate in
  // the parent group's expand/collapse (a 'closed' set is the rolled-up summary).
  const buildMetricChildren = (combo, cellGrpClass, grpClass, groupShow) => {
    if (bothInner) {
      // Both measure & metric are rows => a single value per column combo,
      // computed from the row's own measure + metric.
      const col = {
        colId: `${combo.key}__val${groupShow ? `__${groupShow}` : ""}`,
        headerName: colLevelFields.length === 0 ? "Value" : "",
        valueGetter: (p) => {
          if (!p.data) return null;
          const byMeasure = p.data.__cellsByMeasure?.[p.data.measure];
          return byMeasure ? byMeasure[combo.key] || null : null;
        },
        valueFormatter: (p) => {
          if (!p.value) return "";
          const meta = MANUAL_METRICS.find((m) => m.key === p.data?.metricKey);
          return meta ? meta.fmt(p.value) : "";
        },
        cellDataType: false,
        width: 120,
        cellClass: ["ag-right-aligned-cell", cellGrpClass],
        headerClass: ["ag-right-aligned-header", grpClass],
      };
      if (groupShow) col.columnGroupShow = groupShow;
      return [col];
    }
    if (innerIsMetric) {
      return measureCols.map((mc) => {
        const col = {
          colId: `${combo.key}__meas_${mc.dataValue}${
            groupShow ? `__${groupShow}` : ""
          }`,
          headerName: mc.label,
          valueGetter: (p) => {
            if (!p.data) return null;
            const byMeasure = p.data.__cellsByMeasure?.[mc.dataValue];
            return byMeasure ? byMeasure[combo.key] || null : null;
          },
          valueFormatter: (p) => {
            if (!p.value) return "";
            const meta = MANUAL_METRICS.find(
              (m) => m.key === p.data?.metricKey,
            );
            return meta ? meta.fmt(p.value) : "";
          },
          cellDataType: false,
          width: 120,
          cellClass: ["ag-right-aligned-cell", cellGrpClass],
          headerClass: ["ag-right-aligned-header", grpClass],
        };
        if (groupShow) col.columnGroupShow = groupShow;
        return col;
      });
    }
    return selectedMetrics.map((mk) => {
      const meta = MANUAL_METRICS.find((m) => m.key === mk);
      // Units metric (WCF) renders as an editable-style white input box.
      const isInput = mk === "slsU";
      const col = {
        colId: `${combo.key}__${mk}${groupShow ? `__${groupShow}` : ""}`,
        headerName: meta?.label || mk,
        valueGetter: (p) => (p.data ? p.data.__cells[combo.key] || null : null),
        valueFormatter: (p) => (p.value && meta ? meta.fmt(p.value) : ""),
        cellDataType: false,
        width: 120,
        cellClass: [
          "ag-right-aligned-cell",
          cellGrpClass,
          ...(isInput ? ["dd-input-cell"] : []),
        ],
        headerClass: ["ag-right-aligned-header", grpClass],
      };
      if (groupShow) col.columnGroupShow = groupShow;
      return col;
    });
  };

  // Recursively build nested column groups from the ordered column-dimension
  // levels so each level nests below the previous (e.g. Time > Location).
  // Non-leaf groups are expandable/collapsible: when collapsed they show a
  // rolled-up summary (columnGroupShow 'closed'); when expanded they reveal the
  // nested child groups (columnGroupShow 'open'). Alternating shading is driven
  // by the outermost (level 0) value.
  const buildColGroups = (
    combos,
    level,
    grpClass,
    cellGrpClass,
    leafBuilder = buildMetricChildren,
    shadeLevel0 = true,
  ) => {
    // Group the combos by their value at this level, preserving order.
    const order = [];
    const byValue = new Map();
    combos.forEach((combo) => {
      const v = combo.values[level];
      if (!byValue.has(v)) {
        byValue.set(v, []);
        order.push(v);
      }
      byValue.get(v).push(combo);
    });

    const isLast = level === colLevelFields.length - 1;

    return order.map((v) => {
      const childCombos = byValue.get(v);
      const headerName = formatColValue(colLevelFields[level], v);

      // Determine alternating shading from the outermost level value — unless
      // an outer grouping (e.g. metrics) already set the shading, in which case
      // this level inherits the classes passed down.
      let gClass = grpClass;
      let cClass = cellGrpClass;
      if (level === 0 && shadeLevel0) {
        const hash = [...String(v)].reduce((a, c) => a + c.charCodeAt(0), 0);
        const isOdd = hash % 2 === 1;
        gClass = isOdd ? "pvt-header-group-b" : "pvt-header-group-a";
        cClass = isOdd ? "pvt-col-group-b" : "pvt-col-group-a";
      }

      const headerClass =
        level === 0 && shadeLevel0
          ? [gClass, "pvt-header-group-top"]
          : [gClass];

      if (isLast) {
        const leafChildren = leafBuilder(childCombos[0], cClass, gClass);
        // Single unlabeled value column per group (e.g. only Time in columns
        // with both Measure & Metric in rows): flatten so the group label sits
        // on the leaf column itself. Otherwise AG Grid renders a redundant,
        // empty second header row below the week labels.
        if (leafChildren.length === 1 && !leafChildren[0].headerName) {
          const leaf = leafChildren[0];
          const leafHeaderClass = Array.isArray(leaf.headerClass)
            ? leaf.headerClass
            : leaf.headerClass
              ? [leaf.headerClass]
              : [];
          return {
            ...leaf,
            headerName,
            headerClass: [...leafHeaderClass, ...headerClass],
          };
        }
        return {
          headerName,
          groupId: childCombos[0].key,
          headerClass,
          children: leafChildren,
        };
      }

      // Non-leaf: collapsible. Summary (rolled-up) columns for the collapsed
      // state + nested child groups for the expanded state.
      const prefixKey = buildManualColumnKey(
        childCombos[0].values.slice(0, level + 1),
      );
      const summaryChildren = leafBuilder(
        { key: prefixKey },
        cClass,
        gClass,
        "closed",
      );
      const nested = buildColGroups(
        childCombos,
        level + 1,
        gClass,
        cClass,
        leafBuilder,
        false,
      ).map((g) => ({ ...g, columnGroupShow: "open" }));

      return {
        headerName,
        groupId: `grp__${level}__${v}`,
        headerClass,
        openByDefault: false,
        children: [...summaryChildren, ...nested],
      };
    });
  };

  // Build the single leaf value column for a fixed metric + column combo (used
  // when metrics is the outermost column group so the metric label sits on top
  // and the other column levels — e.g. Time — nest inside it).
  const buildSingleMetricLeaf = (
    mk,
    combo,
    cellGrpClass,
    grpClass,
    groupShow,
  ) => {
    const meta = MANUAL_METRICS.find((m) => m.key === mk);
    const isInput = mk === "slsU";
    const col = {
      colId: `${combo.key}__${mk}${groupShow ? `__${groupShow}` : ""}`,
      headerName: "",
      valueGetter: (p) => (p.data ? p.data.__cells[combo.key] || null : null),
      valueFormatter: (p) => (p.value && meta ? meta.fmt(p.value) : ""),
      cellDataType: false,
      width: 120,
      cellClass: [
        "ag-right-aligned-cell",
        cellGrpClass,
        ...(isInput ? ["dd-input-cell"] : []),
      ],
      headerClass: ["ag-right-aligned-header", grpClass],
    };
    if (groupShow) col.columnGroupShow = groupShow;
    return col;
  };

  // Metrics is the highest-priority column dimension AND there are other column
  // levels to nest under it (e.g. Time). The default builders make metrics the
  // innermost leaf; here we invert so each selected metric forms an outer group.
  const metricsOuter =
    arrangement.columns.includes("metrics") &&
    metricsIsOutermost(arrangement) &&
    !bothInner &&
    !innerIsMetric &&
    colLevelFields.length > 0;

  let valueGroups;
  if (colLevelFields.length === 0) {
    // No column dimensions (only metrics in columns): show the metric value
    // columns directly, with no wrapping "Total" group header.
    const combo = colCombos[0] || { key: "", values: [] };
    valueGroups = buildMetricChildren(
      combo,
      "pvt-col-group-a",
      "pvt-header-group-a",
    );
  } else if (metricsOuter) {
    valueGroups = selectedMetrics.map((mk, i) => {
      const meta = MANUAL_METRICS.find((m) => m.key === mk);
      const isOdd = i % 2 === 1;
      const gClass = isOdd ? "pvt-header-group-b" : "pvt-header-group-a";
      const cClass = isOdd ? "pvt-col-group-b" : "pvt-col-group-a";
      const leafBuilder = (combo, cGrp, gGrp, groupShow) => [
        buildSingleMetricLeaf(mk, combo, cGrp, gGrp, groupShow),
      ];
      return {
        headerName: meta?.label || mk,
        groupId: `metric__${mk}`,
        headerClass: [gClass, "pvt-header-group-top"],
        children: buildColGroups(
          colCombos,
          0,
          gClass,
          cClass,
          leafBuilder,
          false,
        ),
      };
    });
  } else {
    valueGroups = buildColGroups(colCombos, 0);
  }

  return hasRowDims
    ? [treeCol, ...innerCols, ...valueGroups]
    : [...innerCols, ...valueGroups];
}

export function buildGridOptions({
  arrangement,
  levels,
  compact,
  visibleMetrics,
  manualPivot,
  colLevelFields,
  onCellValueChanged,
  onGridReady,
  onToggleManualExpand,
}) {
  const measuresInRows = arrangement.rows.includes("measures");
  const metricsInRowsManual =
    arrangement.rows.includes("metrics") && !measuresInRows;

  // Manual pivot path: measures OR metrics in rows. Flat rows + cell spanning
  // so the dimension label merges across its inner rows (dimension groups
  // first, measure/metric innermost). Expand/collapse handled manually.
  if ((measuresInRows || metricsInRowsManual) && manualPivot) {
    return {
      columnDefs: buildManualColDefs({
        arrangement,
        levels,
        manualPivot,
        colLevelFields,
      }),
      pivotMode: false,
      rowHeight: 40,
      context: { onToggleManualExpand },
      getRowId: (p) => p.data.id,
      rowClassRules: {
        // Non-last measure rows: hide the separator so a node's measure rows
        // read as one merged block (separators remain between nodes).
        "dd-row-mid": (p) => p.data && !p.data.__isLast,
        // Alternating hierarchy-group banding.
        "dd-group-alt": (p) => p.data && p.data.__alt,
      },
      animateRows: false,
      suppressAggFuncInHeader: true,
      defaultColDef: {
        resizable: true,
        sortable: false,
        filter: false,
        minWidth: 100,
      },
      onCellValueChanged,
      onGridReady,
    };
  }

  const pivotMode = arrangement.columns.length > 0;

  // When measures or metrics is a COLUMN dimension, its pivot groups must
  // always be fully expanded (no collapse toggle) and carry no "Total"
  // summary column. This only applies while they are in columns; in rows the
  // behaviour is unchanged.
  const measureOrMetricInCols =
    arrangement.columns.includes("measures") ||
    arrangement.columns.includes("metrics");

  // Real grouping dimensions in columns (e.g. store channel > store id). These
  // must stay collapsible with their sub-levels nested inside. AG Grid's
  // suppressExpandablePivotGroups is grid-wide, so we only "fix" the pivot
  // groups when measures/metrics is the ONLY grouping dimension in columns
  // (ignoring time). When a real dimension like store is also present, we keep
  // groups expandable (and expanded by default) so it can collapse/expand.
  const groupingColDims = arrangement.columns.filter(
    (d) => d !== "measures" && d !== "metrics" && d !== "time",
  );
  const suppressPivotExpand =
    measureOrMetricInCols && groupingColDims.length === 0;

  return {
    columnDefs: buildColDefs(arrangement, levels, visibleMetrics),
    pivotMode,
    rowHeight: 40,
    suppressExpandablePivotGroups: suppressPivotExpand,
    pivotDefaultExpanded: 0,
    groupDisplayType: compact ? "singleColumn" : "multipleColumns",
    groupDefaultExpanded: 1,
    autoGroupColumnDef: {
      ...(compact
        ? {
            headerName:
              arrangement.rows
                .filter((d) => d !== "metrics" && d !== "measures")
                .map((d) => DIMENSION_LABELS[d] || d)
                .join(" - ") || "Group",
          }
        : {}),
      minWidth: 200,
      cellRendererParams: {
        suppressCount: true,
      },
    },
    groupIncludeTotalFooter: false,
    groupIncludeFooter: false,
    pivotColumnTotals: measureOrMetricInCols ? undefined : "before",
    animateRows: true,
    suppressAggFuncInHeader: true,
    removePivotHeaderRowWhenSingleValueColumn: true,
    suppressRowGroupHidesSingleColumn: false,
    processPivotResultColDef: (colDef) => {
      // Assign alternating class based on top-level pivot key for cell shading
      const pivotKeys = colDef.pivotKeys || [];
      if (pivotKeys.length > 0) {
        const topKey = pivotKeys[0];
        const hash = [...topKey].reduce((acc, c) => acc + c.charCodeAt(0), 0);
        const isOdd = hash % 2 === 1;
        const cls = isOdd ? "pvt-col-group-b" : "pvt-col-group-a";
        colDef.cellClass = (params) => {
          const classes = ["ag-right-aligned-cell"];
          classes.push(cls);
          return classes;
        };
        colDef.headerClass = [
          "ag-right-aligned-header",
          isOdd ? "pvt-header-group-b" : "pvt-header-group-a",
        ];
      }
    },
    processPivotResultColGroupDef: (colGroupDef) => {
      if (colGroupDef.pivotKeys?.length) {
        colGroupDef.headerName = formatPivotHeader(
          colGroupDef.pivotKeys[colGroupDef.pivotKeys.length - 1],
        );
        // Apply alternating header group class based on top-level pivot key
        const topKey = colGroupDef.pivotKeys[0];
        const hash = [...topKey].reduce((acc, c) => acc + c.charCodeAt(0), 0);
        const isOdd = hash % 2 === 1;
        const isTopLevel = colGroupDef.pivotKeys.length === 1;
        colGroupDef.headerClass = isOdd
          ? isTopLevel
            ? "pvt-header-group-b pvt-header-group-top"
            : "pvt-header-group-b"
          : isTopLevel
            ? "pvt-header-group-a pvt-header-group-top"
            : "pvt-header-group-a";
      }
    },
    getRowClass: undefined,
    onRowGroupOpened: undefined,
    defaultColDef: {
      resizable: true,
      sortable: true,
      filter: true,
      flex: 1,
      minWidth: 100,
    },
    onCellValueChanged,
    onGridReady,
  };
}
