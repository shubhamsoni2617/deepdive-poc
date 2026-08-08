import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { fetchDeepDiveData, saveEdits } from "./api";
import {
  MEASURE_LEVEL_TO_ROW,
  DEFAULT_LEVELS,
  selectedLevelsFor,
} from "./config/dimensions";
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
  LOC_MARK,
  PATH_SEP,
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

  // First real row dimension = drillable Product tree; the rest form the
  // independent Location tree (Total → level1 → level2) nested per product node.
  const rowDimGroups = useMemo(
    () =>
      arrangement.rows
        .filter((d) => d !== "measures" && d !== "metrics")
        .map((dim) => ({ dim, fields: selectedLevelsFor(dim, levels) }))
        .filter((g) => g.fields.length > 0),
    [arrangement, levels],
  );
  const productFields = useMemo(
    () => rowDimGroups[0]?.fields || [],
    [rowDimGroups],
  );
  const locationFields = useMemo(
    () => rowDimGroups.slice(1).flatMap((g) => g.fields),
    [rowDimGroups],
  );

  const manualPivot = useMemo(() => {
    if (!manualPivotActive) return null;
    return buildManualPivotModel({
      filteredRecords,
      productFields,
      locationFields,
      colLevelFields,
    });
  }, [
    manualPivotActive,
    filteredRecords,
    productFields,
    locationFields,
    colLevelFields,
  ]);

  // Expand/collapse state for the manual pivot; reset when row dims change.
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());
  useEffect(() => {
    setExpandedKeys(new Set());
  }, [rowLevelFields]);

  // Accordion within each level, applied independently per axis: expanding a
  // node collapses its siblings (and their descendants) on the SAME axis, while
  // leaving the other axis untouched. Product keys have no LOC_MARK; Location
  // keys are `<productPath>LOC_MARK<locPath>`.
  const toggleManualExpand = useCallback((key) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      const locIdx = key.indexOf(LOC_MARK);

      if (next.has(key)) {
        // Collapsing: also clear expand-state of all descendants so they don't
        // reappear expanded.
        if (locIdx === -1) {
          // Product node: deeper product keys + any location keys beneath it.
          for (const ek of Array.from(next)) {
            if (
              ek === key ||
              ek.startsWith(key + PATH_SEP) ||
              ek.startsWith(key + LOC_MARK)
            ) {
              next.delete(ek);
            }
          }
        } else {
          // Location node: itself + deeper location nodes in the same product.
          // (Total has empty locPath, so it clears the whole location subtree.)
          const branchPrefix = key.slice(0, locIdx) + LOC_MARK;
          const segs = key
            .slice(locIdx + 1)
            .split(PATH_SEP)
            .filter(Boolean);
          for (const ek of Array.from(next)) {
            if (!ek.startsWith(branchPrefix)) continue;
            const ekSegs = ek
              .slice(branchPrefix.length)
              .split(PATH_SEP)
              .filter(Boolean);
            if (ekSegs.length < segs.length) continue;
            if (segs.every((s, i) => ekSegs[i] === s)) next.delete(ek);
          }
        }
        return next;
      }

      if (locIdx === -1) {
        // Product axis: collapse product siblings, ignore location keys.
        const sepIdx = key.lastIndexOf(PATH_SEP);
        const parent = sepIdx === -1 ? "" : key.slice(0, sepIdx);
        for (const ek of Array.from(next)) {
          if (ek.indexOf(LOC_MARK) !== -1) continue;
          const inBranch = parent === "" || ek.startsWith(parent + PATH_SEP);
          if (!inBranch) continue;
          const selfOrDesc = ek === key || ek.startsWith(key + PATH_SEP);
          const isAnc = (key + PATH_SEP).startsWith(ek + PATH_SEP);
          if (!selfOrDesc && !isAnc) next.delete(ek);
        }
        // Same row: expanding Product collapses this product's Location tree.
        for (const ek of Array.from(next)) {
          if (ek.startsWith(key + LOC_MARK)) next.delete(ek);
        }
      } else {
        // Location axis: collapse only SAME-LEVEL sibling location nodes (and
        // their descendants) within the SAME product node. Ancestors such as
        // "Total" (fewer segments) are always kept.
        const branchPrefix = key.slice(0, locIdx) + LOC_MARK;
        const locPath = key.slice(locIdx + 1);

        // Only ONE product node may have its Location tree expanded at a time:
        // collapse every location key that belongs to a different product.
        for (const ek of Array.from(next)) {
          const ekLocIdx = ek.indexOf(LOC_MARK);
          if (ekLocIdx === -1) continue;
          if (!ek.startsWith(branchPrefix)) next.delete(ek);
        }

        // Same row: expanding Location collapses this product's Product tree.
        const prod = key.slice(0, locIdx);
        for (const ek of Array.from(next)) {
          if (ek.indexOf(LOC_MARK) !== -1) continue;
          if (ek === prod || ek.startsWith(prod + PATH_SEP)) next.delete(ek);
        }

        const segs = locPath === "" ? [] : locPath.split(PATH_SEP);
        const level = segs.length; // Total=0, channel=1, store=2, …
        if (level > 0) {
          const parentPrefix = segs.slice(0, level - 1).join(PATH_SEP);
          for (const ek of Array.from(next)) {
            if (!ek.startsWith(branchPrefix)) continue;
            const ekLoc = ek.slice(branchPrefix.length);
            const ekSegs = ekLoc === "" ? [] : ekLoc.split(PATH_SEP);
            if (ekSegs.length < level) continue; // ancestors: keep
            const ekParent = ekSegs.slice(0, level - 1).join(PATH_SEP);
            const ekAtLevel = ekSegs.slice(0, level).join(PATH_SEP);
            // Same parent + same level, but a different node → sibling subtree.
            if (ekParent === parentPrefix && ekAtLevel !== locPath) {
              next.delete(ek);
            }
          }
        }
      }

      next.add(key);
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
