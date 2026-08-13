/**
 * Assemble AG Grid options for an arrangement, delegating column building to
 * the manual or native-pivot column builders based on the arrangement class.
 */

import { DIMENSION_LABELS } from "../config/dimensions";
import { classifyArrangement } from "../model/arrangement";
import { buildManualColDefs } from "../columns/manualColumns";
import {
  buildColDefs,
  processPivotResultColDef,
  processPivotResultColGroupDef,
} from "../columns/pivotColumns";

export function buildGridOptions({
  arrangement,
  levels,
  compact,
  manualPivot,
  colLevelFields,
  colAxisGroups,
  colExpandedKeys,
  onCellValueChanged,
  onGridReady,
  onToggleManualExpand,
  onToggleColExpand,
}) {
  const { manualPivotActive, measureOrMetricInCols, groupingColDims } =
    classifyArrangement(arrangement);

  // Manual pivot path: flat rows + cell spanning, expand/collapse handled here.
  // Active for every arrangement that has a real row dim or a value dim in rows.
  if (manualPivotActive && manualPivot) {
    return {
      columnDefs: buildManualColDefs({
        arrangement,
        levels,
        manualPivot,
        colLevelFields,
        colAxisGroups,
        colExpandedKeys,
      }),
      pivotMode: false,
      rowHeight: 36,
      headerHeight: 36,
      groupHeaderHeight: 36,
      context: { onToggleManualExpand, onToggleColExpand },
      getRowId: (p) => p.data.id,
      rowClassRules: {
        "dd-row-mid": (p) => p.data && !p.data.__isLast,
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

  // When measures/metrics is the ONLY grouping dimension in columns (ignoring
  // time), fix its pivot groups (no collapse toggle, no summary column).
  const suppressPivotExpand =
    measureOrMetricInCols && groupingColDims.length === 0;

  return {
    columnDefs: buildColDefs(arrangement, levels),
    pivotMode,
    rowHeight: 36,
    headerHeight: 36,
    groupHeaderHeight: 36,
    suppressExpandablePivotGroups: suppressPivotExpand,
    pivotDefaultExpanded: 0,
    groupDisplayType: compact ? "singleColumn" : "multipleColumns",
    groupDefaultExpanded: 0,
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
      cellRendererParams: { suppressCount: true },
    },
    groupIncludeTotalFooter: false,
    groupIncludeFooter: false,
    pivotColumnTotals: measureOrMetricInCols ? undefined : "before",
    animateRows: true,
    suppressAggFuncInHeader: true,
    removePivotHeaderRowWhenSingleValueColumn: true,
    suppressRowGroupHidesSingleColumn: false,
    processPivotResultColDef,
    processPivotResultColGroupDef,
    getRowClass: undefined,
    onRowGroupOpened: undefined,
    defaultColDef: {
      resizable: true,
      sortable: true,
      filter: false,
      flex: 1,
      minWidth: 100,
    },
    onCellValueChanged,
    onGridReady,
  };
}
