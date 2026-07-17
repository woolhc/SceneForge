import type { ClipVisualEffect } from "../../types";
import { toggleVisualEffect } from "../visualEffects";

const effectOptions = [
  { id: "vignette", label: "暗角" },
  { id: "glow", label: "发光" },
  { id: "mirror", label: "镜像" },
  { id: "invert", label: "反色" },
  { id: "grayscale", label: "灰度" },
  { id: "flicker", label: "闪烁" },
  { id: "shake", label: "抖动" },
  { id: "chromakey", label: "抠像/绿幕" },
] as const;

function effectLabel(kind: string): string {
  return effectOptions.find((option) => option.id === kind)?.label ?? kind;
}

export function VisualEffectsInspector({
  effects,
  onChange,
  onCommit,
}: {
  effects: ClipVisualEffect[] | null | undefined;
  onChange: (effects: ClipVisualEffect[] | null, commit?: boolean) => void;
  onCommit: () => void;
}) {
  return (
    <div className="mask-section inspector-category inspector-category-animation" data-inspector-section="visual-effects">
      <span className="kf-label">视觉特效</span>
      <div className="kf-buttons">
        {effectOptions.map((option) => {
          const active = (effects ?? []).some((effect) => effect.kind === option.id);
          return (
            <button
              key={option.id}
              className={`speed-preset ${active ? "active" : ""}`}
              onClick={() => onChange(toggleVisualEffect(effects, option.id))}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {(effects ?? []).map((effect, index) => (
        <div key={effect.kind} className="style-field-column">
          <label className="style-field">
            {effect.kind === "chromakey" ? "容差" : effectLabel(effect.kind)}（{effect.intensity.toFixed(0)}）
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={effect.intensity}
              onChange={(event) => {
                const next = [...(effects ?? [])];
                next[index] = { ...next[index], intensity: Number(event.target.value) };
                onChange(next, false);
              }}
              onPointerUp={onCommit}
            />
          </label>
          {effect.kind === "chromakey" && (
            <label className="style-field">
              抠像颜色
              <input
                type="color"
                value={effect.chromaKeyColor || "#00FF00"}
                onChange={(event) => {
                  const next = [...(effects ?? [])];
                  next[index] = { ...next[index], chromaKeyColor: event.target.value };
                  onChange(next);
                }}
              />
            </label>
          )}
        </div>
      ))}
      <small className="style-hint">视觉特效在导出时生效</small>
    </div>
  );
}
