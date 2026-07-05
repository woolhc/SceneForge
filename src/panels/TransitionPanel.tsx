import { ArrowLeftRight, Sparkles } from "lucide-react";

/** 转场效果定义（占位，实际渲染逻辑在 Phase 6） */
const TRANSITIONS = [
  { id: "none", name: "无", desc: "硬切" },
  { id: "fade", name: "淡入淡出", desc: "画面逐渐过渡" },
  { id: "slide", name: "滑动", desc: "画面横向滑入" },
  { id: "zoom", name: "缩放", desc: "画面放大过渡" },
  { id: "wipe", name: "擦除", desc: "画面线性擦除" },
  { id: "blur", name: "模糊", desc: "画面模糊过渡" },
];

/**
 * 转场 Tab：转场效果卡片列表。
 * 点击 = 应用到当前选中 clip 的入场转场（实际效果在 Phase 6 实现）。
 */
export function TransitionPanel({
  selectedClipId,
  currentTransition,
  onApply,
}: {
  selectedClipId: string | null;
  currentTransition?: string | null;
  onApply: (transitionId: string) => void;
}) {
  return (
    <div className="panel-content">
      <p className="transition-hint">
        <Sparkles size={13} />
        {selectedClipId
          ? "点击转场应用到当前选中片段（实际渲染效果将在后续版本接入）"
          : "请先在时间线选中一个片段"}
      </p>
      <div className="transition-grid">
        {TRANSITIONS.map((t) => (
          <button
            key={t.id}
            className={`transition-card ${currentTransition === t.id ? "active" : ""}`}
            disabled={!selectedClipId}
            onClick={() => onApply(t.id)}
          >
            <ArrowLeftRight size={22} />
            <span>{t.name}</span>
            <small>{t.desc}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
