/**
 * Shared metric vocabulary for the Deep Dive `/pivot` contract.
 *
 * Single source of truth used by BOTH the contract row builder
 * (db/contractRows.js) and the frontend grid (ServerDrillGrid / contract
 * columns), so response leaf labels and client↔contract key mapping never
 * drift apart.
 */

// Selected-metric key -> uppercase leaf label written into response `cells`.
export const METRIC_LEAF_LABEL = {
  sls_u: "SLS",
  sls_d: "SLS$",
  gm_d: "GM$",
  aur: "AUR",
  auc: "AUC",
  gm_pct: "GM%",
};

export const metricLeafLabel = (m) =>
  METRIC_LEAF_LABEL[m] || String(m).toUpperCase();

// Client-facing metric keys (config/metrics.js) -> contract metric keys.
export const CLIENT_TO_CONTRACT_METRIC = {
  slsU: "sls_u",
  sls$: "sls_d",
  gm$: "gm_d",
  aur: "aur",
  auc: "auc",
  "gm%": "gm_pct",
};
