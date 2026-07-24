import assert from "node:assert/strict";
import { layerParamsForClip, maskKindCode } from "../../src/preview/WebGLCompositor";
import type { Clip } from "../../src/types";

assert.equal(maskKindCode(undefined), 0);
assert.equal(maskKindCode(null), 0);
assert.equal(maskKindCode("circle"), 1);
assert.equal(maskKindCode("rect"), 2);
assert.equal(maskKindCode("linear"), 3);
assert.equal(maskKindCode("mirror"), 4);
assert.equal(maskKindCode("unknown"), 0);

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
assert.equal(params.maskKind, 1);

const linear = layerParamsForClip(
  { ...clip, mask: { ...clip.mask!, kind: "linear", rotation: 0 } } as Clip,
  50,
  50,
  100,
  100,
);
assert.equal(linear.maskKind, 3);

const mirror = layerParamsForClip(
  { ...clip, mask: { ...clip.mask!, kind: "mirror" } } as Clip,
  50,
  50,
  100,
  100,
);
assert.equal(mirror.maskKind, 4);

console.log("webglParams.test.ts: ok");
