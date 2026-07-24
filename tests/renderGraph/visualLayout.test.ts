import assert from "node:assert/strict";
import { positionVisualLayerBox, visualLayerCssStyle } from "../../src/renderGraph/visualLayout";
import type { EvaluatedVisualLayer } from "../../src/renderGraph/types";

const layer = {
  x: 25,
  y: 75,
  scale: 40,
  width: 40,
  height: 40,
  fit: "cover",
  rotation: 30,
  effectiveOpacity: 0.6,
} as EvaluatedVisualLayer;

assert.deepEqual(positionVisualLayerBox(layer, 1000, 500, 400, 200), {
  left: 150,
  top: 225,
  centerX: 350,
  centerY: 325,
  width: 400,
  height: 200,
  rotationRadians: Math.PI / 6,
  opacity: 0.6,
});

assert.deepEqual(visualLayerCssStyle(layer), {
  left: "25%",
  top: "75%",
  width: "40%",
  height: "40%",
  transform: "translate(-25%, -75%) rotate(30deg)",
  opacity: "0.6",
});

// 非等比方框（知识卡片中带）
assert.deepEqual(
  visualLayerCssStyle({
    x: 50,
    y: 40,
    scale: 100,
    width: 100,
    height: 36,
    rotation: 0,
    effectiveOpacity: 1,
  } as EvaluatedVisualLayer),
  {
    left: "50%",
    top: "40%",
    width: "100%",
    height: "36%",
    transform: "translate(-50%, -40%) rotate(0deg)",
    opacity: "1",
  },
);
