import type { Clip, ClipKeyframes, Keyframe, SpeedPoint } from "../types";
import { sampleKeyframes } from "./keyframes";
import { timelineToSourceTime as curveTimelineToSourceTime } from "./speedCurve";

const EPSILON = 1e-9;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clipSourceDuration(clip: Clip): number {
  return Math.max(0, clip.sourceOut - clip.sourceIn);
}

function playsInReverse(clip: Clip): boolean {
  return clip.reverse === true || clip.speed < 0;
}

export function timelineToSourceOffset(clip: Clip, timelineOffset: number): number {
  const sourceDuration = clipSourceDuration(clip);
  if (sourceDuration <= EPSILON) return 0;

  const relativeTime = clamp(timelineOffset, 0, Math.max(0, clip.duration));
  const sourceOffset = clip.speedCurve?.length
    ? curveTimelineToSourceTime(clip.speedCurve, sourceDuration, relativeTime)
    : relativeTime * Math.max(EPSILON, Math.abs(clip.speed || 1));

  return clamp(sourceOffset, 0, sourceDuration);
}

export function timelineToSourceTime(clip: Clip, timelineOffset: number): number {
  const offset = timelineToSourceOffset(clip, timelineOffset);
  return playsInReverse(clip) ? clip.sourceOut - offset : clip.sourceIn + offset;
}

function speedAtSourceRatio(curve: SpeedPoint[], ratio: number): number {
  const sorted = [...curve].sort((a, b) => a.time - b.time);
  if (sorted.length === 0) return 1;
  if (ratio <= sorted[0].time) return sorted[0].speed;
  if (ratio >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].speed;

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const next = sorted[index];
    if (ratio <= next.time) {
      const span = next.time - previous.time;
      if (span <= EPSILON) return next.speed;
      const progress = (ratio - previous.time) / span;
      return previous.speed + (next.speed - previous.speed) * progress;
    }
  }

  return sorted[sorted.length - 1].speed;
}

export function sliceSpeedCurve(
  curve: SpeedPoint[] | null | undefined,
  sourceStartRatio: number,
  sourceEndRatio: number,
): SpeedPoint[] | null {
  if (!curve?.length) return null;

  const start = clamp(Math.min(sourceStartRatio, sourceEndRatio), 0, 1);
  const end = clamp(Math.max(sourceStartRatio, sourceEndRatio), 0, 1);
  if (end - start <= EPSILON) return null;

  const points = [
    { time: start, speed: speedAtSourceRatio(curve, start) },
    ...curve
      .filter((point) => point.time > start + EPSILON && point.time < end - EPSILON)
      .map((point) => ({ ...point })),
    { time: end, speed: speedAtSourceRatio(curve, end) },
  ];
  const span = end - start;
  return points.map((point, index) => ({
    speed: point.speed,
    time: index === 0 ? 0 : index === points.length - 1 ? 1 : (point.time - start) / span,
  }));
}

function sliceKeyframes(frames: Keyframe[] | undefined, start: number, end: number): Keyframe[] | undefined {
  if (!frames?.length) return undefined;

  const startValue = sampleKeyframes(frames, start);
  const endValue = sampleKeyframes(frames, end);
  if (startValue === null || endValue === null) return undefined;

  const result: Keyframe[] = [{ time: 0, value: startValue, easing: "linear" }];
  for (const frame of frames) {
    if (frame.time > start + EPSILON && frame.time < end - EPSILON) {
      result.push({ ...frame, time: frame.time - start });
    }
  }

  const duration = end - start;
  if (duration > EPSILON) {
    const nextFrame = frames.find((frame) => frame.time >= end - EPSILON);
    result.push({
      time: duration,
      value: endValue,
      easing: nextFrame?.easing ?? "linear",
    });
  }
  return result;
}

function sliceClipKeyframes(
  keyframes: ClipKeyframes | null | undefined,
  start: number,
  end: number,
): ClipKeyframes | null {
  if (!keyframes) return null;
  const result: ClipKeyframes = {};
  for (const property of Object.keys(keyframes) as (keyof ClipKeyframes)[]) {
    const sliced = sliceKeyframes(keyframes[property], start, end);
    if (sliced?.length) result[property] = sliced;
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function sliceClipByTimelineRange(
  clip: Clip,
  startOffset: number,
  endOffset: number,
  newId = clip.id,
): Clip {
  const start = clamp(Math.min(startOffset, endOffset), 0, clip.duration);
  const end = clamp(Math.max(startOffset, endOffset), start, clip.duration);
  const sourceAtStart = timelineToSourceTime(clip, start);
  const sourceAtEnd = timelineToSourceTime(clip, end);
  const originalSourceDuration = clipSourceDuration(clip);
  const sourceIn = Math.min(sourceAtStart, sourceAtEnd);
  const sourceOut = Math.max(sourceAtStart, sourceAtEnd);
  const sourceStartRatio = originalSourceDuration > EPSILON
    ? (sourceIn - clip.sourceIn) / originalSourceDuration
    : 0;
  const sourceEndRatio = originalSourceDuration > EPSILON
    ? (sourceOut - clip.sourceIn) / originalSourceDuration
    : 1;

  return {
    ...clip,
    id: newId,
    startOnTrack: clip.startOnTrack + start,
    duration: end - start,
    sourceIn,
    sourceOut,
    speedCurve: sliceSpeedCurve(clip.speedCurve, sourceStartRatio, sourceEndRatio),
    keyframes: sliceClipKeyframes(clip.keyframes, start, end),
  };
}

export function splitClipByTimelineTime(
  clip: Clip,
  absoluteTimelineTime: number,
  newId = `clip_${Math.random().toString(16).slice(2)}_${Date.now()}`,
): [Clip, Clip] | null {
  const splitOffset = absoluteTimelineTime - clip.startOnTrack;
  if (splitOffset <= 0.1 || splitOffset >= clip.duration - 0.1) return null;

  const first = sliceClipByTimelineRange(clip, 0, splitOffset, clip.id);
  const second = sliceClipByTimelineRange(clip, splitOffset, clip.duration, newId);
  return [
    { ...first, transitionOut: null },
    { ...second, transitionIn: null },
  ];
}
