/**
 * Alternating column-group shading + shared numeric cell/header classes.
 * Centralises the class-name strings and the "which band" decision that were
 * duplicated across the manual and AG-pivot column builders.
 */

export const NUMERIC_CELL_CLASS = "ag-right-aligned-cell";
export const NUMERIC_HEADER_CLASS = "ag-right-aligned-header";

export const GROUP_A = {
  cell: "pvt-col-group-a",
  header: "pvt-header-group-a",
};
export const GROUP_B = {
  cell: "pvt-col-group-b",
  header: "pvt-header-group-b",
};

/** Deterministic band from a value (so the same group is always shaded alike). */
export function shadeByValue(value) {
  const hash = [...String(value)].reduce((a, c) => a + c.charCodeAt(0), 0);
  return hash % 2 === 1 ? GROUP_B : GROUP_A;
}

/** Band by ordinal index (used for metric-outer groups). */
export function shadeByIndex(index) {
  return index % 2 === 1 ? GROUP_B : GROUP_A;
}
