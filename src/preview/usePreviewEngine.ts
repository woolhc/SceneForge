import { useCallback, useEffect, useRef } from "react";
import { PreviewEngine } from "./PreviewEngine";
import type { EngineState, PreviewRenderer } from "./PreviewRenderer";
import { WebCodecsRenderer, canUseWebCodecsRenderer } from "./WebCodecsRenderer";
import { desktopApi } from "../tauri";
import type { Project } from "../types";
import { usePlaybackStore } from "../store/playbackStore";

export function usePreviewEngine(
  stageRef: React.RefObject<HTMLElement | null>,
  active: boolean = true,
) {
 const engineRef = useRef<PreviewRenderer | null>(null);
 // 缓存最新的 project，引擎创建后立即同步
 const pendingProjectRef = useRef<Project | null>(null);
  /** 缓存双缓冲切换回调，引擎创建后应用 */
  const pendingActiveVideoCbRef = useRef<((el: HTMLVideoElement | HTMLImageElement) => void) | null>(null);

  // T2.1: 引擎 tick 直接写入 zustand store（不经过 React setState），
  // 只有订阅了对应字段的组件才会重渲染，避免整棵树 60fps 全量更新
  const onTick = useCallback((state: EngineState) => {
    usePlaybackStore.getState().tick({
      currentTime: state.currentTime,
      playing: state.playing,
      activeVideoClip: state.activeVideoClip,
      activeOverlayClips: state.activeOverlayClips,
      activeSubtitle: state.activeSubtitle,
      activeSubtitleStyle: state.activeSubtitleStyle,
      activeSubtitleClip: state.activeSubtitleClip,
    });
  }, []);

  // active 变化时创建/销毁引擎
  useEffect(() => {
    if (!active) {
      // 离开编辑器时销毁引擎，释放绑定的 video 元素
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }
      // 重置 store（避免残留状态）
      usePlaybackStore.getState().tick({
        currentTime: 0,
        playing: false,
        activeVideoClip: null,
        activeOverlayClips: [],
        activeSubtitle: null,
        activeSubtitleStyle: null,
        activeSubtitleClip: null,
      });
      return;
    }

    let disposed = false;

    function tryInit() {
      if (disposed || engineRef.current) return;
      if (!stageRef.current) return;
     const engine: PreviewRenderer = canUseWebCodecsRenderer()
       ? new WebCodecsRenderer(stageRef.current, onTick)
       : new PreviewEngine(stageRef.current, onTick);
      engine.resolveLocal = (localPath: string) =>
        desktopApi.mediaSrc(localPath) ?? localPath;
      // 应用缓存的双缓冲切换回调
      if (pendingActiveVideoCbRef.current) {
        engine.onActiveVideoChange = pendingActiveVideoCbRef.current;
      }
      engineRef.current = engine;
      // 创建后立即同步缓存的 project（修复首次 syncProject 丢失的 race）
      if (pendingProjectRef.current) {
        engine.setProject(pendingProjectRef.current);
      }
    }

    tryInit();
    const timer = setInterval(tryInit, 100);
    const stop = setTimeout(() => clearInterval(timer), 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [active, onTick, stageRef]);

  const syncProject = useCallback(async (project: Project | null) => {
    // 缓存 project，供引擎创建后同步
    pendingProjectRef.current = project;
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

  const setClipVolume = useCallback((clipId: string, volume: number) => {
    engineRef.current?.setClipVolume(clipId, volume);
  }, []);

 /** T4.1: 设置画中画叠加层容器（传给引擎，引擎在里面管理 overlay video DOM） */
 const setOverlayContainer = useCallback((container: HTMLElement | null) => {
   engineRef.current?.setOverlayContainer(container);
 }, []);

  /** 注册双缓冲切换回调（活跃 video 变化时通知，FilterRenderer 需更新读取的 video） */
  const setActiveVideoChangeCallback = useCallback(
    (cb: ((el: HTMLVideoElement | HTMLImageElement) => void) | null) => {
      pendingActiveVideoCbRef.current = cb;
      if (engineRef.current) engineRef.current.onActiveVideoChange = cb;
    },
    [],
  );

  return {
    syncProject,
    play,
    pause,
    seek,
    togglePlay,
    setClipVolume,
    setOverlayContainer,
    setActiveVideoChangeCallback,
  };
}
