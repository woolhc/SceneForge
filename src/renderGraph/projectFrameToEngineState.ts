import type { EngineState } from "../preview/PreviewRenderer";
import type { EvaluatedFrame } from "./types";

export function projectFrameToEngineState(
  frame: EvaluatedFrame,
): Pick<EngineState, "activeVideoClip" | "activeOverlayClips" | "activeSubtitleClips"> {
  return {
    activeVideoClip: frame.visualLayers[0]?.clip ?? null,
    activeOverlayClips: frame.visualLayers.slice(1).map((layer) => layer.clip),
    activeSubtitleClips: frame.subtitleLayers.slice().reverse().map((layer) => layer.clip),
  };
}
