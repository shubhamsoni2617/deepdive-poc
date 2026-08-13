/**
 * Ad-hoc verification of the /api/deep-dive/pivot contract against the running
 * server. Uses the seed's real values (USA, Menswear, ...). Run: node this file
 * while the server is up on :8787.
 */

const BASE = "http://localhost:8787/api/deep-dive/pivot";

const productLevels = {
  l1: "l0_code",
  l2: "l1_name",
  l3: "l3_name",
  l4: "l4_name",
  l5: "product_code",
};
const locationLevels = {
  l1: "country",
  l2: "state",
  l3: "district",
  l4: "city",
  l5: "store_code",
};

function basePayload(overrides = {}) {
  return {
    filters: [
      {
        filter_type: "cascaded",
        attribute_name: "country",
        operator: "in",
        dimension: "location",
        values: ["USA"],
      },
    ],
    grid_filters: [],
    grid_id: "test-grid",
    parent_grid_id: null,
    product_hierarchy_levels: productLevels,
    location_hierarchy_levels: locationLevels,
    product_hierarchy_aggregation: "l1_name",
    location_hierarchy_aggregation: "total",
    time_hierarchy_aggregation: "total",
    time_order_selected: ["month", "week"],
    measures: ["WCF", "MFP"],
    metrics: ["sls_u", "aur"],
    fiscal_ids: ["202601", "202602", "202603", "202604", "202605"],
    meta: { paginated_rows: false },
    ...overrides,
  };
}

const scenarios = {
  "1. Default (product@l1_name, location Total)": basePayload(),

  "2. Drill product 1 level (l3_name under Menswear)": basePayload({
    grid_filters: [
      {
        filter_type: "cascaded",
        attribute_name: "l1_name",
        operator: "in",
        dimension: "product",
        values: ["Menswear"],
      },
    ],
    product_hierarchy_aggregation: "l3_name",
  }),

  "3. Drill location 1 level (state, product Total)": basePayload({
    product_hierarchy_aggregation: "total",
    location_hierarchy_aggregation: "state",
  }),

  "4. Drill product@l3_name + location@state (both)": basePayload({
    grid_filters: [
      {
        filter_type: "cascaded",
        attribute_name: "l1_name",
        operator: "in",
        dimension: "product",
        values: ["Menswear"],
      },
    ],
    product_hierarchy_aggregation: "l3_name",
    location_hierarchy_aggregation: "state",
  }),
};

for (const [name, payload] of Object.entries(scenarios)) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  console.log("\n==== " + name + " ====");
  console.log("rows:", json.rows?.length, "| context:", JSON.stringify(json.context?.product_hierarchy_aggregation) + "/" + JSON.stringify(json.context?.location_hierarchy_aggregation));
  console.log(JSON.stringify(json.rows?.[0], null, 2));
}
