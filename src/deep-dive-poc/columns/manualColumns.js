/**
 * Column defs for the manual (custom) pivot path — used when measures and/or
 * metrics is a row dimension. Builds a pinned dimension tree column, the inner
 * Measure/Metric column(s), and the nested value column groups. Value cells are
 * formatted through the metric registry.
 */

import {
  DIMENSIONS,
  DIMENSION_LABELS,
  MEASURE_LEVELS,
  MEASURE_LEVEL_TO_ROW,
  isValueDimension,
  selectedLevelsFor,
} from "../config/dimensions";
import { METRIC_REGISTRY, formatMetricValue } from "../config/metrics";
import { metricsIsOutermost } from "../model/arrangement";
import { LOC_MARK, PATH_SEP } from "../model/manualPivotModel";
import ColGroupHeader from "../ColGroupHeader";
import ProductTreeCell from "../ProductTreeCell";
import { buildAxisColumnKey, buildManualColumnKey } from "./columnKey";
import { formatColValue } from "./headerFormat";
import {
  NUMERIC_CELL_CLASS,
  NUMERIC_HEADER_CLASS,
  shadeByIndex,
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
  colAxisGroups = [],
  colExpandedKeys = new Set(),
}) {
  const rowDims = arrangement.rows
    .filter((d) => d !== "measures" && d !== "metrics")
    .filter((d) => selectedLevelsFor(d, levels).length > 0);
  const hasRowDims = rowDims.length > 0;

  const measuresInRows = arrangement.rows.includes("measures");
  const metricsInRows = arrangement.rows.includes("metrics");
  const innerIsMetric = metricsInRows && !measuresInRows;
  const bothInner = measuresInRows && metricsInRows;
  // Neither value dim in rows → both are column dimensions; there is no inner
  // Measure/Metric pinned column and each node renders as a single row.
  const valueDimsInCols = !measuresInRows && !metricsInRows;
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

  // Each row dimension gets its OWN pinned tree column, aligned to an axis in
  // the model (axis 0 = drillable Product tree; axes >= 1 are independent
  // nested trees — e.g. Location, then Time under every level). A row carries
  // one `__axis` entry per dimension, so each column reads its own label,
  // depth, chevron and expand-state by index.
  const treeCellClassRules = {
    "dd-tnl": (p) => p.data && p.data.__isLast === false,
    "dd-tnf": (p) => p.data && p.data.__isFirst === false,
    "dd-nodestart": (p) => p.data && p.data.__isFirst === true,
  };

  const treeCols = rowDims.map((dim, axisIdx) => ({
    colId: `ddGroupTree_${dim}_${axisIdx}`,
    headerName: DIMENSION_LABELS[dim] || dim,
    pinned: "left",
    width: axisIdx === 0 ? 220 : 200,
    minWidth: axisIdx === 0 ? 180 : 140,
    suppressMovable: true,
    cellRenderer: ProductTreeCell,
    cellRendererParams: { axisIdx },
    cellClassRules: treeCellClassRules,
    cellClass: "dd-tree-col",
  }));

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
    width: 184,
    minWidth: 140,
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

  const innerCols = valueDimsInCols
    ? []
    : bothInner
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

  // Dimension owning each colLevelField (aligned by index). Used to give real
  // non-Time column dims (e.g. Location) a collapsible "Total" rollup node.
  const colFieldDims = [];
  arrangement.columns.forEach((dim) => {
    if (isValueDimension(dim)) return;
    selectedLevelsFor(dim, levels).forEach(() => colFieldDims.push(dim));
  });
  // A column level should get a "Total" rollup group when it is the entry into
  // a real non-Time dimension (Location/Product), mirroring the rows behavior.
  const isTotaledDimEntry = (level) =>
    colFieldDims[level] &&
    colFieldDims[level] !== DIMENSIONS.TIME &&
    (level === 0 || colFieldDims[level - 1] !== colFieldDims[level]);

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
          width: 100,
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
          width: 100,
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
        width: 100,
        cellClass: [NUMERIC_CELL_CLASS, cellGrpClass],
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
      width: 100,
      cellClass: [NUMERIC_CELL_CLASS, cellGrpClass],
      headerClass: [NUMERIC_HEADER_CLASS, grpClass],
    };
    if (groupShow) col.columnGroupShow = groupShow;
    return col;
  };

  // A single leaf for a fixed measure (used when measure is the outer group and
  // metrics is a row dim, so each row formats against its own metricKey).
  const buildSingleMeasureLeaf = (
    mc,
    combo,
    cellGrpClass,
    grpClass,
    groupShow,
  ) => {
    const col = {
      colId: `${combo.key}__meas_${mc.dataValue}${
        groupShow ? `__${groupShow}` : ""
      }`,
      headerName: "",
      valueGetter: (p) => {
        if (!p.data) return null;
        const bm = p.data.__cellsByMeasure?.[mc.dataValue];
        return bm ? bm[combo.key] || null : null;
      },
      valueFormatter: (p) =>
        p.value ? formatMetricValue(p.data?.metricKey, p.value) : "",
      cellDataType: false,
      width: 100,
      cellClass: [NUMERIC_CELL_CLASS, cellGrpClass],
      headerClass: [NUMERIC_HEADER_CLASS, grpClass],
    };
    if (groupShow) col.columnGroupShow = groupShow;
    return col;
  };

  // Recursively nest column-dimension levels; leaves come from leafBuilder.
  // A real non-Time dimension (Location) is wrapped in a collapsible "Total"
  // group: collapsed shows the dimension rollup, expanded shows its values.
  const buildColGroups = (
    combos,
    level,
    grpClass,
    cellGrpClass,
    leafBuilder = buildMetricChildren,
    shadeLevel0 = true,
  ) => {
    if (isTotaledDimEntry(level)) {
      let gClass = grpClass;
      let cClass = cellGrpClass;
      let headerClass = [grpClass];
      if (level === 0 && shadeLevel0) {
        const band = shadeByIndex(0);
        gClass = band.header;
        cClass = band.cell;
        headerClass = [gClass, "pvt-header-group-top"];
      }
      const prefixKey = buildManualColumnKey(
        (combos[0]?.values || []).slice(0, level),
      );
      const rawPerValue = buildLevelGroups(
        combos,
        level,
        gClass,
        cClass,
        leafBuilder,
        false,
      );
      // Single value: no Total rollup/toggle — show the one column expanded.
      if (rawPerValue.length === 1) return rawPerValue;
      const summaryChildren = leafBuilder(
        { key: prefixKey },
        cClass,
        gClass,
        "closed",
      ).map(markIfBlank);
      const perValue = rawPerValue.map((g) => ({
        ...g,
        columnGroupShow: "open",
      }));
      return [
        {
          headerName:
            `${DIMENSION_LABELS[colFieldDims[level]] || ""} Total`.trim(),
          groupId: `total__${colFieldDims[level]}__${prefixKey}`,
          headerClass,
          openByDefault: false,
          children: [...summaryChildren, ...perValue],
        },
      ];
    }
    return buildLevelGroups(
      combos,
      level,
      grpClass,
      cellGrpClass,
      leafBuilder,
      shadeLevel0,
    );
  };

  // Per-value iteration for a single column level (no Total wrapper).
  const buildLevelGroups = (
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

    return order.map((v, orderIdx) => {
      const childCombos = byValue.get(v);
      const headerName = formatColValue(colLevelFields[level], v);

      let gClass = grpClass;
      let cClass = cellGrpClass;
      if (level === 0 && shadeLevel0) {
        // Positional alternation (not value-hash) so adjacent top-level groups
        // strictly alternate their accent underline, like ux-cypher's
        // nth-child(even/odd) group headers.
        const band = shadeByIndex(orderIdx);
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

      const rawNested = buildColGroups(
        childCombos,
        level + 1,
        gClass,
        cClass,
        leafBuilder,
        false,
      );
      // Single child: no rollup/toggle — the group is always expanded.
      if (rawNested.length === 1) {
        return {
          headerName,
          groupId: `grp__${level}__${v}`,
          headerClass,
          children: rawNested,
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
      const nested = rawNested.map((g) => ({
        ...g,
        columnGroupShow: "open",
      }));

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

  // Measure is the highest-priority column dimension while metrics is a row dim:
  // invert so each measure (WCF/MFP) forms an outer group with Time nested
  // under it, rather than Time on top with measure leaves.
  const measuresColIdx = arrangement.columns.indexOf("measures");
  const firstRealColIdx = arrangement.columns.findIndex(
    (d) => d !== "measures" && d !== "metrics",
  );
  const measuresOuter =
    innerIsMetric &&
    measuresColIdx !== -1 &&
    colLevelFields.length > 0 &&
    (firstRealColIdx === -1 || measuresColIdx < firstRealColIdx);

  // Both value dims are column dimensions (neither in rows): nest the column
  // header EXACTLY in the arrangement's column priority order, where each level
  // is one of Time levels, Measure, or Metric. A cell's numeric value needs a
  // fixed (measure, metric, time colKey), so the innermost level produces the
  // leaf value columns and all outer levels are header groups.
  const buildValueDimGroups = () => {
    // Flatten arrangement.columns into ordered steps; a Time (or other real)
    // dim expands into one step per selected level, in order.
    const steps = [];
    arrangement.columns.forEach((dim) => {
      if (dim === "measures") steps.push({ type: "measure" });
      else if (dim === "metrics") steps.push({ type: "metric" });
      else
        selectedLevelsFor(dim, levels).forEach((field) =>
          steps.push({ type: "field", field }),
        );
    });
    if (steps.length === 0) return [];
    const lastIdx = steps.length - 1;

    const leafColumn = (ctx, combo, headerName, gCls, cCls, pathId) => ({
      colId: `v__${pathId}`,
      headerName,
      valueGetter: (p) => {
        if (!p.data) return null;
        const bm = p.data.__cellsByMeasure?.[ctx.measure];
        return bm ? bm[combo.key] || null : null;
      },
      valueFormatter: (p) =>
        p.value ? formatMetricValue(ctx.metric, p.value) : "",
      cellDataType: false,
      width: 100,
      cellClass: [NUMERIC_CELL_CLASS, cCls],
      headerClass: [NUMERIC_HEADER_CLASS, gCls],
    });

    // Builds the rolled-up summary shown when a Time level is collapsed: the
    // (inner) measure/metric breakdown is preserved but read at a coarser
    // column key. `vsteps` are only the value dims nested inside that level.
    const buildValueStructure = (
      vsteps,
      vIdx,
      ctx,
      comboKey,
      gCls,
      cCls,
      pathId,
      groupShow,
    ) => {
      const vstep = vsteps[vIdx];
      const isLast = vIdx === vsteps.length - 1;
      const gs = vIdx === 0 ? { columnGroupShow: groupShow } : {};
      const entries =
        vstep.type === "measure"
          ? measureCols.map((mc) => ({
              label: mc.label,
              ctx: { ...ctx, measure: mc.dataValue },
              id: `m_${mc.dataValue}`,
            }))
          : selectedMetrics.map((mk) => ({
              label: metricLabel(mk),
              ctx: { ...ctx, metric: mk },
              id: `k_${mk}`,
            }));
      if (isLast) {
        return entries.map((e) => ({
          ...leafColumn(
            e.ctx,
            { key: comboKey },
            e.label,
            gCls,
            cCls,
            `${pathId}/${e.id}`,
          ),
          ...gs,
        }));
      }
      return entries.map((e) => ({
        headerName: e.label,
        groupId: `${pathId}/${e.id}`,
        headerClass: [gCls],
        ...gs,
        children: buildValueStructure(
          vsteps,
          vIdx + 1,
          e.ctx,
          comboKey,
          gCls,
          cCls,
          `${pathId}/${e.id}`,
          groupShow,
        ),
      }));
    };

    // Children entries for a step: label, next context/combos/fieldIdx, idKey.
    const entriesFor = (step, combos, fieldIdx, ctx) => {
      if (step.type === "measure") {
        return measureCols.map((mc) => ({
          label: mc.label,
          nextCtx: { ...ctx, measure: mc.dataValue },
          nextCombos: combos,
          nextFieldIdx: fieldIdx,
          idKey: `m_${mc.dataValue}`,
        }));
      }
      if (step.type === "metric") {
        return selectedMetrics.map((mk) => ({
          label: metricLabel(mk),
          nextCtx: { ...ctx, metric: mk },
          nextCombos: combos,
          nextFieldIdx: fieldIdx,
          idKey: `k_${mk}`,
        }));
      }
      const order = [];
      const seen = new Map();
      combos.forEach((c) => {
        const v = c.values[fieldIdx];
        if (!seen.has(v)) {
          seen.set(v, []);
          order.push(v);
        }
        seen.get(v).push(c);
      });
      return order.map((v) => ({
        label: formatColValue(step.field, v),
        nextCtx: ctx,
        nextCombos: seen.get(v),
        nextFieldIdx: fieldIdx + 1,
        idKey: `f_${v}`,
      }));
    };

    const recurse = (stepIdx, combos, fieldIdx, ctx, gCls, cCls, pathId) => {
      const step = steps[stepIdx];
      const entries = entriesFor(step, combos, fieldIdx, ctx);

      if (stepIdx === lastIdx) {
        return entries.map((e) => {
          const combo = e.nextCombos[0] || { key: "", values: [] };
          return leafColumn(
            e.nextCtx,
            combo,
            e.label,
            gCls,
            cCls,
            `${pathId}/${e.idKey}`,
          );
        });
      }

      return entries.map((e, idx) => {
        let g = gCls;
        let c = cCls;
        let headerClass = [g];
        if (stepIdx === 0) {
          const band = shadeByIndex(idx);
          g = band.header;
          c = band.cell;
          headerClass = [g, "pvt-header-group-top"];
        }
        const childPath = `${pathId}/${e.idKey}`;
        const detail = recurse(
          stepIdx + 1,
          e.nextCombos,
          e.nextFieldIdx,
          e.nextCtx,
          g,
          c,
          childPath,
        );

        // Collapsible outermost Measure group: when collapsed, roll up to one
        // all-time total column per metric; when open, show the full detail.
        // Only meaningful if a Time level is nested inside — otherwise the
        // metric leaves already ARE the totals and collapsing is a no-op.
        const hasNestedField = steps
          .slice(stepIdx + 1)
          .some((s) => s.type === "field");
        if (stepIdx === 0 && step.type === "measure" && hasNestedField) {
          const summary = selectedMetrics.map((mk) => ({
            colId: `v__${childPath}/sum_${mk}`,
            headerName: metricLabel(mk),
            columnGroupShow: "closed",
            valueGetter: (p) => {
              if (!p.data) return null;
              const bm = p.data.__cellsByMeasure?.[e.nextCtx.measure];
              return bm ? bm[""] || null : null;
            },
            valueFormatter: (p) =>
              p.value ? formatMetricValue(mk, p.value) : "",
            cellDataType: false,
            width: 100,
            cellClass: [NUMERIC_CELL_CLASS, c],
            headerClass: [NUMERIC_HEADER_CLASS, g],
          }));
          return {
            headerName: e.label,
            groupId: childPath,
            headerClass,
            openByDefault: false,
            children: [
              ...summary,
              ...detail.map((d) => ({ ...d, columnGroupShow: "open" })),
            ],
          };
        }

        // Collapsible Time level: when a deeper Time level exists, collapsing
        // this one rolls up the finer periods while preserving the
        // Measure/Metric breakdown at this level's coarser column key.
        const deeperField = steps
          .slice(stepIdx + 1)
          .some((s) => s.type === "field");
        // Value dims nested INSIDE this Time level (outer ones are already
        // fixed in ctx and must NOT be re-expanded under the month).
        const innerValSteps = steps
          .slice(stepIdx + 1)
          .filter((s) => s.type !== "field");
        if (step.type === "field" && deeperField) {
          const prefixKey = buildManualColumnKey(
            (e.nextCombos[0]?.values || []).slice(0, e.nextFieldIdx),
          );
          const summary = innerValSteps.length
            ? buildValueStructure(
                innerValSteps,
                0,
                e.nextCtx,
                prefixKey,
                g,
                c,
                `${childPath}/sum`,
                "closed",
              )
            : [
                {
                  ...leafColumn(
                    e.nextCtx,
                    { key: prefixKey },
                    "",
                    g,
                    c,
                    `${childPath}/sum`,
                  ),
                  columnGroupShow: "closed",
                },
              ];
          return {
            headerName: e.label,
            groupId: childPath,
            headerClass,
            openByDefault: false,
            children: [
              ...summary,
              ...detail.map((d) => ({ ...d, columnGroupShow: "open" })),
            ],
          };
        }

        return {
          headerName: e.label,
          groupId: childPath,
          headerClass,
          children: detail,
        };
      });
    };

    const rootCombos = colCombos.length ? colCombos : [{ key: "", values: [] }];
    return recurse(
      0,
      rootCombos,
      0,
      {},
      "pvt-header-group-a",
      "pvt-col-group-a",
      "c",
    );
  };

  // Independent column axes: 2+ real column dimensions (e.g. Time + Location),
  // each an independent header band with its own Total + expand state, rather
  // than one nested-collapsed chain. Value dims (measure/metric) remain the
  // innermost leaves. Rebuilt from `colExpandedKeys` on every toggle.
  const colRealDims = arrangement.columns.filter(
    (d) => !isValueDimension(d) && selectedLevelsFor(d, levels).length > 0,
  );
  const buildIndependentAxisGroups = () => {
    const combos = colCombos.length ? colCombos : [{ key: "", values: [] }];
    const offsets = [];
    let acc = 0;
    colAxisGroups.forEach((f) => {
      offsets.push(acc);
      acc += f.length;
    });

    const buildValueTree = (offset, len) => {
      const build = (subset, levelIdx, parentPath, parentVals) => {
        if (levelIdx >= len) return [];
        const order = [];
        const map = new Map();
        subset.forEach((cmb) => {
          const v = cmb.values[offset + levelIdx];
          if (!map.has(v)) {
            map.set(v, []);
            order.push(v);
          }
          map.get(v).push(cmb);
        });
        order.sort((a, b) =>
          String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
        );
        return order.map((v) => {
          const path = parentPath ? `${parentPath}${PATH_SEP}${v}` : String(v);
          const vals = [...parentVals, v];
          return {
            value: v,
            path,
            vals,
            depth: levelIdx,
            children: build(map.get(v), levelIdx + 1, path, vals),
          };
        });
      };
      return build(combos, 0, "", []);
    };

    const axisTrees = colAxisGroups.map((f, a) =>
      buildValueTree(offsets[a], f.length),
    );

    const leaf = (coord, gCls, cCls) =>
      buildMetricChildren({ key: buildAxisColumnKey(coord) }, cCls, gCls);

    const renderNodes = (a, nodes, coord, gCls, cCls, banded) =>
      nodes.map((node, idx) => {
        let g = gCls;
        let c = cCls;
        let headerClass = [gCls];
        if (banded) {
          const band = shadeByIndex(idx);
          g = band.header;
          c = band.cell;
          headerClass = [g, "pvt-header-group-top"];
        }
        const expKey = `${a}${LOC_MARK}${node.path}`;
        const expandable = node.children.length > 0;
        const expanded = expandable && colExpandedKeys.has(expKey);
        const children = expanded
          ? renderNodes(a, node.children, coord, g, c, false)
          : renderAxis(a + 1, [...coord, node.vals], g, c);
        return {
          groupId: `colax_${a}_${node.path}_${buildAxisColumnKey(coord)}`,
          headerName: String(node.value),
          headerGroupComponent: ColGroupHeader,
          headerGroupComponentParams: {
            label: formatColValue(colAxisGroups[a][node.depth], node.value),
            expandable,
            expanded,
            toggleKey: expKey,
          },
          headerClass,
          children,
        };
      });

    const renderAxis = (a, coord, gCls, cCls) => {
      if (a >= colAxisGroups.length) return leaf(coord, gCls, cCls);
      const nodes = axisTrees[a];
      if (a === 0) {
        // Primary axis: values shown directly (no Total root), banded per group.
        return renderNodes(a, nodes, coord, gCls, cCls, true);
      }
      // Secondary axis: one "<Dim> Total" root that expands to its values.
      const dimLabel = DIMENSION_LABELS[colRealDims[a]] || colRealDims[a];
      const totalKey = `${a}${LOC_MARK}`;
      const expandable = nodes.length > 0;
      const expanded = expandable && colExpandedKeys.has(totalKey);
      const children = expanded
        ? renderNodes(a, nodes, coord, gCls, cCls, false)
        : renderAxis(a + 1, [...coord, []], gCls, cCls);
      return [
        {
          groupId: `colax_${a}_total_${buildAxisColumnKey(coord)}`,
          headerName: `${dimLabel} Total`,
          headerGroupComponent: ColGroupHeader,
          headerGroupComponentParams: {
            label: `${dimLabel} Total`,
            expandable,
            expanded,
            toggleKey: totalKey,
          },
          headerClass: [gCls],
          children,
        },
      ];
    };

    return renderAxis(0, [], "pvt-header-group-a", "pvt-col-group-a");
  };

  let valueGroups;
  if (colAxisGroups.length >= 2 && !valueDimsInCols) {
    valueGroups = buildIndependentAxisGroups();
  } else if (valueDimsInCols) {
    valueGroups = buildValueDimGroups();
  } else if (colLevelFields.length === 0) {
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
  } else if (measuresOuter) {
    valueGroups = measureCols.map((mc, i) => {
      const band = shadeByIndex(i);
      const leafBuilder = (combo, cGrp, gGrp, groupShow) => [
        buildSingleMeasureLeaf(mc, combo, cGrp, gGrp, groupShow),
      ];
      return {
        headerName: mc.label,
        groupId: `measure__${mc.dataValue}`,
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

  // Tag the first leaf of every top-level column group with `dd-grp-start` so
  // the body can draw a vertical boundary line between groups (matching
  // ux-cypher, whose group columns are separated by a --border line).
  if (colLevelFields.length > 0) {
    const markFirstLeaf = (col) => {
      if (col.children && col.children.length) {
        markFirstLeaf(col.children[0]);
        return;
      }
      const cc = Array.isArray(col.cellClass)
        ? col.cellClass
        : col.cellClass
          ? [col.cellClass]
          : [];
      if (!cc.includes("dd-grp-start")) col.cellClass = [...cc, "dd-grp-start"];
    };
    valueGroups.forEach(markFirstLeaf);
  }

  return hasRowDims
    ? [...treeCols, ...innerCols, ...valueGroups]
    : [...innerCols, ...valueGroups];
}
