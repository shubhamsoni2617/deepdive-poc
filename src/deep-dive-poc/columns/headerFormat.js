/** Header/value label formatters for dimension columns. Pure string helpers. */

export function formatWeekHeader(value) {
  if (typeof value === "string") {
    const match = value.match(/^W(\d+):\s*(.+)$/);
    if (match) return `W${parseInt(match[1], 10)}: ${match[2].trim()}`;
  }
  return value;
}

export function formatMonthValue(value) {
  if (typeof value === "string" && value.includes("-")) {
    return value.split("-")[1];
  }
  return value;
}

export function formatPivotHeader(value) {
  // Only shorten month-style values ("2025-01" -> "01"); leave ids like
  // "CA-01" verbatim.
  if (typeof value === "string" && /^\d{4}-\d{2}/.test(value)) {
    return value.split("-")[1];
  }
  return value;
}

export function formatColValue(field, value) {
  if (field === "week") return formatWeekHeader(value);
  if (field === "month") return formatMonthValue(value);
  return value;
}
