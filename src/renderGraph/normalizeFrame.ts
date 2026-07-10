import type { EvaluatedFrame } from "./types";

function round(value: number): number {
  return Number(value.toFixed(6));
}

export function normalizeEvaluatedFrame(frame: EvaluatedFrame) {
  return {
    time: round(frame.time),
    visual: frame.visualLayers.map((layer) => ({
      id: layer.id,
      sourceTime: round(layer.sourceTime),
      speed: round(layer.speed),
      x: round(layer.x),
      y: round(layer.y),
      scale: round(layer.scale),
      opacity: round(layer.opacity),
      rotation: round(layer.rotation),
      transitionInProgress: round(layer.transitionInProgress),
      transitionOutProgress: round(layer.transitionOutProgress),
      effectiveOpacity: round(layer.effectiveOpacity),
    })),
    audio: frame.audioLayers.map((layer) => ({
      id: layer.id,
      sourceTime: round(layer.sourceTime),
      speed: round(layer.speed),
      volume: round(layer.volume),
      fadeInGain: round(layer.fadeInGain),
      fadeOutGain: round(layer.fadeOutGain),
      gain: round(layer.gain),
    })),
    subtitle: frame.subtitleLayers.map((layer) => ({
      id: layer.id,
      activeWordIndex: layer.activeWordIndex,
    })),
  };
}
