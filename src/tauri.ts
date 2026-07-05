import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  AiSegment,
  AppInfo,
  AppSettings,
  FfmpegStatus,
  MediaSource,
  Project,
  ProjectSummary,
  RenderResult,
  SegmentScriptResult,
  TrackKind,
  VoicePreviewResult,
  VoiceProfile,
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
  defaultRatio: "9:16",
  defaultVoiceId: null,
  renderPreset: "preview-fast",
  whisperBin: _isWin ? "whisper-cli.exe" : "whisper-cli",
  whisperModel: _isMac ? "/opt/homebrew/share/whisper-cpp/ggml-large-v3.bin" : "",
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
    },
    {
      id: "track_voiceover",
      kind: "voiceover" as TrackKind,
      name: "配音",
      order: 1,
      muted: false,
      locked: false,
    },
    {
      id: "track_video",
      kind: "video" as TrackKind,
      name: "视频",
      order: 2,
      muted: false,
      locked: false,
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
    previewPath: null,
    finalPath: null,
    createdAt: timestamp,
    updatedAt: timestamp,
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
      projects: parsed.projects || [],
      voices: parsed.voices || [],
    };
  } catch {
    return { settings: defaultSettings, projects: [], voices: [] };
  }
}

function writeWebState(state: WebState) {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) {
    return invoke<T>(command, args);
  }
  return webFallback<T>(command, args);
}

async function webFallback<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const state = readWebState();

  if (command === "get_app_info") {
    return {
      appDataDir: "浏览器预览模式",
      cacheDir: "localStorage",
      databasePath: "localStorage",
    } as T;
  }

  if (command === "check_ffmpeg") {
    return {
      available: false,
      version: null,
      path: null,
      error: "浏览器预览模式无法检测 FFmpeg；Tauri 桌面端会调用本机 ffmpeg。",
    } as T;
  }

  if (command === "load_settings") {
    return state.settings as T;
  }

  if (command === "save_settings") {
    state.settings = args?.settings as AppSettings;
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
    const project = { ...(args?.project as Project), updatedAt: now() };
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
    const request = args?.request as { query: string; ratio: string; perPage?: number };
    const portrait = request.ratio === "9:16";
    const assets: MediaSource[] = Array.from({ length: request.perPage || 3 }).map((_, index) => ({
      id: uid("pexels"),
      kind: "video",
      title: `${request.query || "Pexels"} #${index + 1}`,
      url: null,
      localPath: null,
      thumbnailUrl: null,
      width: portrait ? 1080 : 1920,
      height: portrait ? 1920 : 1080,
      duration: 14 + index * 2,
      source: "pexels",
    }));
    return assets as T;
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

  throw new Error(`Unknown command: ${command}`);
}

export const desktopApi = {
  getAppInfo: () => call<AppInfo>("get_app_info"),
  checkFfmpeg: () => call<FfmpegStatus>("check_ffmpeg"),
  writeDebugLog: (content: string) => call<string>("write_debug_log", { content }),
  loadSettings: () => call<AppSettings>("load_settings"),
  saveSettings: (settings: AppSettings) => call<AppSettings>("save_settings", { settings }),
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
          ],
        },
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
  searchPexelsVideos: (request: { query: string; ratio: string; perPage?: number }) =>
    call<MediaSource[]>("search_pexels_videos", { request }),
  searchPexelsPhotos: (request: { query: string; ratio: string; perPage?: number }) =>
    call<MediaSource[]>("search_pexels_photos", { request }),
  cacheAssetVideo: (asset: MediaSource) =>
    call<MediaSource>("cache_asset_video", { request: { asset } }),
  importMedia: (sourcePath: string) =>
    call<MediaSource>("import_media", { request: { sourcePath } }),
  generateThumbnail: (sourcePath: string, at = 0.5) =>
    call<string>("generate_thumbnail", { request: { sourcePath, at } }),
  generateWaveform: (sourcePath: string) =>
    call<[number, number][]>("generate_waveform", { request: { sourcePath } }),
  generateAudio: (request: { projectId: string; clipId?: string | null; voiceId?: string | null }) =>
    call<Project>("generate_audio", { request }),
  detachAudio: (request: { projectId: string; clipId: string }) =>
    call<Project>("detach_audio", { request }),
  separateVocals: (request: { projectId: string; clipId: string }) =>
    call<Project>("separate_vocals", { request }),
  generateSubtitles: (request: { projectId: string; translate: boolean }) =>
    call<Project>("generate_subtitles", { request }),
  renderProject: (request: { projectId: string; preview: boolean; outputPath?: string | null }) =>
    call<RenderResult>("render_project", { request }),
};
