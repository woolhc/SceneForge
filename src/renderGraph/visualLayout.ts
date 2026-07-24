import type { EvaluatedVisualLayer } from "./types";

type VisualLayerValues = Pick<
  EvaluatedVisualLayer,
  "x" | "y" | "scale" | "width" | "height" | "rotation" | "effectiveOpacity"
>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveBoxSize(layer: VisualLayerValues) {
  const fallback = Math.max(1, layer.scale);
  const width = Number.isFinite(layer.width) ? Math.max(1, layer.width) : fallback;
  const height = Number.isFinite(layer.height) ? Math.max(1, layer.height) : fallback;
  return { width, height };
}

export function positionVisualLayerBox(
  layer: VisualLayerValues,
  canvasWidth: number,
  canvasHeight: number,
  width: number,
  height: number,
) {
  const xRatio = clamp(layer.x, 0, 100) / 100;
  const yRatio = clamp(layer.y, 0, 100) / 100;
  const left = (canvasWidth - width) * xRatio;
  const top = (canvasHeight - height) * yRatio;
  return {
    left,
    top,
    centerX: left + width / 2,
    centerY: top + height / 2,
    width,
    height,
    rotationRadians: (layer.rotation * Math.PI) / 180,
    opacity: clamp(layer.effectiveOpacity, 0, 1),
  };
}

export function visualLayerCssStyle(layer: VisualLayerValues) {
  const x = clamp(layer.x, 0, 100);
  const y = clamp(layer.y, 0, 100);
  const { width, height } = resolveBoxSize(layer);
  return {
    left: `${x}%`,
    top: `${y}%`,
    width: `${width}%`,
    height: `${height}%`,
    transform: `translate(-${x}%, -${y}%) rotate(${layer.rotation}deg)`,
    opacity: String(clamp(layer.effectiveOpacity, 0, 1)),
  };
}
