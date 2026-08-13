/**
 * SQLite layer for the Deep Dive backend.
 *
 * Creates (once) a real `facts` table at the base grain
 * (Product SKU × Store × Week × Measure) and seeds it from the shared
 * deterministic generator in src/deep-dive-poc/db/deepDiveDb.js — so the API,
 * the in-browser mock, and the database all agree on the exact same numbers.
 */

import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getFacts } from "../src/deep-dive-poc/db/deepDiveDb.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// On AWS Lambda (Netlify Functions) the bundle dir is read-only; only /tmp is
// writable. Seed the SQLite file there. Locally, keep it next to the server.
const DB_PATH =
  process.env.DB_PATH ||
  (process.env.LAMBDA_TASK_ROOT
    ? "/tmp/deepdive.db"
    : join(__dirname, "deepdive.db"));

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Column order matches the fact object shape from getFacts().
const COLUMNS = [
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
  "fiscal_year_week",
  "fiscal_year_month",
  "fiscal_year_quarter",
  "measure",
  "sls_u",
  "sls_d",
  "gm_d",
];

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS facts (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      l0_code              TEXT NOT NULL,
      l1_name              TEXT NOT NULL,
      l3_name              TEXT NOT NULL,
      l4_name              TEXT NOT NULL,
      product_code         TEXT NOT NULL,
      country              TEXT NOT NULL,
      state                TEXT NOT NULL,
      district             TEXT NOT NULL,
      city                 TEXT NOT NULL,
      store_code           TEXT NOT NULL,
      fiscal_year_week     INTEGER NOT NULL,
      fiscal_year_month    INTEGER NOT NULL,
      fiscal_year_quarter  INTEGER NOT NULL,
      measure              TEXT NOT NULL,
      sls_u                REAL NOT NULL,
      sls_d                REAL NOT NULL,
      gm_d                 REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_facts_prod  ON facts(l1_name, l3_name, l4_name, product_code);
    CREATE INDEX IF NOT EXISTS idx_facts_loc   ON facts(country, state, district, city, store_code);
    CREATE INDEX IF NOT EXISTS idx_facts_week  ON facts(fiscal_year_week);
    CREATE INDEX IF NOT EXISTS idx_facts_meas  ON facts(measure);
  `);
}

function seedIfEmpty() {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM facts").get();
  if (n > 0) return { seeded: false, rows: n };

  const facts = getFacts();
  const placeholders = COLUMNS.map(() => "?").join(", ");
  const insert = db.prepare(
    `INSERT INTO facts (${COLUMNS.join(", ")}) VALUES (${placeholders})`,
  );
  const insertMany = db.transaction((rows) => {
    for (const r of rows) insert.run(COLUMNS.map((c) => r[c]));
  });
  insertMany(facts);
  return { seeded: true, rows: facts.length };
}

export function initDb() {
  createSchema();
  const result = seedIfEmpty();
  return { path: DB_PATH, ...result };
}
