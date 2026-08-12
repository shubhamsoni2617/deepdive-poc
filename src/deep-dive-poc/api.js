import { generateMockData } from "./mockData";
import { MEASURES, LEVELS_BY_DIMENSION } from "./constants";
import {
  METRIC_REGISTRY,
  METRIC_ORDER,
  emptyComponents,
  addRecordComponents,
} from "./config/metrics";
import { runPivotQuery } from "./db/pivotQuery";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchDeepDiveData(payload = {}) {
  await delay(300);

  const { arrangement = null, levels = null } = payload;
  const data = generateMockData();

  return {
    success: true,
    data,
    meta: {
      totalRecords: data.length,
      arrangement,
      levels,
      availableDimensions: Object.keys(LEVELS_BY_DIMENSION),
      availableLevels: Object.fromEntries(
        Object.entries(LEVELS_BY_DIMENSION).map(([dim, list]) => [
          dim,
          list.map((l) => l.key),
        ]),
      ),
      availableMeasures: MEASURES,
      availableMetrics: ["slsU", "sls$", "cogs", "aur", "auc", "gm$", "gm%"],
      editableMetric: "slsU",
    },
  };
}

export async function applyArrangement(payload) {
  await delay(100);
  return {
    success: true,
    arrangement: payload.arrangement,
    levels: payload.levels,
  };
}

export async function saveEdits(payload) {
  await delay(500);
  return {
    success: true,
    version: Date.now(),
    updatedCount: payload?.records?.length ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Generic contract mock (see docs/deep-dive-api.md).
//
// A single request/response shape serves every arrangement (A1–A14). A view is
// `{ rows, columns }` over the dimensions; Product/Store are drilled one level
// per call (server-side paginated); each call returns all requested
// measures × metrics. Value dims (measure/metric) may live in rows or columns.
// ---------------------------------------------------------------------------

const TREE_FIELDS = {
  product: ["division", "department", "class", "sku"],
  store: ["channel", "state", "storeId"],
  time: ["quarter", "month", "week"],
};

const isValueDim = (d) => d === "measure" || d === "metric";

/** Read a levels[] list for a dimension, tolerating singular/plural keys. */
function levelsFor(levels, dim) {
  if (!levels) return null;
  const plural =
    dim === "measure" ? "measures" : dim === "metric" ? "metrics" : dim;
  return levels[dim] || levels[plural] || null;
}

function selectedMeasures(levels) {
  return levelsFor(levels, "measure") || MEASURES;
}

function selectedMetrics(levels) {
  return levelsFor(levels, "metric") || METRIC_ORDER;
}

/** Deepest selected level field for a tree/time dimension. */
function leafFieldFor(dim, levels) {
  const all = TREE_FIELDS[dim] || [];
  const sel = levelsFor(levels, dim);
  const chosen = sel && sel.length ? all.filter((f) => sel.includes(f)) : all;
  return chosen[chosen.length - 1] || all[all.length - 1];
}

/** Compute one metric from a list of raw records (handles ratio metrics). */
function computeMetricFromRecords(metricKey, records) {
  const acc = emptyComponents();
  records.forEach((r) => addRecordComponents(acc, r));
  const m = METRIC_REGISTRY[metricKey];
  if (!m) return null;
  const v = m.compute(acc);
  return v == null || Number.isNaN(v) ? null : Number(v);
}

/** Scope records by an ancestor parentPath ([{ level, value }]) on any tree. */
function applyParentPath(records, parentPath) {
  if (!parentPath || !parentPath.length) return records;
  return records.filter((r) =>
    parentPath.every((p) => String(r[p.level]) === String(p.value)),
  );
}

/** Apply the coarse `filters.division`/`banner` conveniences if present. */
function applyFilters(records, filters) {
  if (!filters) return records;
  // Only `division` maps to mock data; other filters are accepted no-ops.
  if (filters.division && TREE_FIELDS.product.includes("division")) {
    // filters.division is like "3115-MISSES BETTER SPORTSWEAR"; mock uses names
    // (Womenswear, ...). Skip strict matching — treat as no-op for the PoC.
  }
  return records;
}

/** Distinct, sorted values of a field within a record set. */
function distinctValues(records, field) {
  const set = new Set();
  records.forEach((r) => set.add(r[field]));
  return Array.from(set).sort((a, b) =>
    String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
  );
}

/**
 * Build ordered column descriptors from the column-side dims. Each column dim
 * contributes a value list (measure/metric selections, or the distinct leaf
 * values of a tree/time dim); the cartesian product yields one column per
 * combination. `columnKey` joins values with "|" in arrangement order.
 */
function buildColumns(columnDims, records, levels) {
  const axes = columnDims.map((dim) => {
    if (dim === "measure") {
      return selectedMeasures(levels).map((v) => ({
        dimension: "measure",
        value: v,
      }));
    }
    if (dim === "metric") {
      return selectedMetrics(levels).map((v) => ({
        dimension: "metric",
        value: v,
      }));
    }
    const field = leafFieldFor(dim, levels);
    return distinctValues(records, field).map((v) => ({
      dimension: dim,
      level: field,
      value: v,
    }));
  });

  let combos = [[]];
  axes.forEach((list) => {
    const next = [];
    combos.forEach((chosen) => list.forEach((p) => next.push([...chosen, p])));
    combos = next;
  });

  return combos.map((path) => ({
    key: path.map((p) => p.value).join("|"),
    hasChildren: false,
    nextLevel: null,
    path,
  }));
}

/**
 * Mock of `POST /api/deep-dive/table`. Returns one drilled level of rows for
 * the requested tree dimension, server-side paginated, with every column
 * (measure/metric/time combination) resolved to a scalar cell.
 */
export async function fetchDeepDiveTable(payload = {}) {
  await delay(250);

  const {
    view = { rows: ["product", "metric"], columns: ["measure", "time"] },
    levels = null,
    filters = null,
    drill = null,
    pagination = { offset: 0, limit: 50 },
  } = payload;

  const rowDims = view.rows || [];
  const columnDims = view.columns || [];

  // Scope: coarse filters + drill parentPath, then measure selection.
  let scoped = applyFilters(generateMockData(), filters);
  scoped = applyParentPath(scoped, drill?.parentPath);
  const measures = selectedMeasures(levels);
  scoped = scoped.filter((r) => measures.includes(r.measure));

  // Which dimension/level are we expanding into rows right now?
  const primaryTreeDim =
    drill?.dimension || rowDims.find((d) => !isValueDim(d)) || null;
  const drillLevel =
    drill?.level ||
    (primaryTreeDim ? (TREE_FIELDS[primaryTreeDim] || [])[0] : null);

  // Columns are consistent across the page — computed from the scoped set.
  const columns = buildColumns(columnDims, scoped, levels);

  // Row-side value dims (measure/metric) expand each node into combo rows.
  const rowValueDims = rowDims.filter(isValueDim);
  const rowValueLists = rowValueDims.map((d) =>
    d === "measure" ? measures : selectedMetrics(levels),
  );
  const rowCombos = rowValueLists.reduce(
    (acc, list, i) => {
      const next = [];
      acc.forEach((chosen) =>
        list.forEach((v) => next.push({ ...chosen, [rowValueDims[i]]: v })),
      );
      return next;
    },
    [{}],
  );

  // Group scoped records by the drilled level's field (the sibling nodes).
  const nodeMap = new Map();
  const nodeOrder = [];
  const groupField = drillLevel;
  scoped.forEach((r) => {
    const key = groupField ? r[groupField] : "__all__";
    if (!nodeMap.has(key)) {
      nodeMap.set(key, []);
      nodeOrder.push(key);
    }
    nodeMap.get(key).push(r);
  });
  nodeOrder.sort((a, b) =>
    String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
  );

  // Deeper level (for hasChildren / nextLevel), respecting the selection.
  const treeChain = TREE_FIELDS[primaryTreeDim] || [];
  const selectedChain = (() => {
    const sel = levelsFor(levels, primaryTreeDim);
    return sel && sel.length
      ? treeChain.filter((f) => sel.includes(f))
      : treeChain;
  })();
  const drillIdx = selectedChain.indexOf(drillLevel);
  const nextLevel =
    drillIdx >= 0 && drillIdx + 1 < selectedChain.length
      ? selectedChain[drillIdx + 1]
      : null;

  const total = nodeOrder.length;
  const offset = pagination?.offset || 0;
  const limit = pagination?.limit || total;
  const pageKeys = nodeOrder.slice(offset, offset + limit);

  const measureInRows =
    rowDims.includes("measure") || rowDims.includes("measures");
  const metricInRows =
    rowDims.includes("metric") || rowDims.includes("metrics");

  const rows = [];
  pageKeys.forEach((nodeKey) => {
    const nodeRecords = nodeMap.get(nodeKey);
    rowCombos.forEach((combo) => {
      const effMeasure = measureInRows ? combo.measure : null;
      const effMetric = metricInRows ? combo.metric : null;

      const axes = rowDims.map((dim) => {
        if (dim === "measure" || dim === "measures")
          return { dimension: "measure", value: combo.measure };
        if (dim === "metric" || dim === "metrics") {
          const editable = combo.metric === "slsU";
          return { dimension: "metric", value: combo.metric, editable };
        }
        if (dim === primaryTreeDim) {
          return {
            dimension: dim,
            level: drillLevel,
            value: nodeKey,
            hasChildren: !!nextLevel,
            nextLevel,
          };
        }
        return { dimension: dim, level: null, value: null };
      });

      const cells = {};
      columns.forEach((col) => {
        // Resolve effective measure/metric using row-side + column-side dims.
        let measure = effMeasure;
        let metric = effMetric;
        const treeFilters = [];
        col.path.forEach((p) => {
          if (p.dimension === "measure") measure = p.value;
          else if (p.dimension === "metric") metric = p.value;
          else treeFilters.push([p.level, p.value]);
        });
        if (!measure) measure = measures[0];
        if (!metric) metric = selectedMetrics(levels)[0];

        const cellRecords = nodeRecords.filter(
          (r) =>
            r.measure === measure &&
            treeFilters.every(([f, v]) => String(r[f]) === String(v)),
        );
        cells[col.key] = computeMetricFromRecords(metric, cellRecords);
      });

      rows.push({
        id: [nodeKey, combo.measure ?? "", combo.metric ?? ""].join("\u0001"),
        axes,
        cells,
      });
    });
  });

  return {
    success: true,
    context: {
      dimension: primaryTreeDim,
      level: drillLevel,
      parentPath: drill?.parentPath || [],
    },
    columns,
    rows,
    pagination: {
      offset,
      limit,
      total,
      hasMore: offset + limit < total,
    },
    meta: {
      availableMeasures: MEASURES,
      availableMetrics: METRIC_ORDER,
      editableMetrics: ["slsU"],
      availableLevels: Object.fromEntries(
        Object.entries(LEVELS_BY_DIMENSION).map(([dim, list]) => [
          dim,
          list.map((l) => l.key),
        ]),
      ),
    },
  };
}

/** Mock of `POST /api/deep-dive/edits`. */
export async function fetchDeepDiveEdits(payload = {}) {
  await delay(400);
  return {
    success: true,
    version: Date.now(),
    updatedCount: payload?.edits?.length ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Granular-DB pivot API (see src/deep-dive-poc/db/*).
//
// This is the "real" contract endpoint: it aggregates the base-grain fact table
// (26 weeks × SKU × Store × Measure) on demand from the pivot selection payload
// and returns the agreed row/column response shape.
// ---------------------------------------------------------------------------

/** Mock of `POST /api/deep-dive/pivot` — selection-driven aggregation. */
export async function fetchPivotTable(payload = {}) {
  await delay(250);
  return runPivotQuery(payload);
}
