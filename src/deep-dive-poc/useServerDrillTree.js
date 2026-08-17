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
import { DIMENSIONS } from "./config/dimensions";
import { requestConfigKey } from "./model/contractRequest";

// 26-week fiscal calendar the DB seeds (202601 … 202626).
const ALL_WEEKS = Array.from({ length: 26 }, (_, i) => String(202601 + i));

const numAsc = (a, b) => Number(a) - Number(b);

/** A cascaded `in` filter pinning one hierarchy value. */
const cascaded = (attr, dim, value) => ({
  filter_type: "cascaded",
  attribute_name: attr,
  operator: "in",
  dimension: dim === "store" ? "store" : "product",
  values: [value],
});

/**
 * Week (fiscal_year_week) keys from a node's value block. The block nesting
 * order follows the arrangement (cfg.blockLevels, e.g. measure ▸ week vs
 * week ▸ measure), so descend to the "week" level instead of assuming a depth.
 */
function weekKeysOf(cells, cfg) {
  const levels = Array.isArray(cfg?.blockLevels)
    ? cfg.blockLevels
    : ["measure", "week", "metric"];
  let cur = cells || {};
  for (const k of levels) {
    if (cur == null) return [];
    if (k === "week") return Object.keys(cur).sort(numAsc);
    const first = Object.keys(cur)[0];
    cur = first != null ? cur[first] : null;
  }
  return [];
}

/** Member list for one inner-row / column value dimension. */
function membersFor(dim, cfg, cells) {
  if (dim === DIMENSIONS.MEASURES) return cfg.measures;
  if (dim === DIMENSIONS.METRICS) return cfg.metrics;
  if (dim === DIMENSIONS.TIME) return weekKeysOf(cells, cfg);
  return [];
}

/** The value-block key a given value dimension contributes. */
const CELL_KEY = {
  [DIMENSIONS.MEASURES]: "measure",
  [DIMENSIONS.TIME]: "week",
  [DIMENSIONS.METRICS]: "metric",
};

/** Cartesian product of the inner-row dims' members -> coordinate maps. */
function innerRowCoords(node, cfg) {
  if (!cfg.innerRowDims.length) return [{}];
  let combos = [{}];
  cfg.innerRowDims.forEach((dim) => {
    const key = CELL_KEY[dim];
    const members = membersFor(dim, cfg, node.measureCells);
    const list = members.length ? members : [undefined];
    const next = [];
    combos.forEach((c) => list.forEach((m) => next.push({ ...c, [key]: m })));
    combos = next;
  });
  return combos;
}

/**
 * Server-driven Deep Dive drill tree — GENERIC over the pivot selection.
 *
 * Driven entirely by a request config (see model/contractRequest.js):
 *   - `hierDims`   : ordered drillable row hierarchies (product / store).
 *   - `innerRowDims`/`colDims`: value dims rendered as inner rows / columns.
 *   - `payloadBase`: the static `/pivot` payload (dimension array, level maps,
 *     starting aggregations, measures, metrics, time order).
 *
 * Every hierarchy expand is a fresh POST /api/deep-dive/pivot; the backend does
 * ALL aggregation. Nodes hold one response row each (one hierarchy-value combo)
 * plus its full value block; the flatten step expands inner-row value dims.
 */
export function useServerDrillTree({ config, fiscalIds = ALL_WEEKS } = {}) {
  const [rootNodes, setRootNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((n) => n + 1), []);

  const cfg = config;
  const cfgKey = useMemo(
    () => (cfg ? requestConfigKey(cfg) + "|" + fiscalIds.length : "none"),
    [cfg, fiscalIds],
  );

  const reqIdRef = useRef(0);

  /** Build a /pivot payload for one level request. */
  const buildPayload = useCallback(
    (aggByDim, gridFilters, gridId, parentGridId) => {
      const payload = {
        ...cfg.payloadBase,
        filters: [],
        grid_filters: gridFilters,
        grid_id: gridId ?? "",
        parent_grid_id: parentGridId ?? null,
        fiscal_ids: fiscalIds,
        meta: { paginated_rows: false },
      };
      cfg.hierDims.forEach((h) => {
        // Only product/store carry a hierarchy aggregation. Time is a
        // non-drillable grouping row dim (weeks enumerated) with no agg key.
        if (h.dim !== "product" && h.dim !== "store") return;
        const aggKey =
          h.dim === "store"
            ? "location_hierarchy_aggregation"
            : "product_hierarchy_aggregation";
        payload[aggKey] = aggByDim[h.dim];
      });
      return payload;
    },
    [cfg, fiscalIds],
  );

  /** Turn one contract row into a client tree node. */
  const makeNode = useCallback(
    (row, { depth, aggByDim, pathFilters, parentGridId }) => {
      const blocks = {};
      cfg.hierDims.forEach((h) => {
        blocks[h.dim] = row[h.responseKey];
      });
      const idHier = cfg.hierDims
        .map((h) => {
          const b = blocks[h.dim];
          return `${h.dim}:${b?.aggregation_level || "total"}=${b?.value}`;
        })
        .join("|");
      const idPath = pathFilters
        .map((p) => `${p.dimension}:${p.attribute_name}=${p.values[0]}`)
        .join("/");
      return {
        id: `${idPath}||${idHier}`,
        depth,
        blocks,
        agg: { ...aggByDim },
        pathFilters,
        // Value block, read from the arrangement-driven field ("measures" or
        // "metrics"), which may be nested inside the last x-dim's identity block
        // (cfg.valueBlockHostKey, e.g. `location`) or top-level. Nesting order
        // follows cfg.blockLevels.
        measureCells:
          (cfg.valueBlockHostKey
            ? row[cfg.valueBlockHostKey]?.[cfg.valueBlockField]
            : row[cfg.valueBlockField]) ||
          row[cfg.valueBlockField] ||
          row.measures ||
          {},
        gridId: row.grid_id ?? null,
        parentGridId: parentGridId ?? null,
        children: null,
        expandedDim: null,
        loading: false,
      };
    },
    [cfg],
  );

  // Initial load: every hierarchy at its first selected level.
  useEffect(() => {
    if (!cfg) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    const aggByDim = {};
    cfg.hierDims.forEach((h) => {
      aggByDim[h.dim] = h.startAgg;
    });
    fetchPivotTable(buildPayload(aggByDim, [], "", null))
      .then((res) => {
        if (reqId !== reqIdRef.current) return;
        const nodes = (res.rows || []).map((row) =>
          makeNode(row, {
            depth: 0,
            aggByDim,
            pathFilters: [],
            parentGridId: null,
          }),
        );
        setRootNodes(nodes);
        setLoading(false);
      })
      .catch((err) => {
        console.error("[useServerDrillTree] initial load failed", err);
        if (reqId === reqIdRef.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgKey]);

  /** Fetch and attach one node's children by drilling the given hierarchy. */
  const expand = useCallback(
    async (node, axisDim) => {
      const h = cfg.hierDims.find((x) => x.dim === axisDim);
      const block = node.blocks[axisDim];
      if (!h || !block || !block.has_children) return;

      // Toggle collapse.
      if (node.expandedDim === axisDim) {
        node.children = null;
        node.expandedDim = null;
        bump();
        return;
      }
      // Switching axes: drop previously loaded children first.
      if (node.expandedDim) {
        node.children = null;
        node.expandedDim = null;
      }

      // Pin THIS node's value on every hierarchy (so children are scoped to it),
      // then advance only the chosen axis to its next level.
      const selfFilters = cfg.hierDims
        .map((hd) => {
          const b = node.blocks[hd.dim];
          if (!b || b.aggregation_level == null) return null;
          return cascaded(b.aggregation_level, hd.dim, b.value);
        })
        .filter(Boolean);
      const gridFilters = [...node.pathFilters, ...selfFilters];
      const aggByDim = { ...node.agg, [axisDim]: block.next_level };

      node.loading = true;
      bump();

      try {
        const res = await fetchPivotTable(
          buildPayload(aggByDim, gridFilters, node.gridId, node.parentGridId),
        );
        node.children = (res.rows || []).map((row) =>
          makeNode(row, {
            depth: node.depth + 1,
            aggByDim,
            pathFilters: gridFilters,
            parentGridId: node.gridId,
          }),
        );
        node.expandedDim = axisDim;
      } catch (err) {
        console.error("[useServerDrillTree] expand failed", err);
        node.children = [];
        node.expandedDim = axisDim;
      } finally {
        node.loading = false;
        bump();
      }
    },
    [cfg, buildPayload, makeNode, bump],
  );

  /**
   * Depth-first flatten into visible grid rows. Each node emits the cartesian
   * product of its inner-row value dims (measure / metric / week), so those
   * dims render as inner row dimensions. Column value dims are read per-column.
   */
  const rows = useMemo(() => {
    if (!cfg) return [];
    const out = [];
    const walk = (nodes) => {
      nodes.forEach((n) => {
        const combos = innerRowCoords(n, cfg);
        // First pass: per-row "show" flags (a dim's label renders only on the
        // first row of its group). Combos are in canonical nesting order, so
        // once an outer dim changes every deeper dim also "starts" fresh.
        const shows = combos.map((coord, i) => {
          const show = {};
          let changed = false;
          const prev = i > 0 ? combos[i - 1] : null;
          cfg.innerRowDims.forEach((dim) => {
            const key = CELL_KEY[dim];
            if (!prev || changed || prev[key] !== coord[key]) {
              show[key] = true;
              changed = true;
            } else {
              show[key] = false;
            }
          });
          return show;
        });
        combos.forEach((coord, i) => {
          // A dim's group ends here when it's the last combo, or the NEXT combo
          // starts a fresh group for that dim (its show flag is true). This is
          // where that pinned column draws its horizontal separator, so an
          // outer dim (Measure) merges across its inner rows while the leaf dim
          // (Metric) separates every row.
          const grpLast = {};
          const nextShow = i < combos.length - 1 ? shows[i + 1] : null;
          cfg.innerRowDims.forEach((dim) => {
            const key = CELL_KEY[dim];
            grpLast[key] = !nextShow || nextShow[key] === true;
          });
          out.push({
            id: `${n.id}##${JSON.stringify(coord)}`,
            node: n,
            coord,
            depth: n.depth,
            __first: i === 0,
            __last: i === combos.length - 1,
            __show: shows[i],
            __grpLast: grpLast,
          });
        });
        if (n.loading) {
          out.push({
            id: `${n.id}##__loading__`,
            __shimmer: true,
            depth: n.depth + 1,
          });
        }
        if (n.expandedDim && n.children) walk(n.children);
      });
    };
    walk(rootNodes);

    // Cross-node cell-merge for the pinned hierarchy tree columns. When a deeper
    // hierarchy is drilled (e.g. Location under a Product), every child row
    // repeats the ancestor's value for the shallower columns. Merge those: each
    // hierarchy column renders its label only on the first grid row of a
    // contiguous run sharing the same value PREFIX (its own value + all columns
    // to its left), and draws its row separator only at that run's last row.
    // Generic over any number of hierarchy columns (Product, Location, …).
    const hierKey = (node, i) =>
      node
        ? JSON.stringify(
            cfg.hierDims
              .slice(0, i + 1)
              .map((h) => node.blocks?.[h.dim]?.value),
          )
        : null;
    const prevRowIdx = (r) => {
      let p = r - 1;
      while (p >= 0 && out[p].__shimmer) p--;
      return p;
    };
    const nextRowIdx = (r) => {
      let nx = r + 1;
      while (nx < out.length && out[nx].__shimmer) nx++;
      return nx < out.length ? nx : -1;
    };
    out.forEach((row, r) => {
      if (row.__shimmer) return;
      const showHier = {};
      const hierGrpLast = {};
      const p = prevRowIdx(r);
      const nx = nextRowIdx(r);
      cfg.hierDims.forEach((h, i) => {
        const key = hierKey(row.node, i);
        const prevKey = p >= 0 ? hierKey(out[p].node, i) : null;
        const nextKey = nx >= 0 ? hierKey(out[nx].node, i) : null;
        showHier[h.dim] = key !== prevKey; // first row of this run
        hierGrpLast[h.dim] = nextKey !== key; // last row of this run
      });
      row.__showHier = showHier;
      row.__hierGrpLast = hierGrpLast;
    });

    return out;
    // Nodes mutate in place; `version` (bumped on every change) drives recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootNodes, version, cfg]);

  return { loading, rows, expand };
}
