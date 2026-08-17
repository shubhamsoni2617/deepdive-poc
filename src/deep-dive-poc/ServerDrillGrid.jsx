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
import {
  buildValueColumns,
  TreeCell,
  InnerRowCell,
  ShimmerRow,
} from "./columns/contractColumns.jsx";
import { DIMENSIONS } from "./config/dimensions";

// Pinned-column header labels.
const HIER_LABEL = { product: "Product", store: "Location", time: "Week" };
const INNER_LABEL = {
  [DIMENSIONS.MEASURES]: "Measure",
  [DIMENSIONS.METRICS]: "Metric",
  [DIMENSIONS.TIME]: "Week",
};

// The value-block key each inner-row value dim contributes (used to look up the
// per-row group-boundary flag so each pinned column draws its own separator).
const INNER_CELL_KEY = {
  [DIMENSIONS.MEASURES]: "measure",
  [DIMENSIONS.METRICS]: "metric",
  [DIMENSIONS.TIME]: "week",
};

export default function ServerDrillGrid({ config, compact = true }) {
  const { loading, rows, expand } = useServerDrillTree({ config });

  const columnDefs = useMemo(() => {
    if (!config) return [];
    // First loaded node with a value block drives the column tree.
    const sample = rows.find(
      (r) =>
        r.node?.measureCells && Object.keys(r.node.measureCells).length > 0,
    );
    const sampleCells = sample ? sample.node.measureCells : null;
    const valueCols = sampleCells ? buildValueColumns(config, sampleCells) : [];

    const pinned = [];
    // Drillable hierarchy tree columns (Product / Location).
    config.hierDims.forEach((h, i) => {
      pinned.push({
        headerName: HIER_LABEL[h.dim] || h.dim,
        pinned: "left",
        width: i === 0 ? 220 : 160,
        colId: `__hier_${h.dim}`,
        cellRenderer: TreeCell,
        cellRendererParams: { dim: h.dim, primary: i === 0 },
        cellClass: "dd-tree-col",
        // The tree column merges across its contiguous run (same value + all
        // columns to its left); its separator draws only at the run's last row,
        // so a merged ancestor (e.g. Product) spans all its drilled child rows.
        cellClassRules: {
          "dd-rowsep": (p) => Boolean(p.data?.__hierGrpLast?.[h.dim]),
        },
      });
    });
    // Inner-row value-dim label columns (Measure / Metric / Week).
    config.innerRowDims.forEach((d) => {
      const key = INNER_CELL_KEY[d];
      pinned.push({
        headerName: INNER_LABEL[d] || d,
        pinned: "left",
        width: 150,
        colId: `__inner_${d}`,
        cellClass: "dd-measure-cell",
        cellRenderer: InnerRowCell,
        cellRendererParams: { dim: d },
        // Each inner dim draws its separator only at its OWN group boundary:
        // the outer dim (Measure) merges across its inner rows while the leaf
        // dim (Metric) separates every row.
        cellClassRules: {
          "dd-rowsep": (p) => Boolean(p.data?.__grpLast?.[key]),
        },
      });
    });
    return [...pinned, ...valueCols];
  }, [rows, config]);

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
          isFullWidthRow={(p) => Boolean(p.rowNode?.data?.__shimmer)}
          fullWidthCellRenderer={ShimmerRow}
          defaultColDef={{ sortable: false, resizable: true, minWidth: 80 }}
          headerHeight={compact ? 40 : 44}
          groupHeaderHeight={compact ? 36 : 40}
          rowHeight={compact ? 40 : 44}
          suppressAggFuncInHeader
        />
      )}
    </div>
  );
}
