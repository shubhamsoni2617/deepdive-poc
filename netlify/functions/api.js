/**
 * Netlify Function: Deep Dive API (serverless, pure-JS).
 *
 * Mirrors server/index.js but scopes the fact set in JavaScript instead of SQL,
 * so it needs no native `better-sqlite3` binary (which can't be cross-compiled
 * for Lambda from a local CLI deploy). The heavy lifting is delegated to the
 * exact same aggregation engines the browser fallback uses, so numbers match
 * the local Express + SQLite server bit for bit.
 */

import express from "express";
import cors from "cors";
import serverless from "serverless-http";

import { getFacts } from "../../src/deep-dive-poc/db/deepDiveDb.js";
import { generateMockData } from "../../src/deep-dive-poc/mockData.js";
import { COMPONENT_FIELDS } from "../../src/deep-dive-poc/config/metrics.js";
import { runContractPivot } from "../../src/deep-dive-poc/db/contractPivot.js";
import { runGenericPivot } from "../../src/deep-dive-poc/db/genericPivot.js";
import { runContractRows } from "../../src/deep-dive-poc/db/contractRows.js";
import { aggregateRecords } from "../../server/aggregate.js";

// --- Fact store (in-memory, cached per warm container) --------------------

let FACTS = null;
function facts() {
  if (!FACTS) FACTS = getFacts();
  return FACTS;
}

const FILTERABLE = new Set([
  "l0_code",
  "l1_name",
  "l3_name",
  "l4_name",
  "product_code",
  "country",
  "state",
  "district",
  "city",
  "store_code",
]);

/** Build a JS predicate from cascaded `in` filters + week/measure scoping. */
function buildPredicate(payload = {}) {
  const preds = [];

  const addFilterList = (list) => {
    (list || []).forEach((f) => {
      if (!FILTERABLE.has(f.attribute_name)) return;
      const values = (f.values || []).filter((v) => v != null).map(String);
      if (!values.length) return;
      const set = new Set(values);
      preds.push((r) => set.has(String(r[f.attribute_name])));
    });
  };
  addFilterList(payload.filters);
  addFilterList(payload.grid_filters);

  const weeks = (
    payload.fiscal_ids?.length
      ? payload.fiscal_ids
      : (payload.time_period?.fiscal_mapping || []).map(
          (m) => m.fiscal_year_week,
        )
  ).map(Number);
  if (weeks.length) {
    const set = new Set(weeks);
    preds.push((r) => set.has(Number(r.fiscal_year_week)));
  }

  const measures = payload.measures || payload.forecast_attributes || [];
  if (measures.length) {
    const set = new Set(measures);
    preds.push((r) => set.has(r.measure));
  }

  return (r) => preds.every((p) => p(r));
}

function scopedFacts(payload) {
  const pred = buildPredicate(payload);
  return facts().filter(pred);
}

function pivot(payload = {}) {
  const scoped = scopedFacts(payload);
  if (Array.isArray(payload.dimension)) return runContractRows(payload, scoped);
  const isGeneric = payload.enumerate != null || Array.isArray(payload.columns);
  return isGeneric
    ? runGenericPivot(payload, scoped)
    : runContractPivot(payload, scoped);
}

function applyEdits(payload = {}) {
  const edits = payload.edits || [];
  let updatedCount = 0;
  const all = facts();

  for (const edit of edits) {
    if ((edit.metric || "sls_u") !== "sls_u") continue;
    const pred = buildPredicate({
      filters: edit.filters,
      grid_filters: edit.grid_filters,
      fiscal_ids: edit.fiscal_id != null ? [edit.fiscal_id] : [],
      measures: edit.measure ? [edit.measure] : [],
    });
    const matched = all.filter(pred);
    const total = matched.reduce((s, r) => s + (r.sls_u || 0), 0);
    if (!total) continue;
    const scale = Number(edit.value) / total;
    for (const r of matched) {
      r.sls_u *= scale;
      r.sls_d *= scale;
      r.gm_d *= scale;
      updatedCount += 1;
    }
  }
  return { success: true, version: Date.now(), updatedCount };
}

function stats() {
  const all = facts();
  return {
    facts: all.length,
    skus: new Set(all.map((r) => r.product_code)).size,
    stores: new Set(all.map((r) => r.store_code)).size,
    weeks: new Set(all.map((r) => r.fiscal_year_week)).size,
    measures: new Set(all.map((r) => r.measure)).size,
  };
}

// --- Express app ----------------------------------------------------------

const app = express();
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

app.get("/api/deep-dive/records", (req, res) => {
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

app.post("/api/deep-dive/save", (req, res) => {
  const records = req.body?.records || [];
  res.json({ success: true, version: Date.now(), updatedCount: records.length });
});

// --- Serverless handler ---------------------------------------------------

const wrapped = serverless(app);

export const handler = async (event, context) => {
  // Netlify serves this function at /.netlify/functions/api. Strip that prefix
  // so the Express routes (mounted at /api/...) match after the redirect.
  const prefix = "/.netlify/functions/api";
  if (event.path?.startsWith(prefix)) {
    event.path = event.path.slice(prefix.length) || "/";
  }
  return wrapped(event, context);
};
