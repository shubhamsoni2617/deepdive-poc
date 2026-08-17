/**
 * Deep Dive pivot — real contract engine.
 *
 * Consumes the agreed request payload and returns the agreed response, fully
 * driven by the payload (no hard-coded hierarchy). Aggregates the granular
 * fact table (./deepDiveDb.js) on demand.
 *
 * Request (relevant fields):
 *   filters[]                     global scope (product/location/time), cascaded `in`
 *   grid_filters[]                drill path (each expand adds a cascaded `in`)
 *   product_hierarchy_levels      { l1..l5 -> attribute_name }
 *   location_hierarchy_levels     { l1..l5 -> attribute_name }
 *   product_hierarchy_aggregation current product level ("total" | attribute)
 *   location_hierarchy_aggregation current location level ("total" | attribute)
 *   time_order_selected           ordered time levels for column nesting
 *                                 e.g. ["quarter","month","week"]
 *   measures[]                    e.g. ["WCF","MFP"]
 *   metrics[]                     e.g. ["sls_u","aur"]
 *   time_period.fiscal_mapping[]  week -> { month, quarter }
 *   fiscal_ids[]                  weeks in range
 *
 * Response row:
 *   {
 *     product:  { aggregation_level, attribute_name?, value, has_children, next_level? },
 *     location: { aggregation_level, attribute_name?, value, has_children, next_level? },
 *     measures: { <measure>: { <t1>: { <t2>: ... { <metricLabel>: number } } } }
 *   }
 */

import {
  getFacts,
  addComponents,
  emptyComponents,
  computeMetric,
} from "./deepDiveDb.js";

// Aggregations that mean "roll everything into a single Total node".
const TOTAL_TOKENS = new Set([null, undefined, "", "total", "Total", "TOTAL"]);
const isTotalAgg = (a) => TOTAL_TOKENS.has(a);

// Metric key -> response label (leaf keys). Falls back to UPPERCASE.
const METRIC_LABEL = {
  sls_u: "SLS",
  sls_dollars: "SLS_D",
  gm_dollars: "GM",
  aur: "AUR",
  auc: "AUC",
  gm_pct: "GM_PCT",
};
const metricLabel = (m) => METRIC_LABEL[m] || String(m).toUpperCase();

// time_order_selected token -> fact attribute holding that bucket id.
const TIME_ATTR = {
  quarter: "fiscal_year_quarter",
  month: "fiscal_year_month",
  week: "fiscal_year_week",
};

/** Turn { l1:"country", l2:"state", ... } into ["country","state", ...]. */
function orderMap(levelMap) {
  if (!levelMap) return [];
  return Object.keys(levelMap)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .map((k) => levelMap[k]);
}

/** Apply a list of cascaded `in` filters to the facts. */
function applyFilterList(facts, filterList) {
  if (!filterList || !filterList.length) return facts;
  return facts.filter((f) =>
    filterList.every((flt) => {
      const val = f[flt.attribute_name];
      if (val === undefined) return true; // attribute not on facts -> ignore
      return (flt.values || []).map(String).includes(String(val));
    }),
  );
}

/** Distinct, stably-sorted values of a field within a fact set. */
function distinct(facts, field) {
  const set = new Set();
  facts.forEach((f) => set.add(f[field]));
  return Array.from(set).sort((a, b) =>
    String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
  );
}

/** Build measure -> week -> summed components for a scoped fact set. */
function indexByMeasureWeek(facts) {
  const index = {};
  facts.forEach((f) => {
    const bm = index[f.measure] || (index[f.measure] = {});
    bm[f.fiscal_year_week] = addComponents(
      bm[f.fiscal_year_week] || emptyComponents(),
      f,
    );
  });
  return index;
}

/** Sum a measure's components across a set of weeks. */
function sumWeeks(index, measure, weeks) {
  const acc = emptyComponents();
  const bm = index[measure];
  if (!bm) return acc;
  weeks.forEach((wk) => {
    const c = bm[wk];
    if (c) addComponents(acc, c);
  });
  return acc;
}

/**
 * Dimension block (product / location) for a row.
 * Total => { aggregation_level: null, value: "Total", has_children: true }.
 * Level => { aggregation_level, attribute_name, value, has_children, next_level }.
 */
function dimBlock(agg, levels, value) {
  if (isTotalAgg(agg)) {
    return {
      aggregation_level: null,
      value: "Total",
      has_children: levels.length > 0,
      next_level: levels[0] || null,
    };
  }
  const idx = levels.indexOf(agg);
  const next = idx >= 0 && idx + 1 < levels.length ? levels[idx + 1] : null;
  return {
    aggregation_level: agg,
    attribute_name: agg,
    value,
    has_children: !!next,
    next_level: next,
  };
}

/**
 * Main entry.
 * @param payload        the request payload
 * @param factsOverride  pre-scoped facts (e.g. from SQL); filters re-applied idempotently
 */
export function runContractPivot(payload = {}, factsOverride = null) {
  const {
    filters = [],
    grid_filters = [],
    grid_id = null,
    parent_grid_id = null,
    product_hierarchy_levels = null,
    location_hierarchy_levels = null,
    product_hierarchy_aggregation = "total",
    location_hierarchy_aggregation = "total",
    time_order_selected = ["week"],
    measures = ["WCF", "MFP"],
    metrics = ["sls_u", "aur"],
    time_period = {},
    fiscal_ids = [],
    meta = {},
  } = payload;

  const prodLevels = orderMap(product_hierarchy_levels);
  const locLevels = orderMap(location_hierarchy_levels);
  const prodAgg = product_hierarchy_aggregation;
  const locAgg = location_hierarchy_aggregation;

  // ---- 1. Scope facts: global filters + drill path.
  let facts = factsOverride || getFacts();
  facts = applyFilterList(facts, filters);
  facts = applyFilterList(facts, grid_filters);

  // ---- 2. Time range + week -> {quarter, month} mapping.
  const mapping = time_period.fiscal_mapping || [];
  const weekMeta = new Map();
  mapping.forEach((m) =>
    weekMeta.set(Number(m.fiscal_year_week), {
      fiscal_year_week: Number(m.fiscal_year_week),
      fiscal_year_month: Number(m.fiscal_year_month),
      fiscal_year_quarter: Number(m.fiscal_year_quarter),
    }),
  );
  let weekKeys = (
    fiscal_ids.length ? fiscal_ids : mapping.map((m) => m.fiscal_year_week)
  ).map(Number);
  const weekSet = new Set(weekKeys);
  if (weekSet.size)
    facts = facts.filter((f) => weekSet.has(f.fiscal_year_week));
  facts = facts.filter((f) => measures.includes(f.measure));
  // Fall back to the facts' own week/quarter/month if no mapping was supplied.
  weekKeys.forEach((wk) => {
    if (!weekMeta.has(wk)) {
      const f = facts.find((x) => x.fiscal_year_week === wk);
      if (f) {
        weekMeta.set(wk, {
          fiscal_year_week: wk,
          fiscal_year_month: f.fiscal_year_month,
          fiscal_year_quarter: f.fiscal_year_quarter,
        });
      }
    }
  });

  // ---- 3. Row grouping: cartesian of non-total product/location levels.
  const prodValues = isTotalAgg(prodAgg)
    ? [{ total: true }]
    : distinct(facts, prodAgg).map((v) => ({ value: v }));
  const locValues = isTotalAgg(locAgg)
    ? [{ total: true }]
    : distinct(facts, locAgg).map((v) => ({ value: v }));

  // ---- 4. Time-nesting: build measures -> nested time -> metrics leaf.
  const timeLevels = (time_order_selected || [])
    .map((t) => TIME_ATTR[String(t).toLowerCase()])
    .filter(Boolean);

  const nestTime = (index, measure, weeks, levelIdx) => {
    if (levelIdx >= timeLevels.length) {
      // Leaf: compute each metric from the summed components of these weeks.
      const comp = sumWeeks(index, measure, weeks);
      const leaf = {};
      metrics.forEach((mk) => {
        leaf[metricLabel(mk)] = computeMetric(mk, comp);
      });
      return leaf;
    }
    const attr = timeLevels[levelIdx];
    const buckets = new Map();
    weeks.forEach((wk) => {
      const key = weekMeta.get(wk)?.[attr] ?? wk;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(wk);
    });
    const obj = {};
    Array.from(buckets.keys())
      .sort((a, b) => Number(a) - Number(b))
      .forEach((key) => {
        obj[key] = nestTime(index, measure, buckets.get(key), levelIdx + 1);
      });
    return obj;
  };

  const buildMeasures = (index) => {
    const out = {};
    measures.forEach((measure) => {
      out[measure] = nestTime(index, measure, weekKeys, 0);
    });
    return out;
  };

  // ---- 5. Emit rows.
  const allRows = [];
  prodValues.forEach((pv) => {
    locValues.forEach((lv) => {
      let scoped = facts;
      if (!pv.total)
        scoped = scoped.filter((f) => String(f[prodAgg]) === String(pv.value));
      if (!lv.total)
        scoped = scoped.filter((f) => String(f[locAgg]) === String(lv.value));

      const index = indexByMeasureWeek(scoped);
      allRows.push({
        product: dimBlock(prodAgg, prodLevels, pv.value),
        location: dimBlock(locAgg, locLevels, lv.value),
        measures: buildMeasures(index),
      });
    });
  });

  // ---- 6. Pagination (opt-in via meta.paginated_rows).
  const limit = meta.limit || allRows.length || 1;
  const page = meta.page || 1;
  const paginate = meta.paginated_rows === true;
  const start = paginate ? (page - 1) * limit : 0;
  const rows = paginate ? allRows.slice(start, start + limit) : allRows;

  return {
    grid_id,
    parent_grid_id,
    context: {
      product_hierarchy_aggregation: prodAgg,
      location_hierarchy_aggregation: locAgg,
      time_order_selected,
      grid_filters,
    },
    rows,
    pagination: {
      page,
      limit,
      total_rows: allRows.length,
      has_more: paginate ? start + limit < allRows.length : false,
    },
  };
}
