use std::{
    path::{Path, PathBuf},
    time::Duration,
};

use serde_json::json;

use crate::{
    ffmpeg,
    models::{AppSettings, VoicePreviewResult, VoiceProfile},
};

const FISH_AUDIO_TTS_URL: &str = "https://api.fish.audio/v1/tts";

pub async fn synthesize_voice_preview(
    settings: &AppSettings,
    cache_dir: &Path,
    voice: &VoiceProfile,
    text: &str,
) -> anyhow::Result<VoicePreviewResult> {
    let output_path = synthesize_with_fish_audio(
        settings,
        &cache_dir.join("voice-previews"),
        Some(voice),
        text,
        &format!("{}-{}", voice.id, chrono::Utc::now().timestamp_millis()),
    )
    .await?;
    let duration = probe_duration(&output_path).await.unwrap_or(0.0);

    Ok(VoicePreviewResult {
        voice_id: voice.id.clone(),
        audio_path: output_path.to_string_lossy().to_string(),
        duration,
    })
}

pub async fn synthesize_segment_audio(
    settings: &AppSettings,
    audio_dir: &Path,
    voice: Option<&VoiceProfile>,
    text: &str,
    output_stem: &str,
) -> anyhow::Result<(PathBuf, f64)> {
    let output_path =
        synthesize_with_fish_audio(settings, audio_dir, voice, text, output_stem).await?;
    let duration = probe_duration(&output_path).await.unwrap_or(0.0);
    Ok((output_path, duration))
}

pub async fn synthesize_full_narration(
    settings: &AppSettings,
    audio_dir: &Path,
    voice: Option<&VoiceProfile>,
    text: &str,
    output_stem: &str,
) -> anyhow::Result<(PathBuf, f64)> {
    let output_path =
        synthesize_with_fish_audio(settings, audio_dir, voice, text, output_stem).await?;
    let duration = probe_duration(&output_path).await.unwrap_or(0.0);
    Ok((output_path, duration))
}

async fn synthesize_with_fish_audio(
    settings: &AppSettings,
    output_dir: &Path,
    voice: Option<&VoiceProfile>,
    text: &str,
    output_stem: &str,
) -> anyhow::Result<PathBuf> {
    let api_key = settings.fish_audio_api_key.trim();
    if api_key.is_empty() {
        anyhow::bail!("请先在设置中配置 Fish Audio API Key");
    }

    let text = text.trim();
    if text.is_empty() {
        anyhow::bail!("配音文案不能为空");
    }

    let reference_id = voice
        .and_then(|item| item.provider_voice_id.as_deref())
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            let value = settings.fish_audio_reference_id.trim();
            (!value.is_empty()).then_some(value)
        })
        .ok_or_else(|| anyhow::anyhow!("请先配置 Fish Audio 音色 ID / Reference ID"))?;

    tokio::fs::create_dir_all(output_dir).await?;
    let format = normalize_format(&settings.fish_audio_format);
    let output_path = output_dir.join(format!("{output_stem}.{format}"));

    let client = ffmpeg::http_client();
    let payload = json!({
        "text": text,
        "reference_id": reference_id,
        "format": format,
        "sample_rate": settings.fish_audio_sample_rate,
        "normalize": true,
        "latency": "normal",
        // 使用 Fish Audio 原生长文本切分，保持同一次请求内的音色上下文连续。
        "chunk_length": 300,
        "min_chunk_length": 50,
        "condition_on_previous_chunks": true,
        "max_new_tokens": 1024,
    });

    let mut last_error: Option<anyhow::Error> = None;
    for attempt in 0..3 {
        let response = client
            .post(FISH_AUDIO_TTS_URL)
            .bearer_auth(api_key)
            .header("model", normalized_model(settings))
            .json(&payload)
            .send()
            .await;

        match response {
            Ok(response) if response.status().is_success() => {
                let bytes = response.bytes().await?;
                if bytes.is_empty() {
                    anyhow::bail!("Fish Audio 没有返回音频数据");
                }
                tokio::fs::write(&output_path, bytes).await?;
                return Ok(output_path);
            }
            Ok(response) => {
                let status = response.status().as_u16();
                let retryable = status == 429 || status >= 500;
                let detail = response.text().await.unwrap_or_default();
                last_error = Some(classify_fish_audio_error(status, detail));
                if !retryable {
                    break;
                }
            }
            Err(error) => {
                let retryable = error.is_timeout() || error.is_connect() || error.is_request();
                last_error = Some(anyhow::anyhow!("Fish Audio 网络请求失败：{error}"));
                if !retryable {
                    break;
                }
            }
        }

        if attempt < 2 {
            tokio::time::sleep(Duration::from_millis(500 * 2_u64.pow(attempt))).await;
        }
    }

    return Err(last_error.unwrap_or_else(|| anyhow::anyhow!("Fish Audio 调用失败")));
}

fn normalized_model(settings: &AppSettings) -> &str {
    let model = settings.fish_audio_model.trim();
    if model.is_empty() {
        "s1"
    } else {
        model
    }
}

fn normalize_format(format: &str) -> String {
    match format.trim().to_lowercase().as_str() {
        "wav" => "wav".to_string(),
        "opus" => "opus".to_string(),
        _ => "mp3".to_string(),
    }
}

fn classify_fish_audio_error(status: u16, detail: String) -> anyhow::Error {
    let compact = detail.trim();
    let message = if compact.is_empty() {
        format!("Fish Audio 调用失败：HTTP {status}")
    } else {
        format!("Fish Audio 调用失败：HTTP {status}，{compact}")
    };
    anyhow::anyhow!(message)
}

async fn probe_duration(path: &Path) -> anyhow::Result<f64> {
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
    let output = cmd.output().await?;
    if !output.status.success() {
        anyhow::bail!("ffprobe failed");
    }
    let text = String::from_utf8_lossy(&output.stdout);
    Ok(text.trim().parse().unwrap_or(0.0))
}
