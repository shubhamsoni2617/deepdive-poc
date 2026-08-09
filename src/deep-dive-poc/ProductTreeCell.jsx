/**
 * React cell renderer for a manual-pivot row-dimension tree column.
 * Each row dimension has its own column, identified by `axisIdx`, and reads its
 * label, depth, chevron and expand-state from the row's `__axis[axisIdx]` entry
 * so every dimension (Product, Location, Time, …) expands independently.
 * With cell spanning, only the first measure row of each node renders the label
 * (it spans the remaining measure rows).
 */
export default function ProductTreeCell(params) {
  const data = params?.data;
  if (!data) return null;

  const axisIdx = params?.axisIdx ?? 0;
  const node = data.__axis && data.__axis[axisIdx];
  if (!node) return <span className="dd-tree-cell" />;

  const depth = node.depth || 0;

  // Cell-merge: only the row that "owns" the label renders it; the rest are
  // blank spacers (keeping the indent so borders line up).
  if (!node.show) {
    return (
      <span
        className="dd-tree-cell"
        style={{ paddingLeft: Math.max(depth, 0) * 16 }}
      />
    );
  }

  const { label, hasChildren, expanded, pathKey: toggleKey } = node;
  const absDepth = depth;

  const onToggle = (e) => {
    e.stopPropagation();
    if (params.context && params.context.onToggleManualExpand) {
      params.context.onToggleManualExpand(toggleKey);
    }
  };

  return (
    <span className="dd-tree-cell" style={{ paddingLeft: depth * 16 }}>
      {hasChildren ? (
        <span
          className="dd-tree-chevron"
          role="button"
          tabIndex={0}
          onClick={onToggle}
        >
          {expanded ? "\u25be" : "\u25b8"}
        </span>
      ) : (
        <span className="dd-tree-chevron dd-tree-chevron--empty" />
      )}
      <span
        className={`dd-tree-label${absDepth === 0 ? " dd-tree-label--top" : ""}`}
      >
        {label != null ? String(label) : ""}
      </span>
    </span>
  );
}
