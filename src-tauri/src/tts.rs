use std::path::{Path, PathBuf};

use serde::Deserialize;
use tokio::process::Command;

use crate::models::{AppSettings, VoicePreviewResult, VoiceProfile};

#[derive(Debug, Deserialize)]
struct PythonPreviewResult {
    path: String,
}

pub async fn synthesize_voice_preview(
    settings: &AppSettings,
    cache_dir: &Path,
    voice: &VoiceProfile,
    text: &str,
) -> anyhow::Result<VoicePreviewResult> {
    let output_path = synthesize_with_clone(
        settings,
        cache_dir,
        &cache_dir.join("voice-previews"),
        voice,
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
    cache_dir: &Path,
    audio_dir: &Path,
    voice: &VoiceProfile,
    text: &str,
    output_stem: &str,
) -> anyhow::Result<(PathBuf, f64)> {
    let output_path =
        synthesize_with_clone(settings, cache_dir, audio_dir, voice, text, output_stem).await?;
    let duration = probe_duration(&output_path).await.unwrap_or(0.0);
    Ok((output_path, duration))
}

async fn synthesize_with_clone(
    settings: &AppSettings,
    cache_dir: &Path,
    output_dir: &Path,
    voice: &VoiceProfile,
    text: &str,
    output_stem: &str,
) -> anyhow::Result<PathBuf> {
    let sample_path = voice
        .sample_path
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("这个音色没有参考音频，请重新上传样音"))?;
    let sample_path = PathBuf::from(sample_path);
    if !sample_path.exists() {
        anyhow::bail!("参考音频不存在：{}", sample_path.to_string_lossy());
    }

    let preview_text = if text.trim().is_empty() {
        "这是一段克隆音色试听，用来检查声音是否自然。"
    } else {
        text.trim()
    };
    let duration = estimate_duration(preview_text);
    let download_dir = cache_dir.join("gradio");
    tokio::fs::create_dir_all(&download_dir).await?;
    tokio::fs::create_dir_all(output_dir).await?;

    let script = r#"
import json
import pathlib
import sys
from gradio_client import Client, handle_file

base_url, download_dir, text, sample_path, reference_text, duration = sys.argv[1:7]
client = Client(base_url, verbose=False, ssl_verify=False, download_files=download_dir)
result = client.predict(
    text,
    "Chinese",
    handle_file(sample_path),
    reference_text,
    "",
    32,
    2.0,
    True,
    1.0,
    float(duration),
    True,
    True,
    api_name="/_clone_fn",
)
first = result[0] if isinstance(result, (tuple, list)) else result
if isinstance(first, dict):
    path = first.get("path") or first.get("name")
else:
    path = getattr(first, "path", None) or getattr(first, "name", None) or first
if not path:
    raise RuntimeError(f"TTS returned unsupported result: {result!r}")
print(json.dumps({"path": str(pathlib.Path(path).resolve())}, ensure_ascii=False))
"#;

    let python = find_python_with_gradio().await?;
    let output = Command::new(&python)
        .arg("-c")
        .arg(script)
        .arg(settings.tts_base_url.trim())
        .arg(download_dir.to_string_lossy().to_string())
        .arg(preview_text)
        .arg(sample_path.to_string_lossy().to_string())
        .arg(voice.reference_text.clone().unwrap_or_default())
        .arg(format!("{duration:.2}"))
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        anyhow::bail!("TTS 调用失败（Python: {python}）：{detail}");
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json_line = stdout
        .lines()
        .rev()
        .find(|line| line.trim_start().starts_with('{'))
        .ok_or_else(|| anyhow::anyhow!("TTS 没有返回音频路径"))?;
    let result: PythonPreviewResult = serde_json::from_str(json_line)?;
    let generated_path = PathBuf::from(result.path);
    if !generated_path.exists() {
        anyhow::bail!("TTS 输出文件不存在：{}", generated_path.to_string_lossy());
    }

    let suffix = generated_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("wav");
    let output_path = output_dir.join(format!("{output_stem}.{suffix}"));
    tokio::fs::copy(&generated_path, &output_path).await?;
    Ok(output_path)
}

fn estimate_duration(text: &str) -> f64 {
    let count = text.chars().count() as f64;
    // M11: 上限从 30s 提高到 120s，避免长文本被截断时长估算
    (count / 5.2).clamp(2.0, 120.0)
}

async fn probe_duration(path: &Path) -> anyhow::Result<f64> {
    let output = Command::new("ffprobe")
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
        anyhow::bail!("{}", String::from_utf8_lossy(&output.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().parse()?)
}

async fn find_python_with_gradio() -> anyhow::Result<String> {
    let mut candidates = vec![
        "python3".to_string(),
        "python".to_string(),
        "/opt/homebrew/Caskroom/miniconda/base/bin/python3".to_string(),
        "/usr/local/bin/python3".to_string(),
        "/usr/bin/python3".to_string(),
    ];
    if let Ok(value) = std::env::var("SCENESCRIPT_PYTHON") {
        candidates.insert(0, value);
    }

    for candidate in candidates {
        let output = Command::new(&candidate)
            .args(["-c", "import gradio_client"])
            .output()
            .await;
        match output {
            Ok(output) if output.status.success() => return Ok(candidate),
            _ => continue,
        }
    }

    anyhow::bail!(
        "找不到包含 gradio_client 的 Python。请安装：python3 -m pip install gradio_client，或设置 SCENESCRIPT_PYTHON 指向可用解释器"
    )
}
