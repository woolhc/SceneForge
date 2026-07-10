import assert from "node:assert/strict";
import { layerParamsForClip } from "../../src/preview/WebGLCompositor";
import type { Clip } from "../../src/types";

const clip = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  mask: {
    kind: "circle",
    cx: 0.5,
    cy: 0.5,
    width: 0.8,
    height: 0.8,
    rotation: 90,
    feather: 0.1,
    invert: false,
  },
} as Clip;

const params = layerParamsForClip(clip, 50, 50, 100, 100);
assert.ok(Math.abs(params.maskRotation - Math.PI / 2) < 1e-9);
