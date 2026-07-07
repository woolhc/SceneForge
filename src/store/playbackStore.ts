import { create } from "zustand";
import type { Clip } from "../types";

/**
 * 播放状态 store（T2.1 性能优化核心）。
 *
 * 问题背景：原先 usePreviewEngine 每帧（60fps）调用 setEngineState，
 * 该 state 位于 App 顶层 → 播放时整棵组件树 60fps 全量重渲染。
 *
 * 解决：把高频更新的播放状态移到 zustand store，
 * 引擎 tick 用 getState().setXxx() 写入（不经过 React setState），
 * 只有真正订阅了这些值的组件（播放头、时间码、字幕）才会重渲染。
 *
 * 字段分两类：
 * - 高频（每帧）：currentTime
 * - 中频（clip 切换时）：playing, activeVideoClip, activeOverlayClips, activeSubtitle*
 */
export type SubtitleStyleLite = {
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
  animationIn?: string;
  animationOut?: string;
  animationDuration?: number;
};

export interface PlaybackState {
  /** 当前播放头时间（秒，时间线坐标）—— 高频每帧更新 */
  currentTime: number;
  /** 是否正在播放 */
  playing: boolean;
  /** 当前活跃主视频 clip（播放头所在） */
  activeVideoClip: Clip | null;
  /** 画中画叠加层（除底层外的活跃视频 clip） */
  activeOverlayClips: Clip[];
  /** 当前活跃字幕文本 */
  activeSubtitle: string | null;
  /** 当前活跃字幕样式 */
  activeSubtitleStyle: SubtitleStyleLite | null;
  /** 当前活跃字幕 clip（含 words，用于逐字高亮） */
  activeSubtitleClip: Clip | null;

  // actions
  setCurrentTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setActiveVideoClip: (c: Clip | null) => void;
  setActiveOverlayClips: (c: Clip[]) => void;
  setActiveSubtitle: (s: string | null) => void;
  setActiveSubtitleStyle: (s: SubtitleStyleLite | null) => void;
  setActiveSubtitleClip: (c: Clip | null) => void;
  /** 批量更新（引擎 tick 一次性写入所有字段，减少订阅通知） */
  tick: (patch: Partial<Omit<PlaybackState, "setCurrentTime" | "setPlaying" | "setActiveVideoClip" | "setActiveOverlayClips" | "setActiveSubtitle" | "setActiveSubtitleStyle" | "setActiveSubtitleClip" | "tick">>) => void;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  currentTime: 0,
  playing: false,
  activeVideoClip: null,
  activeOverlayClips: [],
  activeSubtitle: null,
  activeSubtitleStyle: null,
  activeSubtitleClip: null,

  setCurrentTime: (currentTime) => set({ currentTime }),
  setPlaying: (playing) => set({ playing }),
  setActiveVideoClip: (activeVideoClip) => set({ activeVideoClip }),
  setActiveOverlayClips: (activeOverlayClips) => set({ activeOverlayClips }),
  setActiveSubtitle: (activeSubtitle) => set({ activeSubtitle }),
  setActiveSubtitleStyle: (activeSubtitleStyle) => set({ activeSubtitleStyle }),
  setActiveSubtitleClip: (activeSubtitleClip) => set({ activeSubtitleClip }),
  tick: (patch) => set(patch),
}));
