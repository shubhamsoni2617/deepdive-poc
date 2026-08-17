/**
 * Column builders + cell renderers for the server-driven contract grid.
 *
 * GENERIC over the pivot selection (see model/contractRequest.js):
 *   - metricMeta:        metric key -> { header, formatter }
 *   - buildValueColumns: nested column groups over the COLUMN value dims
 *     (measure/week/metric, canonical nesting order), reading each cell by
 *     merging the row's inner coordinate with the column's coordinate.
 *   - TreeCell:          pinned hierarchy (product/location) tree cell + chevron
 *   - InnerRowCell:      pinned label cell for an inner-row value dim
 */

import {
  formatNumber,
  formatCurrency,
  formatPercent,
} from "../format/formatters";
import { labelTime } from "../config/timeAxis";
import { DIMENSIONS } from "../config/dimensions";

const fmtInt = (v) => formatNumber(v, 0);

// Metric key -> short column header + value formatter.
const METRIC_META = {
  sls_u: { head: "Sls U", fmt: fmtInt },
  sls_dollars: { head: "Sls $", fmt: formatCurrency },
  cogs: { head: "COGS", fmt: formatCurrency },
  gm_dollars: { head: "GM $", fmt: formatCurrency },
  aur: { head: "AUR", fmt: formatCurrency },
  auc: { head: "AUC", fmt: formatCurrency },
  gm_pct: { head: "GM%", fmt: formatPercent },
};

export const metricMeta = (m) =>
  METRIC_META[m] || { head: String(m).toUpperCase(), fmt: fmtInt };

// Value-dimension -> the value-block key it contributes (canonical nest order).
const CELL_KEY = {
  [DIMENSIONS.MEASURES]: "measure",
  [DIMENSIONS.TIME]: "week",
  [DIMENSIONS.METRICS]: "metric",
};

/**
 * Ordered value-block nesting levels. Prefer the arrangement-driven order from
 * the request config (cfg.blockLevels: row value-dims outer, then column
 * value-dims), so navigate() reads the response in the SAME nesting the payload
 * requested. Falls back to canonical measure ▸ week ▸ metric for older configs.
 */
function blockLevels(cfg) {
  if (Array.isArray(cfg.blockLevels) && cfg.blockLevels.length)
    return cfg.blockLevels;
  const has = (d) => cfg.innerRowDims.includes(d) || cfg.colDims.includes(d);
  const levels = [];
  if (has(DIMENSIONS.MEASURES)) levels.push("measure");
  if (has(DIMENSIONS.TIME)) levels.push("week");
  levels.push("metric");
  return levels;
}

/** Walk the value block using a merged {measure,week,metric} coordinate. */
function navigate(block, coord, levels) {
  let cur = block;
  for (const k of levels) {
    if (cur == null) return null;
    cur = cur[coord[k]];
  }
  return cur == null ? null : cur;
}

/** Member list for a COLUMN value dim, read from the sample block/config. */
function colMembers(dim, cfg, sampleCells) {
  if (dim === DIMENSIONS.MEASURES) return cfg.measures;
  if (dim === DIMENSIONS.METRICS) return cfg.metrics;
  if (dim === DIMENSIONS.TIME) {
    // Week members live at the "week" level of the value block, whose depth
    // depends on the arrangement's nesting order (e.g. measure ▸ week vs
    // week ▸ measure). Descend by blockLevels until we reach "week" and read
    // its keys — never assume a fixed depth.
    const levels = blockLevels(cfg);
    let cur = sampleCells || {};
    for (const k of levels) {
      if (cur == null) return [];
      if (k === "week") {
        return Object.keys(cur).sort((a, b) => Number(a) - Number(b));
      }
      const firstKey = Object.keys(cur)[0];
      cur = firstKey != null ? cur[firstKey] : null;
    }
    return [];
  }
  return [];
}

/** Header label for one member of a value dim. */
function memberLabel(dim, member) {
  if (dim === DIMENSIONS.METRICS) return metricMeta(member).head;
  if (dim === DIMENSIONS.TIME) return labelTime("week", member);
  return String(member); // measure value (WCF / MFP)
}

/** Formatter for a leaf cell: metric-driven (col metric, else the row metric). */
function leafFormatter(lastDim, member) {
  if (lastDim === DIMENSIONS.METRICS) {
    const fmt = metricMeta(member).fmt;
    return (p) => fmt(p.value);
  }
  // metric fixed by the row's inner coordinate.
  return (p) => metricMeta(p.data?.coord?.metric).fmt(p.value);
}

/**
 * Build value columns as nested groups over the COLUMN value dims. Each leaf
 * column reads its cell by merging the row's inner coordinate (row.coord) with
 * the column's fixed coordinate, then walking the value block.
 */
export function buildValueColumns(cfg, sampleCells) {
  const levels = blockLevels(cfg);
  const readCell = (data, colCoord) => {
    if (!data?.node) return null;
    return navigate(
      data.node.measureCells,
      { ...data.coord, ...colCoord },
      levels,
    );
  };

  // No column value dims (all value dims are inner rows, or only a hierarchy is
  // in columns): a single value column shows the row's fully-specified cell.
  if (!cfg.colDims.length) {
    return [
      {
        headerName: "Value",
        colId: "__value",
        width: 110,
        type: "numericColumn",
        headerClass: "dd-metric-head",
        cellClass: "dd-num-cell",
        valueGetter: (p) => readCell(p.data, {}),
        valueFormatter: (p) => metricMeta(p.data?.coord?.metric).fmt(p.value),
      },
    ];
  }

  const build = (idx, pathCoord, pathIds) => {
    const dim = cfg.colDims[idx];
    const key = CELL_KEY[dim];
    const isLast = idx === cfg.colDims.length - 1;
    const members = colMembers(dim, cfg, sampleCells);
    return members.map((m) => {
      const coord = { ...pathCoord, [key]: m };
      const ids = [...pathIds, `${key}=${m}`];
      if (isLast) {
        return {
          headerName: memberLabel(dim, m),
          colId: ids.join("/"),
          width: 92,
          type: "numericColumn",
          headerClass:
            dim === DIMENSIONS.TIME ? "dd-week-head" : "dd-metric-head",
          cellClass: "dd-num-cell",
          valueGetter: (p) => readCell(p.data, coord),
          valueFormatter: leafFormatter(dim, m),
        };
      }
      return {
        headerName: memberLabel(dim, m),
        groupId: ids.join("/"),
        headerClass: dim === DIMENSIONS.TIME ? "dd-week-head" : "dd-month-head",
        children: build(idx + 1, coord, ids),
      };
    });
  };
  return build(0, {}, []);
}

/** Pinned label cell for an inner-row value dim (Measure / Metric / Week). */
export function InnerRowCell(props) {
  const dim = props.colDef?.cellRendererParams?.dim;
  const key = CELL_KEY[dim];
  const member = props.data?.coord?.[key];
  if (member == null) return <span />;
  // Cell-merge: only render the label on the first row of this dim's group.
  if (props.data?.__show && props.data.__show[key] === false) return <span />;
  return <span>{memberLabel(dim, member)}</span>;
}

/** Pinned tree cell: indent + chevron (drills the given axis) + value. */
export function TreeCell(props) {
  const dim = props.colDef?.cellRendererParams?.dim;
  const isPrimary = props.colDef?.cellRendererParams?.primary;
  const node = props.data?.node;
  const block = node?.blocks?.[dim];
  if (!block) return <span className="dd-tree-cell" />;

  // Cell-merge: render the label/chevron only on the first grid row of this
  // column's contiguous run (same value + all columns to its left). This merges
  // both a node's inner sub-rows AND repeated ancestor values across the child
  // rows of a deeper drill (e.g. Product stays merged when Location is drilled).
  const show = props.data.__showHier
    ? props.data.__showHier[dim]
    : props.data.__first;
  if (!show) return <span className="dd-tree-cell" />;

  const indent = isPrimary ? node.depth * 16 : 8;

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
        {dim === DIMENSIONS.TIME
          ? labelTime("week", block.value)
          : String(block.value)}
      </span>
    </span>
  );
}

/** Full-width placeholder row shown while a node's next level is loading. */
export function ShimmerRow(props) {
  const depth = props.data?.depth ?? 1;
  return (
    <div className="dd-shimmer-row" style={{ paddingLeft: 16 + depth * 16 }}>
      <span className="dd-shimmer-bar dd-shimmer-bar--label" />
      <span className="dd-shimmer-bar" />
      <span className="dd-shimmer-bar" />
      <span className="dd-shimmer-bar" />
    </div>
  );
}
