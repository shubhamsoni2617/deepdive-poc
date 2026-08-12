/**
 * Shared column-grouping primitives for the manual pivot builders.
 *
 * These encode the two structural rules that every column topology repeats,
 * regardless of whether the axis is Time, Product/Location, measures or
 * metrics:
 *   1. group a flat list of combos by the value at one level, preserving
 *      first-seen order (`groupByOrdered`);
 *   2. wrap a rolled-up "summary" + a per-value "detail" into one collapsible
 *      AG Grid group where the summary shows when closed and the detail when
 *      open (`collapsibleGroup`).
 * Centralising them keeps the builders declarative and DRY.
 */

/**
 * Group `items` by `keyFn`, preserving the order keys are first encountered.
 * @returns {{ order: any[], map: Map<any, any[]> }}
 */
export const groupByOrdered = (items, keyFn) => {
  const order = [];
  const map = new Map();
  items.forEach((item) => {
    const k = keyFn(item);
    if (!map.has(k)) {
      map.set(k, []);
      order.push(k);
    }
    map.get(k).push(item);
  });
  return { order, map };
};

/**
 * A collapsible AG Grid column group: `summary` columns (already tagged
 * columnGroupShow:"closed") render when the group is collapsed; `detail`
 * columns/groups render when expanded. Starts collapsed.
 */
export const collapsibleGroup = ({
  headerName,
  groupId,
  headerClass,
  summary,
  detail,
}) => ({
  headerName,
  groupId,
  headerClass,
  openByDefault: false,
  children: [
    ...summary,
    ...detail.map((d) => ({ ...d, columnGroupShow: "open" })),
  ],
});
