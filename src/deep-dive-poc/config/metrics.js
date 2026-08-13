/**
 * Metric registry — the single source of truth for every metric.
 *
 * Previously the same metric knowledge (label, editability, how to aggregate
 * raw components, how to compute the display value, how to format it) was
 * duplicated across constants (METRICS, METRIC_LEVELS), gridConfig
 * (MANUAL_METRICS + a family of bespoke aggFuncs/formatters) and the hook
 * (component accumulation). Everything now derives from METRIC_REGISTRY.
 *
 * A "component" object is the additive raw material a metric is computed from:
 *   { slsU, sls$, gm$, mfp, ly, varLY, _n }
 * Additive metrics read a field directly; ratio metrics (aur/auc/gm%/varLY)
 * divide summed components so they aggregate correctly.
 */

import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from "../format/formatters.js";

/** Additive raw fields carried on every component object. */
export const COMPONENT_FIELDS = ["slsU", "sls$", "gm$", "mfp", "ly", "varLY"];

export function emptyComponents() {
  return { slsU: 0, sls$: 0, gm$: 0, mfp: 0, ly: 0, varLY: 0, _n: 0 };
}

/**
 * Accumulate a data record into a component object (mutates + returns).
 * A raw base-grain record counts as 1; a pre-aggregated record carries its own
 * `_n` (the number of base rows it summarizes) so ratio/average metrics such as
 * varLY stay correct after server-side aggregation.
 */
export function addRecordComponents(target, r) {
  COMPONENT_FIELDS.forEach((f) => {
    target[f] += r[f] || 0;
  });
  target._n += r._n != null ? r._n : 1;
  return target;
}

/** Sum a list of component objects into one (used as an AG Grid aggFunc). */
export function sumComponents(list) {
  const acc = emptyComponents();
  (list || []).forEach((v) => {
    if (v && typeof v === "object") {
      COMPONENT_FIELDS.forEach((f) => {
        acc[f] += v[f] || 0;
      });
      acc._n += v._n || 0;
    }
  });
  return acc;
}

// order matters: drives METRICS / METRIC_LEVELS / value-column order.
const REGISTRY_LIST = [
  {
    key: "slsU",
    label: "Sls U",
    editable: true,
    isLevel: true,
    additive: true,
    format: formatNumber,
    compute: (c) => c.slsU,
  },
  {
    key: "sls$",
    label: "Sls $",
    isLevel: true,
    additive: true,
    format: formatCurrency,
    compute: (c) => c["sls$"],
  },
  {
    key: "cogs",
    label: "COGS",
    isLevel: true,
    format: formatCurrency,
    compute: (c) => (c["sls$"] || 0) - (c.gm$ || 0),
  },
  {
    key: "aur",
    label: "AUR",
    isLevel: true,
    format: formatCurrency,
    compute: (c) => (c.slsU ? c["sls$"] / c.slsU : null),
  },
  {
    key: "auc",
    label: "AUC",
    isLevel: true,
    format: formatCurrency,
    compute: (c) => (c.slsU ? (c["sls$"] - c.gm$) / c.slsU : null),
  },
  {
    key: "gm$",
    label: "GM $",
    isLevel: true,
    additive: true,
    format: formatCurrency,
    compute: (c) => c.gm$,
  },
  {
    key: "gm%",
    label: "GM %",
    isLevel: true,
    format: formatPercent,
    compute: (c) => (c["sls$"] ? (c.gm$ / c["sls$"]) * 100 : null),
  },
  {
    key: "mfp",
    label: "MFP",
    additive: true,
    format: formatNumber,
    compute: (c) => c.mfp,
  },
  {
    key: "ly",
    label: "LY",
    additive: true,
    format: formatNumber,
    compute: (c) => c.ly,
  },
  {
    key: "varLY",
    label: "Var LY(%)",
    format: formatPercent,
    compute: (c) => (c._n ? c.varLY / c._n : null),
  },
];

export const METRIC_REGISTRY = Object.fromEntries(
  REGISTRY_LIST.map((m) => [m.key, m]),
);

/** Ordered metric keys. */
export const METRIC_ORDER = REGISTRY_LIST.map((m) => m.key);

export const getMetric = (key) => METRIC_REGISTRY[key];

export const EDITABLE_METRIC = REGISTRY_LIST.find((m) => m.editable)?.key;

/** Compute a metric's raw numeric value from a component object. */
export function computeMetric(key, components) {
  const m = METRIC_REGISTRY[key];
  return m ? m.compute(components || {}) : null;
}

/** Compute + format a metric for display ("-" when not computable). */
export function formatMetricValue(key, components) {
  const m = METRIC_REGISTRY[key];
  if (!m) return "-";
  const v = m.compute(components || {});
  if (v == null || Number.isNaN(v)) return "-";
  return m.format(v);
}

// Selectable metrics for the "metrics" dimension (excludes measure-only fields
// mfp/ly/varLY, matching the original METRIC_LEVELS).
const LEVEL_METRICS = REGISTRY_LIST.filter((m) => m.isLevel);

export const METRIC_LEVELS = LEVEL_METRICS.map(({ key, label }) => ({
  key,
  label,
}));

export const METRICS = LEVEL_METRICS.map(({ key, label, editable }) => ({
  key,
  label,
  ...(editable ? { editable: true } : {}),
}));
