/**
 * Backward-compatible facade. Configuration now lives in ./config/*; this file
 * re-exports it so existing `./constants` imports keep working.
 */

export * from "./config/dimensions.js";
export * from "./config/arrangements.js";
export { METRICS } from "./config/metrics.js";
