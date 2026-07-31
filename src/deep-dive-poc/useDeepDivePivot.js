import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { fetchDeepDiveData, saveEdits } from "./api";
import { MEASURE_LEVEL_TO_ROW, DEFAULT_LEVELS } from "./config/dimensions";
import { DEFAULT_ARRANGEMENT } from "./config/arrangements";
import { METRICS } from "./config/metrics";
import {
  classifyArrangement,
  flipArrangement,
  metricsIsOutermost,
} from "./model/arrangement";
import { expandLevelFields, getDimensionFields } from "./model/dimensionFields";
import { getCellFilter, updateBaseData } from "./model/edits";
import {
  buildManualPivotModel,
  buildManualRows,
} from "./model/manualPivotModel";
import { unpivotByMetric } from "./model/unpivot";
import { buildGridOptions } from "./grid/gridOptions";

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

  // Arrangement classification drives every downstream mode decision.
  const { metricsInRows, manualPivotActive, innerIsMetric, bothInner } =
    useMemo(() => classifyArrangement(arrangement), [arrangement]);
  const metricsOutermostCol = useMemo(
    () => metricsIsOutermost(arrangement),
    [arrangement],
  );

  // Filter records to the selected measures (pivot is the source of truth).
  const filteredRecords = useMemo(() => {
    const allowed = (levels.measures || [])
      .map((k) => MEASURE_LEVEL_TO_ROW[k])
      .filter(Boolean);
    if (allowed.length === 0) return records;
    return records.filter((r) => allowed.includes(r.measure));
  }, [records, levels]);

  const rowLevelFields = useMemo(
    () => expandLevelFields(arrangement.rows, levels),
    [arrangement, levels],
  );
  const colLevelFields = useMemo(
    () => expandLevelFields(arrangement.columns, levels),
    [arrangement, levels],
  );

  // Ordered measure data-values in selection order (fallback to data order).
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

  const innerMetricKeys = useMemo(
    () => (levels.metrics && levels.metrics.length ? levels.metrics : ["slsU"]),
    [levels],
  );
  const rowInnerDims = useMemo(
    () => arrangement.rows.filter((d) => d === "measures" || d === "metrics"),
    [arrangement],
  );

  const manualPivot = useMemo(() => {
    if (!manualPivotActive) return null;
    return buildManualPivotModel({
      filteredRecords,
      rowLevelFields,
      colLevelFields,
    });
  }, [manualPivotActive, filteredRecords, rowLevelFields, colLevelFields]);

  // Expand/collapse state for the manual pivot; reset when row dims change.
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

  const manualRows = useMemo(
    () =>
      buildManualRows({
        manualPivot,
        expandedKeys,
        orderedMeasures,
        innerIsMetric,
        bothInner,
        innerMetricKeys,
        rowInnerDims,
      }),
    [
      manualPivot,
      expandedKeys,
      orderedMeasures,
      innerIsMetric,
      bothInner,
      innerMetricKeys,
      rowInnerDims,
    ],
  );

  const gridRecords = useMemo(() => {
    if (manualPivotActive && manualPivot) return manualRows || [];
    if (!metricsInRows && !metricsOutermostCol) return filteredRecords;
    return unpivotByMetric(filteredRecords, levels.metrics || []);
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
      setRecords(updateBaseData(recordsRef.current, filter, params.newValue));
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
      setRecords(prev[prev.length - 1]);
      return prev.slice(0, -1);
    });
  }, []);

  const save = useCallback(async () => {
    const res = await saveEdits({ records });
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
