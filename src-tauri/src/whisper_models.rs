use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::header::RANGE;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::models::AppSettings;
use crate::tools::{self, NativeTool};

const RECOMMENDED_MODEL_ID: &str = "medium-q5";
const RECOMMENDED_MODEL_NAME: &str = "Medium Q5";
const RECOMMENDED_MODEL_FILE: &str = "ggml-medium-q5_0.bin";
const RECOMMENDED_MODEL_SIZE: u64 = 539_212_467;
const RECOMMENDED_MODEL_SHA256: &str =
    "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f";
const RECOMMENDED_MODEL_CN_URL: &str =
    "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin";
const RECOMMENDED_MODEL_OFFICIAL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin?download=true";
const DOWNLOAD_EVENT: &str = "whisper-model-download-progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModelDescriptor {
    pub id: String,
    pub name: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub description: String,
    pub recommended: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModelStatus {
    pub model: WhisperModelDescriptor,
    pub available: bool,
    pub resolved_path: Option<String>,
    pub configured_path: Option<String>,
    pub selected_model_id: Option<String>,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub partial_download: bool,
    pub downloading: bool,
    pub models_dir: String,
    pub whisper_available: bool,
    pub whisper_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModelDownloadProgress {
    pub model_id: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub progress: f64,
    pub message: String,
}

pub fn recommended_model() -> WhisperModelDescriptor {
    WhisperModelDescriptor {
        id: RECOMMENDED_MODEL_ID.to_string(),
        name: RECOMMENDED_MODEL_NAME.to_string(),
        file_name: RECOMMENDED_MODEL_FILE.to_string(),
        size_bytes: RECOMMENDED_MODEL_SIZE,
        sha256: RECOMMENDED_MODEL_SHA256.to_string(),
        description: "适合中文、英文和中英混合旁白，在准确率、速度和磁盘占用之间较平衡。"
            .to_string(),
        recommended: true,
    }
}

pub fn managed_model_path(models_dir: &Path) -> PathBuf {
    models_dir.join(RECOMMENDED_MODEL_FILE)
}

pub fn partial_model_path(models_dir: &Path) -> PathBuf {
    models_dir.join(format!("{RECOMMENDED_MODEL_FILE}.part"))
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn model_id_for_path(path: &Path) -> String {
    if path.file_name().and_then(|name| name.to_str()) == Some(RECOMMENDED_MODEL_FILE) {
        RECOMMENDED_MODEL_ID.to_string()
    } else {
        "custom".to_string()
    }
}

pub fn get_status(
    models_dir: &Path,
    settings: &AppSettings,
    downloading: bool,
) -> WhisperModelStatus {
    let model = recommended_model();
    let resolved = tools::resolve_whisper_model_in_dir(&settings.whisper_model, models_dir);
    let managed_path = managed_model_path(models_dir);
    let partial_path = partial_model_path(models_dir);
    let managed_size = std::fs::metadata(&managed_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let partial_size = std::fs::metadata(&partial_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let whisper = tools::resolve(NativeTool::Whisper, Some(&settings.whisper_bin));

    WhisperModelStatus {
        available: resolved.is_some(),
        resolved_path: resolved.as_deref().map(path_string),
        configured_path: (!settings.whisper_model.trim().is_empty())
            .then(|| settings.whisper_model.clone()),
        selected_model_id: resolved.as_deref().map(model_id_for_path),
        downloaded_bytes: if managed_size > 0 {
            managed_size
        } else {
            partial_size
        },
        total_bytes: model.size_bytes,
        partial_download: partial_size > 0 && managed_size == 0,
        downloading,
        models_dir: path_string(models_dir),
        whisper_available: whisper.available,
        whisper_path: path_string(&whisper.path),
        model,
    }
}

pub fn validate_selected_model(path: &Path) -> anyhow::Result<()> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|_| anyhow::anyhow!("Whisper 模型文件不存在：{}", path.display()))?;
    if metadata.file_type().is_symlink() {
        anyhow::bail!("请选择实际的 Whisper 模型文件，不要选择符号链接");
    }
    if !metadata.file_type().is_file() {
        anyhow::bail!("Whisper 模型文件不存在：{}", path.display());
    }
    if path.extension().and_then(|extension| extension.to_str()) != Some("bin") {
        anyhow::bail!("请选择 Whisper `.bin` 模型文件");
    }
    let size = metadata.len();
    if size < 1_000_000 {
        anyhow::bail!("模型文件过小，可能不是有效的 Whisper 模型");
    }
    Ok(())
}

fn emit_progress(app_handle: &AppHandle, downloaded_bytes: u64, message: impl Into<String>) {
    let total_bytes = RECOMMENDED_MODEL_SIZE;
    let progress = if total_bytes == 0 {
        0.0
    } else {
        (downloaded_bytes as f64 / total_bytes as f64 * 100.0).clamp(0.0, 100.0)
    };
    let _ = app_handle.emit(
        DOWNLOAD_EVENT,
        WhisperModelDownloadProgress {
            model_id: RECOMMENDED_MODEL_ID.to_string(),
            downloaded_bytes,
            total_bytes,
            progress,
            message: message.into(),
        },
    );
}

async fn download_from_url(
    client: &reqwest::Client,
    app_handle: &AppHandle,
    url: &str,
    partial_path: &Path,
    cancel: &AtomicBool,
) -> anyhow::Result<()> {
    let existing_size = tokio::fs::metadata(partial_path)
        .await
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let mut request = client.get(url);
    if existing_size > 0 {
        request = request.header(RANGE, format!("bytes={existing_size}-"));
    }
    let response = request.send().await?.error_for_status()?;
    let resumed = response.status() == reqwest::StatusCode::PARTIAL_CONTENT && existing_size > 0;
    let mut downloaded = if resumed { existing_size } else { 0 };
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(resumed)
        .truncate(!resumed)
        .open(partial_path)
        .await?;
    let mut stream = response.bytes_stream();
    let mut last_emit = Instant::now() - Duration::from_secs(1);

    emit_progress(
        app_handle,
        downloaded,
        if resumed {
            "正在继续下载 Whisper 模型..."
        } else {
            "正在下载 Whisper 模型..."
        },
    );

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            anyhow::bail!("Whisper 模型下载已取消");
        }
        let chunk = chunk?;
        file.write_all(&chunk).await?;
        downloaded += chunk.len() as u64;
        if last_emit.elapsed() >= Duration::from_millis(250) || downloaded >= RECOMMENDED_MODEL_SIZE
        {
            emit_progress(app_handle, downloaded, "正在下载 Whisper 模型...");
            last_emit = Instant::now();
        }
    }
    file.flush().await?;
    file.sync_all().await?;
    Ok(())
}

async fn verify_sha256(path: &Path, expected_sha256: &str) -> anyhow::Result<()> {
    let mut file = tokio::fs::File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let actual = format!("{:x}", hasher.finalize());
    if actual != expected_sha256 {
        anyhow::bail!("模型校验失败：SHA-256 不匹配");
    }
    Ok(())
}

fn reject_symlink(path: &Path) -> anyhow::Result<()> {
    if let Ok(metadata) = std::fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() {
            anyhow::bail!("拒绝访问符号链接模型路径：{}", path.display());
        }
    }
    Ok(())
}

async fn verify_complete_partial_or_remove(
    path: &Path,
    expected_size: u64,
    expected_sha256: &str,
) -> anyhow::Result<bool> {
    let size = match tokio::fs::metadata(path).await {
        Ok(metadata) => metadata.len(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    if size != expected_size {
        return Ok(false);
    }
    match verify_sha256(path, expected_sha256).await {
        Ok(()) => Ok(true),
        Err(_) => {
            tokio::fs::remove_file(path).await?;
            Ok(false)
        }
    }
}

pub async fn download_recommended_model(
    models_dir: &Path,
    app_handle: &AppHandle,
    cancel: &AtomicBool,
) -> anyhow::Result<PathBuf> {
    tokio::fs::create_dir_all(models_dir).await?;
    let final_path = managed_model_path(models_dir);
    let partial_path = partial_model_path(models_dir);
    reject_symlink(&final_path)?;
    reject_symlink(&partial_path)?;

    if final_path.is_file() {
        let size = std::fs::metadata(&final_path)?.len();
        if size == RECOMMENDED_MODEL_SIZE
            && verify_sha256(&final_path, RECOMMENDED_MODEL_SHA256)
                .await
                .is_ok()
        {
            emit_progress(app_handle, size, "Whisper 模型已安装");
            return Ok(final_path);
        }
        tokio::fs::remove_file(&final_path).await?;
    }
    if partial_path.is_file() {
        let size = std::fs::metadata(&partial_path)?.len();
        if size == RECOMMENDED_MODEL_SIZE {
            emit_progress(app_handle, size, "正在校验已下载的 Whisper 模型...");
            if verify_complete_partial_or_remove(
                &partial_path,
                RECOMMENDED_MODEL_SIZE,
                RECOMMENDED_MODEL_SHA256,
            )
            .await?
            {
                tokio::fs::rename(&partial_path, &final_path).await?;
                emit_progress(app_handle, size, "Whisper 模型安装完成");
                return Ok(final_path);
            }
            emit_progress(app_handle, 0, "模型校验失败，正在重新下载...");
        } else if size > RECOMMENDED_MODEL_SIZE {
            tokio::fs::remove_file(&partial_path).await?;
        }
    }

    cancel.store(false, Ordering::Relaxed);
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(60 * 60))
        .build()?;
    let mut last_error = None;
    for url in [RECOMMENDED_MODEL_CN_URL, RECOMMENDED_MODEL_OFFICIAL_URL] {
        match download_from_url(&client, app_handle, url, &partial_path, cancel).await {
            Ok(()) => {
                let downloaded = std::fs::metadata(&partial_path)
                    .map(|metadata| metadata.len())
                    .unwrap_or(0);
                if downloaded == RECOMMENDED_MODEL_SIZE {
                    last_error = None;
                    break;
                }
                last_error = Some(anyhow::anyhow!(
                    "模型下载不完整：已下载 {downloaded} 字节，预期 {RECOMMENDED_MODEL_SIZE} 字节"
                ));
                emit_progress(
                    app_handle,
                    downloaded,
                    "模型下载不完整，正在尝试备用地址...",
                );
            }
            Err(error) if cancel.load(Ordering::Relaxed) => return Err(error),
            Err(error) => {
                last_error = Some(error);
                emit_progress(
                    app_handle,
                    std::fs::metadata(&partial_path)
                        .map(|metadata| metadata.len())
                        .unwrap_or(0),
                    "下载连接中断，正在尝试备用地址...",
                );
            }
        }
    }
    if let Some(error) = last_error {
        return Err(error);
    }

    let size = tokio::fs::metadata(&partial_path).await?.len();
    if size != RECOMMENDED_MODEL_SIZE {
        anyhow::bail!("模型文件大小不正确：已下载 {size} 字节，预期 {RECOMMENDED_MODEL_SIZE} 字节");
    }
    emit_progress(app_handle, size, "正在校验 Whisper 模型...");
    if let Err(error) = verify_sha256(&partial_path, RECOMMENDED_MODEL_SHA256).await {
        let _ = tokio::fs::remove_file(&partial_path).await;
        return Err(error);
    }
    if final_path.exists() {
        tokio::fs::remove_file(&final_path).await?;
    }
    tokio::fs::rename(&partial_path, &final_path).await?;
    emit_progress(app_handle, size, "Whisper 模型安装完成");
    Ok(final_path)
}

pub fn delete_managed_model(models_dir: &Path) -> anyhow::Result<()> {
    for path in [
        managed_model_path(models_dir),
        partial_model_path(models_dir),
    ] {
        reject_symlink(&path)?;
        if path.exists() {
            std::fs::remove_file(path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_models_dir() -> PathBuf {
        std::env::temp_dir().join(format!(
            "sceneforge-whisper-model-test-{}",
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn recommended_model_metadata_is_stable() {
        let model = recommended_model();
        assert_eq!(model.id, "medium-q5");
        assert_eq!(model.file_name, "ggml-medium-q5_0.bin");
        assert_eq!(model.size_bytes, 539_212_467);
        assert_eq!(model.sha256.len(), 64);
    }

    #[test]
    fn status_detects_partial_and_completed_models() {
        let dir = temp_models_dir();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(partial_model_path(&dir), vec![0_u8; 32]).unwrap();
        let settings = AppSettings::default();
        let partial = get_status(&dir, &settings, false);
        assert!(partial.partial_download);
        assert_eq!(partial.downloaded_bytes, 32);

        std::fs::remove_file(partial_model_path(&dir)).unwrap();
        std::fs::write(managed_model_path(&dir), vec![0_u8; 1_000_001]).unwrap();
        let complete = get_status(&dir, &settings, false);
        assert!(complete.available);
        assert_eq!(
            complete.resolved_path.as_deref(),
            Some(managed_model_path(&dir).to_string_lossy().as_ref()),
        );
        assert!(!complete.partial_download);
        assert_eq!(complete.selected_model_id.as_deref(), Some("medium-q5"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn corrupt_complete_partial_is_removed_for_recovery() {
        let dir = temp_models_dir();
        std::fs::create_dir_all(&dir).unwrap();
        let path = partial_model_path(&dir);
        std::fs::write(&path, b"bad!").unwrap();
        let verified = verify_complete_partial_or_remove(&path, 4, &"0".repeat(64))
            .await
            .unwrap();
        assert!(!verified);
        assert!(!path.exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn managed_model_operations_reject_symlinks() {
        use std::os::unix::fs::symlink;

        let dir = temp_models_dir();
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("outside.bin");
        std::fs::write(&target, b"keep").unwrap();
        symlink(&target, managed_model_path(&dir)).unwrap();
        assert!(delete_managed_model(&dir).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"keep");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn selected_model_validation_rejects_non_bin_files() {
        let dir = temp_models_dir();
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("model.txt");
        std::fs::write(&path, vec![0_u8; 1_000_001]).unwrap();
        assert!(validate_selected_model(&path).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
