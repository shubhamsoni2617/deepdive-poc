export const DIMENSIONS = {
  PRODUCT: "product",
  STORE: "store",
  TIME: "time",
  MEASURES: "measures",
  METRICS: "metrics",
};

export const PRODUCT_LEVELS = [
  { key: "division", label: "Division" },
  { key: "department", label: "Department" },
  { key: "class", label: "Class" },
  { key: "sku", label: "SKU" },
];

export const STORE_LEVELS = [
  { key: "channel", label: "Channel" },
  { key: "state", label: "State" },
  { key: "storeId", label: "Store ID" },
];

export const TIME_LEVELS = [
  { key: "quarter", label: "Quarter" },
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
];

export const MEASURE_LEVELS = [
  { key: "slsU", label: "WCF", locked: true },
  { key: "mfp", label: "MFP" },
  { key: "ly", label: "LY" },
  { key: "varLY", label: "Var LY(%)" },
];

export const MEASURES = ["WCF", "LY", "MFP"];

export const METRICS = [
  { key: "slsU", label: "Sls U", editable: true },
  { key: "sls$", label: "Sls $" },
  { key: "cogs", label: "COGS" },
  { key: "aur", label: "AUR" },
  { key: "auc", label: "AUC" },
  { key: "gm$", label: "GM $" },
  { key: "gm%", label: "GM %" },
];

export const METRIC_LEVELS = [
  { key: "slsU", label: "Sls U" },
  { key: "sls$", label: "Sls $" },
  { key: "cogs", label: "COGS" },
  { key: "aur", label: "AUR" },
  { key: "auc", label: "AUC" },
  { key: "gm$", label: "GM $" },
  { key: "gm%", label: "GM %" },
];

export const LEVELS_BY_DIMENSION = {
  [DIMENSIONS.PRODUCT]: PRODUCT_LEVELS,
  [DIMENSIONS.STORE]: STORE_LEVELS,
  [DIMENSIONS.TIME]: TIME_LEVELS,
  [DIMENSIONS.MEASURES]: MEASURE_LEVELS,
  [DIMENSIONS.METRICS]: METRIC_LEVELS,
};

export const DEFAULT_LEVELS = {
  [DIMENSIONS.PRODUCT]: ["division", "department", "sku"],
  [DIMENSIONS.STORE]: ["channel", "storeId"],
  [DIMENSIONS.TIME]: ["week"],
  [DIMENSIONS.MEASURES]: ["slsU", "mfp"],
  [DIMENSIONS.METRICS]: ["aur"],
};

export const ARRANGEMENTS = [
  {
    id: 1,
    label: "Product (M) · Time",
    rows: ["product", "measures"],
    columns: ["time"],
  },
  {
    id: 2,
    label: "Product · Store (M) · Time",
    rows: ["product", "store", "measures"],
    columns: ["time"],
  },
  {
    id: 3,
    label: "Product · Time · M",
    rows: ["product"],
    columns: ["time", "measures"],
  },
  {
    id: 4,
    label: "Store · Time · M",
    rows: ["store"],
    columns: ["time", "measures"],
  },
  {
    id: 5,
    label: "Product · Store · Time · M",
    rows: ["product", "store"],
    columns: ["time", "measures"],
  },
  {
    id: 6,
    label: "Time (M) · Product",
    rows: ["time", "measures"],
    columns: ["product"],
  },
  {
    id: 7,
    label: "Product · Time · Store · M",
    rows: ["product", "time"],
    columns: ["store", "measures"],
  },
  {
    id: 8,
    label: "Store · Time · Product · M",
    rows: ["store", "time"],
    columns: ["product", "measures"],
  },
  {
    id: 9,
    label: "Product · Store · Time · M",
    rows: ["product", "store", "time"],
    columns: ["measures"],
  },
  {
    id: 10,
    label: "Product · M · Store · Time",
    rows: ["product", "measures"],
    columns: ["store", "time"],
  },
  {
    id: 11,
    label: "Store · M · Product · Time",
    rows: ["store", "measures"],
    columns: ["product", "time"],
  },
  {
    id: 12,
    label: "Time · M · Product · Store",
    rows: ["time", "measures"],
    columns: ["product", "store"],
  },
  {
    id: 13,
    label: "Product · Store · M · Time",
    rows: ["product", "store", "measures"],
    columns: ["time"],
  },
  {
    id: 14,
    label: "M · Product · Store · Time",
    rows: ["measures"],
    columns: ["product", "store", "time"],
  },
];

export const DEFAULT_ARRANGEMENT = ARRANGEMENTS[1]; // Product · Store · Time
