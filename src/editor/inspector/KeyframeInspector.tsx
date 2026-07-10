import type { Clip, ClipTransform } from "../../types";
import { usePlaybackStore } from "../../store/playbackStore";

type KeyframeProperty = "x" | "y" | "scale" | "opacity" | "rotation" | "volume";
type KeyframeEasing = "linear" | "easeIn" | "easeOut" | "easeInOut";

export function KeyframeInspector({
  clip,
  transform,
  hasKeyframe,
  easing,
  onAdd,
  onRemove,
  onClear,
  onEasingChange,
}: {
  clip: Clip;
  transform: ClipTransform;
  hasKeyframe: boolean;
  easing: KeyframeEasing | null;
  onAdd: (property: KeyframeProperty, value: number) => void;
  onRemove: () => void;
  onClear: () => void;
  onEasingChange: (easing: KeyframeEasing) => void;
}) {
  const currentTime = usePlaybackStore((state) => state.currentTime);
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
          <select value={easing ?? "linear"} onChange={(event) => onEasingChange(event.target.value as KeyframeEasing)}>
            <option value="linear">线性</option>
            <option value="easeIn">缓入</option>
            <option value="easeOut">缓出</option>
            <option value="easeInOut">缓入缓出</option>
          </select>
        </label>
      )}
    </div>
  );
}
