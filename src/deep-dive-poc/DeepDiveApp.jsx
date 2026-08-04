import { useState } from "react";
import "./agGridSetup";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";
import "./deepDive.css";
import { ARRANGEMENTS, LEVELS_BY_DIMENSION, METRICS } from "./constants";
import { useDeepDivePivot } from "./useDeepDivePivot";
import { ErrorBoundary } from "./ErrorBoundary.jsx";
import { PivotBuilder, PivotTableIcon } from "./PivotBuilder.jsx";

function Toggle({ checked, onChange, label }) {
  return (
    <label className="dd-toggle">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

function LevelSelector({ dimension, levels, selected, onChange }) {
  const toggle = (key) => {
    const has = selected.includes(key);
    const next = has ? selected.filter((k) => k !== key) : [...selected, key];
    onChange(dimension, next);
  };

  return (
    <div className="dd-level-group">
      <div className="dd-level-title">{dimension}</div>
      <div className="dd-level-list">
        {levels.map((level) => (
          <label key={level.key} className="dd-level-item">
            <input
              type="checkbox"
              checked={selected.includes(level.key)}
              onChange={() => toggle(level.key)}
            />
            <span>{level.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function DeepDiveApp() {
  const {
    loading,
    records,
    arrangement,
    levels,
    visibleMetrics,
    compact,
    gridOptions,
    applyArrangement,
    updateLevels,
    toggleMetric,
    setAllMetrics,
    toggleCompact,
    flip,
    undo,
    save,
  } = useDeepDivePivot();

  const handleLevelChange = (dimension, next) => {
    const order = LEVELS_BY_DIMENSION[dimension].map((l) => l.key);
    const sorted = [...next].sort(
      (a, b) => order.indexOf(a) - order.indexOf(b),
    );
    updateLevels({ ...levels, [dimension]: sorted });
  };

  const [pivotOpen, setPivotOpen] = useState(false);

  const handlePivotChange = (newArrangement, newLevels) => {
    applyArrangement(newArrangement);
    updateLevels(newLevels);
    setPivotOpen(false);
  };

  return (
    <ErrorBoundary>
      <div className="ia-shell">
        {/* Top header — Impact branding */}
        <header className="ia-topbar">
          <div className="ia-topbar-left">
            <span className="ia-logo" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M12 3 22 21H2L12 3Z" fill="#fff" />
                <path d="M12 10 17 21H7L12 10Z" fill="#4f46e5" />
              </svg>
            </span>
            <span className="ia-brand">
              IMPACT<small>ANALYTICS</small>
            </span>
            <span className="ia-topbar-divider" />
            <span className="ia-platform-name">[TEST] IA Smart Platform</span>
          </div>
          <div className="ia-topbar-right">
            <button className="ia-icon-btn" aria-label="Help">
              ?
            </button>
            <button className="ia-icon-btn" aria-label="Notifications">
              <span className="ia-bell">&#128276;</span>
            </button>
            <div className="ia-avatar">O</div>
          </div>
        </header>

        <div className="ia-layout">
          {/* Left sidebar */}
          <aside className="ia-sidebar">
            <div className="ia-sidebar-top">
              <div className="ia-sidebar-icon">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M3 3v18h18" />
                  <path d="M7 14l3-3 3 3 5-5" />
                </svg>
              </div>
              <div className="ia-sidebar-icon ia-sidebar-icon--active">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />
                </svg>
              </div>
              <div className="ia-sidebar-icon">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </div>
            </div>
            <div className="ia-sidebar-bottom">
              <div className="ia-sidebar-icon ia-sidebar-icon--logout">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="M16 17l5-5-5-5M21 12H9" />
                </svg>
              </div>
            </div>
          </aside>

          {/* Main content area */}
          <div className="dd-app">
            <nav className="ia-breadcrumb">
              <span className="ia-bc-home">&#8962;</span>
              <span className="ia-bc-sep">&rsaquo;</span>
              <a className="ia-bc-link" href="#">
                Forecast management
              </a>
              <span className="ia-bc-sep">&rsaquo;</span>
              <strong>Consensus Forecast Deep Dive</strong>
            </nav>

            {/* Filter strip */}
            <div className="ia-filter-strip">
              <div className="ia-filter-left">
                <span className="ia-filter-applied">Filters Applied</span>
                <span className="ia-filter-preset">
                  <button className="ia-filter-pill">az-latest</button>
                  <button
                    className="ia-filter-preset-caret"
                    aria-label="Change preset"
                  >
                    <span className="ia-chevron">&#9662;</span>
                  </button>
                </span>
                <span className="ia-filter-sep" />
                <div className="ia-filter-item">
                  <span className="ia-filter-key">Banner*</span>
                  <span className="ia-filter-val">20-BFL</span>
                </div>
                <div className="ia-filter-item">
                  <span className="ia-filter-key">Division*</span>
                  <span className="ia-filter-val">
                    3115-MISSES BETTER SPORTSWEAR
                  </span>
                </div>
                <div className="ia-filter-item">
                  <span className="ia-filter-key">View Data By*</span>
                  <span className="ia-filter-val">Month</span>
                </div>
                <div className="ia-filter-item">
                  <span className="ia-filter-key">Date Range</span>
                  <span className="ia-filter-val">Jul 2026 to Nov 2026</span>
                </div>
              </div>
              <button className="ia-filter-all">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
                </svg>
                All Filters
              </button>
            </div>

            <div className="dd-body">
              <main className="dd-card">
                <div className="dd-card-header">
                  <div className="dd-card-title">
                    <span>Consensus Forecast deepdive</span>
                    <span
                      className="dd-info-icon"
                      title="Consensus Forecast Deep Dive Information"
                    >
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="16" x2="12" y2="12" />
                        <line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                    </span>
                  </div>
                  <div className="dd-card-actions">
                    <Toggle
                      checked={compact}
                      onChange={toggleCompact}
                      label={compact ? "Compact" : "Tabular"}
                    />
                    <button className="dd-card-action-btn" onClick={flip}>
                      Flip
                    </button>
                    <button
                      className="dd-card-action-btn dd-card-action-btn--icon"
                      onClick={() => setPivotOpen(true)}
                      aria-label="Pivot settings"
                    >
                      <PivotTableIcon onClick={() => setPivotOpen(true)} />
                    </button>
                    <button
                      className="dd-card-action-btn dd-card-action-btn--icon"
                      aria-label="More options"
                    >
                      &#8943;
                    </button>
                  </div>
                </div>

                <div
                  className={
                    "dd-grid ag-theme-alpine" +
                    (arrangement.rows.includes("measures") ||
                    arrangement.rows.includes("metrics")
                      ? " dd-manual"
                      : "") +
                    (arrangement.columns.filter((d) => d !== "metrics").length +
                      1 >
                    2
                      ? " dd-alt-cols"
                      : "")
                  }
                >
                  {loading ? (
                    <div className="dd-loading">Loading mock data…</div>
                  ) : (
                    <AgGridReact
                      key={
                        "v2" +
                        arrangement.id +
                        arrangement.rows.join(",") +
                        arrangement.columns.join(",") +
                        JSON.stringify(levels) +
                        JSON.stringify(visibleMetrics) +
                        String(compact)
                      }
                      gridOptions={gridOptions}
                      rowData={records}
                      rowClassRules={{
                        "dd-row-mid": (p) =>
                          p.data && p.data.__isLast === false,
                        "dd-row-cover": (p) =>
                          p.data && p.data.__isFirst === false,
                      }}
                    />
                  )}
                </div>
              </main>

              {/* Pivot table settings - right drawer */}
              {pivotOpen && (
                <aside className="pvt-drawer">
                  <button
                    className="pvt-close-btn"
                    onClick={() => setPivotOpen(false)}
                  >
                    ×
                  </button>
                  <PivotBuilder
                    arrangement={arrangement}
                    levels={levels}
                    dimensions={Object.keys(LEVELS_BY_DIMENSION)}
                    views={ARRANGEMENTS}
                    onChange={handlePivotChange}
                    onLevelChange={handleLevelChange}
                  />
                </aside>
              )}
            </div>

            {/* Footer — Back to Forecast Summary */}
            <div className="dd-footer-bar">
              <button className="dd-back-btn">
                <span className="dd-back-chevron">&lsaquo;</span>
                Back To Forecast Summary
              </button>
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
