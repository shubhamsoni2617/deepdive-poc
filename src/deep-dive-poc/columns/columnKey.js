/** Stable key built from an ordered list of column-dimension values. */
export function buildManualColumnKey(values) {
  return values.join("||");
}

// Separates per-axis segments in an independent-axis column key. A key encodes
// one coordinate per real column dimension (axis), each an ordered prefix of
// that axis's drilled values (empty = the axis at Total). For a single axis
// this is identical to buildManualColumnKey, so existing single-dim column
// paths are unaffected.
export const COL_AXIS_SEP = "\u0004";

export function buildAxisColumnKey(axisValueArrays) {
  return axisValueArrays.map((a) => a.join("||")).join(COL_AXIS_SEP);
}
