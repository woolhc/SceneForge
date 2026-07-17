import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  AiSegment,
  AppInfo,
  AppSettings,
  FfmpegStatus,
  MediaSource,
  PexelsSearchResult,
  Project,
  ProjectSummary,
  RenderResult,
  SegmentScriptResult,
  SubtitleBreakAdviceResult,
  SubtitleLanguageContext,
  TrackKind,
  GenerateNarrationResult,
  VoicePreviewResult,
  VoiceProfile,
  WhisperModelDownloadProgress,
  WhisperModelStatus,
} from "./types";
import { DEFAULT_RENDER_CONFIG } from "./types";

const isTauri = "__TAURI_INTERNALS__" in window;
const storageKey = "scenescript-desktop-web-state";

type WebState = {
  settings: AppSettings;
  projects: Project[];
  voices: VoiceProfile[];
};

// 跨平台 whisper 默认值
const _isWin =
  typeof navigator !== "undefined" &&
  (navigator.platform?.toLowerCase().includes("win") ||
    navigator.userAgent?.toLowerCase().includes("win"));
const _isMac =
  typeof navigator !== "undefined" &&
  (navigator.platform?.toLowerCase().includes("mac") ||
    navigator.userAgent?.toLowerCase().includes("mac"));

const defaultSettings: AppSettings = {
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
  whisperBin: _isWin ? "whisper-cli.exe" : "whisper-cli",
  whisperModel: "",
};

function now() {
  return new Date().toISOString();
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function defaultTracks() {
  return [
    {
      id: "track_subtitle",
      kind: "subtitle" as TrackKind,
      name: "字幕",
      order: 0,
      muted: false,
      locked: false,
      hidden: false,
      height: 0,
    },
    {
      id: "track_voiceover",
      kind: "voiceover" as TrackKind,
      name: "配音",
      order: 1,
      muted: false,
      locked: false,
      hidden: false,
      height: 0,
    },
    {
      id: "track_video",
      kind: "video" as TrackKind,
      name: "视频",
      order: 2,
      muted: false,
      locked: false,
      hidden: false,
      height: 0,
    },
  ];
}

function newProject(title: string, ratio: string): Project {
  const timestamp = now();
  return {
    id: uid("project"),
    title,
    script: "",
    ratio,
    fps: 30,
    media: [],
    tracks: defaultTracks(),
    clips: [],
    renderConfig: { ...DEFAULT_RENDER_CONFIG },
    chapters: [],
    coverTime: null,
    previewPath: null,
    finalPath: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function normalizeWebProject(input: Partial<Project> | null | undefined): Project {
  const value = input && typeof input === "object" ? input : {};
  const fallback = newProject(value.title || "未命名项目", value.ratio || "9:16");
  return {
    ...fallback,
    ...value,
    id: value.id || fallback.id,
    title: value.title || fallback.title,
    script: value.script || "",
    ratio: value.ratio || fallback.ratio,
    fps: Number.isFinite(value.fps) ? value.fps as number : fallback.fps,
    media: Array.isArray(value.media) ? value.media : [],
    tracks: Array.isArray(value.tracks) && value.tracks.length > 0 ? value.tracks : defaultTracks(),
    clips: Array.isArray(value.clips) ? value.clips : [],
    renderConfig: { ...DEFAULT_RENDER_CONFIG, ...(value.renderConfig || {}) },
    chapters: Array.isArray(value.chapters) ? value.chapters : [],
    coverTime: value.coverTime ?? null,
    previewPath: value.previewPath ?? null,
    finalPath: value.finalPath ?? null,
    createdAt: value.createdAt || fallback.createdAt,
    updatedAt: value.updatedAt || value.createdAt || fallback.updatedAt,
  };
}

function readWebState(): WebState {
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return { settings: defaultSettings, projects: [], voices: [] };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<WebState>;
    return {
      settings: { ...defaultSettings, ...(parsed.settings || {}) },
      projects: Array.isArray(parsed.projects) ? parsed.projects.map(normalizeWebProject) : [],
      voices: Array.isArray(parsed.voices) ? parsed.voices : [],
    };
  } catch {
    return { settings: defaultSettings, projects: [], voices: [] };
  }
}

function writeWebState(state: WebState) {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

export interface PipelineError {
  code: string;
  message: string;
  retryable: boolean;
  step?: string | null;
  context?: unknown;
}

const RETRYABLE_CODES = new Set(["ASR_TIMEOUT", "PEXELS_429", "NETWORK", "AI_TIMEOUT", "TTS_TIMEOUT"]);
const MAX_RETRY = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 解析后端结构化错误；非 JSON 时按纯 message 兼容旧格式，并根据消息模式推断 code/retryable */
export function parsePipelineError(e: unknown): PipelineError {
  const raw = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.code === "string") {
      return {
        code: parsed.code,
        message: typeof parsed.message === "string" ? parsed.message : raw,
        retryable: Boolean(parsed.retryable),
        step: parsed.step,
        context: parsed.context,
      };
    }
  } catch {
    // 非 JSON，按纯 message 处理
  }
  return inferErrorFromMessage(raw);
}

/** 根据错误消息模式推断 code/retryable（兼容未走 map_pipeline_error 的旧错误） */
function inferErrorFromMessage(message: string): PipelineError {
  const lower = message.toLowerCase();
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("too many requests")) {
    return { code: "PEXELS_429", message, retryable: true };
  }
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("超时")) {
    return { code: "NETWORK", message, retryable: true };
  }
  if (lower.includes("network") || lower.includes("connection") || lower.includes("econnreset") || lower.includes("enotfound")) {
    return { code: "NETWORK", message, retryable: true };
  }
  if (lower.includes("deepseek") || lower.includes("api key") || lower.includes("unauthorized")) {
    return { code: "AI_AUTH", message, retryable: false };
  }
  return { code: "UNKNOWN", message, retryable: false };
}

async function invokeWithRetry<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      return await invoke<T>(command, args);
    } catch (e) {
      lastError = e;
      const parsed = parsePipelineError(e);
      if (!parsed.retryable || !RETRYABLE_CODES.has(parsed.code) || attempt >= MAX_RETRY) {
        throw e;
      }
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
  throw lastError;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) {
    return invokeWithRetry<T>(command, args);
  }
  return webFallback<T>(command, args);
}

async function webFallback<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const state = readWebState();

  if (command === "get_app_info") {
    return {
      appDataDir: "浏览器预览模式",
      cacheDir: "localStorage",
      modelsDir: "localStorage",
      databasePath: "localStorage",
    } as T;
  }

  if (command === "get_whisper_model_status") {
    return {
      model: {
        id: "medium-q5",
        name: "Medium Q5",
        fileName: "ggml-medium-q5_0.bin",
        sizeBytes: 539212467,
        sha256: "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f",
        description: "适合中文、英文和中英混合旁白，在准确率、速度和磁盘占用之间较平衡。",
        recommended: true,
      },
      available: false,
      resolvedPath: null,
      configuredPath: null,
      selectedModelId: null,
      downloadedBytes: 0,
      totalBytes: 539212467,
      partialDownload: false,
      downloading: false,
      modelsDir: "浏览器预览模式",
      whisperAvailable: false,
      whisperPath: "whisper-cli",
    } as T;
  }

  if (
    command === "download_whisper_model" ||
    command === "select_whisper_model" ||
    command === "delete_whisper_model" ||
    command === "open_models_directory"
  ) {
    throw new Error("浏览器预览模式无法管理本地 Whisper 模型，请在桌面客户端中使用");
  }

  if (command === "cancel_whisper_model_download") {
    return undefined as T;
  }

  if (command === "check_ffmpeg") {
    return {
      available: false,
      version: null,
      path: null,
      error: "浏览器预览模式无法检测 FFmpeg；Tauri 桌面端会调用本机 ffmpeg。",
    } as T;
  }

  if (command === "write_debug_log") {
    return "浏览器预览模式：错误日志已保存在 localStorage" as T;
  }

  if (command === "load_settings") {
    return state.settings as T;
  }

  if (command === "save_settings") {
    state.settings = { ...defaultSettings, ...(args?.settings as AppSettings) };
    writeWebState(state);
    return state.settings as T;
  }

  if (command === "list_projects") {
    return state.projects
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((project) => ({
        id: project.id,
        title: project.title,
        ratio: project.ratio,
        clipCount: project.clips.length,
        updatedAt: project.updatedAt,
      })) as T;
  }

  if (command === "create_project") {
    const request = args?.request as { title?: string; ratio?: string };
    const project = newProject(
      request?.title || "未命名项目",
      request?.ratio || "9:16",
    );
    state.projects.unshift(project);
    writeWebState(state);
    return project as T;
  }

  if (command === "get_project") {
    return (state.projects.find((project) => project.id === args?.id) || null) as T;
  }

  if (command === "save_project") {
    const project = normalizeWebProject({ ...(args?.project as Project), updatedAt: now() });
    const index = state.projects.findIndex((item) => item.id === project.id);
    if (index >= 0) state.projects[index] = project;
    else state.projects.unshift(project);
    writeWebState(state);
    return project as T;
  }

  if (command === "delete_project") {
    state.projects = state.projects.filter((project) => project.id !== args?.id);
    writeWebState(state);
    return undefined as T;
  }

  if (command === "add_track") {
    const project = state.projects.find((p) => p.id === args?.projectId);
    if (!project) throw new Error("Project not found");
    const order = project.tracks.reduce((max, t) => Math.max(max, t.order), -1) + 1;
    project.tracks.push({
      id: uid("track"),
      kind: args?.kind as TrackKind,
      name: (args?.name as string) || "新轨道",
      order,
      muted: false,
      locked: false,
    });
    project.updatedAt = now();
    writeWebState(state);
    return project as T;
  }

  if (command === "list_voice_profiles") {
    return state.voices as T;
  }

  if (command === "create_voice_profile") {
    const request = args?.request as {
      name: string;
      samplePath?: string | null;
      referenceText?: string | null;
      providerVoiceId?: string | null;
    };
    const voice: VoiceProfile = {
      id: uid("voice"),
      name: request.name,
      samplePath: request.samplePath || null,
      referenceText: request.referenceText || null,
      language: "Chinese",
      providerVoiceId: request.providerVoiceId || null,
      createdAt: now(),
    };
    state.voices.unshift(voice);
    writeWebState(state);
    return voice as T;
  }

  if (command === "import_voice_profile") {
    const request = args?.request as {
      name: string;
      fileName: string;
      bytes: number[];
      referenceText?: string | null;
    };
    const voice: VoiceProfile = {
      id: uid("voice"),
      name: request.name,
      // 浏览器模式无真实路径，但用一个非空标记让 UI 显示"已上传样音"
      samplePath: `web://${request.fileName}`,
      referenceText: request.referenceText || null,
      language: "Chinese",
      providerVoiceId: null,
      createdAt: now(),
    };
    state.voices.unshift(voice);
    writeWebState(state);
    return voice as T;
  }

  if (command === "replace_voice_sample") {
    const request = args?.request as { voiceId: string; fileName: string; bytes: number[] };
    const voice = state.voices.find((item) => item.id === request.voiceId);
    if (!voice) throw new Error("Voice not found");
    voice.samplePath = `web://${request.fileName}`;
    writeWebState(state);
    return voice as T;
  }

  if (command === "update_voice_profile") {
    const request = args?.request as { name?: string | null; referenceText?: string | null };
    const voice = state.voices.find((item) => item.id === args?.id);
    if (!voice) throw new Error("Voice not found");
    if (request.name?.trim()) voice.name = request.name.trim();
    if (request.referenceText !== undefined) voice.referenceText = request.referenceText || null;
    writeWebState(state);
    return voice as T;
  }

  if (command === "delete_voice_profile") {
    state.voices = state.voices.filter((voice) => voice.id !== args?.id);
    if (state.settings.defaultVoiceId === args?.id) {
      state.settings.defaultVoiceId = null;
    }
    writeWebState(state);
    return undefined as T;
  }

  if (command === "preview_voice_profile") {
    throw new Error("浏览器预览模式不能调用本机 TTS；请在 Tauri 客户端中试听");
  }

  if (command === "segment_script") {
    // 浏览器 fallback：简单按句号切分，产出 AiSegment（前端再编排成轨道）
    const request = args?.request as { script: string; ratio: string };
    const sentences = request.script
      .split(/(?<=[。！？!?])\s*/)
      .map((item) => item.trim())
      .filter(Boolean);
    const chunks = sentences.length ? sentences : [request.script.trim()].filter(Boolean);
    const segments: AiSegment[] = chunks.map((text, index) => ({
      title: `片段 ${index + 1}`,
      text,
      visualQuery: "calming nature landscape vertical video",
      mood: "治愈",
      estimatedDuration: Math.max(2, Math.round((text.length / 4.2) * 10) / 10),
    }));
    return { segments, rawSegmentCount: segments.length } as T;
  }

  if (command === "search_pexels_videos") {
    const request = args?.request as { query: string; ratio: string; perPage?: number; page?: number };
    const portrait = request.ratio === "9:16";
    const page = request.page ?? 1;
    const perPage = request.perPage || 3;
    const totalResults = perPage * 3;
    const assets: MediaSource[] = Array.from({ length: perPage }).map((_, index) => ({
      id: uid("pexels"),
      kind: "video",
      title: `${request.query || "Pexels"} #${(page - 1) * perPage + index + 1}`,
      url: null,
      localPath: null,
      proxyPath: null,
      proxyStatus: "none",
      proxyWidth: null,
      proxyHeight: null,
      thumbnailUrl: null,
      width: portrait ? 1080 : 1920,
      height: portrait ? 1920 : 1080,
      duration: 14 + index * 2,
      source: "pexels",
    }));
    return {
      assets,
      page,
      hasMore: page * perPage < totalResults,
      totalResults,
    } as PexelsSearchResult as T;
  }

  if (command === "search_pexels_photos") {
    const request = args?.request as { query: string; ratio: string; perPage?: number; page?: number };
    const portrait = request.ratio === "9:16";
    const page = request.page ?? 1;
    const perPage = request.perPage || 3;
    const totalResults = perPage * 3;
    const assets: MediaSource[] = Array.from({ length: perPage }).map((_, index) => ({
      id: uid("pexels-photo"),
      kind: "image",
      title: `${request.query || "Pexels"} #${(page - 1) * perPage + index + 1}`,
      url: null,
      localPath: null,
      proxyPath: null,
      proxyStatus: "none",
      proxyWidth: null,
      proxyHeight: null,
      thumbnailUrl: null,
      width: portrait ? 1080 : 1920,
      height: portrait ? 1920 : 1080,
      duration: 5,
      source: "pexels",
    }));
    return {
      assets,
      page,
      hasMore: page * perPage < totalResults,
      totalResults,
    } as PexelsSearchResult as T;
  }

  if (command === "cache_asset_video") {
    // 浏览器模式不真正下载，原样返回
    return (args?.request as { asset: MediaSource }).asset as T;
  }

  if (command === "import_media") {
    const request = args?.request as { sourcePath: string };
    const name = request.sourcePath.split("/").pop()?.split(".")[0] || "本地素材";
    return {
      id: uid("local"),
      kind: "video",
      title: name,
      url: null,
      localPath: request.sourcePath,
      proxyPath: null,
      proxyStatus: "none",
      proxyWidth: null,
      proxyHeight: null,
      thumbnailUrl: null,
      width: 1080,
      height: 1920,
      duration: 10,
      source: "local",
    } as T;
  }

  if (command === "generate_thumbnail") {
    return "" as T;
  }

  if (command === "generate_filmstrip") {
    return [] as T;
  }

  if (command === "generate_waveform") {
    return [] as T;
  }

  if (command === "transcribe_to_text" || command === "transcribe_to_sentences") {
    throw new Error("浏览器预览模式不能调用本机 Whisper；请在 Tauri 客户端中识别音频");
  }

  if (command === "enrich_segments") {
    const request = args?.request as {
      sentences: { start: number; end: number; text: string }[];
    };
    return request.sentences.map((sentence, index) => ({
      title: `片段 ${index + 1}`,
      text: sentence.text,
      visualQuery: "calming nature landscape vertical video",
      mood: "治愈",
      estimatedDuration: Math.max(0, sentence.end - sentence.start),
      start: sentence.start,
      end: sentence.end,
    })) as T;
  }

  if (command === "generate_audio") {
    // 浏览器 fallback：模拟给配音轨 clip 绑定一个占位素材
    const request = args?.request as { projectId: string; clipId?: string | null };
    const project = state.projects.find((item) => item.id === request.projectId);
    if (!project) throw new Error("Project not found");
    project.clips = project.clips.map((clip) => {
      if (request.clipId && clip.id !== request.clipId) return clip;
      if (!clip.text) return clip;
      const duration = Math.max(2.6, Math.min(14, clip.text.trim().length / 5.2));
      return {
        ...clip,
        duration,
        sourceOut: duration,
        sourceId: `tts-${clip.id}`,
      };
    });
    project.updatedAt = now();
    writeWebState(state);
    return project as T;
  }

  if (command === "generate_narration") {
    const request = args?.request as { projectId: string; text: string };
    const project = state.projects.find((item) => item.id === request.projectId);
    if (!project) throw new Error("Project not found");
    const duration = Math.max(2.6, Math.min(180, request.text.trim().length / 5.2));
    const sourceId = uid("tts-narration");
    const source: MediaSource = {
      id: sourceId,
      kind: "audio",
      title: "完整旁白",
      url: null,
      localPath: `web://${sourceId}.mp3`,
      proxyPath: null,
      proxyStatus: "none",
      proxyWidth: null,
      proxyHeight: null,
      thumbnailUrl: null,
      width: 0,
      height: 0,
      duration,
      source: "tts",
    };
    project.media = project.media.some((item) => item.id === source.id)
      ? project.media
      : [...project.media, source];
    project.updatedAt = now();
    writeWebState(state);
    return { audioPath: source.localPath, duration, sourceId } as T;
  }

  if (command === "save_subtitle_artifact") {
    const request = args?.request as { projectId: string; artifact: unknown };
    localStorage.setItem(`sceneforge-subtitle-artifact:${request.projectId}`, JSON.stringify(request.artifact));
    return `web://subtitle-artifact/${request.projectId}.json` as T;
  }

  if (command === "transcribe_project_narration") {
    throw new Error("浏览器模式无法读取项目旁白音频，请在桌面客户端中使用识别字幕");
  }

  if (command === "analyze_subtitle_language_context") {
    const request = args?.request as { projectTitle: string; script: string; transcript: string };
    return {
      summary: request.script || request.transcript.slice(0, 240),
      contentType: "other",
      tone: "natural",
      terms: [],
    } as T;
  }

  if (command === "advise_subtitle_breaks") {
    throw new Error("浏览器模式不支持 AI 字幕语义断句");
  }

  if (command === "refine_transcript") {
    const request = args?.request as {
      sentences: { start: number; end: number; text: string; words?: unknown[] }[];
      translate: boolean;
    };
    return request.sentences.map((sentence) => ({
      ...sentence,
      translated: request.translate ? `译：${sentence.text}` : null,
      words: sentence.words ?? [],
    })) as T;
  }

  if (
    command === "detach_audio" ||
    command === "separate_vocals" ||
    command === "generate_subtitles" ||
    command === "import_srt"
  ) {
    throw new Error("浏览器预览模式不支持该媒体处理操作；请在 Tauri 客户端中执行");
  }

  if (command === "render_project") {
    const request = args?.request as { projectId: string; preview: boolean };
    const project = state.projects.find((item) => item.id === request.projectId);
    if (!project) throw new Error("Project not found");
    if (request.preview) {
      project.previewPath = "浏览器预览模式：桌面端会生成 preview.mp4";
    } else {
      project.finalPath = "浏览器预览模式：桌面端会生成 final.mp4";
    }
    project.updatedAt = now();
    writeWebState(state);
    return {
      previewPath: request.preview ? project.previewPath : project.finalPath,
      command: request.preview ? "web-preview" : "web-final",
    } as T;
  }

  if (command === "cancel_render") {
    return undefined as T;
  }

  throw new Error(`Unknown command: ${command}`);
}

export const desktopApi = {
  getAppInfo: () => call<AppInfo>("get_app_info"),
  checkFfmpeg: () => call<FfmpegStatus>("check_ffmpeg"),
  writeDebugLog: (content: string) => call<string>("write_debug_log", { content }),
  loadSettings: () => call<AppSettings>("load_settings"),
  saveSettings: (settings: AppSettings) => call<AppSettings>("save_settings", { settings }),
  getWhisperModelStatus: () => call<WhisperModelStatus>("get_whisper_model_status"),
  downloadWhisperModel: (modelId = "medium-q5") =>
    call<WhisperModelStatus>("download_whisper_model", { modelId }),
  cancelWhisperModelDownload: () => call<void>("cancel_whisper_model_download"),
  selectWhisperModel: (path: string) =>
    call<WhisperModelStatus>("select_whisper_model", { path }),
  deleteWhisperModel: () => call<WhisperModelStatus>("delete_whisper_model"),
  openModelsDirectory: () => call<void>("open_models_directory"),
  pickWhisperModelFile: async () => {
    if (!isTauri) return null;
    const selected = await open({
      multiple: false,
      filters: [{ name: "Whisper 模型", extensions: ["bin"] }],
    });
    return typeof selected === "string" ? selected : null;
  },
  listenWhisperModelProgress: async (
    callback: (progress: WhisperModelDownloadProgress) => void,
  ) => {
    if (!isTauri) return () => {};
    const { listen } = await import("@tauri-apps/api/event");
    return listen<WhisperModelDownloadProgress>("whisper-model-download-progress", (event) => {
      callback(event.payload);
    });
  },
  listProjects: () => call<ProjectSummary[]>("list_projects"),
  createProject: (request: { title?: string; ratio?: string }) =>
    call<Project>("create_project", { request }),
  getProject: (id: string) => call<Project>("get_project", { id }),
  saveProject: (project: Project) => call<Project>("save_project", { project }),
  deleteProject: (id: string) => call<void>("delete_project", { id }),
  addTrack: (projectId: string, kind: TrackKind, name: string) =>
    call<Project>("add_track", { projectId, kind, name }),
  /** 弹出原生文件选择对话框，返回选中文件的绝对路径（桌面端）。浏览器返回 null。 */
  pickMediaFile: async () => {
    if (!isTauri) return null;
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: "媒体文件",
          extensions: [
            "mp4", "mov", "mkv", "webm", "avi", "m4v",
            "mp3", "wav", "m4a", "aac", "flac", "ogg",
            "jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff",
          ],
        },
      ],
    });
    if (typeof selected !== "string") return null;
    return selected;
  },
  /** 弹出原生文件选择对话框，返回选中 SRT 字幕文件的绝对路径（桌面端）。浏览器返回 null。 */
  pickSrtFile: async () => {
    if (!isTauri) return null;
    const selected = await open({
      multiple: false,
      filters: [
        { name: "SRT 字幕", extensions: ["srt"] },
        { name: "VTT 字幕", extensions: ["vtt"] },
      ],
    });
    if (typeof selected !== "string") return null;
    return selected;
  },
  /** 弹出原生保存对话框，选择导出位置 */
  pickExportPath: async (defaultName: string) => {
    if (!isTauri) return null;
    const selected = await save({
      defaultPath: defaultName,
      filters: [{ name: "MP4 视频", extensions: ["mp4"] }],
    });
    return typeof selected === "string" ? selected : null;
  },
  /** 在系统文件管理器中打开/显示文件 */
  revealInFinder: async (filePath: string) => {
    if (!isTauri) return;
    try {
      await invoke("reveal_path", { path: filePath });
    } catch {
      /* fallback: open parent dir */
    }
  },
  listVoiceProfiles: () => call<VoiceProfile[]>("list_voice_profiles"),
  createVoiceProfile: (request: { name: string; samplePath?: string | null; referenceText?: string | null; providerVoiceId?: string | null }) =>
    call<VoiceProfile>("create_voice_profile", { request }),
  importVoiceProfile: (request: { name: string; fileName: string; bytes: number[]; referenceText?: string | null }) =>
    call<VoiceProfile>("import_voice_profile", { request }),
  updateVoiceProfile: (id: string, request: { name?: string | null; referenceText?: string | null; samplePath?: string | null }) =>
    call<VoiceProfile>("update_voice_profile", { id, request }),
  replaceVoiceSample: (request: { voiceId: string; fileName: string; bytes: number[] }) =>
    call<VoiceProfile>("replace_voice_sample", { request }),
  deleteVoiceProfile: (id: string) => call<void>("delete_voice_profile", { id }),
  previewVoiceProfile: (request: { voiceId: string; text: string }) =>
    call<VoicePreviewResult>("preview_voice_profile", { request }),
  fileSrc: (path?: string | null) => {
    if (!path) return null;
    return isTauri ? convertFileSrc(path) : null;
  },
  mediaSrc: (path?: string | null) => {
    if (!path) return null;
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    return isTauri ? convertFileSrc(path) : path;
  },
  segmentScript: (request: { script: string; ratio: string }) =>
    call<SegmentScriptResult>("segment_script", { request }),
  searchPexelsVideos: (request: { query: string; ratio: string; perPage?: number; page?: number }) =>
    call<PexelsSearchResult>("search_pexels_videos", { request }),
  searchPexelsPhotos: (request: { query: string; ratio: string; perPage?: number; page?: number }) =>
    call<PexelsSearchResult>("search_pexels_photos", { request }),
  cacheAssetVideo: (asset: MediaSource) =>
    call<MediaSource>("cache_asset_video", { request: { asset } }),
  importMedia: (sourcePath: string) =>
    call<MediaSource>("import_media", { request: { sourcePath } }),
  generateThumbnail: (sourcePath: string, at = 0.5) =>
    call<string>("generate_thumbnail", { request: { sourcePath, at } }),
  /** T4.7: 生成视频胶片条缩略图（均匀取帧） */
  generateFilmstrip: (sourcePath: string, sourceIn: number, sourceOut: number, count: number) =>
    call<string[]>("generate_filmstrip", { request: { sourcePath, sourceIn, sourceOut, count } }),
  generateWaveform: (sourcePath: string) =>
    call<[number, number][]>("generate_waveform", { request: { sourcePath } }),
  generateAudio: (request: { projectId: string; clipId?: string | null; voiceId?: string | null }) =>
    call<Project>("generate_audio", { request }),
  generateNarration: (request: { projectId: string; text: string; voiceId?: string | null }) =>
    call<GenerateNarrationResult>("generate_narration", { request }),
  detachAudio: (request: { projectId: string; clipId: string }) =>
    call<Project>("detach_audio", { request }),
  separateVocals: (request: { projectId: string; clipId: string }) =>
    call<Project>("separate_vocals", { request }),
  generateSubtitles: (request: { projectId: string; translate: boolean }) =>
    call<Project>("generate_subtitles", { request }),
  importSrt: (request: { projectId: string; srtPath: string; timeOffset?: number }) =>
    call<Project>("import_srt", { request }),
  transcribeToText: (audioPath: string) =>
    call<string>("transcribe_to_text", { audioPath }),
  /** 音频模式：识别音频返回句子级时间戳（驱动分镜编排） */
  transcribeToSentences: (audioPath: string) =>
    call<{ sentences: { start: number; end: number; text: string; words?: import("./types").WordCue[] }[]; totalDuration: number; fullText: string }>(
      "transcribe_to_sentences",
      { audioPath },
    ),
  analyzeSubtitleLanguageContext: (request: {
    projectTitle: string;
    script: string;
    transcript: string;
    mode: import("./types").SubtitleGenerationMode;
  }) => call<SubtitleLanguageContext>("analyze_subtitle_language_context", { request }),
  /** AI 仅返回已有 word index 的语义断点建议；失败时由调用方回退规则引擎。 */
  adviseSubtitleBreaks: (request: {
    words: string[];
    wordTimings?: import("./types").SubtitleBreakWordTiming[];
    constraints?: import("./types").SubtitleBreakConstraints;
    context?: string;
    mode?: import("./types").SubtitleGenerationMode;
  }) => call<SubtitleBreakAdviceResult>("advise_subtitle_breaks", { request }),
  saveSubtitleArtifact: (projectId: string, artifact: unknown) =>
    call<string>("save_subtitle_artifact", { request: { projectId, artifact } }),
  /** 转写项目配音轨，只返回 transcript，不直接创建旧式字幕。 */
  transcribeProjectNarration: (projectId: string) =>
    call<import("./types").TimedSentencesResult>("transcribe_project_narration", { request: { projectId } }),
  /** 从已有 transcript 整理/翻译字幕，不再重复执行 Whisper。 */
  refineTranscript: (request: {
    sentences: { start: number; end: number; text: string; words?: import("./types").WordCue[] }[];
    translate: boolean;
    mode?: import("./types").SubtitleGenerationMode;
    context?: string;
  }) => call<Array<{ start: number; end: number; text: string; translated?: string | null; words?: import("./types").WordCue[] }>>("refine_transcript", { request }),
  /** 音频模式：给 whisper 句子配画面关键词（不改时间/数量/顺序） */
  enrichSegments: (request: {
    sentences: { start: number; end: number; text: string }[];
    ratio: string;
    materialDirection?: string;
  }) => call<AiSegment[]>("enrich_segments", { request }),
  renderProject: (request: { projectId: string; preview: boolean; outputPath?: string | null; ratio?: string | null }) =>
    call<RenderResult>("render_project", { request }),
  /** T3.3: 取消正在进行的渲染任务 */
  cancelRender: () => call<void>("cancel_render"),
};
