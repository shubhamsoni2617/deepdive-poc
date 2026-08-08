/**
 * React cell renderer for the manual-pivot Product/Location column.
 * Renders the dimension label with indentation and an expand/collapse chevron.
 * With cell spanning, only the first measure row of each dimension node renders
 * this cell (it spans the remaining measure rows).
 */
export default function ProductTreeCell(params) {
  const data = params?.data;
  if (!data) return null;

  // Product and Location render in separate columns. Each pulls its own label,
  // depth, chevron and expand-state from the row's per-axis context so the two
  // hierarchies expand independently.
  const colType = params?.colType || "product";
  const isLocation = colType === "location";

  const show = isLocation ? data.__locShow : data.__prodShow;
  const depth = (isLocation ? data.__locDepth : data.__prodDepth) || 0;
  const label = isLocation ? data.__locLabel : data.__prodLabel;
  const hasChildren = isLocation
    ? data.__locHasChildren
    : data.__prodHasChildren;
  const expanded = isLocation ? data.__locExpanded : data.__prodExpanded;
  const toggleKey = isLocation ? data.__locPathKey : data.__prodPathKey;

  // Cell-merge: only the row that "owns" the label renders it; the rest are
  // blank spacers (keeping the indent so borders line up).
  if (!show) {
    return (
      <span className="dd-tree-cell" style={{ paddingLeft: depth * 16 }} />
    );
  }

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
        className={`dd-tree-label${depth === 0 ? " dd-tree-label--top" : ""}`}
      >
        {label != null ? String(label) : ""}
      </span>
    </span>
  );
}
