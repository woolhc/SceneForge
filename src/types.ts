// ============================================================================
// 应用基础信息 / 设置 / FFmpeg
// ============================================================================

export type AppInfo = {
  appDataDir: string;
  cacheDir: string;
  databasePath: string;
};

export type FfmpegStatus = {
  available: boolean;
  version?: string | null;
  path?: string | null;
  error?: string | null;
};

export type AppSettings = {
  deepseekApiKey: string;
  pexelsApiKey: string;
  ttsBaseUrl: string;
  defaultRatio: string;
  defaultVoiceId?: string | null;
  renderPreset: string;
  whisperBin?: string;
  whisperModel?: string;
};

// ============================================================================
// 音色
// ============================================================================

export type VoiceProfile = {
  id: string;
  name: string;
  samplePath?: string | null;
  referenceText?: string | null;
  language: string;
  providerVoiceId?: string | null;
  createdAt: string;
};

export type VoicePreviewResult = {
  voiceId: string;
  audioPath: string;
  duration: number;
};

// ============================================================================
// 核心数据模型：剪映式的 Track + Clip 多轨道结构
// ============================================================================

export type TrackKind = "video" | "image" | "voiceover" | "audio" | "subtitle";

export type MediaSource = {
  id: string;
  /** "video" | "audio" */
  kind: string;
  title: string;
  /** 远程下载地址（Pexels） */
  url?: string | null;
  /** 本地缓存路径（asset 协议播放用） */
  localPath?: string | null;
  thumbnailUrl?: string | null;
  width: number;
  height: number;
  duration: number;
  /** "pexels" | "local" | "tts" */
  source: string;
};

export type SubtitleStyle = {
  fontSize: number;
  color: string;
  strokeColor: string;
  /** "bottom" | "center" | "top" | "custom" */
  position: string;
  fontFamily: string;
  /** 自由位置 X（0-100 百分比，50=居中） */
  x: number;
  /** 自由位置 Y（0-100 百分比，80=底部偏下） */
  y: number;
  /** 水平缩放（百分比，100=正常） */
  scaleX: number;
  /** 垂直缩放（百分比，100=正常） */
  scaleY: number;
  /** 旋转角度（度） */
  rotation: number;
  /** 是否启用逐字高亮（卡拉OK效果） */
  karaoke?: boolean;
  /** 逐字高亮颜色（已播到的字色） */
  highlightColor?: string;
};

/** 单个词/字符的时间戳（用于逐字高亮） */
export type WordCue = {
  start: number;
  end: number;
  text: string;
};

export type ClipCrop = {
  /** 左上角 X，0-100（源帧百分比） */
  x: number;
  /** 左上角 Y，0-100 */
  y: number;
  /** 宽度，0-100（100=全宽） */
  width: number;
  /** 高度，0-100（100=全高） */
  height: number;
  /** 锁定比例 */
  ratio: string;
};

export const DEFAULT_CROP: ClipCrop = { x: 0, y: 0, width: 100, height: 100, ratio: "free" };

export type ClipTransform = {
  /** 水平位置，0-100（百分比，50=居中） */
  x: number;
  /** 垂直位置，0-100（百分比，50=居中） */
  y: number;
  /** 缩放，0-100（百分比，100=原始大小） */
  scale: number;
  /** 不透明度，0-100 */
  opacity: number;
  /** 圆角半径（像素），0=直角 */
  cornerRadius: number;
  /** 混合模式："normal" | "overlay" | "screen" | "multiply" 等 */
  mix: string;
};

export type Clip = {
  id: string;
  trackId: string;
  /** 引用 MediaSource.id；字幕 clip 可为 null */
  sourceId?: string | null;
  /** 在时间线上的起始位置（秒） */
  startOnTrack: number;
  /** 片段在时间线上的时长（秒） */
  duration: number;
  /** 源媒体的入点（秒） */
  sourceIn: number;
  /** 源媒体的出点（秒） */
  sourceOut: number;
  speed: number;
  volume: number;
  /** 音频淡入时长（秒） */
  fadeIn: number;
  /** 音频淡出时长（秒） */
  fadeOut: number;
  /** 滤镜名称 */
  filter?: string | null;
  /** 色彩调节：亮度 -100~100 */
  brightness: number;
  /** 色彩调节：对比度 -100~100 */
  contrast: number;
  /** 色彩调节：饱和度 -100~100 */
  saturation: number;
  /** 画面变换（视频 clip 用，画中画） */
  transform?: ClipTransform | null;
  /** 画面搜索词（视频 clip 用，AI 生成的英文 Pexels 关键词） */
  visualQuery?: string | null;
  /** 画面裁剪（源帧百分比） */
  crop?: ClipCrop | null;
  /** 字幕文案（字幕 clip 用） */
  text?: string | null;
  subtitleStyle?: SubtitleStyle | null;
  /** 字幕逐词时间戳（用于逐字高亮；null/空表示无词级数据） */
  words?: WordCue[] | null;
  /** 入场转场 */
  transitionIn?: string | null;
  /** 出场转场 */
  transitionOut?: string | null;
};

export type Track = {
  id: string;
  kind: TrackKind;
  name: string;
  order: number;
  muted: boolean;
  locked: boolean;
};

export type RenderConfig = {
  fps: number;
  /** "preview-fast" | "export-high" */
  preset: string;
  /** 导出分辨率：480p/720p/1080p/4k */
  resolution: string;
  /** 导出码率（Mbps），0 = 默认 */
  bitrateMbps: number;
  /** T4.10: 视频编码格式：h264 | hevc */
  codec?: "h264" | "hevc";
  /** T4.10: 导出模式：video（默认）| audio-only（仅音频 mp3） */
  exportMode?: "video" | "audio-only";
};

export type Project = {
  id: string;
  title: string;
  script: string;
  /** "9:16" | "16:9" | "1:1" */
  ratio: string;
  fps: number;
  media: MediaSource[];
  tracks: Track[];
  clips: Clip[];
  renderConfig: RenderConfig;
  previewPath?: string | null;
  finalPath?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSummary = {
  id: string;
  title: string;
  ratio: string;
  clipCount: number;
  updatedAt: string;
};

// ============================================================================
// 命令请求 / 结果类型
// ============================================================================

export type RenderResult = {
  previewPath: string;
  command: string;
};

/** DeepSeek 单段输出（纯文案描述，由前端编排成轨道） */
export type AiSegment = {
  title: string;
  text: string;
  visualQuery: string;
  /** 中文画面关键词（展示用） */
  visualQueryZh?: string;
  mood: string;
  estimatedDuration: number;
  /** 素材策略："auto_search" | "manual" | "color_card" */
  materialStrategy?: string;
  /** 真实起始时间（秒）。音频模式下由 whisper 提供，文案模式为 0 */
  start?: number;
  /** 真实结束时间（秒）。音频模式下由 whisper 提供 */
  end?: number;
};

export type SegmentScriptResult = {
  segments: AiSegment[];
  rawSegmentCount: number;
};

/** 带时间戳的句子（音频模式用） */
export type TimedSentence = {
  start: number;
  end: number;
  text: string;
};

/** 音频模式：whisper 识别返回的句子级结果 */
export type TimedSentencesResult = {
  sentences: TimedSentence[];
  totalDuration: number;
  fullText: string;
};

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontSize: 48,
  color: "#FFFFFF",
  strokeColor: "#000000",
  position: "bottom",
  fontFamily: "Noto Sans SC",
  x: 50,
  y: 80,
  scaleX: 100,
  scaleY: 100,
  rotation: 0,
  karaoke: true,
  highlightColor: "#FFD700",
};

export const DEFAULT_TRANSFORM: ClipTransform = {
  x: 50,
  y: 50,
  scale: 100,
  opacity: 100,
  cornerRadius: 0,
  mix: "normal",
};

export const DEFAULT_RENDER_CONFIG: RenderConfig = {
  fps: 30,
  preset: "preview-fast",
  resolution: "1080p",
  bitrateMbps: 0,
  codec: "h264",
  exportMode: "video",
};
