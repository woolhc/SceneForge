import type { ClipTransform } from "../../types";
import { DEFAULT_TRANSFORM } from "../../types";
import type { LayoutRegion } from "./types";

/**
 * 布局区域 → ClipTransform。
 * 区域矩形用左上角 + 宽高 %；transform 用中心点锚点 (x,y)。
 */
export function regionToTransform(region: LayoutRegion): ClipTransform {
  const centerX = region.x + region.width / 2;
  const centerY = region.y + region.height / 2;
  return {
    ...DEFAULT_TRANSFORM,
    x: Math.max(0, Math.min(100, centerX)),
    y: Math.max(0, Math.min(100, centerY)),
    scale: Math.max(region.width, region.height),
    width: Math.max(1, Math.min(100, region.width)),
    height: Math.max(1, Math.min(100, region.height)),
    fit: region.fit ?? "cover",
    opacity: 100,
    rotation: 0,
  };
}
