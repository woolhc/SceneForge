import { ArrowLeftRight, Sparkles } from "lucide-react";

/**
 * T4.5: 转场效果定义（xfade 支持的常用种类，分类展示）。
 * id 对应 ffmpeg xfade 的 transition 参数名。
 */
const TRANSITIONS = [
  // 叠化类
  { id: "none", name: "无", desc: "硬切", cat: "基础" },
  { id: "fade", name: "淡入淡出", desc: "画面逐渐过渡", cat: "叠化" },
  { id: "dissolve", name: "溶解", desc: "像素溶解", cat: "叠化" },
  { id: "fadeblack", name: "黑场过渡", desc: "经由黑色", cat: "叠化" },
  { id: "fadewhite", name: "白场过渡", desc: "经由白色", cat: "叠化" },
  // 擦除类
  { id: "wipeleft", name: "向左擦除", desc: "左向擦除", cat: "擦除" },
  { id: "wiperight", name: "向右擦除", desc: "右向擦除", cat: "擦除" },
  { id: "wipeup", name: "向上擦除", desc: "上向擦除", cat: "擦除" },
  { id: "wipedown", name: "向下擦除", desc: "下向擦除", cat: "擦除" },
  // 滑动类
  { id: "slideleft", name: "左滑入", desc: "画面左滑", cat: "滑动" },
  { id: "slideright", name: "右滑入", desc: "画面右滑", cat: "滑动" },
  { id: "slideup", name: "上滑入", desc: "画面上滑", cat: "滑动" },
  { id: "slidedown", name: "下滑入", desc: "画面下滑", cat: "滑动" },
  // 缩放类
  { id: "smoothleft", name: "缩放左滑", desc: "缩放+滑动", cat: "缩放" },
  { id: "smoothright", name: "缩放右滑", desc: "缩放+滑动", cat: "缩放" },
  { id: "circleopen", name: "圆形展开", desc: "圆形打开", cat: "缩放" },
  { id: "circleclose", name: "圆形收缩", desc: "圆形关闭", cat: "缩放" },
  { id: "radial", name: "径向", desc: "径向擦除", cat: "缩放" },
];

/**
 * 转场 Tab：分类展示转场效果 + 时长滑块。
 */
export function TransitionPanel({
  selectedClipId,
  currentTransition,
  currentDuration,
  onApply,
  onDurationChange,
}: {
  selectedClipId: string | null;
  currentTransition?: string | null;
  currentDuration?: number;
  onApply: (transitionId: string) => void;
  onDurationChange?: (duration: number) => void;
}) {
  // 按分类分组
  const categories = [...new Set(TRANSITIONS.map((t) => t.cat))];

  return (
    <div className="panel-content">
      <p className="transition-hint">
        <Sparkles size={13} />
        {selectedClipId
          ? "点击转场应用到当前选中片段的入场（与下一片段交叠过渡）"
          : "请先在时间线选中一个片段"}
      </p>
      {/* T4.5: 转场时长滑块 */}
      {selectedClipId && currentTransition && currentTransition !== "none" && onDurationChange && (
        <label className="transition-duration-row">
          <span>转场时长（{(currentDuration ?? 0.5).toFixed(2)}s）</span>
          <input
            type="range" min={0.1} max={2.0} step={0.1}
            value={currentDuration ?? 0.5}
            onChange={(e) => onDurationChange(Number(e.target.value))}
          />
        </label>
      )}
      {categories.map((cat) => (
        <div key={cat} className="transition-category">
          <div className="transition-cat-title">{cat}</div>
          <div className="transition-grid">
            {TRANSITIONS.filter((t) => t.cat === cat).map((t) => (
              <button
                key={t.id}
                className={`transition-card ${currentTransition === t.id ? "active" : ""}`}
                disabled={!selectedClipId}
                onClick={() => onApply(t.id)}
              >
                <ArrowLeftRight size={20} />
                <span>{t.name}</span>
                <small>{t.desc}</small>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
