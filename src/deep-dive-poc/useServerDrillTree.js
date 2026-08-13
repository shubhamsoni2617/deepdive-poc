/**
 * Server-driven Deep Dive drill tree.
 *
 * Every hierarchy expand is a fresh POST /api/deep-dive/pivot call — the backend
 * does ALL aggregation. The client never re-aggregates; it only:
 *   - keeps the initial (level-1) rows,
 *   - lazily fetches a node's children when its chevron is expanded,
 *   - flattens the loaded node tree into visible grid rows (depth-first).
 *
 * Drill semantics (per node, matching the /pivot contract):
 *   - A node carries its cascaded product/location paths (grid_filters) and the
 *     aggregation level that produced it.
 *   - Expanding a node's PRODUCT block  -> product_hierarchy_aggregation =
 *     product.next_level, grid_filters += the node's product value. Children are
 *     scoped to this node (and its current location path) => a real per-node
 *     subtree, all aggregated server-side.
 *   - Expanding a node's LOCATION block -> same, on the location axis. Because
 *     grid_filters still pins the product path, the location breakdown is scoped
 *     to that specific product node.
 *   - A node can be expanded on at most one axis at a time (mutual exclusion),
 *     mirroring the original UI's accordion behaviour.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchPivotTable } from "./api";

// Friendly product/location hierarchies mapped onto the seeded DB attributes.
// Product: Division -> Department -> Class -> SKU.
export const PRODUCT_HIERARCHY_LEVELS = {
  l1: "l1_name",
  l2: "l3_name",
  l3: "l4_name",
  l4: "product_code",
};
// Location: Country -> State -> City -> Store.
export const LOCATION_HIERARCHY_LEVELS = {
  l1: "country",
  l2: "state",
  l3: "city",
  l4: "store_code",
};

const GLOBAL_FILTERS = [];

// 26-week fiscal calendar the DB seeds (202601 … 202626).
const ALL_WEEKS = Array.from({ length: 26 }, (_, i) => String(202601 + i));

const orderedLevels = (map) =>
  Object.keys(map)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .map((k) => map[k]);

const PRODUCT_ORDER = orderedLevels(PRODUCT_HIERARCHY_LEVELS);
const LOCATION_ORDER = orderedLevels(LOCATION_HIERARCHY_LEVELS);

/** Build the /pivot payload for one level request. */
function buildPayload({
  prodAgg,
  locAgg,
  gridFilters,
  measures,
  metrics,
  timeOrder,
  fiscalIds,
}) {
  return {
    // Declares the row (y) / cell (x) axes so /pivot routes to the contract
    // row builder (runContractRows). Rows: Product ▸ Store ▸ Measure;
    // Columns: Time ▸ Metric.
    dimension: [
      { dimension: "product", axis: "y" },
      { dimension: "location", axis: "y" },
      { dimension: "measure", axis: "y" },
      { dimension: "time", axis: "x" },
      { dimension: "metric", axis: "x" },
    ],
    filters: GLOBAL_FILTERS,
    grid_filters: gridFilters,
    grid_id: "deep-dive-poc",
    parent_grid_id: null,
    product_hierarchy_levels: PRODUCT_HIERARCHY_LEVELS,
    location_hierarchy_levels: LOCATION_HIERARCHY_LEVELS,
    product_hierarchy_aggregation: prodAgg,
    location_hierarchy_aggregation: locAgg,
    time_order_selected: timeOrder,
    measures,
    metrics,
    fiscal_ids: fiscalIds,
    meta: { paginated_rows: false },
  };
}

/** Stable identity for one (product, location) row, ignoring the measure. */
function rowIdentity(row) {
  const p =
    row.product?.aggregation_level != null
      ? `${row.product.aggregation_level}=${row.product.value}`
      : `P*=${row.product?.value ?? ""}`;
  const l =
    row.location?.aggregation_level != null
      ? `${row.location.aggregation_level}=${row.location.value}`
      : `L*=${row.location?.value ?? ""}`;
  return `${p}|${l}`;
}

/**
 * Group the contract's measure-separated rows into one node per
 * (product, location) identity. Each node carries `measureCells`
 * ({ measure -> cells }) and the ordered measure list, so the grid can render
 * one sub-row per measure (WCF/MFP) under each product/location node.
 */
function groupRows(rows, ctx) {
  const order = [];
  const byId = new Map();
  (rows || []).forEach((row) => {
    const key = rowIdentity(row);
    if (!byId.has(key)) {
      byId.set(key, []);
      order.push(key);
    }
    byId.get(key).push(row);
  });
  return order.map((key) => makeNode(byId.get(key), ctx));
}

/** Turn a group of measure-rows (same identity) into a client tree node. */
function makeNode(
  groupRowsList,
  { depth, dim, productPath, locationPath, prodAgg, locAgg },
) {
  const row = groupRowsList[0];
  const measureCells = {};
  const measureOrder = [];
  groupRowsList.forEach((r) => {
    const m = r.measure?.value;
    if (m == null) return;
    if (!(m in measureCells)) measureOrder.push(m);
    measureCells[m] = r.cells || {};
  });
  const id = [...productPath, ...locationPath]
    .map((p) => `${p.dimension}:${p.attribute_name}=${p.values[0]}`)
    .concat(rowIdentity(row))
    .join("/");
  return {
    id,
    depth,
    dim, // axis this node advanced on relative to its parent
    productPath,
    locationPath,
    prodAgg,
    locAgg,
    product: row.product,
    location: row.location,
    measureCells,
    measureOrder,
    children: null,
    expandedDim: null,
    loading: false,
  };
}

export function useServerDrillTree({
  measures = ["WCF", "MFP"],
  metrics = ["sls_u", "aur"],
  timeOrder = ["month", "week"],
  fiscalIds = ALL_WEEKS,
} = {}) {
  const [rootNodes, setRootNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((n) => n + 1), []);

  const cfg = useMemo(
    () => ({ measures, metrics, timeOrder, fiscalIds }),
    [measures, metrics, timeOrder, fiscalIds],
  );
  const cfgKey = useMemo(
    () => JSON.stringify([measures, metrics, timeOrder, fiscalIds]),
    [measures, metrics, timeOrder, fiscalIds],
  );

  const reqIdRef = useRef(0);

  // Initial load: product level-1 (Division), location = Total.
  useEffect(() => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    const prodAgg = PRODUCT_ORDER[0];
    const locAgg = "total";
    fetchPivotTable(buildPayload({ prodAgg, locAgg, gridFilters: [], ...cfg }))
      .then((res) => {
        if (reqId !== reqIdRef.current) return;
        const nodes = groupRows(res.rows, {
          depth: 0,
          dim: "product",
          productPath: [],
          locationPath: [],
          prodAgg,
          locAgg,
        });
        setRootNodes(nodes);
        setLoading(false);
      })
      .catch((err) => {
        console.error("[useServerDrillTree] initial load failed", err);
        if (reqId === reqIdRef.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgKey]);

  /** Fetch and attach one node's children on the given axis. */
  const expand = useCallback(
    async (node, axis) => {
      const block = axis === "product" ? node.product : node.location;
      if (!block || !block.has_children) return;

      // Toggle: clicking the same axis that's open collapses it.
      if (node.expandedDim === axis) {
        node.children = null;
        node.expandedDim = null;
        bump();
        return;
      }
      // Switching axes: drop the previously loaded children first.
      if (node.expandedDim) {
        node.children = null;
        node.expandedDim = null;
      }

      // Pin THIS node's identity on both axes (so children are scoped to it),
      // then advance only the chosen axis to its next level.
      const cascaded = (attr, dim, value) => ({
        filter_type: "cascaded",
        attribute_name: attr,
        operator: "in",
        dimension: dim,
        values: [value],
      });
      const selfProd =
        node.product?.aggregation_level != null
          ? cascaded(
              node.product.aggregation_level,
              "product",
              node.product.value,
            )
          : null;
      const selfLoc =
        node.location?.aggregation_level != null
          ? cascaded(
              node.location.aggregation_level,
              "location",
              node.location.value,
            )
          : null;

      const productPath = selfProd
        ? [...node.productPath, selfProd]
        : node.productPath;
      const locationPath = selfLoc
        ? [...node.locationPath, selfLoc]
        : node.locationPath;

      const prodAgg = axis === "product" ? block.next_level : node.prodAgg;
      const locAgg = axis === "location" ? block.next_level : node.locAgg;

      node.loading = true;
      bump();

      const gridFilters = [...productPath, ...locationPath];
      const res = await fetchPivotTable(
        buildPayload({ prodAgg, locAgg, gridFilters, ...cfg }),
      );
      const children = groupRows(res.rows, {
        depth: node.depth + 1,
        dim: axis,
        productPath,
        locationPath,
        prodAgg,
        locAgg,
      });
      node.children = children;
      node.expandedDim = axis;
      node.loading = false;
      bump();
    },
    [cfg, bump],
  );

  /**
   * Depth-first flatten of loaded, expanded nodes into visible grid rows.
   * Each node emits ONE row per measure (WCF/MFP) so measure renders as an
   * inner row dimension, matching the original manual pivot.
   */
  const rows = useMemo(() => {
    const out = [];
    const walk = (nodes) => {
      nodes.forEach((n) => {
        const ms = n.measureOrder.length ? n.measureOrder : [""];
        ms.forEach((measure, i) => {
          out.push({
            id: `${n.id}##${measure}`,
            node: n,
            measure,
            depth: n.depth,
            __first: i === 0,
            __last: i === ms.length - 1,
          });
        });
        if (n.expandedDim && n.children) walk(n.children);
      });
    };
    walk(rootNodes);
    return out;
    // Nodes mutate in place; `version` (bumped on every change) drives recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootNodes, version]);

  return { loading, rows, expand };
}
