use std::path::PathBuf;

use tauri::{Emitter, State};

use crate::ai;
use crate::asr;
use crate::ffmpeg;
use crate::pexels;
use crate::models::{
    AppInfo, AppSettings, CacheAssetRequest, Clip, CreateProjectRequest,
    CreateVoiceProfileRequest, FfmpegStatus, GenerateAudioRequest, ImportMediaRequest,
    ImportVoiceProfileRequest, MediaSource, PexelsSearchRequest, Project, ProjectSummary,
    RenderProjectRequest, ReplaceVoiceSampleRequest, RenderResult, SegmentScriptRequest,
    SegmentScriptResult, SubtitleCue, ThumbnailRequest, Track, TrackKind,
    UpdateVoiceProfileRequest, VoicePreviewRequest, VoicePreviewResult, VoiceProfile,
};
use crate::storage;
use crate::storage::AppState;
use crate::tts;

fn map_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// 生成音频波形数据（min/max 峰值对数组）
#[tauri::command]
pub async fn generate_waveform(
    _state: State<'_, AppState>,
    request: ThumbnailRequest,
) -> Result<Vec<(f32, f32)>, String> {
    let path = PathBuf::from(&request.source_path);
    let peaks = ffmpeg::generate_waveform(&path, 200).await.map_err(map_error)?;
    Ok(peaks)
}

/// 在系统文件管理器中显示文件（macOS=Finder, Windows=Explorer）
#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("文件不存在：{path}"));
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(map_error)?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(map_error)?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(p.parent().unwrap_or(std::path::Path::new(".")))
            .spawn()
            .map_err(map_error)?;
    }
    Ok(())
}

/// 读取 LUT .cube 文件内容（从打包的 luts/ 目录）
#[tauri::command]
pub fn read_lut_file(name: String) -> Result<String, String> {
    // 优先从 exe 同目录的 luts/ 读，回退到编译时 include 的默认
    let lut_path = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.join("luts").join(format!("{name}.cube"))));

    if let Some(ref path) = lut_path {
        if path.exists() {
            return std::fs::read_to_string(path).map_err(map_error);
        }
    }

    // 回退：从编译时嵌入的 LUT 数据读
    let embedded = crate::lut_data::get_lut(&name);
    embedded
        .map(|s| s.to_string())
        .ok_or_else(|| format!("找不到 LUT 文件：{name}.cube"))
}

/// 临时诊断：把前端错误日志写到文件，便于排查
#[tauri::command]
pub fn write_debug_log(state: State<'_, AppState>, content: String) -> Result<String, String> {
    let log_path = state.paths.app_data_dir.join("error-log.txt");
    std::fs::write(&log_path, &content).map_err(map_error)?;
    Ok(log_path.to_string_lossy().to_string())
}

fn new_clip_id() -> String {
    format!("clip_{}", uuid::Uuid::new_v4())
}

// ============================================================================
// 基础信息 / 设置
// ============================================================================

#[tauri::command]
pub fn get_app_info(state: State<'_, AppState>) -> AppInfo {
    state.app_info()
}

#[tauri::command]
pub async fn check_ffmpeg() -> FfmpegStatus {
    ffmpeg::check_ffmpeg().await
}

#[tauri::command]
pub fn load_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let conn = state.db.lock().map_err(map_error)?;
    storage::load_settings(&conn).map_err(map_error)
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let conn = state.db.lock().map_err(map_error)?;
    storage::save_settings(&conn, &settings).map_err(map_error)
}

// ============================================================================
// 项目 CRUD
// ============================================================================

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> Result<Vec<ProjectSummary>, String> {
    let conn = state.db.lock().map_err(map_error)?;
    storage::list_projects(&conn).map_err(map_error)
}

#[tauri::command]
pub fn create_project(
    state: State<'_, AppState>,
    request: CreateProjectRequest,
) -> Result<Project, String> {
    let conn = state.db.lock().map_err(map_error)?;
    storage::create_project(&conn, request).map_err(map_error)
}

#[tauri::command]
pub fn get_project(state: State<'_, AppState>, id: String) -> Result<Project, String> {
    let conn = state.db.lock().map_err(map_error)?;
    storage::get_project(&conn, &id).map_err(map_error)
}

#[tauri::command]
pub fn save_project(state: State<'_, AppState>, project: Project) -> Result<Project, String> {
    let conn = state.db.lock().map_err(map_error)?;
    storage::save_project(&conn, &project).map_err(map_error)
}

#[tauri::command]
pub fn delete_project(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(map_error)?;
    storage::delete_project(&conn, &id).map_err(map_error)
}

/// 新增轨道
#[tauri::command]
pub fn add_track(
    state: State<'_, AppState>,
    project_id: String,
    kind: String,
    name: String,
) -> Result<Project, String> {
    let mut conn = state.db.lock().map_err(map_error)?;
    let tx = conn.transaction().map_err(map_error)?;
    let mut project = storage::get_project(&tx, &project_id).map_err(map_error)?;
    let track_kind = match kind.as_str() {
        "video" => crate::models::TrackKind::Video,
        "image" => crate::models::TrackKind::Image,
        "voiceover" => crate::models::TrackKind::Voiceover,
        "audio" => crate::models::TrackKind::Audio,
        "subtitle" => crate::models::TrackKind::Subtitle,
        other => return Err(format!("未知轨道类型：{other}")),
    };
    let next_order = project.tracks.iter().map(|t| t.order).max().unwrap_or(0) + 1;
    project.tracks.push(Track {
        id: format!("track_{}", uuid::Uuid::new_v4()),
        kind: track_kind,
        name,
        order: next_order,
        muted: false,
        locked: false,
    });
    let saved = storage::save_project(&tx, &project).map_err(map_error)?;
    tx.commit().map_err(map_error)?;
    drop(conn);
    Ok(saved)
}

// ============================================================================
// 音色
// ============================================================================

#[tauri::command]
pub fn list_voice_profiles(state: State<'_, AppState>) -> Result<Vec<VoiceProfile>, String> {
    let conn = state.db.lock().map_err(map_error)?;
    storage::list_voice_profiles(&conn).map_err(map_error)
}

#[tauri::command]
pub fn create_voice_profile(
    state: State<'_, AppState>,
    request: CreateVoiceProfileRequest,
) -> Result<VoiceProfile, String> {
    let conn = state.db.lock().map_err(map_error)?;
    storage::create_voice_profile(&conn, request).map_err(map_error)
}

#[tauri::command]
pub fn import_voice_profile(
    state: State<'_, AppState>,
    request: ImportVoiceProfileRequest,
) -> Result<VoiceProfile, String> {
    let conn = state.db.lock().map_err(map_error)?;
    storage::import_voice_profile(&conn, &state.paths.voices_dir, request).map_err(map_error)
}

#[tauri::command]
pub fn update_voice_profile(
    state: State<'_, AppState>,
    id: String,
    request: UpdateVoiceProfileRequest,
) -> Result<VoiceProfile, String> {
    let conn = state.db.lock().map_err(map_error)?;
    storage::update_voice_profile(&conn, &id, request).map_err(map_error)
}

#[tauri::command]
pub fn delete_voice_profile(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(map_error)?;
    storage::delete_voice_profile(&conn, &id).map_err(map_error)
}

/// 替换已有音色的参考音频（重新上传样音）
#[tauri::command]
pub fn replace_voice_sample(
    state: State<'_, AppState>,
    request: ReplaceVoiceSampleRequest,
) -> Result<VoiceProfile, String> {
    let conn = state.db.lock().map_err(map_error)?;
    storage::replace_voice_sample(&conn, &state.paths.voices_dir, request).map_err(map_error)
}

#[tauri::command]
pub async fn preview_voice_profile(
    state: State<'_, AppState>,
    request: VoicePreviewRequest,
) -> Result<VoicePreviewResult, String> {
    let (settings, voice) = {
        let conn = state.db.lock().map_err(map_error)?;
        (
            storage::load_settings(&conn).map_err(map_error)?,
            storage::get_voice_profile(&conn, &request.voice_id).map_err(map_error)?,
        )
    };
    tts::synthesize_voice_preview(&settings, &state.paths.cache_dir, &voice, &request.text)
        .await
        .map_err(map_error)
}

// ============================================================================
// AI / Pexels / TTS
// ============================================================================

#[tauri::command]
pub async fn segment_script(
    state: State<'_, AppState>,
    request: SegmentScriptRequest,
) -> Result<SegmentScriptResult, String> {
    let settings = {
        let conn = state.db.lock().map_err(map_error)?;
        storage::load_settings(&conn).map_err(map_error)?
    };
    ai::segment_script(&settings, request).await.map_err(map_error)
}

#[tauri::command]
pub async fn search_pexels_videos(
    state: State<'_, AppState>,
    request: PexelsSearchRequest,
) -> Result<Vec<MediaSource>, String> {
    let settings = {
        let conn = state.db.lock().map_err(map_error)?;
        storage::load_settings(&conn).map_err(map_error)?
    };
    pexels::search_videos(&settings, request).await.map_err(map_error)
}

/// 搜索 Pexels 图片（图片复用视频轨，作为静态画面）
#[tauri::command]
pub async fn search_pexels_photos(
    state: State<'_, AppState>,
    request: PexelsSearchRequest,
) -> Result<Vec<MediaSource>, String> {
    let settings = {
        let conn = state.db.lock().map_err(map_error)?;
        storage::load_settings(&conn).map_err(map_error)?
    };
    pexels::search_photos(&settings, request).await.map_err(map_error)
}

/// 下载/缓存某个素材到 app 数据目录，更新 local_path 后返回。
#[tauri::command]
pub async fn cache_asset_video(
    state: State<'_, AppState>,
    request: CacheAssetRequest,
) -> Result<MediaSource, String> {
    let local_path = ffmpeg::ensure_media_local(&state.paths.cache_dir, &request.asset)
        .await
        .map_err(map_error)?;
    let mut cached = request.asset;
    cached.local_path = Some(local_path.to_string_lossy().to_string());
    Ok(cached)
}

/// 为整个项目或单个 clip 生成配音。
/// 工作流：找到配音轨上的 clip → 按 clip.text 合成 TTS → 用 ffprobe 取真实时长 →
/// 自动对齐：把配音 clip 的 duration 设为真实时长，并同步调整同位置的字幕/视频 clip。
#[tauri::command]
pub async fn generate_audio(
    state: State<'_, AppState>,
    request: GenerateAudioRequest,
) -> Result<Project, String> {
    let (settings, mut project, voice) = {
        let conn = state.db.lock().map_err(map_error)?;
        let settings = storage::load_settings(&conn).map_err(map_error)?;
        let project = storage::get_project(&conn, &request.project_id).map_err(map_error)?;
        let voice_id = request
            .voice_id
            .clone()
            .or_else(|| settings.default_voice_id.clone());
        let voice = match voice_id {
            Some(id) if !id.trim().is_empty() => storage::get_voice_profile(&conn, &id).ok(),
            _ => None,
        };
        (settings, project, voice)
    };
    let voice = voice.ok_or_else(|| "请先在设置中上传克隆音色，并设为默认音色".to_string())?;

    // 收集要处理的配音 clip
    let voiceover_clips: Vec<String> = project
        .clips
        .iter()
        .filter(|clip| {
            let is_voiceover = project
                .tracks
                .iter()
                .any(|t| t.id == clip.track_id && t.kind == crate::models::TrackKind::Voiceover);
            if !is_voiceover {
                return false;
            }
            match &request.clip_id {
                Some(id) => clip.id == *id,
                None => true,
            }
        })
        .map(|clip| clip.id.clone())
        .collect();

    if voiceover_clips.is_empty() {
        return Err("配音轨上没有可生成配音的片段".to_string());
    }

    let audio_dir = state.paths.projects_dir.join(&project.id).join("audio");
    for clip_id in voiceover_clips {
        let clip = project
            .clips
            .iter()
            .find(|c| c.id == clip_id)
            .ok_or_else(|| format!("找不到片段 {clip_id}"))?;
        let text = clip.text.clone().unwrap_or_default();
        if text.trim().is_empty() {
            continue;
        }
        let stem = sanitize_file_stem(&clip.id);
        let (audio_path, real_duration) =
            tts::synthesize_segment_audio(&settings, &state.paths.cache_dir, &audio_dir, &voice, &text, &stem)
                .await
                .map_err(|error| format!("片段「{}」配音失败：{}", clip_id, error))?;

        // 用真实时长对齐该 clip，并把同一 MediaSource（TTS 音频）登记到素材库
        let source_id = format!("tts-{}", clip_id);
        let audio_source = MediaSource {
            id: source_id.clone(),
            kind: "audio".to_string(),
            title: format!("配音 {}", clip_id),
            url: None,
            local_path: Some(audio_path.to_string_lossy().to_string()),
            thumbnail_url: None,
            width: 0,
            height: 0,
            duration: real_duration,
            source: "tts".to_string(),
        };
        let mut existing = None;
        if let Some(idx) = project.media.iter().position(|m| m.id == source_id) {
            existing = Some(idx);
        }
        match existing {
            Some(idx) => project.media[idx] = audio_source,
            None => project.media.push(audio_source),
        }

        // 更新配音 clip：duration 对齐真实时长，绑定素材。
        // 注意：这里只改该配音 clip 自身的 duration/sourceId，不动 startOnTrack，
        // 也不动其他轨道的 clip —— 整条时间线的重排由前端 realignTimeline 统一完成。
        project.clips.iter_mut().for_each(|c| {
            if c.id == clip_id {
                c.duration = real_duration.max(1.0);
                c.source_id = Some(source_id.clone());
                c.source_out = real_duration.max(1.0);
            }
        });
    }

    let conn = state.db.lock().map_err(map_error)?;
    storage::save_project(&conn, &project).map_err(map_error)
}

// ============================================================================
// 音轨分离
// ============================================================================

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetachAudioRequest {
    pub project_id: String,
    pub clip_id: String,
}

/// 分离视频 clip 的音轨：提取音频 → 创建音频 MediaSource → 生成音频轨 clip → 原视频静音
#[tauri::command]
pub async fn detach_audio(
    state: State<'_, AppState>,
    request: DetachAudioRequest,
) -> Result<Project, String> {
    let mut project = {
        let conn = state.db.lock().map_err(map_error)?;
        storage::get_project(&conn, &request.project_id).map_err(map_error)?
    };

    // 找到要分离的视频 clip
    let clip = project
        .clips
        .iter()
        .find(|c| c.id == request.clip_id)
        .ok_or_else(|| "找不到指定的片段".to_string())?
        .clone();

    let source = clip
        .source_id
        .as_ref()
        .and_then(|sid| project.media.iter().find(|m| m.id == *sid))
        .ok_or_else(|| "片段没有绑定素材".to_string())?;

    // 确保素材已本地缓存
    let video_path = ffmpeg::ensure_media_local(&state.paths.cache_dir, source)
        .await
        .map_err(map_error)?;

    // 提取音频
    let audio_path = ffmpeg::extract_audio_from_video(&state.paths.cache_dir, &video_path)
        .await
        .map_err(map_error)?;

    // 探测音频时长
    let duration = crate::commands::probe_media_duration(&audio_path)
        .await
        .unwrap_or(clip.duration);

    // 创建音频 MediaSource
    let audio_source = MediaSource {
        id: format!("extracted-{}", uuid::Uuid::new_v4()),
        kind: "audio".to_string(),
        title: format!("音频 - {}", source.title),
        url: None,
        local_path: Some(audio_path.to_string_lossy().to_string()),
        thumbnail_url: None,
        width: 0,
        height: 0,
        duration,
        source: "extracted".to_string(),
    };
    project.media.push(audio_source.clone());

    // 找到或创建一个音频轨
    let audio_track = project.tracks.iter().find(|t| t.kind == crate::models::TrackKind::Audio);
    let audio_track_id = if let Some(t) = audio_track {
        t.id.clone()
    } else {
        // 创建音频轨
        let new_track = Track {
            id: format!("track_audio_{}", uuid::Uuid::new_v4()),
            kind: crate::models::TrackKind::Audio,
            name: "音频".to_string(),
            order: project.tracks.iter().map(|t| t.order).max().unwrap_or(0) + 1,
            muted: false,
            locked: false,
        };
        let tid = new_track.id.clone();
        project.tracks.push(new_track);
        tid
    };

    // 创建音频 clip（和视频 clip 对齐）
    let audio_clip = Clip {
        id: format!("clip_audio_{}", uuid::Uuid::new_v4()),
        track_id: audio_track_id,
        source_id: Some(audio_source.id.clone()),
        start_on_track: clip.start_on_track,
        duration: clip.duration,
        source_in: clip.source_in,
        source_out: clip.source_out,
        speed: clip.speed,
        volume: 1.0,
        fade_in: clip.fade_in,
        fade_out: clip.fade_out,
        filter: None,
        brightness: 0.0,
        contrast: 0.0,
        saturation: 0.0,
        transform: None,
        visual_query: None,
        text: None,
        subtitle_style: None,
        words: None,
        transition_in: None,
        crop: None,
        transition_out: None,
    };
    project.clips.push(audio_clip);

    // 原视频 clip 静音
    for c in project.clips.iter_mut() {
        if c.id == clip.id {
            c.volume = 0.0;
        }
    }

    let conn = state.db.lock().map_err(map_error)?;
    storage::save_project(&conn, &project).map_err(map_error)
}

/// 分离人声：把视频 clip 的音频分离为人声轨 + 伴奏轨
#[tauri::command]
pub async fn separate_vocals(
    state: State<'_, AppState>,
    request: DetachAudioRequest,
) -> Result<Project, String> {
    let mut project = {
        let conn = state.db.lock().map_err(map_error)?;
        storage::get_project(&conn, &request.project_id).map_err(map_error)?
    };

    let clip = project.clips.iter().find(|c| c.id == request.clip_id)
        .ok_or_else(|| "找不到片段".to_string())?.clone();

    let source = clip.source_id.as_ref()
        .and_then(|sid| project.media.iter().find(|m| m.id == *sid))
        .ok_or_else(|| "片段没有素材".to_string())?;

    let media_path = ffmpeg::ensure_media_local(&state.paths.cache_dir, source).await.map_err(map_error)?;

    // 先提取纯音频
    let audio_path = ffmpeg::extract_audio_from_video(&state.paths.cache_dir, &media_path).await.map_err(map_error)?;

    // 分离人声
    let (vocals_path, instrumental_path) = ffmpeg::separate_vocals(&state.paths.cache_dir, &audio_path).await.map_err(map_error)?;

    // 创建两个 MediaSource
    let vocals_source = MediaSource {
        id: format!("vocals-{}", uuid::Uuid::new_v4()),
        kind: "audio".to_string(),
        title: format!("人声 - {}", source.title),
        url: None,
        local_path: Some(vocals_path.to_string_lossy().to_string()),
        thumbnail_url: None, width: 0, height: 0,
        duration: clip.duration,
        source: "vocals".to_string(),
    };
    let inst_source = MediaSource {
        id: format!("inst-{}", uuid::Uuid::new_v4()),
        kind: "audio".to_string(),
        title: format!("伴奏 - {}", source.title),
        url: None,
        local_path: Some(instrumental_path.to_string_lossy().to_string()),
        thumbnail_url: None, width: 0, height: 0,
        duration: clip.duration,
        source: "instrumental".to_string(),
    };
    project.media.push(vocals_source.clone());
    project.media.push(inst_source.clone());

    // 找到或创建音频轨
    let audio_track_id = {
        if let Some(t) = project.tracks.iter().find(|t| t.kind == crate::models::TrackKind::Audio) {
            t.id.clone()
        } else {
            let tid = format!("track_audio_{}", uuid::Uuid::new_v4());
            project.tracks.push(Track {
                id: tid.clone(),
                kind: crate::models::TrackKind::Audio,
                name: "音频".to_string(),
                order: project.tracks.iter().map(|t| t.order).max().unwrap_or(0) + 1,
                muted: false, locked: false,
            });
            tid
        }
    };

    // 创建人声 clip + 伴奏 clip（和原视频对齐）
    for (sid, name) in [(vocals_source.id.clone(), "人声"), (inst_source.id.clone(), "伴奏")] {
        project.clips.push(Clip {
            id: format!("clip_{}_{}", name, uuid::Uuid::new_v4()),
            track_id: audio_track_id.clone(),
            source_id: Some(sid),
            start_on_track: clip.start_on_track,
            duration: clip.duration,
            source_in: clip.source_in,
            source_out: clip.source_out,
            speed: clip.speed,
            volume: if name == "人声" { 1.0 } else { 0.5 }, // 伴奏默认半音量
            fade_in: 0.0, fade_out: 0.0,
            filter: None, brightness: 0.0, contrast: 0.0, saturation: 0.0,
            transform: None, visual_query: None, text: None, subtitle_style: None, words: None,
            transition_in: None,
        crop: None, transition_out: None,
        });
    }

    // 原视频静音
    for c in project.clips.iter_mut() {
        if c.id == clip.id { c.volume = 0.0; }
    }

    let conn = state.db.lock().map_err(map_error)?;
    storage::save_project(&conn, &project).map_err(map_error)
}

// ============================================================================
// 字幕 ASR（语音识别 + AI 整理）
// ============================================================================

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateSubtitlesRequest {
    pub project_id: String,
    /// 是否翻译成中文（双语字幕）
    #[serde(default)]
    pub translate: bool,
}

/// 识别字幕：合并配音轨音频 → whisper 识别 → DeepSeek 整理（可选翻译）→ 生成字幕 clip
#[tauri::command]
pub async fn generate_subtitles(
    state: State<'_, AppState>,
    request: GenerateSubtitlesRequest,
) -> Result<Project, String> {
    let (settings, mut project) = {
        let conn = state.db.lock().map_err(map_error)?;
        (
            storage::load_settings(&conn).map_err(map_error)?,
            storage::get_project(&conn, &request.project_id).map_err(map_error)?,
        )
    };

    // 找字幕轨，没有则自动创建
    let subtitle_track_id = if let Some(t) = project.tracks.iter().find(|t| t.kind == TrackKind::Subtitle) {
        t.id.clone()
    } else {
        let tid = format!("track_subtitle_{}", uuid::Uuid::new_v4());
        project.tracks.push(Track {
            id: tid.clone(),
            kind: TrackKind::Subtitle,
            name: "字幕".to_string(),
            order: project.tracks.iter().map(|t| t.order).min().unwrap_or(0),
            muted: false,
            locked: false,
        });
        tid
    };

    // 收集所有配音轨 clip 的音频路径（按时间顺序）
    let voiceover_track_ids: Vec<String> = project
        .tracks
        .iter()
        .filter(|t| t.kind == TrackKind::Voiceover)
        .map(|t| t.id.clone())
        .collect();
    let mut audio_clips: Vec<&Clip> = project
        .clips
        .iter()
        .filter(|c| voiceover_track_ids.contains(&c.track_id))
        .collect();
    audio_clips.sort_by(|a, b| {
        a.start_on_track
            .partial_cmp(&b.start_on_track)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    if audio_clips.is_empty() {
        return Err("配音轨上没有音频，请先生成配音".to_string());
    }

    // 合并所有配音音频为一个 wav（用 ffmpeg concat）
    let audio_dir = state.paths.projects_dir.join(&project.id).join("audio");
    let merged_path = state.paths.cache_dir.join(format!(
        "asr-merged-{}.wav",
        chrono::Utc::now().timestamp_millis()
    ));
    let list_path = state.paths.cache_dir.join(format!(
        "asr-list-{}.txt",
        chrono::Utc::now().timestamp_millis()
    ));
    let mut list_content = String::new();
    for clip in &audio_clips {
        let source = clip.source_id.as_ref().and_then(|sid| {
            project.media.iter().find(|m| m.id == *sid)
        });
        if let Some(s) = source {
            if let Some(local) = &s.local_path {
                list_content.push_str(&format!(
                    "file '{}'\n",
                    local.replace('\'', "'\\''")
                ));
            }
        }
    }
    if list_content.is_empty() {
        return Err("配音音频文件不存在，请先生成配音".to_string());
    }
    tokio::fs::write(&list_path, &list_content).await.map_err(map_error)?;
    let merge_output = tokio::process::Command::new("ffmpeg")
        .args([
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            &list_path.to_string_lossy(),
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            &merged_path.to_string_lossy(),
        ])
        .output()
        .await
        .map_err(map_error)?;
    if !merge_output.status.success() {
        return Err(format!(
            "合并配音音频失败：{}",
            String::from_utf8_lossy(&merge_output.stderr).trim()
        ));
    }

    // whisper 识别
    let raw_cues = asr::transcribe_audio(&settings, &state.paths.cache_dir, &merged_path)
        .await
        .map_err(map_error)?;

    // DeepSeek 整理 + 可选翻译
    let refined = asr::refine_subtitles(&settings, &raw_cues, request.translate)
        .await
        .map_err(map_error)?;

    // 清空字幕轨现有 clip，用识别结果重建
    project.clips.retain(|c| c.track_id != subtitle_track_id);
    let _ = &audio_dir; // 预留
    for cue in &refined {
        let duration = (cue.end - cue.start).max(0.3);
        // 透传词级时间戳（非空时才存，避免空数组占用空间）
        let words = if cue.words.is_empty() {
            None
        } else {
            Some(cue.words.clone())
        };
        project.clips.push(Clip {
            id: format!("sub-{}", uuid::Uuid::new_v4()),
            track_id: subtitle_track_id.clone(),
            source_id: None,
            start_on_track: cue.start,
            duration,
            source_in: 0.0,
            source_out: duration,
            speed: 1.0,
            volume: 1.0,
            fade_in: 0.0,
            fade_out: 0.0,
            filter: None,
            brightness: 0.0,
            contrast: 0.0,
            saturation: 0.0,
            transform: None,
            visual_query: None,
            crop: None,
            text: Some(cue.text.clone()),
            subtitle_style: None,
            words,
            transition_in: None,
            transition_out: None,
        });
    }

    let conn = state.db.lock().map_err(map_error)?;
    storage::save_project(&conn, &project).map_err(map_error)
}

/// 导入本地文件：拷贝进 app 数据目录（绕过 assetProtocol scope 白名单），
/// 用 ffprobe 取时长，用 ffmpeg 抽缩略图（视频），返回 MediaSource。
#[tauri::command]
pub async fn import_media(
    state: State<'_, AppState>,
    request: ImportMediaRequest,
) -> Result<MediaSource, String> {
    let source_path = PathBuf::from(&request.source_path);
    if !source_path.is_file() {
        return Err(format!("文件不存在：{}", request.source_path));
    }

    // 先按扩展名判断是否图片（图片走单独处理路径）
    let ext_str = source_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();
    let is_image = matches!(
        ext_str.as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "tiff"
    );

    // 拷贝进 cache/media
    let media_dir = state.paths.cache_dir.join("media");
    std::fs::create_dir_all(&media_dir).map_err(map_error)?;
    let id = format!("local-{}", uuid::Uuid::new_v4());
    let ext = source_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("dat");
    let local_path = media_dir.join(format!("{id}.{ext}"));
    std::fs::copy(&source_path, &local_path).map_err(map_error)?;

    let (kind, width, height, duration, thumbnail): (String, u32, u32, f64, Option<String>) = if is_image {
        // 图片：读尺寸，无时长，缩略图就是图片本身
        let (w, h) = probe_image_dimensions(&local_path).await.unwrap_or((0, 0));
        ("image".to_string(), w, h, 0.0, Some(local_path.to_string_lossy().to_string()))
    } else {
        // 视频/音频：探测时长 + 分辨率 + 抽帧缩略图
        let duration = probe_media_duration(&local_path).await.unwrap_or(0.0);
        let (w, h) = probe_video_resolution(&local_path).await.unwrap_or((0, 0));
        let thumb = if w > 0 && h > 0 {
            ffmpeg::generate_thumbnail(&state.paths.cache_dir, &local_path, 0.5)
                .await
                .ok()
                .map(|p| p.to_string_lossy().to_string())
        } else {
            None
        };
        let kind = infer_kind(&local_path, w, h);
        (kind, w, h, duration, thumb)
    };

    Ok(MediaSource {
        id,
        kind,
        title: source_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("本地素材")
            .to_string(),
        url: None,
        local_path: Some(local_path.to_string_lossy().to_string()),
        thumbnail_url: thumbnail,
        width,
        height,
        duration,
        source: "local".to_string(),
    })
}

/// 为任意本地媒体生成缩略图，返回 asset 可访问的本地路径。
#[tauri::command]
pub async fn generate_thumbnail(
    state: State<'_, AppState>,
    request: ThumbnailRequest,
) -> Result<String, String> {
    let path = PathBuf::from(&request.source_path);
    let thumb = ffmpeg::generate_thumbnail(&state.paths.cache_dir, &path, request.at)
        .await
        .map_err(map_error)?;
    Ok(thumb.to_string_lossy().to_string())
}

fn infer_kind(path: &std::path::Path, width: u32, height: u32) -> String {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();
    // 优先按扩展名识别图片
    match ext.as_str() {
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "tiff" => return "image".to_string(),
        "mp3" | "wav" | "m4a" | "aac" | "flac" | "ogg" => return "audio".to_string(),
        _ => {}
    }
    // 视频有宽高信息
    if width > 0 && height > 0 {
        return "video".to_string();
    }
    "video".to_string()
}

/// 读取图片的宽高（用 ffprobe）
async fn probe_image_dimensions(path: &std::path::Path) -> anyhow::Result<(u32, u32)> {
    let output = tokio::process::Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=s=x:p=0",
            &path.to_string_lossy(),
        ])
        .output()
        .await?;
    if !output.status.success() {
        anyhow::bail!("ffprobe 读图片尺寸失败");
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parts: Vec<&str> = text.split('x').collect();
    if parts.len() != 2 {
        anyhow::bail!("解析图片尺寸失败");
    }
    Ok((parts[0].parse().unwrap_or(0), parts[1].parse().unwrap_or(0)))
}

async fn probe_media_duration(path: &std::path::Path) -> anyhow::Result<f64> {
    let output = tokio::process::Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            &path.to_string_lossy(),
        ])
        .output()
        .await?;
    if !output.status.success() {
        anyhow::bail!("ffprobe 失败");
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(text.parse().unwrap_or(0.0))
}

async fn probe_video_resolution(path: &std::path::Path) -> anyhow::Result<(u32, u32)> {
    let output = tokio::process::Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=s=x:p=0",
            &path.to_string_lossy(),
        ])
        .output()
        .await?;
    if !output.status.success() {
        anyhow::bail!("ffprobe 无视频流");
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parts: Vec<&str> = text.split('x').collect();
    if parts.len() != 2 {
        anyhow::bail!("解析分辨率失败");
    }
    Ok((parts[0].parse().unwrap_or(0), parts[1].parse().unwrap_or(0)))
}

/// 模式 1 音频识别：把音频文件转写成纯文本（不做字幕编排，只返回文字）
#[tauri::command]
pub async fn transcribe_to_text(
    state: State<'_, AppState>,
    audio_path: String,
) -> Result<String, String> {
    let settings = {
        let conn = state.db.lock().map_err(map_error)?;
        storage::load_settings(&conn).map_err(map_error)?
    };
    let path = std::path::PathBuf::from(&audio_path);
    if !path.exists() {
        return Err(format!("音频文件不存在：{audio_path}"));
    }
    let cues = asr::transcribe_audio(&settings, &state.paths.cache_dir, &path)
        .await
        .map_err(map_error)?;
    // 拼接所有 cue 的文本
    let text = cues
        .iter()
        .map(|c| c.text.trim())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if text.trim().is_empty() {
        return Err("音频识别结果为空，请检查音频文件或 whisper 配置".to_string());
    }
    Ok(text)
}

/// 音频模式：识别音频并返回句子级时间戳（驱动分镜编排）。
/// 与 transcribe_to_text 不同：保留每句的真实 start/end，用于精准分镜。
#[tauri::command]
pub async fn transcribe_to_sentences(
    state: State<'_, AppState>,
    audio_path: String,
) -> Result<crate::models::TimedSentencesResult, String> {
    let settings = {
        let conn = state.db.lock().map_err(map_error)?;
        storage::load_settings(&conn).map_err(map_error)?
    };
    let path = std::path::PathBuf::from(&audio_path);
    if !path.exists() {
        return Err(format!("音频文件不存在：{audio_path}"));
    }
    let (sentences, total_duration, full_text) =
        asr::transcribe_to_sentences(&settings, &state.paths.cache_dir, &path)
            .await
            .map_err(map_error)?;
    if sentences.is_empty() {
        return Err("音频识别结果为空，请检查音频文件或 whisper 配置".to_string());
    }
    Ok(crate::models::TimedSentencesResult {
        sentences,
        total_duration,
        full_text,
    })
}

/// 音频模式：给 whisper 识别的句子补充画面关键词/情绪（不改时间，不改数量顺序）。
#[tauri::command]
pub async fn enrich_segments(
    state: State<'_, AppState>,
    request: crate::models::EnrichSegmentsRequest,
) -> Result<Vec<crate::models::AiSegment>, String> {
    let settings = {
        let conn = state.db.lock().map_err(map_error)?;
        storage::load_settings(&conn).map_err(map_error)?
    };
    ai::enrich_segments(&settings, request)
        .await
        .map_err(map_error)
}

// ============================================================================
// 渲染
// ============================================================================

#[tauri::command]
pub async fn render_project(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    request: RenderProjectRequest,
) -> Result<RenderResult, String> {
    let project = {
        let conn = state.db.lock().map_err(map_error)?;
        storage::get_project(&conn, &request.project_id).map_err(map_error)?
    };

    // 发进度事件
    let _ = app_handle.emit("render-progress", serde_json::json!({ "progress": 0, "message": "准备渲染..." }));

    let render_output = ffmpeg::render_project_video(
        &state.paths.cache_dir,
        &state.paths.projects_dir,
        &project,
        request.preview,
    )
    .await
    .map_err(|e| {
        let _ = app_handle.emit("render-progress", serde_json::json!({ "progress": 0, "message": format!("渲染失败：{e}") }));
        map_error(e)
    })?;

    let _ = app_handle.emit("render-progress", serde_json::json!({ "progress": 90, "message": "正在烧录字幕和混音..." }));

    // 如果用户选择了导出路径，复制到用户路径
    let final_output_path = if let Some(ref user_path) = request.output_path {
        if !user_path.is_empty() && !request.preview {
            let user_path = std::path::PathBuf::from(user_path);
            // 确保父目录存在
            if let Some(parent) = user_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            // 复制到用户选择的路径
            std::fs::copy(&render_output, &user_path).map_err(map_error)?;
            user_path
        } else {
            render_output
        }
    } else {
        render_output
    };

    let mut next_project = project;
    if request.preview {
        next_project.preview_path = Some(final_output_path.to_string_lossy().to_string());
    } else {
        next_project.final_path = Some(final_output_path.to_string_lossy().to_string());
    }
    {
        let conn = state.db.lock().map_err(map_error)?;
        storage::save_project(&conn, &next_project).map_err(map_error)?;
    }

    let _ = app_handle.emit("render-progress", serde_json::json!({ "progress": 100, "message": "导出完成" }));

    Ok(RenderResult {
        preview_path: final_output_path.to_string_lossy().to_string(),
        command: if request.preview {
            "render-preview".to_string()
        } else {
            "render-final".to_string()
        },
    })
}

fn sanitize_file_stem(value: &str) -> String {
    value
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect()
}

// 保留以备未来 track 事务化操作使用
#[allow(dead_code)]
fn _new_clip_id() -> String {
    new_clip_id()
}
