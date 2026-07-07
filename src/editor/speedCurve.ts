import type { SpeedPoint } from "../types";

/**
 * T4.3: 曲线变速工具。
 * curveToSegments 把曲线离散为 N 段常速段（每段 ≤0.5 秒源时长）。
 * 预设曲线模板。
 */

export type { SpeedPoint };

/** 预设曲线模板（time 为源素材归一化 0-1 位置，speed 为倍速） */
export const SPEED_PRESETS: Record<string, { label: string; points: SpeedPoint[] }> = {
  none: { label: "无", points: [] },
  montage: {
    label: "蒙太奇",
    points: [
      { time: 0, speed: 1 },
      { time: 0.25, speed: 2 },
      { time: 0.5, speed: 1 },
      { time: 0.75, speed: 2 },
      { time: 1, speed: 1 },
    ],
  },
  hero: {
    label: "英雄时刻",
    points: [
      { time: 0, speed: 1.5 },
      { time: 0.4, speed: 0.5 },
      { time: 0.6, speed: 0.5 },
      { time: 1, speed: 1.5 },
    ],
  },
  bullet: {
    label: "子弹时间",
    points: [
      { time: 0, speed: 1 },
      { time: 0.3, speed: 3 },
      { time: 0.5, speed: 0.25 },
      { time: 0.7, speed: 3 },
      { time: 1, speed: 1 },
    ],
  },
};

/**
 * 把曲线离散为常速段。
 * 每段源时长 ≤0.5 秒（保证平滑度），返回 {sourceIn, sourceOut, speed}。
 */
export function curveToSegments(
  curve: SpeedPoint[],
  sourceDuration: number,
): { sourceIn: number; sourceOut: number; speed: number }[] {
  if (curve.length === 0 || sourceDuration <= 0) return [];
  // 按 time 排序
  const sorted = [...curve].sort((a, b) => a.time - b.time);
  // 确保覆盖 0-1
  if (sorted[0].time > 0) sorted.unshift({ time: 0, speed: sorted[0].speed });
  if (sorted[sorted.length - 1].time < 1) sorted.push({ time: 1, speed: sorted[sorted.length - 1].speed });

  const segments: { sourceIn: number; sourceOut: number; speed: number }[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const t0 = sorted[i].time * sourceDuration;
    const t1 = sorted[i + 1].time * sourceDuration;
    const span = t1 - t0;
    if (span <= 0) continue;
    // 每段取两端速度的平均值作为常速（简化）
    const avgSpeed = (sorted[i].speed + sorted[i + 1].speed) / 2;
    const clamped = Math.max(0.0625, Math.min(16, avgSpeed));
    // 按 0.5 秒源时长切分子段
    const subCount = Math.max(1, Math.ceil(span / 0.5));
    for (let s = 0; s < subCount; s++) {
      const subT0 = t0 + (span * s) / subCount;
      const subT1 = t0 + (span * (s + 1)) / subCount;
      // 子段速度按线性插值
      const r = (s + 0.5) / subCount;
      const spd = sorted[i].speed + (sorted[i + 1].speed - sorted[i].speed) * r;
      segments.push({
        sourceIn: subT0,
        sourceOut: subT1,
        speed: Math.max(0.0625, Math.min(16, spd)),
      });
    }
  }
  return segments;
}

/** 计算曲线变速后时间线时长（源时长按各段 speed 缩放累加） */
export function curveTimelineDuration(curve: SpeedPoint[], sourceDuration: number): number {
  const segs = curveToSegments(curve, sourceDuration);
  if (segs.length === 0) return sourceDuration;
  return segs.reduce((sum, seg) => sum + (seg.sourceOut - seg.sourceIn) / seg.speed, 0);
}
