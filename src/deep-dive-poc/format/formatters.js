/**
 * Pure value formatters. No domain knowledge — just number → display string.
 */

export function formatNumber(value, digits = 0) {
  if (value == null || Number.isNaN(value)) return "-";
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatCurrency(value) {
  if (value == null || Number.isNaN(value)) return "-";
  return `$${formatNumber(value, 0)}`;
}

export function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return "-";
  return `${Number(value).toFixed(1)}%`;
}
