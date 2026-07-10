import type { EvaluatedVisualLayer } from "./types";

type VisualLayerValues = Pick<
  EvaluatedVisualLayer,
  "x" | "y" | "scale" | "rotation" | "effectiveOpacity"
>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
  const scale = Math.max(1, layer.scale);
  return {
    left: `${x}%`,
    top: `${y}%`,
    width: `${scale}%`,
    height: `${scale}%`,
    transform: `translate(-${x}%, -${y}%) rotate(${layer.rotation}deg)`,
    opacity: String(clamp(layer.effectiveOpacity, 0, 1)),
  };
}
