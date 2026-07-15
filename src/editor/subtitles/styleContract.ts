import type { SubtitleStyle } from "../../types";
import { DEFAULT_SUBTITLE_STYLE } from "../../types";

export type SubtitleAnchor = { x: number; y: number };

/**
 * Export-safe defaults shared by every preview surface. Rust uses the same
 * top/center/bottom anchors when emitting ASS dialogue positions.
 */
export const SUBTITLE_POSITION_ANCHORS: Record<
  Exclude<SubtitleStyle["position"], "custom">,
  SubtitleAnchor
> = {
  top: { x: 50, y: 12 },
  center: { x: 50, y: 50 },
  bottom: { x: 50, y: 88 },
};

export function normalizeSubtitleStyle(
  style?: Partial<SubtitleStyle> | null,
): SubtitleStyle {
  const next = { ...DEFAULT_SUBTITLE_STYLE, ...(style ?? {}) };
  return {
    ...next,
    fontSize: Math.max(
      8,
      Math.min(
        240,
        Number.isFinite(next.fontSize)
          ? next.fontSize
          : DEFAULT_SUBTITLE_STYLE.fontSize,
      ),
    ),
    strokeWidth: Math.max(
      0,
      Math.min(
        32,
        Number.isFinite(next.strokeWidth)
          ? next.strokeWidth!
          : DEFAULT_SUBTITLE_STYLE.strokeWidth!,
      ),
    ),
    backgroundPadding: Math.max(
      0,
      Math.min(
        64,
        Number.isFinite(next.backgroundPadding)
          ? next.backgroundPadding!
          : DEFAULT_SUBTITLE_STYLE.backgroundPadding!,
      ),
    ),
    shadowBlur: Math.max(
      0,
      Math.min(
        64,
        Number.isFinite(next.shadowBlur)
          ? next.shadowBlur!
          : DEFAULT_SUBTITLE_STYLE.shadowBlur!,
      ),
    ),
    letterSpacing: Math.max(
      -10,
      Math.min(
        40,
        Number.isFinite(next.letterSpacing)
          ? next.letterSpacing!
          : DEFAULT_SUBTITLE_STYLE.letterSpacing!,
      ),
    ),
    lineHeight: Math.max(
      0.8,
      Math.min(
        3,
        Number.isFinite(next.lineHeight)
          ? next.lineHeight!
          : DEFAULT_SUBTITLE_STYLE.lineHeight!,
      ),
    ),
    x: Math.max(
      0,
      Math.min(
        100,
        Number.isFinite(next.x) ? next.x : DEFAULT_SUBTITLE_STYLE.x,
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        100,
        Number.isFinite(next.y) ? next.y : DEFAULT_SUBTITLE_STYLE.y,
      ),
    ),
    scaleX: Math.max(
      10,
      Math.min(
        500,
        Number.isFinite(next.scaleX)
          ? next.scaleX
          : DEFAULT_SUBTITLE_STYLE.scaleX,
      ),
    ),
    scaleY: Math.max(
      10,
      Math.min(
        500,
        Number.isFinite(next.scaleY)
          ? next.scaleY
          : DEFAULT_SUBTITLE_STYLE.scaleY,
      ),
    ),
    rotation: Number.isFinite(next.rotation)
      ? next.rotation
      : DEFAULT_SUBTITLE_STYLE.rotation,
  };
}

export function resolveSubtitleAnchor(
  style?: Partial<SubtitleStyle> | null,
): SubtitleAnchor {
  const normalized = normalizeSubtitleStyle(style);
  if (normalized.position === "custom")
    return { x: normalized.x, y: normalized.y };
  return SUBTITLE_POSITION_ANCHORS[normalized.position];
}

export function subtitleExportWarnings(
  style?: Partial<SubtitleStyle> | null,
): string[] {
  const normalized = normalizeSubtitleStyle(style);
  const warnings: string[] = [];
  if (normalized.backgroundColor !== "none") {
    warnings.push("导出会将背景近似为方形底板，暂不支持圆角。");
  }
  if (normalized.lineHeight !== DEFAULT_SUBTITLE_STYLE.lineHeight) {
    warnings.push("ASS 导出暂不支持自定义行高，将使用字体默认行距。");
  }
  if (
    normalized.animationIn === "slideUp" &&
    normalized.animationOut === "slideDown"
  ) {
    warnings.push(
      "同一字幕同时上滑入场和下滑出场时，导出优先保留入场位移，出场以淡出近似。",
    );
  }
  return warnings;
}
