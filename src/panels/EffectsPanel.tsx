import { Blend, CircleDashed, Sparkles } from "lucide-react";

export function EffectsPanel({
  hasVisualSelection,
  onOpenFilters,
  onOpenMasks,
  onOpenVisualEffects,
}: {
  hasVisualSelection: boolean;
  onOpenFilters: () => void;
  onOpenMasks: () => void;
  onOpenVisualEffects: () => void;
}) {
  return (
    <div className="panel-content effects-panel">
      {!hasVisualSelection && <p className="style-hint">请先选择视频或图片片段</p>}
      <button className="panel-primary-action" disabled={!hasVisualSelection} onClick={onOpenFilters}>
        <Blend size={16} />
        滤镜与调色
      </button>
      <button className="panel-secondary-action" disabled={!hasVisualSelection} onClick={onOpenMasks}>
        <CircleDashed size={16} />
        蒙版
      </button>
      <button className="panel-secondary-action" disabled={!hasVisualSelection} onClick={onOpenVisualEffects}>
        <Sparkles size={16} />
        视觉特效
      </button>
    </div>
  );
}
