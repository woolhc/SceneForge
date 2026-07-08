import type { Clip, Project } from "../types";

export type EngineState = {
  currentTime: number;
  playing: boolean;
  activeSubtitle: string | null;
  activeSubtitleStyle?: {
    fontSize: number;
    color: string;
    strokeColor: string;
    position: string;
    fontFamily: string;
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    karaoke?: boolean;
    highlightColor?: string;
  } | null;
  activeSubtitleClip: Clip | null;
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
