/**
 * Query layer: scope the fact table in SQL from the payload's filters, then
 * hand the reduced rows to the shared aggregation engine (single source of
 * truth for the pivot/nesting logic).
 */

import { db } from "./db.js";
import { runContractPivot } from "../src/deep-dive-poc/db/contractPivot.js";
import { runGenericPivot } from "../src/deep-dive-poc/db/genericPivot.js";
import { runContractRows } from "../src/deep-dive-poc/db/contractRows.js";

// Only these attributes may appear in a WHERE clause (allowlist prevents SQL
// injection via `attribute_name`).
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

/** Build a parameterized WHERE fragment + params from cascaded `in` filters. */
function buildWhere(payload) {
  const clauses = [];
  const params = [];

  const addFilterList = (list) => {
    (list || []).forEach((f) => {
      if (!FILTERABLE.has(f.attribute_name)) return;
      const values = (f.values || []).filter((v) => v != null);
      if (!values.length) return;
      const marks = values.map(() => "?").join(", ");
      clauses.push(`${f.attribute_name} IN (${marks})`);
      params.push(...values.map(String));
    });
  };
  addFilterList(payload.filters);
  addFilterList(payload.grid_filters);

  // Week range.
  const weeks = (
    payload.fiscal_ids?.length
      ? payload.fiscal_ids
      : (payload.time_period?.fiscal_mapping || []).map(
          (m) => m.fiscal_year_week,
        )
  ).map(Number);
  if (weeks.length) {
    clauses.push(`fiscal_year_week IN (${weeks.map(() => "?").join(", ")})`);
    params.push(...weeks);
  }

  // Measures (contract uses `measures`; older payloads used `forecast_attributes`).
  const measures = payload.measures || payload.forecast_attributes || [];
  if (measures.length) {
    clauses.push(`measure IN (${measures.map(() => "?").join(", ")})`);
    params.push(...measures);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return { where, params };
}

/** Execute a pivot query: SQL scope -> shared aggregation -> response.
 *
 * The generic engine (row/column dims declared in the payload) serves every
 * arrangement. Legacy payloads without `enumerate`/`columns` fall back to the
 * original product×location contract engine.
 */
export function pivot(payload = {}) {
  const { where, params } = buildWhere(payload);
  const facts = db.prepare(`SELECT * FROM facts ${where}`).all(...params);
  // Contract "row data only" mode: payload declares dimension axes.
  if (Array.isArray(payload.dimension)) return runContractRows(payload, facts);
  const isGeneric = payload.enumerate != null || Array.isArray(payload.columns);
  return isGeneric
    ? runGenericPivot(payload, facts)
    : runContractPivot(payload, facts);
}

/**
 * Apply edits by writing back to the granular facts. An edit targets an
 * aggregated cell (a set of product/store filters + one week + one measure) and
 * a new `sls_u` value; we redistribute proportionally across the matching base
 * rows, scaling sls_d/gm_d in lockstep so ratio metrics (aur/gm%) stay
 * consistent. Only `sls_u` is editable.
 */
export function applyEdits(payload = {}) {
  const edits = payload.edits || [];
  let updatedCount = 0;

  const runEdit = db.transaction((edit) => {
    if ((edit.metric || "sls_u") !== "sls_u") return; // only sls_u editable

    const clauses = [];
    const params = [];
    [...(edit.filters || []), ...(edit.grid_filters || [])].forEach((f) => {
      if (!FILTERABLE.has(f.attribute_name)) return;
      const values = (f.values || []).filter((v) => v != null);
      if (!values.length) return;
      clauses.push(
        `${f.attribute_name} IN (${values.map(() => "?").join(", ")})`,
      );
      params.push(...values.map(String));
    });
    if (edit.fiscal_id != null) {
      clauses.push("fiscal_year_week = ?");
      params.push(Number(edit.fiscal_id));
    }
    if (edit.measure) {
      clauses.push("measure = ?");
      params.push(edit.measure);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const { total } = db
      .prepare(`SELECT COALESCE(SUM(sls_u),0) AS total FROM facts ${where}`)
      .get(...params);
    if (!total) return;

    const scale = Number(edit.value) / total;
    const info = db
      .prepare(
        `UPDATE facts
           SET sls_u = sls_u * ?, sls_d = sls_d * ?, gm_d = gm_d * ?
         ${where}`,
      )
      .run(scale, scale, scale, ...params);
    updatedCount += info.changes;
  });

  edits.forEach(runEdit);
  return { success: true, version: Date.now(), updatedCount };
}

/** Simple stats for the health endpoint. */
export function stats() {
  return db
    .prepare(
      `SELECT COUNT(*) AS facts,
              COUNT(DISTINCT product_code) AS skus,
              COUNT(DISTINCT store_code)   AS stores,
              COUNT(DISTINCT fiscal_year_week) AS weeks,
              COUNT(DISTINCT measure)      AS measures
       FROM facts`,
    )
    .get();
}
