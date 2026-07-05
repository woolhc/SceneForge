use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::json;
use tokio::process::Command;

use crate::models::{AppSettings, SubtitleCue};

/// whisper-cli 输出的 JSON 结构（-oj）
#[derive(Debug, Deserialize)]
struct WhisperResult {
    #[serde(default)]
    transcription: Vec<WhisperSegment>,
}

#[derive(Debug, Deserialize)]
struct WhisperSegment {
    #[serde(rename = "timestamps", default)]
    timestamps: WhisperTimestamps,
    #[serde(default)]
    text: String,
}

#[derive(Debug, Deserialize, Default)]
struct WhisperTimestamps {
    #[serde(default)]
    from: String,
    #[serde(default)]
    to: String,
}

/// 把 "from"/"to" 的 HH:MM:SS,mmm 解析成秒
fn parse_timestamp(s: &str) -> f64 {
    let s = s.trim();
    // 形如 "00:00:01,234"
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 3 {
        return 0.0;
    }
    let h: f64 = parts[0].parse().unwrap_or(0.0);
    let m: f64 = parts[1].parse().unwrap_or(0.0);
    let sec_part = parts[2];
    let (sec, millis) = if let Some(idx) = sec_part.find(',') {
        (
            sec_part[..idx].parse().unwrap_or(0.0),
            sec_part[idx + 1..].parse::<f64>().unwrap_or(0.0) / 1000.0,
        )
    } else {
        (sec_part.parse().unwrap_or(0.0), 0.0)
    };
    h * 3600.0 + m * 60.0 + sec + millis
}

/// 解析 whisper 可执行文件路径：
/// - 若是绝对路径或含分隔符，直接用（Windows 自动补 .exe）
/// - 若只是命令名（如 "whisper-cli"），在 PATH 里查找
/// 返回 (实际可执行路径, 是否找到)
fn resolve_whisper_bin(bin: &str) -> (String, bool) {
    let trimmed = bin.trim();
    if trimmed.is_empty() {
        return (String::new(), false);
    }
    // 含路径分隔符 → 当作路径处理
    let is_path = trimmed.contains('/') || trimmed.contains('\\');
    if is_path {
        // Windows: 若无 .exe 后缀且文件不存在，尝试补 .exe
        let p = PathBuf::from(trimmed);
        if p.exists() {
            return (trimmed.to_string(), true);
        }
        if cfg!(target_os = "windows") && !trimmed.to_lowercase().ends_with(".exe") {
            let with_exe = format!("{}.exe", trimmed);
            if PathBuf::from(&with_exe).exists() {
                return (with_exe, true);
            }
        }
        return (trimmed.to_string(), false);
    }
    // 只是命令名 → 用 which 查找 PATH
    match which::which(trimmed) {
        Ok(path) => (path.to_string_lossy().to_string(), true),
        Err(_) => {
            // Windows 兜底：尝试补 .exe
            if cfg!(target_os = "windows") {
                let with_exe = format!("{}.exe", trimmed);
                if which::which(&with_exe).is_ok() {
                    return (with_exe, true);
                }
            }
            (trimmed.to_string(), false)
        }
    }
}

/// 跨平台 whisper 安装指引
fn whisper_install_hint() -> String {
    if cfg!(target_os = "macos") {
        "macOS：终端运行 `brew install whisper-cpp`，模型在 /opt/homebrew/share/whisper-cpp/".to_string()
    } else if cfg!(target_os = "windows") {
        "Windows：从 https://github.com/ggerganov/whisper.cpp/releases 下载预编译版（whisper-bin-x64.zip），解压后在命令行运行，或用 vcpkg：`vcpkg install whisper-cpp`。模型从 https://huggingface.co/ggerganov/whisper.cpp 下载（如 ggml-large-v3.bin）".to_string()
    } else {
        "Linux：`sudo apt install whisper-cpp` 或从源码编译，模型放 /usr/local/share/whisper-cpp/".to_string()
    }
}

/// 调用 whisper-cli 识别音频，返回带时间戳的原始片段。
pub async fn transcribe_audio(
    settings: &AppSettings,
    cache_dir: &Path,
    audio_path: &Path,
) -> anyhow::Result<Vec<SubtitleCue>> {
    let model = settings.whisper_model.trim();
    if model.is_empty() {
        anyhow::bail!(
            "请先在设置中配置 whisper 模型路径（.bin 文件）。\n{}",
            whisper_install_hint()
        );
    }
    if !PathBuf::from(model).exists() {
        anyhow::bail!(
            "whisper 模型文件不存在：{}\n请下载模型（如 ggml-large-v3.bin）后在设置里填写正确路径。\n{}",
            model,
            whisper_install_hint()
        );
    }

    let (whisper_bin, found) = resolve_whisper_bin(&settings.whisper_bin);
    if !found {
        anyhow::bail!(
            "找不到 whisper 可执行程序：{}\n{}\n请在设置里填写 whisper-cli 的完整路径。",
            settings.whisper_bin,
            whisper_install_hint()
        );
    }

    // 输出前缀（whisper 会生成 <prefix>.json）
    let out_dir = cache_dir.join("whisper");
    tokio::fs::create_dir_all(&out_dir).await?;
    let out_prefix = out_dir.join(format!(
        "asr-{}",
        chrono::Utc::now().timestamp_millis()
    ));

    // whisper-cli -m model -f audio -oj -of prefix -l auto
    let output = Command::new(&whisper_bin)
        .args([
            "-m",
            model,
            "-f",
            &audio_path.to_string_lossy(),
            "-oj",
            "-of",
            &out_prefix.to_string_lossy(),
            "-l",
            "auto",
            "--no-print-progress",
        ])
        .output()
        .await
        .map_err(|e| anyhow::anyhow!(
            "调用 whisper 失败：{e}\n可执行文件：{whisper_bin}\n{}",
            whisper_install_hint()
        ))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        anyhow::bail!(
            "whisper 识别失败：{}\n{}",
            if stderr.is_empty() { stdout } else { stderr },
            whisper_install_hint()
        );
    }

    let json_path = format!("{}.json", out_prefix.to_string_lossy());
    let json_content = tokio::fs::read_to_string(&json_path)
        .await
        .map_err(|_| anyhow::anyhow!("whisper 未生成 JSON 输出：{}", json_path))?;

    let result: WhisperResult = serde_json::from_str(&json_content)
        .map_err(|e| anyhow::anyhow!("whisper JSON 解析失败：{e}"))?;

    let cues = result
        .transcription
        .into_iter()
        .map(|seg| SubtitleCue {
            start: parse_timestamp(&seg.timestamps.from),
            end: parse_timestamp(&seg.timestamps.to),
            text: seg.text.trim().to_string(),
        })
        .collect();
    Ok(cues)
}

/// 用 DeepSeek 整理字幕：合并过短片段、断句优化、可选翻译。
/// translate=true 时把原文翻译成中文（双语保留原文）。
pub async fn refine_subtitles(
    settings: &AppSettings,
    cues: &[SubtitleCue],
    translate: bool,
) -> anyhow::Result<Vec<SubtitleCue>> {
    let api_key = settings.deepseek_api_key.trim();
    if api_key.is_empty() {
        // 没有 key 就原样返回
        return Ok(cues.to_vec());
    }

    let input: Vec<serde_json::Value> = cues
        .iter()
        .map(|c| json!({ "start": c.start, "end": c.end, "text": c.text }))
        .collect();

    let system_prompt = "你是字幕整理助手。优化语音识别出来的字幕：合并过短的片段、修正标点、保持时间戳不变。只返回 JSON。";
    let user_prompt = if translate {
        format!(
            r#"下面是带时间戳的字幕片段（JSON 数组）。请：
1. 合并过短的片段（小于 1 秒的合并到相邻片段），优化断句
2. 修正标点和明显识别错误
3. 把每条翻译成中文，放入 translated 字段（保留原文在 text 字段）
4. 保持 start/end 时间戳不变（合并时取首尾时间）
5. 只返回 JSON 数组，格式：[{{"start": 0.0, "end": 2.5, "text": "原文", "translated": "中文"}}]

字幕：
{}"#,
            serde_json::to_string_pretty(&input).unwrap_or_default()
        )
    } else {
        format!(
            r#"下面是带时间戳的字幕片段（JSON 数组）。请：
1. 合并过短的片段（小于 1 秒的合并到相邻片段），优化断句
2. 修正标点和明显识别错误
3. 保持 start/end 时间戳不变（合并时取首尾时间）
4. 只返回 JSON 数组，格式：[{{"start": 0.0, "end": 2.5, "text": "整理后文字"}}]

字幕：
{}"#,
            serde_json::to_string_pretty(&input).unwrap_or_default()
        )
    };

    let client = reqwest::Client::new();
    let response = client
        .post("https://api.deepseek.com/chat/completions")
        .bearer_auth(api_key)
        .json(&json!({
            "model": "deepseek-chat",
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": user_prompt }
            ],
            "response_format": { "type": "json_object" },
            "temperature": 0.2
        }))
        .send()
        .await?;

    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        anyhow::bail!("DeepSeek 字幕整理失败：HTTP {}", status.as_u16());
    }

    // 解析返回（可能被包在 {"subtitles": [...]} 或直接是 [...]）
    let parsed: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| anyhow::anyhow!("DeepSeek 返回解析失败：{e}"))?;
    let content = parsed["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("DeepSeek 返回为空"))?;
    let refined = extract_subtitle_array(content)?;
    Ok(refined)
}

/// 从 LLM 返回内容中提取字幕数组（兼容 {"subtitles":[...]} 和 [...] 两种）
fn extract_subtitle_array(content: &str) -> anyhow::Result<Vec<SubtitleCue>> {
    let text = content.trim();
    // 去除可能的 ```json 包裹
    let text = text
        .strip_prefix("```json")
        .or_else(|| text.strip_prefix("```"))
        .unwrap_or(text)
        .trim_end_matches('`')
        .trim();

    // 找到第一个 [ 和最后一个 ]
    let start = text.find('[').ok_or_else(|| anyhow::anyhow!("未找到字幕数组"))?;
    let end = text.rfind(']').ok_or_else(|| anyhow::anyhow!("未找到字幕数组结尾"))?;
    let array_str = &text[start..=end];

    let arr: Vec<serde_json::Value> = serde_json::from_str(array_str)
        .map_err(|e| anyhow::anyhow!("字幕数组解析失败：{e}"))?;

    let cues = arr
        .into_iter()
        .map(|item| {
            let text = item.get("translated")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .or_else(|| item.get("text").and_then(|v| v.as_str()))
                .unwrap_or("")
                .to_string();
            SubtitleCue {
                start: item.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0),
                end: item.get("end").and_then(|v| v.as_f64()).unwrap_or(0.0),
                text,
            }
        })
        .collect();
    Ok(cues)
}
