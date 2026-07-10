import assert from "node:assert/strict";
import { sampleKeyframes } from "../../src/editor/keyframes";

const unsorted = [
  { time: 2, value: 100, easing: "linear" as const },
  { time: 0, value: 0, easing: "linear" as const },
];

assert.equal(
  sampleKeyframes(unsorted, 1),
  50,
  "imported unsorted keyframes must sample identically to Rust",
);
