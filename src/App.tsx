import {
  CheckCircle2,
  Clapperboard,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Crop as CropIcon,
  Download,
  Bookmark,
  ImagePlay,
  Layers,
  Loader2,
  Mic2,
  Music,
  Pause,
  Play,
  Plus,
  Redo2,
  Undo2,
  Save,
  Scissors,
  Search,
  SkipBack,
  SkipForward,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Trash2,
  Type,
  Video,
  Volume2,
  XCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Track,
  TrackKind,
  VoiceProfile,
} from "./types";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_TRANSFORM, DEFAULT_CROP } from "./types";
import type { AiSegment } from "./types";
import { FONT_OPTIONS } from "./fonts";
import { SubtitleOverlay } from "./preview/SubtitleOverlay";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { ContextMenu } from "./timeline/ContextMenu";
import { ExportDialog } from "./panels/ExportDialog";
import { HomeScreen } from "./panels/HomeScreen";
import { GenerateWizard } from "./panels/GenerateWizard";
import { EdlPreview } from "./panels/EdlPreview";
import { FilterRenderer } from "./preview/FilterRenderer";
import { LUT_FILTERS, getLutData } from "./luts";
import { usePreviewEngine } from "./preview/usePreviewEngine";
import { useProxyBackfill } from "./preview/useProxyBackfill";
import { usePlaybackStore } from "./store/playbackStore";
import { useExportAction } from "./store/exportAction";
import { usePipelineStore } from "./store/pipelineStore";
import { useProjectHistory } from "./store/projectHistory";
import { useProjectStore } from "./store/projectStore";
import { useUiStore } from "./store/uiStore";
import { SPEED_PRESETS } from "./editor/speedCurve";
import { SpeedCurveEditor } from "./components/SpeedCurveEditor";
import { MaskPreview } from "./components/MaskPreview";
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
import { makeTransition, transitionDuration, transitionName } from "./editor/transitions";
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
import { realignTimeline } from "./timeline/realignTimeline";
import { MediaPanel } from "./panels/MediaPanel";
import { TextPanel } from "./panels/TextPanel";
import { AudioPanel } from "./panels/AudioPanel";
import { TransitionPanel } from "./panels/TransitionPanel";
import { ProjectMenu } from "./panels/ProjectMenu";
// PanelTitle 已不再直接使用（各 Tab 自带标题）；TimelineTrack/Track 类型保留供时间线渲染

const ratios = ["9:16", "16:9", "1:1"];

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

function KeyframeLabel() {
  const currentTime = usePlaybackStore((s) => s.currentTime);
  return <span className="kf-label">关键帧（@ {currentTime.toFixed(1)}s）</span>;
}

function StageSubtitleLayer({ excludeClipId }: { excludeClipId?: string } = {}) {
  const currentTime = usePlaybackStore((s) => s.currentTime);
  const subClips = usePlaybackStore((s) => s.activeSubtitleClips);
  // 选中字幕编辑时，由 SubtitleOverlay 渲染该 clip，这里跳过避免重复
  const visible = subClips.filter((c) => c.id !== excludeClipId && c.text && c.text.trim());
  if (visible.length === 0) return null;
  return (
    <>
      {visible.map((clip, idx) => (
        <SubtitleItem key={clip.id} clip={clip} currentTime={currentTime} stackIdx={idx} stackTotal={visible.length} />
      ))}
    </>
  );
}

/** 单条字幕渲染（StageSubtitleLayer 内部使用）。
 *  stackIdx/stackTotal 用于多条字幕时按 idx 中心对称偏移，避免重叠。 */
function SubtitleItem({ clip, currentTime, stackIdx, stackTotal }: {
  clip: Clip;
  currentTime: number;
  stackIdx: number;
  stackTotal: number;
}) {
  const s = clip.subtitleStyle;
  const isCustom = s?.position === "custom";
  const posX = isCustom ? (s?.x ?? 50) : 50;
  // 多条字幕时按 idx 中心对称偏移，每条间隔 12% 画面高度
  const offsetY = stackTotal > 1
    ? (stackIdx - (stackTotal - 1) / 2) * 12
    : 0;
  const posY = isCustom
    ? (s?.y ?? 80) + offsetY
    : (s?.position === "top" ? 12 : s?.position === "center" ? 50 : 88) + offsetY;
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
        fontSize: `${Math.max(12, (s?.fontSize ?? 48) * 0.35)}px`,
        fontWeight: 700,
        lineHeight,
        color: baseColor,
        textShadow: finalTextShadow,
        letterSpacing: `${letterSpacing}px`,
        background: bgColor === "none" ? "transparent" : bgColor,
        padding: bgColor === "none" ? "4px 10px" : `${bgPadding}px ${bgPadding * 2}px`,
        borderRadius: bgColor === "none" ? 0 : 4,
        textAlign: "center",
        whiteSpace: "pre-wrap",
        maxWidth: "calc(100% - 24px)",
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

// 跨平台检测：Windows / macOS / Linux
const isWindows =
  typeof navigator !== "undefined" &&
  (navigator.platform?.toLowerCase().includes("win") ||
    navigator.userAgent?.toLowerCase().includes("win"));
const isMac =
  typeof navigator !== "undefined" &&
  (navigator.platform?.toLowerCase().includes("mac") ||
    navigator.userAgent?.toLowerCase().includes("mac"));
const whisperInstallHint = isWindows
  ? "Windows：从 github.com/ggerganov/whisper.cpp/releases 下载 whisper-bin-x64.zip 解压，模型从 huggingface.co/ggerganov/whisper.cpp 下载（如 ggml-large-v3.bin）"
  : isMac
    ? "macOS：终端运行 brew install whisper-cpp，模型在 /opt/homebrew/share/whisper-cpp/"
    : "Linux：apt install whisper-cpp 或源码编译，模型放 /usr/local/share/whisper-cpp/";
const whisperDefaultBin = isWindows ? "whisper-cli.exe" : "whisper-cli";
const whisperDefaultModel = isMac
  ? "/opt/homebrew/share/whisper-cpp/ggml-large-v3.bin"
  : "";

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
  for (const seg of segments) {
    // 音频模式：用 whisper 真实时间；文案模式：累加 estimatedDuration
    const hasRealTime = (seg.start ?? 0) !== 0 || (seg.end ?? 0) !== 0;
    const start = hasRealTime ? (seg.start ?? cursor) : cursor;
    const duration = hasRealTime ? ((seg.end ?? 0) - (seg.start ?? 0)) : seg.estimatedDuration;
    // 视频轨（占位，sourceId 暂空，等用户绑定素材）
    if (videoTrackId) {
      clips.push({
        id: newClipId(),
        trackId: videoTrackId,
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
        visualQuery: seg.visualQuery,
        transitionIn: null,
        transitionOut: null,
      });
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
    defaultRatio: "9:16",
    defaultVoiceId: null,
    renderPreset: "preview-fast",
    whisperBin: whisperDefaultBin,
    whisperModel: whisperDefaultModel,
  });
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const showSettings = useUiStore((s) => s.showSettings);
  const setShowSettings = useUiStore((s) => s.setShowSettings);
  const [busy, setBusy] = useState<string | null>(null);
  // 时间线缩放：pxPerSecond 驱动（4=超小看全局，1200=帧级细节）
  const [pxPerSecond, setPxPerSecond] = useState(64);
  const [status, setStatus] = useState("准备就绪");
  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfile[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("");
  const [newVoiceName, setNewVoiceName] = useState("我的克隆音色");
  const [newVoiceReferenceText, setNewVoiceReferenceText] = useState("");
  const [voicePreviewText, setVoicePreviewText] = useState("这是一段克隆音色试听，用来检查声音是否自然。");
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null);
  const [voiceNameDrafts, setVoiceNameDrafts] = useState<Record<string, string>>({});
  const [voiceReferenceDrafts, setVoiceReferenceDrafts] = useState<Record<string, string>>({});
  const [assetCandidates, setAssetCandidates] = useState<Record<string, MediaSource[]>>({});
  const [assetQueryDraft, setAssetQueryDraft] = useState("");
  const [assetCachingIds, setAssetCachingIds] = useState<Set<string>>(new Set());
  // 剪映式 Tab 切换 + 新建字幕的默认样式草稿
  const activeTab = useUiStore((s) => s.activeTab);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const [subtitleStyleDraft, setSubtitleStyleDraft] = useState<SubtitleStyle>({ ...DEFAULT_SUBTITLE_STYLE });
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

  // 项目总时长 = 所有 clip 的最大结束位置
  const totalDuration = useMemo(() => {
    if (!project || project.clips.length === 0) return 1;
    return Math.max(1, ...project.clips.map((clip) => clip.startOnTrack + clip.duration));
  }, [project]);

  // playhead 已从 usePlaybackStore 订阅（T2.1）

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void bootstrap();
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

  async function handleSaveSettings() {
    setBusy("settings");
    try {
      const saved = await desktopApi.saveSettings(settings);
      setSettings(saved);
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
    if (!selectedVoiceId) {
      setStatus("请先选择配音音色；没有音色时请先在设置中上传克隆音色");
      setShowSettings(true);
      return;
    }
    setBusy("audio");
    setStatus("正在为全部片段生成配音...");
    try {
      await desktopApi.saveProject(project);
      const next = await desktopApi.generateAudio({
        projectId: project.id,
        voiceId: selectedVoiceId,
      });
      // 配音时长已变成真实时长，按配音轨首尾相接重排整条时间线
      const realigned = realignTimeline(next);
      const saved = await desktopApi.saveProject(realigned);
      setProject(saved);
      await refreshProjects(saved.id);
      setStatus("全部片段配音已生成，时间线已按真实时长重排");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  /** 识别字幕：合并配音 → whisper ASR → AI 整理（可选翻译）→ 生成字幕 clip */
  async function handleRecognizeSubtitles(translate: boolean) {
    if (!project) return;
    setBusy("subtitles");
    setStatus(translate ? "正在识别字幕并翻译..." : "正在识别字幕...");
    try {
      await desktopApi.saveProject(project);
      const next = await desktopApi.generateSubtitles({
        projectId: project.id,
        translate,
      });
      setProject(next);
      await refreshProjects(next.id);
      const subCount = next.clips.filter((c) =>
        next.tracks.some((t) => t.kind === "subtitle" && t.id === c.trackId),
      ).length;
      setStatus(`字幕识别完成，生成 ${subCount} 条字幕`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
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
    try {
      const srtPath = await desktopApi.pickSrtFile();
      if (!srtPath) return;
      setBusy("subtitles");
      setStatus("正在导入 SRT 字幕...");
      await desktopApi.saveProject(project);
      const next = await desktopApi.importSrt({
        projectId: project.id,
        srtPath,
        timeOffset: 0,
      });
      setProject(next);
      await refreshProjects(next.id);
      const subCount = next.clips.filter((c) =>
        next.tracks.some((t) => t.kind === "subtitle" && t.id === c.trackId),
      ).length;
      setStatus(`SRT 导入完成，共 ${subCount} 条字幕`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
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
    if (!selectedVoiceId) {
      setStatus("请先选择配音音色；没有音色时请先在设置中上传克隆音色");
      setShowSettings(true);
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
      setProject(saved);
      setSelectedClipId(voiceClip.id);
      await refreshProjects(saved.id);
      setStatus("片段配音已生成，时间线已重排");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  /**
   * 一键生成流水线：
   * 模式 2（文案）：文案 → AI分段+配素材 → TTS配音 → 字幕识别
   * 模式 1（音频）：whisper 句级识别 → AI 配关键词（保留真实时间）→ (已有音频) → 字幕识别
   */
  async function handleGeneratePipeline(input: GeneratePipelineInput) {
    const isAudioMode = !!input.audioPath;
    await runGeneratePipeline(input, {
      startPipeline,
      updateStep: updatePipelineStep,
      createProject: async () => {
        const proj = await desktopApi.createProject({ title: "一键生成", ratio: input.ratio });
        const withScript = { ...proj, script: input.script };
        await desktopApi.saveProject(withScript);
        setProject(withScript);
        setSelectedClipId(null);
        setView("editor");
      },
      segmentAndBindAssets: async () => {
        if (isAudioMode && input.audioPath) {
          await handleAudioSegmentPipeline(input.audioPath, input.ratio);
        } else {
          await handleSegmentScript({ skipEdl: true });
        }
      },
      prepareAudio: async () => {
        if (!input.voiceId) return;
        setSelectedVoiceId(input.voiceId);
        await new Promise((resolve) => setTimeout(resolve, 200));
        await handleGenerateProjectAudio();
      },
      recognizeSubtitles: async () => {
        await handleRecognizeSubtitles(input.translate);
      },
      complete: () => {
        setStatus("一键生成完成！请在编辑器中检查并导出");
        setTimeout(() => {
          resetPipeline();
          setShowGenerate(false);
        }, 1500);
      },
      fail: (message) => {
        failRunningPipelineStep(message);
        setStatus(`生成失败：${message}`);
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
   * 音频模式分镜流水线（由 handleGeneratePipeline 调用）：
   * 1. whisper 句级识别 → 拿到带真实时间戳的句子
   * 2. DeepSeek 富化（配画面关键词/情绪，不改时间数量顺序）
   * 3. 编排成轨道 clip（用真实 start/end，不用估算时长累加）
   * 4. 把原始音频导入到配音轨（作为整条配音）
   * 5. 自动绑素材
   */
  async function handleAudioSegmentPipeline(audioPath: string, ratio: string) {
    // 用 projectRef.current 获取最新 project（createProject 步骤的 setProject 可能还没反映到闭包）
    const currentProject = projectRef.current;
    if (!currentProject) return;
    setStatus("正在用 whisper 识别音频（句子级时间戳）...");
    // Step 1: whisper 句级识别
    const result = await desktopApi.transcribeToSentences(audioPath);
    setStatus(`音频识别完成：${result.sentences.length} 句，共 ${result.totalDuration.toFixed(1)}s`);

    // Step 2: AI 富化（配关键词，保留真实时间）
    setStatus("正在用 AI 为每句配画面关键词...");
    const segments = await desktopApi.enrichSegments({
      sentences: result.sentences,
      ratio,
    });

    // Step 3: 编排成轨道 clip（arrangeSegmentsToClips 会用 seg.start/end 真实时间）
    const clips = arrangeSegmentsToClips(segments, currentProject.tracks);

    // Step 4: 把原始音频导入素材库 + 作为整条配音放到配音轨
    // 音频模式下配音就是这一条完整音频，不需要按句子分段（分段会重叠）
    const audioSource = await desktopApi.importMedia(audioPath);
    const voiceoverTrackId = pickPrimaryTrack(currentProject.tracks, "voiceover");
    // 去掉 arrangeSegmentsToClips 创建的分段配音 clip
    let finalClips = voiceoverTrackId
      ? clips.filter((c) => c.trackId !== voiceoverTrackId)
      : clips;
    if (voiceoverTrackId) {
      // 只放一个完整音频 clip（从 0 到音频总时长）
      finalClips.push({
        id: newClipId(),
        trackId: voiceoverTrackId,
        sourceId: audioSource.id,
        startOnTrack: 0,
        duration: result.totalDuration,
        sourceIn: 0,
        sourceOut: result.totalDuration,
        speed: 1,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
        brightness: 0,
        contrast: 0,
        saturation: 0,
        text: undefined,
        transitionIn: null,
        transitionOut: null,
      });
    }

    const nextProject: Project = {
      ...currentProject,
      ratio, // 显式用传入的 ratio，避免 createProject 闭包 project 旧值覆盖
      clips: finalClips,
      media: currentProject.media.some((m) => m.id === audioSource.id)
        ? currentProject.media
        : [...currentProject.media, audioSource],
      // 音频模式：把识别出的完整文案也存到 script（供字幕识别复用）
      script: result.fullText || currentProject.script,
    };
    const saved = await desktopApi.saveProject(nextProject);
    setProject(saved);
    setSelectedClipId(saved.clips[0]?.id || null);
    await refreshProjects(saved.id);

    // Step 5: 为视频 clip 绑素材
    const videoTrackIds = saved.tracks.filter((t) => t.kind === "video").map((t) => t.id);
    const videoClips = saved.clips.filter((c) => videoTrackIds.includes(c.trackId));
    let boundCount = 0;
    for (const clip of videoClips) {
      const segPeer = segments.find((s) => Math.abs((s.start ?? -1) - clip.startOnTrack) < 0.5);
      const query =
        clip.visualQuery ||
        segPeer?.visualQuery ||
        segPeer?.text?.slice(0, 24) ||
        "nature landscape";
      // 用 saved.ratio（最新值），不用闭包 project?.ratio
      const ok = await searchAndBindAsset(saved.id, clip.id, query, saved.ratio);
      if (ok) boundCount += 1;
      setStatus(`正在匹配素材：${boundCount}/${videoClips.length}`);
    }
    setStatus(`音频分镜完成：${segments.length} 句，已匹配 ${boundCount}/${videoClips.length} 段素材`);
  }

  /**
   * 执行 EDL：把用户确认/编辑后的 segments 编排成轨道 clip + 自动绑素材。
   * 由 EdlPreview 面板的"执行"按钮触发。
   */
  async function applyEdlSegments(segments: AiSegment[]) {
    if (!project) return;
    setEdlBusy(true);
    setStatus("正在编排轨道并匹配素材...");
    try {
      // 编排成轨道 clips（按实际项目的 tracks 动态匹配轨道 ID）
      const clips = arrangeSegmentsToClips(segments, project.tracks);
      const nextProject: Project = {
        ...project,
        clips,
        media: project.media,
      };
      const saved = await desktopApi.saveProject(nextProject);
      setProject(saved);
      setSelectedClipId(saved.clips[0]?.id || null);
      await refreshProjects(saved.id);

      // 串行为每个视频 clip 搜素材并绑定（用 clip 自带的 visualQuery）
      const videoTrackIds = saved.tracks.filter((t) => t.kind === "video").map((t) => t.id);
      const videoClips = saved.clips.filter((c) => videoTrackIds.includes(c.trackId));
      let boundCount = 0;
      for (const clip of videoClips) {
        const segPeer = segments.find((_, idx) => idx === videoClips.indexOf(clip));
        const query =
          clip.visualQuery ||
          segPeer?.visualQuery ||
          segPeer?.text?.slice(0, 24) ||
          "nature landscape";
        const ok = await searchAndBindAsset(saved.id, clip.id, query, saved.ratio);
        if (ok) boundCount += 1;
        setStatus(`正在匹配素材：${boundCount}/${videoClips.length}`);
      }
      setStatus(`分镜方案已执行：${segments.length} 段，已匹配 ${boundCount}/${videoClips.length} 段素材`);
      setEdlSegments(null); // 关闭预览面板
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setEdlBusy(false);
    }
  }

  /** 为指定视频 clip 搜素材并绑定第一个结果。返回是否绑定成功。 */
  async function searchAndBindAsset(
    projectId: string,
    clipId: string,
    query: string,
    ratio?: string,
  ): Promise<boolean> {
    try {
      // 优先用传入的 ratio（最新值），否则用 projectRef.current?.ratio
      const effectiveRatio = ratio || projectRef.current?.ratio || "9:16";
      const assets = await desktopApi.searchPexelsVideos({ query, ratio: effectiveRatio, perPage: 6 });
      setAssetCandidates((previous) => ({ ...previous, [clipId]: assets }));
      if (assets[0]) {
        await bindAssetToClip(projectId, clipId, assets[0]);
        return true;
      }
    } catch {
      // 单个失败不阻塞整体流程
    }
    return false;
  }

  async function bindAssetToClip(projectId: string, clipId: string, asset: MediaSource) {
    // 基于最新 project，避免并发绑定相互覆盖（AI 分段后会并发触发多个绑定）
    const current = projectRef.current;
    if (!current || current.id !== projectId) return;
    const target = current.clips.find((c) => c.id === clipId);
    if (!target) return;
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
    setProject(nextProject);
    setSelectedClipId(clipId);
    await desktopApi.saveProject(nextProject);
    setStatus(`已绑定素材到片段`);
    void cacheAssetForProject(nextProject.id, clipId, asset);
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
      setNewVoiceName("我的克隆音色");
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
    if (target.closest("button, input")) return;
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
    const element = timelineScrollRef.current;
    timelineDrag.current.active = false;
    element?.releasePointerCapture(event.pointerId);
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
    selectClip(clipId, false, false);
    seek(Math.max(0, clip.startOnTrack + time));
  }, [project, seek]);
  const selectedSource = selectedClip?.sourceId
    ? project?.media.find((m) => m.id === selectedClip.sourceId)
    : null;
  const selectedMediaSrc = desktopApi.mediaSrc(selectedSource?.localPath || null);
  // 素材库悬停预览的 src（图片直接显示，视频显示缩略/首帧）
  const previewingSrc = previewingAsset
    ? desktopApi.mediaSrc(previewingAsset.thumbnailUrl || previewingAsset.localPath || null)
    : null;

  // 诊断：错误日志已改为 main.tsx 自动写文件，不再在 UI 显示
  // 首页 vs 编辑器
  if (view === "home") {
    return (
      <HomeScreen
        projects={projects}
        onOpen={async (id) => {
          const p = await desktopApi.getProject(id);
          setProject(p);
          setSelectedClipId(p.clips[0]?.id || null);
          setView("editor");
        }}
        onCreate={async () => {
          await handleCreateProject();
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
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="home-back-btn"
          onClick={() => { void refreshProjects(); setView("home"); }}
          title="返回首页"
        >
          <ChevronLeft size={16} />
          <span>首页</span>
        </button>
        <div className="brand" onClick={() => { void refreshProjects(); setView("home"); }} style={{ cursor: "pointer" }} title="返回首页">
          <div className="brand-mark">
            <Clapperboard size={18} />
          </div>
          <strong>SceneScript</strong>
        </div>
        <ProjectMenu
          projects={projects}
          activeProjectId={project?.id}
          onSelect={handleSelectProject}
          onCreate={handleCreateProject}
          onDelete={handleDeleteProject}
        />
        <input
          className="project-title-input"
          value={project?.title || ""}
          placeholder="项目名称"
          onChange={(event) => updateProjectPatch({ title: event.target.value })}
        />
        <select
          className="ratio-select"
          value={project?.ratio || settings.defaultRatio}
          onChange={(event) => updateProjectPatch({ ratio: event.target.value })}
        >
          {ratios.map((ratio) => (
            <option key={ratio}>{ratio}</option>
          ))}
        </select>
        <div className="top-actions">
          <StatusPill ffmpeg={ffmpeg} />
          <button className="icon-button" title="撤销 (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
            <Undo2 size={18} />
          </button>
          <button className="icon-button" title="重做 (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
            <Redo2 size={18} />
          </button>
          <button className="icon-button" title="复制片段 (Ctrl+D)" disabled={!selectedClip} onClick={duplicateSelectedClip}>
            <Copy size={18} />
          </button>
          <button
            className="icon-button"
            title="保存项目"
            disabled={!project}
            onClick={() => project && persist(project)}
          >
            <Save size={18} />
          </button>
          <button className="icon-button" title="设置" onClick={() => setShowSettings(true)}>
            <SettingsIcon size={18} />
          </button>
          <button
            className="primary-button"
            disabled={!project}
            onClick={() => { setShowExport(true); setExportState("idle"); }}
          >
            <Download size={16} />
            导出
          </button>
        </div>
      </header>

      {/* 垂直 PanelGroup：工作区(上) + 时间线(下)，可拖拽调高度 */}
      <PanelGroup orientation="vertical" style={{ flex: 1, minHeight: 0 }}>
        <Panel defaultSize="62%" minSize="20%">
      <main className="workspace">
        {/* 水平 PanelGroup：左栏/预览/右栏，可拖拽调宽度 */}
        <PanelGroup orientation="horizontal" style={{ flex: 1, minHeight: 0 }}>
        <Panel defaultSize="20%" minSize="10%" maxSize="40%">
        <aside className="left-panel">
          <nav className="tab-bar">
            <button
              className={`tab ${activeTab === "media" ? "active" : ""}`}
              onClick={() => setActiveTab("media")}
              title="媒体"
            >
              <Video size={18} />
              <span>媒体</span>
            </button>
            <button
              className={`tab ${activeTab === "text" ? "active" : ""}`}
              onClick={() => setActiveTab("text")}
              title="文本"
            >
              <Type size={18} />
              <span>文本</span>
            </button>
            <button
              className={`tab ${activeTab === "audio" ? "active" : ""}`}
              onClick={() => setActiveTab("audio")}
              title="音频"
            >
              <Music size={18} />
              <span>音频</span>
            </button>
            <button
              className={`tab ${activeTab === "transition" ? "active" : ""}`}
              onClick={() => setActiveTab("transition")}
              title="转场"
            >
              <SlidersHorizontal size={18} />
              <span>转场</span>
            </button>
          </nav>

          <div className="tab-body">
            {activeTab === "media" && (
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
            {activeTab === "text" && (
              <TextPanel
                script={project?.script || ""}
                busy={busy}
                onScriptChange={(script) => updateProjectPatch({ script })}
                onAiSegment={handleSegmentScript}
                onRecognizeSubtitles={handleRecognizeSubtitles}
                onAddManualSubtitle={handleAddManualSubtitle}
                onImportSrt={handleImportSrt}
                subtitleStyle={subtitleStyleDraft}
                onSubtitleStyleChange={setSubtitleStyleDraft}
              />
            )}
            {activeTab === "audio" && (
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
            {activeTab === "transition" && (
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
          </div>
        </aside>
        </Panel>
        <PanelResizeHandle />
        <Panel defaultSize="55%" minSize="20%">
        <section className="preview-column">
          <div className="preview-toolbar">
            <div>
              <strong>画面预览</strong>
              <span>{selectedClip?.text || selectedSource?.title || "未选择片段"}</span>
            </div>
            <div className="preview-zoom-controls">
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
              <button
                className={`zoom-btn ${showPreviewDebug ? "active" : ""}`}
                title="预览诊断"
                onClick={() => setShowPreviewDebug((current) => !current)}
              >
                <SlidersHorizontal size={14} />
              </button>
            </div>
          </div>

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
                      fontSize: `${Math.max(12, (s.fontSize ?? 48) * 0.35)}px`,
                      fontWeight: 700,
                      lineHeight: 1.4,
                      color: s.color,
                      textShadow: `1px 1px 0 ${s.strokeColor}, -1px -1px 0 ${s.strokeColor}, 1px -1px 0 ${s.strokeColor}, -1px 1px 0 ${s.strokeColor}`,
                      padding: "4px 10px",
                      textAlign: "center",
                      whiteSpace: "pre-wrap",
                      maxWidth: "calc(100% - 24px)",
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
                    <StageSubtitleLayer excludeClipId={selectedClip.id} />
                    <SubtitleOverlay
                      clip={selectedClip}
                      targetRef={stageRef}
                      isSelected
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
              return <StageSubtitleLayer />;
            })()}
          </div>
          </div>

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
        </section>
        </Panel>
        <PanelResizeHandle />
        <Panel defaultSize="25%" minSize="12%" maxSize="45%">
        <aside className="right-panel">
          <div className="panel-title">
            <div>
              <SlidersHorizontal size={16} />
              <span>属性</span>
            </div>
          </div>
          {selectedClip && selectedClipTrack ? (
            <div className="inspector">
              {/* 批量字幕编辑：选中多个字幕 clip 时显示 */}
              {selectedClipIds.length > 1 &&
                selectedClipTrack.kind === "subtitle" && (
                  <div className="batch-edit-section">
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
              <div className="track-badge" data-kind={selectedClipTrack.kind}>
                {selectedClipTrack.name}轨
              </div>

              {(selectedClipTrack.kind === "subtitle" || selectedClipTrack.kind === "voiceover") && (
                <label>
                  {selectedClipTrack.kind === "voiceover" ? "配音文案" : "字幕文案"}
                  <textarea
                    value={selectedClip.text || ""}
                    onChange={(event) => updateSelectedClip({ text: event.target.value }, false)}
                    onBlur={() => commitInteractiveEdit()}
                  />
                </label>
              )}

              {/* 字幕 clip 的样式编辑（颜色/字体/字号/描边/位置） */}
              {selectedClipTrack.kind === "subtitle" && (
                <div className="subtitle-style-editor">
                  <label className="style-field">
                    字体
                    <select
                      value={selectedClip.subtitleStyle?.fontFamily || "Noto Sans SC"}
                      style={{ fontFamily: selectedClip.subtitleStyle?.fontFamily }}
                      onChange={(event) => updateSelectedClip({
                        subtitleStyle: { ...selectedClip.subtitleStyle ?? { ...DEFAULT_SUBTITLE_STYLE }, fontFamily: event.target.value },
                      })}
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
                      value={selectedClip.subtitleStyle?.fontSize ?? 48}
                      onChange={(event) => updateSelectedClip({
                        subtitleStyle: { ...selectedClip.subtitleStyle ?? { ...DEFAULT_SUBTITLE_STYLE }, fontSize: Number(event.target.value) },
                      })}
                    />
                  </label>
                  <label className="style-field">
                    颜色
                    <input
                      type="color"
                      value={selectedClip.subtitleStyle?.color || "#FFFFFF"}
                      onChange={(event) => updateSelectedClip({
                        subtitleStyle: { ...selectedClip.subtitleStyle ?? { ...DEFAULT_SUBTITLE_STYLE }, color: event.target.value },
                      })}
                    />
                  </label>
                  <label className="style-field">
                    描边
                    <input
                      type="color"
                      value={selectedClip.subtitleStyle?.strokeColor || "#000000"}
                      onChange={(event) => updateSelectedClip({
                        subtitleStyle: { ...selectedClip.subtitleStyle ?? { ...DEFAULT_SUBTITLE_STYLE }, strokeColor: event.target.value },
                      })}
                    />
                  </label>
                  <label className="style-field">
                    位置
                    <select
                      value={selectedClip.subtitleStyle?.position || "bottom"}
                     onChange={(event) => updateSelectedClip({
                        subtitleStyle: { ...selectedClip.subtitleStyle ?? { ...DEFAULT_SUBTITLE_STYLE }, position: event.target.value as "bottom" | "center" | "top" | "custom" },
                     })}
                    >
                      <option value="bottom">底部</option>
                      <option value="center">居中</option>
                      <option value="top">顶部</option>
                      <option value="custom">自定义（拖动）</option>
                    </select>
                  </label>
                  {/* 逐字高亮（卡拉OK）：仅当字幕有词级时间戳时生效 */}
                  <label className="style-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={(selectedClip.subtitleStyle?.karaoke ?? true) && !!(selectedClip.words?.length)}
                      disabled={!selectedClip.words?.length}
                      onChange={(event) => updateSelectedClip({
                        subtitleStyle: { ...selectedClip.subtitleStyle ?? { ...DEFAULT_SUBTITLE_STYLE }, karaoke: event.target.checked },
                      })}
                    />
                    <span>逐字高亮{selectedClip.words?.length ? "" : "（需先识别字幕）"}</span>
                  </label>
                  {(selectedClip.subtitleStyle?.karaoke ?? true) && selectedClip.words?.length ? (
                    <label className="style-field">
                      高亮色
                      <input
                        type="color"
                        value={selectedClip.subtitleStyle?.highlightColor || "#FFD700"}
                        onChange={(event) => updateSelectedClip({
                          subtitleStyle: { ...selectedClip.subtitleStyle ?? { ...DEFAULT_SUBTITLE_STYLE }, highlightColor: event.target.value },
                        })}
                      />
                    </label>
                  ) : null}
                  {/* T4.8: 入场/出场动画 */}
                  <label className="style-field">
                    入场动画
                    <select
                      value={selectedClip.subtitleStyle?.animationIn ?? "none"}
                      onChange={(event) => updateSelectedClip({
                        subtitleStyle: { ...selectedClip.subtitleStyle ?? { ...DEFAULT_SUBTITLE_STYLE }, animationIn: event.target.value },
                      })}
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
                      value={selectedClip.subtitleStyle?.animationOut ?? "none"}
                      onChange={(event) => updateSelectedClip({
                        subtitleStyle: { ...selectedClip.subtitleStyle ?? { ...DEFAULT_SUBTITLE_STYLE }, animationOut: event.target.value },
                      })}
                    >
                      <option value="none">无</option>
                      <option value="fadeOut">淡出</option>
                      <option value="slideDown">下滑</option>
                      <option value="scaleOut">缩放</option>
                    </select>
                  </label>
                  <label className="style-field">
                    动画时长（{(selectedClip.subtitleStyle?.animationDuration ?? 0.3).toFixed(1)}s）
                    <input
                      type="range"
                      min={0.1}
                      max={2.0}
                      step={0.1}
                      value={selectedClip.subtitleStyle?.animationDuration ?? 0.3}
                      onChange={(event) => updateSelectedClip({
                        subtitleStyle: { ...selectedClip.subtitleStyle ?? { ...DEFAULT_SUBTITLE_STYLE }, animationDuration: Number(event.target.value) },
                      }, false)}
                      onPointerUp={() => commitInteractiveEdit()}
                    />
                  </label>
                </div>
              )}

              <label>
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

              {selectedClipTrack.kind === "voiceover" && (
                <button className="wide-action" disabled={busy === "clip-audio"} onClick={handleGenerateClipAudio}>
                  {busy === "clip-audio" ? <Loader2 className="spin" size={15} /> : <Mic2 size={15} />}
                  生成当前片段配音
                </button>
              )}

              {/* 音量调节（所有有声音的轨道） */}
              <label className="style-field" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>音量</span>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={1}
                  value={Math.round((selectedClip.volume ?? 1) * 100)}
                  onChange={(e) => {
                    const volume = Number(e.target.value) / 100;
                    updateSelectedClip({ volume }, false);
                    setClipVolume(selectedClip.id, volume);
                  }}
                  onPointerUp={() => commitInteractiveEdit()}
                  style={{ flex: 1 }}
                />
                <small style={{ minWidth: 50 }}>
                  {Math.round((selectedClip.volume ?? 1) * 100)}%
                  {(selectedClip.volume ?? 1) > 0
                    ? ` (${(20 * Math.log10(selectedClip.volume ?? 1)).toFixed(1)}dB)`
                    : " (静音)"}
                </small>
              </label>

              {/* 音频淡入淡出（配音/音频轨） */}
              {(selectedClipTrack.kind === "voiceover" || selectedClipTrack.kind === "audio") && (
                <div className="fade-control">
                  <label className="style-field">
                    淡入（秒）
                    <input
                      type="number"
                      min={0}
                      max={5}
                      step={0.1}
                      value={selectedClip.fadeIn ?? 0}
                      onChange={(event) => updateSelectedClip({ fadeIn: Number(event.target.value) })}
                    />
                  </label>
                  <label className="style-field">
                    淡出（秒）
                    <input
                      type="number"
                      min={0}
                      max={5}
                      step={0.1}
                      value={selectedClip.fadeOut ?? 0}
                      onChange={(event) => updateSelectedClip({ fadeOut: Number(event.target.value) })}
                    />
                  </label>
                </div>
              )}

              {/* 音频降噪（剪映式"降噪"开关升级为强度滑块）。视频/配音/音频轨都支持 */}
              {(selectedClipTrack.kind === "voiceover" ||
                selectedClipTrack.kind === "audio" ||
                selectedClipTrack.kind === "video") && (
                <div className="style-field-column">
                  <label className="style-field">
                    降噪（{(selectedClip.noiseReduction ?? 0).toFixed(0)}）
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={selectedClip.noiseReduction ?? 0}
                      onChange={(event) =>
                        updateSelectedClip({ noiseReduction: Number(event.target.value) }, false)
                      }
                      onPointerUp={() => commitInteractiveEdit()}
                    />
                  </label>
                  <small className="style-hint">降低背景噪声（导出时生效）</small>
                </div>
              )}

              {isVisualTrackKind(selectedClipTrack.kind) && (
                <>
                  <div className="bound-asset-info">
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
                  <label className="style-field">
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
                    <div className="asset-candidates">
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
                    <div className="audio-actions">
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
                    <div className="trim-box">
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
                    <div className="trim-box">
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

                    {/* 滤镜预设 */}
                    <div className="filter-control">
                      <div className="speed-label">滤镜</div>
                      <div className="filter-presets">
                        {LUT_FILTERS.map((f) => (
                          <button
                            key={f.id}
                            className={`speed-preset ${(!selectedClip.filter && f.id === "none") || selectedClip.filter === f.id ? "active" : ""}`}
                            onClick={() => {
                              updateSelectedClip({ filter: f.id === "none" ? null : f.id });
                              // 加载/清除 LUT
                              if (filterRendererRef.current) {
                                if (f.id === "none") {
                                  filterRendererRef.current.clearLut();
                                } else {
                                  void getLutData(f.id).then((data) => {
                                    if (data) filterRendererRef.current?.loadLut(f.id, data);
                                  });
                                }
                              }
                            }}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 色彩调节 */}
                    <div className="fade-control">
                      <label className="style-field">
                        亮度
                        <input type="range" min={-100} max={100} step={1} value={selectedClip.brightness ?? 0}
                          onChange={(e) => updateSelectedClip({ brightness: Number(e.target.value) }, false)}
                          onPointerUp={() => commitInteractiveEdit()} />
                      </label>
                      <label className="style-field">
                        对比度
                        <input type="range" min={-100} max={100} step={1} value={selectedClip.contrast ?? 0}
                          onChange={(e) => updateSelectedClip({ contrast: Number(e.target.value) }, false)}
                          onPointerUp={() => commitInteractiveEdit()} />
                      </label>
                      <label className="style-field">
                        饱和度
                        <input type="range" min={-100} max={100} step={1} value={selectedClip.saturation ?? 0}
                          onChange={(e) => updateSelectedClip({ saturation: Number(e.target.value) }, false)}
                          onPointerUp={() => commitInteractiveEdit()} />
                      </label>
                      <label className="style-field">
                        色温
                        <input type="range" min={-100} max={100} step={1} value={selectedClip.temperature ?? 0}
                          onChange={(e) => updateSelectedClip({ temperature: Number(e.target.value) }, false)}
                          onPointerUp={() => commitInteractiveEdit()} />
                      </label>
                      <label className="style-field">
                        色调
                        <input type="range" min={-100} max={100} step={1} value={selectedClip.tint ?? 0}
                          onChange={(e) => updateSelectedClip({ tint: Number(e.target.value) }, false)}
                          onPointerUp={() => commitInteractiveEdit()} />
                      </label>
                    </div>

                  {isVisualTrackKind(selectedClipTrack.kind) && (
                    <div className="transform-box">
                      <div className="trim-title">
                        <Layers size={15} />
                        画面变换
                      </div>
                      {/* T4.2: 关键帧 —— 在播放头处为属性打关键帧 */}
                      <div className="keyframe-row">
                        <KeyframeLabel />
                        <div className="kf-buttons">
                          <button title="在播放头处为水平位置打关键帧" onClick={() => addKeyframeAtPlayhead("x", overlayTransform.x)}>◆ X</button>
                          <button title="在播放头处为垂直位置打关键帧" onClick={() => addKeyframeAtPlayhead("y", overlayTransform.y)}>◆ Y</button>
                          <button title="在播放头处为缩放打关键帧" onClick={() => addKeyframeAtPlayhead("scale", overlayTransform.scale)}>◆ 缩放</button>
                          <button title="在播放头处为旋转打关键帧" onClick={() => addKeyframeAtPlayhead("rotation", overlayTransform.rotation ?? 0)}>◆ 旋转</button>
                          <button title="在播放头处为不透明度打关键帧" onClick={() => addKeyframeAtPlayhead("opacity", overlayTransform.opacity ?? 100)}>◆ 透明</button>
                          <button title="在播放头处为音量打关键帧" onClick={() => addKeyframeAtPlayhead("volume", selectedClip?.volume ?? 1)}>◆ 音量</button>
                          {hasKeyframeAtPlayhead() && (
                            <button title="删除播放头处的关键帧" onClick={removeKeyframeAtPlayhead}>✕ 删帧</button>
                          )}
                          {selectedClip?.keyframes && (
                            <button title="清除所有关键帧" onClick={() => updateSelectedClip({ keyframes: null })}>✕ 清除</button>
                          )}
                        </div>
                        {hasKeyframeAtPlayhead() && (
                          <label className="style-field" style={{ marginTop: 6 }}>
                            <span className="kf-label">缓动</span>
                            <select
                              value={getKeyframeEasingAtPlayhead() ?? "linear"}
                              onChange={(event) => setKeyframeEasingAtPlayhead(event.target.value as "linear" | "easeIn" | "easeOut" | "easeInOut")}
                            >
                              <option value="linear">线性</option>
                              <option value="easeIn">缓入</option>
                              <option value="easeOut">缓出</option>
                              <option value="easeInOut">缓入缓出</option>
                            </select>
                          </label>
                        )}
                      </div>
                      <label>
                        水平位置（{overlayTransform.x.toFixed(0)}%）
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={overlayTransform.x}
                          onChange={(event) => updateOverlayTransform({ x: Number(event.target.value) }, false)}
                          onPointerUp={() => commitInteractiveEdit()}
                        />
                      </label>
                      <label>
                        垂直位置（{overlayTransform.y.toFixed(0)}%）
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={overlayTransform.y}
                          onChange={(event) => updateOverlayTransform({ y: Number(event.target.value) }, false)}
                          onPointerUp={() => commitInteractiveEdit()}
                        />
                      </label>
                      <label>
                        缩放（{overlayTransform.scale.toFixed(0)}%）
                        <input
                          type="range"
                          min={5}
                          max={100}
                          step={1}
                          value={overlayTransform.scale}
                          onChange={(event) => updateOverlayTransform({ scale: Number(event.target.value) }, false)}
                          onPointerUp={() => commitInteractiveEdit()}
                        />
                      </label>
                      <label>
                        旋转（{(overlayTransform.rotation ?? 0).toFixed(0)}°）
                        <input
                          type="range"
                          min={-180}
                          max={180}
                          step={1}
                          value={overlayTransform.rotation ?? 0}
                          onChange={(event) => updateOverlayTransform({ rotation: Number(event.target.value) }, false)}
                          onPointerUp={() => commitInteractiveEdit()}
                        />
                      </label>
                      <label>
                        不透明度（{overlayTransform.opacity.toFixed(0)}%）
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={overlayTransform.opacity}
                          onChange={(event) => updateOverlayTransform({ opacity: Number(event.target.value) }, false)}
                          onPointerUp={() => commitInteractiveEdit()}
                        />
                      </label>
                      <label>
                        混合模式
                        <select
                          value={overlayTransform.mix}
                          onChange={(event) => updateOverlayTransform({ mix: event.target.value })}
                        >
                          <option value="normal">正常</option>
                          <option value="overlay">叠加</option>
                          <option value="screen">滤色</option>
                          <option value="multiply">正片叠底</option>
                          <option value="addition">线性减淡(添加)</option>
                          <option value="softlight">柔光</option>
                          <option value="hardlight">强光</option>
                          <option value="lighten">变亮</option>
                          <option value="darken">变暗</option>
                          <option value="difference">差值</option>
                          <option value="exclusion">排除</option>
                          <option value="colorburn">颜色加深</option>
                          <option value="colordodge">颜色减淡</option>
                        </select>
                      </label>
                      <label>
                        圆角（{overlayTransform.cornerRadius}px）
                        <input
                          type="range"
                          min={0}
                          max={200}
                          step={1}
                          value={overlayTransform.cornerRadius}
                          onChange={(event) => updateOverlayTransform({ cornerRadius: Number(event.target.value) })}
                        />
                      </label>
                      {/* T4.4: 蒙版 */}
                      <div className="mask-section">
                        <span className="kf-label">蒙版</span>
                        <div className="kf-buttons">
                          {(["none", "circle", "rect", "linear", "mirror"] as const).map((k) => (
                            <button
                              key={k}
                              className="speed-preset"
                              onClick={() => {
                                if (k === "none") {
                                  updateSelectedClip({ mask: null });
                                } else {
                                  const cur = selectedClip.mask ?? { kind: k, cx: 0.5, cy: 0.5, width: 0.8, height: 0.8, rotation: 0, feather: 0.2, invert: false };
                                  updateSelectedClip({ mask: { ...cur, kind: k } });
                                }
                              }}
                            >
                              {k === "none" ? "无" : k === "circle" ? "圆形" : k === "rect" ? "矩形" : k === "linear" ? "线性" : "镜面"}
                            </button>
                          ))}
                        </div>
                        <MaskPreview mask={selectedClip.mask} />
                        {selectedClip.mask && (
                          <>
                            <label className="style-field">
                              中心 X（{Math.round((selectedClip.mask.cx ?? 0.5) * 100)}%）
                              <input
                                type="range" min={0} max={1} step={0.01}
                                value={selectedClip.mask.cx ?? 0.5}
                                onChange={(e) => updateSelectedClip({ mask: { ...selectedClip.mask!, cx: Number(e.target.value) } }, false)}
                                onPointerUp={() => commitInteractiveEdit()}
                              />
                            </label>
                            <label className="style-field">
                              中心 Y（{Math.round((selectedClip.mask.cy ?? 0.5) * 100)}%）
                              <input
                                type="range" min={0} max={1} step={0.01}
                                value={selectedClip.mask.cy ?? 0.5}
                                onChange={(e) => updateSelectedClip({ mask: { ...selectedClip.mask!, cy: Number(e.target.value) } }, false)}
                                onPointerUp={() => commitInteractiveEdit()}
                              />
                            </label>
                            <label className="style-field">
                              宽度（{Math.round((selectedClip.mask.width ?? 0.8) * 100)}%）
                              <input
                                type="range" min={0.05} max={1} step={0.01}
                                value={selectedClip.mask.width ?? 0.8}
                                onChange={(e) => updateSelectedClip({ mask: { ...selectedClip.mask!, width: Number(e.target.value) } }, false)}
                                onPointerUp={() => commitInteractiveEdit()}
                              />
                            </label>
                            <label className="style-field">
                              高度（{Math.round((selectedClip.mask.height ?? 0.8) * 100)}%）
                              <input
                                type="range" min={0.05} max={1} step={0.01}
                                value={selectedClip.mask.height ?? 0.8}
                                onChange={(e) => updateSelectedClip({ mask: { ...selectedClip.mask!, height: Number(e.target.value) } }, false)}
                                onPointerUp={() => commitInteractiveEdit()}
                              />
                            </label>
                            <label className="style-field">
                              旋转（{Math.round(selectedClip.mask.rotation ?? 0)}°）
                              <input
                                type="range" min={-180} max={180} step={1}
                                value={selectedClip.mask.rotation ?? 0}
                                onChange={(e) => updateSelectedClip({ mask: { ...selectedClip.mask!, rotation: Number(e.target.value) } }, false)}
                                onPointerUp={() => commitInteractiveEdit()}
                              />
                            </label>
                            <label className="style-field">
                              羽化（{Math.round((selectedClip.mask.feather ?? 0.2) * 100)}%）
                              <input
                                type="range" min={0} max={1} step={0.05}
                                value={selectedClip.mask.feather ?? 0.2}
                                onChange={(e) => updateSelectedClip({ mask: { ...selectedClip.mask!, feather: Number(e.target.value) } }, false)}
                                onPointerUp={() => commitInteractiveEdit()}
                              />
                            </label>
                            <label className="style-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                              <input
                                type="checkbox"
                                checked={selectedClip.mask.invert ?? false}
                                onChange={(e) => updateSelectedClip({ mask: { ...selectedClip.mask!, invert: e.target.checked } })}
                              />
                              <span>反转</span>
                            </label>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 视觉特效（剪映式"特效"面板） */}
                  {isVisualTrackKind(selectedClipTrack.kind) && (
                    <div className="mask-section">
                      <span className="kf-label">视觉特效</span>
                      <div className="kf-buttons">
                        {([
                          { id: "vignette", label: "暗角" },
                          { id: "glow", label: "发光" },
                          { id: "mirror", label: "镜像" },
                          { id: "invert", label: "反色" },
                          { id: "grayscale", label: "灰度" },
                          { id: "flicker", label: "闪烁" },
                          { id: "shake", label: "抖动" },
                        ] as const).map((eff) => {
                          const active = (selectedClip.visualEffects ?? []).some((e) => e.kind === eff.id);
                          return (
                            <button
                              key={eff.id}
                              className={`speed-preset ${active ? "active" : ""}`}
                              onClick={() => {
                                const cur = selectedClip.visualEffects ?? [];
                                const next = active
                                  ? cur.filter((e) => e.kind !== eff.id)
                                  : [...cur, { kind: eff.id, intensity: 50 }];
                                updateSelectedClip({ visualEffects: next.length > 0 ? next : null });
                              }}
                            >
                              {eff.label}
                            </button>
                          );
                        })}
                      </div>
                      {(selectedClip.visualEffects ?? []).map((eff, idx) => (
                        <label key={eff.kind} className="style-field">
                          {eff.kind === "vignette" ? "暗角" :
                           eff.kind === "glow" ? "发光" :
                           eff.kind === "mirror" ? "镜像" :
                           eff.kind === "invert" ? "反色" :
                           eff.kind === "grayscale" ? "灰度" :
                           eff.kind === "flicker" ? "闪烁" :
                           eff.kind === "shake" ? "抖动" : eff.kind}
                          （{eff.intensity.toFixed(0)}）
                          <input
                            type="range" min={0} max={100} step={5}
                            value={eff.intensity}
                            onChange={(e) => {
                              const next = [...(selectedClip.visualEffects ?? [])];
                              next[idx] = { ...next[idx], intensity: Number(e.target.value) };
                              updateSelectedClip({ visualEffects: next }, false);
                            }}
                            onPointerUp={() => commitInteractiveEdit()}
                          />
                        </label>
                      ))}
                      <small className="style-hint">视觉特效在导出时生效</small>
                    </div>
                  )}
                </>
              )}

              {selectedClip.transitionIn && (
                <div className="transition-info">
                  <SlidersHorizontal size={14} />
                  入场转场：{transitionName(selectedClip.transitionIn)}
                </div>
              )}
              {selectedClip.transitionOut && (
                <div className="transition-info">
                  <SlidersHorizontal size={14} />
                  出场转场：{transitionName(selectedClip.transitionOut)}
                </div>
              )}
            </div>
          ) : (
            <div className="empty-state">选中时间线片段后在这里调整属性</div>
          )}
        </aside>
        </Panel>
        </PanelGroup>
      </main>
        </Panel>
        <PanelResizeHandle />
        <Panel defaultSize="38%" minSize="12%">
      <section className="timeline-panel">
        <div className="timeline-head">
          <div className="timeline-tools">
            <button onClick={splitAtPlayhead} disabled={!project} title="分割 (Ctrl+B)">
              <Scissors size={15} />
              分割
            </button>
            <button onClick={() => deleteSelectedClip()} disabled={!selectedClip} title="删除片段 (Del)">
              <Trash2 size={15} />
              删除片段
            </button>
            <button onClick={copySelectedClip} disabled={!selectedClip} title="复制 (Ctrl+C)">
              <Copy size={15} />
              复制
            </button>
            <button onClick={pasteClip} disabled={!clipboardRef.current} title="粘贴 (Ctrl+V)">
              <ClipboardPaste size={15} />
              粘贴
            </button>
            <button onClick={duplicateSelectedClip} disabled={!selectedClip} title="复制片段 (Ctrl+D)">
              <CopyPlus size={15} />
              复制片段
            </button>
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
            <button onClick={handleAddChapter} disabled={!project} title="在播放头处添加章节标记">
              <Bookmark size={15} />
              章节
            </button>
            <button
              onClick={() => {
                if (!project) return;
                const t = usePlaybackStore.getState().currentTime;
                void persist({ ...project, coverTime: t }, `已设置封面（${t.toFixed(1)}s）`);
              }}
              disabled={!project}
              title="将播放头位置设为封面"
            >
              <ImagePlay size={15} />
              设为封面
            </button>
            <button onClick={() => { setShowExport(true); setExportState("idle"); }} disabled={!project}>
              <Download size={15} />
              导出
            </button>
          </div>
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
        </div>
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
        </Panel>
      </PanelGroup>

      <footer className="statusbar">
        <span>{status}</span>
        <span>{appInfo?.appDataDir || "加载中"}</span>
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
            onAddSubtitle: () => handleRecognizeSubtitles(false),
            onEditText: () => {
              // 字幕"编辑文字"：进入字幕编辑模式（textarea 直接改 text）
              setSelectedClipId(contextMenu.clip.id);
              setSubtitleEditing(true);
            },
          }}
        />
      )}

      {/* 导出弹窗 */}
      {/* 一键生成向导 */}
      <GenerateWizard
        open={showGenerate}
        onClose={() => { setShowGenerate(false); resetPipeline(); }}
        voiceProfiles={voiceProfiles}
        hasDeepSeekKey={!!settings.deepseekApiKey}
        hasPexelsKey={!!settings.pexelsApiKey}
        pipeline={pipeline}
        onStart={(input) => handleGeneratePipeline(input)}
        onError={(msg) => setStatus(msg)}
      />

      {/* EDL 预览：AI 分段后先让用户确认/编辑，再执行编排 */}
      {edlSegments && (
        <EdlPreview
          segments={edlSegments}
          totalDuration={edlSegments.reduce((s, x) => s + x.estimatedDuration, 0)}
          busy={edlBusy}
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

      {showSettings && (
        <div className="modal-backdrop">
          <div className="settings-modal">
            <div className="modal-title">
              <div>
                <SettingsIcon size={18} />
                <strong>统一设置</strong>
              </div>
              <button className="icon-button" onClick={() => setShowSettings(false)}>
                <XCircle size={18} />
              </button>
            </div>
            <div className="settings-grid">
              <label>
                DeepSeek Key
                <input
                  type="password"
                  value={settings.deepseekApiKey}
                  onChange={(event) => setSettings({ ...settings, deepseekApiKey: event.target.value })}
                  placeholder="sk-..."
                />
              </label>
              <label>
                Pexels Key
                <input
                  type="password"
                  value={settings.pexelsApiKey}
                  onChange={(event) => setSettings({ ...settings, pexelsApiKey: event.target.value })}
                />
              </label>
              <label>
                TTS 地址
                <input
                  value={settings.ttsBaseUrl}
                  onChange={(event) => setSettings({ ...settings, ttsBaseUrl: event.target.value })}
                />
              </label>
              <label>
                默认比例
                <select
                  value={settings.defaultRatio}
                  onChange={(event) => setSettings({ ...settings, defaultRatio: event.target.value })}
                >
                  {ratios.map((ratio) => (
                    <option key={ratio}>{ratio}</option>
                  ))}
                </select>
              </label>
              <label>
                渲染预设
                <select
                  value={settings.renderPreset}
                  onChange={(event) => setSettings({ ...settings, renderPreset: event.target.value })}
                >
                  <option value="preview-fast">快速预览</option>
                  <option value="export-high">高清导出</option>
                </select>
              </label>
              <label>
                Whisper 命令
                <input
                  value={settings.whisperBin || whisperDefaultBin}
                  onChange={(event) => setSettings({ ...settings, whisperBin: event.target.value })}
                  placeholder={whisperDefaultBin}
                />
              </label>
              <label>
                Whisper 模型路径（.bin 文件）
                <input
                  value={settings.whisperModel || ""}
                  onChange={(event) => setSettings({ ...settings, whisperModel: event.target.value })}
                  placeholder={whisperDefaultModel || "C:\\path\\to\\ggml-large-v3.bin"}
                />
              </label>
            </div>

            {/* 导出设置已移至导出弹窗 */}
            <p className="settings-hint" style={{ marginTop: 8 }}>
              导出设置（分辨率/帧率/码率）已移至「导出」弹窗，点击顶栏「导出」按钮即可设置。
            </p>
            <p className="settings-hint">
              音色管理在「音频」Tab。Whisper 安装：{whisperInstallHint}
            </p>
            <div className="modal-actions">
              <button onClick={() => setShowSettings(false)}>取消</button>
              <button className="primary-button" onClick={handleSaveSettings}>
                {busy === "settings" ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
                保存设置
              </button>
            </div>
          </div>
        </div>
      )}
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
