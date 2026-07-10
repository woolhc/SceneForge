import assert from "node:assert/strict";
import { positionVisualLayerBox, visualLayerCssStyle } from "../../src/renderGraph/visualLayout";
import type { EvaluatedVisualLayer } from "../../src/renderGraph/types";

const layer = {
  x: 25,
  y: 75,
  scale: 40,
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
