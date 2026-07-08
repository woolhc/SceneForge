use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use chrono::Utc;
use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::models::{
    AppInfo, AppSettings, CreateProjectRequest, CreateVoiceProfileRequest,
    ImportVoiceProfileRequest, Project, ProjectSummary, RenderConfig, ReplaceVoiceSampleRequest,
    Track, TrackKind, UpdateVoiceProfileRequest, VoiceProfile,
};

pub struct AppPaths {
    pub app_data_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub projects_dir: PathBuf,
    pub voices_dir: PathBuf,
    pub database_path: PathBuf,
}

pub struct AppState {
    pub db: Mutex<Connection>,
    pub paths: AppPaths,
    /// T3.3: 渲染互斥锁（同时只允许一个导出任务）
    pub render_lock: tokio::sync::Mutex<()>,
    /// T3.3: 取消标志（render_project 每段检查，cancel_render 置位）
    pub render_cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl AppState {
    pub fn initialize() -> anyhow::Result<Self> {
        let base_dir = dirs::data_dir()
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
            .join("SceneScriptDesktop");
        let cache_dir = base_dir.join("cache");
        let projects_dir = base_dir.join("projects");
        let voices_dir = base_dir.join("voices");
        fs::create_dir_all(&cache_dir)?;
        fs::create_dir_all(&projects_dir)?;
        fs::create_dir_all(&voices_dir)?;

        let database_path = base_dir.join("scenescript.sqlite3");
        let conn = Connection::open(&database_path)?;
        initialize_schema(&conn)?;

        Ok(Self {
            db: Mutex::new(conn),
            paths: AppPaths {
                app_data_dir: base_dir,
                cache_dir,
                projects_dir,
                voices_dir,
                database_path,
            },
            render_lock: tokio::sync::Mutex::new(()),
            render_cancel: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        })
    }

    pub fn app_info(&self) -> AppInfo {
        AppInfo {
            app_data_dir: self.paths.app_data_dir.to_string_lossy().to_string(),
            cache_dir: self.paths.cache_dir.to_string_lossy().to_string(),
            database_path: self.paths.database_path.to_string_lossy().to_string(),
        }
    }
}

fn initialize_schema(conn: &Connection) -> anyhow::Result<()> {
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            ratio TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS voice_profiles (
            id TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        "#,
    )?;
    // T3.5: 冗余列迁移（兼容旧库，SQLite 没有 ADD COLUMN IF NOT EXISTS，用 try 忽略重复列错误）
    let _ =
        conn.execute_batch("ALTER TABLE projects ADD COLUMN clip_count INTEGER NOT NULL DEFAULT 0");
    // schema 版本
    let _ = conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('schema_version', '1')",
        [],
    );
    Ok(())
}

pub fn load_settings(conn: &Connection) -> anyhow::Result<AppSettings> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'app_settings'",
            [],
            |row| row.get(0),
        )
        .ok();

    match value {
        Some(raw) => Ok(serde_json::from_str(&raw)?),
        None => Ok(AppSettings::default()),
    }
}

pub fn save_settings(conn: &Connection, settings: &AppSettings) -> anyhow::Result<AppSettings> {
    let raw = serde_json::to_string(settings)?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('app_settings', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![raw],
    )?;
    Ok(settings.clone())
}

pub fn create_project(conn: &Connection, request: CreateProjectRequest) -> anyhow::Result<Project> {
    let now = Utc::now().to_rfc3339();
    let title = request
        .title
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "未命名项目".to_string());
    let project = Project {
        id: Uuid::new_v4().to_string(),
        title,
        script: String::new(),
        ratio: request.ratio.unwrap_or_else(|| "9:16".to_string()),
        fps: 30,
        media: Vec::new(),
        // 默认预置三条轨道：视频（底层画面）、配音（AI 旁白）、字幕
        tracks: vec![
            Track {
                id: "track_subtitle".to_string(),
                kind: TrackKind::Subtitle,
                name: "字幕".to_string(),
                order: 0,
                muted: false,
                locked: false,
                hidden: false,
                height: 0,
            },
            Track {
                id: "track_voiceover".to_string(),
                kind: TrackKind::Voiceover,
                name: "配音".to_string(),
                order: 1,
                muted: false,
                locked: false,
                hidden: false,
                height: 0,
            },
            Track {
                id: "track_image".to_string(),
                kind: TrackKind::Image,
                name: "图片".to_string(),
                order: 2,
                muted: false,
                locked: false,
                hidden: false,
                height: 0,
            },
            Track {
                id: "track_video".to_string(),
                kind: TrackKind::Video,
                name: "视频".to_string(),
                order: 3,
                muted: false,
                locked: false,
                hidden: false,
                height: 0,
            },
        ],
        clips: Vec::new(),
        render_config: RenderConfig::default(),
        chapters: Vec::new(),
        cover_time: None,
        preview_path: None,
        final_path: None,
        created_at: now.clone(),
        updated_at: now,
    };
    save_project(conn, &project)?;
    Ok(project)
}

pub fn save_project(conn: &Connection, project: &Project) -> anyhow::Result<Project> {
    let mut next = project.clone();
    next.updated_at = Utc::now().to_rfc3339();
    if next.created_at.is_empty() {
        next.created_at = next.updated_at.clone();
    }
    let raw = serde_json::to_string(&next)?;
    let clip_count = next.clips.len() as i64;
    conn.execute(
        "INSERT INTO projects (id, title, ratio, payload_json, created_at, updated_at, clip_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            ratio = excluded.ratio,
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at,
            clip_count = excluded.clip_count",
        params![
            next.id,
            next.title,
            next.ratio,
            raw,
            next.created_at,
            next.updated_at,
            clip_count
        ],
    )?;
    Ok(next)
}

pub fn get_project(conn: &Connection, id: &str) -> anyhow::Result<Project> {
    let raw: String = conn.query_row(
        "SELECT payload_json FROM projects WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    Ok(serde_json::from_str(&raw)?)
}

pub fn list_projects(conn: &Connection) -> anyhow::Result<Vec<ProjectSummary>> {
    // T3.5: 只查冗余摘要列，不反序列化 payload_json（大项目提速明显）
    let mut stmt = conn.prepare(
        "SELECT id, title, ratio, clip_count, updated_at FROM projects ORDER BY datetime(updated_at) DESC, updated_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ProjectSummary {
            id: row.get::<_, String>(0)?,
            title: row.get::<_, String>(1)?,
            ratio: row.get::<_, String>(2)?,
            clip_count: row.get::<_, i64>(3).unwrap_or(0) as usize,
            updated_at: row.get::<_, String>(4)?,
        })
    })?;
    let mut projects = Vec::new();
    for row in rows {
        projects.push(row?);
    }
    Ok(projects)
}

pub fn delete_project(conn: &Connection, id: &str) -> anyhow::Result<()> {
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn list_voice_profiles(conn: &Connection) -> anyhow::Result<Vec<VoiceProfile>> {
    let mut stmt =
        conn.prepare("SELECT payload_json FROM voice_profiles ORDER BY datetime(created_at) DESC")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut profiles = Vec::new();
    for row in rows {
        let raw = row?;
        profiles.push(serde_json::from_str(&raw)?);
    }
    Ok(profiles)
}

pub fn create_voice_profile(
    conn: &Connection,
    request: CreateVoiceProfileRequest,
) -> anyhow::Result<VoiceProfile> {
    let name = request.name.trim();
    if name.is_empty() {
        anyhow::bail!("请先填写音色名称");
    }

    let profile = VoiceProfile {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        sample_path: request.sample_path.filter(|value| !value.trim().is_empty()),
        reference_text: request
            .reference_text
            .filter(|value| !value.trim().is_empty()),
        language: "Chinese".to_string(),
        provider_voice_id: request
            .provider_voice_id
            .filter(|value| !value.trim().is_empty()),
        created_at: Utc::now().to_rfc3339(),
    };
    let raw = serde_json::to_string(&profile)?;
    conn.execute(
        "INSERT INTO voice_profiles (id, payload_json, created_at) VALUES (?1, ?2, ?3)",
        params![profile.id, raw, profile.created_at],
    )?;
    Ok(profile)
}

pub fn import_voice_profile(
    conn: &Connection,
    voices_dir: &std::path::Path,
    request: ImportVoiceProfileRequest,
) -> anyhow::Result<VoiceProfile> {
    let name = request.name.trim();
    if name.is_empty() {
        anyhow::bail!("请先填写音色名称");
    }
    if request.bytes.is_empty() {
        anyhow::bail!("请上传一段参考音频");
    }

    fs::create_dir_all(voices_dir)?;
    let voice_id = Uuid::new_v4().to_string();
    let suffix = std::path::Path::new(&request.file_name)
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("wav");
    let voice_path = voices_dir.join(format!("{voice_id}.{suffix}"));
    fs::write(&voice_path, request.bytes)?;

    create_voice_profile(
        conn,
        CreateVoiceProfileRequest {
            name: name.to_string(),
            sample_path: Some(voice_path.to_string_lossy().to_string()),
            reference_text: request.reference_text,
            provider_voice_id: None,
        },
    )
}

pub fn update_voice_profile(
    conn: &Connection,
    id: &str,
    request: UpdateVoiceProfileRequest,
) -> anyhow::Result<VoiceProfile> {
    let mut profile = get_voice_profile(conn, id)?;
    if let Some(name) = request.name {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            profile.name = trimmed.to_string();
        }
    }
    if let Some(reference_text) = request.reference_text {
        profile.reference_text = if reference_text.trim().is_empty() {
            None
        } else {
            Some(reference_text)
        };
    }
    if let Some(sample_path) = request.sample_path {
        let trimmed = sample_path.trim();
        profile.sample_path = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
    }
    let raw = serde_json::to_string(&profile)?;
    conn.execute(
        "UPDATE voice_profiles SET payload_json = ?1 WHERE id = ?2",
        params![raw, id],
    )?;
    Ok(profile)
}

/// 替换已有音色的参考音频：写入新样音文件，删除旧文件，更新 sample_path。
pub fn replace_voice_sample(
    conn: &Connection,
    voices_dir: &std::path::Path,
    request: ReplaceVoiceSampleRequest,
) -> anyhow::Result<VoiceProfile> {
    if request.bytes.is_empty() {
        anyhow::bail!("请上传一段参考音频");
    }
    let mut profile = get_voice_profile(conn, &request.voice_id)?;

    // 删除旧样音文件
    if let Some(old_path) = &profile.sample_path {
        let old = std::path::PathBuf::from(old_path);
        if old.exists() {
            let _ = fs::remove_file(old);
        }
    }

    fs::create_dir_all(voices_dir)?;
    let suffix = std::path::Path::new(&request.file_name)
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("wav");
    let new_path = voices_dir.join(format!("{}.{}", profile.id, suffix));
    fs::write(&new_path, request.bytes)?;
    profile.sample_path = Some(new_path.to_string_lossy().to_string());

    let raw = serde_json::to_string(&profile)?;
    conn.execute(
        "UPDATE voice_profiles SET payload_json = ?1 WHERE id = ?2",
        params![raw, profile.id],
    )?;
    Ok(profile)
}

pub fn get_voice_profile(conn: &Connection, id: &str) -> anyhow::Result<VoiceProfile> {
    let raw: String = conn.query_row(
        "SELECT payload_json FROM voice_profiles WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    Ok(serde_json::from_str(&raw)?)
}

pub fn delete_voice_profile(conn: &Connection, id: &str) -> anyhow::Result<()> {
    if let Ok(profile) = get_voice_profile(conn, id) {
        if let Some(sample_path) = profile.sample_path {
            let _ = fs::remove_file(sample_path);
        }
    }
    conn.execute("DELETE FROM voice_profiles WHERE id = ?1", params![id])?;
    Ok(())
}
