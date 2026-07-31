import { generateMockData } from "./mockData";
import { MEASURES, LEVELS_BY_DIMENSION } from "./constants";

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
