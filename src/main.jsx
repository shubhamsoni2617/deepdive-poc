import { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { ErrorBoundary } from "./deep-dive-poc/ErrorBoundary.jsx";

const DeepDiveApp = lazy(() => import("./deep-dive-poc/DeepDiveApp.jsx"));

const root = document.getElementById("root");

createRoot(root).render(
  <ErrorBoundary>
    <Suspense
      fallback={
        <p
          style={{
            padding: "1rem",
            fontFamily: "system-ui,sans-serif",
            color: "#6b7280",
          }}
        >
          Loading DemandSmart Pivot PoC…
        </p>
      }
    >
      <DeepDiveApp />
    </Suspense>
  </ErrorBoundary>,
);
