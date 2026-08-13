/**
 * Deep Dive backend — Express + SQLite.
 *
 * Endpoints:
 *   GET  /api/health              -> DB stats
 *   POST /api/deep-dive/pivot     -> selection-driven aggregation (see query.js)
 *   POST /api/deep-dive/edits     -> write-back edits to the granular facts
 *   GET  /api/deep-dive/records   -> flat base-grain records for the grid engine
 *   POST /api/deep-dive/save      -> persist grid edits (acknowledged)
 */

import express from "express";
import cors from "cors";
import { initDb } from "./db.js";
import { pivot, applyEdits, stats } from "./query.js";
import { generateMockData } from "../src/deep-dive-poc/mockData.js";
import { aggregateRecords } from "./aggregate.js";

const PORT = process.env.PORT || 8787;

const info = initDb();
console.log(
  `[db] ready at ${info.path} — ${info.seeded ? "seeded" : "existing"} ${info.rows} facts`,
);

const app = express();
// Restrict origins via CORS_ORIGIN (comma-separated). Defaults to allow all.
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim())
  : "*";
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", db: stats() });
});

app.post("/api/deep-dive/pivot", (req, res) => {
  try {
    res.json(pivot(req.body || {}));
  } catch (err) {
    console.error("[pivot] error", err);
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/deep-dive/edits", (req, res) => {
  try {
    res.json(applyEdits(req.body || {}));
  } catch (err) {
    console.error("[edits] error", err);
    res.status(400).json({ error: err.message });
  }
});

// Flat base-grain records consumed by the in-grid pivot engine.
// Optional ?limit= & ?offset= slice the payload (useful for manual inspection;
// the app itself fetches the full set).
app.get("/api/deep-dive/records", (req, res) => {
  // Drop the redundant per-record `stores` array (the full store list repeated
  // on every row) — the grid only needs channel/state/storeId on the record.
  const all = generateMockData().map(({ stores, ...rest }) => rest);
  const offset = Number(req.query.offset) || 0;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const data = limit != null ? all.slice(offset, offset + limit) : all;
  res.json({
    success: true,
    data,
    meta: { totalRecords: all.length, returned: data.length, offset },
  });
});

// View-grain aggregation for the grid: send { rowFields, colFields, measures },
// receive flat records pre-aggregated to that grain (payload scales with the
// view, not the raw fact count).
app.post("/api/deep-dive/aggregate", (req, res) => {
  try {
    const { rowFields = [], colFields = [], measures = [] } = req.body || {};
    const result = aggregateRecords({ rowFields, colFields, measures });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[aggregate] error", err);
    res.status(400).json({ error: err.message });
  }
});

// Acknowledge grid edits (the granular fact write-back lives at /edits).
app.post("/api/deep-dive/save", (req, res) => {
  const records = req.body?.records || [];
  res.json({
    success: true,
    version: Date.now(),
    updatedCount: records.length,
  });
});

// Export the configured app so serverless wrappers (Netlify Functions) can
// reuse it. Only start a listener when this file is run directly.
export { app };

const isDirectRun =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectRun) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[server] Deep Dive API listening on port ${PORT}`);
  });
}
