import type { Clip, MediaSource, SubtitleStyle, TrackKind, WordCue } from "../types";

export type RenderCanvas = { width: number; height: number };

export type RenderLayer = {
  id: string;
  trackId: string;
  trackKind: TrackKind;
  trackOrder: number;
  trackMuted: boolean;
  clip: Clip;
  media: MediaSource | null;
};

export type RenderGraph = {
  duration: number;
  canvas: RenderCanvas;
  layers: RenderLayer[];
};

export type EvaluatedVisualLayer = RenderLayer & {
  relativeTime: number;
  sourceTime: number;
  speed: number;
  x: number;
  y: number;
  scale: number;
  /** 盒宽占画布宽 %；缺省时与 scale 相同 */
  width: number;
  /** 盒高占画布高 %；缺省时与 scale 相同 */
  height: number;
  fit: "cover" | "contain";
  opacity: number;
  rotation: number;
  transitionInProgress: number;
  transitionOutProgress: number;
  effectiveOpacity: number;
};

export type EvaluatedAudioLayer = RenderLayer & {
  relativeTime: number;
  sourceTime: number;
  speed: number;
  volume: number;
  fadeInGain: number;
  fadeOutGain: number;
  gain: number;
};

export type EvaluatedSubtitleLayer = RenderLayer & {
  relativeTime: number;
  text: string;
  style: SubtitleStyle;
  words: WordCue[];
  activeWordIndex: number | null;
};

export type EvaluatedFrame = {
  time: number;
  visualLayers: EvaluatedVisualLayer[];
  audioLayers: EvaluatedAudioLayer[];
  subtitleLayers: EvaluatedSubtitleLayer[];
};
