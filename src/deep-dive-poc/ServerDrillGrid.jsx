/**
 * Server-driven Deep Dive grid (original look, backend aggregation).
 *
 * Rows come straight from POST /api/deep-dive/pivot; every hierarchy expand is
 * a fresh backend call (see useServerDrillTree). This component is a thin
 * wrapper: column building + cell rendering live in columns/contractColumns.
 */

import { useMemo } from "react";
import "./agGridSetup";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";
import "./deepDive.css";
import { useServerDrillTree } from "./useServerDrillTree";
import { buildValueColumns, TreeCell } from "./columns/contractColumns.jsx";

export default function ServerDrillGrid({
  measures,
  metrics,
  timeOrder,
  compact = true,
}) {
  const { loading, rows, expand } = useServerDrillTree({
    measures,
    metrics,
    timeOrder,
  });

  const columnDefs = useMemo(() => {
    const sample = rows.find((r) => r.node?.measureCells?.[r.measure]);
    const sampleCells = sample
      ? sample.node.measureCells[sample.measure]
      : null;
    const valueCols = sampleCells
      ? buildValueColumns(sampleCells, timeOrder, metrics)
      : [];
    return [
      {
        headerName: "Product",
        pinned: "left",
        width: 220,
        colId: "__product",
        cellRenderer: TreeCell,
        cellRendererParams: { dim: "product" },
        cellClass: "dd-tree-col",
      },
      {
        headerName: "Location",
        pinned: "left",
        width: 150,
        colId: "__location",
        cellRenderer: TreeCell,
        cellRendererParams: { dim: "location" },
        cellClass: "dd-tree-col",
      },
      {
        headerName: "Measure",
        pinned: "left",
        width: 90,
        colId: "__measure",
        cellClass: "dd-measure-cell",
        valueGetter: (p) => p.data?.measure || "",
      },
      ...valueCols,
    ];
  }, [rows, timeOrder, metrics]);

  const gridKey = useMemo(
    () =>
      columnDefs.map((c) => c.colId || c.groupId).join("|") +
      (compact ? "-c" : "-t"),
    [columnDefs, compact],
  );

  return (
    <div className="dd-grid ag-theme-alpine dd-manual">
      {loading ? (
        <div className="dd-loading">Loading…</div>
      ) : (
        <AgGridReact
          key={gridKey}
          columnDefs={columnDefs}
          rowData={rows}
          getRowId={(p) => p.data.id}
          context={{ expand }}
          defaultColDef={{ sortable: false, resizable: true, minWidth: 80 }}
          headerHeight={compact ? 34 : 42}
          groupHeaderHeight={compact ? 32 : 40}
          rowHeight={compact ? 34 : 42}
          suppressAggFuncInHeader
        />
      )}
    </div>
  );
}
