import type { Clip } from "../../types";
import { LUT_FILTERS } from "../../luts";

type ColorProperty = "brightness" | "contrast" | "saturation" | "temperature" | "tint";

const colorControls: Array<{ property: ColorProperty; label: string }> = [
  { property: "brightness", label: "亮度" },
  { property: "contrast", label: "对比度" },
  { property: "saturation", label: "饱和度" },
  { property: "temperature", label: "色温" },
  { property: "tint", label: "色调" },
];

export function ColorInspector({
  clip,
  onFilterChange,
  onClipChange,
  onCommit,
}: {
  clip: Clip;
  onFilterChange: (filterId: string) => void;
  onClipChange: (patch: Partial<Clip>, commit?: boolean) => void;
  onCommit: () => void;
}) {
  return (
    <>
      <div className="filter-control inspector-category inspector-category-visual" data-inspector-section="filters">
        <div className="speed-label">滤镜</div>
        <div className="filter-presets">
          {LUT_FILTERS.map((filter) => (
            <button
              key={filter.id}
              className={`speed-preset ${(!clip.filter && filter.id === "none") || clip.filter === filter.id ? "active" : ""}`}
              onClick={() => onFilterChange(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>
      <div className="fade-control inspector-category inspector-category-visual">
        {colorControls.map(({ property, label }) => (
          <label key={property} className="style-field">
            {label}
            <input
              type="range"
              min={-100}
              max={100}
              step={1}
              value={clip[property] ?? 0}
              onChange={(event) => onClipChange({ [property]: Number(event.target.value) }, false)}
              onPointerUp={onCommit}
            />
          </label>
        ))}
      </div>
    </>
  );
}
