import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { fetchDeepDiveData, saveEdits } from "./api";
import {
  DEFAULT_ARRANGEMENT,
  DEFAULT_LEVELS,
  METRICS,
  METRIC_LEVELS,
} from "./constants";
import {
  buildGridOptions,
  metricsIsOutermost,
  buildManualColumnKey,
} from "./gridConfig";
import { LEVELS_BY_DIMENSION } from "./constants";
import {
  flipArrangement,
  getCellFilter,
  getDimensionFields,
  updateBaseData,
} from "./pivotEngine";

export function useDeepDivePivot() {
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState([]);
  const recordsRef = useRef(records);
  const [arrangement, setArrangement] = useState(DEFAULT_ARRANGEMENT);
  const [levels, setLevels] = useState(DEFAULT_LEVELS);
  const [visibleMetrics, setVisibleMetrics] = useState(() => [
    ...METRICS.map((m) => m.key),
    "mfp",
    "ly",
    "varLY",
  ]);
  const [compact, setCompact] = useState(true);
  const [history, setHistory] = useState([]);
  const rowFieldsRef = useRef([]);
  const columnFieldsRef = useRef([]);

  useEffect(() => {
    recordsRef.current = records;
  }, [records]);

  useEffect(() => {
    const fields = getDimensionFields(arrangement, levels);
    rowFieldsRef.current = fields.rowFields;
    columnFieldsRef.current = fields.columnFields;
  }, [arrangement, levels]);

  useEffect(() => {
    let mounted = true;
    fetchDeepDiveData({
      arrangement: DEFAULT_ARRANGEMENT,
      levels: DEFAULT_LEVELS,
    })
      .then((res) => {
        if (!mounted) return;
        setRecords(res.data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const { rowFields, columnFields } = useMemo(
    () => getDimensionFields(arrangement, levels),
    [arrangement, levels],
  );

  // Map measure level keys to the measure field values in data
  const MEASURE_LEVEL_TO_ROW = { slsU: "WCF", mfp: "MFP", ly: "LY" };

  // Filter records based on selected measure levels (pivot is source of truth)
  const filteredRecords = useMemo(() => {
    const selectedMeasures = levels.measures || [];
    const allowedMeasureValues = selectedMeasures
      .map((k) => MEASURE_LEVEL_TO_ROW[k])
      .filter(Boolean);
    if (allowedMeasureValues.length === 0) return records;
    return records.filter((r) => allowedMeasureValues.includes(r.measure));
  }, [records, levels]);

  // When metrics is in rows OR metrics is outermost in columns,
  // unpivot data so each metric becomes a separate row.
  // In rows mode, 'metric' is used as a rowGroup field.
  // In outermost-column mode, 'metric' is used as a pivot field.
  const metricsInRows = arrangement.rows.includes("metrics");
  const metricsOutermostCol = metricsIsOutermost(arrangement);
  const measuresInRows = arrangement.rows.includes("measures");

  // Expanded row-level dimension fields (excluding measures/metrics), in order.
  const rowLevelFields = useMemo(() => {
    const fields = [];
    arrangement.rows.forEach((dim) => {
      if (dim === "measures" || dim === "metrics") return;
      const selected =
        levels[dim] || LEVELS_BY_DIMENSION[dim].map((l) => l.key);
      selected.forEach((k) => fields.push(k));
    });
    return fields;
  }, [arrangement, levels]);

  // Expanded column-level dimension fields (excluding measures/metrics), in order.
  const colLevelFields = useMemo(() => {
    const fields = [];
    arrangement.columns.forEach((dim) => {
      if (dim === "measures" || dim === "metrics") return;
      const selected =
        levels[dim] || LEVELS_BY_DIMENSION[dim].map((l) => l.key);
      selected.forEach((k) => fields.push(k));
    });
    return fields;
  }, [arrangement, levels]);

  // Ordered measure values (data uses "WCF"/"MFP"/"LY") in selection order.
  const orderedMeasures = useMemo(() => {
    const sel = (levels.measures || [])
      .map((k) => MEASURE_LEVEL_TO_ROW[k])
      .filter(Boolean);
    if (sel.length) return sel;
    const seen = [];
    filteredRecords.forEach((r) => {
      if (!seen.includes(r.measure)) seen.push(r.measure);
    });
    return seen;
  }, [levels, filteredRecords]);

  // Manual pivot tree: pure dimension hierarchy (Home > Bath > ...) with
  // per-(dimension-path, measure) aggregated component values. Rendered as a
  // flat, manually-expanded, cell-spanned grid so that at every level the
  // dimension groups first and the measure is innermost (one row per measure).
  const SEP = "\u0001"; // path segment separator
  // The manual (custom) pivot is used whenever measures OR metrics is the
  // innermost row dimension: it renders a dedicated inner column (Measure or
  // Metric) and repeats each dimension row once per inner value.
  const manualPivotActive = measuresInRows || metricsInRows;
  const manualPivot = useMemo(() => {
    if (!manualPivotActive) return null;

    const colComboMap = new Map(); // key -> ordered col field values
    const childrenOrder = new Map(); // parentPk -> ordered [childValue]
    const childSeen = new Map(); // parentPk -> Set(childValue)
    const cellMap = new Map(); // `${pk}\u0002${measure}` -> { colKey: comps }
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

      // Aggregate into every column prefix (as well as the full key) so a
      // collapsed column group can display a rolled-up summary column.
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
        // When there are no row dimensions the prefix is empty; use "" so the
        // path key ("") matches the cell key built from prefix.join below.
        const value = prefix[d - 1] ?? "";
        const parentPk = prefix.slice(0, d - 1).join(SEP);
        const pk = prefix.join(SEP);
        addChild(parentPk, value);

        const cellKey = `${pk}\u0002${r.measure}`;
        let cells = cellMap.get(cellKey);
        if (!cells) {
          cells = {};
          cellMap.set(cellKey, cells);
        }
        colKeys.forEach((ck) => {
          const cell = cells[ck] || {
            slsU: 0,
            sls$: 0,
            gm$: 0,
            mfp: 0,
            ly: 0,
            varLY: 0,
            _n: 0,
          };
          cell.slsU += r.slsU || 0;
          cell["sls$"] += r["sls$"] || 0;
          cell.gm$ += r.gm$ || 0;
          cell.mfp += r.mfp || 0;
          cell.ly += r.ly || 0;
          cell.varLY += r.varLY || 0;
          cell._n += 1;
          cells[ck] = cell;
        });
      }
    });

    // Sort each level's children alphabetically for stable display order.
    childrenOrder.forEach((arr) =>
      arr.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );

    // Order column combos by the natural order of colLevelFields values
    const colCombos = Array.from(colComboMap.entries()).map(
      ([key, values]) => ({ key, values }),
    );
    colCombos.sort((a, b) => {
      for (let i = 0; i < a.values.length; i++) {
        const av = String(a.values[i] ?? "");
        const bv = String(b.values[i] ?? "");
        if (av !== bv) return av < bv ? -1 : 1;
      }
      return 0;
    });

    return { colCombos, childrenOrder, cellMap, maxDepth };
  }, [manualPivotActive, filteredRecords, rowLevelFields, colLevelFields]);

  // Inner row values: rows repeat once per selected measure and/or metric.
  //  • only measures in rows -> one row per measure
  //  • only metrics in rows  -> one row per metric
  //  • both in rows          -> one row per (outer × inner) combination, where
  //    the outer/inner order follows the order in arrangement.rows.
  const innerIsMetric = metricsInRows && !measuresInRows;
  const bothInner = measuresInRows && metricsInRows;
  const innerMetricKeys = useMemo(
    () => (levels.metrics && levels.metrics.length ? levels.metrics : ["slsU"]),
    [levels],
  );
  // Ordered inner row dimensions (subset of ["measures","metrics"]) as they
  // appear in the row arrangement (first = outer, second = inner).
  const rowInnerDims = useMemo(
    () => arrangement.rows.filter((d) => d === "measures" || d === "metrics"),
    [arrangement],
  );

  // Expand/collapse state for the manual pivot (set of expanded dimension
  // path keys). Reset whenever the row dimensions change.
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());
  useEffect(() => {
    setExpandedKeys(new Set());
  }, [rowLevelFields]);

  const toggleManualExpand = useCallback((pathKey) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) next.delete(pathKey);
      else next.add(pathKey);
      return next;
    });
  }, []);

  // Flatten the tree into visible rows based on expand state. Each dimension
  // node emits one row per inner combo (measure and/or metric); the first row
  // carries the label + chevron and spans the rest via cell spanning.
  const manualRows = useMemo(() => {
    if (!manualPivot) return null;
    const { childrenOrder, cellMap, maxDepth } = manualPivot;
    const out = [];
    let nodeCounter = 0;

    // Build the ordered list of inner row "combos" (one grid row each). Each
    // combo records its measure and/or metric plus grouping markers used by the
    // pinned Measure/Metric columns for cell-merging.
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
        const pk = parentPk ? `${parentPk}${SEP}${value}` : value;
        const hasChildren =
          depth + 1 < maxDepth && (childrenOrder.get(pk)?.length || 0) > 0;
        const expanded = expandedKeys.has(pk);
        const alt = nodeCounter % 2 === 1; // alternating group band
        nodeCounter += 1;
        // Component cells for this node, indexed by measure then column key.
        const cellsByMeasure = {};
        orderedMeasures.forEach((m) => {
          cellsByMeasure[m] = cellMap.get(`${pk}\u0002${m}`) || {};
        });
        combos.forEach((combo, ci) => {
          const measure = combo.measure ?? orderedMeasures[0];
          out.push({
            id: `${pk}\u0002${combo.measure ?? ""}\u0002${
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
  }, [
    manualPivot,
    expandedKeys,
    orderedMeasures,
    innerIsMetric,
    bothInner,
    innerMetricKeys,
    rowInnerDims,
  ]);

  const gridRecords = useMemo(() => {
    if (manualPivotActive && manualPivot) return manualRows || [];
    if (!metricsInRows && !metricsOutermostCol) return filteredRecords;
    const selectedMetrics = levels.metrics || [];
    // For each record, create one row per selected metric.
    // metricValue holds the additive component for aggregation:
    //   sls$ and gm$ are additive; aur/auc/gm% need special aggregation.
    //   We store raw additive values and tag the metric type for the custom aggFunc.
    const unpivoted = [];
    filteredRecords.forEach((r) => {
      selectedMetrics.forEach((metricKey) => {
        const metricMeta = METRIC_LEVELS.find((m) => m.key === metricKey);
        unpivoted.push({
          ...r,
          metric: metricMeta?.label || metricKey,
          metricKey,
          // Store raw components for aggregation
          _slsU: r.slsU || 0,
          _sls$: r["sls$"] || 0,
          _gm$: r["gm$"] || 0,
        });
      });
    });
    return unpivoted;
  }, [
    filteredRecords,
    metricsInRows,
    metricsOutermostCol,
    levels,
    manualPivotActive,
    manualPivot,
    manualRows,
  ]);

  const pushHistory = useCallback(() => {
    setHistory((prev) => [...prev.slice(-9), recordsRef.current]);
  }, []);

  const handleCellValueChanged = useCallback(
    (params) => {
      if (params.column.getColDef().field !== "slsU") return;
      const filter = getCellFilter(
        params,
        rowFieldsRef.current,
        columnFieldsRef.current,
      );
      if (filter.measure !== "WCF") return;

      pushHistory();
      const newRecords = updateBaseData(
        recordsRef.current,
        filter,
        params.newValue,
      );
      setRecords(newRecords);
    },
    [pushHistory],
  );

  const handleGridReady = useCallback(() => {}, []);

  const gridOptions = useMemo(
    () =>
      buildGridOptions({
        arrangement,
        levels,
        compact,
        visibleMetrics,
        manualPivot,
        colLevelFields,
        onCellValueChanged: handleCellValueChanged,
        onGridReady: handleGridReady,
        onToggleManualExpand: toggleManualExpand,
      }),
    [
      arrangement,
      levels,
      compact,
      visibleMetrics,
      manualPivot,
      colLevelFields,
      handleCellValueChanged,
      handleGridReady,
      toggleManualExpand,
    ],
  );

  const applyArrangement = useCallback((newArrangement) => {
    setArrangement(newArrangement);
  }, []);

  const updateLevels = useCallback((newLevels) => {
    setLevels(newLevels);
  }, []);

  const toggleMetric = useCallback((key) => {
    if (key === "slsU") return; // WCF is always visible
    setVisibleMetrics((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }, []);

  const setAllMetrics = useCallback((keys) => {
    setVisibleMetrics(keys);
  }, []);

  const toggleCompact = useCallback(() => {
    setCompact((prev) => !prev);
  }, []);

  const flip = useCallback(() => {
    setArrangement((prev) => flipArrangement(prev));
  }, []);

  const undo = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const previous = prev[prev.length - 1];
      setRecords(previous);
      return prev.slice(0, -1);
    });
  }, []);

  const save = useCallback(async () => {
    const changed = records; // In a real app filter to changed records only.
    const res = await saveEdits({ records: changed });
    console.log("Mock save response", res);
  }, [records]);

  return {
    loading,
    records: gridRecords,
    arrangement,
    levels,
    visibleMetrics,
    compact,
    gridOptions,
    applyArrangement,
    updateLevels,
    toggleMetric,
    setAllMetrics,
    toggleCompact,
    flip,
    undo,
    save,
  };
}
