// ============================================================================
// 应用基础信息 / 设置 / FFmpeg
// ============================================================================

export type AppInfo = {
  appDataDir: string;
  cacheDir: string;
  modelsDir: string;
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
  fishAudioApiKey?: string;
  fishAudioModel?: string;
  fishAudioReferenceId?: string;
  fishAudioFormat?: string;
  fishAudioSampleRate?: number;
  defaultRatio: string;
  defaultVoiceId?: string | null;
  renderPreset: string;
  whisperBin?: string;
  whisperModel?: string;
};

export type WhisperModelDescriptor = {
  id: string;
  name: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  description: string;
  recommended: boolean;
};

export type WhisperModelStatus = {
  model: WhisperModelDescriptor;
  available: boolean;
  resolvedPath?: string | null;
  configuredPath?: string | null;
  selectedModelId?: string | null;
  downloadedBytes: number;
  totalBytes: number;
  partialDownload: boolean;
  downloading: boolean;
  modelsDir: string;
  whisperAvailable: boolean;
  whisperPath: string;
};

export type WhisperModelDownloadProgress = {
  modelId: string;
  downloadedBytes: number;
  totalBytes: number;
  progress: number;
  message: string;
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

export type GenerateNarrationResult = {
  audioPath: string;
  duration: number;
  sourceId: string;
};

// ============================================================================
// 核心数据模型：剪映式的 Track + Clip 多轨道结构
// ============================================================================

export type TrackKind = "video" | "image" | "voiceover" | "audio" | "subtitle";

export type MediaSource = {
  id: string;
  // M7: union type 代替裸 string
  kind: "video" | "audio" | "image";
  title: string;
  /** 远程下载地址（Pexels） */
  url?: string | null;
  /** 本地缓存路径（asset 协议播放用） */
  localPath?: string | null;
  /** 低清代理路径：预览优先用，导出仍用 localPath/url 原片 */
  proxyPath?: string | null;
  proxyStatus?: "none" | "ready" | "failed" | null;
  proxyWidth?: number | null;
  proxyHeight?: number | null;
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
  /** 描边粗细（像素，0=无描边） */
  strokeWidth?: number;
  /** 背景色（CSS color string，"none"=透明） */
  backgroundColor?: string;
  /** 背景内边距（像素） */
  backgroundPadding?: number;
  /** 阴影颜色 */
  shadowColor?: string;
  /** 阴影模糊（像素，0=无阴影） */
  shadowBlur?: number;
  /** 字间距（像素，0=正常） */
  letterSpacing?: number;
  /** 行高（倍数，1.0=正常） */
  lineHeight?: number;
  // M7: union type 代替裸 string
  position: "bottom" | "center" | "top" | "custom";
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
  /** T4.8: 入场动画：none | fadeIn | slideUp | scaleIn */
  animationIn?: string;
  /** T4.8: 出场动画：none | fadeOut | slideDown | scaleOut */
  animationOut?: string;
  /** T4.8: 动画时长（秒，默认 0.3） */
  animationDuration?: number;
};

/** 单个词/字符的时间戳（用于逐字高亮） */
export type WordCue = {
  start: number;
  end: number;
  text: string;
  /** whisper 词级置信度（0-1）。未提供时为 undefined */
  confidence?: number;
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
  /** T4.2: 旋转角度（度，0=不旋转） */
  rotation?: number;
};

/** T4.2: 关键帧 */
export type Keyframe = {
  /** 相对 clip 起点的秒数 */
  time: number;
  value: number;
  easing: "linear" | "easeIn" | "easeOut" | "easeInOut";
};

/** T4.2: clip 的关键帧集合（每个属性一组按 time 排序的关键帧） */
export type ClipKeyframes = {
  x?: Keyframe[];
  y?: Keyframe[];
  scale?: Keyframe[];
  opacity?: Keyframe[];
  rotation?: Keyframe[];
  volume?: Keyframe[];
};

/** T4.3: 曲线变速控制点 */
export type SpeedPoint = {
  /** 源素材归一化位置 0-1 */
  time: number;
  /** 该点倍速 */
  speed: number;
};

/** T4.4: 蒙版 */
export type ClipMask = {
  kind: "linear" | "mirror" | "circle" | "rect";
  /** 中心，0-1 归一化 */
  cx: number;
  cy: number;
  /** 宽高，0-1 */
  width: number;
  height: number;
  rotation: number;
  /** 羽化 0-1 */
  feather: number;
  invert: boolean;
};

/** 视觉特效项（剪映式"特效"面板） */
export type ClipVisualEffect = {
  /** 特效类型：vignette | flicker | shake | glow | mirror | invert | grayscale */
  kind: string;
  /** 强度 0-100 */
  intensity: number;
};

export type TransitionConfig = {
  name: string;
  duration: number;
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
  /** T4.3: 曲线变速控制点。time 为源素材归一化位置 0-1，speed 为该点倍速。
   *  为空/undefined 时用常量 speed。预设曲线（蒙太奇/英雄时刻/子弹时间）存为常量模板。 */
  speedCurve?: SpeedPoint[] | null;
  volume: number;
  /** 音频淡入时长（秒） */
  fadeIn: number;
  /** 音频淡出时长（秒） */
  fadeOut: number;
  /** 音频降噪强度 0-100（0=关闭；映射到 afftdn nr 0-25dB） */
  noiseReduction?: number;
  /** 滤镜名称 */
  filter?: string | null;
  /** 色彩调节：亮度 -100~100 */
  brightness: number;
  /** 色彩调节：对比度 -100~100 */
  contrast: number;
  /** 色彩调节：饱和度 -100~100 */
  saturation: number;
  /** 色温 -100~100（负=冷蓝，正=暖红） */
  temperature?: number;
  /** 色调 -100~100（负=绿，正=品红） */
  tint?: number;
  /** 画面变换（视频 clip 用，画中画） */
  transform?: ClipTransform | null;
  /** T4.2: 关键帧动画（位置/缩放/不透明度/旋转/音量） */
  keyframes?: ClipKeyframes | null;
  /** T4.4: 蒙版 */
  mask?: ClipMask | null;
  /** 是否倒放；兼容旧项目中仅通过负 speed 表示倒放的写法 */
  reverse?: boolean;
  /** 画面搜索词（视频 clip 用，AI 生成的英文 Pexels 关键词） */
  visualQuery?: string | null;
  /** 视觉特效列表（剪映式"特效"面板） */
  visualEffects?: ClipVisualEffect[] | null;
  /** 画面裁剪（源帧百分比） */
  crop?: ClipCrop | null;
  /** 字幕文案（字幕 clip 用） */
  text?: string | null;
  subtitleStyle?: SubtitleStyle | null;
  /** 字幕逐词时间戳（用于逐字高亮；null/空表示无词级数据） */
  words?: WordCue[] | null;
  /** 双语字幕配对 ID；原文轨和译文轨通过该字段关联。 */
  subtitleGroupId?: string | null;
  /** 字幕在双语组中的角色。 */
  subtitleRole?: "source" | "target" | null;
  /** 字幕语言标识，例如 en、zh-CN。 */
  subtitleLanguage?: string | null;
  /** 入场转场 */
  transitionIn?: string | TransitionConfig | null;
  /** 出场转场 */
  transitionOut?: string | TransitionConfig | null;
};

export type Track = {
  id: string;
  kind: TrackKind;
  name: string;
  order: number;
  muted: boolean;
  locked: boolean;
  /** 是否隐藏（不参与预览/导出） */
  hidden?: boolean;
  /** 轨道高度（像素，0=默认） */
  height?: number;
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
  /** T4.5: 默认转场时长（秒） */
  transitionDuration?: number;
  /** 字幕处理：burn 烧录到画面（默认）| none 不包含 */
  subtitleMode?: "burn" | "srt" | "none";
  /** 阶段 E: 是否启用硬件编码器（videotoolbox/nvenc/qsv），默认 true */
  hwaccel?: boolean;
  /** 阶段 E: 自定义 CRF（0-51，越小质量越高），undefined = 用 preview 默认 */
  crf?: number;
  /** 阶段 E: 自定义编码器预设（ultrafast/superfast/veryfast/fast/medium/slow），undefined = 用 preview 默认 */
  encoderPreset?: string;
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
  /** 章节标记（剪映式） */
  chapters?: Chapter[];
  /** 封面时间点（秒） */
  coverTime?: number | null;
  previewPath?: string | null;
  finalPath?: string | null;
  createdAt: string;
  updatedAt: string;
};

/** 章节（剪映式章节标记） */
export type Chapter = {
  id: string;
  /** 章节起点（秒） */
  time: number;
  title: string;
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
  /** 单次 Whisper 产出的词级时间戳，字幕直接复用。 */
  words?: WordCue[];
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
  strokeWidth: 2,
  backgroundColor: "none",
  backgroundPadding: 4,
  shadowColor: "#000000",
  shadowBlur: 0,
  letterSpacing: 0,
  lineHeight: 1.2,
  position: "bottom",
  fontFamily: "Noto Sans SC",
  x: 50,
  y: 80,
  scaleX: 100,
  scaleY: 100,
  rotation: 0,
  karaoke: true,
  highlightColor: "#FFD700",
  animationIn: "none",
  animationOut: "none",
  animationDuration: 0.3,
};

/** 根据项目比例和导出分辨率计算视频实际宽度（像素）。
 *  前端预览用此值与 stage 宽度计算字号缩放比例，保证预览字号视觉与导出一致。 */
export function videoWidthForProject(ratio: string, resolution: string): number {
  const shortEdge =
    resolution === "4k" || resolution === "2160p" ? 2160
    : resolution === "720p" ? 720
    : resolution === "480p" ? 480
    : 1080;
  return ratio === "16:9" ? Math.round((shortEdge * 16) / 9) : shortEdge;
}

export const DEFAULT_TRANSFORM: ClipTransform = {
  x: 50,
  y: 50,
  scale: 100,
  opacity: 100,
  cornerRadius: 0,
  mix: "normal",
  rotation: 0,
};

export const DEFAULT_RENDER_CONFIG: RenderConfig = {
  fps: 30,
  preset: "preview-fast",
  resolution: "1080p",
  bitrateMbps: 0,
  codec: "h264",
  exportMode: "video",
  transitionDuration: 0.5,
  hwaccel: true,
};

export type SubtitleProtectedRange = {
  startWordIndex: number;
  endWordIndex: number;
};

export type SubtitleBreakWordTiming = {
  text: string;
  start: number;
  end: number;
  gapAfter: number;
};

export type SubtitleBreakConstraints = {
  ratio: "9:16" | "16:9" | "1:1";
  maxLines: number;
  preferredCharsPerLine: number;
  maxCharsPerCue: number;
  minDuration: number;
  preferredDuration: number;
  maxDuration: number;
  preferredCps: number;
  maxCps: number;
};

export type SubtitleBreakAdviceResult = {
  preferredBreakAfterIndices: number[];
  protectedRanges: SubtitleProtectedRange[];
  confidence: number;
};

export type SubtitleGenerationMode = "precise" | "natural" | "short_form";

export type SubtitleLanguageTerm = {
  source: string;
  target?: string | null;
  note?: string | null;
};

export type SubtitleLanguageContext = {
  summary: string;
  contentType: string;
  tone: string;
  terms: SubtitleLanguageTerm[];
};
