use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::json;
use tokio::process::Command;

use crate::models::{AppSettings, SubtitleCue, WordCue};

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
    offsets: WhisperOffsets,
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

/// whisper JSON 的 offsets 字段（毫秒整数）—— 用于词级时间戳
#[derive(Debug, Deserialize, Default)]
struct WhisperOffsets {
    #[serde(default)]
    from: i64,
    #[serde(default)]
    to: i64,
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
        "macOS：终端运行 `brew install whisper-cpp`，然后下载量化模型：\n  curl -L -o /opt/homebrew/share/whisper-cpp/ggml-medium-q5_0.bin \\\n    https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin".to_string()
    } else if cfg!(target_os = "windows") {
        "Windows：从 https://github.com/ggerganov/whisper.cpp/releases 下载预编译版（whisper-bin-x64.zip），解压后在命令行运行，或用 vcpkg：`vcpkg install whisper-cpp`。模型从 https://huggingface.co/ggerganov/whisper.cpp 下载（如 ggml-medium-q5_0.bin）".to_string()
    } else {
        "Linux：`sudo apt install whisper-cpp` 或从源码编译，模型放 /usr/local/share/whisper-cpp/。下载：curl -L -o ggml-medium-q5_0.bin https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-medium-q5_0.bin".to_string()
    }
}

/// 调用 whisper-cli 识别音频，返回带时间戳的原始片段。
pub async fn transcribe_audio(
    settings: &AppSettings,
    _cache_dir: &Path,
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
    // 注意：whisper-cli 的 -of 参数对含空格的路径解析有 bug（会打印帮助并静默退出），
    // 所以输出到系统临时目录（无空格），跑完再读 JSON。
    let out_dir = std::env::temp_dir().join("scenescript-whisper");
    tokio::fs::create_dir_all(&out_dir).await?;
    let out_prefix = out_dir.join(format!("asr-{}", chrono::Utc::now().timestamp_millis()));

    // whisper-cli -ml 1 -oj：max-len=1 强制每段一个词/字 → 得到词级时间戳
    // offsets.from/to 是毫秒整数，比 timestamps 字符串精度更高
    // 注意：whisper.cpp 1.7+ 移除了 --no-print-progress，改用 -np（--no-prints）
    let mut cmd = Command::new(&whisper_bin);
    cmd.args([
        "-m",
        model,
        "-f",
        &audio_path.to_string_lossy(),
        "-ml",
        "1", // 词级时间戳（max-len=1）
        "-oj",
        "-of",
        &out_prefix.to_string_lossy(),
        "-l",
        "auto",
        "-np", // 不打印进度（替代旧版 --no-print-progress）
    ]);
    let output = crate::ffmpeg::run_with_timeout(&mut cmd, 1800)
        .await
        .map_err(|e| {
            anyhow::anyhow!(
                "调用 whisper 失败：{e}\n可执行文件：{whisper_bin}\n{}",
                whisper_install_hint()
            )
        })?;

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
    let json_content = match tokio::fs::read_to_string(&json_path).await {
        Ok(c) => c,
        Err(_) => {
            // JSON 没生成：可能是 whisper 参数问题，把 stdout 片段附上方便排查
            let stdout_tail = String::from_utf8_lossy(&output.stdout);
            let hint = if stdout_tail.contains("usage:") || stdout_tail.contains("-m FNAME") {
                "whisper 打印了帮助信息（通常是参数解析失败）。若输出路径含空格会导致此问题，已改用临时目录。"
            } else {
                ""
            };
            anyhow::bail!(
                "whisper 未生成 JSON 输出：{}\n{}\n{}",
                json_path,
                hint,
                whisper_install_hint()
            );
        }
    };

    let _ = tokio::fs::remove_file(&json_path).await;
    let result: WhisperResult = serde_json::from_str(&json_content)
        .map_err(|e| anyhow::anyhow!("whisper JSON 解析失败：{e}"))?;

    // 把词级 segments 打包成 SubtitleCue（每个 cue 含 words）
    Ok(words_to_cues(result.transcription))
}

/// 音频模式：识别音频并返回句子级时间戳（用于驱动分镜编排）。
/// 与 transcribe_audio 不同：这里按"句末标点 + 语音停顿"聚合成完整句子，
/// 而不是按字幕块字数（30字）切分——句子边界更符合语义，适合做分镜单元。
pub async fn transcribe_to_sentences(
    settings: &AppSettings,
    cache_dir: &Path,
    audio_path: &Path,
) -> anyhow::Result<(Vec<crate::models::TimedSentence>, f64, String)> {
    let cues = transcribe_audio(settings, cache_dir, audio_path).await?;
    if cues.is_empty() {
        return Ok((vec![], 0.0, String::new()));
    }

    // cues 已经是按可读性分组的字幕块，每个含 words。
    // 进一步合并成"句子"：遇到句末标点（。！？.!?）或较大停顿（>0.8s）就断句。
    let sentence_enders = ['。', '！', '？', '!', '?', '.'];
    let mut sentences: Vec<crate::models::TimedSentence> = Vec::new();
    let mut current_start: Option<f64> = None;
    let mut current_end: f64 = 0.0;
    let mut current_text = String::new();
    let mut last_word_end: Option<f64> = None;

    for cue in &cues {
        // M13: 大停顿表示上一句已结束，必须在追加当前 cue 之前切分；
        // 否则停顿后的第一段会被错误并入上一句。
        let big_gap = last_word_end.map(|e| cue.start - e > 0.8).unwrap_or(false);
        if big_gap {
            let text = current_text.trim().to_string();
            if !text.is_empty() {
                if let Some(s) = current_start {
                    sentences.push(crate::models::TimedSentence {
                        start: s,
                        end: current_end,
                        text,
                    });
                }
            }
            current_start = None;
            current_text.clear();
        }

        if current_start.is_none() {
            current_start = Some(cue.start);
        }
        current_end = cue.end;
        current_text.push_str(&cue.text);

        // 判断是否该断句：cue 文本以句末标点结尾。
        let ends_with_sentence = cue
            .text
            .chars()
            .last()
            .map(|c| sentence_enders.contains(&c))
            .unwrap_or(false);

        if ends_with_sentence {
            let text = current_text.trim().to_string();
            if !text.is_empty() {
                if let Some(s) = current_start {
                    sentences.push(crate::models::TimedSentence {
                        start: s,
                        end: current_end,
                        text,
                    });
                }
            }
            current_start = None;
            current_text.clear();
        }
        last_word_end = Some(cue.end);
    }
    // 收尾
    if let Some(s) = current_start {
        let text = current_text.trim().to_string();
        if !text.is_empty() {
            sentences.push(crate::models::TimedSentence {
                start: s,
                end: current_end,
                text,
            });
        }
    }

    let total_duration = sentences.last().map(|s| s.end).unwrap_or(0.0);
    let full_text = sentences
        .iter()
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join("");

    Ok((sentences, total_duration, full_text))
}

/// 把 whisper -ml 1 的输出（每个 segment 是一个词）打包成 SubtitleCue。
/// 策略：先收集所有 WordCue，按可读性分组（合并标点到前词、控制每段字数）。
fn words_to_cues(segments: Vec<WhisperSegment>) -> Vec<SubtitleCue> {
    // 1. 把所有 segment 转成 WordCue（过滤掉空文本）
    let mut all_words: Vec<WordCue> = Vec::new();
    for seg in segments {
        let text = seg.text.trim();
        if text.is_empty() {
            continue;
        }
        // 优先用 offsets（毫秒，精度高），回退到 timestamps（HH:MM:SS,mmm）
        let start = if seg.offsets.from > 0 || seg.offsets.to > 0 {
            seg.offsets.from as f64 / 1000.0
        } else {
            parse_timestamp(&seg.timestamps.from)
        };
        let end = if seg.offsets.from > 0 || seg.offsets.to > 0 {
            seg.offsets.to as f64 / 1000.0
        } else {
            parse_timestamp(&seg.timestamps.to)
        };
        // 容错：某些词 end <= start（whisper 偶发），给个最小 50ms
        let end = end.max(start + 0.05);
        // trim 首尾空白（whisper 英文 word 带前导空格 " And"，中文则无）
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        all_words.push(WordCue {
            start,
            end,
            text: trimmed.to_string(),
        });
    }

    if all_words.is_empty() {
        return vec![];
    }

    // 2. 分组成 SubtitleCue
    // 每段最多 30 字符，最长 6 秒；遇到句末标点强制断句
    const MAX_CHARS: usize = 30;
    const MAX_DURATION: f64 = 6.0;
    let sentence_enders = ['。', '！', '？', '!', '?', '.'];

    let mut cues: Vec<SubtitleCue> = Vec::new();
    let mut current_words: Vec<WordCue> = Vec::new();

    for word in all_words {
        let last_end = current_words.last().map(|w| w.end).unwrap_or(word.start);
        // 判断是否该断句
        let char_count: usize = current_words.iter().map(|w| w.text.chars().count()).sum();
        let new_char_count = char_count + word.text.chars().count();
        let duration = word.end - current_words.first().map(|w| w.start).unwrap_or(word.start);

        let prev_ends_sentence = current_words
            .last()
            .map(|w| {
                w.text
                    .chars()
                    .last()
                    .map(|c| sentence_enders.contains(&c))
                    .unwrap_or(false)
            })
            .unwrap_or(false);

        let should_break = !current_words.is_empty()
            && (prev_ends_sentence           // 前一词是句末 → 断
                || new_char_count > MAX_CHARS // 超字数 → 断
                || duration > MAX_DURATION   // 超时长 → 断
                || word.start - last_end > 0.8); // 语音停顿 > 0.8s → 断

        if should_break {
            if let Some(cue) = words_to_cue(&current_words) {
                cues.push(cue);
            }
            current_words.clear();
        }
        current_words.push(word);
    }
    if let Some(cue) = words_to_cue(&current_words) {
        cues.push(cue);
    }

    cues
}

/// 一组词打包成一个 SubtitleCue（拼接 text + 透传 words）。
/// 智能分隔：英文单词之间加空格，中文/标点之间不加。
fn words_to_cue(words: &[WordCue]) -> Option<SubtitleCue> {
    if words.is_empty() {
        return None;
    }
    let start = words.first().map(|w| w.start)?;
    let end = words.last().map(|w| w.end)?;
    let text = join_words_with_smart_separator(words);
    Some(SubtitleCue {
        start,
        end,
        text,
        translated: None,
        words: words.to_vec(),
    })
}

/// 智能拼接词/字：当且仅当前一词结尾与后一词开头都是 ASCII 字母/数字时，中间加空格。
/// 这样英文 "And"+"so" → "And so"，中文 "今"+"天" → "今天"，中英混排也正确。
fn join_words_with_smart_separator(words: &[WordCue]) -> String {
    let mut out = String::new();
    for (i, w) in words.iter().enumerate() {
        if i > 0 {
            let prev_last = words[i - 1].text.chars().last();
            let this_first = w.text.chars().next();
            let need_space = matches!((prev_last, this_first),
                (Some(a), Some(b)) if a.is_ascii_alphanumeric() && b.is_ascii_alphanumeric());
            if need_space {
                out.push(' ');
            }
        }
        out.push_str(&w.text);
    }
    out
}

/// 用 DeepSeek 重新分段 + 整理字幕（AI 语义断句 + 可读性控制）。
/// translate=true 时把原文翻译成中文（双语保留原文）。
pub async fn refine_subtitles(
    settings: &AppSettings,
    cues: &[SubtitleCue],
    translate: bool,
) -> anyhow::Result<Vec<SubtitleCue>> {
    let api_key = settings.deepseek_api_key.trim();
    if api_key.is_empty() {
        // 没有 key → 用纯规则分段（不返回 raw whisper）
        return Ok(segment_subtitles_rules(cues));
    }

    // 如果原始 cues 已带词级时间戳，跳过 AI 重排。
    // 原因：AI 重排会重组字幕边界，丢失 word↔cue 对应关系，破坏逐字高亮。
    // words_to_cues 已经按可读性分组，质量足够；翻译走单独的流程。
    if cues.iter().any(|c| !c.words.is_empty()) && !translate {
        return Ok(segment_subtitles_rules(cues));
    }

    let input: Vec<serde_json::Value> = cues
        .iter()
        .map(|c| json!({ "start": c.start, "end": c.end, "text": c.text }))
        .collect();

    let system_prompt = "你是专业字幕编导。你的任务是把语音识别的原始分段重新编排成适合短视频观看的字幕块。你必须严格按可读性规则分段，并估算每段的显示时长。只返回 JSON。";

    let rules = r#"可读性规则（必须严格遵守）：
- 每段最多 30 个中文字（或 42 个英文字符），超过必须在语义自然处拆分
- 优先在句号、感叹号、问号处拆分；其次逗号、分号；最后按从句/意群边界
- 不要在一个词中间拆分
- 合并间隔小于 0.5 秒的相邻段（如果合并后不超字数上限）
- 每段最短 0.8 秒，最长 6 秒
- start/end 必须在原始时间范围内合理分配（按字数比例分配时长）
- 段与段之间留 0.1-0.3 秒间隔（前段 end 略提前）
- 修正明显的语音识别错误和标点
- 保持原文核心意思，不要改写或删减内容"#;

    let user_prompt = if translate {
        format!(
            r#"{rules}

下面是带时间戳的原始字幕片段（JSON 数组）。请重新分段编排，并把每条翻译成中文。

只返回 JSON 对象：{{"subtitles": [{{"start": 0.0, "end": 2.5, "text": "原文", "translated": "中文翻译"}}]}}

原始字幕：
{}"#,
            serde_json::to_string_pretty(&input).unwrap_or_default()
        )
    } else {
        format!(
            r#"{rules}

下面是带时间戳的原始字幕片段（JSON 数组）。请重新分段编排。

只返回 JSON 对象：{{"subtitles": [{{"start": 0.0, "end": 2.5, "text": "整理后文字"}}]}}

原始字幕：
{}"#,
            serde_json::to_string_pretty(&input).unwrap_or_default()
        )
    };

    let client = crate::ffmpeg::http_client();
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
            "temperature": 0.3
        }))
        .send()
        .await?;

    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        // AI 失败 → 回退到规则分段
        return Ok(segment_subtitles_rules(cues));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| anyhow::anyhow!("DeepSeek 返回解析失败：{e}"))?;
    let content = parsed["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("DeepSeek 返回为空"))?;
    let refined = extract_subtitle_array(content)?;
    // AI 输出后再跑一次规则补丁（CPS/时长/间隔边界检查）
    Ok(segment_subtitles_rules(&refined))
}

/// 纯规则字幕分段（无 AI 依赖，可独立运行）。
/// 三遍处理：合并太短 → 拆分太长 → 时间优化。
pub fn segment_subtitles_rules(cues: &[SubtitleCue]) -> Vec<SubtitleCue> {
    if cues.is_empty() {
        return vec![];
    }

    // 如果原始 cues 已带词级时间戳（whisper -ml 1 模式），直接透传。
    // 词级 cues 已经在 words_to_cues 里按可读性分组过，再过一遍规则会破坏 word↔cue 对应关系。
    if cues.iter().any(|c| !c.words.is_empty()) {
        return cues.to_vec();
    }

    // 阈值
    const MAX_CHARS: usize = 30; // 每段最大字符数
    const MAX_DURATION: f64 = 6.0; // 每段最大时长（秒）
    const MIN_DURATION: f64 = 0.8; // 每段最小时长（秒）
    const MERGE_GAP: f64 = 0.5; // 合并间隔阈值（秒）
    const MIN_GAP: f64 = 0.1; // 段间最小间隔（秒）
    const MAX_CPS: f64 = 14.0; // 最大字符/秒（中文）

    // Pass 1: 合并太短的段（间隔 < MERGE_GAP 且合并后不超限）
    let mut merged: Vec<SubtitleCue> = Vec::new();
    for cue in cues {
        if let Some(last) = merged.last_mut() {
            let gap = cue.start - last.end;
            let combined_text = format!("{}{}", last.text, cue.text);
            let combined_dur = cue.end - last.start;
            if gap < MERGE_GAP
                && combined_text.chars().count() <= MAX_CHARS
                && combined_dur <= MAX_DURATION
            {
                last.end = cue.end;
                last.text = combined_text;
                continue;
            }
        }
        merged.push(cue.clone());
    }

    // Pass 2: 拆分太长的段（字数 > MAX_CHARS 或 时长 > MAX_DURATION）
    let mut split: Vec<SubtitleCue> = Vec::new();
    for cue in &merged {
        let char_count = cue.text.chars().count();
        let dur = cue.end - cue.start;
        if char_count <= MAX_CHARS && dur <= MAX_DURATION {
            split.push(cue.clone());
            continue;
        }
        // 需要拆分：按标点优先级找断点
        let parts = split_text_by_punctuation(&cue.text, MAX_CHARS);
        let total_chars: usize = parts.iter().map(|p| p.chars().count()).sum();
        let segment_dur = dur / parts.len() as f64;
        let mut t = cue.start;
        for (i, part) in parts.iter().enumerate() {
            let part_chars = part.chars().count();
            let part_dur = if total_chars > 0 {
                dur * (part_chars as f64 / total_chars as f64)
            } else {
                segment_dur
            };
            let end = if i == parts.len() - 1 {
                cue.end // 最后一段用原始 end
            } else {
                (t + part_dur).min(cue.end)
            };
            split.push(SubtitleCue {
                start: t,
                end,
                text: part.clone(),
                translated: cue.translated.clone(),
                words: vec![],
            });
            t = end + MIN_GAP; // 段间留间隔
        }
    }

    // Pass 3: 时间优化（最短时长 + CPS 检查 + 最小间隔）
    let mut result: Vec<SubtitleCue> = Vec::new();
    for cue in &split {
        let mut start = cue.start;
        let mut end = cue.end;
        let char_count = cue.text.chars().count();
        let dur = end - start;

        // 最短时长
        if dur < MIN_DURATION {
            end = start + MIN_DURATION;
        }

        // CPS 检查：如果字数/时长 > MAX_CPS，延长时长
        let actual_dur = end - start;
        if actual_dur > 0.0 && (char_count as f64 / actual_dur) > MAX_CPS {
            end = start + (char_count as f64 / MAX_CPS).max(MIN_DURATION);
        }

        // 不超过下一段的 start
        if let Some(next) = result.last() {
            if start < next.end + MIN_GAP {
                start = next.end + MIN_GAP;
            }
        }

        result.push(SubtitleCue {
            start,
            end,
            text: cue.text.clone(),
            translated: cue.translated.clone(),
            words: vec![],
        });
    }

    result
}

/// 按标点优先级拆分文本（返回多个片段，每片段不超过 max_chars）
fn split_text_by_punctuation(text: &str, max_chars: usize) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max_chars {
        return vec![text.to_string()];
    }

    // 断点优先级：句号/感叹/问号 > 逗号/分号/冒号 > 空格/任意
    let high_priority = ['。', '！', '？', '!', '?', '.', '…'];
    let mid_priority = ['，', '、', '；', '：', ';', ':', ','];

    let mut parts: Vec<String> = Vec::new();
    let mut start = 0usize;

    while start < chars.len() {
        let remaining = &chars[start..];
        if remaining.len() <= max_chars {
            parts.push(remaining.iter().collect());
            break;
        }

        // 在 max_chars 范围内找最佳断点（从后往前找高优先级 → 中优先级）
        let search_end = max_chars.min(remaining.len());
        let mut best_break = None;

        // 先找高优先级
        for i in (1..=search_end).rev() {
            if high_priority.contains(&remaining[i - 1]) {
                best_break = Some(i);
                break;
            }
        }
        // 再找中优先级
        if best_break.is_none() {
            for i in (1..=search_end).rev() {
                if mid_priority.contains(&remaining[i - 1]) {
                    best_break = Some(i);
                    break;
                }
            }
        }
        // 最后按空格
        if best_break.is_none() {
            for i in (1..=search_end).rev() {
                if remaining[i - 1] == ' ' {
                    best_break = Some(i);
                    break;
                }
            }
        }

        let break_at = best_break.unwrap_or(search_end);
        parts.push(remaining[..break_at].iter().collect());
        start += break_at;
    }

    if parts.is_empty() {
        vec![text.to_string()]
    } else {
        parts
    }
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
    let start = text
        .find('[')
        .ok_or_else(|| anyhow::anyhow!("未找到字幕数组"))?;
    let end = text
        .rfind(']')
        .ok_or_else(|| anyhow::anyhow!("未找到字幕数组结尾"))?;
    let array_str = &text[start..=end];

    let arr: Vec<serde_json::Value> =
        serde_json::from_str(array_str).map_err(|e| anyhow::anyhow!("字幕数组解析失败：{e}"))?;

    let cues = arr
        .into_iter()
        .map(|item| {
            // 双语模式：LLM 返回 {text: "原文", translated: "中文翻译"}
            // 不再拼接 "翻译\n原文"，保留 translated 独立字段，由 generate_subtitles 分轨输出
            let (text, translated) = if let Some(t) = item
                .get("translated")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            {
                let original = item.get("text").and_then(|v| v.as_str()).unwrap_or("");
                if !original.is_empty() && original != t {
                    (original.to_string(), Some(t.to_string()))
                } else {
                    (t.to_string(), None)
                }
            } else {
                (
                    item.get("text")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    None,
                )
            };
            SubtitleCue {
                start: item.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0),
                end: item.get("end").and_then(|v| v.as_f64()).unwrap_or(0.0),
                text,
                translated,
                words: vec![],
            }
        })
        .collect();
    Ok(cues)
}
