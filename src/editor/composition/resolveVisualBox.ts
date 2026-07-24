import type { ClipTransform } from "../../types";
import type { ResolvedVisualBox } from "./types";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 将 ClipTransform 解析为统一盒模型。
 * 旧数据无 width/height 时回退 scale；fit 默认 cover。
 */
export function resolveVisualBox(
  transform: Partial<ClipTransform> | null | undefined,
): ResolvedVisualBox {
  const scale = Math.max(1, transform?.scale ?? 100);
  const width = transform?.width != null && Number.isFinite(transform.width)
    ? clamp(transform.width, 1, 100)
    : scale;
  const height = transform?.height != null && Number.isFinite(transform.height)
    ? clamp(transform.height, 1, 100)
    : scale;
  const fit = transform?.fit === "contain" ? "contain" : "cover";
  return {
    x: clamp(transform?.x ?? 50, 0, 100),
    y: clamp(transform?.y ?? 50, 0, 100),
    width,
    height,
    fit,
    rotation: Number.isFinite(transform?.rotation) ? (transform?.rotation ?? 0) : 0,
    opacity: clamp(transform?.opacity ?? 100, 0, 100),
  };
}
