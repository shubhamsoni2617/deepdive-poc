/**
 * Expansion of dimension arrangements into concrete field lists.
 *
 * A "level field" is a real grouping field (e.g. division, week). The
 * measures/metrics value dimensions map to the synthetic fields
 * "measure"/"metric" for AG Grid grouping/pivoting.
 */

import {
  DIMENSIONS,
  isValueDimension,
  selectedLevelsFor,
} from "../config/dimensions";

const VALUE_DIM_FIELD = {
  [DIMENSIONS.MEASURES]: "measure",
  [DIMENSIONS.METRICS]: "metric",
};

/**
 * Ordered real grouping level keys for a set of dimensions (excludes the
 * measures/metrics value dimensions). Used for the manual pivot's row/column
 * hierarchies.
 */
export function expandLevelFields(dims, levels) {
  const fields = [];
  (dims || []).forEach((dim) => {
    if (isValueDimension(dim)) return;
    selectedLevelsFor(dim, levels).forEach((key) => fields.push(key));
  });
  return fields;
}

/**
 * Ordered { dimension, field } descriptors for a set of dimensions, mapping
 * value dimensions to their synthetic measure/metric field. Used to resolve
 * cell filters against AG Grid row/pivot keys.
 */
export function expandDimensionFields(dims, levels) {
  const out = [];
  (dims || []).forEach((dim) => {
    if (isValueDimension(dim)) {
      out.push({ dimension: dim, field: VALUE_DIM_FIELD[dim] });
      return;
    }
    selectedLevelsFor(dim, levels).forEach((field) =>
      out.push({ dimension: dim, field }),
    );
  });
  return out;
}

export function getDimensionFields(arrangement, levels) {
  return {
    rowFields: expandDimensionFields(arrangement.rows, levels),
    columnFields: expandDimensionFields(arrangement.columns, levels),
  };
}
