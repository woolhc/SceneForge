import { useState } from "react";
import type { Clip, ClipTransform, Keyframe } from "../../types";
import { usePlaybackStore } from "../../store/playbackStore";
import { KeyframeCurveEditor } from "../../components/KeyframeCurveEditor";

type KeyframeProperty = "x" | "y" | "scale" | "opacity" | "rotation" | "volume";
type KeyframeEasing = "linear" | "easeIn" | "easeOut" | "easeInOut" | "bezier";

const CURVE_PROPERTY_LABELS: Record<KeyframeProperty, string> = {
  x: "水平位置",
  y: "垂直位置",
  scale: "缩放",
  rotation: "旋转",
  opacity: "不透明度",
  volume: "音量",
};

const CURVE_PROPERTY_RANGE: Record<KeyframeProperty, [number, number]> = {
  x: [0, 100],
  y: [0, 100],
  scale: [5, 100],
  rotation: [-180, 180],
  opacity: [0, 100],
  volume: [0, 2],
};

export function KeyframeInspector({
  clip,
  transform,
  hasKeyframe,
  easing,
  bezierPoints,
  onAdd,
  onRemove,
  onClear,
  onEasingChange,
  onCurveChange,
  onCurveCommit,
}: {
  clip: Clip;
  transform: ClipTransform;
  hasKeyframe: boolean;
  easing: KeyframeEasing | null;
  bezierPoints?: [number, number, number, number];
  onAdd: (property: KeyframeProperty, value: number) => void;
  onRemove: () => void;
  onClear: () => void;
  onEasingChange: (easing: KeyframeEasing, bezierPoints?: [number, number, number, number]) => void;
  onCurveChange: (property: KeyframeProperty, keyframes: Keyframe[]) => void;
  onCurveCommit: () => void;
}) {
  const currentTime = usePlaybackStore((state) => state.currentTime);
  const propsWithKeyframes = (Object.keys(CURVE_PROPERTY_LABELS) as KeyframeProperty[]).filter(
    (prop) => (clip.keyframes?.[prop]?.length ?? 0) > 0,
  );
  const [curveProperty, setCurveProperty] = useState<KeyframeProperty | null>(null);
  const activeCurveProperty = curveProperty && propsWithKeyframes.includes(curveProperty) ? curveProperty : propsWithKeyframes[0] ?? null;
  const activeCurveKeyframes = activeCurveProperty ? clip.keyframes?.[activeCurveProperty] ?? [] : [];
  const [rangeMin, rangeMax] = activeCurveProperty ? CURVE_PROPERTY_RANGE[activeCurveProperty] : [0, 1];

  return (
    <div className="keyframe-row inspector-category inspector-category-animation">
      <span className="kf-label">关键帧（@ {currentTime.toFixed(1)}s）</span>
      <div className="kf-buttons">
        <button title="在播放头处为水平位置打关键帧" onClick={() => onAdd("x", transform.x)}>◆ X</button>
        <button title="在播放头处为垂直位置打关键帧" onClick={() => onAdd("y", transform.y)}>◆ Y</button>
        <button title="在播放头处为缩放打关键帧" onClick={() => onAdd("scale", transform.scale)}>◆ 缩放</button>
        <button title="在播放头处为旋转打关键帧" onClick={() => onAdd("rotation", transform.rotation ?? 0)}>◆ 旋转</button>
        <button title="在播放头处为不透明度打关键帧" onClick={() => onAdd("opacity", transform.opacity ?? 100)}>◆ 透明</button>
        <button title="在播放头处为音量打关键帧" onClick={() => onAdd("volume", clip.volume ?? 1)}>◆ 音量</button>
        {hasKeyframe && <button title="删除播放头处的关键帧" onClick={onRemove}>✕ 删帧</button>}
        {clip.keyframes && <button title="清除所有关键帧" onClick={onClear}>✕ 清除</button>}
      </div>
      {hasKeyframe && (
        <label className="style-field">
          <span className="kf-label">缓动</span>
          <select
            value={easing ?? "linear"}
            onChange={(event) => {
              const next = event.target.value as KeyframeEasing;
              onEasingChange(next, next === "bezier" ? bezierPoints ?? [0.42, 0, 0.58, 1] : undefined);
            }}
          >
            <option value="linear">线性</option>
            <option value="easeIn">缓入</option>
            <option value="easeOut">缓出</option>
            <option value="easeInOut">缓入缓出</option>
            <option value="bezier">自定义曲线</option>
          </select>
        </label>
      )}
      {propsWithKeyframes.length > 0 && activeCurveProperty && (
        <div className="keyframe-curve-panel">
          <label className="style-field">
            <span className="kf-label">曲线</span>
            <select value={activeCurveProperty} onChange={(event) => setCurveProperty(event.target.value as KeyframeProperty)}>
              {propsWithKeyframes.map((prop) => (
                <option key={prop} value={prop}>
                  {CURVE_PROPERTY_LABELS[prop]}
                </option>
              ))}
            </select>
          </label>
          <KeyframeCurveEditor
            keyframes={activeCurveKeyframes}
            duration={clip.duration}
            valueMin={rangeMin}
            valueMax={rangeMax}
            onChange={(next) => onCurveChange(activeCurveProperty, next)}
            onCommit={onCurveCommit}
          />
        </div>
      )}
    </div>
  );
}
