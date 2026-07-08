import type { ClipMask } from "../types";

/**
 * 蒙版预览组件：纯展示 SVG 80x45，按 mask.kind 绘制几何形状。
 * - rect：矩形，按 cx/cy/width/height/rotation 定位
 * - circle：椭圆（width/height 不同时为椭圆）
 * - linear：左到右线性渐变，左透右不透（invert 时反转）
 * - mirror：左右两半，中线对称分割
 *
 * 蒙版区域用半透明黄色覆盖，外部区域为暗底。羽化用 stroke-opacity 模拟。
 */

const W = 80;
const H = 45;

export function MaskPreview({ mask }: { mask: ClipMask | null | undefined }) {
  if (!mask) {
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ background: "rgba(0,0,0,0.3)", borderRadius: 4 }}>
        <text x={W / 2} y={H / 2 + 4} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize={9}>
          无蒙版
        </text>
      </svg>
    );
  }

  const cx = mask.cx * W;
  const cy = mask.cy * H;
  const w = mask.width * W;
  const h = mask.height * H;
  const rot = mask.rotation ?? 0;
  const invert = mask.invert ?? false;
  const fillCol = "rgba(243, 201, 105, 0.55)";
  const strokeCol = "rgba(243, 201, 105, 0.9)";

  const renderShape = () => {
    switch (mask.kind) {
      case "rect":
        return (
          <rect
            x={cx - w / 2}
            y={cy - h / 2}
            width={w}
            height={h}
            transform={`rotate(${rot} ${cx} ${cy})`}
            fill={fillCol}
            stroke={strokeCol}
            strokeWidth={0.5}
            strokeDasharray="2 1"
          />
        );
      case "circle":
        return (
          <ellipse
            cx={cx}
            cy={cy}
            rx={w / 2}
            ry={h / 2}
            transform={`rotate(${rot} ${cx} ${cy})`}
            fill={fillCol}
            stroke={strokeCol}
            strokeWidth={0.5}
            strokeDasharray="2 1"
          />
        );
      case "linear": {
        // 左到右线性渐变，invert 时反转
        const id = `lin-${invert ? "inv" : "nrm"}`;
        return (
          <>
            <defs>
              <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="0%">
                {invert ? (
                  <>
                    <stop offset="0%" stopColor={fillCol} stopOpacity={0.1} />
                    <stop offset="100%" stopColor={fillCol} stopOpacity={0.9} />
                  </>
                ) : (
                  <>
                    <stop offset="0%" stopColor={fillCol} stopOpacity={0.9} />
                    <stop offset="100%" stopColor={fillCol} stopOpacity={0.1} />
                  </>
                )}
              </linearGradient>
            </defs>
            <rect x={0} y={0} width={W} height={H} fill={`url(#${id})`} />
          </>
        );
      }
      case "mirror": {
        // 左右两半，中线分割
        return (
          <>
            <rect x={0} y={0} width={W / 2} height={H} fill={fillCol} />
            <rect x={W / 2} y={0} width={W / 2} height={H} fill="rgba(0,0,0,0.5)" stroke={strokeCol} strokeWidth={0.5} strokeDasharray="2 1" />
            <line x1={W / 2} y1={0} x2={W / 2} y2={H} stroke={strokeCol} strokeWidth={0.5} />
          </>
        );
      }
      default:
        return null;
    }
  };

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      style={{ background: "rgba(0,0,0,0.3)", borderRadius: 4, display: "block", marginTop: 4 }}
    >
      <rect x={0} y={0} width={W} height={H} fill="rgba(255,255,255,0.05)" />
      {renderShape()}
    </svg>
  );
}
