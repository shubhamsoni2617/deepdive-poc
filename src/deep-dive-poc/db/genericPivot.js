/**
 * Generic Deep Dive pivot engine — one contract for ALL views.
 *
 * A view is `rows: [dim...]` + `columns: [dim...]` where each dim is one of
 * product · store · time · measures · metrics. The engine is dimension-agnostic:
 *   - COLUMNS expand into a nested header tree of leaf columns (the cartesian of
 *     every column dim's members). measures/metrics enumerate; time nests by
 *     `time_order_selected`; product/store expand at their current level.
 *   - ROWS are drilled ONE level per call (server-side, per node). The client
 *     asks the engine to `enumerate` a single row-axis step (a hierarchy level,
 *     a time level, or a value dim) scoped by `grid_filters`; the engine returns
 *     those members, each with a `cells` map keyed by column-leaf id.
 *
 * Nothing is pre-aggregated: every cell is summed from the granular facts on
 * demand and ratio metrics are recomputed from summed components, so numbers are
 * correct at any level. The same endpoint (/api/deep-dive/pivot) serves every
 * arrangement — only the payload changes.
 */

import {
  getFacts,
  addComponents,
  emptyComponents,
  computeMetric,
} from "./deepDiveDb.js";

const TOTAL = new Set([null, undefined, "", "total", "Total", "TOTAL"]);
const isTotal = (a) => TOTAL.has(a);

const METRIC_LABEL = {
  sls_u: "SLS",
  sls_dollars: "SLS_D",
  gm_dollars: "GM",
  aur: "AUR",
  auc: "AUC",
  gm_pct: "GM_PCT",
};
export const metricLabel = (m) => METRIC_LABEL[m] || String(m).toUpperCase();

const TIME_ATTR = {
  quarter: "fiscal_year_quarter",
  month: "fiscal_year_month",
  week: "fiscal_year_week",
};

const orderMap = (map) =>
  map
    ? Object.keys(map)
        .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
        .map((k) => map[k])
    : [];

const normDim = (d) =>
  d === "measure"
    ? "measures"
    : d === "metric"
      ? "metrics"
      : d === "location"
        ? "store"
        : d;

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

/** Expand one column dim into an ordered list of concrete "fields". */
function dimToColumnFields(dim, ctx) {
  const d = normDim(dim);
  if (d === "measures") return [{ kind: "measure" }];
  if (d === "metrics") return [{ kind: "metric" }];
  if (d === "time")
    return ctx.timeLevels.map((attr) => ({ kind: "time", attr }));
  if (d === "product")
    return [{ kind: "hier", dim: "product", level: ctx.prodAgg }];
  if (d === "store") return [{ kind: "hier", dim: "store", level: ctx.locAgg }];
  return [];
}

/** Concrete members of a column field within a scoped fact set. */
function columnFieldMembers(field, facts, ctx) {
  if (field.kind === "measure")
    return ctx.measures.map((v) => ({ kind: "measure", value: v }));
  if (field.kind === "metric")
    return ctx.metrics.map((v) => ({ kind: "metric", value: v }));
  if (field.kind === "time")
    return distinct(facts, field.attr).map((v) => ({
      kind: "time",
      attr: field.attr,
      value: v,
    }));
  // hier
  if (isTotal(field.level))
    return [{ kind: "hier", dim: field.dim, level: null, value: "Total" }];
  return distinct(facts, field.level).map((v) => ({
    kind: "hier",
    dim: field.dim,
    level: field.level,
    value: v,
  }));
}

/** Build flat column leaves (cartesian of all column fields' members). */
function buildColumnLeaves(colFields, facts, ctx) {
  const axes = colFields.map((f) => columnFieldMembers(f, facts, ctx));
  let combos = [[]];
  axes.forEach((list) => {
    const next = [];
    combos.forEach((c) => list.forEach((m) => next.push([...c, m])));
    combos = next;
  });
  if (!combos.length || !combos[0].length) return [{ id: "__all__", path: [] }];
  return combos.map((path) => ({
    id: path.map((m) => m.value).join("|"),
    path,
  }));
}

/** Nested column header tree for the client (groups -> leaf columns). */
function buildColumnTree(leaves) {
  const nFields = leaves[0]?.path.length || 0;
  if (!nFields) return [];
  const metricOf = (path) =>
    path.find((m) => m.kind === "metric")?.value ?? null;
  const rec = (subset, d) => {
    if (d === nFields - 1) {
      return subset.map((l) => ({
        leaf: true,
        id: l.id,
        member: l.path[d],
        metric: metricOf(l.path),
      }));
    }
    const order = [];
    const map = new Map();
    subset.forEach((l) => {
      const k = l.path[d].value;
      if (!map.has(k)) {
        map.set(k, []);
        order.push(k);
      }
      map.get(k).push(l);
    });
    return order.map((k) => {
      const members = map.get(k);
      return {
        leaf: false,
        member: members[0].path[d],
        children: rec(members, d + 1),
      };
    });
  };
  return rec(leaves, 0);
}

/** Sum components + compute the selected metric for one cell's selections. */
function computeCell(scopedFacts, selections, ctx) {
  let measure = null;
  let metric = null;
  const filters = [];
  selections.forEach((m) => {
    if (m.kind === "measure") measure = m.value;
    else if (m.kind === "metric") metric = m.value;
    else if (m.kind === "time") filters.push([m.attr, m.value]);
    else if (m.kind === "hier" && m.level) filters.push([m.level, m.value]);
  });
  if (!metric) metric = ctx.metrics[0];
  if (!measure) measure = ctx.measures[0];

  let fs = scopedFacts.filter((f) => f.measure === measure);
  for (const [field, value] of filters) {
    fs = fs.filter((x) => String(x[field]) === String(value));
    if (!fs.length) break;
  }
  const comp = emptyComponents();
  fs.forEach((f) => addComponents(comp, f));
  return computeMetric(metric, comp);
}

/**
 * Main entry.
 * @param payload generic request (see below)
 * @param factsOverride pre-scoped facts (e.g. from SQL); filters re-applied.
 *
 * payload:
 *   filters[], grid_filters[]                 scope (cascaded `in`)
 *   row_context { measure?, metric? }         value dims fixed by ancestor rows
 *   enumerate { kind, dim?, level? }          the single row step to list
 *   columns: [dim...]                         column dims (ordered)
 *   product_hierarchy_levels/location_...     l1..l5 -> attribute
 *   product_hierarchy_aggregation/location_.. current column-hier level
 *   time_order_selected, measures, metrics, fiscal_ids
 */
export function runGenericPivot(payload = {}, factsOverride = null) {
  const {
    filters = [],
    grid_filters = [],
    row_context = {},
    enumerate = null,
    columns = ["measures", "time", "metrics"],
    product_hierarchy_levels = null,
    location_hierarchy_levels = null,
    product_hierarchy_aggregation = "total",
    location_hierarchy_aggregation = "total",
    time_order_selected = ["week"],
    measures = ["WCF", "MFP"],
    metrics = ["sls_u", "aur"],
    fiscal_ids = [],
    grid_id = null,
    parent_grid_id = null,
  } = payload;

  const timeLevels = (time_order_selected || [])
    .map((t) => TIME_ATTR[String(t).toLowerCase()])
    .filter(Boolean);

  const ctx = {
    prodLevels: orderMap(product_hierarchy_levels),
    locLevels: orderMap(location_hierarchy_levels),
    prodAgg: product_hierarchy_aggregation,
    locAgg: location_hierarchy_aggregation,
    timeLevels,
    measures,
    metrics,
  };

  // Scope facts: filters + drill path + week range.
  let facts = factsOverride || getFacts();
  facts = applyFilterList(facts, filters);
  facts = applyFilterList(facts, grid_filters);
  const weekKeys = (fiscal_ids || []).map(Number);
  if (weekKeys.length) {
    const ws = new Set(weekKeys);
    facts = facts.filter((f) => ws.has(f.fiscal_year_week));
  }
  facts = facts.filter((f) => measures.includes(f.measure));

  // Column structure (shared across all enumerated rows).
  const colDims = (columns || []).map(normDim);
  const colFields = colDims.flatMap((d) => dimToColumnFields(d, ctx));
  const columnLeaves = buildColumnLeaves(colFields, facts, ctx);
  const columnTree = buildColumnTree(columnLeaves);

  // Ancestor value-dim selections (fixed by parent rows).
  const ctxSelections = [];
  if (row_context.measure)
    ctxSelections.push({ kind: "measure", value: row_context.measure });
  if (row_context.metric)
    ctxSelections.push({ kind: "metric", value: row_context.metric });

  // Enumerate the requested row step's members.
  const members = [];
  const enumField = resolveEnumerateField(enumerate, ctx);
  const memberList = enumField
    ? columnFieldMembers(enumField, facts, ctx)
    : [{ kind: "single", value: "Total" }];

  memberList.forEach((mem) => {
    const selections = [...ctxSelections, mem];
    const cells = {};
    columnLeaves.forEach((leaf) => {
      cells[leaf.id] = computeCell(facts, [...selections, ...leaf.path], ctx);
    });
    members.push({
      kind: mem.kind,
      dim: mem.dim || enumField?.dim || null,
      level: mem.level ?? enumField?.level ?? enumField?.attr ?? null,
      value: mem.value,
      cells,
    });
  });

  return {
    grid_id,
    parent_grid_id,
    context: {
      enumerate,
      columns: colDims,
      product_hierarchy_aggregation: ctx.prodAgg,
      location_hierarchy_aggregation: ctx.locAgg,
      time_order_selected,
      grid_filters,
    },
    columns: columnTree,
    column_leaves: columnLeaves.map((l) => ({ id: l.id, path: l.path })),
    rows: members,
    pagination: {
      page: 1,
      limit: members.length,
      total_rows: members.length,
      has_more: false,
    },
  };
}

/** Turn an `enumerate` request into a concrete field to list members from. */
function resolveEnumerateField(enumerate, ctx) {
  if (!enumerate) return null;
  const kind = enumerate.kind;
  if (kind === "measure") return { kind: "measure" };
  if (kind === "metric") return { kind: "metric" };
  if (kind === "time") return { kind: "time", attr: enumerate.level };
  if (kind === "hier")
    return {
      kind: "hier",
      dim: normDim(enumerate.dim),
      level: enumerate.level,
    };
  return null;
}
