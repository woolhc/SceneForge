import type { Clip, Project } from "../types";

export type EngineState = {
  currentTime: number;
  playing: boolean;
  /** 当前时间所有活跃字幕 clip（按 track order 升序：order 小=画面上层=数组前） */
  activeSubtitleClips: Clip[];
  activeVideoClip: Clip | null;
  activeOverlayClips: Clip[];
};

export interface PreviewRenderer {
  resolveLocal: (localPath: string) => string;
  onActiveVideoChange?: ((el: HTMLVideoElement | HTMLImageElement) => void) | null;

  setProject(project: Project | null): void;
  setOverlayContainer(container: HTMLElement | null): void;
  preloadAudioBuffers(resolveSrc: (media: Project["media"][number]) => string | null): Promise<void>;
  play(): void | Promise<void>;
  pause(): void;
  seek(time: number): void;
  isPlaying(): boolean;
  getCurrentTime(): number;
  getDuration(): number;
  setClipVolume(clipId: string, volume: number): void;
  dispose(): void;
}
