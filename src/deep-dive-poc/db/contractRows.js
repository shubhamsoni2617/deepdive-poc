/**
 * Contract row builder — "row data only", one hierarchy level per call.
 *
 * Implements the confirmed Deep Dive contract: given a payload declaring the
 * dimension axes (y = row, x = nested cell), the current per-dimension
 * aggregation levels, the selected time nesting, measures and metrics, this
 * returns a FLAT LIST OF ROWS for exactly ONE level of the active row
 * dimension. Nothing is pre-aggregated: every leaf value is summed from the
 * granular facts on demand and ratio metrics are recomputed from summed
 * components so numbers are correct at any level.
 *
 * Row shape (measure is its own row; cells nest by `time_order_selected`,
 * metric innermost, leaf-only final values with uppercase labels):
 *   {
 *     product:  { aggregation_level, attribute_name, value, has_children, next_level },
 *     location: { aggregation_level, value, has_children, next_level },
 *     measure:  { value },
 *     cells:    { <t0>: { <t1>: { <t2>: { SLS, AUR } } } }
 *   }
 */

import {
  getFacts,
  emptyComponents,
  addComponents,
  computeMetric,
} from "./deepDiveDb.js";
import { metricLeafLabel as metricLabel } from "../config/contractMetrics.js";

// Time level name -> fact field.
const TIME_FIELD = {
  quarter: "fiscal_year_quarter",
  month: "fiscal_year_month",
  week: "fiscal_year_week",
};

const isTotal = (v) =>
  v == null || v === "" || String(v).toLowerCase() === "total";

/** Ordered hierarchy attributes from a { l1: attr, l2: attr, ... } map. */
function orderedAttrs(map) {
  if (!map) return [];
  return Object.keys(map)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .map((k) => map[k]);
}

function applyFilterList(facts, list) {
  if (!list || !list.length) return facts;
  return facts.filter((f) =>
    list.every((flt) => {
      const v = f[flt.attribute_name];
      if (v === undefined) return true;
      return (flt.values || []).map(String).includes(String(v));
    }),
  );
}

function distinct(facts, field) {
  const s = new Set();
  facts.forEach((f) => s.add(f[field]));
  return Array.from(s).sort((a, b) =>
    String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
  );
}

/** has_children / next_level for a hierarchy level attribute. */
function levelInfo(attrs, level) {
  const idx = attrs.indexOf(level);
  const next = idx >= 0 && idx + 1 < attrs.length ? attrs[idx + 1] : null;
  return { has_children: !!next, next_level: next };
}

/**
 * Nest facts by the selected time levels; leaves carry the final metric values.
 * Only the innermost (leaf) level gets a metric object — collapsed rollups are
 * out of scope for now.
 */
function buildCells(facts, timeLevels, metrics) {
  const fields = timeLevels
    .map((t) => TIME_FIELD[String(t).toLowerCase()])
    .filter(Boolean);
  if (!fields.length) return {};
  const root = {};
  facts.forEach((f) => {
    let node = root;
    for (let i = 0; i < fields.length; i++) {
      const key = f[fields[i]];
      if (i === fields.length - 1) {
        if (!node[key]) node[key] = { __comp: emptyComponents() };
        addComponents(node[key].__comp, f);
      } else {
        if (!node[key]) node[key] = {};
        node = node[key];
      }
    }
  });
  const finalize = (node) => {
    if (node.__comp) {
      const out = {};
      metrics.forEach((m) => {
        out[metricLabel(m)] = computeMetric(m, node.__comp);
      });
      return out;
    }
    const out = {};
    Object.keys(node).forEach((k) => (out[k] = finalize(node[k])));
    return out;
  };
  return finalize(root);
}

/**
 * Build the row-array response for one level of the active row dimension.
 * @param payload the contract request
 * @param factsOverride pre-scoped facts (e.g. from SQL); filters re-applied.
 */
export function runContractRows(payload = {}, factsOverride = null) {
  const {
    filters = [],
    grid_filters = [],
    product_hierarchy_levels = null,
    location_hierarchy_levels = null,
    product_hierarchy_aggregation = null,
    location_hierarchy_aggregation = null,
    time_order_selected = ["month", "week"],
    measures = ["WCF", "MFP"],
    metrics = ["sls_u", "aur"],
    fiscal_ids = [],
    grid_id = null,
    parent_grid_id = null,
  } = payload;

  const prodAttrs = orderedAttrs(product_hierarchy_levels);
  const locAttrs = orderedAttrs(location_hierarchy_levels);

  const prodLevel = isTotal(product_hierarchy_aggregation)
    ? null
    : product_hierarchy_aggregation;
  const locLevel = isTotal(location_hierarchy_aggregation)
    ? null
    : location_hierarchy_aggregation;

  // Active row dimension = the last hierarchical Y dim with a non-total level.
  // (product default -> then location once it is drilled below Total.)
  const activeDim = locLevel ? "location" : "product";
  const activeAttr =
    activeDim === "location" ? locLevel : prodLevel || prodAttrs[0];

  // Scope facts: global filters + drill scope + week range + measures.
  let facts = factsOverride || getFacts();
  facts = applyFilterList(facts, filters);
  facts = applyFilterList(facts, grid_filters);
  const weekSet = new Set((fiscal_ids || []).map(Number));
  if (weekSet.size)
    facts = facts.filter((f) => weekSet.has(f.fiscal_year_week));
  facts = facts.filter((f) => measures.includes(f.measure));

  // The fixed (non-active) product value, when we are enumerating location.
  const fixedProdLevel = prodLevel || null;
  const fixedProdValue =
    activeDim === "location" && fixedProdLevel
      ? (distinct(facts, fixedProdLevel)[0] ?? "Total")
      : null;

  const prodMeta = prodLevel
    ? levelInfo(prodAttrs, prodLevel)
    : { has_children: prodAttrs.length > 0, next_level: prodAttrs[0] || null };
  const locMeta = locLevel
    ? levelInfo(locAttrs, locLevel)
    : { has_children: locAttrs.length > 0, next_level: locAttrs[0] || null };

  const members = distinct(facts, activeAttr);
  const rows = [];

  members.forEach((member) => {
    const memberFacts = facts.filter(
      (f) => String(f[activeAttr]) === String(member),
    );

    const productNode =
      activeDim === "product"
        ? {
            aggregation_level: prodLevel,
            attribute_name: prodLevel,
            value: member,
            has_children: prodMeta.has_children,
            next_level: prodMeta.next_level,
          }
        : {
            aggregation_level: fixedProdLevel,
            attribute_name: fixedProdLevel,
            value: fixedProdValue,
            has_children: prodMeta.has_children,
            next_level: prodMeta.next_level,
          };

    const locationNode =
      activeDim === "location"
        ? {
            aggregation_level: locLevel,
            attribute_name: locLevel,
            value: member,
            has_children: locMeta.has_children,
            next_level: locMeta.next_level,
          }
        : {
            aggregation_level: null,
            value: "Total",
            has_children: locMeta.has_children,
            next_level: locMeta.next_level,
          };

    measures.forEach((measure) => {
      const cells = buildCells(
        memberFacts.filter((f) => f.measure === measure),
        time_order_selected,
        metrics,
      );
      rows.push({
        product: productNode,
        location: locationNode,
        measure: { value: measure },
        cells,
      });
    });
  });

  return {
    grid_id,
    parent_grid_id,
    context: {
      active_dimension: activeDim,
      product_hierarchy_aggregation,
      location_hierarchy_aggregation,
      time_order_selected,
    },
    rows,
    pagination: {
      page: 1,
      limit: rows.length,
      total_rows: rows.length,
      has_more: false,
    },
  };
}
