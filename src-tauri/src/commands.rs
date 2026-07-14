use std::path::PathBuf;

use tauri::{Emitter, State};

use crate::ai;
use crate::asr;
use crate::ffmpeg;
use crate::models::{
    AppInfo, AppSettings, CacheAssetRequest, Clip, CreateProjectRequest, CreateVoiceProfileRequest,
    FfmpegStatus, FilmstripRequest, GenerateAudioRequest, GenerateNarrationRequest,
    GenerateNarrationResult, ImportMediaRequest, ImportVoiceProfileRequest, MediaSource,
    PexelsSearchRequest, Project, ProjectSummary, RenderProjectRequest, RenderResult,
    ReplaceVoiceSampleRequest, SegmentScriptRequest, SegmentScriptResult, ThumbnailRequest, Track,
    TrackKind, UpdateVoiceProfileRequest, VoicePreviewRequest, VoicePreviewResult, VoiceProfile,
    WordCue,
};
use crate::pexels;
use crate::storage;
use crate::storage::AppState;
use crate::tts;
use crate::whisper_models::{self, WhisperModelStatus};

fn map_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// 结构化错误：前端可解析 code/retryable 决定是否提示重试
#[derive(Debug, Clone, serde::Serialize)]
pub struct PipelineError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub step: Option<String>,
    pub context: Option<serde_json::Value>,
}

/// 生成结构化错误 JSON 字符串（前端 parsePipelineError 解析）
pub fn map_pipeline_error<E: std::fmt::Display>(err: E, code: &str, retryable: bool) -> String {
    let message = err.to_string();
    let pipeline_err = PipelineError {
        code: code.to_string(),
        message: message.clone(),
        retryable,
        step: None,
        context: None,
    };
    serde_json::to_string(&pipeline_err).unwrap_or_else(|_| {
        format!(
            "{{\"code\":\"{}\",\"message\":\"{}\",\"retryable\":{}}}",
            code,
            message.replace('"', "\\\""),
            retryable
        )
    })
}

/// 带步骤标识的结构化错误
pub fn map_pipeline_error_step<E: std::fmt::Display>(
    err: E,
    code: &str,
    retryable: bool,
    step: &str,
) -> String {
    let message = err.to_string();
    let pipeline_err = PipelineError {
        code: code.to_string(),
        message: message.clone(),
        retryable,
        step: Some(step.to_string()),
        context: None,
    };
    serde_json::to_string(&pipeline_err).unwrap_or_else(|_| {
        format!(
            "{{\"code\":\"{}\",\"message\":\"{}\",\"retryable\":{},\"step\":\"{}\"}}",
            code,
            message.replace('"', "\\\""),
            retryable,
            step
        )
    })
}

/// 生成音频波形数据（min/max 峰值对数组）
#[tauri::command]
pub async fn generate_waveform(
    _state: State<'_, AppState>,
    request: ThumbnailRequest,
) -> Result<Vec<(f32, f32)>, String> {
    let path = PathBuf::from(&request.source_path);
    let peaks = ffmpeg::generate_waveform(&path, 200)
        .await
        .map_err(map_error)?;
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
    let lut_path = std::env::current_exe().ok().and_then(|exe| {
        exe.parent()
            .map(|p| p.join("luts").join(format!("{name}.cube")))
    });

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

#[tauri::command]
pub fn get_whisper_model_status(state: State<'_, AppState>) -> Result<WhisperModelStatus, String> {
    let settings = {
        let conn = state.db.lock().map_err(map_error)?;
        storage::load_settings(&conn).map_err(map_error)?
    };
    Ok(whisper_models::get_status(
        &state.paths.models_dir,
        &settings,
        state
            .whisper_download_active
            .load(std::sync::atomic::Ordering::Relaxed),
    ))
}

#[tauri::command]
pub async fn download_whisper_model(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    model_id: String,
) -> Result<WhisperModelStatus, String> {
    if model_id != "medium-q5" {
        return Err(format!("未知的 Whisper 模型：{model_id}"));
    }
    let _guard = state
        .whisper_download_lock
        .try_lock()
        .map_err(|_| "已有 Whisper 模型下载任务正在进行".to_string())?;
    state
        .whisper_download_active
        .store(true, std::sync::atomic::Ordering::Relaxed);
    state
        .whisper_download_cancel
        .store(false, std::sync::atomic::Ordering::Relaxed);

    let result = whisper_models::download_recommended_model(
        &state.paths.models_dir,
        &app_handle,
        &state.whisper_download_cancel,
    )
    .await;
    state
        .whisper_download_active
        .store(false, std::sync::atomic::Ordering::Relaxed);

    let path = result.map_err(|error| map_pipeline_error(error, "WHISPER_MODEL_DOWNLOAD", true))?;
    let settings = {
        let conn = state.db.lock().map_err(map_error)?;
        let mut settings = storage::load_settings(&conn).map_err(map_error)?;
        settings.whisper_model = path.to_string_lossy().to_string();
        storage::save_settings(&conn, &settings).map_err(map_error)?
    };
    Ok(whisper_models::get_status(
        &state.paths.models_dir,
        &settings,
        false,
    ))
}

#[tauri::command]
pub fn cancel_whisper_model_download(state: State<'_, AppState>) -> Result<(), String> {
    state
        .whisper_download_cancel
        .store(true, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn select_whisper_model(
    state: State<'_, AppState>,
    path: String,
) -> Result<WhisperModelStatus, String> {
    let _guard = state
        .whisper_download_lock
        .try_lock()
        .map_err(|_| "Whisper 模型下载期间不能切换模型".to_string())?;
    let path = PathBuf::from(path);
    whisper_models::validate_selected_model(&path).map_err(map_error)?;
    let settings = {
        let conn = state.db.lock().map_err(map_error)?;
        let mut settings = storage::load_settings(&conn).map_err(map_error)?;
        settings.whisper_model = path.to_string_lossy().to_string();
        storage::save_settings(&conn, &settings).map_err(map_error)?
    };
    Ok(whisper_models::get_status(
        &state.paths.models_dir,
        &settings,
        state
            .whisper_download_active
            .load(std::sync::atomic::Ordering::Relaxed),
    ))
}

#[tauri::command]
pub fn delete_whisper_model(state: State<'_, AppState>) -> Result<WhisperModelStatus, String> {
    let _guard = state
        .whisper_download_lock
        .try_lock()
        .map_err(|_| "Whisper 模型下载期间不能删除模型".to_string())?;
    let managed = whisper_models::managed_model_path(&state.paths.models_dir);
    let settings_before = {
        let conn = state.db.lock().map_err(map_error)?;
        storage::load_settings(&conn).map_err(map_error)?
    };
    if !settings_before.whisper_model.trim().is_empty()
        && PathBuf::from(&settings_before.whisper_model) != managed
    {
        return Err(
            "自定义 Whisper 模型不会由 SceneForge 删除，请在文件管理器中自行管理".to_string(),
        );
    }
    whisper_models::delete_managed_model(&state.paths.models_dir).map_err(map_error)?;
    let settings = {
        let conn = state.db.lock().map_err(map_error)?;
        let mut settings = settings_before;
        if PathBuf::from(&settings.whisper_model) == managed {
            settings.whisper_model.clear();
            storage::save_settings(&conn, &settings).map_err(map_error)?;
        }
        settings
    };
    Ok(whisper_models::get_status(
        &state.paths.models_dir,
        &settings,
        false,
    ))
}

#[tauri::command]
pub fn open_models_directory(state: State<'_, AppState>) -> Result<(), String> {
    let path = &state.paths.models_dir;
    std::fs::create_dir_all(path).map_err(map_error)?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(path)
        .spawn()
        .map_err(map_error)?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(path)
        .spawn()
        .map_err(map_error)?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map_err(map_error)?;
    Ok(())
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
    let mut project = storage::get_project(&conn, &id).map_err(map_error)?;
    if ffmpeg::reconcile_project_media_cache(&mut project, &state.paths.cache_dir) {
        project = storage::save_project(&conn, &project).map_err(map_error)?;
    }
    Ok(project)
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
        hidden: false,
        height: 0,
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
pub async fn generate_narration(
    state: State<'_, AppState>,
    request: GenerateNarrationRequest,
) -> Result<GenerateNarrationResult, String> {
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

    let audio_dir = state.paths.projects_dir.join(&project.id).join("audio");
    let source_id = format!("tts-narration-{}", chrono::Utc::now().timestamp_millis());
    let stem = sanitize_file_stem(&source_id);
    let (audio_path, duration) =
        tts::synthesize_full_narration(&settings, &audio_dir, voice.as_ref(), &request.text, &stem)
            .await
            .map_err(map_error)?;

    let audio_source = MediaSource {
        id: source_id.clone(),
        kind: "audio".to_string(),
        title: "完整旁白".to_string(),
        url: None,
        local_path: Some(audio_path.to_string_lossy().to_string()),
        proxy_path: None,
        proxy_status: Some("none".to_string()),
        proxy_width: None,
        proxy_height: None,
        thumbnail_url: None,
        width: 0,
        height: 0,
        duration,
        source: "tts".to_string(),
    };
    project.media.push(audio_source);

    let conn = state.db.lock().map_err(map_error)?;
    let saved = storage::save_project(&conn, &project).map_err(map_error)?;
    let source = saved
        .media
        .iter()
        .find(|item| item.id == source_id)
        .ok_or_else(|| "旁白素材保存失败".to_string())?;

    Ok(GenerateNarrationResult {
        audio_path: source.local_path.clone().unwrap_or_default(),
        duration: source.duration,
        source_id,
    })
}

#[tauri::command]
pub async fn segment_script(
    state: State<'_, AppState>,
    request: SegmentScriptRequest,
) -> Result<SegmentScriptResult, String> {
    let settings = {
        let conn = state.db.lock().map_err(map_error)?;
        storage::load_settings(&conn).map_err(map_error)?
    };
    ai::segment_script(&settings, request)
        .await
        .map_err(map_error)
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
    pexels::search_videos(&settings, request)
        .await
        .map_err(map_error)
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
    pexels::search_photos(&settings, request)
        .await
        .map_err(map_error)
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
    if cached.kind == "video" {
        match ffmpeg::generate_proxy_video(&state.paths.cache_dir, &local_path, &cached.id).await {
            Ok((proxy, w, h)) => {
                cached.proxy_path = Some(proxy.to_string_lossy().to_string());
                cached.proxy_status = Some("ready".to_string());
                cached.proxy_width = Some(w);
                cached.proxy_height = Some(h);
            }
            Err(error) => {
                eprintln!("代理视频生成失败（{}）：{error}", cached.id);
                cached.proxy_status = Some("failed".to_string());
            }
        }
    }
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
    // T1.10: 收集本次产物，await 后重读最新 project 定向合并（避免覆盖用户并发编辑）
    let mut generated_media: Vec<(String, MediaSource)> = Vec::new();
    let mut generated_clip_updates: Vec<(String, String, f64)> = Vec::new();
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
            tts::synthesize_segment_audio(&settings, &audio_dir, voice.as_ref(), &text, &stem)
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
            proxy_path: None,
            proxy_status: Some("none".to_string()),
            proxy_width: None,
            proxy_height: None,
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
            Some(idx) => project.media[idx] = audio_source.clone(),
            None => project.media.push(audio_source.clone()),
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

        // 记录本次产物，稍后合并到最新 project（避免覆盖用户并发编辑）
        generated_media.push((source_id.clone(), audio_source));
        generated_clip_updates.push((clip_id.clone(), source_id.clone(), real_duration));
    }

    // T1.10 修复：重读最新 project（用户可能在 TTS 期间编辑过），定向合并本次产物
    let conn = state.db.lock().map_err(map_error)?;
    let mut latest = storage::get_project(&conn, &request.project_id).map_err(map_error)?;
    // 合并 media
    for (sid, src) in &generated_media {
        if let Some(idx) = latest.media.iter().position(|m| m.id == *sid) {
            latest.media[idx] = src.clone();
        } else {
            latest.media.push(src.clone());
        }
    }
    // 合并 clip 更新（按 clip_id 定位；若用户已删除该 clip 则跳过）
    for (clip_id, source_id, real_duration) in &generated_clip_updates {
        latest.clips.iter_mut().for_each(|c| {
            if c.id == *clip_id {
                c.duration = real_duration.max(1.0);
                c.source_out = real_duration.max(1.0);
                c.source_id = Some(source_id.clone());
            }
        });
    }
    storage::save_project(&conn, &latest).map_err(map_error)
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
    let project = {
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
        proxy_path: None,
        proxy_status: Some("none".to_string()),
        proxy_width: None,
        proxy_height: None,
        thumbnail_url: None,
        width: 0,
        height: 0,
        duration,
        source: "extracted".to_string(),
    };
    let conn = state.db.lock().map_err(map_error)?;
    let mut latest = storage::get_project(&conn, &request.project_id).map_err(map_error)?;
    if !latest.clips.iter().any(|c| c.id == clip.id) {
        return Ok(latest);
    }
    if let Some(idx) = latest.media.iter().position(|m| m.id == audio_source.id) {
        latest.media[idx] = audio_source.clone();
    } else {
        latest.media.push(audio_source.clone());
    }

    // 找到或创建一个音频轨（多轨支持：取 order 最小的音频轨，找不到则创建）
    let audio_track_id = if let Some(t) = latest
        .tracks
        .iter()
        .filter(|t| t.kind == crate::models::TrackKind::Audio)
        .min_by_key(|t| t.order)
    {
        t.id.clone()
    } else {
        let new_track = Track {
            id: format!("track_audio_{}", uuid::Uuid::new_v4()),
            kind: crate::models::TrackKind::Audio,
            name: "音频".to_string(),
            order: latest.tracks.iter().map(|t| t.order).max().unwrap_or(0) + 1,
            muted: false,
            locked: false,
            hidden: false,
            height: 0,
        };
        let tid = new_track.id.clone();
        latest.tracks.push(new_track);
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
        speed_curve: None,
        volume: 1.0,
        fade_in: clip.fade_in,
        fade_out: clip.fade_out,
        noise_reduction: 0.0,
        filter: None,
        brightness: 0.0,
        contrast: 0.0,
        saturation: 0.0,
        temperature: 0.0,
        tint: 0.0,
        transform: None,
        visual_query: None,
        text: None,
        subtitle_style: None,
        words: None,
        subtitle_group_id: None,
        subtitle_role: None,
        subtitle_language: None,
        transition_in: None,
        crop: None,
        transition_out: None,
        keyframes: None,
        mask: None,
        visual_effects: None,
        reverse: false,
    };
    if let Some(idx) = latest.clips.iter().position(|c| c.id == audio_clip.id) {
        latest.clips[idx] = audio_clip;
    } else {
        latest.clips.push(audio_clip);
    }

    // 原视频 clip 静音
    for c in latest.clips.iter_mut() {
        if c.id == clip.id {
            c.volume = 0.0;
        }
    }

    storage::save_project(&conn, &latest).map_err(map_error)
}

/// 分离人声：把视频 clip 的音频分离为人声轨 + 伴奏轨
#[tauri::command]
pub async fn separate_vocals(
    state: State<'_, AppState>,
    request: DetachAudioRequest,
) -> Result<Project, String> {
    let project = {
        let conn = state.db.lock().map_err(map_error)?;
        storage::get_project(&conn, &request.project_id).map_err(map_error)?
    };

    let clip = project
        .clips
        .iter()
        .find(|c| c.id == request.clip_id)
        .ok_or_else(|| "找不到片段".to_string())?
        .clone();

    let source = clip
        .source_id
        .as_ref()
        .and_then(|sid| project.media.iter().find(|m| m.id == *sid))
        .ok_or_else(|| "片段没有素材".to_string())?;

    let media_path = ffmpeg::ensure_media_local(&state.paths.cache_dir, source)
        .await
        .map_err(map_error)?;

    // 先提取纯音频
    let audio_path = ffmpeg::extract_audio_from_video(&state.paths.cache_dir, &media_path)
        .await
        .map_err(map_error)?;

    // 分离人声
    let (vocals_path, instrumental_path) =
        ffmpeg::separate_vocals(&state.paths.cache_dir, &audio_path)
            .await
            .map_err(map_error)?;

    // 创建两个 MediaSource
    let vocals_source = MediaSource {
        id: format!("vocals-{}", uuid::Uuid::new_v4()),
        kind: "audio".to_string(),
        title: format!("人声 - {}", source.title),
        url: None,
        local_path: Some(vocals_path.to_string_lossy().to_string()),
        proxy_path: None,
        proxy_status: Some("none".to_string()),
        proxy_width: None,
        proxy_height: None,
        thumbnail_url: None,
        width: 0,
        height: 0,
        duration: clip.duration,
        source: "vocals".to_string(),
    };
    let inst_source = MediaSource {
        id: format!("inst-{}", uuid::Uuid::new_v4()),
        kind: "audio".to_string(),
        title: format!("伴奏 - {}", source.title),
        url: None,
        local_path: Some(instrumental_path.to_string_lossy().to_string()),
        proxy_path: None,
        proxy_status: Some("none".to_string()),
        proxy_width: None,
        proxy_height: None,
        thumbnail_url: None,
        width: 0,
        height: 0,
        duration: clip.duration,
        source: "instrumental".to_string(),
    };
    let conn = state.db.lock().map_err(map_error)?;
    let mut latest = storage::get_project(&conn, &request.project_id).map_err(map_error)?;
    if !latest.clips.iter().any(|c| c.id == clip.id) {
        return Ok(latest);
    }
    for source in [&vocals_source, &inst_source] {
        if let Some(idx) = latest.media.iter().position(|m| m.id == source.id) {
            latest.media[idx] = source.clone();
        } else {
            latest.media.push(source.clone());
        }
    }

    // 找到或创建音频轨（基于最新 project，避免覆盖并发编辑）
    let audio_track_id = if let Some(t) = latest
        .tracks
        .iter()
        .find(|t| t.kind == crate::models::TrackKind::Audio)
    {
        t.id.clone()
    } else {
        let tid = format!("track_audio_{}", uuid::Uuid::new_v4());
        latest.tracks.push(Track {
            id: tid.clone(),
            kind: crate::models::TrackKind::Audio,
            name: "音频".to_string(),
            order: latest.tracks.iter().map(|t| t.order).max().unwrap_or(0) + 1,
            muted: false,
            locked: false,
            hidden: false,
            height: 0,
        });
        tid
    };

    // 创建人声 clip + 伴奏 clip（和原视频对齐）
    let mut new_clips = Vec::new();
    for (sid, name) in [
        (vocals_source.id.clone(), "人声"),
        (inst_source.id.clone(), "伴奏"),
    ] {
        new_clips.push(Clip {
            id: format!("clip_{}_{}", name, uuid::Uuid::new_v4()),
            track_id: audio_track_id.clone(),
            source_id: Some(sid),
            start_on_track: clip.start_on_track,
            duration: clip.duration,
            source_in: clip.source_in,
            source_out: clip.source_out,
            speed: clip.speed,
            speed_curve: None,
            volume: if name == "人声" { 1.0 } else { 0.5 }, // 伴奏默认半音量
            fade_in: 0.0,
            fade_out: 0.0,
            noise_reduction: 0.0,
            filter: None,
            brightness: 0.0,
            contrast: 0.0,
            saturation: 0.0,
            temperature: 0.0,
            tint: 0.0,
            transform: None,
            visual_query: None,
            text: None,
            subtitle_style: None,
            words: None,
            subtitle_group_id: None,
            subtitle_role: None,
            subtitle_language: None,
            keyframes: None,
            mask: None,
            visual_effects: None,
            reverse: false,
            transition_in: None,
            crop: None,
            transition_out: None,
        });
    }
    latest.clips.extend(new_clips);

    // 原视频静音
    for c in latest.clips.iter_mut() {
        if c.id == clip.id {
            c.volume = 0.0;
        }
    }

    storage::save_project(&conn, &latest).map_err(map_error)
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

/// 找或建字幕轨。优先按 name 精确匹配，找不到则创建新轨。
/// 用于多字幕轨支持（双语模式建「中文字幕」+「英文字幕」两条轨）。
fn find_or_create_subtitle_track(project: &mut Project, name: &str, order: u32) -> String {
    if let Some(t) = project
        .tracks
        .iter()
        .find(|t| t.kind == TrackKind::Subtitle && t.name == name)
    {
        return t.id.clone();
    }
    let tid = format!("track_subtitle_{}", uuid::Uuid::new_v4());
    project.tracks.push(Track {
        id: tid.clone(),
        kind: TrackKind::Subtitle,
        name: name.to_string(),
        order,
        muted: false,
        locked: false,
        hidden: false,
        height: 0,
    });
    tid
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

    // 字幕轨查找/创建推迟到重读 latest 之后（多字幕轨支持）
    let _ = &mut project; // project 在 whisper 期间不使用，避免 unused 警告

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

    // 合并所有配音音频为一个 wav（按 clip 时间区间裁剪 + concat）
    // 关键：必须按 clip.source_in/source_out 裁剪每个音频，否则 concat 读取整个文件，
    // 导致合并音频时长 > sum(clip_audio_duration)，whisper 时间戳与 clip_mappings 偏移不匹配，
    // 字幕时间轴错位。
    let audio_dir = state.paths.projects_dir.join(&project.id).join("audio");
    let merged_path = state.paths.cache_dir.join(format!(
        "asr-merged-{}.wav",
        chrono::Utc::now().timestamp_millis()
    ));
    // 用 filter_complex concat：每个 input 用 -ss/-t 限制读取区间
    let mut merge_cmd = crate::tools::command(crate::tools::NativeTool::Ffmpeg);
    merge_cmd.args(["-y"]);
    let mut input_count = 0usize;
    for clip in &audio_clips {
        let source = clip
            .source_id
            .as_ref()
            .and_then(|sid| project.media.iter().find(|m| m.id == *sid));
        let Some(s) = source else { continue };
        let Some(local) = &s.local_path else { continue };
        let clip_audio_duration = (clip.source_out - clip.source_in).max(0.1);
        merge_cmd.args([
            "-ss",
            &format!("{:.3}", clip.source_in),
            "-t",
            &format!("{:.3}", clip_audio_duration),
            "-i",
            local,
        ]);
        input_count += 1;
    }
    if input_count == 0 {
        return Err("配音音频文件不存在，请先生成配音".to_string());
    }
    // filter_complex: 每个 input 先 atrim + asetpts 重置 PTS，再 concat
    let mut filter = String::new();
    let concat_labels: String = (0..input_count)
        .map(|i| format!("[a{i}]"))
        .collect::<String>();
    for i in 0..input_count {
        filter.push_str(&format!("[{i}:a]asetpts=PTS-STARTPTS[a{i}];"));
    }
    // 去掉末尾分号
    let filter_trim = filter.trim_end_matches(';');
    let filter_full = format!("{filter_trim};{concat_labels}concat=n={input_count}:v=0:a=1[out]");
    merge_cmd.args(["-filter_complex", &filter_full]);
    merge_cmd.args(["-map", "[out]"]);
    merge_cmd.args([
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        &merged_path.to_string_lossy(),
    ]);
    let merge_output = ffmpeg::run_with_timeout(&mut merge_cmd, 1800)
        .await
        .map_err(map_error)?;
    if !merge_output.status.success() {
        let _ = tokio::fs::remove_file(&merged_path).await;
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
    let refined = asr::refine_subtitles(
        &settings,
        &raw_cues,
        request.translate,
        "natural",
        &project.script,
    )
    .await
    .map_err(map_error)?;
    let _ = tokio::fs::remove_file(&merged_path).await;

    // T1.10 修复：ASR/AI 完成后重读最新 project，只定向替换字幕轨，避免覆盖用户并发编辑。
    let conn = state.db.lock().map_err(map_error)?;
    let mut latest = storage::get_project(&conn, &request.project_id).map_err(map_error)?;

    // 多字幕轨支持：translate=true 建/找「中文字幕」+「英文字幕」两条轨，分轨输出；
    // translate=false 维持单轨「字幕」。
    let (zh_track_id, en_track_id): (Option<String>, Option<String>) = if request.translate {
        let zh = find_or_create_subtitle_track(&mut latest, "中文字幕", 0);
        let en = find_or_create_subtitle_track(&mut latest, "英文字幕", 1);
        (Some(zh), Some(en))
    } else {
        // 单语模式：优先复用已有「英文字幕」轨（原文），否则用「字幕」轨
        let existing = latest
            .tracks
            .iter()
            .find(|t| t.kind == TrackKind::Subtitle && (t.name == "英文字幕" || t.name == "字幕"))
            .map(|t| t.id.clone());
        let id = existing.unwrap_or_else(|| find_or_create_subtitle_track(&mut latest, "字幕", 0));
        (None, Some(id))
    };

    // 清理旧字幕 clip（双轨清两条，单轨清一条）
    match (&zh_track_id, &en_track_id) {
        (Some(zh), Some(en)) => {
            latest
                .clips
                .retain(|c| c.track_id != *zh && c.track_id != *en);
        }
        (_, Some(en)) => {
            latest.clips.retain(|c| c.track_id != *en);
        }
        _ => {}
    }
    let _ = &audio_dir; // 预留

    // 建立合并音频偏移到时间轴偏移的映射（修复字幕时间戳错位）
    // 合并音频用 concat 拼接，丢弃了 clip 之间的间隙，whisper 时间戳是相对合并音频的
    // 需要把 cue.start 映射回时间轴：找到 cue 所在的 clip，timeline_start = clip.start_on_track + (cue.start - clip 在合并音频中的偏移)
    let mut clip_mappings: Vec<(f64, f64, f64)> = Vec::new(); // (merge_offset, clip_audio_duration, timeline_start)
    let mut accumulated: f64 = 0.0;
    for clip in &audio_clips {
        let clip_audio_duration = (clip.source_out - clip.source_in).max(0.1);
        clip_mappings.push((accumulated, clip_audio_duration, clip.start_on_track));
        accumulated += clip_audio_duration;
    }
    // 单条配音从头开始且无间隙时，映射退化为恒等（cue.start == timeline_start）
    let single_clip_aligned =
        audio_clips.len() == 1 && (audio_clips[0].start_on_track - 0.0).abs() < 0.01;

    for cue in &refined {
        let duration = (cue.end - cue.start).max(0.3);
        // 把合并音频偏移映射回时间轴偏移
        let timeline_start = if single_clip_aligned {
            cue.start
        } else {
            let mut mapped = cue.start;
            for (merge_offset, clip_dur, tl_start) in &clip_mappings {
                if cue.start >= *merge_offset && cue.start < *merge_offset + *clip_dur {
                    mapped = tl_start + (cue.start - merge_offset);
                    break;
                }
            }
            // 如果 cue.start 超出所有 clip 范围（尾部静音），用最后一个 clip 的末尾
            if let Some((merge_offset, clip_dur, tl_start)) = clip_mappings.last() {
                if cue.start >= *merge_offset + *clip_dur {
                    mapped = tl_start + *clip_dur;
                }
            }
            mapped
        };
        // words 时间戳是相对合并音频的，需要和 cue.start 一样映射到时间轴
        // 否则多 clip 场景下 karaoke 高亮与音频错位
        let delta = timeline_start - cue.start;
        let words = if cue.words.is_empty() {
            None
        } else {
            Some(
                cue.words
                    .iter()
                    .map(|w| WordCue {
                        start: w.start + delta,
                        end: w.end + delta,
                        text: w.text.clone(),
                        confidence: w.confidence.clone(),
                    })
                    .collect(),
            )
        };
        // 中文轨 words：用 jieba 对 translated 分词均匀分配，同样映射到时间轴
        let zh_words = asr::generate_chinese_words(cue).map(|zh| {
            zh.iter()
                .map(|w| WordCue {
                    start: w.start + delta,
                    end: w.end + delta,
                    text: w.text.clone(),
                    confidence: w.confidence.clone(),
                })
                .collect()
        });

        if request.translate {
            // 翻译 clip -> 中文轨（jieba 分词生成词级时间戳，支持 karaoke 高亮）
            if let Some(ref translated) = cue.translated {
                if let Some(ref zh_id) = zh_track_id {
                    latest.clips.push(Clip {
                        id: format!("sub-zh-{}", uuid::Uuid::new_v4()),
                        track_id: zh_id.clone(),
                        source_id: None,
                        start_on_track: timeline_start,
                        duration,
                        source_in: 0.0,
                        source_out: duration,
                        speed: 1.0,
                        speed_curve: None,
                        volume: 1.0,
                        fade_in: 0.0,
                        fade_out: 0.0,
                        noise_reduction: 0.0,
                        filter: None,
                        brightness: 0.0,
                        contrast: 0.0,
                        saturation: 0.0,
                        temperature: 0.0,
                        tint: 0.0,
                        transform: None,
                        visual_query: None,
                        crop: None,
                        text: Some(translated.clone()),
                        subtitle_style: {
                            let mut s = crate::models::SubtitleStyle::default();
                            s.position = "bottom".to_string();
                            Some(s)
                        },
                        words: zh_words,
                        subtitle_group_id: None,
                        subtitle_role: None,
                        subtitle_language: None,
                        keyframes: None,
                        mask: None,
                        visual_effects: None,
                        reverse: false,
                        transition_in: None,
                        transition_out: None,
                    });
                }
            }
            // 原文 clip -> 英文轨（保留词级时间戳，支持 karaoke）
            if let Some(ref en_id) = en_track_id {
                latest.clips.push(Clip {
                    id: format!("sub-en-{}", uuid::Uuid::new_v4()),
                    track_id: en_id.clone(),
                    source_id: None,
                    start_on_track: timeline_start,
                    duration,
                    source_in: 0.0,
                    source_out: duration,
                    speed: 1.0,
                    speed_curve: None,
                    volume: 1.0,
                    fade_in: 0.0,
                    fade_out: 0.0,
                    noise_reduction: 0.0,
                    filter: None,
                    brightness: 0.0,
                    contrast: 0.0,
                    saturation: 0.0,
                    temperature: 0.0,
                    tint: 0.0,
                    transform: None,
                    visual_query: None,
                    crop: None,
                    text: Some(cue.text.clone()),
                    subtitle_style: {
                        let mut s = crate::models::SubtitleStyle::default();
                        s.position = "top".to_string();
                        Some(s)
                    },
                    words,
                    subtitle_group_id: None,
                    subtitle_role: None,
                    subtitle_language: None,
                    keyframes: None,
                    mask: None,
                    visual_effects: None,
                    reverse: false,
                    transition_in: None,
                    transition_out: None,
                });
            }
        } else {
            // 单语：原文 clip -> 字幕轨
            if let Some(ref en_id) = en_track_id {
                latest.clips.push(Clip {
                    id: format!("sub-{}", uuid::Uuid::new_v4()),
                    track_id: en_id.clone(),
                    source_id: None,
                    start_on_track: timeline_start,
                    duration,
                    source_in: 0.0,
                    source_out: duration,
                    speed: 1.0,
                    speed_curve: None,
                    volume: 1.0,
                    fade_in: 0.0,
                    fade_out: 0.0,
                    noise_reduction: 0.0,
                    filter: None,
                    brightness: 0.0,
                    contrast: 0.0,
                    saturation: 0.0,
                    temperature: 0.0,
                    tint: 0.0,
                    transform: None,
                    visual_query: None,
                    crop: None,
                    text: Some(cue.text.clone()),
                    subtitle_style: None,
                    words,
                    subtitle_group_id: None,
                    subtitle_role: None,
                    subtitle_language: None,
                    keyframes: None,
                    mask: None,
                    visual_effects: None,
                    reverse: false,
                    transition_in: None,
                    transition_out: None,
                });
            }
        }
    }

    storage::save_project(&conn, &latest).map_err(map_error)
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSrtRequest {
    pub project_id: String,
    pub srt_path: String,
    /// 每条字幕相对 cue 时间戳的额外偏移（秒），用于手工对齐
    #[serde(default)]
    pub time_offset: f64,
}

/// 解析 SRT 时间戳 "00:00:01,500" 为秒
fn parse_srt_time(s: &str) -> Option<f64> {
    let s = s.trim();
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let h: f64 = parts[0].parse().ok()?;
    let m: f64 = parts[1].parse().ok()?;
    let sec_part = parts[2];
    let (secs, millis) = if let Some(idx) = sec_part.find(|c| c == ',' || c == '.') {
        let (a, b) = sec_part.split_at(idx);
        (a.parse::<f64>().ok()?, &b[1..])
    } else {
        (sec_part.parse::<f64>().ok()?, "")
    };
    let ms: f64 = if millis.is_empty() {
        0.0
    } else if millis.len() >= 3 {
        millis[..3].parse().ok()?
    } else {
        let v: f64 = millis.parse().ok()?;
        v * 10f64.powi(3 - millis.len() as i32)
    };
    Some(h * 3600.0 + m * 60.0 + secs + ms / 1000.0)
}

/// 导入 SRT 字幕文件：解析 cue 时间戳 -> 生成字幕 clip 到字幕轨
#[tauri::command]
pub async fn import_srt(
    state: State<'_, AppState>,
    request: ImportSrtRequest,
) -> Result<Project, String> {
    let srt_path = PathBuf::from(&request.srt_path);
    if !srt_path.is_file() {
        return Err(format!("字幕文件不存在：{}", request.srt_path));
    }
    let content = tokio::fs::read_to_string(&srt_path)
        .await
        .map_err(map_error)?;

    // 标准化换行：CRLF -> LF
    let content = content.replace("\r\n", "\n").replace('\r', "\n");
    // 按 blank line 分块（可能含空行）
    let blocks: Vec<&str> = content.split("\n\n").collect();

    #[derive(Debug)]
    struct ParsedCue {
        start: f64,
        end: f64,
        text: String,
    }
    let mut cues: Vec<ParsedCue> = Vec::new();
    for block in blocks {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }
        let lines: Vec<&str> = block.split('\n').collect();
        if lines.len() < 2 {
            continue;
        }
        // 第 1 行可能是序号（数字），跳过；找带 "-->" 的行
        let mut time_idx = 0;
        for (i, l) in lines.iter().enumerate() {
            if l.contains("-->") {
                time_idx = i;
                break;
            }
        }
        let time_line = lines.get(time_idx).ok_or("SRT 时间行缺失")?;
        let time_parts: Vec<&str> = time_line.split("-->").collect();
        if time_parts.len() != 2 {
            continue;
        }
        let start = match parse_srt_time(time_parts[0].trim()) {
            Some(v) => v,
            None => continue,
        };
        let end_raw = time_parts[1].trim();
        // 有些 SRT 在 end 时间后还有坐标/样式信息，只取第一个空白前部分
        let end_str = end_raw.split_whitespace().next().unwrap_or(end_raw);
        let end = match parse_srt_time(end_str) {
            Some(v) => v,
            None => continue,
        };
        if end <= start {
            continue;
        }
        let text = lines[time_idx + 1..]
            .iter()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        if text.is_empty() {
            continue;
        }
        cues.push(ParsedCue { start, end, text });
    }
    if cues.is_empty() {
        return Err("SRT 文件未解析出任何字幕条目".to_string());
    }

    let conn = state.db.lock().map_err(map_error)?;
    let mut latest = storage::get_project(&conn, &request.project_id).map_err(map_error)?;

    // 找字幕轨（多轨支持：取 order 最小的字幕轨），没有则创建
    let subtitle_track_id = if let Some(t) = latest
        .tracks
        .iter()
        .filter(|t| t.kind == TrackKind::Subtitle)
        .min_by_key(|t| t.order)
    {
        t.id.clone()
    } else {
        let tid = format!("track_subtitle_{}", uuid::Uuid::new_v4());
        latest.tracks.push(Track {
            id: tid.clone(),
            kind: TrackKind::Subtitle,
            name: "字幕".to_string(),
            order: latest.tracks.iter().map(|t| t.order).min().unwrap_or(0),
            muted: false,
            locked: false,
            hidden: false,
            height: 0,
        });
        tid
    };

    // 移除该字幕轨现有 clips（可选：这里保留既有字幕，只追加）
    let offset = request.time_offset.max(0.0);
    for cue in cues {
        let start_on_track = (cue.start + offset).max(0.0);
        let duration = (cue.end - cue.start).max(0.2);
        latest.clips.push(Clip {
            id: format!("sub-{}", uuid::Uuid::new_v4()),
            track_id: subtitle_track_id.clone(),
            source_id: None,
            start_on_track,
            duration,
            source_in: 0.0,
            source_out: duration,
            speed: 1.0,
            speed_curve: None,
            volume: 1.0,
            fade_in: 0.0,
            fade_out: 0.0,
            noise_reduction: 0.0,
            filter: None,
            brightness: 0.0,
            contrast: 0.0,
            saturation: 0.0,
            temperature: 0.0,
            tint: 0.0,
            transform: None,
            visual_query: None,
            crop: None,
            text: Some(cue.text.clone()),
            subtitle_style: None,
            words: None,
            subtitle_group_id: None,
            subtitle_role: None,
            subtitle_language: None,
            keyframes: None,
            mask: None,
            visual_effects: None,
            reverse: false,
            transition_in: None,
            transition_out: None,
        });
    }

    storage::save_project(&conn, &latest).map_err(map_error)
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

    let (
        kind,
        width,
        height,
        duration,
        thumbnail,
        proxy_path,
        proxy_status,
        proxy_width,
        proxy_height,
    ): (
        String,
        u32,
        u32,
        f64,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<u32>,
        Option<u32>,
    ) = if is_image {
        // 图片：读尺寸，无时长，缩略图就是图片本身
        let (w, h) = probe_image_dimensions(&local_path).await.unwrap_or((0, 0));
        (
            "image".to_string(),
            w,
            h,
            0.0,
            Some(local_path.to_string_lossy().to_string()),
            None,
            Some("none".to_string()),
            None,
            None,
        )
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
        let (proxy_path, proxy_status, proxy_width, proxy_height) = if kind == "video" {
            match ffmpeg::generate_proxy_video(&state.paths.cache_dir, &local_path, &id).await {
                Ok((proxy, pw, ph)) => (
                    Some(proxy.to_string_lossy().to_string()),
                    Some("ready".to_string()),
                    Some(pw),
                    Some(ph),
                ),
                Err(error) => {
                    eprintln!("代理视频生成失败（{}）：{error}", id);
                    (None, Some("failed".to_string()), None, None)
                }
            }
        } else {
            (None, Some("none".to_string()), None, None)
        };
        (
            kind,
            w,
            h,
            duration,
            thumb,
            proxy_path,
            proxy_status,
            proxy_width,
            proxy_height,
        )
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
        proxy_path,
        proxy_status,
        proxy_width,
        proxy_height,
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

/// T4.7: 生成视频胶片条缩略图，返回每帧的本地路径列表。
#[tauri::command]
pub async fn generate_filmstrip(
    state: State<'_, AppState>,
    request: FilmstripRequest,
) -> Result<Vec<String>, String> {
    let path = PathBuf::from(&request.source_path);
    let paths = ffmpeg::generate_filmstrip(
        &state.paths.cache_dir,
        &path,
        request.source_in,
        request.source_out,
        request.count,
    )
    .await
    .map_err(map_error)?;
    Ok(paths
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect())
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
    let mut cmd = crate::tools::command(crate::tools::NativeTool::Ffprobe);
    cmd.args([
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=s=x:p=0",
        &path.to_string_lossy(),
    ]);
    let output = ffmpeg::run_with_timeout(&mut cmd, 30).await?;
    if !output.status.success() {
        anyhow::bail!("ffprobe 读图片尺寸失败");
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parts: Vec<&str> = text.split('x').collect();
    if parts.len() != 2 {
        anyhow::bail!("解析图片尺寸失败");
    }
    // M20: 解析失败返回明确错误，不静默返回 0
    let w: u32 = parts[0]
        .parse()
        .map_err(|_| anyhow::anyhow!("图片宽度解析失败: {}", parts[0]))?;
    let h: u32 = parts[1]
        .parse()
        .map_err(|_| anyhow::anyhow!("图片高度解析失败: {}", parts[1]))?;
    Ok((w, h))
}

async fn probe_media_duration(path: &std::path::Path) -> anyhow::Result<f64> {
    let mut cmd = crate::tools::command(crate::tools::NativeTool::Ffprobe);
    cmd.args([
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        &path.to_string_lossy(),
    ]);
    let output = ffmpeg::run_with_timeout(&mut cmd, 30).await?;
    if !output.status.success() {
        anyhow::bail!("ffprobe 失败");
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(text.parse().unwrap_or(0.0))
}

async fn probe_video_resolution(path: &std::path::Path) -> anyhow::Result<(u32, u32)> {
    let mut cmd = crate::tools::command(crate::tools::NativeTool::Ffprobe);
    cmd.args([
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=s=x:p=0",
        &path.to_string_lossy(),
    ]);
    let output = ffmpeg::run_with_timeout(&mut cmd, 30).await?;
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

/// 保存可追溯字幕中间产物到项目目录。
#[tauri::command]
pub async fn save_subtitle_artifact(
    state: State<'_, AppState>,
    request: crate::models::SaveSubtitleArtifactRequest,
) -> Result<String, String> {
    let artifact_dir = state
        .paths
        .projects_dir
        .join(&request.project_id)
        .join("artifacts");
    tokio::fs::create_dir_all(&artifact_dir)
        .await
        .map_err(map_error)?;
    let path = artifact_dir.join("subtitle-latest.json");
    let content = serde_json::to_vec_pretty(&request.artifact).map_err(map_error)?;
    tokio::fs::write(&path, content).await.map_err(map_error)?;
    Ok(path.to_string_lossy().to_string())
}

/// 只转写项目配音轨，返回词级时间戳；不创建或修改字幕轨。
#[tauri::command]
pub async fn transcribe_project_narration(
    state: State<'_, AppState>,
    request: crate::models::TranscribeProjectNarrationRequest,
) -> Result<crate::models::TimedSentencesResult, String> {
    let (settings, project) = {
        let conn = state.db.lock().map_err(map_error)?;
        (
            storage::load_settings(&conn).map_err(map_error)?,
            storage::get_project(&conn, &request.project_id).map_err(map_error)?,
        )
    };

    let voiceover_track_ids: Vec<String> = project
        .tracks
        .iter()
        .filter(|track| track.kind == TrackKind::Voiceover)
        .map(|track| track.id.clone())
        .collect();
    let mut audio_clips: Vec<&Clip> = project
        .clips
        .iter()
        .filter(|clip| voiceover_track_ids.contains(&clip.track_id))
        .collect();
    audio_clips.sort_by(|left, right| {
        left.start_on_track
            .partial_cmp(&right.start_on_track)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    if audio_clips.is_empty() {
        return Err("配音轨上没有音频，请先生成或导入旁白".to_string());
    }

    let merged_path = state.paths.cache_dir.join(format!(
        "asr-project-{}.wav",
        chrono::Utc::now().timestamp_millis()
    ));
    let mut merge_cmd = crate::tools::command(crate::tools::NativeTool::Ffmpeg);
    merge_cmd.arg("-y");
    let mut included_clips: Vec<&Clip> = Vec::new();
    for clip in &audio_clips {
        let source = clip
            .source_id
            .as_ref()
            .and_then(|source_id| project.media.iter().find(|media| media.id == *source_id));
        let Some(source) = source else { continue };
        let Some(local_path) = &source.local_path else {
            continue;
        };
        let duration = (clip.source_out - clip.source_in).max(0.1);
        merge_cmd.args([
            "-ss",
            &format!("{:.3}", clip.source_in),
            "-t",
            &format!("{duration:.3}"),
            "-i",
            local_path,
        ]);
        included_clips.push(clip);
    }
    if included_clips.is_empty() {
        return Err("配音音频文件不存在，请先生成或重新导入旁白".to_string());
    }

    let mut filter_parts = String::new();
    let labels = (0..included_clips.len())
        .map(|index| format!("[a{index}]"))
        .collect::<String>();
    for index in 0..included_clips.len() {
        filter_parts.push_str(&format!("[{index}:a]asetpts=PTS-STARTPTS[a{index}];"));
    }
    let filter = format!(
        "{};{}concat=n={}:v=0:a=1[out]",
        filter_parts.trim_end_matches(';'),
        labels,
        included_clips.len()
    );
    merge_cmd.args(["-filter_complex", &filter, "-map", "[out]"]);
    merge_cmd.args([
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        &merged_path.to_string_lossy(),
    ]);
    let merge_output = ffmpeg::run_with_timeout(&mut merge_cmd, 1800)
        .await
        .map_err(map_error)?;
    if !merge_output.status.success() {
        let _ = tokio::fs::remove_file(&merged_path).await;
        return Err(format!(
            "合并配音音频失败：{}",
            String::from_utf8_lossy(&merge_output.stderr).trim()
        ));
    }

    let raw_cues = asr::transcribe_audio(&settings, &state.paths.cache_dir, &merged_path)
        .await
        .map_err(map_error);
    let _ = tokio::fs::remove_file(&merged_path).await;
    let raw_cues = raw_cues?;

    let mut mappings: Vec<(f64, f64, f64)> = Vec::new();
    let mut accumulated = 0.0;
    for clip in &included_clips {
        let duration = (clip.source_out - clip.source_in).max(0.1);
        mappings.push((accumulated, duration, clip.start_on_track));
        accumulated += duration;
    }
    let single_aligned = included_clips.len() == 1 && included_clips[0].start_on_track.abs() < 0.01;

    let sentences = raw_cues
        .into_iter()
        .map(|cue| {
            let timeline_start = if single_aligned {
                cue.start
            } else {
                mappings
                    .iter()
                    .find(|(offset, duration, _)| {
                        cue.start >= *offset && cue.start < *offset + *duration
                    })
                    .map(|(offset, _, timeline)| timeline + (cue.start - offset))
                    .unwrap_or(cue.start)
            };
            let delta = timeline_start - cue.start;
            crate::models::TimedSentence {
                start: timeline_start,
                end: cue.end + delta,
                text: cue.text,
                words: cue
                    .words
                    .into_iter()
                    .map(|word| crate::models::WordCue {
                        start: word.start + delta,
                        end: word.end + delta,
                        text: word.text,
                        confidence: word.confidence,
                    })
                    .collect(),
            }
        })
        .collect::<Vec<_>>();
    if sentences.is_empty() {
        return Err("音频识别结果为空，请检查旁白音频或 Whisper 配置".to_string());
    }
    let total_duration = sentences
        .iter()
        .map(|sentence| sentence.end)
        .fold(0.0_f64, f64::max);
    let full_text = sentences
        .iter()
        .map(|sentence| sentence.text.as_str())
        .collect::<Vec<_>>()
        .join("");
    Ok(crate::models::TimedSentencesResult {
        sentences,
        total_duration,
        full_text,
    })
}

/// 从单次 Whisper transcript 整理字幕并可选翻译，不再重复识别音频。
#[tauri::command]
pub async fn refine_transcript(
    state: State<'_, AppState>,
    request: crate::models::RefineTranscriptRequest,
) -> Result<Vec<crate::models::SubtitleCue>, String> {
    let settings = {
        let conn = state.db.lock().map_err(map_error)?;
        storage::load_settings(&conn).map_err(map_error)?
    };
    let cues: Vec<crate::models::SubtitleCue> = request
        .sentences
        .into_iter()
        .map(|sentence| crate::models::SubtitleCue {
            start: sentence.start,
            end: sentence.end,
            text: sentence.text,
            translated: None,
            words: sentence.words,
        })
        .collect();
    asr::refine_subtitles(
        &settings,
        &cues,
        request.translate,
        &request.mode,
        &request.context,
    )
    .await
    .map_err(map_error)
}

#[tauri::command]
pub async fn analyze_subtitle_language_context(
    state: State<'_, AppState>,
    request: crate::models::SubtitleLanguageContextRequest,
) -> Result<crate::models::SubtitleLanguageContextResult, String> {
    let settings = {
        let conn = state.db.lock().map_err(map_error)?;
        storage::load_settings(&conn).map_err(map_error)?
    };
    ai::analyze_subtitle_language_context(&settings, request)
        .await
        .map_err(map_error)
}

/// 使用 DeepSeek 为词级字幕提供受限的语义断点建议。
#[tauri::command]
pub async fn advise_subtitle_breaks(
    state: State<'_, AppState>,
    request: crate::models::SubtitleBreakAdviceRequest,
) -> Result<crate::models::SubtitleBreakAdviceResult, String> {
    let settings = {
        let conn = state.db.lock().map_err(map_error)?;
        storage::load_settings(&conn).map_err(map_error)?
    };
    ai::advise_subtitle_breaks(&settings, request)
        .await
        .map_err(map_error)
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
    // T3.3: 渲染互斥锁（同时只允许一个导出任务）
    let _render_guard = match state.render_lock.try_lock() {
        Ok(g) => g,
        Err(_) => return Err("已有导出任务进行中，请等待完成或取消".to_string()),
    };
    // 重置取消标志
    state
        .render_cancel
        .store(false, std::sync::atomic::Ordering::Relaxed);

    let project = {
        let conn = state.db.lock().map_err(map_error)?;
        storage::get_project(&conn, &request.project_id).map_err(map_error)?
    };

    let _ = app_handle.emit(
        "render-progress",
        serde_json::json!({ "progress": 0, "message": "准备渲染..." }),
    );

    // T4.10: 仅导出音频模式 —— 跳过视频管线，直接混音输出 mp3/wav
    if project.render_config.export_mode == "audio-only" {
        let _ = app_handle.emit(
            "render-progress",
            serde_json::json!({ "progress": 30, "message": "正在混音导出..." }),
        );
        let audio_clips = ffmpeg::collect_mix_audio_clips(&project);
        // 决定输出路径
        let render_dir = state.paths.projects_dir.join(&project.id).join("renders");
        tokio::fs::create_dir_all(&render_dir)
            .await
            .map_err(map_error)?;
        let audio_out = if let Some(ref user_path) = request.output_path {
            if !user_path.is_empty() {
                std::path::PathBuf::from(user_path)
            } else {
                render_dir.join("audio-only.mp3")
            }
        } else {
            render_dir.join("audio-only.mp3")
        };
        let result = ffmpeg::render_audio_only(
            &state.paths.cache_dir,
            &audio_out,
            &audio_clips,
            &project,
            &project.media,
        )
        .await;
        match result {
            Ok(path) => {
                let _ = app_handle.emit(
                    "render-progress",
                    serde_json::json!({ "progress": 100, "message": "音频导出完成" }),
                );
                {
                    let conn = state.db.lock().map_err(map_error)?;
                    let mut latest =
                        storage::get_project(&conn, &request.project_id).map_err(map_error)?;
                    if request.preview {
                        latest.preview_path = Some(path.to_string_lossy().to_string());
                    } else {
                        latest.final_path = Some(path.to_string_lossy().to_string());
                    }
                    storage::save_project(&conn, &latest).map_err(map_error)?;
                }
                return Ok(RenderResult {
                    preview_path: path.to_string_lossy().to_string(),
                    command: "render-audio-only".to_string(),
                });
            }
            Err(e) => {
                let _ = app_handle.emit(
                    "render-progress",
                    serde_json::json!({ "progress": 0, "message": format!("音频导出失败：{e}") }),
                );
                return Err(map_error(e));
            }
        }
    }

    // T3.3: 进度回调，把段级进度通过事件发到前端
    let app_handle_clone = app_handle.clone();
    let progress_cb = move |percent: u32, phase: &str| {
        let _ = app_handle_clone.emit(
            "render-progress",
            serde_json::json!({ "progress": percent, "message": phase }),
        );
    };
    let cancel_flag = &state.render_cancel;

    let render_output = ffmpeg::render_project_video(
        &state.paths.cache_dir,
        &state.paths.projects_dir,
        &project,
        request.preview,
        Some(&progress_cb),
        Some(cancel_flag),
    )
    .await
    .map_err(|e| {
        let _ = app_handle.emit(
            "render-progress",
            serde_json::json!({ "progress": 0, "message": format!("渲染失败：{e}") }),
        );
        map_error(e)
    })?;

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

    let mut next_project = {
        let conn = state.db.lock().map_err(map_error)?;
        storage::get_project(&conn, &request.project_id).map_err(map_error)?
    };
    if request.preview {
        next_project.preview_path = Some(final_output_path.to_string_lossy().to_string());
    } else {
        next_project.final_path = Some(final_output_path.to_string_lossy().to_string());
    }
    {
        let conn = state.db.lock().map_err(map_error)?;
        storage::save_project(&conn, &next_project).map_err(map_error)?;
    }

    let _ = app_handle.emit(
        "render-progress",
        serde_json::json!({ "progress": 100, "message": "导出完成" }),
    );

    Ok(RenderResult {
        preview_path: final_output_path.to_string_lossy().to_string(),
        command: if request.preview {
            "render-preview".to_string()
        } else {
            "render-final".to_string()
        },
    })
}

/// T3.3: 取消正在进行的渲染任务
#[tauri::command]
pub async fn cancel_render(state: State<'_, AppState>) -> Result<(), String> {
    state
        .render_cancel
        .store(true, std::sync::atomic::Ordering::Relaxed);
    Ok(())
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
