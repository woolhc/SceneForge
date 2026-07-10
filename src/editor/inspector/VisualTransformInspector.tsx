import { Layers } from "lucide-react";
import type { ClipMask, ClipTransform } from "../../types";
import { MaskPreview } from "../../components/MaskPreview";

const maskKinds = ["none", "circle", "rect", "linear", "mirror"] as const;

function maskLabel(kind: (typeof maskKinds)[number]): string {
  if (kind === "none") return "无";
  if (kind === "circle") return "圆形";
  if (kind === "rect") return "矩形";
  if (kind === "linear") return "线性";
  return "镜面";
}

export function VisualTransformInspector({
  transform,
  mask,
  onTransformChange,
  onMaskChange,
  onCommit,
}: {
  transform: ClipTransform;
  mask: ClipMask | null | undefined;
  onTransformChange: (patch: Partial<ClipTransform>, commit?: boolean) => void;
  onMaskChange: (mask: ClipMask | null, commit?: boolean) => void;
  onCommit: () => void;
}) {
  const updateMask = (patch: Partial<ClipMask>, commit = false) => {
    if (!mask) return;
    onMaskChange({ ...mask, ...patch }, commit);
  };

  return (
    <div className="transform-box inspector-category inspector-category-visual">
      <div className="trim-title"><Layers size={15} />画面变换</div>
      <label>水平位置（{transform.x.toFixed(0)}%）<input type="range" min={0} max={100} step={1} value={transform.x} onChange={(event) => onTransformChange({ x: Number(event.target.value) }, false)} onPointerUp={onCommit} /></label>
      <label>垂直位置（{transform.y.toFixed(0)}%）<input type="range" min={0} max={100} step={1} value={transform.y} onChange={(event) => onTransformChange({ y: Number(event.target.value) }, false)} onPointerUp={onCommit} /></label>
      <label>缩放（{transform.scale.toFixed(0)}%）<input type="range" min={5} max={100} step={1} value={transform.scale} onChange={(event) => onTransformChange({ scale: Number(event.target.value) }, false)} onPointerUp={onCommit} /></label>
      <label>旋转（{(transform.rotation ?? 0).toFixed(0)}°）<input type="range" min={-180} max={180} step={1} value={transform.rotation ?? 0} onChange={(event) => onTransformChange({ rotation: Number(event.target.value) }, false)} onPointerUp={onCommit} /></label>
      <label>不透明度（{transform.opacity.toFixed(0)}%）<input type="range" min={0} max={100} step={1} value={transform.opacity} onChange={(event) => onTransformChange({ opacity: Number(event.target.value) }, false)} onPointerUp={onCommit} /></label>
      <label>
        混合模式
        <select value={transform.mix} onChange={(event) => onTransformChange({ mix: event.target.value })}>
          <option value="normal">正常</option><option value="overlay">叠加</option><option value="screen">滤色</option><option value="multiply">正片叠底</option><option value="addition">线性减淡(添加)</option><option value="softlight">柔光</option><option value="hardlight">强光</option><option value="lighten">变亮</option><option value="darken">变暗</option><option value="difference">差值</option><option value="exclusion">排除</option><option value="colorburn">颜色加深</option><option value="colordodge">颜色减淡</option>
        </select>
      </label>
      <label>圆角（{transform.cornerRadius}px）<input type="range" min={0} max={200} step={1} value={transform.cornerRadius} onChange={(event) => onTransformChange({ cornerRadius: Number(event.target.value) })} /></label>

      <div className="mask-section" data-inspector-section="mask">
        <span className="kf-label">蒙版</span>
        <div className="kf-buttons">
          {maskKinds.map((kind) => (
            <button
              key={kind}
              className={`speed-preset ${(mask?.kind ?? "none") === kind ? "active" : ""}`}
              onClick={() => {
                if (kind === "none") {
                  onMaskChange(null);
                  return;
                }
                onMaskChange(mask ? { ...mask, kind } : { kind, cx: 0.5, cy: 0.5, width: 0.8, height: 0.8, rotation: 0, feather: 0.2, invert: false });
              }}
            >
              {maskLabel(kind)}
            </button>
          ))}
        </div>
        <MaskPreview mask={mask ?? null} />
        {mask && (
          <>
            <label className="style-field">中心 X（{Math.round((mask.cx ?? 0.5) * 100)}%）<input type="range" min={0} max={1} step={0.01} value={mask.cx ?? 0.5} onChange={(event) => updateMask({ cx: Number(event.target.value) })} onPointerUp={onCommit} /></label>
            <label className="style-field">中心 Y（{Math.round((mask.cy ?? 0.5) * 100)}%）<input type="range" min={0} max={1} step={0.01} value={mask.cy ?? 0.5} onChange={(event) => updateMask({ cy: Number(event.target.value) })} onPointerUp={onCommit} /></label>
            <label className="style-field">宽度（{Math.round((mask.width ?? 0.8) * 100)}%）<input type="range" min={0.05} max={1} step={0.01} value={mask.width ?? 0.8} onChange={(event) => updateMask({ width: Number(event.target.value) })} onPointerUp={onCommit} /></label>
            <label className="style-field">高度（{Math.round((mask.height ?? 0.8) * 100)}%）<input type="range" min={0.05} max={1} step={0.01} value={mask.height ?? 0.8} onChange={(event) => updateMask({ height: Number(event.target.value) })} onPointerUp={onCommit} /></label>
            <label className="style-field">旋转（{Math.round(mask.rotation ?? 0)}°）<input type="range" min={-180} max={180} step={1} value={mask.rotation ?? 0} onChange={(event) => updateMask({ rotation: Number(event.target.value) })} onPointerUp={onCommit} /></label>
            <label className="style-field">羽化（{Math.round((mask.feather ?? 0.2) * 100)}%）<input type="range" min={0} max={1} step={0.05} value={mask.feather ?? 0.2} onChange={(event) => updateMask({ feather: Number(event.target.value) })} onPointerUp={onCommit} /></label>
            <label className="style-field mask-invert-field"><input type="checkbox" checked={mask.invert ?? false} onChange={(event) => updateMask({ invert: event.target.checked }, true)} /><span>反转</span></label>
          </>
        )}
      </div>
    </div>
  );
}
