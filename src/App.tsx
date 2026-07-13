import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crop as CropIcon,
  Bookmark,
  ImagePlay,
  Loader2,
  Mic2,
  Pause,
  Play,
  Plus,
  Scissors,
  Search,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Volume2,
  XCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import pLimit from "p-limit";
import { desktopApi } from "./tauri";
import type {
  AppInfo,
  AppSettings,
  Chapter,
  Clip,
  ClipKeyframes,
  ClipTransform,
  FfmpegStatus,
  MediaSource,
  Project,
  ProjectSummary,
  SubtitleStyle,
  SubtitleGenerationMode,
  SubtitleLanguageContext,
  Track,
  TrackKind,
  TimedSentencesResult,
  VoiceProfile,
  WhisperModelDownloadProgress,
  WhisperModelStatus,
} from "./types";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_TRANSFORM, DEFAULT_CROP, videoWidthForProject } from "./types";
import type { AiSegment } from "./types";
import { FONT_OPTIONS } from "./fonts";
import { SubtitleOverlay } from "./preview/SubtitleOverlay";
import { quantizeSubtitleClock, subtitleNeedsLiveClock } from "./preview/subtitleClock";
import { ContextMenu } from "./timeline/ContextMenu";
import { ExportDialog } from "./panels/ExportDialog";
import { HomeScreen } from "./panels/HomeScreen";
import { GenerateWizard } from "./panels/GenerateWizard";
import { EdlPreview } from "./panels/EdlPreview";
import { FilterRenderer } from "./preview/FilterRenderer";
import { getLutData } from "./luts";
import { usePreviewEngine } from "./preview/usePreviewEngine";
import { useProxyBackfill } from "./preview/useProxyBackfill";
import { usePlaybackStore } from "./store/playbackStore";
import { useExportAction } from "./store/exportAction";
import { usePipelineStore } from "./store/pipelineStore";
import { useProjectHistory } from "./store/projectHistory";
import { useProjectStore } from "./store/projectStore";
import { useUiStore } from "./store/uiStore";
import { parsePipelineError } from "./tauri";
import { SPEED_PRESETS } from "./editor/speedCurve";
import { SpeedCurveEditor } from "./components/SpeedCurveEditor";
import { ToastContainer } from "./components/Toast";
import {
  TRACK_KIND_LABELS,
  deleteTrack,
  moveTrack,
  nextTrackName,
  toggleTrackHidden,
  toggleTrackLocked,
  toggleTrackMuted,
} from "./editor/timelineActions";
import { runGeneratePipeline, type GeneratePipelineInput } from "./editor/pipeline";
import { selectAssetCandidate, type AssetSelectionResult } from "./editor/assetSelection";
import { buildTranscriptSubtitleProject, prepareTranscriptSubtitles } from "./editor/subtitleFromTranscript";
import { requestSubtitleSemanticAdvice } from "./editor/subtitles/semanticAdvice";
import { saveSubtitleArtifact } from "./editor/subtitles/artifacts";
import { subtitleLayoutProfile } from "./editor/subtitles/profiles";
import {
  buildGenerationReport,
  createGenerationSession,
  recordGenerationError,
  saveGenerationSession,
  updateGenerationSession,
  type GenerationSession,
} from "./editor/generationSession";
import { makeTransition, transitionDuration, transitionName } from "./editor/transitions";
import { projectOutputDuration } from "./editor/projectDuration";
import {
  applySpeedCurvePreset as buildSpeedCurvePresetChange,
  changeClipSpeed as buildClipSpeedChange,
  deleteClip as buildDeleteClipChange,
  deleteClips as buildDeleteClipsChange,
  duplicateClip as buildDuplicateClipChange,
  pasteClipAtTrackEnd,
  selectClipIds,
  selectClipIdsByBox,
  splitVisualClipAtPlayhead,
  type OperationResult,
} from "./editor/clipOperations";
import {
  addKeyframe,
  findKeyframeAt,
  removeKeyframeAt,
  updateKeyframeEasing,
} from "./editor/keyframes";
import { Ruler } from "./timeline/Ruler";
import { TimelineTrack } from "./timeline/TimelineTrack";
import { shouldStartTimelinePan } from "./timeline/clipInteraction";
import { realignTimeline } from "./timeline/realignTimeline";
import { MediaPanel } from "./panels/MediaPanel";
import { TextPanel } from "./panels/TextPanel";
import { AudioPanel } from "./panels/AudioPanel";
import { TransitionPanel } from "./panels/TransitionPanel";
import { ProjectMenu } from "./panels/ProjectMenu";
import { SubtitlePanel } from "./panels/SubtitlePanel";
import { EffectsPanel } from "./panels/EffectsPanel";
import { ToolRail } from "./editor/ToolRail";
import { ToolPanel } from "./editor/ToolPanel";
import {
  TOOL_TABS,
  inspectorTabForInteraction,
  inspectorTabsForSelection,
  resolveInspectorTab,
} from "./editor/editorLayout";
import { EditorTopbar } from "./editor/EditorTopbar";
import { InspectorPanel } from "./editor/InspectorPanel";
import { TimelineToolbar } from "./editor/TimelineToolbar";
import { PreviewWorkspace } from "./editor/PreviewWorkspace";
import { EditorWorkspace } from "./editor/EditorWorkspace";
import { AudioInspector } from "./editor/inspector/AudioInspector";
import { KeyframeInspector } from "./editor/inspector/KeyframeInspector";
import { VisualEffectsInspector } from "./editor/inspector/VisualEffectsInspector";
import { ColorInspector } from "./editor/inspector/ColorInspector";
import { VisualTransformInspector } from "./editor/inspector/VisualTransformInspector";
import { SubtitleInspector } from "./editor/inspector/SubtitleInspector";
import { UnifiedSettingsDialog } from "./components/UnifiedSettingsDialog";
import { WhisperSetupDialog } from "./components/WhisperSetupDialog";
import {
  createPendingWhisperAction,
  hasWhisperModel,
  shouldGateWhisperAction,
  type PendingWhisperAction,
} from "./editor/readiness";
// PanelTitle 已不再直接使用（各 Tab 自带标题）；TimelineTrack/Track 类型保留供时间线渲染

const ratios = ["9:16", "16:9", "1:1"];
const isDevelopmentPreview = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;

const recommendedWhisperModelId = "medium-q5";

/** 时间码格式化：秒 → MM:SS.frame（剪映式） */
function formatTC(seconds: number, fps = 30): string {
  const totalFrames = Math.round(seconds * fps);
  const frame = totalFrames % fps;
  const totalSec = Math.floor(totalFrames / fps);
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(frame).padStart(2, "0")}`;
}

function PlayPauseButton({ onToggle }: { onToggle: () => void }) {
  const playing = usePlaybackStore((s) => s.playing);
  return (
    <button className="round-button" title={playing ? "暂停" : "播放"} onClick={onToggle}>
      {playing ? <Pause size={18} /> : <Play size={18} />}
    </button>
  );
}

function PreviewProgress({ totalDuration, onSeek }: { totalDuration: number; onSeek: (time: number) => void }) {
  const currentTime = usePlaybackStore((s) => s.currentTime);
  const percent = totalDuration > 0 ? Math.min(100, (currentTime / totalDuration) * 100) : 0;
  return (
    <input
      type="range"
      min={0}
      max={100}
      value={percent}
      onChange={(event) => onSeek((Number(event.target.value) / 100) * totalDuration)}
    />
  );
}

function TimecodeDisplay({ totalDuration, fps }: { totalDuration: number; fps: number }) {
  const currentTime = usePlaybackStore((s) => s.currentTime);
  return (
    <span className="timecode">
      {formatTC(currentTime, fps)} / {formatTC(totalDuration, fps)}
    </span>
  );
}

function PlayheadLine({ totalDuration }: { totalDuration: number }) {
  const currentTime = usePlaybackStore((s) => s.currentTime);
  const percent = totalDuration > 0 ? Math.min(100, (currentTime / totalDuration) * 100) : 0;
  return (
    <div
      className="playhead"
      style={{ left: `calc(44px + (100% - 58px) * ${percent / 100})` }}
    />
  );
}

function StageSubtitleLayer({ excludeClipId, fontScale }: { excludeClipId?: string; fontScale: number }) {
  const subClips = usePlaybackStore((s) => s.activeSubtitleClips);
  // 选中字幕编辑时，由 SubtitleOverlay 渲染该 clip，这里跳过避免重复
  const visible = subClips.filter((c) => c.id !== excludeClipId && c.text && c.text.trim());
  const needsLiveClock = visible.some(subtitleNeedsLiveClock);
  // 静态字幕不订阅逐帧时钟；动态字幕也只以 20fps 更新 React，CSS 动画仍由浏览器流畅执行。
  const currentTime = usePlaybackStore((s) => needsLiveClock ? quantizeSubtitleClock(s.currentTime) : 0);
  if (visible.length === 0) return null;
  return (
    <>
      {visible.map((clip) => (
        <SubtitleItem key={clip.id} clip={clip} currentTime={currentTime} fontScale={fontScale} />
      ))}
    </>
  );
}

/** 单条字幕渲染（StageSubtitleLayer 内部使用）。 */
function SubtitleItem({ clip, currentTime, fontScale }: {
  clip: Clip;
  currentTime: number;
  fontScale: number;
}) {
  const s = clip.subtitleStyle;
  const isCustom = s?.position === "custom";
  const posX = isCustom ? (s?.x ?? 50) : 50;
  // 单字幕按 position 渲染，多字幕轨由用户设置不同 position 避免叠加（与后端 ASS 烧录一致）
  const posY = isCustom
    ? (s?.y ?? 80)
    : (s?.position === "top" ? 12 : s?.position === "center" ? 50 : 88);
  const baseColor = s?.color ?? "#FFFFFF";
  const highlightColor = s?.highlightColor ?? "#FFD700";
  const karaokeOn = (s?.karaoke ?? true) && (clip.words?.length ?? 0) > 0;
  // 出场动画窗口判断：剩余时长 <= animationDuration 时进入出场
  const animDur = s?.animationDuration ?? 0.3;
  const clipEnd = clip.startOnTrack + clip.duration;
  const remaining = clipEnd - currentTime;
  const inOutro = remaining <= animDur && remaining >= 0;
  const animClass = inOutro
    ? (s?.animationOut && s.animationOut !== "none" ? `anim-${s.animationOut}` : "")
    : (s?.animationIn && s.animationIn !== "none" ? `anim-${s.animationIn}` : "");
  // 描边/阴影/背景/字间距/行高
  const strokeWidth = s?.strokeWidth ?? 2;
  const strokeColor = s?.strokeColor ?? "#000";
  const strokeShadow = strokeWidth > 0
    ? `${strokeWidth}px ${strokeWidth}px 0 ${strokeColor}, -${strokeWidth}px -${strokeWidth}px 0 ${strokeColor}, ${strokeWidth}px -${strokeWidth}px 0 ${strokeColor}, -${strokeWidth}px ${strokeWidth}px 0 ${strokeColor}`
    : "none";
  const shadowBlur = s?.shadowBlur ?? 0;
  const shadowColor = s?.shadowColor ?? "#000";
  const shadow = shadowBlur > 0 ? `, 0 ${Math.round(shadowBlur / 3)}px ${shadowBlur}px ${shadowColor}` : "";
  const finalTextShadow = strokeShadow === "none" && shadow ? shadow.slice(2) : (strokeShadow === "none" ? "none" : strokeShadow + shadow);
  const bgColor = s?.backgroundColor ?? "none";
  const bgPadding = s?.backgroundPadding ?? 4;
  const letterSpacing = s?.letterSpacing ?? 0;
  const lineHeight = s?.lineHeight ?? 1.4;
  return (
    <div
      className={`subtitle-overlay-text ${animClass}`}
      style={{
        position: "absolute",
        left: `${posX}%`,
        top: `${posY}%`,
        transform: `translate(-50%, -50%) rotate(${s?.rotation ?? 0}deg) scale(${(s?.scaleX ?? 100) / 100}, ${(s?.scaleY ?? 100) / 100})`,
        transformOrigin: "center",
        fontFamily: s?.fontFamily,
        fontSize: `${Math.max(8, (s?.fontSize ?? 48) * fontScale)}px`,
        fontWeight: 700,
        lineHeight,
        color: baseColor,
        textShadow: finalTextShadow,
        letterSpacing: `${letterSpacing * fontScale}px`,
        background: bgColor === "none" ? "transparent" : bgColor,
        padding: bgColor === "none" ? "4px 10px" : `${bgPadding * fontScale}px ${bgPadding * 2 * fontScale}px`,
        borderRadius: bgColor === "none" ? 0 : 4,
        textAlign: "center",
        whiteSpace: "pre-wrap",
        maxWidth: "86%",
        zIndex: 7,
        pointerEvents: "none",
      }}
    >
      {karaokeOn && clip.words
        ? (() => {
            // 兼容旧项目：text 含 \n 时拆分翻译（无高亮）+ 原文（karaoke 高亮）
            const text = clip.text || "";
            const newlinePos = text.indexOf("\n");
            if (newlinePos >= 0) {
              const translated = text.slice(0, newlinePos);
              return (
                <>
                  {translated}
                  <br />
                  {clip.words.map((w, i, arr) => {
                    const prev = arr[i - 1];
                    const needSpace =
                      i > 0 &&
                      prev &&
                      /[A-Za-z0-9]$/.test(prev.text) &&
                      /^[A-Za-z0-9]/.test(w.text);
                    return (
                      <span key={i} style={{ color: currentTime >= w.start ? highlightColor : baseColor }}>
                        {needSpace ? " " : ""}
                        {w.text}
                      </span>
                    );
                  })}
                </>
              );
            }
            return clip.words.map((w, i, arr) => {
              const prev = arr[i - 1];
              const needSpace =
                i > 0 &&
                prev &&
                /[A-Za-z0-9]$/.test(prev.text) &&
                /^[A-Za-z0-9]/.test(w.text);
              return (
                <span key={i} style={{ color: currentTime >= w.start ? highlightColor : baseColor }}>
                  {needSpace ? " " : ""}
                  {w.text}
                </span>
              );
            });
          })()
        : clip.text || ""}
    </div>
  );
}

// 安装包内置 whisper-cli；模型体积较大，存放在跨平台应用数据目录。
const whisperDefaultBin = typeof navigator !== "undefined"
  && (navigator.platform?.toLowerCase().includes("win") || navigator.userAgent?.toLowerCase().includes("win"))
  ? "whisper-cli.exe"
  : "whisper-cli";
const whisperDefaultModel = "";

function newClipId() {
  return `clip_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function newTrackId(kind: TrackKind) {
  return `track_${kind}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

/** 多轨道支持：取 order 最小（最上层）的指定 kind 轨道 ID。
 *  用于 AI 编排、素材拖放等场景的默认目标轨选择。
 *  单轨时直接返回，多轨时取最上层（用户最可能期望的目标）。 */
function pickPrimaryTrack(
  tracks: { id: string; kind: string; order: number }[],
  kind: TrackKind,
): string | undefined {
  const candidates = tracks.filter((t) => t.kind === kind);
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0].id;
  return [...candidates].sort((a, b) => a.order - b.order)[0].id;
}

function preferredTrackKindForAsset(asset: MediaSource): TrackKind {
  if (asset.kind === "audio") return "audio";
  if (asset.kind === "image") return "image";
  return "video";
}

function assetFitsTrack(asset: MediaSource, track: Track) {
  if (asset.kind === "audio") return track.kind === "audio" || track.kind === "voiceover";
  if (asset.kind === "image") return track.kind === "image" || track.kind === "video";
  return track.kind === "video";
}

function isVisualTrackKind(kind: TrackKind) {
  return kind === "video" || kind === "image";
}

function ensureTrackForAsset(project: Project, asset: MediaSource): { project: Project; track: Track } {
  const kind = preferredTrackKindForAsset(asset);
  // 多轨道支持：取 order 最小（最上层）的匹配轨
  const candidates = project.tracks.filter((track) => track.kind === kind);
  const existing = candidates.length > 0
    ? [...candidates].sort((a, b) => a.order - b.order)[0]
    : undefined;
  if (existing) return { project, track: existing };

  const maxOrder = project.tracks.reduce((max, track) => Math.max(max, track.order), -1);
  const baseVisualOrder = project.tracks
    .filter((track) => track.kind === "video" || track.kind === "image")
    .reduce((max, track) => Math.max(max, track.order), -Infinity);
  const order = kind === "image" && Number.isFinite(baseVisualOrder)
    ? baseVisualOrder - 0.1
    : maxOrder + 1;
  const track: Track = {
    id: newTrackId(kind),
    kind,
    name: nextTrackName(project, kind),
    order,
    muted: false,
    locked: false,
  };
  return { project: { ...project, tracks: [...project.tracks, track] }, track };
}

/**
 * 把 AI 文案片段编排成轨道初始结构。
 * 每个 AiSegment → 视频clip（占位）+ 字幕clip + 配音clip，三者 startOnTrack 对齐。
 * 轨道 ID 按实际项目的 tracks 按 kind 动态查找（支持多轨道，取第一个匹配的）。
 *
 * 时间来源：
 * - 音频模式：seg.start/end 由 whisper 提供（真实音频时间），直接用
 * - 文案模式：seg.start/end 为 0，用 estimatedDuration 累加（cursor）
 */
function arrangeSegmentsToClips(
  segments: { text: string; visualQuery: string; estimatedDuration: number; start?: number; end?: number }[],
  tracks: { id: string; kind: string; order: number }[],
): Clip[] {
  const videoTrackId = pickPrimaryTrack(tracks, "video");
  const voiceoverTrackId = pickPrimaryTrack(tracks, "voiceover");
  const clips: Clip[] = [];
  let cursor = 0;
  // 视频轨游标：音频模式下让视频 clip 首尾相接，填满句子间停顿（字幕仍按真实时间）
  let videoCursor = 0;
  const isAudioMode = segments.some((s) => (s.start ?? 0) !== 0 || (s.end ?? 0) !== 0);
  for (const seg of segments) {
    // 音频模式：用 whisper 真实时间；文案模式：累加 estimatedDuration
    const hasRealTime = (seg.start ?? 0) !== 0 || (seg.end ?? 0) !== 0;
    const start = hasRealTime ? (seg.start ?? cursor) : cursor;
    const duration = hasRealTime ? ((seg.end ?? 0) - (seg.start ?? 0)) : seg.estimatedDuration;
    // 视频轨（占位，sourceId 暂空，等用户绑定素材）
    // 音频模式下首尾相接：startOnTrack = 前一个 clip 的 end，duration 延伸到当前句 end
    if (videoTrackId) {
      const vStart = isAudioMode ? videoCursor : cursor;
      const vDuration = isAudioMode ? ((seg.end ?? (videoCursor + duration)) - videoCursor) : duration;
      clips.push({
        id: newClipId(),
        trackId: videoTrackId,
        sourceId: null,
        startOnTrack: vStart,
        duration: vDuration,
        sourceIn: 0,
        sourceOut: vDuration,
        speed: 1,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
      brightness: 0,
      contrast: 0,
      saturation: 0,
        visualQuery: seg.visualQuery,
        transitionIn: null,
        transitionOut: null,
      });
      videoCursor = vStart + vDuration;
    }
    // 字幕不再自动生成 —— 改由「识别字幕」按钮通过 ASR 语音识别 + AI 整理生成
    // 配音轨（sourceId 暂空，等生成配音后填充）
    if (voiceoverTrackId) {
      clips.push({
        id: newClipId(),
        trackId: voiceoverTrackId,
        sourceId: null,
        startOnTrack: start,
        duration,
        sourceIn: 0,
        sourceOut: duration,
        speed: 1,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
      brightness: 0,
      contrast: 0,
      saturation: 0,
        text: seg.text,
        transitionIn: null,
        transitionOut: null,
      });
    }
    // 文案模式：累加 cursor；音频模式：cursor 跟随真实 end
    cursor = hasRealTime ? (seg.end ?? (cursor + duration)) : cursor + duration;
  }
  return clips;
}

export function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  /** T4.6: 多选 clip id 集合（Ctrl/Cmd+点击加选） */
  const selectedClipIds = useProjectStore((s) => s.selectedClipIds);
  const setSelectedClipIds = useProjectStore((s) => s.setSelectedClipIds);
  const selectedClipId = useMemo(() => selectedClipIds[0] ?? null, [selectedClipIds]);
  function setSelectedClipId(next: string | null | ((previous: string | null) => string | null)) {
    setSelectedClipIds((previousIds) => {
      const previous = previousIds[0] ?? null;
      const resolved = typeof next === "function" ? next(previous) : next;
      return resolved ? [resolved] : [];
    });
  }
  const [settings, setSettings] = useState<AppSettings>({
    deepseekApiKey: "",
    pexelsApiKey: "",
    ttsBaseUrl: "https://ttsttstts.cas-air.cn",
    fishAudioApiKey: "",
    fishAudioModel: "s1",
    fishAudioReferenceId: "",
    fishAudioFormat: "mp3",
    fishAudioSampleRate: 44100,
    defaultRatio: "9:16",
    defaultVoiceId: null,
    renderPreset: "preview-fast",
    whisperBin: whisperDefaultBin,
    whisperModel: whisperDefaultModel,
  });
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(settings);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [whisperModelStatus, setWhisperModelStatus] = useState<WhisperModelStatus | null>(null);
  const [whisperDownloadProgress, setWhisperDownloadProgress] = useState<WhisperModelDownloadProgress | null>(null);
  const [whisperSetupOpen, setWhisperSetupOpen] = useState(false);
  const [whisperSetupError, setWhisperSetupError] = useState<string | null>(null);
  const pendingWhisperActionRef = useRef<PendingWhisperAction<GeneratePipelineInput | { translate: boolean; mode: SubtitleGenerationMode }> | null>(null);
  const pendingWhisperActionId = useRef(0);
  const showSettings = useUiStore((s) => s.showSettings);
  const setShowSettings = useUiStore((s) => s.setShowSettings);
  const [busy, setBusy] = useState<string | null>(null);
  // 时间线缩放：pxPerSecond 驱动（4=超小看全局，1200=帧级细节）
  const [pxPerSecond, setPxPerSecond] = useState(64);
  const [status, setStatus] = useState("准备就绪");
  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfile[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("");
  const [newVoiceName, setNewVoiceName] = useState("Fish 音色");
  const [newVoiceReferenceText, setNewVoiceReferenceText] = useState("");
  const [voicePreviewText, setVoicePreviewText] = useState("这是一段 Fish Audio 试听，用来检查声音是否自然。");
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null);
  const [voiceNameDrafts, setVoiceNameDrafts] = useState<Record<string, string>>({});
  const [voiceReferenceDrafts, setVoiceReferenceDrafts] = useState<Record<string, string>>({});
  const [assetCandidates, setAssetCandidates] = useState<Record<string, MediaSource[]>>({});
  const [assetQueryDraft, setAssetQueryDraft] = useState("");
  const [assetCachingIds, setAssetCachingIds] = useState<Set<string>>(new Set());
  const activeToolTab = useUiStore((s) => s.activeToolTab);
  const setActiveToolTab = useUiStore((s) => s.setActiveToolTab);
  const setInspectorTabForTrack = useUiStore((s) => s.setInspectorTabForTrack);
  const activateInspectorForTrack = useUiStore((s) => s.activateInspectorForTrack);
  const activeInspectorTab = useUiStore((s) => s.activeInspectorTab);
  const editorMode = useUiStore((s) => s.editorMode);
  const setEditorMode = useUiStore((s) => s.setEditorMode);
  const resetEditorMode = useUiStore((s) => s.resetEditorMode);
  const [subtitleStyleDraft, setSubtitleStyleDraft] = useState<SubtitleStyle>({ ...DEFAULT_SUBTITLE_STYLE });
  // 预览舞台实际渲染宽度（CSS px），用于字号缩放：fontScale = stageWidth / videoWidth
  // 保证预览字号视觉比例与导出视频一致，换行行为也一致
  const [stageWidth, setStageWidth] = useState(0);
  // 字号缩放比例：预览舞台宽度 / 视频实际宽度，保证预览字号视觉比例与导出一致
  const videoWidth = project ? videoWidthForProject(project.ratio, project.renderConfig.resolution) : 1080;
  const fontScale = stageWidth > 0 ? stageWidth / videoWidth : 0.35;
  const showAddTrackMenu = useUiStore((s) => s.showAddTrackMenu);
  const setShowAddTrackMenu = useUiStore((s) => s.setShowAddTrackMenu);
  // 素材库悬停预览：非 null 时中央预览区显示该素材
  const [previewingAsset, setPreviewingAsset] = useState<MediaSource | null>(null);
  const [subtitleEditing, setSubtitleEditing] = useState(false);
  // 字幕轨统一调整样式：浮动面板编辑状态
  const [subtitleTrackStyleEditing, setSubtitleTrackStyleEditing] = useState<{
    trackId: string;
    draft: SubtitleStyle;
  } | null>(null);
  // 剪贴板（clip 复制/粘贴用）
  const clipboardRef = useRef<Clip | null>(null);
  // 右键菜单
  const contextMenu = useUiStore((s) => s.contextMenu);
  const setContextMenu = useUiStore((s) => s.setContextMenu);
  const pushToast = useUiStore((s) => s.pushToast);
  const dismissToast = useUiStore((s) => s.dismissToast);
  // 导出弹窗
  const showExport = useUiStore((s) => s.showExport);
  const setShowExport = useUiStore((s) => s.setShowExport);
  const exportState = useUiStore((s) => s.exportState);
  const setExportState = useUiStore((s) => s.setExportState);
  const exportPath = useUiStore((s) => s.exportPath);
  const exportError = useUiStore((s) => s.exportError);
  const exportProgress = useUiStore((s) => s.exportProgress);
  const setExportProgress = useUiStore((s) => s.setExportProgress);
  const exportMessage = useUiStore((s) => s.exportMessage);
  const setExportMessage = useUiStore((s) => s.setExportMessage);
  // 预览窗口缩放
  const previewZoom = useUiStore((s) => s.previewZoom);
  const setPreviewZoom = useUiStore((s) => s.setPreviewZoom);
  const [showPreviewDebug, setShowPreviewDebug] = useState(false);
  const [previewDebugInfo, setPreviewDebugInfo] = useState<Record<string, string>>({});
  const [view, setView] = useState<"home" | "editor">("home");
  const [showGenerate, setShowGenerate] = useState(false);
  const pipeline = usePipelineStore((s) => s.pipeline);
  const startPipeline = usePipelineStore((s) => s.startPipeline);
  const updatePipelineStep = usePipelineStore((s) => s.updateStep);
  const failRunningPipelineStep = usePipelineStore((s) => s.failRunningStep);
  const completePipeline = usePipelineStore((s) => s.completePipeline);
  const resetPipeline = usePipelineStore((s) => s.resetPipeline);
  // EDL 预览（AI 分段后先让用户确认/编辑，再执行编排）
  const [edlSegments, setEdlSegments] = useState<AiSegment[] | null>(null);
  const [edlBusy, setEdlBusy] = useState(false);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);

  // T2.3: 进入首页时刷新项目列表（persist 不再每次刷新）
  useEffect(() => {
    if (view === "home") void refreshProjects();
  }, [view]);

  // 监听导出进度事件
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    async function setup() {
      if ("__TAURI_INTERNALS__" in window) {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<{ progress: number; message: string }>("render-progress", (event) => {
          setExportProgress(event.payload.progress);
          setExportMessage(event.payload.message || "");
        });
      }
    }
    void setup();
    return () => { if (unlisten) unlisten(); };
  }, []);
  // 预览区/时间线可调高度（时间线占视口的百分比）
  const [timelineHeightPct, setTimelineHeightPct] = useState(35);
  const bootstrapped = useRef(false);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const timelineDrag = useRef({ active: false, x: 0, left: 0 });
  const stageRef = useRef<HTMLDivElement | null>(null);
  // T4.1: 画中画叠加层容器（PreviewEngine 在里面动态管理 overlay video）
  const overlayContainerRef = useRef<HTMLDivElement | null>(null);
  const filterCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const filterRendererRef = useRef<FilterRenderer | null>(null);
  // 始终指向最新的 project，供后台 async 操作读取，避免用闭包里的旧值覆盖用户编辑
  const projectRef = useRef<Project | null>(null);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);
  const {
    canUndo,
    canRedo,
    pushUndo,
    undo,
    redo,
    persist,
    persistWithSnapshot,
  } = useProjectHistory({
    projectId: project?.id ?? null,
    getCurrentProject: () => projectRef.current,
    setProject,
    setStatus,
  });
  const handleRenderFinal = useExportAction({
    project,
    refreshProjects,
    setBusy,
    setStatus,
  });

  useProxyBackfill({ project, setProject, setAssetCachingIds, setStatus });

  // 实时预览引擎：接管中央预览的 <video>，按时间线同步画面/配音/字幕
  // T2.1: engineState 移到 zustand store，按字段订阅避免 60fps 全树重渲染
  const { syncProject, togglePlay, seek, setClipVolume, setOverlayContainer, setActiveVideoChangeCallback } = usePreviewEngine(stageRef, view === "editor");

  // T4.1: 把 overlay 容器 ref 绑定到预览引擎
  useEffect(() => {
    setOverlayContainer(overlayContainerRef.current);
  }, [setOverlayContainer, view]);
  // 监听预览舞台宽度变化，用于字号缩放（预览字号 = 视频字号 * stageWidth / videoWidth）
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setStageWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);
  // 双缓冲切换：活跃 video 变化时通知 FilterRenderer 更新读取的 video
  useEffect(() => {
    setActiveVideoChangeCallback((el) => {
      filterRendererRef.current?.setVideo(el);
    });
    return () => setActiveVideoChangeCallback(null);
  }, [setActiveVideoChangeCallback]);
  // 中频字段（clip 切换时）
  const activeVideoClip = usePlaybackStore((s) => s.activeVideoClip);

  const selectedClip = useMemo(() => {
    if (!project) return null;
    return project.clips.find((clip) => clip.id === selectedClipId) || null;
  }, [project, selectedClipId]);

  // ref 始终指向最新 selectedClip，供拖拽闭包读取
  const selectedClipRef = useRef<Clip | null>(null);
  useEffect(() => {
    selectedClipRef.current = selectedClip;
  }, [selectedClip]);

  const selectedClipTrack = useMemo(() => {
    if (!project || !selectedClip) return null;
    return project.tracks.find((t) => t.id === selectedClip.trackId) || null;
  }, [project, selectedClip]);

  useEffect(() => {
    if (!selectedClipTrack) return;
    activateInspectorForTrack(selectedClipTrack.kind);
  }, [activateInspectorForTrack, selectedClipTrack?.kind]);

  // 判断选中 clip 是否是"画中画层"（视觉轨但非底层）。
  // 底层视觉轨 = order 最大的那条；其他视觉轨都是叠加层。
  const isOverlayClip = useMemo(() => {
    if (!project || !selectedClipTrack || !isVisualTrackKind(selectedClipTrack.kind)) return false;
    const visualTracks = project.tracks.filter((t) => isVisualTrackKind(t.kind));
    if (visualTracks.length <= 1) return false;
    const maxOrder = Math.max(...visualTracks.map((t) => t.order));
    return selectedClipTrack.order < maxOrder;
  }, [project, selectedClipTrack]);

  // 选中 clip 的变换（带默认值兜底）
  const overlayTransform: ClipTransform = selectedClip?.transform ?? DEFAULT_TRANSFORM;

  function updateOverlayTransform(patch: Partial<ClipTransform>, commit: boolean = true) {
    if (!selectedClip) return;
    const nextTransform = { ...overlayTransform, ...patch };
    updateSelectedClip({ transform: nextTransform }, commit);
  }

  /** T4.2: 在当前播放头位置为指定属性打一个关键帧 */
  function addKeyframeAtPlayhead(prop: "x" | "y" | "scale" | "opacity" | "rotation" | "volume", value: number) {
    if (!selectedClip || !project) return;
    const currentTime = usePlaybackStore.getState().currentTime;
    const relTime = Math.max(0, currentTime - selectedClip.startOnTrack);
    const cur = selectedClip.keyframes ?? {};
    const next = addKeyframe(cur[prop], relTime, value);
    updateSelectedClip({ keyframes: { ...cur, [prop]: next } });
    setStatus(`已为 ${prop} 在 ${relTime.toFixed(2)}s 打关键帧`);
  }

  /** 删除播放头处的关键帧（遍历所有属性） */
  function removeKeyframeAtPlayhead() {
    if (!selectedClip) return;
    const currentTime = usePlaybackStore.getState().currentTime;
    const relTime = Math.max(0, currentTime - selectedClip.startOnTrack);
    const cur = selectedClip.keyframes ?? {};
    const props = ["x", "y", "scale", "opacity", "rotation", "volume"] as const;
    let removed = false;
    const next = { ...cur };
    for (const prop of props) {
      if (findKeyframeAt(cur[prop], relTime)) {
        next[prop] = removeKeyframeAt(cur[prop], relTime);
        removed = true;
      }
    }
    if (removed) {
      updateSelectedClip({ keyframes: next });
      setStatus(`已删除 ${relTime.toFixed(2)}s 处的关键帧`);
    }
  }

  /** 修改播放头处关键帧的 easing（遍历所有属性） */
  function setKeyframeEasingAtPlayhead(easing: "linear" | "easeIn" | "easeOut" | "easeInOut") {
    if (!selectedClip) return;
    const currentTime = usePlaybackStore.getState().currentTime;
    const relTime = Math.max(0, currentTime - selectedClip.startOnTrack);
    const cur = selectedClip.keyframes ?? {};
    const props = ["x", "y", "scale", "opacity", "rotation", "volume"] as const;
    let changed = false;
    const next = { ...cur };
    for (const prop of props) {
      if (findKeyframeAt(cur[prop], relTime)) {
        next[prop] = updateKeyframeEasing(cur[prop], relTime, easing);
        changed = true;
      }
    }
    if (changed) {
      updateSelectedClip({ keyframes: next });
    }
  }

  /** 查找播放头处是否有任何关键帧（用于 UI 显示 easing 选择器） */
  function hasKeyframeAtPlayhead(): boolean {
    if (!selectedClip) return false;
    const currentTime = usePlaybackStore.getState().currentTime;
    const relTime = Math.max(0, currentTime - selectedClip.startOnTrack);
    const cur = selectedClip.keyframes ?? {};
    const props = ["x", "y", "scale", "opacity", "rotation", "volume"] as const;
    return props.some((prop) => findKeyframeAt(cur[prop], relTime) !== null);
  }

  /** 获取播放头处关键帧的 easing（取第一个命中的） */
  function getKeyframeEasingAtPlayhead(): "linear" | "easeIn" | "easeOut" | "easeInOut" | null {
    if (!selectedClip) return null;
    const currentTime = usePlaybackStore.getState().currentTime;
    const relTime = Math.max(0, currentTime - selectedClip.startOnTrack);
    const cur = selectedClip.keyframes ?? {};
    const props = ["x", "y", "scale", "opacity", "rotation", "volume"] as const;
    for (const prop of props) {
      const kf = findKeyframeAt(cur[prop], relTime);
      if (kf) return kf.easing;
    }
    return null;
  }

  // 时间线总时长由所有可见轨道共同决定（包括音频、配音和字幕）。
  const totalDuration = useMemo(() => {
    return Math.max(1, projectOutputDuration(project));
  }, [project]);

  // playhead 已从 usePlaybackStore 订阅（T2.1）

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void bootstrap();
  }, []);

  useEffect(() => {
    void refreshWhisperModelStatus();
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void desktopApi.listenWhisperModelProgress((progress) => {
      if (!disposed) setWhisperDownloadProgress(progress);
    }).then((nextUnlisten) => {
      if (disposed) nextUnlisten();
      else unlisten = nextUnlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // project 变化时同步给预览引擎（重新构建调度 + 预加载配音）
  useEffect(() => {
    void syncProject(project);
  }, [project, syncProject]);

  // 初始化 WebGL 滤镜渲染器
  useEffect(() => {
    if (!filterCanvasRef.current) return;
    filterRendererRef.current = new FilterRenderer(filterCanvasRef.current);
    return () => {
      filterRendererRef.current?.dispose();
      filterRendererRef.current = null;
    };
  }, []);

 // 每帧渲染滤镜：用"播放头所在的活跃视频 clip"，而非 selectedClip
 // 这样播放跨片段时滤镜正确切换；选中 A 播放 B 时显示 B 的滤镜
 useEffect(() => {
   if (!filterRendererRef.current) return;
   // 优先用引擎提供的活跃视频 clip；回退到 selectedClip（暂停时）
   const target = selectedClip && (!activeVideoClip || activeVideoClip.id === selectedClip.id)
     ? selectedClip
     : activeVideoClip || selectedClip;
   if (!target) return;
    // T1.9 修复：只设置 clip（低频），FilterRenderer 内部 rAF 循环负责每帧绘制
    // 这样 T2.1 的 zustand 解耦不会导致播放时画布冻结
    filterRendererRef.current.setClip(target);
    if (!target.filter || target.filter === "none") {
      filterRendererRef.current.clearLut();
      return;
    }
    let cancelled = false;
    void getLutData(target.filter).then((data) => {
      if (cancelled || !data || !filterRendererRef.current) return;
      const current = selectedClip && (!activeVideoClip || activeVideoClip.id === selectedClip.id)
        ? selectedClip
        : activeVideoClip || selectedClip;
      if (current?.id === target.id && current.filter === target.filter) {
        void filterRendererRef.current.loadLut(target.filter!, data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeVideoClip, selectedClip]);

  useEffect(() => {
    if (!selectedClip) {
      setAssetQueryDraft("");
      return;
    }
    // 视频 clip 优先用 visualQuery（AI 生成的搜索词）；字幕/配音 clip 用 text
    if (selectedClipTrack && isVisualTrackKind(selectedClipTrack.kind)) {
      setAssetQueryDraft(selectedClip.visualQuery || selectedClip.text || "");
    } else {
      setAssetQueryDraft(selectedClip.text || selectedClip.visualQuery || "");
    }
  }, [selectedClip?.id, selectedClipTrack?.kind]);

  useEffect(() => {
    if (!showPreviewDebug) return;
    const collect = () => {
      const stage = stageRef.current;
      const activeMedia = stage?.querySelector(".stage-pooled-media[style*=\"opacity: 1\"]") as HTMLElement | null
        ?? stage?.querySelector(".stage-pooled-media") as HTMLElement | null;
      setPreviewDebugInfo({
        selectedClip: selectedClip ? `${selectedClip.id} / ${selectedClip.filter ?? "no-filter"}` : "none",
        activeClip: activeVideoClip ? `${activeVideoClip.id} / ${activeVideoClip.filter ?? "no-filter"}` : "none",
        selectedTrack: selectedClipTrack ? `${selectedClipTrack.kind} / order ${selectedClipTrack.order}` : "none",
        filterCanvas: filterCanvasRef.current
          ? `display=${filterCanvasRef.current.style.display || getComputedStyle(filterCanvasRef.current).display}, size=${filterCanvasRef.current.width}x${filterCanvasRef.current.height}`
          : "missing",
        activeMedia: activeMedia
          ? `${activeMedia.tagName.toLowerCase()} filter=${activeMedia.style.filter || "none"} opacity=${activeMedia.style.opacity || "unset"}`
          : "missing",
        renderer: stage?.querySelector(".webcodecs-preview-canvas") ? "WebCodecsRenderer" : "PreviewEngine",
      });
    };
    collect();
    const timer = window.setInterval(collect, 500);
    return () => window.clearInterval(timer);
  }, [activeVideoClip, selectedClip, selectedClipTrack, showPreviewDebug]);

  // T2.4: 键盘 handler 通过 ref 读易变值/函数，effect 只挂载一次（不每帧重订阅）
  const kbStateRef = useRef<{
    project: Project | null;
    selectedClip: Clip | null;
    selectedClipId: string | null;
    selectedClipIds: string[];
    totalDuration: number;
    fps: number;
    deleteSelectedClip: (ripple?: boolean) => void;
    deleteSelectedClips: (ripple?: boolean) => void;
    undo: () => void;
    redo: () => void;
    duplicateSelectedClip: () => void;
    pasteClip: () => void;
    togglePlay: () => void;
    splitAtPlayhead: () => void;
    seek: (t: number) => void;
  } | null>(null);
  kbStateRef.current = {
    project, selectedClip, selectedClipId, selectedClipIds, totalDuration,
    fps: project?.renderConfig?.fps ?? 30,
    deleteSelectedClip, deleteSelectedClips, undo, redo, duplicateSelectedClip, pasteClip,
    togglePlay, splitAtPlayhead, seek,
  };

  // 全局键盘快捷键：Delete/Backspace 删除选中 clip（输入框聚焦时不触发）
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const s = kbStateRef.current;
      if (!s) return;
      // 排除输入框/文本域/内容可编辑元素里的按键
      const target = event.target as HTMLElement;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      // Delete 或 Backspace 删除选中 clip（T4.6: 多选时批量删）
      // Shift+Delete: 非 ripple 删除（保留空隙，剪映式）
      if ((event.key === "Delete" || event.key === "Backspace") && s.selectedClipId) {
        event.preventDefault();
        const ripple = !event.shiftKey;
        if (s.selectedClipIds && s.selectedClipIds.length > 1) {
          s.deleteSelectedClips(ripple);
        } else {
          s.deleteSelectedClip(ripple);
        }
      }
      // Ctrl+Z 撤销，Ctrl+Shift+Z 或 Ctrl+Y 重做
      if ((event.ctrlKey || event.metaKey) && event.key === "z") {
        event.preventDefault();
        if (event.shiftKey) s.redo();
        else s.undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "y") {
        event.preventDefault();
        s.redo();
      }
      // Ctrl+D 复制选中 clip
      if ((event.ctrlKey || event.metaKey) && event.key === "d" && s.selectedClip) {
        event.preventDefault();
        s.duplicateSelectedClip();
      }
      // Ctrl+C / Ctrl+V 复制粘贴 clip
      if ((event.ctrlKey || event.metaKey) && event.key === "c" && s.selectedClip) {
        event.preventDefault();
        clipboardRef.current = structuredClone(s.selectedClip);
        setStatus("已复制片段");
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "v" && clipboardRef.current && s.project) {
        event.preventDefault();
        s.pasteClip();
      }
      // 空格 播放/暂停
      if (event.key === " " && s.project) {
        event.preventDefault();
        s.togglePlay();
      }
      // Ctrl+B 分割（在播放头处）
      if ((event.ctrlKey || event.metaKey) && event.key === "b" && s.project) {
        event.preventDefault();
        s.splitAtPlayhead();
      }
      // 方向键：帧级步进 / 秒级步进
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        const step = event.shiftKey ? 1 : 1 / s.fps;
        s.seek(Math.max(0, usePlaybackStore.getState().currentTime - step));
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        const step = event.shiftKey ? 1 : 1 / s.fps;
        s.seek(usePlaybackStore.getState().currentTime + step);
      }
      // Home/End 跳到开头/结尾
      if (event.key === "Home") {
        event.preventDefault();
        s.seek(0);
      }
      if (event.key === "End") {
        event.preventDefault();
        s.seek(s.totalDuration);
      }
      // +/- 缩放时间线
      if (event.key === "+" || event.key === "=") {
        setPxPerSecond((prev) => Math.min(1200, prev * 1.3));
      }
      if (event.key === "-") {
        setPxPerSecond((prev) => Math.max(4, prev / 1.3));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function bootstrap() {
    setBusy("init");
    try {
      // G5: 崩溃恢复检测 -- 读上次退出标记，如果不是 clean 则提示
      try {
        const exitedCleanly = localStorage.getItem("appExitedCleanly");
        if (exitedCleanly === "false") {
          // 上次未正常退出（崩溃/被杀），但数据已通过定时 flush + SQLite 持久化
          setTimeout(() => setStatus("上次未正常退出，最近更改已自动保存"), 1500);
        }
        // 标记本次运行中（beforeunload 时会改为 true）
        localStorage.setItem("appExitedCleanly", "false");
      } catch {
        // localStorage 不可用时忽略
      }

      const [info, ffmpegStatus, loadedSettings, loadedProjects, voices] = await Promise.all([
        desktopApi.getAppInfo(),
        desktopApi.checkFfmpeg(),
        desktopApi.loadSettings(),
        desktopApi.listProjects(),
        desktopApi.listVoiceProfiles(),
      ]);
      setAppInfo(info);
      setFfmpeg(ffmpegStatus);
      setSettings(loadedSettings);
      setSettingsDraft(loadedSettings);
      setProjects(loadedProjects);
      setVoiceProfiles(voices);
      setSelectedVoiceId(loadedSettings.defaultVoiceId || voices[0]?.id || "");
      syncVoiceDrafts(voices);
      if (loadedProjects[0]) {
        const current = await desktopApi.getProject(loadedProjects[0].id);
        setProject(current);
        setSelectedClipId(current.clips[0]?.id || null);
      } else {
        await handleCreateProject();
      }
    } finally {
      setBusy(null);
    }
  }

  async function refreshProjects(activeId?: string) {
    const next = await desktopApi.listProjects();
    setProjects(next);
    if (activeId) {
      const current = await desktopApi.getProject(activeId);
      setProject(current);
      setSelectedClipId((previous) => previous || current.clips[0]?.id || null);
    }
  }

  async function handleCreateProject() {
    setBusy("create");
    try {
      const next = await desktopApi.createProject({
        title: `短视频项目 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`,
        ratio: settings.defaultRatio || "9:16",
      });
      setProject(next);
      setSelectedClipId(next.clips[0]?.id || null);
      await refreshProjects(next.id);
      setStatus("已新建项目");
    } finally {
      setBusy(null);
    }
  }

  function openSettings() {
    setSettingsDraft(settings);
    setShowSettings(true);
  }

  async function refreshWhisperModelStatus() {
    try {
      setWhisperModelStatus(await desktopApi.getWhisperModelStatus());
    } catch (error) {
      const parsed = parsePipelineError(error);
      setWhisperModelStatus(null);
      setStatus(parsed.message);
    }
  }

  function openWhisperSetup() {
    pendingWhisperActionRef.current = null;
    setWhisperSetupError(null);
    setWhisperDownloadProgress(null);
    setWhisperSetupOpen(true);
  }

  function requestWhisperSetup(kind: PendingWhisperAction["kind"], payload: GeneratePipelineInput | { translate: boolean; mode: SubtitleGenerationMode }) {
    const nextId = pendingWhisperActionId.current + 1;
    pendingWhisperActionId.current = nextId;
    const pending = createPendingWhisperAction(nextId, kind, payload);
    pendingWhisperActionRef.current = pending;
    setWhisperSetupError(null);
    setWhisperDownloadProgress(null);
    setWhisperSetupOpen(true);
    setStatus("请先完成 Whisper 模型设置");
  }

  async function handleDownloadWhisperModel() {
    setBusy("whisper-download");
    setWhisperSetupError(null);
    setWhisperDownloadProgress(null);
    let installedStatus: WhisperModelStatus | null = null;
    try {
      installedStatus = await desktopApi.downloadWhisperModel(recommendedWhisperModelId);
      setWhisperModelStatus(installedStatus);
      setSettings((current) => ({
        ...current,
        whisperModel: installedStatus?.configuredPath || installedStatus?.resolvedPath || current.whisperModel,
      }));
      setSettingsDraft((current) => ({
        ...current,
        whisperModel: installedStatus?.configuredPath || installedStatus?.resolvedPath || current.whisperModel,
      }));
      setStatus("Whisper 模型已就绪");
    } catch (error) {
      const parsed = parsePipelineError(error);
      setWhisperSetupError(parsed.message);
      setStatus(`Whisper 模型下载失败：${parsed.message}`);
    } finally {
      setBusy(null);
    }
    if (installedStatus) {
      await resumePendingWhisperAction(installedStatus);
    }
  }

  async function handleCancelWhisperDownload() {
    try {
      await desktopApi.cancelWhisperModelDownload();
      setWhisperDownloadProgress(null);
      setStatus("已取消 Whisper 模型下载");
    } catch (error) {
      setWhisperSetupError(parsePipelineError(error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleSelectWhisperModel() {
    setBusy("whisper-select");
    setWhisperSetupError(null);
    let selectedStatus: WhisperModelStatus | null = null;
    try {
      const path = await desktopApi.pickWhisperModelFile();
      if (!path) return;
      selectedStatus = await desktopApi.selectWhisperModel(path);
      setWhisperModelStatus(selectedStatus);
      setSettings((current) => ({ ...current, whisperModel: path }));
      setSettingsDraft((current) => ({ ...current, whisperModel: path }));
      setStatus("已选择本地 Whisper 模型");
    } catch (error) {
      const parsed = parsePipelineError(error);
      setWhisperSetupError(parsed.message);
      setStatus(`选择 Whisper 模型失败：${parsed.message}`);
    } finally {
      setBusy(null);
    }
    if (selectedStatus) {
      await resumePendingWhisperAction(selectedStatus);
    }
  }

  async function handleDeleteWhisperModel() {
    setBusy("whisper-delete");
    try {
      const nextStatus = await desktopApi.deleteWhisperModel();
      setWhisperModelStatus(nextStatus);
      setSettings((current) => ({ ...current, whisperModel: nextStatus.configuredPath || "" }));
      setSettingsDraft((current) => ({ ...current, whisperModel: nextStatus.configuredPath || "" }));
      setStatus("Whisper 模型已删除");
    } catch (error) {
      setStatus(parsePipelineError(error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleOpenModelsDirectory() {
    try {
      await desktopApi.openModelsDirectory();
    } catch (error) {
      setStatus(parsePipelineError(error).message);
    }
  }

  async function resumePendingWhisperAction(statusOverride?: WhisperModelStatus | null) {
    if (!hasWhisperModel(statusOverride ?? whisperModelStatus)) return;
    const pending = pendingWhisperActionRef.current;
    pendingWhisperActionRef.current = null;
    setWhisperSetupOpen(false);
    setWhisperSetupError(null);
    setWhisperDownloadProgress(null);
    if (!pending) return;
    if (pending.kind === "generate-pipeline") {
      await handleGeneratePipeline(pending.payload as GeneratePipelineInput, { skipWhisperGate: true });
      return;
    }
    await handleRecognizeSubtitles(pending.payload as { translate: boolean; mode: SubtitleGenerationMode }, { skipWhisperGate: true });
  }

  function cancelPendingWhisperAction() {
    pendingWhisperActionRef.current = null;
    setWhisperSetupOpen(false);
    setWhisperSetupError(null);
    setStatus("已取消 Whisper 设置");
  }

  async function handleSaveSettings() {
    setBusy("settings");
    try {
      const saved = await desktopApi.saveSettings(settingsDraft);
      setSettings(saved);
      setSettingsDraft(saved);
      await refreshWhisperModelStatus();
      setShowSettings(false);
      setStatus("设置已保存");
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteProject(id: string) {
    setBusy(`delete-${id}`);
    try {
      await desktopApi.deleteProject(id);
      const nextList = await desktopApi.listProjects();
      setProjects(nextList);
      if (project?.id === id) {
        if (nextList[0]) {
          const nextProject = await desktopApi.getProject(nextList[0].id);
          setProject(nextProject);
          setSelectedClipId(nextProject.clips[0]?.id || null);
        } else {
          setProject(null);
          await handleCreateProject();
        }
      }
      setStatus("项目已删除");
    } finally {
      setBusy(null);
    }
  }

  async function handleGenerateProjectAudio() {
    if (!project) return;
    if (!selectedVoiceId && !settings.fishAudioReferenceId) {
      setStatus("请先选择 Fish 音色，或在设置中配置 Fish Audio Reference ID");
      openSettings();
      return;
    }
    setBusy("audio");
    setStatus("正在为全部片段生成配音...");
    const snapshot = projectRef.current;
    try {
      await desktopApi.saveProject(project);
      const next = await desktopApi.generateAudio({
        projectId: project.id,
        voiceId: selectedVoiceId,
      });
      // 配音时长已变成真实时长，按配音轨首尾相接重排整条时间线
      const realigned = realignTimeline(next);
      const saved = await desktopApi.saveProject(realigned);
      persistWithSnapshot(saved, snapshot, "生成全部配音");
      await refreshProjects(saved.id);
      setStatus("全部片段配音已生成，时间线已按真实时长重排");
    } catch (error) {
      const parsed = parsePipelineError(error);
      setStatus(parsed.message);
      pushToast({
        type: "error",
        message: `配音生成失败：${parsed.message}`,
        action: parsed.retryable ? { label: "重试", onClick: () => void handleGenerateProjectAudio() } : undefined,
      });
    } finally {
      setBusy(null);
    }
  }

  async function buildOptimizedSubtitles(
    currentProject: Project,
    sentences: TimedSentencesResult["sentences"],
    translate: boolean,
    mode: SubtitleGenerationMode = "natural",
  ): Promise<{ project: Project; issueCount: number }> {
    const transcriptWords = sentences.flatMap((sentence) => sentence.words ?? []);
    const rawTranscriptText = sentences.map((sentence) => sentence.text).join("");
    let analyzedContext: SubtitleLanguageContext = {
      summary: currentProject.script || rawTranscriptText.slice(0, 500),
      contentType: "other",
      tone: "natural",
      terms: [],
    };
    if (settings.deepseekApiKey) {
      try {
        analyzedContext = await desktopApi.analyzeSubtitleLanguageContext({
          projectTitle: currentProject.title,
          script: currentProject.script,
          transcript: rawTranscriptText,
          mode,
        });
      } catch {
        setStatus("全局语言分析不可用，继续使用项目原文上下文");
      }
    }
    const languageContext = JSON.stringify(analyzedContext);
    const layoutProfile = subtitleLayoutProfile(currentProject, translate);
    const canUseSemanticAi = Boolean(settings.deepseekApiKey)
      && transcriptWords.length >= 8
      && sentences.every((sentence) => Boolean(sentence.words?.length));
    const semanticAdvice = canUseSemanticAi
      ? await requestSubtitleSemanticAdvice(
          transcriptWords,
          (words) => desktopApi.adviseSubtitleBreaks({
            words: words.map((word) => word.text),
            wordTimings: words.map((word, index) => ({
              text: word.text,
              start: word.start,
              end: word.end,
              gapAfter: Math.max(0, (words[index + 1]?.start ?? word.end) - word.end),
            })),
            constraints: {
              ratio: layoutProfile.ratio,
              maxLines: layoutProfile.maxLines,
              preferredCharsPerLine: layoutProfile.preferredCharsPerLine,
              maxCharsPerCue: layoutProfile.maxCharsPerCue,
              minDuration: layoutProfile.minDuration,
              preferredDuration: layoutProfile.preferredDuration,
              maxDuration: layoutProfile.maxDuration,
              preferredCps: layoutProfile.preferredCps,
              maxCps: layoutProfile.maxCps,
            },
            context: languageContext,
            mode,
          }),
        )
      : null;
    if (semanticAdvice?.successfulChunkCount) {
      const fallbackText = semanticAdvice.failedChunkCount > 0
        ? `，${semanticAdvice.failedChunkCount} 批已规则回退`
        : "";
      setStatus(`AI 语义断句完成：${semanticAdvice.successfulChunkCount}/${semanticAdvice.requestedChunkCount} 批${fallbackText}`);
    } else if (canUseSemanticAi) {
      setStatus("AI 语义断句不可用，已自动回退规则引擎");
    }
    const segmentedTranscript = prepareTranscriptSubtitles(
      currentProject,
      sentences,
      translate,
      semanticAdvice ?? undefined,
    );
    const transcript = translate
      ? await desktopApi.refineTranscript({
          sentences: segmentedTranscript,
          translate: true,
          mode,
          context: languageContext,
        })
      : segmentedTranscript;
    const subtitleBuild = buildTranscriptSubtitleProject(currentProject, transcript, translate);
    const saved = await desktopApi.saveProject(subtitleBuild.project);
    if (subtitleBuild.issueCount > 0) {
      pushToast({
        type: "warning",
        message: `字幕排版完成，${subtitleBuild.issueCount} 个质量提示可在字幕中检查`,
        duration: 8000,
      });
    }
    try {
      await saveSubtitleArtifact({
        version: 1,
        projectId: currentProject.id,
      generatedAt: new Date().toISOString(),
      mode,
      bilingual: translate,
      languageContext: analyzedContext,
      rawTranscript: sentences,
      sourceCues: segmentedTranscript,
      translatedCues: transcript,
      ai: {
        requestedChunks: semanticAdvice?.requestedChunkCount ?? 0,
        successfulChunks: semanticAdvice?.successfulChunkCount ?? 0,
        failedChunks: semanticAdvice?.failedChunkCount ?? 0,
        failureCategories: semanticAdvice?.failureCategories ?? [],
        confidence: semanticAdvice?.confidence ?? 0,
        preferredBreakCount: semanticAdvice?.preferredBreakAfterIndices.size ?? 0,
        strongBreakCount: semanticAdvice?.strongBreakAfterIndices.size ?? 0,
        protectedRangeCount: semanticAdvice?.protectedRanges.length ?? 0,
      },
      output: {
        groupCount: subtitleBuild.groupCount,
        sourceClipCount: subtitleBuild.sourceClipCount,
        targetClipCount: subtitleBuild.targetClipCount,
        qualityIssues: subtitleBuild.issues,
      },
      });
    } catch {
      pushToast({ type: "warning", message: "字幕已生成，但中间产物保存失败" });
    }
    if (translate && subtitleBuild.targetClipCount < subtitleBuild.sourceClipCount) {
      pushToast({ type: "warning", message: `翻译字幕不完整：${subtitleBuild.targetClipCount}/${subtitleBuild.sourceClipCount}` });
    }
    return { project: saved, issueCount: subtitleBuild.issueCount };
  }

  /** 识别字幕：项目旁白单次 Whisper → AI 语义断句 → Layout Engine → 可选翻译。 */
  async function handleRecognizeSubtitles(options: { translate: boolean; mode: SubtitleGenerationMode }, control?: { skipWhisperGate?: boolean }) {
    const { translate, mode } = options;
    if (!control?.skipWhisperGate && shouldGateWhisperAction(whisperModelStatus)) {
      requestWhisperSetup("subtitle-recognition", options);
      return;
    }
    const currentProject = projectRef.current;
    if (!currentProject) return;
    setBusy("subtitles");
    setStatus(translate ? "正在识别旁白并生成双语字幕..." : "正在识别旁白并智能排版字幕...");
    const snapshot = currentProject;
    try {
      await desktopApi.saveProject(currentProject);
      const transcript = await desktopApi.transcribeProjectNarration(currentProject.id);
      setStatus(`旁白识别完成：${transcript.sentences.length} 个原始块，正在智能断句...`);
      const result = await buildOptimizedSubtitles(currentProject, transcript.sentences, translate, mode);
      const next = result.project;
      projectRef.current = next;
      persistWithSnapshot(next, snapshot, `智能识别字幕（${translate ? "双语" : "单语"}）`);
      await refreshProjects(next.id);
      const subCount = next.clips.filter((clip) =>
        next.tracks.some((track) => track.kind === "subtitle" && track.id === clip.trackId),
      ).length;
      setStatus(`字幕识别完成：${subCount} 条，质量提示 ${result.issueCount} 个`);
    } catch (error) {
      const parsed = parsePipelineError(error);
      setStatus(parsed.message);
      pushToast({
        type: "error",
        message: `字幕识别失败：${parsed.message}`,
        action: parsed.retryable ? { label: "重试", onClick: () => void handleRecognizeSubtitles({ translate, mode }) } : undefined,
      });
    } finally {
      setBusy(null);
    }
  }

  /** 手动添加一条空字幕到字幕轨末尾 */
  function handleAddManualSubtitle() {
    if (!project) return;
    const subtitleTrack = project.tracks
      .filter((t) => t.kind === "subtitle")
      .sort((a, b) => a.order - b.order)[0];
    if (!subtitleTrack) {
      setStatus("没有字幕轨，请先在时间线添加字幕轨");
      return;
    }
    const subtitleClips = project.clips.filter((c) => c.trackId === subtitleTrack.id);
    const endTime = subtitleClips.reduce((max, c) => Math.max(max, c.startOnTrack + c.duration), 0);
    const newClip: Clip = {
      id: newClipId(),
      trackId: subtitleTrack.id,
      sourceId: null,
      startOnTrack: endTime,
      duration: 3,
      sourceIn: 0,
      sourceOut: 3,
      speed: 1,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      brightness: 0,
      contrast: 0,
      saturation: 0,
      text: "新字幕",
      subtitleStyle: { ...subtitleStyleDraft },
      transitionIn: null,
      transitionOut: null,
    };
    void persist({ ...project, clips: [...project.clips, newClip] }, "已添加字幕");
    setSelectedClipId(newClip.id);
  }

  /** 导入 SRT 字幕文件：解析后端 -> 生成字幕 clip 到字幕轨 */
  async function handleImportSrt() {
    if (!project) return;
    const srtPath = await desktopApi.pickSrtFile();
    if (!srtPath) return;
    setBusy("subtitles");
    setStatus("正在导入 SRT 字幕...");
    const snapshot = projectRef.current;
    try {
      await desktopApi.saveProject(project);
      const next = await desktopApi.importSrt({
        projectId: project.id,
        srtPath,
        timeOffset: 0,
      });
      persistWithSnapshot(next, snapshot, "导入 SRT 字幕");
      await refreshProjects(next.id);
      const subCount = next.clips.filter((c) =>
        next.tracks.some((t) => t.kind === "subtitle" && t.id === c.trackId),
      ).length;
      setStatus(`SRT 导入完成，共 ${subCount} 条字幕`);
    } catch (error) {
      const parsed = parsePipelineError(error);
      setStatus(parsed.message);
      pushToast({
        type: "error",
        message: `SRT 导入失败：${parsed.message}`,
      });
    } finally {
      setBusy(null);
    }
  }

  /**
   * 拖动字幕手柄（8 个点）：
   * - 四角 tl/tr/bl/br：等比缩放字号（文字整体变大变小）
   * - 上下中点 tm/bm：竖向拖动改字号
   * - 左右中点 ml/mr：横向拖动改字号
   * 所有手柄都改字号（剪映式：缩放=改显示大小，字号属性是基准）
   */
  /**
   * 改变 clip 速度（剪映式）：
   * - sourceIn/sourceOut 不变
   * - duration = (sourceOut - sourceIn) / speed
   * - 同轨后续 clip 涟漪推移（补/缩差值）
   */
  function applyClipOperation(result: OperationResult) {
    void persist(result.project, result.message);
    setSelectedClipId(result.selectedClipId);
  }

  function changeClipSpeed(clip: Clip, newSpeed: number) {
    if (!project) return;
    applyClipOperation(buildClipSpeedChange(project, clip, newSpeed));
  }

  function applySpeedCurvePreset(clip: Clip, curve: Parameters<typeof buildSpeedCurvePresetChange>[2], label: string) {
    if (!project) return;
    applyClipOperation(buildSpeedCurvePresetChange(project, clip, curve, label));
  }

  function handleSubtitleResize(event: React.PointerEvent<HTMLDivElement>, _corner: string) {
    if (!selectedClip || !selectedClipTrack || selectedClipTrack.kind !== "subtitle") return;
    event.stopPropagation();
    event.preventDefault();

    const subtitleEl = event.currentTarget.parentElement;
    const subRect = subtitleEl?.getBoundingClientRect();
    if (!subRect) return;
    const centerX = subRect.left + subRect.width / 2;
    const centerY = subRect.top + subRect.height / 2;
    // 起始对角线距离（中心到鼠标）
    const startDist = Math.max(Math.hypot(event.clientX - centerX, event.clientY - centerY), 10);
    const origFontSize = selectedClip.subtitleStyle?.fontSize ?? 48;

    const move = (ev: PointerEvent) => {
      const curDist = Math.hypot(ev.clientX - centerX, ev.clientY - centerY);
      const ratio = curDist / startDist;
      const newSize = Math.max(12, Math.min(300, Math.round(origFontSize * ratio)));
      const currentStyle = selectedClipRef.current?.subtitleStyle ?? { ...DEFAULT_SUBTITLE_STYLE };
      updateSelectedClip({
        subtitleStyle: { ...currentStyle, fontSize: newSize },
      }, false);
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      commitInteractiveEdit();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  async function handleGenerateClipAudio() {
    if (!project || !selectedClip) return;
    if (!selectedVoiceId && !settings.fishAudioReferenceId) {
      setStatus("请先选择 Fish 音色，或在设置中配置 Fish Audio Reference ID");
      openSettings();
      return;
    }
    // 找到当前选中 clip 同起始位置的配音 clip（支持多配音轨）
    const voiceoverTrackIds = project.tracks
      .filter((t) => t.kind === "voiceover")
      .map((t) => t.id);
    const voiceClip = project.clips.find(
      (clip) =>
        voiceoverTrackIds.includes(clip.trackId) &&
        Math.abs(clip.startOnTrack - selectedClip.startOnTrack) < 0.05,
    );
    if (!voiceClip) {
      setStatus("未找到对应的配音片段");
      return;
    }
    setBusy("clip-audio");
    setStatus(`正在生成配音...`);
    const snapshot = projectRef.current;
    try {
      await desktopApi.saveProject(project);
      const next = await desktopApi.generateAudio({
        projectId: project.id,
        clipId: voiceClip.id,
        voiceId: selectedVoiceId,
      });
      // 单段配音时长变化后，同样按配音轨重排整条时间线
      const realigned = realignTimeline(next);
      const saved = await desktopApi.saveProject(realigned);
      persistWithSnapshot(saved, snapshot, "生成片段配音");
      setSelectedClipId(voiceClip.id);
      await refreshProjects(saved.id);
      setStatus("片段配音已生成，时间线已重排");
    } catch (error) {
      const parsed = parsePipelineError(error);
      setStatus(parsed.message);
      pushToast({
        type: "error",
        message: `片段配音失败：${parsed.message}`,
        action: parsed.retryable ? { label: "重试", onClick: () => void handleGenerateClipAudio() } : undefined,
      });
    } finally {
      setBusy(null);
    }
  }

  /**
   * 一键生成流水线：
   * 文案模式：文案 → Fish Audio 整篇旁白 → whisper 句级识别 → AI 配关键词 → 自动配素材 → 字幕识别
   * 音频模式：导入音频 → whisper 句级识别 → AI 配关键词 → 自动配素材 → 字幕识别
   */
  async function handleGeneratePipeline(input: GeneratePipelineInput, control?: { skipWhisperGate?: boolean }) {
    if (!control?.skipWhisperGate && shouldGateWhisperAction(whisperModelStatus)) {
      requestWhisperSetup("generate-pipeline", input);
      return;
    }
    const sourceType = input.audioPath ? "audio" as const : "script" as const;
    let pipelineProject: Project | null = null;

    const persistSession = (session: GenerationSession) => {
      saveGenerationSession(session);
      return session;
    };

    await runGeneratePipeline(input, {
      startPipeline,
      updateStep: updatePipelineStep,
      createSession: async () => {
        const project = await desktopApi.createProject({ title: "一键生成", ratio: input.ratio });
        const saved = await desktopApi.saveProject({ ...project, script: input.script });
        pipelineProject = saved;
        projectRef.current = saved;
        setProject(saved);
        setSelectedClipId(null);
        resetEditorMode();
        setView("editor");
        return persistSession(createGenerationSession(saved.id, sourceType));
      },
      prepareNarration: async (session) => {
        const current = pipelineProject;
        if (!current) throw new Error("一键生成项目创建失败");
        if (input.audioPath) {
          setStatus("正在准备主旁白音频...");
          const audioSource = await desktopApi.importMedia(input.audioPath);
          const saved = await desktopApi.saveProject({
            ...current,
            media: current.media.some((item) => item.id === audioSource.id)
              ? current.media
              : [...current.media, audioSource],
          });
          pipelineProject = saved;
          projectRef.current = saved;
          setProject(saved);
          return persistSession(updateGenerationSession(session, {
            stage: "narration_ready",
            narrationSourceId: audioSource.id,
            audioPath: audioSource.localPath || input.audioPath,
            narration: {
              sourceId: audioSource.id,
              audioPath: audioSource.localPath || input.audioPath,
              duration: audioSource.duration,
              origin: "audio",
            },
          }));
        }

        setStatus("正在用 Fish Audio 生成完整旁白...");
        const narration = await desktopApi.generateNarration({
          projectId: current.id,
          text: input.script,
          voiceId: input.voiceId || null,
        });
        const saved = await desktopApi.getProject(current.id);
        pipelineProject = saved;
        projectRef.current = saved;
        setProject(saved);
        return persistSession(updateGenerationSession(session, {
          stage: "narration_ready",
          narrationSourceId: narration.sourceId,
          audioPath: narration.audioPath,
          narration: { ...narration, origin: "script" },
        }));
      },
      transcribeNarration: async (session) => {
        if (!session.audioPath) throw new Error("主旁白音频未准备完成");
        setStatus("正在用 Whisper 单次转写主旁白...");
        const transcript = await desktopApi.transcribeToSentences(session.audioPath);
        const current = pipelineProject;
        if (!current) throw new Error("生成项目丢失");
        const saved = await desktopApi.saveProject({ ...current, script: transcript.fullText || current.script });
        pipelineProject = saved;
        projectRef.current = saved;
        setProject(saved);
        setStatus(`转写完成：${transcript.sentences.length} 句，共 ${transcript.totalDuration.toFixed(1)}s`);
        return persistSession(updateGenerationSession(session, { stage: "transcribed", transcript }));
      },
      enrichAndBuildTimeline: async (session) => {
        if (!session.transcript || !session.narrationSourceId || !session.audioPath) {
          throw new Error("生成会话缺少旁白或转写结果");
        }
        setStatus("正在用 AI 富化分镜并构建真实时间线...");
        const segments = await desktopApi.enrichSegments({
          sentences: session.transcript.sentences,
          ratio: input.ratio,
          materialDirection: input.materialDirection || "auto",
        });
        const current = pipelineProject;
        if (!current) throw new Error("生成项目丢失");
        const saved = await buildAudioDrivenTimeline(
          current,
          session.narrationSourceId,
          session.transcript,
          segments,
          input.ratio,
        );
        pipelineProject = saved;
        return persistSession(updateGenerationSession(session, { stage: "timeline_ready", segments }));
      },
      selectAssets: async (session) => {
        const current = pipelineProject;
        if (!current) throw new Error("生成项目丢失");
        const videoTrackIds = new Set(current.tracks.filter((track) => track.kind === "video").map((track) => track.id));
        const videoClips = current.clips.filter((clip) => videoTrackIds.has(clip.trackId));
        const usedAssetIds = new Set<string>();
        const results: AssetSelectionResult[] = [];
        let completed = 0;
        // 绑定操作顺序执行，避免多个 saveProject 竞争导致后完成的旧快照覆盖新素材。
        for (const [index, clip] of videoClips.entries()) {
          const segment = session.segments[index];
          const query = clip.visualQuery || segment?.visualQuery || segment?.text?.slice(0, 24) || "nature landscape";
          const result = await searchScoreAndBindAsset(current.id, clip.id, query, current.ratio, clip.duration, {
            materialDirection: input.materialDirection,
            usedAssetIds,
            minimumConfidence: 0.52,
          });
          if (result.selected) usedAssetIds.add(result.selected.id);
          results.push(result);
          completed += 1;
          setStatus(`正在评分匹配素材：${completed}/${videoClips.length}`);
        }
        pipelineProject = projectRef.current?.id === current.id ? projectRef.current : current;
        return persistSession(updateGenerationSession(session, { stage: "assets_selected", assetResults: results }));
      },
      createSubtitles: async (session) => {
        if (!session.transcript) throw new Error("缺少转写结果，无法生成字幕");
        const current = pipelineProject;
        if (!current) throw new Error("生成项目丢失");
        setStatus("正在从同一份转写结果生成字幕...");
        const subtitleResult = await buildOptimizedSubtitles(
          current,
          session.transcript.sentences,
          input.translate,
          "natural",
        );
        const saved = subtitleResult.project;
        pipelineProject = saved;
        projectRef.current = saved;
        setProject(saved);
        await refreshProjects(saved.id);
        return persistSession(updateGenerationSession(session, {
          stage: "subtitles_ready",
          subtitleIssueCount: subtitleResult.issueCount,
        }));
      },
      complete: (session) => {
        const report = buildGenerationReport(session);
        const completed = persistSession(updateGenerationSession(session, { stage: "completed", report }));
        setStatus(`一键生成完成：${report.segmentCount} 个分镜，素材 ${report.matchedAssetCount}/${report.segmentCount}，低置信度 ${report.lowConfidenceSegmentCount}`);
        pushToast({
          type: report.lowConfidenceSegmentCount > 0 ? "warning" : "success",
          message: `生成报告：旁白 ${report.narrationDuration.toFixed(1)}s · 分镜 ${report.segmentCount} · 素材 ${report.matchedAssetCount} · 待人工 ${report.lowConfidenceSegmentCount} · 字幕提示 ${report.subtitleIssueCount}`,
          duration: 10000,
        });
        void completed;
        completePipeline(report);
      },
      fail: (session, message) => {
        const parsed = parsePipelineError(message);
        if (session) persistSession(recordGenerationError(session, session.stage, parsed.message, parsed.retryable));
        failRunningPipelineStep(parsed.message);
        setStatus(`生成失败：${parsed.message}`);
      },
    });
  }

  async function handleSegmentScript(opts?: { skipEdl?: boolean }) {
    if (!project) return;
    const script = project.script.trim();
    if (!script) {
      setStatus("请先输入文案，再进行 AI 分段");
      return;
    }
    setBusy("segment");
    setStatus("正在调用 DeepSeek 分段...");
    try {
      const result = await desktopApi.segmentScript({
        script,
        ratio: project.ratio,
      });
      if (opts?.skipEdl) {
        // 一键生成场景：跳过预览，直接执行
        await applyEdlSegments(result.segments);
      } else {
        // 先展示 EDL 预览面板，让用户确认/编辑后再执行编排
        setEdlSegments(result.segments);
        setStatus(`AI 分段完成：${result.rawSegmentCount} 段，请确认分镜方案`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  /**
   * 音频驱动分镜流水线（由导入音频和 Fish Audio 完整旁白共用）：
   * 1. whisper 句级识别 → 拿到带真实时间戳的句子
   * 2. DeepSeek 富化（配画面关键词/情绪，不改时间数量顺序）
   * 3. 编排成轨道 clip（用真实 start/end，不用估算时长累加）
   * 4. 把音频源放到配音轨（作为整条配音）
   * 5. 自动绑素材
   */
  async function buildAudioDrivenTimeline(
    baseProject: Project,
    narrationSourceId: string,
    transcript: TimedSentencesResult,
    segments: AiSegment[],
    ratio: string,
  ): Promise<Project> {
    const clips = arrangeSegmentsToClips(segments, baseProject.tracks);
    const voiceoverTrackId = pickPrimaryTrack(baseProject.tracks, "voiceover");
    const withoutSegmentVoiceover = voiceoverTrackId
      ? clips.filter((clip) => clip.trackId !== voiceoverTrackId)
      : clips;
    if (voiceoverTrackId) {
      withoutSegmentVoiceover.push({
        id: newClipId(),
        trackId: voiceoverTrackId,
        sourceId: narrationSourceId,
        startOnTrack: 0,
        duration: transcript.totalDuration,
        sourceIn: 0,
        sourceOut: transcript.totalDuration,
        speed: 1,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
        brightness: 0,
        contrast: 0,
        saturation: 0,
        transitionIn: null,
        transitionOut: null,
      });
    }
    const saved = await desktopApi.saveProject({
      ...baseProject,
      ratio,
      script: transcript.fullText || baseProject.script,
      clips: withoutSegmentVoiceover,
    });
    projectRef.current = saved;
    setProject(saved);
    setSelectedClipId(saved.clips[0]?.id || null);
    await refreshProjects(saved.id);
    return saved;
  }

  /**
   * 执行 EDL：把用户确认/编辑后的 segments 编排成轨道 clip + 自动绑素材。
   * 由 EdlPreview 面板的"执行"按钮触发。
   */
  async function applyEdlSegments(segments: AiSegment[]) {
    if (!project) return;
    setEdlBusy(true);
    setStatus("正在编排轨道并匹配素材...");
    const snapshot = projectRef.current;
    try {
      // 编排成轨道 clips（按实际项目的 tracks 动态匹配轨道 ID）
      const clips = arrangeSegmentsToClips(segments, project.tracks);
      const nextProject: Project = {
        ...project,
        clips,
        media: project.media,
      };
      const saved = await desktopApi.saveProject(nextProject);
      persistWithSnapshot(saved, snapshot, `执行分镜方案（${segments.length} 段）`);
      setSelectedClipId(saved.clips[0]?.id || null);
      await refreshProjects(saved.id);

      // 并发为每个视频 clip 搜素材并绑定（限流 3，用 clip 自带的 visualQuery）
      const videoTrackIds = saved.tracks.filter((t) => t.kind === "video").map((t) => t.id);
      const videoClips = saved.clips.filter((c) => videoTrackIds.includes(c.trackId));
      const limit = pLimit(3);
      let boundCount = 0;
      let doneCount = 0;
      const tasks = videoClips.map((clip, idx) =>
        limit(async () => {
          const segPeer = segments[idx];
          const query =
            clip.visualQuery ||
            segPeer?.visualQuery ||
            segPeer?.text?.slice(0, 24) ||
            "nature landscape";
          const ok = await searchAndBindAsset(saved.id, clip.id, query, saved.ratio, clip.duration);
          doneCount += 1;
          if (ok) boundCount += 1;
          setStatus(`正在匹配素材：${doneCount}/${videoClips.length}（成功 ${boundCount}）`);
        }),
      );
      const results = await Promise.allSettled(tasks);
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        pushToast({ type: "warning", message: `${failed} 段素材匹配失败` });
      }
      detectAssetDuplication(saved);
      setStatus(`分镜方案已执行：${segments.length} 段，已匹配 ${boundCount}/${videoClips.length} 段素材`);
      setEdlSegments(null); // 关闭预览面板
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setEdlBusy(false);
    }
  }

  /** 为指定视频 clip 搜素材并绑定。
   *  自动编排流程用：优先选时长 >= targetDuration 的素材，都不够长时取最长的（降级）。 */
  async function searchScoreAndBindAsset(
    projectId: string,
    clipId: string,
    query: string,
    ratio: string,
    targetDuration: number | undefined,
    options?: {
      materialDirection?: string;
      usedAssetIds?: ReadonlySet<string>;
      minimumConfidence?: number;
    },
  ): Promise<AssetSelectionResult> {
    try {
      const assets = await desktopApi.searchPexelsVideos({ query, ratio, perPage: 8 });
      setAssetCandidates((previous) => ({ ...previous, [clipId]: assets }));
      const result = selectAssetCandidate(assets, {
        clipId,
        query,
        ratio,
        targetDuration,
        materialDirection: options?.materialDirection,
        usedAssetIds: options?.usedAssetIds,
        minimumConfidence: options?.minimumConfidence,
      });
      if (result.selected) {
        await bindAssetToClip(projectId, clipId, result.selected);
      }
      return result;
    } catch (error) {
      return {
        clipId,
        query,
        candidates: [],
        selected: null,
        confidence: 0,
        requiresManualSelection: true,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** 为指定视频 clip 搜素材并绑定。手动/旧流程保持宽松阈值；一键生成使用评分阈值。 */
  async function searchAndBindAsset(
    projectId: string,
    clipId: string,
    query: string,
    ratio?: string,
    targetDuration?: number,
  ): Promise<boolean> {
    const effectiveRatio = ratio || projectRef.current?.ratio || "9:16";
    const result = await searchScoreAndBindAsset(projectId, clipId, query, effectiveRatio, targetDuration, {
      minimumConfidence: 0,
    });
    return Boolean(result.selected);
  }


  async function bindAssetToClip(projectId: string, clipId: string, asset: MediaSource) {
    // 基于最新 project，避免并发绑定相互覆盖（AI 分段后会并发触发多个绑定）
    const current = projectRef.current;
    if (!current || current.id !== projectId) return;
    const target = current.clips.find((c) => c.id === clipId);
    if (!target) return;
    // 素材时长不足段时长 80% 时警告（图片无时长不校验）
    if (asset.kind === "video" && asset.duration > 0 && asset.duration < target.duration * 0.8) {
      pushToast({
        type: "warning",
        message: `素材时长 ${asset.duration.toFixed(1)}s 不足段时长 ${target.duration.toFixed(1)}s，将循环/缩放`,
      });
    }
    // 图片无时长，绑定时保持原 clip duration
    const end = asset.kind === "image"
      ? target.duration
      : Math.min(asset.duration, target.duration);
    const media = current.media.find((m) => m.id === asset.id)
      ? current.media
      : [...current.media, asset];
    const nextProject: Project = {
      ...current,
      media,
      clips: current.clips.map((clip) =>
        clip.id === clipId
          ? { ...clip, sourceId: asset.id, sourceIn: 0, sourceOut: end }
          : clip,
      ),
    };
    projectRef.current = nextProject;
    setProject(nextProject);
    setSelectedClipId(clipId);
    await desktopApi.saveProject(nextProject);
    setStatus(`已绑定素材到片段`);
    void cacheAssetForProject(nextProject.id, clipId, asset);
  }

  /** 检测同一素材被多段共用，超过阈值时提示用户 */
  function detectAssetDuplication(project: Project) {
    const videoClips = project.clips.filter((c) =>
      project.tracks.some((t) => t.kind === "video" && t.id === c.trackId) && c.sourceId,
    );
    const usage = new Map<string, number>();
    for (const clip of videoClips) {
      if (clip.sourceId) {
        usage.set(clip.sourceId, (usage.get(clip.sourceId) ?? 0) + 1);
      }
    }
    usage.forEach((count, sourceId) => {
      if (count > 2) {
        const media = project.media.find((m) => m.id === sourceId);
        pushToast({
          type: "info",
          message: `素材"${media?.url ?? sourceId}"被 ${count} 段共用，建议替换部分`,
          duration: 8000,
        });
      }
    });
  }

  async function cacheAssetForProject(projectId: string, clipId: string, asset: MediaSource) {
    setAssetCachingIds((current) => new Set(current).add(asset.id));
    try {
      const cached = await desktopApi.cacheAssetVideo(asset);
      // 基于 projectRef（最新值）只更新 media 字段，绝不覆盖用户正在编辑的 script 等字段
      const latest = projectRef.current;
      if (!latest || latest.id !== projectId) return;
      const next: Project = {
        ...latest,
        media: latest.media.some((m) => m.id === cached.id)
          ? latest.media.map((m) => (m.id === cached.id ? cached : m))
          : [...latest.media, cached],
      };
      setProject(next);
      await desktopApi.saveProject(next);
      setAssetCandidates((previous) => ({
        ...previous,
        [clipId]: (previous[clipId] || []).map((candidate) =>
          candidate.id === cached.id ? cached : candidate,
        ),
      }));
    } catch (error) {
      setStatus(error instanceof Error ? `素材缓存失败：${error.message}` : "素材缓存失败");
    } finally {
      setAssetCachingIds((current) => {
        const next = new Set(current);
        next.delete(asset.id);
        return next;
      });
    }
  }

  async function searchAssetsForSelected(queryOverride?: string) {
    if (!project || !selectedClip) return;
    const query = (
      queryOverride ||
      assetQueryDraft ||
      selectedClip.visualQuery ||
      selectedClip.text ||
      ""
    ).trim();
    if (!query) {
      setStatus("请先填写素材关键词");
      return;
    }
    setBusy("asset-search");
    setStatus(`正在搜索素材：${query}`);
    // 把搜索词回写到视频 clip 的 visualQuery（下次选中仍是新词）
    if (selectedClipTrack && isVisualTrackKind(selectedClipTrack.kind) && selectedClip.visualQuery !== query) {
      updateSelectedClip({ visualQuery: query });
    }
    try {
      const assets = await desktopApi.searchPexelsVideos({ query, ratio: project.ratio, perPage: 8 });
      setAssetCandidates((previous) => ({ ...previous, [selectedClip.id]: assets }));
      if (assets[0]) {
        await bindAssetToClip(project.id, selectedClip.id, assets[0]);
        setStatus(`已拉取 ${assets.length} 个素材，第 1 个已绑定`);
      } else {
        setStatus("没有搜索到素材，可以换一个关键词");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  function syncVoiceDrafts(voices: VoiceProfile[]) {
    setVoiceNameDrafts(Object.fromEntries(voices.map((voice) => [voice.id, voice.name])));
    setVoiceReferenceDrafts(Object.fromEntries(voices.map((voice) => [voice.id, voice.referenceText || ""])));
  }

  async function handleImportVoiceProfile(file?: File) {
    if (!file) return;
    const fallbackName = file.name.replace(/\.[^.]+$/, "").trim() || "自定义音色";
    const name = newVoiceName.trim() || fallbackName;
    setBusy("voice");
    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const voice = await desktopApi.importVoiceProfile({
        name,
        fileName: file.name,
        bytes,
        referenceText: newVoiceReferenceText.trim() || null,
      });
      const voices = await desktopApi.listVoiceProfiles();
      const nextSettings = { ...settings, defaultVoiceId: voice.id };
      const savedSettings = await desktopApi.saveSettings(nextSettings);
      setSettings(savedSettings);
      setSelectedVoiceId(voice.id);
      setVoiceProfiles(voices);
      syncVoiceDrafts(voices);
      setNewVoiceName("Fish 音色");
      setNewVoiceReferenceText("");
      setStatus(`已上传音色：${voice.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteVoiceProfile(id: string) {
    setBusy("voice");
    try {
      await desktopApi.deleteVoiceProfile(id);
      const voices = await desktopApi.listVoiceProfiles();
      const nextSettings =
        settings.defaultVoiceId === id ? { ...settings, defaultVoiceId: voices[0]?.id || null } : settings;
      const savedSettings = await desktopApi.saveSettings(nextSettings);
      setSettings(savedSettings);
      setSelectedVoiceId(nextSettings.defaultVoiceId || voices[0]?.id || "");
      setVoiceProfiles(voices);
      syncVoiceDrafts(voices);
      setStatus("音色已删除");
    } finally {
      setBusy(null);
    }
  }

  async function handleSelectVoiceProfile(id: string) {
    const saved = await desktopApi.saveSettings({ ...settings, defaultVoiceId: id || null });
    setSettings(saved);
    setSelectedVoiceId(id || "");
    setStatus("默认音色已更新");
  }

  async function handleSaveVoiceProfile(id: string) {
    setBusy("voice");
    try {
      const updated = await desktopApi.updateVoiceProfile(id, {
        name: voiceNameDrafts[id] || null,
        referenceText: voiceReferenceDrafts[id] || null,
      });
      const voices = await desktopApi.listVoiceProfiles();
      setVoiceProfiles(voices);
      syncVoiceDrafts(voices);
      setStatus(`音色已保存：${updated.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  /** 为已存在的音色重新上传参考音频 */
  async function handleReplaceVoiceSample(id: string, file?: File) {
    if (!file) return;
    setBusy("voice");
    setStatus("正在替换参考音频...");
    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const updated = await desktopApi.replaceVoiceSample({
        voiceId: id,
        fileName: file.name,
        bytes,
      });
      const voices = await desktopApi.listVoiceProfiles();
      setVoiceProfiles(voices);
      syncVoiceDrafts(voices);
      setStatus(`已替换参考音频：${updated.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function handlePreviewVoiceProfile(id = settings.defaultVoiceId || "") {
    if (!id) {
      setStatus("请先选择一个默认音色");
      return;
    }
    setBusy("voice-preview");
    setVoicePreviewUrl(null);
    try {
      const result = await desktopApi.previewVoiceProfile({ voiceId: id, text: voicePreviewText });
      setVoicePreviewUrl(desktopApi.mediaSrc(result.audioPath));
      setStatus(`试听已生成：${result.duration.toFixed(1)}s`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  function handleTimelinePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("button, input") || !shouldStartTimelinePan(event.button, event.altKey)) return;
    event.preventDefault();
    const element = timelineScrollRef.current;
    if (!element) return;
    timelineDrag.current = { active: true, x: event.clientX, left: element.scrollLeft };
    element.setPointerCapture(event.pointerId);
  }

  function handleTimelinePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const element = timelineScrollRef.current;
    if (!element || !timelineDrag.current.active) return;
    element.scrollLeft = timelineDrag.current.left - (event.clientX - timelineDrag.current.x);
  }

  function handleTimelinePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!timelineDrag.current.active) return;
    const element = timelineScrollRef.current;
    timelineDrag.current.active = false;
    if (element?.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
  }

  function handleTimelineWheel(event: React.WheelEvent<HTMLDivElement>) {
    const element = timelineScrollRef.current;
    if (!element) return;
    // Ctrl/Cmd + 滚轮 = 缩放
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const factor = Math.pow(1.0015, -event.deltaY);
      setPxPerSecond((prev) => Math.max(4, Math.min(1200, prev * factor)));
      return;
    }
    // 普通滚轮 = 水平滚动
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    element.scrollLeft += event.deltaY;
  }

  function updateProjectPatch(patch: Partial<Project>) {
    if (!project) return;
    setProject({ ...project, ...patch });
  }

  /**
   * 更新选中 clip 的属性。
   * commit=true（默认）：持久化 + 压入撤销栈。
   * commit=false：只更新本地 state（滑块拖动中用），配合后续 commit=true 提交。
   */
  function updateSelectedClip(patch: Partial<Clip>, commit: boolean = true) {
    if (!project || !selectedClip) return;
    // 交互式编辑开始（首次非 commit 调用）→ 记录操作前快照
    if (!commit && !interactiveEditSnapshotRef.current) {
      interactiveEditSnapshotRef.current = structuredClone(project);
    }
    const next: Project = {
      ...project,
      clips: project.clips.map((clip) =>
        clip.id === selectedClip.id ? { ...clip, ...patch } : clip,
      ),
    };
    setProject(next);
    if (commit) {
      const snapshot = interactiveEditSnapshotRef.current;
      interactiveEditSnapshotRef.current = null;
      void persistWithSnapshot(next, snapshot, "已更新属性");
    }
  }

  /** 提交交互式编辑（滑块释放时调用）：用开始时的快照压入撤销栈并持久化 */
  function commitInteractiveEdit(message = "已更新属性") {
    if (!project || !interactiveEditSnapshotRef.current) return;
    const snapshot = interactiveEditSnapshotRef.current;
    interactiveEditSnapshotRef.current = null;
    void persistWithSnapshot(project, snapshot, message);
  }

  /** 工具栏分割：在 playhead 处把当前选中的 clip 一分为二。 */
  function splitAtPlayhead() {
    if (!project) return;
    const currentTime = usePlaybackStore.getState().currentTime;
    const result = splitVisualClipAtPlayhead(project, currentTime, selectedClip);
    if (!result) {
      setStatus("播放头位置没有可分割的片段");
      return;
    }
    applyClipOperation(result);
  }

  /** 涟漪删除：删除 clip 后同轨道后续 clip 前移闭合间隙 */
  function deleteSelectedClip(ripple = true) {
    if (!project || !selectedClip) return;
    applyClipOperation(buildDeleteClipChange(project, selectedClip, ripple));
  }

  /** T4.6: 批量删除多个选中 clip */
  function deleteSelectedClips(ripple = true) {
    if (project && selectedClipIds.length > 0) {
      applyClipOperation(buildDeleteClipsChange(project, selectedClipIds, ripple));
    }
  }

  /** T4.6: 选中 clip（additive=true 时 Ctrl/Cmd+点击多选） */
  function selectClip(id: string, additive: boolean, range: boolean = false) {
    setSelectedClipIds((prev) => selectClipIds(project, prev, id, additive, range));
  }

  function selectClipsByBox(ids: string[], additive: boolean) {
    setSelectedClipIds((prev) => selectClipIdsByBox(prev, ids, additive));
  }

  /** 复制选中 clip 到剪贴板（Ctrl+C 的工具栏入口） */
  function copySelectedClip() {
    if (!selectedClip) return;
    clipboardRef.current = structuredClone(selectedClip);
    setStatus("已复制片段");
  }

  /** 复制选中 clip（原地复制，偏移 0.5s 避免重叠） */
  function duplicateSelectedClip() {
    if (!project || !selectedClip) return;
    applyClipOperation(buildDuplicateClipChange(project, selectedClip, newClipId));
  }

  /** 粘贴剪贴板里的 clip 到选中轨道末尾 */
  function pasteClip() {
    if (!project || !clipboardRef.current) return;
    applyClipOperation(pasteClipAtTrackEnd(project, clipboardRef.current, newClipId));
  }

  /** 项目下拉菜单切换项目 */
  async function handleSelectProject(id: string) {
    const next = await desktopApi.getProject(id);
    setProject(next);
    setSelectedClipId(next.clips[0]?.id || null);
    resetEditorMode();
    setStatus(`已切换到项目：${next.title}`);
  }

  /** 转场 Tab：把转场效果应用到当前选中 clip 的入场/出场转场 */
 function handleApplyTransition(transitionId: string) {
    if (!project || !selectedClip) return;
    const duration = transitionDuration(selectedClip.transitionIn, project.renderConfig.transitionDuration ?? 0.5);
    const patch = { transitionIn: makeTransition(transitionId, duration) };
    updateSelectedClip(patch);
  }
  function handleApplyTransitionOut(transitionId: string) {
    if (!project || !selectedClip) return;
    const duration = transitionDuration(selectedClip.transitionOut, project.renderConfig.transitionDuration ?? 0.5);
    updateSelectedClip({ transitionOut: makeTransition(transitionId, duration) });
  }

  /** 添加新轨道（视频/配音/音频/字幕） */
  async function handleAddTrack(kind: TrackKind) {
    setShowAddTrackMenu(false);
    if (!project) return;
    const name = nextTrackName(project, kind);
    try {
      const next = await desktopApi.addTrack(project.id, kind, name);
      setProject(next);
      await refreshProjects(next.id);
      setStatus(`已添加${TRACK_KIND_LABELS[kind]}轨`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** 时间线拖拽回写：拖动中只更新本地 state（不保存），释放时提交。 */
  // 交互式编辑（拖拽/滑块）开始时记录快照，commit 时用它压入撤销栈（避免中间态污染）
  const interactiveEditSnapshotRef = useRef<Project | null>(null);
  useEffect(() => {
    interactiveEditSnapshotRef.current = null;
  }, [project?.id]);
  function handleClipDrag(clipId: string, patch: Partial<Clip>, commit: boolean) {
    if (!project) return;
    // 拖拽开始（首次非 commit 调用，且还没记录快照）→ 记录操作前快照
    if (!commit && !interactiveEditSnapshotRef.current) {
      interactiveEditSnapshotRef.current = structuredClone(project);
    }
    const snapshot = interactiveEditSnapshotRef.current;
    const draggedOriginal = snapshot?.clips.find((c) => c.id === clipId);
    const isGroupMove =
      selectedClipIds.length > 1 &&
      selectedClipIds.includes(clipId) &&
      draggedOriginal &&
      typeof patch.startOnTrack === "number" &&
      (patch.duration === undefined || Math.abs(patch.duration - draggedOriginal.duration) < 0.001) &&
      (patch.sourceIn === undefined || Math.abs(patch.sourceIn - draggedOriginal.sourceIn) < 0.001) &&
      (patch.sourceOut === undefined || Math.abs(patch.sourceOut - draggedOriginal.sourceOut) < 0.001);
    const selectedSet = new Set(selectedClipIds);
    const delta = isGroupMove ? (patch.startOnTrack! - draggedOriginal!.startOnTrack) : 0;
    const baseProject = isGroupMove && snapshot ? snapshot : project;
    const next: Project = {
      ...baseProject,
      clips: baseProject.clips.map((c) => {
        if (isGroupMove && selectedSet.has(c.id)) {
          return { ...c, startOnTrack: Math.max(0, c.startOnTrack + delta) };
        }
        return c.id === clipId ? { ...c, ...patch } : c;
      }),
    };
    setProject(next);
    if (commit) {
      // 用拖拽开始时的快照压入撤销栈，而非当前（已被中间态污染的）project
      const snapshot = interactiveEditSnapshotRef.current;
      interactiveEditSnapshotRef.current = null;
      void persistWithSnapshot(next, snapshot, "已调整片段");
    }
  }

  function handleClipCommit(_clipId: string) {
    // 兼容旧调用点（已由 handleClipDrag commit=true 取代）
  }

  /**
   * 插入 clip 到轨道的指定位置（剪映式插入模式）：
   * - 找到插入位置后第一个 clip（startOnTrack >= 插入点）
   * - 把该 clip 及之后所有 clip 往后推（推 = 新 clip 的时长）
   * - 新 clip 紧贴前一个 clip 末尾（或轨道开头）
   */
  function insertClipToTrack(project: Project, trackId: string, newClip: Clip, insertAt: number): Project {
    const trackClips = project.clips.filter((c) => c.trackId === trackId);
    // 插入位置前的最后一个 clip 的末尾（新 clip 的实际起始）
    const beforeClips = trackClips.filter((c) => c.startOnTrack + c.duration <= insertAt + 0.05);
    const beforeEnd = beforeClips.reduce((max, c) => Math.max(max, c.startOnTrack + c.duration), 0);
    // 新 clip 起始 = max(插入点, 前一个 clip 的末尾) —— 紧贴
    const actualStart = Math.max(insertAt, beforeEnd);
    // 需要往后推的 clip（在新 clip 之后或重叠的）
    const pushStart = actualStart + newClip.duration;
    const updatedClips = project.clips.map((c) => {
      if (c.trackId !== trackId) return c;
      // 在新 clip 范围内或之后的 clip 往后推
      if (c.startOnTrack >= actualStart - 0.05) {
        return { ...c, startOnTrack: c.startOnTrack + newClip.duration };
      }
      return c;
    });
    return {
      ...project,
      clips: [...updatedClips, { ...newClip, startOnTrack: actualStart }],
    };
  }

  /** 导入本地素材：原生文件对话框 → import_media 拷贝进数据目录 → 加入素材库 */
  async function handleImportLocal() {
    if (!project) return;
    const sourcePath = await desktopApi.pickMediaFile();
    if (!sourcePath) return;
    setBusy("library-import");
    setStatus("正在导入本地素材...");
    try {
      const media = await desktopApi.importMedia(sourcePath);
      const next: Project = {
        ...project,
        media: project.media.some((m) => m.id === media.id) ? project.media : [...project.media, media],
      };
      void persist(next, `已导入素材：${media.title}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  /** 搜索 Pexels，结果加入素材库（而非直接绑到某 clip） */
  async function handleSearchPexelsLibrary(query: string) {
    if (!project) return;
    setBusy("library-search");
    setStatus(`正在搜索 Pexels 视频：${query}`);
    try {
      const assets = await desktopApi.searchPexelsVideos({ query, ratio: project.ratio, perPage: 8 });
      // 合并去重加入素材库
      const existing = new Set(project.media.map((m) => m.id));
      const additions = assets.filter((a) => !existing.has(a.id));
      const next: Project = { ...project, media: [...project.media, ...additions] };
      void persist(next, `已加入 ${additions.length} 个视频素材到素材库`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  /** 搜索 Pexels 图片，结果加入素材库 */
  async function handleSearchPexelsPhotos(query: string) {
    if (!project) return;
    setBusy("library-search");
    setStatus(`正在搜索 Pexels 图片：${query}`);
    try {
      const assets = await desktopApi.searchPexelsPhotos({ query, ratio: project.ratio, perPage: 8 });
      const existing = new Set(project.media.map((m) => m.id));
      const additions = assets.filter((a) => !existing.has(a.id));
      const next: Project = { ...project, media: [...project.media, ...additions] };
      void persist(next, `已加入 ${additions.length} 张图片到素材库`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  /**
   * 素材库点击：替换当前选中的视频 clip 素材；若没选中视频 clip 则追加到视频轨末尾。
   * 基于最新 project（projectRef）避免竞态。
   */
  async function handleAddToTimeline(asset: MediaSource) {
    const current = projectRef.current;
    if (!current) return;
    // 把素材加入素材库（去重）
    const media = current.media.some((m) => m.id === asset.id)
      ? current.media
      : [...current.media, asset];
    const currentWithMedia = { ...current, media };

    const selectedTrack = selectedClip
      ? current.tracks.find((track) => track.id === selectedClip.trackId)
      : null;
    const selectedIsCompatible = !!selectedClip && !!selectedTrack && assetFitsTrack(asset, selectedTrack);

    if (selectedIsCompatible && selectedClip) {
      // 替换：把选中 clip 的 sourceId 换成该素材，重置裁剪范围
      // 图片无时长（duration=0），替换时保持原 clip duration；视频取 min(素材时长, clip时长)
      const end = asset.kind === "image"
        ? selectedClip.duration
        : Math.min(asset.duration, selectedClip.duration);
      const next: Project = {
        ...currentWithMedia,
        media,
        clips: currentWithMedia.clips.map((clip) =>
          clip.id === selectedClip.id
            ? { ...clip, sourceId: asset.id, sourceIn: 0, sourceOut: end }
            : clip,
        ),
      };
      void persist(next, `已替换素材：${asset.title}`);
      // Pexels 素材需后台缓存下载
      if (asset.source === "pexels" && !asset.localPath) {
        void cacheAssetForProject(next.id, selectedClip.id, asset);
      }
      return;
    }

    // 追加：按素材类型选择/创建匹配轨道
    const { project: projectWithTrack, track: targetTrack } = ensureTrackForAsset(currentWithMedia, asset);
    const trackClips = projectWithTrack.clips.filter((c) => c.trackId === targetTrack.id);
    const endTime = trackClips.reduce((max, c) => Math.max(max, c.startOnTrack + c.duration), 0);
    // 视频/音频用真实时长，图片无时长默认 5 秒
    const clipDuration = asset.kind === "image" ? 5 : (asset.duration || 5);
    const newClip: Clip = {
      id: newClipId(),
      trackId: targetTrack.id,
      sourceId: asset.id,
      startOnTrack: endTime,
      duration: clipDuration,
      sourceIn: 0,
      sourceOut: clipDuration,
      speed: 1,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      brightness: 0,
      contrast: 0,
      saturation: 0,
      transform: { ...DEFAULT_TRANSFORM },
      transitionIn: null,
      transitionOut: null,
    };
    const next: Project = insertClipToTrack(projectWithTrack, targetTrack.id, newClip, endTime);
    void persist(next, `已添加到时间线：${asset.title}`);
    setSelectedClipId(newClip.id);
    if (asset.source === "pexels" && !asset.localPath) {
      void cacheAssetForProject(next.id, newClip.id, asset);
    }
  }

  /**
   * 素材库拖拽放置到指定轨道：磁吸到该轨道最后一个 clip 的末尾（剪映式贴合）。
   * 如果光标位置离某个已有 clip 边缘很近，则吸附到那个位置；否则追加到末尾。
   */
  function handleDropAssetToTrack(trackId: string, assetId: string, startOnTrack: number) {
    const current = projectRef.current;
    if (!current) return;
    const asset = current.media.find((m) => m.id === assetId);
    if (!asset) return;
    const track = current.tracks.find((t) => t.id === trackId);
    if (!track) return;
    if (!assetFitsTrack(asset, track)) {
      setStatus(`${asset.kind === "audio" ? "音频" : asset.kind === "image" ? "图片" : "视频"}素材不能添加到${TRACK_KIND_LABELS[track.kind]}轨`);
      return;
    }

    // 磁吸对齐：收集所有轨道所有 clip 的起止边界，光标接近就吸附
    const SNAP_THRESHOLD = 0.4; // 0.4 秒内吸附
    const snapPoints: number[] = [0]; // 轨道起点
    for (const c of current.clips) {
      snapPoints.push(c.startOnTrack);
      snapPoints.push(c.startOnTrack + c.duration);
    }
    let snappedStart = startOnTrack;
    for (const snap of snapPoints) {
      if (Math.abs(startOnTrack - snap) < SNAP_THRESHOLD) {
        snappedStart = snap;
        break;
      }
    }

    // 使用吸附后的位置（已对齐到所有轨道的 clip 边界）
    const finalStart = Math.max(0, snappedStart);

    const clipDuration = asset.kind === "image"
      ? 5
      : (asset.duration || 5);
    const newClip: Clip = {
      id: newClipId(),
      trackId,
      sourceId: asset.id,
      startOnTrack: finalStart,
      duration: clipDuration,
      sourceIn: 0,
      sourceOut: clipDuration,
      speed: 1,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      brightness: 0,
      contrast: 0,
      saturation: 0,
      transform: track.kind === "video" || track.kind === "image" ? { ...DEFAULT_TRANSFORM } : null,
      transitionIn: null,
      transitionOut: null,
    };
    // 用插入模式：放到光标位置，后面的 clip 自动往后推
    const updatedMedia = current.media.some((m) => m.id === asset.id)
      ? current.media
      : [...current.media, asset];
    const nextWithMedia = { ...current, media: updatedMedia };
    const next = insertClipToTrack(nextWithMedia, trackId, newClip, finalStart);
    void persist(next, `已添加到${track.name}：${asset.title}`);
    setSelectedClipId(newClip.id);
    if (asset.source === "pexels" && !asset.localPath) {
      void cacheAssetForProject(next.id, newClip.id, asset);
    }
  }

  const timelineWidth = Math.max(840, totalDuration * pxPerSecond);
  const clipsByTrackId = useMemo(() => {
    const map = new Map<string, Clip[]>();
    if (!project) return map;
    for (const track of project.tracks) {
      map.set(track.id, []);
    }
    for (const clip of project.clips) {
      const clips = map.get(clip.trackId);
      if (clips) clips.push(clip);
    }
    return map;
  }, [project?.clips, project?.tracks]);
  const handleTimelineSelectClip = useCallback((id: string, additive: boolean, range?: boolean) => {
    selectClip(id, additive, range);
    const c = project?.clips.find((clip) => clip.id === id);
    if (c && !additive && !range) seek(c.startOnTrack);
  }, [project, selectedClipId, seek]);
  const handleTimelineContextMenu = useCallback((clip: Clip, trackKind: string, x: number, y: number) => {
    setSelectedClipId(clip.id);
    setContextMenu({ x, y, clip, trackKind: trackKind as TrackKind });
  }, []);
  const handleTimelineToggleMute = useCallback((trackId: string) => {
    if (!project) return;
    void persist(toggleTrackMuted(project, trackId), "已切换静音");
  }, [project]);
  const handleTimelineToggleLock = useCallback((trackId: string) => {
    if (!project) return;
    void persist(toggleTrackLocked(project, trackId), "已切换锁定");
  }, [project]);
  const handleTimelineToggleHidden = useCallback((trackId: string) => {
    if (!project) return;
    void persist(toggleTrackHidden(project, trackId), "已切换显示");
  }, [project]);

  // 章节标记：在播放头处添加/删除
  const handleAddChapter = useCallback(() => {
    if (!project) return;
    const t = usePlaybackStore.getState().currentTime;
    const chapters = project.chapters ?? [];
    // 已存在则不重复添加
    if (chapters.some((c) => Math.abs(c.time - t) < 0.5)) {
      setStatus("该位置已有章节标记");
      return;
    }
    const newChapter: Chapter = {
      id: `chap_${Date.now().toString(36)}`,
      time: t,
      title: `章节 ${chapters.length + 1}`,
    };
    const next = [...chapters, newChapter].sort((a, b) => a.time - b.time);
    void persist({ ...project, chapters: next }, "已添加章节");
  }, [project]);

  const handleDeleteChapter = useCallback((chapterId: string) => {
    if (!project) return;
    const next = (project.chapters ?? []).filter((c) => c.id !== chapterId);
    void persist({ ...project, chapters: next }, "已删除章节");
  }, [project]);
  const handleTimelineMoveUp = useCallback((trackId: string) => {
    if (!project) return;
    const next = moveTrack(project, trackId, "up");
    if (next) void persist(next, "已上移图层");
  }, [project]);
  const handleTimelineMoveDown = useCallback((trackId: string) => {
    if (!project) return;
    const next = moveTrack(project, trackId, "down");
    if (next) void persist(next, "已下移图层");
  }, [project]);
  const handleTimelineDeleteTrack = useCallback((trackId: string) => {
    if (!project) return;
    const next = deleteTrack(project, trackId);
    if (next) void persist(next, "已删除轨道");
  }, [project]);

  // 字幕轨头部"统一调整样式"：取该轨第一条字幕样式作为草稿初始值
  const handleEditSubtitleStyle = useCallback((trackId: string) => {
    if (!project) return;
    const track = project.tracks.find((t) => t.id === trackId);
    if (!track || track.kind !== "subtitle") return;
    const firstSub = project.clips.find((c) => c.trackId === trackId);
    const initial: SubtitleStyle = firstSub?.subtitleStyle
      ? { ...DEFAULT_SUBTITLE_STYLE, ...firstSub.subtitleStyle }
      : { ...DEFAULT_SUBTITLE_STYLE };
    setSubtitleTrackStyleEditing({ trackId, draft: initial });
  }, [project]);

  // 提交：把 draft 一次性应用到该轨所有字幕（draft 覆盖原有字段，实现"统一"语义）
  const applySubtitleTrackStyle = useCallback(() => {
    if (!project || !subtitleTrackStyleEditing) return;
    const { trackId, draft } = subtitleTrackStyleEditing;
    const targetIds = new Set(
      project.clips.filter((c) => c.trackId === trackId).map((c) => c.id),
    );
    if (targetIds.size === 0) {
      setSubtitleTrackStyleEditing(null);
      return;
    }
    const next = project.clips.map((c) =>
      targetIds.has(c.id)
        ? { ...c, subtitleStyle: { ...(c.subtitleStyle ?? {}), ...draft } }
        : c,
    );
    void persist({ ...project, clips: next }, `已统一应用字幕样式到本轨 ${targetIds.size} 条`);
    setSubtitleTrackStyleEditing(null);
  }, [project, subtitleTrackStyleEditing]);

  // 调整 draft 字段（不实时应用到字幕，提交时才生效）
  const updateSubtitleTrackDraft = useCallback((patch: Partial<SubtitleStyle>) => {
    setSubtitleTrackStyleEditing((cur) => cur ? { ...cur, draft: { ...cur.draft, ...patch } } : cur);
  }, []);

  const handleKeyframeClick = useCallback((clipId: string, _prop: keyof ClipKeyframes, time: number) => {
    const clip = project?.clips.find((c) => c.id === clipId);
    if (!clip) return;
    const track = project?.tracks.find((candidate) => candidate.id === clip.trackId);
    selectClip(clipId, false, false);
    if (track) {
      setInspectorTabForTrack(track.kind, inspectorTabForInteraction("keyframe", track.kind));
    }
    seek(Math.max(0, clip.startOnTrack + time));
  }, [project, seek, setInspectorTabForTrack]);
  const selectedSource = selectedClip?.sourceId
    ? project?.media.find((m) => m.id === selectedClip.sourceId)
    : null;
  const selectedMediaSrc = desktopApi.mediaSrc(selectedSource?.localPath || null);
  // 素材库悬停预览的 src（图片直接显示，视频显示缩略/首帧）
  const previewingSrc = previewingAsset
    ? desktopApi.mediaSrc(previewingAsset.thumbnailUrl || previewingAsset.localPath || null)
    : null;
  const availableInspectorTabs = selectedClipTrack
    ? inspectorTabsForSelection(selectedClipTrack.kind, selectedClipIds.length)
    : [];
  const resolvedInspectorTab = selectedClipTrack
    ? selectedClipIds.length > 1
      ? availableInspectorTabs[0] ?? "basic"
      : resolveInspectorTab(selectedClipTrack.kind, activeInspectorTab)
    : "basic";

  // 诊断：错误日志已改为 main.tsx 自动写文件，不再在 UI 显示
  const sharedOverlays = (
    <>
      <GenerateWizard
        open={showGenerate}
        onClose={() => { setShowGenerate(false); resetPipeline(); }}
        voiceProfiles={voiceProfiles}
        hasDeepSeekKey={!!settings.deepseekApiKey}
        hasPexelsKey={!!settings.pexelsApiKey}
        hasFishAudioKey={!!settings.fishAudioApiKey}
        hasFishAudioVoice={!!settings.fishAudioReferenceId}
        pipeline={pipeline}
        onStart={(input) => handleGeneratePipeline(input)}
        onError={(msg) => setStatus(msg)}
      />
      {showSettings && (
        <UnifiedSettingsDialog
          settings={settingsDraft}
          appInfo={appInfo}
          ffmpeg={ffmpeg}
          whisperStatus={whisperModelStatus}
          busy={busy}
          onChange={setSettingsDraft}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
          onDownloadWhisper={openWhisperSetup}
          onSelectWhisper={handleSelectWhisperModel}
          onDeleteWhisper={handleDeleteWhisperModel}
          onOpenModelsDirectory={handleOpenModelsDirectory}
        />
      )}
      <WhisperSetupDialog
        open={whisperSetupOpen}
        status={whisperModelStatus}
        progress={whisperDownloadProgress}
        busy={busy === "whisper-download" || busy === "whisper-select"}
        error={whisperSetupError}
        onDownload={handleDownloadWhisperModel}
        onSelectLocal={handleSelectWhisperModel}
        onContinue={() => { void resumePendingWhisperAction(); }}
        onCancelDownload={handleCancelWhisperDownload}
        onCancel={cancelPendingWhisperAction}
      />
    </>
  );

  // 首页 vs 编辑器
  if (view === "home") {
    return (
      <>
      <HomeScreen
        projects={projects}
        onOpen={async (id) => {
          const p = await desktopApi.getProject(id);
          setProject(p);
          setSelectedClipId(p.clips[0]?.id || null);
          resetEditorMode();
          setView("editor");
        }}
        onCreate={async () => {
          await handleCreateProject();
          resetEditorMode();
          setView("editor");
        }}
        onGenerate={() => setShowGenerate(true)}
        onRename={async (id, name) => {
          const p = await desktopApi.getProject(id);
          await desktopApi.saveProject({ ...p, title: name });
          await refreshProjects();
        }}
        onDuplicate={async (id) => {
          const p = await desktopApi.getProject(id);
          const dup: Project = {
            ...JSON.parse(JSON.stringify(p)),
            id: `project_${Math.random().toString(16).slice(2)}`,
            title: `${p.title} 副本`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          await desktopApi.saveProject(dup);
          await refreshProjects();
        }}
        onDelete={async (id) => {
          await desktopApi.deleteProject(id);
          await refreshProjects();
        }}
        settings={settings}
        whisperStatus={whisperModelStatus}
        onSettings={() => openSettings()}
        onDownloadWhisper={openWhisperSetup}
      />
      {sharedOverlays}
      </>
    );
  }

  return (
    <div className={`app-shell editor-mode-${editorMode}`}>
      <ToastContainer />
      <EditorTopbar
        mode={editorMode}
        projectTitle={project?.title || ""}
        ratio={project?.ratio || settings.defaultRatio}
        ratios={ratios}
        canUndo={canUndo}
        canRedo={canRedo}
        canSave={!!project}
        projectMenu={(
          <ProjectMenu
            projects={projects}
            activeProjectId={project?.id}
            onSelect={handleSelectProject}
            onCreate={handleCreateProject}
            onDelete={handleDeleteProject}
          />
        )}
        saveStatus={ffmpeg?.available ? null : <StatusPill ffmpeg={ffmpeg} />}
        onBack={() => { void refreshProjects(); setView("home"); }}
        onGenerate={() => setShowGenerate(true)}
        onProjectTitleChange={(title) => updateProjectPatch({ title })}
        onRatioChange={(ratio) => updateProjectPatch({ ratio })}
        onUndo={undo}
        onRedo={redo}
        onSave={() => project && persist(project)}
        onModeChange={setEditorMode}
        onSettings={() => openSettings()}
        onExport={() => { setShowExport(true); setExportState("idle"); }}
      />

      <EditorWorkspace
        mode={editorMode}
        tools={(
        <aside className="left-panel">
          <ToolRail activeTab={activeToolTab} onTabChange={setActiveToolTab} />
          <ToolPanel title={TOOL_TABS.find((tab) => tab.id === activeToolTab)?.label ?? "工具"}>
            {activeToolTab === "media" && (
              <MediaPanel
                media={project?.media || []}
                busy={busy}
                previewingId={previewingAsset?.id}
                onImportLocal={handleImportLocal}
                onSearchVideos={handleSearchPexelsLibrary}
                onSearchPhotos={handleSearchPexelsPhotos}
                onPreview={setPreviewingAsset}
                onAddToTimeline={handleAddToTimeline}
              />
            )}
            {activeToolTab === "text" && (
              <TextPanel
                script={project?.script || ""}
                busy={busy}
                onScriptChange={(script) => updateProjectPatch({ script })}
                onAiSegment={handleSegmentScript}
              />
            )}
            {activeToolTab === "subtitle" && (
              <SubtitlePanel
                busy={busy}
                onRecognizeSubtitles={handleRecognizeSubtitles}
                onAddManualSubtitle={handleAddManualSubtitle}
                onImportSrt={handleImportSrt}
                subtitleStyle={subtitleStyleDraft}
                onSubtitleStyleChange={setSubtitleStyleDraft}
              />
            )}
            {activeToolTab === "audio" && (
              <AudioPanel
                voiceProfiles={voiceProfiles}
                defaultVoiceId={settings.defaultVoiceId ?? null}
                selectedVoiceId={selectedVoiceId}
                previewText={voicePreviewText}
                previewUrl={voicePreviewUrl}
                busy={busy}
                voiceNameDrafts={voiceNameDrafts}
                voiceReferenceDrafts={voiceReferenceDrafts}
                newVoiceName={newVoiceName}
                newVoiceReferenceText={newVoiceReferenceText}
                onSelectVoice={(id) => {
                  setSelectedVoiceId(id);
                  void handleSelectVoiceProfile(id);
                }}
                onGenerateAllAudio={handleGenerateProjectAudio}
                onImportVoice={handleImportVoiceProfile}
                onPreviewVoice={handlePreviewVoiceProfile}
                onPreviewTextChange={setVoicePreviewText}
                onDeleteVoice={handleDeleteVoiceProfile}
                onSaveVoice={handleSaveVoiceProfile}
                onReplaceVoice={handleReplaceVoiceSample}
                onNameDraftChange={(id, value) =>
                  setVoiceNameDrafts((current) => ({ ...current, [id]: value }))
                }
                onReferenceDraftChange={(id, value) =>
                  setVoiceReferenceDrafts((current) => ({ ...current, [id]: value }))
                }
                onNewVoiceNameChange={setNewVoiceName}
                onNewVoiceReferenceTextChange={setNewVoiceReferenceText}
              />
            )}
            {activeToolTab === "transition" && (
              <TransitionPanel
                selectedClipId={selectedClipId}
                currentTransitionIn={transitionName(selectedClip?.transitionIn)}
                currentTransitionOut={transitionName(selectedClip?.transitionOut)}
                currentDurationIn={transitionDuration(selectedClip?.transitionIn, project?.renderConfig?.transitionDuration ?? 0.5)}
                currentDurationOut={transitionDuration(selectedClip?.transitionOut, project?.renderConfig?.transitionDuration ?? 0.5)}
                onApplyIn={handleApplyTransition}
                onApplyOut={handleApplyTransitionOut}
                onDurationChangeIn={(d) => {
                  if (!selectedClip) return;
                  const name = transitionName(selectedClip.transitionIn);
                  if (!name || name === "none") return;
                  updateSelectedClip({ transitionIn: makeTransition(name, d) }, false);
                }}
                onDurationCommitIn={() => commitInteractiveEdit("已更新转场时长")}
                onDurationChangeOut={(d) => {
                  if (!selectedClip) return;
                  const name = transitionName(selectedClip.transitionOut);
                  if (!name || name === "none") return;
                  updateSelectedClip({ transitionOut: makeTransition(name, d) }, false);
                }}
                onDurationCommitOut={() => commitInteractiveEdit("已更新转场时长")}
              />
            )}
            {activeToolTab === "effects" && (
              <EffectsPanel
                hasVisualSelection={!!selectedClipTrack && isVisualTrackKind(selectedClipTrack.kind)}
                onOpenFilters={() => {
                  if (!selectedClipTrack) return;
                  setInspectorTabForTrack(selectedClipTrack.kind, "visual");
                  requestAnimationFrame(() => document.querySelector('[data-inspector-section="filters"]')?.scrollIntoView({ block: "start" }));
                }}
                onOpenMasks={() => {
                  if (!selectedClipTrack) return;
                  setInspectorTabForTrack(selectedClipTrack.kind, "visual");
                  requestAnimationFrame(() => document.querySelector('[data-inspector-section="mask"]')?.scrollIntoView({ block: "start" }));
                }}
                onOpenVisualEffects={() => {
                  if (!selectedClipTrack) return;
                  setInspectorTabForTrack(selectedClipTrack.kind, "animation");
                  requestAnimationFrame(() => document.querySelector('[data-inspector-section="visual-effects"]')?.scrollIntoView({ block: "start" }));
                }}
              />
            )}
          </ToolPanel>
        </aside>
        )}
        preview={(
        <PreviewWorkspace
          toolbar={(
          <div className="preview-toolbar">
            <div>
              <strong>画面预览</strong>
              <span>{selectedClip?.text || selectedSource?.title || "未选择片段"}</span>
            </div>
            <div className="preview-zoom-controls">
              <button
                className="zoom-btn preview-cover-button"
                title="将当前画面设为封面"
                disabled={!project}
                onClick={() => {
                  if (!project) return;
                  const coverTime = usePlaybackStore.getState().currentTime;
                  void persist({ ...project, coverTime }, `已设置封面（${coverTime.toFixed(1)}s）`);
                }}
              >
                <ImagePlay size={14} />
                <span>设为封面</span>
              </button>
              <button className="zoom-btn" title="缩小" onClick={() => setPreviewZoom((z) => Math.max(25, z - 25))}>
                <ZoomOut size={14} />
              </button>
              <select
                value={previewZoom}
                onChange={(e) => setPreviewZoom(Number(e.target.value))}
                className="zoom-select"
              >
                <option value={100}>适配</option>
                <option value={25}>25%</option>
                <option value={50}>50%</option>
                <option value={75}>75%</option>
                <option value={150}>150%</option>
                <option value={200}>200%</option>
              </select>
              <button className="zoom-btn" title="放大" onClick={() => setPreviewZoom((z) => Math.min(200, z + 25))}>
                <ZoomIn size={14} />
              </button>
              {isDevelopmentPreview && (
                <button
                  className={`zoom-btn ${showPreviewDebug ? "active" : ""}`}
                  title="预览诊断"
                  aria-label="预览诊断"
                  onClick={() => setShowPreviewDebug((current) => !current)}
                >
                  <SlidersHorizontal size={14} />
                </button>
              )}
            </div>
          </div>
          )}
          viewport={(
          <div
            ref={previewViewportRef}
            className="preview-viewport"
          >
          <div
            ref={stageRef}
            className={`phone-stage ratio-${(project?.ratio || "9:16").replace(":", "-")}`}
            style={{ transform: `scale(${previewZoom / 100})`, transformOrigin: "center center" }}
          >
            <div className="stage-grid" />
            {/* 素材库悬停预览覆盖层：优先级最高，悬停素材时大图预览 */}
            {previewingSrc && (
              <div className="stage-preview-overlay">
                {previewingAsset?.kind === "audio" ? (
                  <div className="stage-preview-audio">
                    <Mic2 size={48} />
                    <strong>{previewingAsset.title}</strong>
                    <span>音频素材 · {previewingAsset.duration.toFixed(1)}s</span>
                  </div>
                ) : (
                  <img src={previewingSrc} alt={previewingAsset?.title} />
                )}
              </div>
            )}
            {/* 主轨媒体元素由 PreviewEngine 的 MediaElementPool 动态管理 */}
            {/* WebGL 滤镜 canvas：覆盖在 video 上，GPU shader 实时处理滤镜 */}
            <canvas ref={filterCanvasRef} className="stage-filter-canvas" />
            {/* 画中画叠加层：上层视频轨 clip 按 transform 叠加显示 */}
            {/* T4.1: 画中画叠加层容器 —— PreviewEngine 在里面动态管理 overlay <video> */}
            <div ref={overlayContainerRef} className="stage-overlay-container" />
            {showPreviewDebug && (
              <div className="preview-debug-panel">
                {Object.entries(previewDebugInfo).map(([key, value]) => (
                  <div key={key}>
                    <span>{key}</span>
                    <code>{value}</code>
                  </div>
                ))}
              </div>
            )}
            {!activeVideoClip && !selectedMediaSrc && (
              <div className="stage-content">
                <ImagePlay size={46} />
                <strong>{selectedSource?.title || "选择片段后在这里预览画面"}</strong>
                <span>{selectedClip?.text || "暂无片段"}</span>
              </div>
            )}
            {/* 字幕叠层：选中字幕 clip 时用 SubtitleOverlay（react-moveable）；否则纯渲染 */}
            {(() => {
              const isSelectedSubtitle = selectedClipTrack?.kind === "subtitle" && !!selectedClip;
              // 编辑模式优先：双击字幕 → textarea 直接编辑
              if (isSelectedSubtitle && subtitleEditing && selectedClip) {
                const s = selectedClip.subtitleStyle ?? { ...DEFAULT_SUBTITLE_STYLE };
                return (
                  <textarea
                    key="subtitle-edit"
                    className="subtitle-overlay-edit"
                    autoFocus
                    value={selectedClip.text || ""}
                    style={{
                      position: "absolute",
                      left: `${s.x ?? 50}%`,
                      top: `${s.y ?? 80}%`,
                      transform: `translate(-50%, -50%) rotate(${s.rotation ?? 0}deg) scale(${(s.scaleX ?? 100) / 100})`,
                      transformOrigin: "center",
                      fontFamily: s.fontFamily,
                      fontSize: `${Math.max(8, (s.fontSize ?? 48) * fontScale)}px`,
                      fontWeight: 700,
                      lineHeight: 1.4,
                      color: s.color,
                      textShadow: `1px 1px 0 ${s.strokeColor}, -1px -1px 0 ${s.strokeColor}, 1px -1px 0 ${s.strokeColor}, -1px 1px 0 ${s.strokeColor}`,
                      padding: "4px 10px",
                      textAlign: "center",
                      whiteSpace: "pre-wrap",
                      maxWidth: "86%",
                      zIndex: 8,
                      border: "1.5px solid var(--accent)",
                      background: "rgba(0,0,0,0.3)",
                      borderRadius: 2,
                      resize: "none",
                      outline: "none",
                    }}
                    onChange={(e) => updateSelectedClip({ text: e.target.value }, false)}
                    onBlur={() => {
                      commitInteractiveEdit();
                      setSubtitleEditing(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape" || (e.key === "Enter" && e.metaKey)) {
                        e.preventDefault();
                        commitInteractiveEdit();
                        setSubtitleEditing(false);
                      }
                    }}
                  />
                );
              }
              // 选中字幕：StageSubtitleLayer（按时间轴显示）+ SubtitleOverlay（编辑手柄）
              // 选中字幕若与当前播放字幕相同，StageSubtitleLayer 跳过避免重复
              if (isSelectedSubtitle && selectedClip) {
                return (
                  <>
                    <StageSubtitleLayer excludeClipId={selectedClip.id} fontScale={fontScale} />
                    <SubtitleOverlay
                      clip={selectedClip}
                      targetRef={stageRef}
                      isSelected
                      fontScale={fontScale}
                      onMove={(x, y) => {
                        const cur = selectedClip.subtitleStyle ?? { ...DEFAULT_SUBTITLE_STYLE };
                        updateSelectedClip({ subtitleStyle: { ...cur, position: "custom", x, y } }, false);
                      }}
                      onMoveEnd={() => commitInteractiveEdit()}
                      onScale={(sx, sy) => {
                        const cur = selectedClip.subtitleStyle ?? { ...DEFAULT_SUBTITLE_STYLE };
                        updateSelectedClip({ subtitleStyle: { ...cur, scaleX: sx, scaleY: sy } }, false);
                      }}
                      onScaleEnd={() => commitInteractiveEdit()}
                      onRotate={(rotation) => {
                        const cur = selectedClip.subtitleStyle ?? { ...DEFAULT_SUBTITLE_STYLE };
                        updateSelectedClip({ subtitleStyle: { ...cur, rotation } }, false);
                      }}
                      onRotateEnd={() => commitInteractiveEdit()}
                      onEditStart={() => setSubtitleEditing(true)}
                    />
                  </>
                );
              }
              return <StageSubtitleLayer fontScale={fontScale} />;
            })()}
          </div>
          </div>
          )}
          transport={(
          <div className="transport">
            <button className="round-button sm" title="跳到开头 (Home)" onClick={() => seek(0)}>
              <SkipBack size={14} />
            </button>
            <button
              className="round-button sm"
              title="上一个片段"
              onClick={() => {
                if (!project) return;
                const currentTime = usePlaybackStore.getState().currentTime;
                const videoClips = project.clips
                  .filter((c) => project.tracks.some((t) => t.id === c.trackId && isVisualTrackKind(t.kind)))
                  .sort((a, b) => a.startOnTrack - b.startOnTrack);
                const prev = videoClips.filter((c) => c.startOnTrack + c.duration <= currentTime - 0.05)
                  .pop();
                seek(prev ? prev.startOnTrack : 0);
              }}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="round-button xs"
              title="上一帧 (←)"
              onClick={() => {
                const fps = project?.renderConfig?.fps ?? 30;
                const t = usePlaybackStore.getState().currentTime;
                seek(Math.max(0, t - 1 / fps));
              }}
            >
              <ChevronLeft size={12} />
            </button>
            <PlayPauseButton onToggle={togglePlay} />
            <button
              className="round-button xs"
              title="下一帧 (→)"
              onClick={() => {
                const fps = project?.renderConfig?.fps ?? 30;
                const t = usePlaybackStore.getState().currentTime;
                seek(t + 1 / fps);
              }}
            >
              <ChevronRight size={12} />
            </button>
            <button
              className="round-button sm"
              title="下一个片段"
              onClick={() => {
                if (!project) return;
                const currentTime = usePlaybackStore.getState().currentTime;
                const videoClips = project.clips
                  .filter((c) => project.tracks.some((t) => t.id === c.trackId && isVisualTrackKind(t.kind)))
                  .sort((a, b) => a.startOnTrack - b.startOnTrack);
                const next = videoClips.find((c) => c.startOnTrack > currentTime + 0.05);
                seek(next ? next.startOnTrack : totalDuration);
              }}
            >
              <ChevronRight size={16} />
            </button>
            <button className="round-button sm" title="跳到结尾 (End)" onClick={() => seek(totalDuration)}>
              <SkipForward size={14} />
            </button>
            <PreviewProgress totalDuration={totalDuration} onSeek={seek} />
            <TimecodeDisplay totalDuration={totalDuration} fps={project?.renderConfig?.fps ?? 30} />
          </div>
          )}
        />
        )}
        inspector={(
        <InspectorPanel
          title={selectedClip && selectedClipTrack ? selectedClip.text || selectedSource?.title || "未命名片段" : null}
          meta={selectedClipTrack ? `${selectedClipTrack.name} · ${selectedClipTrack.kind}` : null}
          selectedCount={selectedClipIds.length}
          tabs={availableInspectorTabs}
          activeTab={resolvedInspectorTab}
          onTabChange={(tab) => selectedClipTrack && setInspectorTabForTrack(selectedClipTrack.kind, tab)}
        >
          {selectedClip && selectedClipTrack && (
            <>
              {/* 批量字幕编辑：选中多个字幕 clip 时显示 */}
              {selectedClipIds.length > 1 &&
                selectedClipTrack.kind === "subtitle" && (
                  <div className="batch-edit-section inspector-category inspector-category-subtitle">
                    <div className="batch-edit-title">
                      批量编辑（{selectedClipIds.length} 条字幕）
                    </div>
                    <button
                      className="panel-secondary-action"
                      onClick={() => {
                        if (!project) return;
                        const targetIds = new Set(selectedClipIds);
                        const next = project.clips.map((c) =>
                          targetIds.has(c.id)
                            ? { ...c, subtitleStyle: { ...subtitleStyleDraft, ...(c.subtitleStyle ?? {}) } }
                            : c,
                        );
                        void persist({ ...project, clips: next }, `已批量应用字幕样式到 ${selectedClipIds.length} 条`);
                      }}
                    >
                      应用字幕样式到选中
                    </button>
                    <button
                      className="panel-secondary-action"
                      onClick={() => {
                        if (!project) return;
                        const targetIds = new Set(selectedClipIds);
                        const delta = 0.5;
                        const next = project.clips.map((c) =>
                          targetIds.has(c.id)
                            ? { ...c, startOnTrack: Math.max(0, c.startOnTrack + delta) }
                            : c,
                        );
                        void persist({ ...project, clips: next }, `已批量后移 ${delta}s`);
                      }}
                    >
                      整体后移 0.5s
                    </button>
                    <button
                      className="panel-secondary-action"
                      onClick={() => {
                        if (!project) return;
                        const targetIds = new Set(selectedClipIds);
                        const delta = 0.5;
                        const next = project.clips.map((c) =>
                          targetIds.has(c.id)
                            ? { ...c, startOnTrack: Math.max(0, c.startOnTrack - delta) }
                            : c,
                        );
                        void persist({ ...project, clips: next }, `已批量前移 ${delta}s`);
                      }}
                    >
                      整体前移 0.5s
                    </button>
                    <button
                      className="panel-secondary-action"
                      onClick={() => {
                        if (!project) return;
                        const targetIds = new Set(selectedClipIds);
                        const delta = 0.2;
                        const next = project.clips.map((c) =>
                          targetIds.has(c.id) && c.duration > 0.5
                            ? {
                                ...c,
                                duration: c.duration + delta,
                                sourceOut: c.sourceOut + delta,
                              }
                            : c,
                        );
                        void persist({ ...project, clips: next }, `已批量延长 ${delta}s`);
                      }}
                    >
                      整体延长 0.2s
                    </button>
                  </div>
                )}
              {selectedClipIds.length > 1 && selectedClipTrack.kind !== "subtitle" && (
                <div className="batch-edit-section">
                  <div className="batch-edit-title">已选择 {selectedClipIds.length} 个片段</div>
                  <p className="style-hint">当前类型暂不支持共同属性编辑。请保留单个选中项后调整详细参数。</p>
                </div>
              )}
              {selectedClipIds.length === 1 && (
                <>
              <div className="track-badge" data-kind={selectedClipTrack.kind}>
                {selectedClipTrack.name}轨
              </div>

              {selectedClipTrack.kind === "voiceover" && (
                <label className="inspector-category inspector-category-basic">
                  配音文案
                  <textarea value={selectedClip.text || ""} onChange={(event) => updateSelectedClip({ text: event.target.value }, false)} onBlur={() => commitInteractiveEdit()} />
                </label>
              )}
              {selectedClipTrack.kind === "subtitle" && (
                <SubtitleInspector
                  clip={selectedClip}
                  onClipChange={updateSelectedClip}
                  onCommit={() => commitInteractiveEdit()}
                  onTrackPosition={(position) => {
                    if (!project) return;
                    const trackId = selectedClip.trackId;
                    const clips = project.clips.map((clip) => clip.trackId === trackId ? { ...clip, subtitleStyle: { ...(clip.subtitleStyle ?? { ...DEFAULT_SUBTITLE_STYLE }), position } } : clip);
                    void persist({ ...project, clips }, `整轨设为${position === "bottom" ? "底部" : position === "center" ? "居中" : "顶部"}`);
                  }}
                  onApplyTrackStyle={() => {
                    if (!project) return;
                    const trackId = selectedClip.trackId;
                    const subtitleStyle = selectedClip.subtitleStyle ?? { ...DEFAULT_SUBTITLE_STYLE };
                    const clips = project.clips.map((clip) => clip.trackId === trackId ? { ...clip, subtitleStyle: { ...subtitleStyle } } : clip);
                    void persist({ ...project, clips }, `已应用样式到整条轨（${clips.filter((clip) => clip.trackId === trackId).length} 条字幕）`);
                  }}
                />
              )}
              <label className="inspector-category inspector-category-basic">
                时长（秒）
                <input
                  type="number"
                  min={0.2}
                  step={0.1}
                  value={selectedClip.duration.toFixed(2)}
                  onChange={(event) =>
                    updateSelectedClip({ duration: Math.max(0.2, Number(event.target.value) || 0.2) })
                  }
                />
              </label>

              <AudioInspector
                clip={selectedClip}
                trackKind={selectedClipTrack.kind}
                busy={busy}
                onGenerateVoice={handleGenerateClipAudio}
                onVolumeChange={(volume) => {
                  updateSelectedClip({ volume }, false);
                  setClipVolume(selectedClip.id, volume);
                }}
                onClipChange={updateSelectedClip}
                onCommit={() => commitInteractiveEdit()}
              />

              {isVisualTrackKind(selectedClipTrack.kind) && (
                <>
                  <div className="bound-asset-info inspector-category inspector-category-basic">
                    <strong>当前素材</strong>
                    <span>{selectedSource?.title || "未绑定（去媒体 Tab 选择）"}</span>
                    {selectedSource && (
                      <small>
                        {selectedSource.width}x{selectedSource.height} · {selectedSource.duration.toFixed(1)}s
                        {assetCachingIds.has(selectedSource.id)
                          ? " · 缓存中"
                          : selectedSource.localPath
                            ? " · 已缓存"
                            : ""}
                        {selectedSource.proxyStatus === "ready" ? " · 预览代理" : ""}
                        {selectedSource.proxyStatus === "failed" ? " · 代理失败" : ""}
                      </small>
                    )}
                  </div>
                  {/* 画面关键词（可编辑，用于 AI 搜索替换素材） */}
                  <label className="style-field inspector-category inspector-category-basic">
                    画面关键词
                    <div style={{ display: "flex", gap: 4 }}>
                      <input
                        type="text"
                        value={selectedClip.visualQuery ?? ""}
                        placeholder="描述想要的画面"
                        onChange={(e) => updateSelectedClip({ visualQuery: e.target.value || null }, false)}
                        onBlur={() => commitInteractiveEdit("已更新画面关键词")}
                      />
                      <button
                        className="search-asset-btn"
                        disabled={busy === "asset-search"}
                        onClick={() => searchAssetsForSelected()}
                        title="按关键词搜索 Pexels 素材并替换当前片段"
                      >
                        <Search size={14} />
                      </button>
                    </div>
                  </label>
                  {/* 搜索结果候选区 */}
                  {assetCandidates[selectedClip.id]?.length ? (
                    <div className="asset-candidates inspector-category inspector-category-basic">
                      {assetCandidates[selectedClip.id].slice(0, 8).map((asset, idx) => (
                        <button
                          key={asset.id}
                          className="asset-candidate"
                          onClick={() => project && bindAssetToClip(project.id, selectedClip.id, asset)}
                          title={asset.title || asset.id}
                        >
                          {asset.thumbnailUrl ? (
                            <img src={desktopApi.mediaSrc(asset.thumbnailUrl) ?? undefined} alt="" />
                          ) : (
                            <span>{asset.title || `素材 ${idx + 1}`}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {/* 分离音频 / 分离人声 */}
                  {selectedSource && selectedSource.kind === "video" && (
                    <div className="audio-actions inspector-category inspector-category-audio">
                      <button
                        className="wide-action"
                        disabled={busy === "detach"}
                        onClick={async () => {
                          if (!project || !selectedClip) return;
                          setBusy("detach");
                          setStatus("正在分离音轨...");
                          try {
                            await desktopApi.saveProject(project);
                            const next = await desktopApi.detachAudio({ projectId: project.id, clipId: selectedClip.id });
                            setProject(next);
                            await refreshProjects(next.id);
                            setStatus("音轨已分离到音频轨");
                          } catch (error) {
                            setStatus(error instanceof Error ? error.message : String(error));
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        <Mic2 size={15} />
                        分离音频
                      </button>
                      <button
                        className="wide-action"
                        disabled={busy === "vocals"}
                        onClick={async () => {
                          if (!project || !selectedClip) return;
                          setBusy("vocals");
                          setStatus("正在分离人声（可能需要几秒到几分钟）...");
                          try {
                            await desktopApi.saveProject(project);
                            const next = await desktopApi.separateVocals({ projectId: project.id, clipId: selectedClip.id });
                            setProject(next);
                            await refreshProjects(next.id);
                            setStatus("人声和伴奏已分离到音频轨");
                          } catch (error) {
                            setStatus(error instanceof Error ? error.message : String(error));
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        <Volume2 size={15} />
                        分离人声
                      </button>
                    </div>
                  )}
                  {selectedSource && (
                    <>
                    {/* 画面裁剪（空间裁剪，剪映式） */}
                    <div className="trim-box inspector-category inspector-category-basic">
                      <div className="trim-title">
                        <CropIcon size={15} />
                        画面裁剪
                      </div>
                      <div className="crop-ratio-presets">
                        {[
                          { v: "free", label: "自由" },
                          { v: "1:1", label: "1:1" },
                          { v: "16:9", label: "16:9" },
                          { v: "9:16", label: "9:16" },
                          { v: "4:3", label: "4:3" },
                        ].map((r) => (
                          <button
                            key={r.v}
                            className={`speed-preset ${(selectedClip.crop?.ratio ?? "free") === r.v ? "active" : ""}`}
                            onClick={() => {
                              const cur = selectedClip.crop ?? { ...DEFAULT_CROP };
                              if (r.v === "free") {
                                updateSelectedClip({ crop: { ...cur, ratio: "free" } });
                              } else {
                                // 等比裁剪：居中，按比例设置 width/height
                                const [rw, rh] = r.v.split(":").map(Number);
                                const srcRatio = (selectedSource?.width ?? 1080) / (selectedSource?.height ?? 1920);
                                const targetRatio = rw / rh;
                                let w, h;
                                if (srcRatio > targetRatio) {
                                  h = 100;
                                  w = Math.round(Math.min(100, (targetRatio / srcRatio) * 100));
                                  w = Math.round(w);
                                } else {
                                  w = 100;
                                  h = Math.round(Math.min(100, (srcRatio / targetRatio) * 100));
                                  h = Math.round(h);
                                }
                                const x = Math.round((100 - w) / 2);
                                const y = Math.round((100 - h) / 2);
                                updateSelectedClip({ crop: { x, y, width: w, height: h, ratio: r.v } });
                              }
                            }}
                          >
                            {r.label}
                          </button>
                        ))}
                      </div>
                      <label className="style-field">
                        X 偏移（{(selectedClip.crop?.x ?? 0).toFixed(0)}%）
                        <input type="range" min={0} max={100} step={1} value={selectedClip.crop?.x ?? 0}
                          onChange={(e) => {
                            const cur = selectedClip.crop ?? { ...DEFAULT_CROP };
                            updateSelectedClip({ crop: { ...cur, x: Number(e.target.value) } }, false);
                          }}
                          onPointerUp={() => commitInteractiveEdit()}
                        />
                      </label>
                      <label className="style-field">
                        Y 偏移（{(selectedClip.crop?.y ?? 0).toFixed(0)}%）
                        <input type="range" min={0} max={100} step={1} value={selectedClip.crop?.y ?? 0}
                          onChange={(e) => {
                            const cur = selectedClip.crop ?? { ...DEFAULT_CROP };
                            updateSelectedClip({ crop: { ...cur, y: Number(e.target.value) } }, false);
                          }}
                          onPointerUp={() => commitInteractiveEdit()}
                        />
                      </label>
                      <label className="style-field">
                        宽度（{(selectedClip.crop?.width ?? 100).toFixed(0)}%）
                        <input type="range" min={10} max={100} step={1} value={selectedClip.crop?.width ?? 100}
                          onChange={(e) => {
                            const cur = selectedClip.crop ?? { ...DEFAULT_CROP };
                            updateSelectedClip({ crop: { ...cur, width: Number(e.target.value) } }, false);
                          }}
                          onPointerUp={() => commitInteractiveEdit()}
                        />
                      </label>
                      <label className="style-field">
                        高度（{(selectedClip.crop?.height ?? 100).toFixed(0)}%）
                        <input type="range" min={10} max={100} step={1} value={selectedClip.crop?.height ?? 100}
                          onChange={(e) => {
                            const cur = selectedClip.crop ?? { ...DEFAULT_CROP };
                            updateSelectedClip({ crop: { ...cur, height: Number(e.target.value) } }, false);
                          }}
                          onPointerUp={() => commitInteractiveEdit()}
                        />
                      </label>
                      <button
                        className="panel-secondary-action"
                        onClick={() => updateSelectedClip({ crop: { ...DEFAULT_CROP } })}
                      >
                        重置裁剪
                      </button>
                    </div>

                    {/* 素材裁剪（仅视频/音频有时长素材；图片无时长跳过） */}
                    <div className="trim-box inspector-category inspector-category-basic">
                    {selectedSource && selectedSource.kind !== "image" && (
                      <>
                      <div className="trim-title">
                        <Scissors size={15} />
                        素材裁剪
                      </div>
                      <label>
                        入点（{selectedClip.sourceIn.toFixed(1)}s）
                        <input
                          type="range"
                          min={0}
                          max={Math.max(0.1, selectedClip.sourceOut - 0.1)}
                          step={0.1}
                          value={selectedClip.sourceIn}
                          onChange={(event) => {
                            const newIn = Number(event.target.value);
                            const newDuration = Math.max(0.1, (selectedClip.sourceOut - newIn) / selectedClip.speed);
                            updateSelectedClip({ sourceIn: newIn, duration: newDuration }, false);
                          }}
                          onPointerUp={() => commitInteractiveEdit()}
                        />
                      </label>
                      <label>
                        出点（{selectedClip.sourceOut.toFixed(1)}s）
                        <input
                          type="range"
                          min={selectedClip.sourceIn + 0.1}
                          max={selectedSource.duration || selectedClip.sourceOut}
                          step={0.1}
                          value={selectedClip.sourceOut}
                          onChange={(event) => {
                            const newOut = Number(event.target.value);
                            const newDuration = Math.max(0.1, (newOut - selectedClip.sourceIn) / selectedClip.speed);
                            updateSelectedClip({ sourceOut: newOut, duration: newDuration }, false);
                          }}
                          onPointerUp={() => commitInteractiveEdit()}
                        />
                      </label>
                      </>
                    )}
                      {/* 变速：预设按钮 + 自定义输入 + 倒放 */}
                      <div className="speed-control">
                        <div className="speed-label">变速</div>
                        <div className="speed-presets">
                          {[
                            { v: 0.5, label: "0.5x" },
                            { v: 1, label: "1x" },
                            { v: 1.5, label: "1.5x" },
                            { v: 2, label: "2x" },
                            { v: 3, label: "3x" },
                          ].map((preset) => (
                            <button
                              key={preset.v}
                              className={`speed-preset ${Math.abs(Math.abs(selectedClip.speed) - preset.v) < 0.01 ? "active" : ""}`}
                              onClick={() => selectedClip && changeClipSpeed(selectedClip, (selectedClip.speed < 0 ? -1 : 1) * preset.v)}
                            >
                              {preset.label}
                            </button>
                          ))}
                          <button
                            className={`speed-preset ${selectedClip.speed < 0 ? "active" : ""}`}
                            title="倒放（渲染时生效）"
                            onClick={() => {
                              if (!selectedClip) return;
                              updateSelectedClip({ speed: selectedClip.speed < 0 ? Math.abs(selectedClip.speed) : -Math.abs(selectedClip.speed) });
                            }}
                          >
                            倒放
                          </button>
                        </div>
                        <input
                          className="speed-custom"
                          type="number"
                          min={-4}
                          max={4}
                          step={0.05}
                          value={selectedClip.speed}
                          onChange={(event) => selectedClip && changeClipSpeed(selectedClip, Number(event.target.value))}
                        />
                        {/* T4.3: 曲线变速预设 */}
                        <div className="speed-label" style={{ marginTop: 8 }}>曲线变速</div>
                        <div className="speed-presets">
                          {Object.entries(SPEED_PRESETS).map(([key, preset]) => (
                            <button
                              key={key}
                              className={`speed-preset ${
                                (preset.points.length === 0 && !selectedClip.speedCurve?.length) ||
                                (preset.points.length > 0 && JSON.stringify(selectedClip.speedCurve ?? []) === JSON.stringify(preset.points))
                                  ? "active"
                                  : ""
                              }`}
                              title={preset.label}
                              onClick={() => selectedClip && applySpeedCurvePreset(
                                selectedClip,
                                preset.points.length > 0 ? preset.points : null,
                                preset.label,
                              )}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                        {(selectedClip.speedCurve?.length ?? 0) > 0 && (
                          <SpeedCurveEditor
                            curve={selectedClip.speedCurve ?? []}
                            onChange={(next) => applySpeedCurvePreset(selectedClip, next, "自定义")}
                          />
                        )}
                      </div>
                    </div>
                    </>
                  )}

                    <ColorInspector
                      clip={selectedClip}
                      onFilterChange={(filterId) => {
                        updateSelectedClip({ filter: filterId === "none" ? null : filterId });
                        if (!filterRendererRef.current) return;
                        if (filterId === "none") {
                          filterRendererRef.current.clearLut();
                        } else {
                          void getLutData(filterId).then((data) => {
                            if (data) filterRendererRef.current?.loadLut(filterId, data);
                          });
                        }
                      }}
                      onClipChange={updateSelectedClip}
                      onCommit={() => commitInteractiveEdit()}
                    />

                  {isVisualTrackKind(selectedClipTrack.kind) && (
                    <KeyframeInspector
                      clip={selectedClip}
                      transform={overlayTransform}
                      hasKeyframe={hasKeyframeAtPlayhead()}
                      easing={getKeyframeEasingAtPlayhead()}
                      onAdd={addKeyframeAtPlayhead}
                      onRemove={removeKeyframeAtPlayhead}
                      onClear={() => updateSelectedClip({ keyframes: null })}
                      onEasingChange={setKeyframeEasingAtPlayhead}
                    />
                  )}
                  {isVisualTrackKind(selectedClipTrack.kind) && (
                    <VisualTransformInspector
                      transform={overlayTransform}
                      mask={selectedClip.mask}
                      onTransformChange={updateOverlayTransform}
                      onMaskChange={(mask, commit = true) => updateSelectedClip({ mask }, commit)}
                      onCommit={() => commitInteractiveEdit()}
                    />
                  )}
                  {/* 视觉特效（剪映式"特效"面板） */}
                  {isVisualTrackKind(selectedClipTrack.kind) && (
                    <VisualEffectsInspector
                      effects={selectedClip.visualEffects}
                      onChange={(visualEffects, commit = true) => updateSelectedClip({ visualEffects }, commit)}
                      onCommit={() => commitInteractiveEdit()}
                    />
                  )}
                </>
              )}

              {selectedClip.transitionIn && (
                <div className="transition-info inspector-category inspector-category-animation">
                  <SlidersHorizontal size={14} />
                  入场转场：{transitionName(selectedClip.transitionIn)}
                </div>
              )}
              {selectedClip.transitionOut && (
                <div className="transition-info inspector-category inspector-category-animation">
                  <SlidersHorizontal size={14} />
                  出场转场：{transitionName(selectedClip.transitionOut)}
                </div>
              )}
                </>
              )}
            </>
          )}
        </InspectorPanel>
        )}
        timeline={(
      <section className="timeline-panel">
        <TimelineToolbar
          canEditProject={!!project}
          canEditSelection={!!selectedClip}
          canPaste={!!clipboardRef.current}
          onSplit={splitAtPlayhead}
          onDelete={() => deleteSelectedClip()}
          onCopy={copySelectedClip}
          onPaste={pasteClip}
          onDuplicate={duplicateSelectedClip}
          onAddChapter={handleAddChapter}
          addTrackMenu={(
            <div className="add-track-menu">
              <button onClick={() => setShowAddTrackMenu((v) => !v)} disabled={!project} title="添加轨道">
                <Plus size={15} />
                轨道
              </button>
              {showAddTrackMenu && (
                <div className="add-track-dropdown">
                  <button onClick={() => handleAddTrack("video")}>视频轨</button>
                  <button onClick={() => handleAddTrack("image")}>图片轨</button>
                  <button onClick={() => handleAddTrack("voiceover")}>配音轨</button>
                  <button onClick={() => handleAddTrack("audio")}>音频轨</button>
                  <button onClick={() => handleAddTrack("subtitle")}>字幕轨</button>
                </div>
              )}
            </div>
          )}
          zoomControls={(
            <div className="timeline-zoom">
            <button title="缩小 (-)" onClick={() => setPxPerSecond((p) => Math.max(4, p / 1.3))}>
              <ZoomOut size={15} />
            </button>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(((Math.log(pxPerSecond) - Math.log(4)) / (Math.log(1200) - Math.log(4))) * 100)}
              onChange={(event) => {
                const t = Number(event.target.value) / 100;
                const pps = Math.exp(Math.log(4) + t * (Math.log(1200) - Math.log(4)));
                setPxPerSecond(Math.round(pps));
              }}
            />
            <button title="放大 (+)" onClick={() => setPxPerSecond((p) => Math.min(1200, p * 1.3))}>
              <ZoomIn size={15} />
            </button>
            <span className="zoom-label">{pxPerSecond}px/s</span>
            </div>
          )}
        />
        <div
          ref={timelineScrollRef}
          className="timeline-scroll"
          onPointerDown={handleTimelinePointerDown}
          onPointerMove={handleTimelinePointerMove}
          onPointerUp={handleTimelinePointerUp}
          onPointerCancel={handleTimelinePointerUp}
          onWheel={handleTimelineWheel}
        >
          <div className="timeline-canvas" style={{ width: timelineWidth }}>
            <Ruler totalDuration={totalDuration} pxPerSecond={pxPerSecond} onSeek={seek} fps={project?.renderConfig?.fps ?? 30} />
            {/* 章节标记：在 ruler 下方按时间位置渲染，点击 seek 到该时间 */}
            {(project?.chapters ?? []).length > 0 && (
              <div className="chapter-bar">
                {(project?.chapters ?? []).map((ch) => {
                  const leftPct = totalDuration > 0 ? (ch.time / totalDuration) * 100 : 0;
                  return (
                    <div
                      key={ch.id}
                      className="chapter-marker"
                      style={{ left: `${leftPct}%` }}
                      title={`${ch.title} · ${ch.time.toFixed(1)}s`}
                      onClick={() => seek(ch.time)}
                    >
                      <Bookmark size={11} />
                      <span className="chapter-marker-label">{ch.title}</span>
                      <button
                        className="chapter-marker-close"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteChapter(ch.id);
                        }}
                      >
                        <XCircle size={9} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {/*
              playhead 坐标系对齐 ruler/clip：
              canvas 有 padding-left:44px(标签栏) + padding-right:14px，
              clip 在 track 内（content box，已扣 padding），ruler 也用 left:44px/right:14px 限定。
              所以 playhead 必须用 calc 把百分比应用到"扣除 58px 后的内容区"，
              否则它会基于 canvas 全宽计算，和 clip/ruler 错位。
            */}
            <PlayheadLine totalDuration={totalDuration} />
            {project?.tracks
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((track) => (
                <TimelineTrack
                  key={track.id}
                  track={track}
                  clips={clipsByTrackId.get(track.id) ?? []}
                  media={project.media}
                  totalDuration={totalDuration}
                  timelineWidth={timelineWidth}
                  pxPerSecond={pxPerSecond}
                  selectedClipId={selectedClipId}
                  selectedClipIds={selectedClipIds}
                  locked={track.locked}
                  onSelectClip={handleTimelineSelectClip}
                  onClipDrag={handleClipDrag}
                  onClipCommit={handleClipCommit}
                  onBoxSelect={selectClipsByBox}
                  onDropAsset={handleDropAssetToTrack}
                  onContextMenu={handleTimelineContextMenu}
                  onToggleMute={handleTimelineToggleMute}
                  onToggleLock={handleTimelineToggleLock}
                  onToggleHidden={handleTimelineToggleHidden}
                  onMoveUp={handleTimelineMoveUp}
                  onMoveDown={handleTimelineMoveDown}
                  onDeleteTrack={handleTimelineDeleteTrack}
                  onKeyframeClick={handleKeyframeClick}
                  onEditSubtitleStyle={handleEditSubtitleStyle}
                />
              ))}
          </div>
        </div>
      </section>
        )}
      />

      <footer className="statusbar">
        <span>{status}</span>
        <span>{ffmpeg?.available ? "FFmpeg 可用" : "FFmpeg 不可用"} · {appInfo?.appDataDir || "加载中"}</span>
      </footer>

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          actions={{
            onSplit: () => splitAtPlayhead(),
            onDelete: () => deleteSelectedClip(),
            onCopy: () => {
              if (selectedClip) {
                clipboardRef.current = JSON.parse(JSON.stringify(selectedClip));
                setStatus("已复制");
              }
            },
            onPaste: () => pasteClip(),
            onDuplicate: () => duplicateSelectedClip(),
            onDetachAudio: async () => {
              if (!project || !selectedClip) return;
              setBusy("detach");
              setStatus("正在分离音轨...");
              try {
                await desktopApi.saveProject(project);
                const next = await desktopApi.detachAudio({ projectId: project.id, clipId: selectedClip.id });
                setProject(next);
                await refreshProjects(next.id);
                setStatus("音轨已分离");
              } catch (e) { setStatus(String(e)); }
              finally { setBusy(null); }
            },
            onSeparateVocals: async () => {
              if (!project || !selectedClip) return;
              setBusy("vocals");
              setStatus("正在分离人声...");
              try {
                await desktopApi.saveProject(project);
                const next = await desktopApi.separateVocals({ projectId: project.id, clipId: selectedClip.id });
                setProject(next);
                await refreshProjects(next.id);
                setStatus("人声已分离");
              } catch (e) { setStatus(String(e)); }
              finally { setBusy(null); }
            },
            onMute: () => {
              if (!selectedClip) return;
              updateSelectedClip({ volume: selectedClip.volume > 0 ? 0 : 1 });
            },
            onReverse: () => {
              if (!selectedClip) return;
              updateSelectedClip({ speed: -Math.abs(selectedClip.speed) });
              setStatus("倒放（渲染时生效）");
            },
            onAddSubtitle: () => handleRecognizeSubtitles({ translate: false, mode: "natural" }),
            onEditText: () => {
              // 字幕"编辑文字"：进入字幕编辑模式（textarea 直接改 text）
              setSelectedClipId(contextMenu.clip.id);
              setSubtitleEditing(true);
            },
            onRegenerateAsset: contextMenu.trackKind === "video" ? () => {
              const clip = contextMenu.clip;
              if (!project) return;
              const query = clip.visualQuery || clip.text?.slice(0, 24) || "nature landscape";
              void searchAndBindAsset(project.id, clip.id, query, project.ratio);
            } : undefined,
          }}
        />
      )}

      {/* 导出弹窗 */}
      {/* EDL 预览：AI 分段后先让用户确认/编辑，再执行编排 */}
      {edlSegments && (
        <EdlPreview
          segments={edlSegments}
          totalDuration={edlSegments.reduce((s, x) => s + x.estimatedDuration, 0)}
          busy={edlBusy}
          ratio={project?.ratio}
          onConfirm={(segs) => applyEdlSegments(segs)}
          onCancel={() => { if (!edlBusy) setEdlSegments(null); }}
        />
      )}

      <ExportDialog
        open={showExport}
        onClose={() => setShowExport(false)}
        config={project?.renderConfig ?? { fps: 30, preset: "export-high", resolution: "1080p", bitrateMbps: 0 }}
        onConfigChange={(cfg) => {
          if (project) {
            const next = { ...project, renderConfig: cfg };
            setProject(next);
            void desktopApi.saveProject(next);
          }
        }}
        onExport={handleRenderFinal}
        onCancel={() => { void desktopApi.cancelRender(); }}
        exportState={exportState}
        exportProgress={exportProgress}
        exportMessage={exportMessage}
        defaultName={project?.title || "导出视频"}
        outputPath={exportPath}
        errorMessage={exportError}
      />

      {subtitleTrackStyleEditing && project && (() => {
        const track = project.tracks.find((t) => t.id === subtitleTrackStyleEditing.trackId);
        const trackClipCount = project.clips.filter((c) => c.trackId === subtitleTrackStyleEditing.trackId).length;
        const draft = subtitleTrackStyleEditing.draft;
        return (
          <div className="modal-backdrop" onClick={() => setSubtitleTrackStyleEditing(null)}>
            <div className="subtitle-track-style-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-title">
                <div>
                  <SlidersHorizontal size={18} />
                  <strong>统一调整字幕样式</strong>
                  <span className="modal-subtitle">{track?.name ?? "字幕轨"} · {trackClipCount} 条</span>
                </div>
                <button className="icon-button" onClick={() => setSubtitleTrackStyleEditing(null)}>
                  <XCircle size={18} />
                </button>
              </div>
              <div className="subtitle-track-style-body">
                <label className="style-field">
                  字体
                  <select
                    value={draft.fontFamily}
                    style={{ fontFamily: draft.fontFamily }}
                    onChange={(e) => updateSubtitleTrackDraft({ fontFamily: e.target.value })}
                  >
                    {FONT_OPTIONS.map((font) => (
                      <option key={font.family} value={font.family} style={{ fontFamily: font.family }}>
                        {font.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="style-field">
                  字号
                  <input
                    type="number"
                    min={16}
                    max={120}
                    value={draft.fontSize}
                    onChange={(e) => updateSubtitleTrackDraft({ fontSize: Number(e.target.value) })}
                  />
                </label>
                <label className="style-field">
                  颜色
                  <input
                    type="color"
                    value={draft.color}
                    onChange={(e) => updateSubtitleTrackDraft({ color: e.target.value })}
                  />
                </label>
                <label className="style-field">
                  描边色
                  <input
                    type="color"
                    value={draft.strokeColor}
                    onChange={(e) => updateSubtitleTrackDraft({ strokeColor: e.target.value })}
                  />
                </label>
                <label className="style-field">
                  描边粗细（{draft.strokeWidth ?? 0}px）
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={0.5}
                    value={draft.strokeWidth ?? 0}
                    onChange={(e) => updateSubtitleTrackDraft({ strokeWidth: Number(e.target.value) })}
                  />
                </label>
                <label className="style-field">
                  背景色
                  <input
                    type="color"
                    value={draft.backgroundColor === "none" ? "#000000" : draft.backgroundColor ?? "#000000"}
                    onChange={(e) => updateSubtitleTrackDraft({ backgroundColor: e.target.value })}
                  />
                </label>
                <label className="style-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={draft.backgroundColor !== "none"}
                    onChange={(e) => updateSubtitleTrackDraft({ backgroundColor: e.target.checked ? "#000000" : "none" })}
                  />
                  <span>启用背景</span>
                </label>
                <label className="style-field">
                  背景内边距（{draft.backgroundPadding ?? 4}px）
                  <input
                    type="range"
                    min={0}
                    max={20}
                    step={1}
                    value={draft.backgroundPadding ?? 4}
                    onChange={(e) => updateSubtitleTrackDraft({ backgroundPadding: Number(e.target.value) })}
                  />
                </label>
                <label className="style-field">
                  阴影色
                  <input
                    type="color"
                    value={draft.shadowColor ?? "#000000"}
                    onChange={(e) => updateSubtitleTrackDraft({ shadowColor: e.target.value })}
                  />
                </label>
                <label className="style-field">
                  阴影模糊（{draft.shadowBlur ?? 0}px）
                  <input
                    type="range"
                    min={0}
                    max={20}
                    step={0.5}
                    value={draft.shadowBlur ?? 0}
                    onChange={(e) => updateSubtitleTrackDraft({ shadowBlur: Number(e.target.value) })}
                  />
                </label>
                <label className="style-field">
                  字间距（{draft.letterSpacing ?? 0}px）
                  <input
                    type="range"
                    min={-5}
                    max={20}
                    step={0.5}
                    value={draft.letterSpacing ?? 0}
                    onChange={(e) => updateSubtitleTrackDraft({ letterSpacing: Number(e.target.value) })}
                  />
                </label>
                <label className="style-field">
                  行高（{(draft.lineHeight ?? 1.2).toFixed(2)}x）
                  <input
                    type="range"
                    min={0.8}
                    max={2.5}
                    step={0.05}
                    value={draft.lineHeight ?? 1.2}
                    onChange={(e) => updateSubtitleTrackDraft({ lineHeight: Number(e.target.value) })}
                  />
                </label>
                <label className="style-field">
                  位置
                  <select
                    value={draft.position}
                    onChange={(e) => updateSubtitleTrackDraft({ position: e.target.value as "bottom" | "center" | "top" | "custom" })}
                  >
                    <option value="bottom">底部</option>
                    <option value="center">居中</option>
                    <option value="top">顶部</option>
                    <option value="custom">自定义</option>
                  </select>
                </label>
                {draft.position === "custom" && (
                  <>
                    <label className="style-field">
                      X 位置（{draft.x.toFixed(0)}%）
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={draft.x}
                        onChange={(e) => updateSubtitleTrackDraft({ x: Number(e.target.value) })}
                      />
                    </label>
                    <label className="style-field">
                      Y 位置（{draft.y.toFixed(0)}%）
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={draft.y}
                        onChange={(e) => updateSubtitleTrackDraft({ y: Number(e.target.value) })}
                      />
                    </label>
                  </>
                )}
                <label className="style-field">
                  水平缩放（{draft.scaleX.toFixed(0)}%）
                  <input
                    type="range"
                    min={50}
                    max={200}
                    step={1}
                    value={draft.scaleX}
                    onChange={(e) => updateSubtitleTrackDraft({ scaleX: Number(e.target.value) })}
                  />
                </label>
                <label className="style-field">
                  垂直缩放（{draft.scaleY.toFixed(0)}%）
                  <input
                    type="range"
                    min={50}
                    max={200}
                    step={1}
                    value={draft.scaleY}
                    onChange={(e) => updateSubtitleTrackDraft({ scaleY: Number(e.target.value) })}
                  />
                </label>
                <label className="style-field">
                  旋转（{draft.rotation.toFixed(0)}°）
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={1}
                    value={draft.rotation}
                    onChange={(e) => updateSubtitleTrackDraft({ rotation: Number(e.target.value) })}
                  />
                </label>
                <label className="style-field">
                  入场动画
                  <select
                    value={draft.animationIn ?? "none"}
                    onChange={(e) => updateSubtitleTrackDraft({ animationIn: e.target.value })}
                  >
                    <option value="none">无</option>
                    <option value="fadeIn">淡入</option>
                    <option value="slideUp">上滑</option>
                    <option value="scaleIn">缩放</option>
                  </select>
                </label>
                <label className="style-field">
                  出场动画
                  <select
                    value={draft.animationOut ?? "none"}
                    onChange={(e) => updateSubtitleTrackDraft({ animationOut: e.target.value })}
                  >
                    <option value="none">无</option>
                    <option value="fadeOut">淡出</option>
                    <option value="slideDown">下滑</option>
                    <option value="scaleOut">缩放</option>
                  </select>
                </label>
                <label className="style-field">
                  动画时长（{(draft.animationDuration ?? 0.3).toFixed(1)}s）
                  <input
                    type="range"
                    min={0.1}
                    max={2.0}
                    step={0.1}
                    value={draft.animationDuration ?? 0.3}
                    onChange={(e) => updateSubtitleTrackDraft({ animationDuration: Number(e.target.value) })}
                  />
                </label>
              </div>
              <div className="modal-actions">
                <button className="panel-secondary-action" onClick={() => setSubtitleTrackStyleEditing(null)}>
                  取消
                </button>
                <button className="panel-primary-action" onClick={applySubtitleTrackStyle}>
                  应用到本轨（{trackClipCount} 条）
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {sharedOverlays}
    </div>
  );
}

function StatusPill({ ffmpeg }: { ffmpeg: FfmpegStatus | null }) {
  if (!ffmpeg) {
    return (
      <div className="status-pill muted">
        <Loader2 className="spin" size={14} />
        检测中
      </div>
    );
  }
  return (
    <div className={`status-pill ${ffmpeg.available ? "ok" : "warn"}`} title={ffmpeg.error || ffmpeg.version || ""}>
      {ffmpeg.available ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
      FFmpeg
    </div>
  );
}

// TimelineTrack 已抽离到 ./timeline/TimelineTrack.tsx（支持拖拽移动/裁剪）
