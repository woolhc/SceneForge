import assert from "node:assert/strict";
import { sampleKeyframes, moveKeyframe, updateKeyframeEasing } from "../../src/editor/keyframes";

const unsorted = [
  { time: 2, value: 100, easing: "linear" as const },
  { time: 0, value: 0, easing: "linear" as const },
];

assert.equal(
  sampleKeyframes(unsorted, 1),
  50,
  "imported unsorted keyframes must sample identically to Rust",
);

// ---- 贝塞尔缓动：对称控制点 [0.42,0,0.58,1] 变体在 t=0.5 应恰好落在中点 ----
const symmetricBezier = [
  { time: 0, value: 0, easing: "linear" as const },
  { time: 2, value: 100, easing: "bezier" as const, bezierPoints: [0.5, 0.5, 0.5, 0.5] as [number, number, number, number] },
];
assert.equal(
  sampleKeyframes(symmetricBezier, 1),
  50,
  "对角对称贝塞尔控制点应退化为线性，t=0.5 时取中点值",
);

// bezier 但缺 bezierPoints 时应退化为线性（不崩溃）
const bezierWithoutPoints = [
  { time: 0, value: 0, easing: "linear" as const },
  { time: 2, value: 100, easing: "bezier" as const },
];
assert.equal(
  sampleKeyframes(bezierWithoutPoints, 1),
  50,
  "缺少 bezierPoints 时应安全退化为线性插值",
);

// ---- moveKeyframe：更新 time/value 并保持按 time 排序 ----
const kfs = [
  { time: 0, value: 0, easing: "linear" as const },
  { time: 1, value: 50, easing: "linear" as const },
  { time: 2, value: 100, easing: "linear" as const },
];
const moved = moveKeyframe(kfs, 0, { time: 1.5, value: 5 });
assert.equal(moved.length, 3, "moveKeyframe 不应增删元素");
assert.deepEqual(
  moved.map((k) => k.time),
  [1, 1.5, 2],
  "moveKeyframe 更新 time 后应重新按 time 排序",
);
assert.equal(moved.find((k) => k.time === 1.5)?.value, 5, "moveKeyframe 应更新 value");

// ---- updateKeyframeEasing：切到 bezier 应带默认控制点，切走应清除 ----
const withBezier = updateKeyframeEasing(kfs, 1, "bezier");
assert.deepEqual(
  withBezier.find((k) => k.time === 1)?.bezierPoints,
  [0.42, 0, 0.58, 1],
  "切换到 bezier 且未指定控制点时应写入默认三次贝塞尔曲线",
);
const backToLinear = updateKeyframeEasing(withBezier, 1, "linear");
assert.equal(
  backToLinear.find((k) => k.time === 1)?.bezierPoints,
  undefined,
  "切换离开 bezier 后应清除 bezierPoints",
);
