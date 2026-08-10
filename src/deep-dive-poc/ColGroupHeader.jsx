/**
 * Custom AG Grid column group header for the independent column-axis layout.
 * Renders the group label plus a chevron that toggles the axis node's expand
 * state (via context.onToggleColExpand). Expansion is global across the outer
 * axes' columns, so e.g. expanding "Location Total" reveals channels under
 * every time period at once.
 */
export default function ColGroupHeader(props) {
  const label = props?.label ?? props?.displayName ?? "";
  const { expandable, expanded, toggleKey } = props || {};

  const onToggle = (e) => {
    e.stopPropagation();
    if (props?.context?.onToggleColExpand && toggleKey != null) {
      props.context.onToggleColExpand(toggleKey);
    }
  };

  return (
    <span className="dd-colh">
      {expandable ? (
        <span
          className={`dd-colh-chevron${expanded ? " dd-colh-chevron--open" : ""}`}
          onClick={onToggle}
          role="button"
        >
          {expanded ? "\u2039" : "\u203a"}
        </span>
      ) : null}
      <span className="dd-colh-label">{label != null ? String(label) : ""}</span>
    </span>
  );
}
