/**
 * Column builders + cell renderers for the server-driven contract grid.
 *
 * Kept separate from ServerDrillGrid so the component stays a thin wrapper:
 *   - metricMeta:        metric key -> { header, formatter }
 *   - buildValueColumns: time ▸ metric column tree from a sample `cells` object
 *   - TreeCell:          pinned product/location tree cell with drill chevron
 */

import {
  formatNumber,
  formatCurrency,
  formatPercent,
} from "../format/formatters";
import { labelTime } from "../config/timeAxis";

const fmtInt = (v) => formatNumber(v, 0);

// Metric key -> short column header + value formatter.
const METRIC_META = {
  sls_u: { head: "Sls U", fmt: fmtInt },
  sls_d: { head: "Sls $", fmt: formatCurrency },
  gm_d: { head: "GM $", fmt: formatCurrency },
  aur: { head: "AUR", fmt: formatCurrency },
  auc: { head: "AUC", fmt: formatCurrency },
  gm_pct: { head: "GM%", fmt: formatPercent },
};

export const metricMeta = (m) =>
  METRIC_META[m] || { head: String(m).toUpperCase(), fmt: fmtInt };

const getPath = (obj, path) =>
  path.reduce((o, k) => (o == null ? o : o[k]), obj);

/**
 * Build value columns from a sample measure's `cells` (time ▸ metric leaves).
 * Measure is NOT a column group here — it is an inner ROW dimension, so every
 * value column reads the CURRENT row's measure via `row.measure`.
 */
export function buildValueColumns(sampleCells, timeOrder, metrics) {
  const buildTime = (node, path, depth) => {
    const keys = Object.keys(node || {});
    if (!keys.length) return [];
    const first = node[keys[0]];
    // Leaves are the innermost { SLS, AUR } objects whose values are numbers.
    const isLeaf = first === null || typeof first === "number";
    if (isLeaf) {
      // Leaf: emit a column per requested metric (stable order + formatting).
      return metrics.map((mk) => {
        const meta = metricMeta(mk);
        // Leaf keys in the contract response are the RAW metric keys (sls_u…).
        const label = mk;
        return {
          headerName: meta.head,
          colId: [...path, label].join("/"),
          width: 92,
          type: "numericColumn",
          headerClass: "dd-metric-head",
          cellClass: "dd-num-cell",
          valueGetter: (p) => {
            const cells = p.data?.node?.measureCells?.[p.data?.measure];
            return getPath(cells, [...path, label]);
          },
          valueFormatter: (p) => meta.fmt(p.value),
        };
      });
    }
    const levelName = timeOrder[depth] || "time";
    return keys
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => ({
        headerName: labelTime(levelName, k),
        groupId: [...path, k].join("/"),
        headerClass: levelName === "week" ? "dd-week-head" : "dd-month-head",
        children: buildTime(node[k], [...path, k], depth + 1),
      }));
  };

  return buildTime(sampleCells, [], 0);
}

/** Pinned tree cell: indent + chevron (drills the given axis) + value. */
export function TreeCell(props) {
  const dim = props.colDef?.cellRendererParams?.dim;
  const node = props.data?.node;
  const block = node?.[dim];
  if (!block) return <span className="dd-tree-cell" />;

  // Cell-merge: only the FIRST measure sub-row of a node renders the label.
  if (!props.data.__first) return <span className="dd-tree-cell" />;

  const indent = dim === "product" ? node.depth * 16 : 8;

  const onToggle = (e) => {
    e.stopPropagation();
    props.context.expand(node, dim);
  };

  const expandedHere = node.expandedDim === dim;
  return (
    <span className="dd-tree-cell" style={{ paddingLeft: indent }}>
      {block.has_children ? (
        <span
          className="dd-tree-chevron"
          role="button"
          tabIndex={0}
          onClick={onToggle}
          title={expandedHere ? "Collapse" : "Drill down"}
        >
          {node.loading && expandedHere
            ? "\u22ef"
            : expandedHere
              ? "\u25be"
              : "\u25b8"}
        </span>
      ) : (
        <span className="dd-tree-chevron dd-tree-chevron--empty" />
      )}
      <span
        className={`dd-tree-label${node.depth === 0 ? " dd-tree-label--top" : ""}`}
      >
        {String(block.value)}
      </span>
    </span>
  );
}
