# Deep Dive Table — API Contract

One generic request/response covers **all 14 arrangements (A1–A14)**. A "view" is
fully described by `rows[]` + `columns[]` over five dimensions, so there are no
per-view endpoints. Product & Store are drilled **one level per call** with
server-side pagination; each call returns **all requested measures × metrics**.

## Dimensions

| Dimension | Type   | Levels (top → bottom)                     |
|-----------|--------|-------------------------------------------|
| `product` | tree   | `division → department → class → sku`     |
| `store`   | tree   | `channel → state → storeId`               |
| `time`    | axis   | `quarter → month → week`                  |
| `measure` | value  | `WCF`, `LY`, `MFP` (scenarios)            |
| `metric`  | value  | `slsU, sls$, cogs, aur, auc, gm$, gm%, mfp, ly, varLY` |

- `measure` = which scenario. `metric` = which KPI. A **scalar** requires both
  to be fixed (whether they sit in rows or columns).
- Editable metric: `slsU` only.
- Ratio metrics (`aur, auc, gm%, varLY`) are **not additive** — the backend must
  return them already computed at the requested aggregation level.

## Unified addressing rule

- Each dimension is either a **row axis** or a **column axis** (incl. `measure`/`metric`).
- **Row identity** = ordered values of all row-side dims (`rows[].axes`).
- **Column key** = ordered join of all column-side dims' values (`columns[].key`).
- **Cell** = scalar, addressed by `cells[columnKey]`.
- Value dims in **rows** ⇒ a node emits multiple rows (one per measure/metric combo).
- Value dims in **columns** ⇒ they become part of the column key.

## `POST /api/deep-dive/table`

### Request

```jsonc
{
  "view":   { "rows": ["product","store","metric"], "columns": ["measure","time"] },
  "levels": {
    "product": ["division","department","sku"],
    "store":   ["channel","storeId"],
    "time":    ["month"],
    "measure": ["WCF","MFP"],
    "metric":  ["slsU","aur","gm%"]
  },
  "filters": { "banner":"20-BFL", "dateRange": { "from":"2026-07", "to":"2026-11" } },
  "drill":   { "dimension":"product", "level":"department",
               "parentPath":[{ "level":"division", "value":"Womenswear" }] },
  "pagination": { "offset":0, "limit":50 },
  "sort": [{ "columnKey":"WCF|2026-07", "metric":"slsU", "dir":"desc" }]
}
```

- `drill.dimension` + `drill.level` = which level's sibling rows to return now.
  First load: `parentPath:[]`, `level` = top selected level of the primary tree dim.
- `parentPath` scopes the slice — this is how Product **and** Store each get their
  own per-level call.
- `pagination` paginates the **siblings at this level** (server-side).

### Response

```jsonc
{
  "success": true,
  "context": { "dimension":"product", "level":"department",
               "parentPath":[{ "level":"division", "value":"Womenswear" }] },
  "columns": [
    { "key":"WCF|2026-07", "hasChildren": false, "nextLevel": null,
      "path":[{"dimension":"measure","value":"WCF"},
              {"dimension":"time","level":"month","value":"2026-07"}] }
  ],
  "rows": [
    { "id": "Womenswear\u0001Tops\u0001slsU",
      "axes": [
        { "dimension":"product", "level":"department", "value":"Tops",
          "hasChildren":true, "nextLevel":"sku" },
        { "dimension":"store", "level":null, "value":null },
        { "dimension":"metric", "value":"slsU", "editable":true }
      ],
      "cells": { "WCF|2026-07": 1200 } }
  ],
  "pagination": { "offset":0, "limit":50, "total":128, "hasMore":true },
  "meta": {
    "availableMeasures": ["WCF","LY","MFP"],
    "availableMetrics":  ["slsU","sls$","cogs","aur","auc","gm$","gm%","mfp","ly","varLY"],
    "editableMetrics":   ["slsU"]
  }
}
```

- `rows[].axes` — one entry per **row** dim in order. Non-row value dims carry `value:null`.
- `hasChildren`/`nextLevel` — drive the next drill call (rows or columns).
- Columns can also be drilled per level (e.g. A9/A10 where `store` is a column axis):
  `drill.dimension:"store"` and `columns[]` carry `hasChildren`/`nextLevel`.

## `POST /api/deep-dive/edits`

```jsonc
{
  "filters": { "...": "..." },
  "edits": [
    { "rowPath":[{ "dimension":"product","level":"sku","value":"D01-DEPT1-CLS1-SKU001" }],
      "columnKey":"2026-07", "measure":"WCF", "metric":"slsU", "value":1300 }
  ]
}
```

Response: `{ "success": true, "version": 1739181234567, "updatedCount": 1 }`.

## The 14 views — only `view` changes

| View | rows | columns | columnKey pattern | drill dim(s) |
|------|------|---------|-------------------|--------------|
| A1  | `product, store, metric`  | `measure, time`         | `{measure}\|{time}`         | product, store |
| A2  | `product, store, metric`  | `time, measure`         | `{time}\|{measure}`         | product, store |
| A3  | `product, store, measure` | `time, metric`          | `{time}\|{metric}`          | product, store |
| A4  | `product, store`          | `measure, time, metric` | `{measure}\|{time}\|{metric}` | product, store |
| A5  | `product, store`          | `time, metric, measure` | `{time}\|{metric}\|{measure}` | product, store |
| A6  | `product, measure`        | `time, metric`          | `{time}\|{metric}`          | product |
| A7  | `product`                 | `measure, metric`       | `{measure}\|{metric}`       | product |
| A8  | `product, metric`         | `time, measure`         | `{time}\|{measure}`         | product |
| A9  | `product, metric`         | `store, measure`        | `{store}\|{measure}`        | product, **store (cols)** |
| A10 | `product, metric`         | `time, store, measure`  | `{time}\|{store}\|{measure}` | product, **store (cols)** |
| A11 | `time`                    | `measure, metric`       | `{measure}\|{metric}`       | — (time rows) |
| A12 | `metric`                  | `measure`               | `{measure}`                 | — (grand total) |
| A13 | `measure`                 | `metric`                | `{metric}`                  | — (grand total) |
| A14 | `product, store, time`    | `metric, measure`       | `{metric}\|{measure}`       | product, store, time (rows) |
