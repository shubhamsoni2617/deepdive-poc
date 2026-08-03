/**
 * Preset row/column arrangements shown in the pivot builder. Pure data.
 */

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

export const DEFAULT_ARRANGEMENT = {
  id: "default",
  label: "Product (M) · Time · Metric",
  rows: ["product", "measures"],
  columns: ["time", "metrics"],
};
