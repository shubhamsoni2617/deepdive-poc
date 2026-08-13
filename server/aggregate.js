/**
 * View-grain aggregation over the base-grain mock records (client schema).
 *
 * The grid's pivot engine only needs additive component fields per
 * (grain, measure): { slsU, sls$, gm$, mfp, ly, varLY, _n }. It re-sums these
 * up the row/column tree and recomputes ratios. So we can pre-aggregate the
 * raw facts to the deepest selected grain (rowFields ∪ colFields) server-side
 * and hand back a much smaller flat set — the renderer is unchanged.
 */

import { generateMockData } from "../src/deep-dive-poc/mockData.js";
import { COMPONENT_FIELDS } from "../src/deep-dive-poc/config/metrics.js";

let BASE = null;
function baseFacts() {
  // Strip the redundant per-record `stores` array once; cache the result.
  if (!BASE) BASE = generateMockData().map(({ stores, ...rest }) => rest);
  return BASE;
}

/**
 * Aggregate to the requested grain.
 * @param {string[]} rowFields  ordered row level-fields (deepest selected)
 * @param {string[]} colFields  ordered column level-fields (deepest selected)
 * @param {string[]} measures   measure values to include (empty = all)
 * @returns {{ data: object[], meta: object }}
 */
export function aggregateRecords({
  rowFields = [],
  colFields = [],
  measures = [],
} = {}) {
  const facts = baseFacts();

  // Grain = every distinct dimension field the view groups by, plus measure.
  const grainFields = Array.from(new Set([...rowFields, ...colFields]));
  const measureSet = measures.length ? new Set(measures) : null;

  const groups = new Map();

  for (const r of facts) {
    if (measureSet && !measureSet.has(r.measure)) continue;

    const keyParts = grainFields.map((f) => r[f]);
    keyParts.push(r.measure);
    const key = keyParts.join("\u0001");

    let g = groups.get(key);
    if (!g) {
      g = { __key: key };
      grainFields.forEach((f) => (g[f] = r[f]));
      g.measure = r.measure;
      COMPONENT_FIELDS.forEach((f) => (g[f] = 0));
      g._n = 0;
      groups.set(key, g);
    }
    COMPONENT_FIELDS.forEach((f) => (g[f] += r[f] || 0));
    g._n += 1;
  }

  let id = 1;
  const data = [];
  for (const g of groups.values()) {
    const { __key, ...rest } = g;
    data.push({ id: id++, ...rest });
  }

  return {
    data,
    meta: {
      totalRecords: data.length,
      baseRecords: facts.length,
      grainFields,
      measures: measures.length ? measures : "all",
    },
  };
}
