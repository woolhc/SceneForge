import { useCallback, useEffect, useRef, useState } from "react";
import { PreviewEngine, type EngineState } from "./PreviewEngine";
import { desktopApi } from "../tauri";
import type { Project } from "../types";

export function usePreviewEngine(
  videoARef: React.RefObject<HTMLVideoElement | null>,
  videoBRef: React.RefObject<HTMLVideoElement | null>,
  active: boolean = true,
) {
  const engineRef = useRef<PreviewEngine | null>(null);
  const [engineState, setEngineState] = useState<EngineState>({
    currentTime: 0,
    playing: false,
    activeSubtitle: null,
    activeSubtitleStyle: null,
    activeVideoClip: null,
    activeOverlayClips: [],
  });

  // active 变为 true 时（从首页进入编辑器），轮询等 video ref 就绪
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    function tryInit() {
      if (disposed || engineRef.current) return;
      if (!videoARef.current || !videoBRef.current) return;
      const engine = new PreviewEngine(videoARef.current, videoBRef.current, setEngineState);
      engine.resolveLocal = (localPath: string) =>
        desktopApi.mediaSrc(localPath) ?? localPath;
      engineRef.current = engine;
    }
    tryInit();
    const timer = setInterval(tryInit, 100);
    const stop = setTimeout(() => clearInterval(timer), 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [active]);

  const syncProject = useCallback(async (project: Project | null) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setProject(project);
    if (project) {
      await engine.preloadAudioBuffers((media) =>
        media.localPath ? desktopApi.mediaSrc(media.localPath) : media.url ?? null,
      );
    }
  }, []);

  const play = useCallback(() => {
    void engineRef.current?.play();
  }, []);

  const pause = useCallback(() => {
    engineRef.current?.pause();
  }, []);

  const seek = useCallback((time: number) => {
    engineRef.current?.seek(time);
  }, []);

  const togglePlay = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.isPlaying()) engine.pause();
    else void engine.play();
  }, []);

  return {
    engineState,
    syncProject,
    play,
    pause,
    seek,
    togglePlay,
  };
}
