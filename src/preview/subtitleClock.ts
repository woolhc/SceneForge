import type { Clip } from "../types";

export const SUBTITLE_PREVIEW_CLOCK_FPS = 20;

export function subtitleNeedsLiveClock(clip: Clip) {
  const style = clip.subtitleStyle;
  const karaoke = (style?.karaoke ?? true) && (clip.words?.length ?? 0) > 0;
  const outro = Boolean(style?.animationOut && style.animationOut !== "none");
  return karaoke || outro;
}

export function quantizeSubtitleClock(time: number, fps = SUBTITLE_PREVIEW_CLOCK_FPS) {
  if (!Number.isFinite(time) || fps <= 0) return 0;
  return Math.floor(Math.max(0, time) * fps) / fps;
}
