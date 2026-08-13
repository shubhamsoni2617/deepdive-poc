// Deterministic base-grain mock data generator for the DemandSmart pivot PoC.
// Each record is Product x Store x Time x Measure.

import { MEASURES } from "./constants.js";

const SEED = 42;

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);

function pickN(source, n, rng) {
  const shuffled = [...source].sort(() => rng() - 0.5);
  return shuffled.slice(0, n);
}

function buildMetricsForMeasure(values, measure) {
  const slsU = Math.max(1, Math.round(values.slsU * values.factor));
  const effAur = Math.max(
    values.auc + 1,
    values.aur * (measure === "LY" ? 0.95 + 0.1 * rand() : 1),
  );
  const effAuc = values.auc * (measure === "MFP" ? 0.95 + 0.1 * rand() : 1);
  const sls$ = slsU * effAur;
  const gm$ = slsU * (effAur - effAuc);
  const gmPct = sls$ > 0 ? (gm$ / sls$) * 100 : 0;

  return {
    slsU,
    sls$: sls$,
    aur: effAur,
    auc: effAuc,
    gm$: gm$,
    "gm%": gmPct,
  };
}

export function generateMockData() {
  const divisions = [
    { code: "D01", name: "Womenswear" },
    { code: "D02", name: "Menswear" },
    { code: "D03", name: "Kids" },
    { code: "D04", name: "Home" },
  ];

  const deptNames = {
    D01: ["Tops", "Bottoms", "Dresses", "Activewear"],
    D02: ["Shirts", "Pants", "Outerwear", "Accessories"],
    D03: ["Boys", "Girls", "Infants", "Shoes"],
    D04: ["Bedding", "Bath", "Decor", "Kitchen"],
  };
  const classNames = ["Knits", "Wovens", "Denim", "Active"];

  const skus = [];
  divisions.forEach((div) => {
    const depts = deptNames[div.code];
    depts.forEach((deptName, dIndex) => {
      const dept = `${div.code}-DEPT${dIndex + 1}`;
      const classCount = 2;
      for (let c = 1; c <= classCount; c++) {
        const cls = `${dept}-CLS${c}`;
        const skuCount = 2;
        for (let s = 1; s <= skuCount; s++) {
          skus.push({
            division: div.name,
            department: deptName,
            class: classNames[c - 1],
            sku: `${cls}-SKU${s.toString().padStart(3, "0")}`,
          });
        }
      }
    });
  });

  const channels = ["Retail", "E-Commerce"];
  const states = ["Florida", "Texas", "California", "New York"];
  const stateCode = {
    Florida: "FL",
    Texas: "TX",
    California: "CA",
    "New York": "NY",
  };
  const stores = [];
  channels.forEach((channel) => {
    states.forEach((state) => {
      for (let str = 1; str <= 3; str++) {
        stores.push({
          channel,
          state,
          storeId: `${stateCode[state]}-${str.toString().padStart(2, "0")}`,
        });
      }
    });
  });

  const monthNames = [
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
  const weeks = [];
  const startDate = new Date("2025-01-01");
  for (let w = 1; w <= 13; w++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + (w - 1) * 7);
    const monthIndex = date.getMonth();
    const month = monthNames[monthIndex];
    const day = date.getDate().toString().padStart(2, "0");
    weeks.push({
      year: 2025,
      quarter: `Q${Math.ceil((monthIndex + 1) / 3)}`,
      month: `${(monthIndex + 1).toString().padStart(2, "0")}-${month}`,
      week: `W${w.toString().padStart(2, "0")}: ${day} ${month}`,
    });
  }

  // Attach all stores to every SKU so the table is fully populated.
  const skuStores = skus.map((sku) => ({
    ...sku,
    stores: stores,
  }));

  const records = [];
  let id = 1;

  skuStores.forEach((sku) => {
    sku.stores.forEach((store) => {
      weeks.forEach((week) => {
        const monthIndex = Number(week.month.slice(0, 2));
        const baseUnits = Math.round(
          50 + 200 * rand() + 30 * Math.sin((monthIndex / 12) * Math.PI * 2),
        );
        const aur = 20 + 80 * rand();
        const auc = aur * (0.4 + 0.2 * rand());

        const measureValues = {};
        MEASURES.forEach((measure) => {
          let factor = 1;
          if (measure === "LY") factor = 0.9 + 0.2 * rand();
          if (measure === "MFP") factor = 0.95 + 0.15 * rand();
          measureValues[measure] = buildMetricsForMeasure(
            { slsU: baseUnits, aur, auc, factor },
            measure,
          );
        });

        MEASURES.forEach((measure) => {
          const metrics = measureValues[measure];
          const lyVal = measureValues.LY.slsU;
          const mfpVal = measureValues.MFP.slsU;
          const varLY = lyVal > 0 ? ((metrics.slsU - lyVal) / lyVal) * 100 : 0;
          records.push({
            id: id++,
            ...sku,
            ...store,
            ...week,
            measure,
            ...metrics,
            ly_slsU: lyVal,
            mfp_slsU: mfpVal,
            mfp: mfpVal,
            ly: lyVal,
            varLY,
            locked: false,
          });
        });
      });
    });
  });

  return records;
}
