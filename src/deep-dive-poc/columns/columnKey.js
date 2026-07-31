/** Stable key built from an ordered list of column-dimension values. */
export function buildManualColumnKey(values) {
  return values.join("||");
}
