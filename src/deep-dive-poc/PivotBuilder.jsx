import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { LEVELS_BY_DIMENSION } from "./constants";

const DIMENSION_LABELS = {
  product: "Product",
  store: "Location",
  time: "Time",
  measures: "Measure",
  metrics: "Metrics",
};

function getDimensionLabel(key) {
  return DIMENSION_LABELS[key] || key;
}

function getLevelLabel(dim, levelKey) {
  return (
    LEVELS_BY_DIMENSION[dim]?.find((l) => l.key === levelKey)?.label || levelKey
  );
}

function layoutFromArrangement(arrangement, dimensions) {
  const rows = arrangement.rows || [];
  const columns = arrangement.columns || [];
  const available = dimensions.filter(
    (d) => !rows.includes(d) && !columns.includes(d),
  );
  return { rows, columns, available };
}

/* Drag grip icon (6 dots) */
function GripIcon() {
  return (
    <svg
      width="10"
      height="14"
      viewBox="0 0 10 14"
      fill="currentColor"
      opacity="0.4"
    >
      <circle cx="2" cy="2" r="1.5" />
      <circle cx="8" cy="2" r="1.5" />
      <circle cx="2" cy="7" r="1.5" />
      <circle cx="8" cy="7" r="1.5" />
      <circle cx="2" cy="12" r="1.5" />
      <circle cx="8" cy="12" r="1.5" />
    </svg>
  );
}

/* Dimension chip in the top "available" area */
function AvailableChip({ dim, onDragStart, assigned }) {
  return (
    <div
      className={`pvt-avail-chip ${assigned ? "pvt-avail-chip--assigned" : ""}`}
      draggable={!assigned}
      onDragStart={(e) => !assigned && onDragStart(e, dim, "available")}
    >
      <GripIcon />
      <span>{getDimensionLabel(dim)}</span>
    </div>
  );
}

/* Chip inside a Rows/Columns zone with level selector */
function ZoneChip({
  dim,
  levels,
  zone,
  index,
  totalCount,
  onDragStart,
  onDragOver,
  onLevelChange,
  onRemove,
  onReorder,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const levelOptions = LEVELS_BY_DIMENSION[dim] || [];
  const selected = levels[dim] || [];

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleToggle = (e, key) => {
    e.stopPropagation();
    const lvl = levelOptions.find((l) => l.key === key);
    if (lvl?.locked) return;
    const has = selected.includes(key);
    const next = has ? selected.filter((k) => k !== key) : [...selected, key];
    if (dim === "metrics" && next.length === 0) return;
    onLevelChange(dim, next);
  };

  const selectedCount = selected.length;

  return (
    <div
      className="pvt-zone-chip"
      ref={ref}
      draggable
      onDragStart={(e) => onDragStart(e, dim, zone)}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragOver && onDragOver(e, index);
      }}
    >
      <span className="pvt-zone-chip-grip">
        <GripIcon />
      </span>
      <span className="pvt-zone-chip-label">{getDimensionLabel(dim)}</span>
      <span className="pvt-zone-chip-priority">#{index + 1}</span>
      {levelOptions.length > 1 && (
        <button
          className="pvt-zone-chip-select"
          onClick={() => setOpen((v) => !v)}
        >
          Selected ({selectedCount}) <span className="pvt-chevron">▾</span>
        </button>
      )}
      <span className="pvt-zone-chip-reorder">
        <button
          className="pvt-reorder-btn"
          disabled={index === 0}
          onClick={() => onReorder(zone, index, index - 1)}
          title="Move up (higher priority)"
        >
          ▲
        </button>
        <button
          className="pvt-reorder-btn"
          disabled={index === totalCount - 1}
          onClick={() => onReorder(zone, index, index + 1)}
          title="Move down (lower priority)"
        >
          ▼
        </button>
      </span>
      <button
        className="pvt-zone-chip-remove"
        onClick={() => onRemove(dim, zone)}
      >
        ×
      </button>
      {open && levelOptions.length > 1 && (
        <div
          className="pvt-level-dropdown"
          draggable={false}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onDragStart={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {levelOptions.map((lvl) => (
            <label key={lvl.key} className="pvt-level-option" draggable={false}>
              <input
                type="checkbox"
                checked={selected.includes(lvl.key)}
                disabled={!!lvl.locked}
                onChange={(e) => handleToggle(e, lvl.key)}
              />
              <span>{lvl.label}</span>
            </label>
          ))}
        </div>
      )}
      {/* Show selected levels as tags below */}
      {selected.length > 0 && (
        <div className="pvt-zone-chip-tags">
          {selected.map((key) => (
            <span key={key} className="pvt-level-tag">
              {getLevelLabel(dim, key)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* Drop zone (Rows or Columns) */
function DropZone({
  title,
  zone,
  items,
  levels,
  onDragStart,
  onDrop,
  onLevelChange,
  onRemove,
  onReorder,
  dropIndicator,
  onDragOverItem,
}) {
  const [isOver, setIsOver] = useState(false);

  return (
    <div
      className={`pvt-drop-zone ${isOver ? "over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        onDrop(e, zone);
      }}
    >
      <div className="pvt-drop-zone-title">{title}</div>
      {items.length > 1 && (
        <div className="pvt-drop-zone-priority-hint">↑ Higher priority</div>
      )}
      <div className="pvt-drop-zone-content">
        {items.map((dim, idx) => (
          <div key={dim} className="pvt-zone-chip-wrapper">
            {dropIndicator === idx && <div className="pvt-drop-indicator" />}
            <ZoneChip
              dim={dim}
              levels={levels}
              zone={zone}
              index={idx}
              totalCount={items.length}
              onDragStart={onDragStart}
              onDragOver={onDragOverItem}
              onLevelChange={onLevelChange}
              onRemove={onRemove}
              onReorder={onReorder}
            />
          </div>
        ))}
        {dropIndicator === items.length && (
          <div className="pvt-drop-indicator" />
        )}
        {items.length === 0 && (
          <div className="pvt-drop-zone-empty">Drop dimensions here</div>
        )}
      </div>
      {zone === "rows" && (
        <div className="pvt-drop-zone-hint">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="8" />
          </svg>
          <span>Upto 2 Can Be Selected</span>
        </div>
      )}
    </div>
  );
}

export function PivotBuilder({
  arrangement,
  levels,
  dimensions,
  views,
  onChange,
  onLevelChange: parentLevelChange,
}) {
  const [dragged, setDragged] = useState(null);
  const [localArrangement, setLocalArrangement] = useState(arrangement);
  const [localLevels, setLocalLevels] = useState(levels);
  const [validationError, setValidationError] = useState(null);
  const [dropIndicators, setDropIndicators] = useState({
    rows: null,
    columns: null,
  });

  // Sync local state when props change externally
  useEffect(() => {
    setLocalArrangement(arrangement);
  }, [arrangement]);
  useEffect(() => {
    setLocalLevels(levels);
  }, [levels]);

  const layout = useMemo(
    () => layoutFromArrangement(localArrangement, dimensions),
    [localArrangement, dimensions],
  );

  const handleDragStart = useCallback((e, dim, zone) => {
    e.dataTransfer.setData("text/plain", dim);
    e.dataTransfer.setData("sourceZone", zone);
    setDragged({ dim, zone });
    setDropIndicators({ rows: null, columns: null });
  }, []);

  const handleDragOverItem = useCallback(
    (e, targetIndex) => {
      if (!dragged) return;
      // Determine which zone we're over based on the target element
      const zoneEl = e.target.closest(".pvt-drop-zone");
      if (!zoneEl) return;
      const zone =
        zoneEl.querySelector(".pvt-drop-zone-title")?.textContent === "Rows"
          ? "rows"
          : "columns";
      setDropIndicators((prev) => ({ ...prev, [zone]: targetIndex }));
    },
    [dragged],
  );

  const handleReorder = useCallback(
    (zone, fromIndex, toIndex) => {
      const list =
        zone === "rows"
          ? [...(localArrangement.rows || [])]
          : [...(localArrangement.columns || [])];
      if (toIndex < 0 || toIndex >= list.length) return;
      const [item] = list.splice(fromIndex, 1);
      list.splice(toIndex, 0, item);
      const newArrangement = {
        ...localArrangement,
        id: "custom",
        label: "Custom",
        [zone]: list,
      };
      setLocalArrangement(newArrangement);
    },
    [localArrangement],
  );

  const handleDrop = useCallback(
    (e, targetZone) => {
      e.preventDefault();
      const dim = e.dataTransfer.getData("text/plain") || dragged?.dim;
      const sourceZone = e.dataTransfer.getData("sourceZone") || dragged?.zone;
      const insertAt = dropIndicators[targetZone];
      setDragged(null);
      setDropIndicators({ rows: null, columns: null });

      if (!dim || !sourceZone) return;

      // Reorder within same zone
      if (sourceZone === targetZone && sourceZone !== "available") {
        const list = [...layout[sourceZone]];
        const fromIdx = list.indexOf(dim);
        if (fromIdx === -1) return;
        list.splice(fromIdx, 1);
        let targetIdx = insertAt != null ? insertAt : list.length;
        if (targetIdx > fromIdx) targetIdx = Math.max(0, targetIdx - 1);
        list.splice(targetIdx, 0, dim);
        const newArrangement = {
          ...localArrangement,
          id: "custom",
          label: "Custom",
          [sourceZone]: list,
        };
        setLocalArrangement(newArrangement);
        return;
      }

      if (sourceZone === targetZone) return;

      const next = {
        rows: [...layout.rows],
        columns: [...layout.columns],
        available: [...layout.available],
      };
      const sourceList = next[sourceZone];
      const sourceIdx = sourceList.indexOf(dim);
      if (sourceIdx !== -1) sourceList.splice(sourceIdx, 1);

      // Prevent moving measures or metrics to available
      if (["measures", "metrics"].includes(dim) && targetZone === "available") {
        const labels = { measures: "Measure", metrics: "Metrics" };
        setValidationError(`${labels[dim]} must be in Rows or Columns.`);
        setTimeout(() => setValidationError(null), 3000);
        return;
      }

      const targetList = next[targetZone];
      if (!targetList.includes(dim)) {
        const idx = insertAt != null ? insertAt : targetList.length;
        targetList.splice(idx, 0, dim);
      }

      const newArrangement = {
        id: "custom",
        label: "Custom",
        rows: next.rows,
        columns: next.columns,
      };

      const nextLevels = { ...localLevels };
      if (!nextLevels[dim] || nextLevels[dim].length === 0) {
        nextLevels[dim] = [LEVELS_BY_DIMENSION[dim][0].key];
      }
      // Ensure locked levels are always included
      const dimLevels = LEVELS_BY_DIMENSION[dim] || [];
      const lockedKeys = dimLevels.filter((l) => l.locked).map((l) => l.key);
      lockedKeys.forEach((lk) => {
        if (!nextLevels[dim].includes(lk)) {
          nextLevels[dim] = [lk, ...nextLevels[dim]];
        }
      });
      setLocalArrangement(newArrangement);
      setLocalLevels(nextLevels);
    },
    [layout, localLevels, dragged, dropIndicators, localArrangement],
  );

  const handleRemove = useCallback(
    (dim, zone) => {
      if (["measures", "metrics"].includes(dim)) {
        const labels = { measures: "Measure", metrics: "Metrics" };
        setValidationError(`${labels[dim]} must be in Rows or Columns.`);
        setTimeout(() => setValidationError(null), 3000);
        return;
      }
      const next = {
        rows: [...layout.rows],
        columns: [...layout.columns],
        available: [...layout.available],
      };
      const sourceList = next[zone];
      const idx = sourceList.indexOf(dim);
      if (idx !== -1) sourceList.splice(idx, 1);
      next.available.push(dim);

      const newArrangement = {
        id: "custom",
        label: "Custom",
        rows: next.rows,
        columns: next.columns,
      };
      setLocalArrangement(newArrangement);
    },
    [layout],
  );

  const handleLevelChange = useCallback((dim, next) => {
    const dimLevels = LEVELS_BY_DIMENSION[dim] || [];
    const lockedKeys = dimLevels.filter((l) => l.locked).map((l) => l.key);
    const ensured = [...next];
    lockedKeys.forEach((lk) => {
      if (!ensured.includes(lk)) ensured.unshift(lk);
    });
    // Sort by canonical order defined in LEVELS_BY_DIMENSION
    const order = dimLevels.map((l) => l.key);
    ensured.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    setLocalLevels((prev) => ({ ...prev, [dim]: ensured }));
  }, []);

  const handleApply = useCallback(() => {
    const allDims = [
      ...(localArrangement.rows || []),
      ...(localArrangement.columns || []),
    ];
    const required = ["measures", "metrics"];
    const labels = { measures: "Measure", metrics: "Metrics" };
    const missing = required.filter((d) => !allDims.includes(d));
    if (missing.length > 0) {
      const names = missing.map((d) => labels[d]).join(", ");
      setValidationError(`${names} must be in Rows or Columns.`);
      setTimeout(() => setValidationError(null), 3000);
      return;
    }
    if ((localArrangement.rows || []).length === 0) {
      setValidationError("At least 1 dimension must be in Rows.");
      setTimeout(() => setValidationError(null), 3000);
      return;
    }
    if ((localArrangement.columns || []).length === 0) {
      setValidationError("At least 1 dimension must be in Columns.");
      setTimeout(() => setValidationError(null), 3000);
      return;
    }
    if (!localLevels.metrics || localLevels.metrics.length === 0) {
      setValidationError("At least 1 Metric must be selected.");
      setTimeout(() => setValidationError(null), 3000);
      return;
    }
    if (parentLevelChange) {
      // Apply level changes per dimension
      Object.keys(localLevels).forEach((dim) => {
        if (JSON.stringify(localLevels[dim]) !== JSON.stringify(levels[dim])) {
          parentLevelChange(dim, localLevels[dim]);
        }
      });
    }
    onChange(localArrangement, localLevels);
  }, [localArrangement, localLevels, onChange, parentLevelChange, levels]);

  return (
    <div className="pvt-panel">
      <div className="pvt-panel-header">
        <h2 className="pvt-panel-title">Pivot table</h2>
      </div>

      <div className="pvt-panel-body">
        <div className="pvt-section-header">
          <span className="pvt-section-title">
            Choose Dimensions to add to table
          </span>
          <span className="pvt-section-hint">
            (Drag And Drop Dimensions Below)
          </span>
        </div>

        <div className="pvt-avail-chips">
          {dimensions.map((dim) => (
            <AvailableChip
              key={dim}
              dim={dim}
              onDragStart={handleDragStart}
              assigned={!layout.available.includes(dim)}
            />
          ))}
        </div>

        <div className="pvt-zones-grid">
          <DropZone
            title="Rows"
            zone="rows"
            items={layout.rows}
            levels={localLevels}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            onLevelChange={handleLevelChange}
            onRemove={handleRemove}
            onReorder={handleReorder}
            dropIndicator={dropIndicators.rows}
            onDragOverItem={handleDragOverItem}
          />
          <DropZone
            title="Columns"
            zone="columns"
            items={layout.columns}
            levels={localLevels}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            onLevelChange={handleLevelChange}
            onRemove={handleRemove}
            onReorder={handleReorder}
            dropIndicator={dropIndicators.columns}
            onDragOverItem={handleDragOverItem}
          />
        </div>
      </div>

      {validationError && <div className="pvt-error">{validationError}</div>}

      <div className="pvt-panel-footer">
        {/* <button className="pvt-btn pvt-btn-secondary" onClick={handleApply}>
          Save &amp; apply
        </button> */}
        <button className="pvt-btn pvt-btn-primary" onClick={handleApply}>
          Apply
        </button>
      </div>
    </div>
  );
}

/* Icon button to trigger the pivot panel */
export function PivotTableIcon({ onClick }) {
  return (
    <button
      className="pvt-trigger-btn"
      onClick={onClick}
      title="Pivot table settings"
    >
      <svg
        viewBox="0 0 30 30"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="4" rx="1" />
        <rect x="14" y="10" width="7" height="4" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <path d="M17 17l3 3M14 20l3-3" />
      </svg>
    </button>
  );
}
