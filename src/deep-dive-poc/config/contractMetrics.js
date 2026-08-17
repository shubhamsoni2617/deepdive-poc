/**
 * Shared metric vocabulary for the Deep Dive `/pivot` contract.
 *
 * The contract response now uses the RAW metric keys (`sls_u`, `aur`, …) as
 * leaf keys, so no label map is needed. This module only owns the mapping from
 * client-facing metric keys to the contract's metric keys.
 */

// Client-facing metric keys (config/metrics.js) -> contract metric keys.
// Keys mirror the real backend contract (sls_dollars/gm_dollars/…).
export const CLIENT_TO_CONTRACT_METRIC = {
  slsU: "sls_u",
  sls$: "sls_dollars",
  cogs: "cogs",
  gm$: "gm_dollars",
  aur: "aur",
  auc: "auc",
  "gm%": "gm_pct",
};
