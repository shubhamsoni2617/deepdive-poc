/**
 * Backward-compatible facade. Configuration now lives in ./config/*; this file
 * re-exports it so existing `./constants` imports keep working.
 */

export * from "./config/dimensions";
export * from "./config/arrangements";
export { METRICS } from "./config/metrics";
