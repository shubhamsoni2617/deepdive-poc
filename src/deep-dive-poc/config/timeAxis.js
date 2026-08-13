/**
 * Time-axis display helpers for the Deep Dive grid.
 *
 * The contract returns fiscal ids (e.g. 202601 = fiscal week 1). These pure
 * functions turn an id at a given level into a human header label.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Fiscal week 1 (202601) starts 01 Jan 2026; each subsequent week is +7 days.
const WEEK1_START = new Date(2026, 0, 1);

export function weekDateLabel(n) {
  const d = new Date(WEEK1_START);
  d.setDate(d.getDate() + (n - 1) * 7);
  const dd = String(d.getDate()).padStart(2, "0");
  return `${dd} ${MONTHS[d.getMonth()]}`;
}

/** Human label for a time bucket id at a given level (week/month/quarter). */
export function labelTime(levelName, id) {
  const s = String(id);
  if (levelName === "week") {
    const n = Number(s) - 202600; // 202601 -> 1
    return n > 0 && n <= 26 ? `W${n}: ${weekDateLabel(n)}` : `Wk ${s.slice(-2)}`;
  }
  if (levelName === "month") {
    const idx = Number(s) - 202601; // 202601 -> 0 (Jan)
    return MONTHS[idx] ?? s;
  }
  if (levelName === "quarter") {
    const idx = Number(s) - 202600;
    return `Q${idx}`;
  }
  return s;
}
