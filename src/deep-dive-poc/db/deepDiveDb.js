/**
 * Granular "database" for the Deep Dive PoC.
 *
 * This is the single base-grain fact table the API aggregates from. Every fact
 * is one Product(SKU) × Store × Week × Measure row, carrying the additive raw
 * components (units, sales $, gross-margin $) that every metric derives from.
 *
 * The API layer NEVER stores pre-aggregated numbers — it aggregates these facts
 * on demand according to the user's pivot selection (see ./pivotQuery.js).
 */

const SEED = 1337;

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --------------------------------------------------------------------------
// Hierarchies — ordered top → bottom. Attribute names match the API payload's
// product_hierarchy_levels / location_hierarchy_levels values.
// --------------------------------------------------------------------------

export const PRODUCT_LEVELS = [
  "l0_code",
  "l1_name",
  "l3_name",
  "l4_name",
  "product_code",
];

export const LOCATION_LEVELS = [
  "country",
  "state",
  "district",
  "city",
  "store_code",
];

export const TIME_LEVELS = [
  "fiscal_year_quarter",
  "fiscal_year_month",
  "fiscal_year_week",
];

export const MEASURES = ["WCF", "MFP"];

// Measure -> multiplicative factor applied to the base scenario, so WCF/MFP
// differ but stay deterministic.
const MEASURE_FACTOR = { WCF: 1, MFP: 0.97 };

// --------------------------------------------------------------------------
// Metric registry (snake_case, matching API `metrics`). Additive metrics read
// a summed component directly; ratio metrics divide summed components so they
// aggregate correctly at ANY level.
// --------------------------------------------------------------------------

export const METRIC_DEFS = {
  sls_u: { additive: true, compute: (c) => c.sls_u },
  sls_d: { additive: true, compute: (c) => c.sls_d },
  gm_d: { additive: true, compute: (c) => c.gm_d },
  aur: { compute: (c) => (c.sls_u ? c.sls_d / c.sls_u : null) },
  auc: { compute: (c) => (c.sls_u ? (c.sls_d - c.gm_d) / c.sls_u : null) },
  gm_pct: { compute: (c) => (c.sls_d ? (c.gm_d / c.sls_d) * 100 : null) },
};

export function emptyComponents() {
  return { sls_u: 0, sls_d: 0, gm_d: 0 };
}

export function addComponents(target, fact) {
  target.sls_u += fact.sls_u;
  target.sls_d += fact.sls_d;
  target.gm_d += fact.gm_d;
  return target;
}

/** Compute a metric's scalar from summed components ("-> null" if undefined). */
export function computeMetric(metricKey, components) {
  const def = METRIC_DEFS[metricKey];
  if (!def) return null;
  const v = def.compute(components);
  if (v == null || Number.isNaN(v)) return null;
  return Math.round(v * 100) / 100;
}

// --------------------------------------------------------------------------
// Dimension tables (deterministic). Kept small so the fact table stays light:
//   24 SKUs × 8 Stores × 26 Weeks × 2 Measures = 9,984 facts.
// --------------------------------------------------------------------------

function buildProductDim() {
  const l0 = "AP-100"; // single top code (company / all products)
  const divisions = ["Menswear", "Womenswear"]; // l1_name
  const deptsByDiv = {
    Menswear: ["Shirts", "Pants"],
    Womenswear: ["Tops", "Dresses"],
  };
  const classNames = ["Casual", "Premium"]; // l4_name (per department)

  const skus = [];
  divisions.forEach((division, di) => {
    deptsByDiv[division].forEach((department, dp) => {
      classNames.forEach((klass, ci) => {
        for (let s = 1; s <= 3; s++) {
          const code = `${di + 1}${dp + 1}${ci + 1}${s
            .toString()
            .padStart(2, "0")}`;
          skus.push({
            l0_code: l0,
            l1_name: division,
            l3_name: `${division} ${department}`,
            l4_name: `${division} ${department} ${klass}`,
            product_code: `SKU-${code}`,
          });
        }
      });
    });
  });
  return skus;
}

function buildLocationDim() {
  const country = "USA";
  const states = ["TX", "CA"];
  const citiesByState = {
    TX: ["Austin", "Dallas"],
    CA: ["LA", "SF"],
  };
  const stores = [];
  states.forEach((state) => {
    const district = `${state}-D1`;
    citiesByState[state].forEach((city) => {
      for (let n = 1; n <= 2; n++) {
        stores.push({
          country,
          state,
          district,
          city,
          store_code: `${state}-${city.slice(0, 2).toUpperCase()}-${n}`,
        });
      }
    });
  });
  return stores;
}

/** 26-week fiscal calendar: 26 weeks → 7 months (~4/qtr) → 2 quarters. */
function buildTimeDim() {
  const weeks = [];
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
  ];
  for (let w = 1; w <= 26; w++) {
    const monthIdx = Math.floor((w - 1) / 4); // 0..6
    const quarterIdx = Math.floor((w - 1) / 13); // 0..1
    weeks.push({
      fiscal_year_week: 202600 + w, // 202601 … 202626
      fiscal_year_month: 202601 + monthIdx, // 202601 … 202607
      fiscal_year_quarter: 202601 + quarterIdx, // 202601 … 202602
      fiscal_month_name: monthNames[monthIdx],
    });
  }
  return weeks;
}

export const PRODUCT_DIM = buildProductDim();
export const LOCATION_DIM = buildLocationDim();
export const TIME_DIM = buildTimeDim();

// --------------------------------------------------------------------------
// Fact table generation (deterministic, cached).
// --------------------------------------------------------------------------

let FACTS = null;

function generateFacts() {
  const rand = mulberry32(SEED);
  const facts = [];

  PRODUCT_DIM.forEach((sku) => {
    // Per-SKU base economics, stable across the run.
    const baseUnitsPerWeek = 20 + Math.round(80 * rand());
    const baseAur = 20 + 60 * rand();
    const baseCostRatio = 0.45 + 0.15 * rand();

    LOCATION_DIM.forEach((store) => {
      const storeMult = 0.6 + 1.0 * rand(); // store size effect

      TIME_DIM.forEach((week) => {
        const w = week.fiscal_year_week - 202600;
        const seasonal = 1 + 0.2 * Math.sin((w / 26) * Math.PI * 2);
        const noise = 0.85 + 0.3 * rand();

        MEASURES.forEach((measure) => {
          const mf = MEASURE_FACTOR[measure];
          const units = Math.max(
            1,
            Math.round(baseUnitsPerWeek * storeMult * seasonal * noise * mf),
          );
          const aur = baseAur * (measure === "MFP" ? 0.98 : 1);
          const auc = aur * baseCostRatio;
          const sls_d = units * aur;
          const gm_d = units * (aur - auc);

          facts.push({
            ...sku,
            ...store,
            fiscal_year_week: week.fiscal_year_week,
            fiscal_year_month: week.fiscal_year_month,
            fiscal_year_quarter: week.fiscal_year_quarter,
            measure,
            sls_u: units,
            sls_d,
            gm_d,
          });
        });
      });
    });
  });

  return facts;
}

/** All base-grain facts (generated once, then cached). */
export function getFacts() {
  if (!FACTS) FACTS = generateFacts();
  return FACTS;
}

/** Field name for a dimension's given hierarchy level (or null for Total). */
export const DIM_LEVELS = {
  product: PRODUCT_LEVELS,
  store: LOCATION_LEVELS,
  time: TIME_LEVELS,
};
