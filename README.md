# DemandSmart Pivot PoC

A React + Vite proof of concept for the DemandSmart pivot table using **ag-Grid Enterprise**. It demonstrates client-side pivoting from a single flat base-grain mock dataset, with quick-switching across the 14 structural arrangements.

## Run the PoC

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## What is inside

- `src/deep-dive-poc/` — the new Deep-Dive pivot screen.
- `src/deep-dive-poc/mockData.js` — deterministic base-grain generator (~27k records).
- `src/deep-dive-poc/api.js` — mocked request/response endpoints.
- `src/deep-dive-poc/gridConfig.js` — ag-Grid pivot/row/column/value configuration.
- `src/deep-dive-poc/useDeepDivePivot.js` — state, editing, and undo logic.
- `MOCK_DATA.md` — schema and generation rules for the mock data.
- `MOCK_API.md` — request/response examples for the mock API.

## Key design decisions

- The API returns the **same flat base-grain data** for every view; the 14 shapes are created by ag-Grid on the client.
- Only the **WCF Sls U** metric is editable. Edits are disaggregated proportionally to the underlying base-grain records and the derived metrics (`Sls $`, `GM$`, `GM%`) update immediately.
- ag-Grid Enterprise features used: pivot mode, row/column grouping, custom aggregation (variance, weighted AUR/AUC, GM%), grand totals, compact/tabular display, and inline cell editing.

## ag-Grid Enterprise license

The license key is set in `src/main.jsx`. It is provided for this PoC only and should not be committed to a production repository as a secret.

---

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
