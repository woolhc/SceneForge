import assert from "node:assert/strict";
import { toggleVisualEffect } from "../../src/editor/visualEffects";

assert.deepEqual(toggleVisualEffect(null, "glow"), [{ kind: "glow", intensity: 50 }]);
assert.equal(toggleVisualEffect([{ kind: "glow", intensity: 70 }], "glow"), null);
assert.deepEqual(
  toggleVisualEffect([{ kind: "vignette", intensity: 40 }], "shake"),
  [
    { kind: "vignette", intensity: 40 },
    { kind: "shake", intensity: 50 },
  ],
);
