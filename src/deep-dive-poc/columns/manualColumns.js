/**
 * Column defs for the manual (custom) pivot path — used when measures and/or
 * metrics is a row dimension. Builds a pinned dimension tree column, the inner
 * Measure/Metric column(s), and the nested value column groups. Value cells are
 * formatted through the metric registry.
 */

import {
  DIMENSION_LABELS,
  MEASURE_LEVELS,
  MEASURE_LEVEL_TO_ROW,
} from "../config/dimensions";
import { METRIC_REGISTRY, formatMetricValue } from "../config/metrics";
import { metricsIsOutermost } from "../model/arrangement";
import ProductTreeCell from "../ProductTreeCell";
import { buildManualColumnKey } from "./columnKey";
import { formatColValue } from "./headerFormat";
import {
  NUMERIC_CELL_CLASS,
  NUMERIC_HEADER_CLASS,
  shadeByIndex,
  shadeByValue,
} from "./shading";

const metricLabel = (key) => METRIC_REGISTRY[key]?.label || key;

// Flag a leaf column whose header is blank (a collapsed-group summary "filler")
// so CSS can merge it into the group header above instead of rendering it as an
// empty sub-column.
const markIfBlank = (col) => {
  if (col.headerName !== "") return col;
  const hc = Array.isArray(col.headerClass)
    ? col.headerClass
    : col.headerClass
      ? [col.headerClass]
      : [];
  return { ...col, headerClass: [...hc, "dd-h-blank"] };
};

export function buildManualColDefs({
  arrangement,
  levels,
  manualPivot,
  colLevelFields,
}) {
  const rowDims = arrangement.rows.filter(
    (d) => d !== "measures" && d !== "metrics",
  );
  const hasRowDims = rowDims.length > 0;
  const mainHeader = rowDims.map((d) => DIMENSION_LABELS[d] || d).join(" - ");

  const measuresInRows = arrangement.rows.includes("measures");
  const metricsInRows = arrangement.rows.includes("metrics");
  const innerIsMetric = metricsInRows && !measuresInRows;
  const bothInner = measuresInRows && metricsInRows;
  const innerDimOrder = arrangement.rows.filter(
    (d) => d === "measures" || d === "metrics",
  );

  const measureCols = (
    levels.measures && levels.measures.length
      ? levels.measures
      : ["slsU", "mfp"]
  )
    .map((k) => ({
      dataValue: MEASURE_LEVEL_TO_ROW[k],
      label: MEASURE_LEVELS.find((m) => m.key === k)?.label || k,
    }))
    .filter((m) => m.dataValue);

  // Pinned Product/Location tree column with fake cell-merge (label on first
  // measure row of each node only).
  const treeCol = {
    colId: "ddGroupTree",
    headerName: mainHeader,
    pinned: "left",
    minWidth: 240,
    suppressMovable: true,
    cellRenderer: ProductTreeCell,
    cellClassRules: {
      "dd-tnl": (p) => p.data && p.data.__isLast === false,
      "dd-tnf": (p) => p.data && p.data.__isFirst === false,
      "dd-nodestart": (p) => p.data && p.data.__isFirst === true,
    },
    cellClass: "dd-tree-col",
  };

  const measureLabelOf = (p) => (p.data ? p.data.measure || "" : "");
  const metricLabelOf = (p) =>
    p.data ? metricLabel(p.data.metricKey) || "" : "";

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
            "dd-grplast": (p) =>
              p.data && p.data.__grpLast && p.data.__isLast === false,
          },
        }
      : {}),
  });

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

  const selectedMetrics =
    levels.metrics && levels.metrics.length ? levels.metrics : ["slsU"];

  const colCombos = manualPivot?.colCombos || [];

  // Leaf value columns for one column combo, depending on which value dimension
  // is innermost.
  const buildMetricChildren = (combo, cellGrpClass, grpClass, groupShow) => {
    const withGroupShow = (col) => {
      if (groupShow) col.columnGroupShow = groupShow;
      return col;
    };

    if (bothInner) {
      return [
        withGroupShow({
          colId: `${combo.key}__val${groupShow ? `__${groupShow}` : ""}`,
          headerName: colLevelFields.length === 0 ? "Value" : "",
          valueGetter: (p) => {
            if (!p.data) return null;
            const byMeasure = p.data.__cellsByMeasure?.[p.data.measure];
            return byMeasure ? byMeasure[combo.key] || null : null;
          },
          valueFormatter: (p) =>
            p.value ? formatMetricValue(p.data?.metricKey, p.value) : "",
          cellDataType: false,
          width: 120,
          cellClass: [NUMERIC_CELL_CLASS, cellGrpClass],
          headerClass: [NUMERIC_HEADER_CLASS, grpClass],
        }),
      ];
    }

    if (innerIsMetric) {
      return measureCols.map((mc) =>
        withGroupShow({
          colId: `${combo.key}__meas_${mc.dataValue}${
            groupShow ? `__${groupShow}` : ""
          }`,
          headerName: mc.label,
          valueGetter: (p) => {
            if (!p.data) return null;
            const byMeasure = p.data.__cellsByMeasure?.[mc.dataValue];
            return byMeasure ? byMeasure[combo.key] || null : null;
          },
          valueFormatter: (p) =>
            p.value ? formatMetricValue(p.data?.metricKey, p.value) : "",
          cellDataType: false,
          width: 120,
          cellClass: [NUMERIC_CELL_CLASS, cellGrpClass],
          headerClass: [NUMERIC_HEADER_CLASS, grpClass],
        }),
      );
    }

    return selectedMetrics.map((mk) =>
      withGroupShow({
        colId: `${combo.key}__${mk}${groupShow ? `__${groupShow}` : ""}`,
        headerName: metricLabel(mk),
        valueGetter: (p) => (p.data ? p.data.__cells[combo.key] || null : null),
        valueFormatter: (p) => (p.value ? formatMetricValue(mk, p.value) : ""),
        cellDataType: false,
        width: 120,
        cellClass: [
          NUMERIC_CELL_CLASS,
          cellGrpClass,
          ...(mk === "slsU" ? ["dd-input-cell"] : []),
        ],
        headerClass: [NUMERIC_HEADER_CLASS, grpClass],
      }),
    );
  };

  // A single leaf for a fixed metric (used when metrics is the outer group).
  const buildSingleMetricLeaf = (
    mk,
    combo,
    cellGrpClass,
    grpClass,
    groupShow,
  ) => {
    const col = {
      colId: `${combo.key}__${mk}${groupShow ? `__${groupShow}` : ""}`,
      headerName: "",
      valueGetter: (p) => (p.data ? p.data.__cells[combo.key] || null : null),
      valueFormatter: (p) => (p.value ? formatMetricValue(mk, p.value) : ""),
      cellDataType: false,
      width: 120,
      cellClass: [
        NUMERIC_CELL_CLASS,
        cellGrpClass,
        ...(mk === "slsU" ? ["dd-input-cell"] : []),
      ],
      headerClass: [NUMERIC_HEADER_CLASS, grpClass],
    };
    if (groupShow) col.columnGroupShow = groupShow;
    return col;
  };

  // Recursively nest column-dimension levels; leaves come from leafBuilder.
  const buildColGroups = (
    combos,
    level,
    grpClass,
    cellGrpClass,
    leafBuilder = buildMetricChildren,
    shadeLevel0 = true,
  ) => {
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

      let gClass = grpClass;
      let cClass = cellGrpClass;
      if (level === 0 && shadeLevel0) {
        const band = shadeByValue(v);
        gClass = band.header;
        cClass = band.cell;
      }

      const headerClass =
        level === 0 && shadeLevel0
          ? [gClass, "pvt-header-group-top"]
          : [gClass];

      if (isLast) {
        const leafChildren = leafBuilder(childCombos[0], cClass, gClass);
        // Single unlabeled value column: flatten so the group label sits on the
        // leaf itself (avoids a redundant empty header row).
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

      const prefixKey = buildManualColumnKey(
        childCombos[0].values.slice(0, level + 1),
      );
      const summaryChildren = leafBuilder(
        { key: prefixKey },
        cClass,
        gClass,
        "closed",
      ).map(markIfBlank);
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

  // Metrics is the highest-priority column dimension with other levels to nest
  // under it: invert so each metric forms an outer group.
  const metricsOuter =
    arrangement.columns.includes("metrics") &&
    metricsIsOutermost(arrangement) &&
    !bothInner &&
    !innerIsMetric &&
    colLevelFields.length > 0;

  let valueGroups;
  if (colLevelFields.length === 0) {
    const combo = colCombos[0] || { key: "", values: [] };
    valueGroups = buildMetricChildren(
      combo,
      "pvt-col-group-a",
      "pvt-header-group-a",
    );
  } else if (metricsOuter) {
    valueGroups = selectedMetrics.map((mk, i) => {
      const band = shadeByIndex(i);
      const leafBuilder = (combo, cGrp, gGrp, groupShow) => [
        buildSingleMetricLeaf(mk, combo, cGrp, gGrp, groupShow),
      ];
      return {
        headerName: metricLabel(mk),
        groupId: `metric__${mk}`,
        headerClass: [band.header, "pvt-header-group-top"],
        children: buildColGroups(
          colCombos,
          0,
          band.header,
          band.cell,
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
