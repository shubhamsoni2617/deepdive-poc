/**
 * React cell renderer for the manual-pivot Product/Location column.
 * Renders the dimension label with indentation and an expand/collapse chevron.
 * With cell spanning, only the first measure row of each dimension node renders
 * this cell (it spans the remaining measure rows).
 */
export default function ProductTreeCell(params) {
  const data = params?.data;
  if (!data) return null;

  const depth = data.__depth || 0;

  // Fake merge: only the first measure row of a node shows the label + chevron.
  if (!data.__isFirst) {
    return (
      <span className="dd-tree-cell" style={{ paddingLeft: depth * 16 }} />
    );
  }

  const onToggle = (e) => {
    e.stopPropagation();
    if (params.context && params.context.onToggleManualExpand) {
      params.context.onToggleManualExpand(data.__pathKey);
    }
  };

  return (
    <span className="dd-tree-cell" style={{ paddingLeft: depth * 16 }}>
      {data.__hasChildren ? (
        <span
          className="dd-tree-chevron"
          role="button"
          tabIndex={0}
          onClick={onToggle}
        >
          {data.__expanded ? "\u25be" : "\u25b8"}
        </span>
      ) : (
        <span className="dd-tree-chevron dd-tree-chevron--empty" />
      )}
      <span
        className={`dd-tree-label${depth === 0 ? " dd-tree-label--top" : ""}`}
      >
        {data.__label != null ? String(data.__label) : ""}
      </span>
    </span>
  );
}
