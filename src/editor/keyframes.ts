import type { Keyframe, ClipKeyframes } from "../types";

/**
 * T4.2: 关键帧插值函数。
 * 在时间 t（相对 clip 起点的秒数）对一组关键帧采样，返回插值结果。
 *
 * 算法：二分找到 t 所在的两个相邻关键帧，按 easing 函数插值。
 * t 越界取端点值（首帧之前取首帧，末帧之后取末帧）。
 */

/** 单个 easing 应用到归一化进度 [0,1] */
function applyEasing(t01: number, easing: string): number {
  switch (easing) {
    case "easeIn":
      return t01 * t01;
    case "easeOut":
      return 1 - (1 - t01) * (1 - t01);
    case "easeInOut":
      return t01 < 0.5 ? 2 * t01 * t01 : 1 - Math.pow(-2 * t01 + 2, 2) / 2;
    case "linear":
    default:
      return t01;
  }
}

/** 对一组关键帧在时间 t 采样。kfs 必须按 time 升序。无关键帧返回 null。 */
export function sampleKeyframes(kfs: Keyframe[] | undefined, t: number): number | null {
  if (!kfs || kfs.length === 0) return null;
  const sorted = [...kfs].sort((left, right) => left.time - right.time);

  // t 在首帧之前 → 取首帧值
  if (t <= sorted[0].time) return sorted[0].value;
  // t 在末帧之后 → 取末帧值
  if (t >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value;

  // 二分找相邻两帧
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].time <= t) lo = mid;
    else hi = mid;
  }
  const a = sorted[lo];
  const b = sorted[hi];
  const span = b.time - a.time;
  if (span <= 0) return b.value;
  const t01 = (t - a.time) / span;
  const eased = applyEasing(t01, b.easing || "linear");
  return a.value + (b.value - a.value) * eased;
}

/**
 * 在给定时间 t 采样所有关键帧属性，返回结果（未设关键帧的属性为 undefined）。
 * 调用方用 undefined 判断"该属性回落到静态 transform 值"。
 */
export function sampleAllKeyframes(
  kfs: ClipKeyframes | null | undefined,
  t: number,
): Partial<{
  x: number;
  y: number;
  scale: number;
  opacity: number;
  rotation: number;
  volume: number;
}> {
  if (!kfs) return {};
  return {
    x: sampleKeyframes(kfs.x, t) ?? undefined,
    y: sampleKeyframes(kfs.y, t) ?? undefined,
    scale: sampleKeyframes(kfs.scale, t) ?? undefined,
    opacity: sampleKeyframes(kfs.opacity, t) ?? undefined,
    rotation: sampleKeyframes(kfs.rotation, t) ?? undefined,
    volume: sampleKeyframes(kfs.volume, t) ?? undefined,
  };
}

// ===== 关键帧 CRUD 工具函数（纯函数，不可变）=====

/** 在指定时间添加/覆盖关键帧。同时间点（±tol）的旧帧被移除。返回新数组。 */
export function addKeyframe(
  kfs: Keyframe[] | undefined,
  time: number,
  value: number,
  easing: Keyframe["easing"] = "linear",
  tol = 0.05,
): Keyframe[] {
  const arr = (kfs ?? []).filter((k) => Math.abs(k.time - time) > tol);
  arr.push({ time, value, easing });
  arr.sort((a, b) => a.time - b.time);
  return arr;
}

/** 删除指定时间（±tol）的关键帧。返回新数组。 */
export function removeKeyframeAt(
  kfs: Keyframe[] | undefined,
  time: number,
  tol = 0.05,
): Keyframe[] {
  return (kfs ?? []).filter((k) => Math.abs(k.time - time) > tol);
}

/** 查找指定时间（±tol）的关键帧。命中返回该帧，否则 null。 */
export function findKeyframeAt(
  kfs: Keyframe[] | undefined,
  time: number,
  tol = 0.1,
): Keyframe | null {
  if (!kfs || kfs.length === 0) return null;
  return kfs.find((k) => Math.abs(k.time - time) <= tol) ?? null;
}

/** 修改指定时间（±tol）关键帧的 easing。返回新数组。 */
export function updateKeyframeEasing(
  kfs: Keyframe[] | undefined,
  time: number,
  easing: Keyframe["easing"],
  tol = 0.05,
): Keyframe[] {
  return (kfs ?? []).map((k) =>
    Math.abs(k.time - time) <= tol ? { ...k, easing } : k,
  );
}

// ===== 手工验证用例（文件底部，方便核对，不自动执行）=====
// sampleKeyframes([{time:0,value:0,easing:"linear"},{time:1,value:100,easing:"linear"}], 0.5) === 50
// sampleKeyframes([{time:0,value:0,easing:"linear"},{time:1,value:100,easing:"linear"}], -1) === 0
// sampleKeyframes([{time:0,value:0,easing:"linear"},{time:1,value:100,easing:"linear"}], 2) === 100
// sampleKeyframes([{time:0,value:0,easing:"easeInOut"},{time:2,value:100,easing:"linear"}], 1) === 50
// sampleKeyframes([{time:0,value:10,easing:"linear"},{time:1,value:20,easing:"linear"}], 0.25) === 12.5
