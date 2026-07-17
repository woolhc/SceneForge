import { timelineToSourceTime } from "../editor/clipTimeMap";
import { sampleAllKeyframes } from "../editor/keyframes";
import { speedAtTimelineTime } from "../editor/speedCurve";
import { transitionDuration, transitionName } from "../editor/transitions";
import { DEFAULT_SUBTITLE_STYLE } from "../types";
import type {
  EvaluatedAudioLayer,
  EvaluatedFrame,
  EvaluatedSubtitleLayer,
  EvaluatedVisualLayer,
  RenderGraph,
  RenderLayer,
} from "./types";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function activeAt(layer: RenderLayer, time: number): boolean {
  return time >= layer.clip.startOnTrack && time < layer.clip.startOnTrack + layer.clip.duration;
}

function evaluatedSpeed(layer: RenderLayer, relativeTime: number): number {
  const { clip } = layer;
  if (clip.speedCurve?.length) {
    return clamp(
      speedAtTimelineTime(clip.speedCurve, Math.max(0, clip.sourceOut - clip.sourceIn), relativeTime),
      0.0625,
      16,
    );
  }
  return Math.max(0.0001, Math.abs(clip.speed || 1));
}

function transitionProgress(
  transition: RenderLayer["clip"]["transitionIn"],
  elapsed: number,
  fallback: number,
): number {
  const name = transitionName(transition);
  if (!name || name === "none") return 1;
  const duration = transitionDuration(transition, fallback);
  return duration > 0 ? clamp(elapsed / duration, 0, 1) : 1;
}

function evaluateVisualLayer(layer: RenderLayer, time: number): EvaluatedVisualLayer {
  const { clip } = layer;
  const relativeTime = time - clip.startOnTrack;
  const remaining = Math.max(0, clip.duration - relativeTime);
  const sampled = sampleAllKeyframes(clip.keyframes, relativeTime);
  const transform = clip.transform;
  const opacity = clamp(sampled.opacity ?? transform?.opacity ?? 100, 0, 100);
  const transitionInProgress = transitionProgress(clip.transitionIn, relativeTime, 0.5);
  const transitionOutProgress = transitionProgress(clip.transitionOut, remaining, 0.5);
  return {
    ...layer,
    relativeTime,
    sourceTime: timelineToSourceTime(clip, relativeTime),
    speed: evaluatedSpeed(layer, relativeTime),
    x: sampled.x ?? transform?.x ?? 50,
    y: sampled.y ?? transform?.y ?? 50,
    scale: sampled.scale ?? transform?.scale ?? 100,
    opacity,
    rotation: sampled.rotation ?? transform?.rotation ?? 0,
    transitionInProgress,
    transitionOutProgress,
    effectiveOpacity: (opacity / 100) * transitionInProgress * transitionOutProgress,
  };
}

function evaluateAudioLayer(layer: RenderLayer, time: number): EvaluatedAudioLayer {
  const { clip } = layer;
  const relativeTime = time - clip.startOnTrack;
  const remaining = Math.max(0, clip.duration - relativeTime);
  const sampled = sampleAllKeyframes(clip.keyframes, relativeTime);
  const volume = clamp(sampled.volume ?? clip.volume, 0, 2);
  const fadeInGain = clip.fadeIn > 0 ? clamp(relativeTime / clip.fadeIn, 0, 1) : 1;
  const fadeOutGain = clip.fadeOut > 0 ? clamp(remaining / clip.fadeOut, 0, 1) : 1;
  return {
    ...layer,
    relativeTime,
    sourceTime: timelineToSourceTime(clip, relativeTime),
    speed: evaluatedSpeed(layer, relativeTime),
    volume,
    fadeInGain,
    fadeOutGain,
    gain: volume * fadeInGain * fadeOutGain,
  };
}

function evaluateSubtitleLayer(layer: RenderLayer, time: number): EvaluatedSubtitleLayer {
  const { clip } = layer;
  const relativeTime = time - clip.startOnTrack;
  const words = clip.words ?? [];
  const wordsAreRelative = words.length > 0 && words.every(
    (word) => word.start >= 0 && word.end <= clip.duration + 1e-6,
  );
  const wordTime = wordsAreRelative ? relativeTime : time;
  const activeWordIndex = words.findIndex((word) => wordTime >= word.start && wordTime < word.end);
  return {
    ...layer,
    relativeTime,
    text: clip.text ?? "",
    style: { ...DEFAULT_SUBTITLE_STYLE, ...(clip.subtitleStyle ?? {}) },
    words,
    activeWordIndex: activeWordIndex >= 0 ? activeWordIndex : null,
  };
}

export function evaluateFrame(graph: RenderGraph, time: number): EvaluatedFrame {
  const evaluatedTime = clamp(Number.isFinite(time) ? time : 0, 0, graph.duration);
  const activeLayers = graph.layers.filter((layer) => activeAt(layer, evaluatedTime));
  return {
    time: evaluatedTime,
    visualLayers: activeLayers
      .filter((layer) => (layer.trackKind === "video" || layer.trackKind === "image") && layer.media)
      .map((layer) => evaluateVisualLayer(layer, evaluatedTime)),
    audioLayers: activeLayers
      .filter((layer) =>
        !layer.trackMuted &&
        (layer.trackKind === "video" || layer.trackKind === "audio" || layer.trackKind === "voiceover") &&
        layer.media && layer.media.kind !== "image",
      )
      .map((layer) => evaluateAudioLayer(layer, evaluatedTime)),
    subtitleLayers: activeLayers
      .filter((layer) => layer.trackKind === "subtitle" || layer.trackKind === "text")
      .map((layer) => evaluateSubtitleLayer(layer, evaluatedTime)),
  };
}
