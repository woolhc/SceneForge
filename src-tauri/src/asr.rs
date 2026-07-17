use std::path::Path;
use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::json;

use crate::models::{AppSettings, SubtitleCue, WordCue};

/// 字幕可读性配置（行业标准：Netflix/BBC 规范）
/// 中文 CPS≤12、单行≤18 字；英文 CPS≤20、单行≤42 字符
#[derive(Clone, Copy)]
struct SubtitleProfile {
    max_chars: usize,
    max_cps: f64,
    min_duration: f64,
    max_duration: f64,
}

const ZH_PROFILE: SubtitleProfile = SubtitleProfile {
    max_chars: 18,
    max_cps: 12.0,
    min_duration: 1.2,
    max_duration: 7.0,
};

const EN_PROFILE: SubtitleProfile = SubtitleProfile {
    max_chars: 42,
    max_cps: 20.0,
    min_duration: 1.5,
    max_duration: 7.0,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Language {
    Chinese,
    English,
    Mixed,
}

fn is_chinese_char(c: char) -> bool {
    matches!(c as u32,
        0x4E00..=0x9FFF |   // CJK 统一汉字
        0x3400..=0x4DBF |   // CJK 扩展 A
        0x20000..=0x2A6DF   // CJK 扩展 B
    )
}

fn is_chinese(text: &str) -> bool {
    let chinese = text.chars().filter(|c| is_chinese_char(*c)).count();
    let total = text.chars().filter(|c| !c.is_whitespace()).count();
    total > 0 && chinese * 2 >= total // 中文字符占比 ≥ 50%
}

/// 按中文字符占比检测语言，混合用中文 profile（更保守）
fn detect_language(text: &str) -> Language {
    let chinese = text.chars().filter(|c| is_chinese_char(*c)).count();
    let alpha = text.chars().filter(|c| c.is_ascii_alphanumeric()).count();
    let total = chinese + alpha;
    if total == 0 {
        return Language::English;
    }
    let zh_ratio = chinese as f64 / total as f64;
    if zh_ratio > 0.7 {
        Language::Chinese
    } else if zh_ratio < 0.3 {
        Language::English
    } else {
        Language::Mixed
    }
}

fn profile_for(text: &str) -> SubtitleProfile {
    match detect_language(text) {
        Language::English => EN_PROFILE,
        Language::Chinese | Language::Mixed => ZH_PROFILE,
    }
}

/// jieba 分词器全局缓存（避免重复初始化字典）
fn jieba() -> &'static jieba_rs::Jieba {
    static JIEBA: OnceLock<jieba_rs::Jieba> = OnceLock::new();
    JIEBA.get_or_init(jieba_rs::Jieba::new)
}

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

/// Whisper 就绪指引。安装包内置 whisper-cli，模型由应用首次使用流程管理。
fn whisper_install_hint() -> String {
    "请打开 SceneForge「设置 → 语音识别」下载推荐模型，或选择已有的 Whisper `.bin` 模型。若 whisper-cli 缺失，请重新安装 SceneForge；开发模式会优先使用系统 PATH 中可直接运行的 whisper-cli。".to_string()
}

fn whisper_failure_hint(stderr: &str) -> String {
    if stderr.contains("Library not loaded") || stderr.contains("dyld[") {
        return "whisper-cli 的 macOS 动态运行库不完整。开发模式请安装可直接运行的 Homebrew whisper-cpp，或在「设置 → 语音识别」指定完整的 whisper-cli 路径；正式安装包请重新安装。".to_string();
    }
    whisper_install_hint()
}

/// 调用 whisper-cli 识别音频，返回带时间戳的原始片段。
pub async fn transcribe_audio(
    settings: &AppSettings,
    cache_dir: &Path,
    audio_path: &Path,
) -> anyhow::Result<Vec<SubtitleCue>> {
    let app_data_dir = cache_dir.parent().unwrap_or(cache_dir);
    let model_path = crate::tools::resolve_whisper_model(&settings.whisper_model, app_data_dir)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "找不到 whisper 模型。请将模型放入 {} 或在设置中指定 .bin 文件。\n{}",
                app_data_dir.join("models").display(),
                whisper_install_hint()
            )
        })?;
    let model = model_path.to_string_lossy().to_string();

    let whisper = crate::tools::resolve(
        crate::tools::NativeTool::Whisper,
        Some(&settings.whisper_bin),
    );
    if !whisper.available {
        anyhow::bail!(
            "找不到 whisper 可执行程序。应用包未包含 sidecar，系统 PATH 也不可用。\n{}",
            whisper_install_hint()
        );
    }
    let whisper_bin = whisper.path.to_string_lossy().to_string();

    // 输出前缀（whisper 会生成 <prefix>.json）
    // 注意：whisper-cli 的 -of 参数对含空格的路径解析有 bug（会打印帮助并静默退出），
    // 所以输出到系统临时目录（无空格），跑完再读 JSON。
    let out_dir = std::env::temp_dir().join("scenescript-whisper");
    tokio::fs::create_dir_all(&out_dir).await?;
    let out_prefix = out_dir.join(format!("asr-{}", chrono::Utc::now().timestamp_millis()));

    // whisper-cli -ml 1 -oj：max-len=1 强制每段一个词/字 → 得到词级时间戳
    // offsets.from/to 是毫秒整数，比 timestamps 字符串精度更高
    // 注意：whisper.cpp 1.7+ 移除了 --no-print-progress，改用 -np（--no-prints）
    let mut cmd = crate::tools::command_with_config(
        crate::tools::NativeTool::Whisper,
        Some(&settings.whisper_bin),
    );
    cmd.args([
        "-m",
        &model,
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
        let detail = if stderr.is_empty() { stdout } else { stderr };
        anyhow::bail!(
            "whisper 识别失败：{}\n{}",
            detail,
            whisper_failure_hint(&detail)
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

    let sentence_enders = ['。', '！', '？', '!', '?', '.'];
    let mut sentences: Vec<crate::models::TimedSentence> = Vec::new();
    let mut current_start: Option<f64> = None;
    let mut current_end: f64 = 0.0;
    let mut current_text = String::new();
    let mut current_words: Vec<WordCue> = Vec::new();
    let mut last_word_end: Option<f64> = None;

    let flush_sentence = |sentences: &mut Vec<crate::models::TimedSentence>,
                          current_start: &mut Option<f64>,
                          current_end: f64,
                          current_text: &mut String,
                          current_words: &mut Vec<WordCue>| {
        let text = current_text.trim().to_string();
        if let (Some(start), false) = (*current_start, text.is_empty()) {
            sentences.push(crate::models::TimedSentence {
                start,
                end: current_end,
                text,
                words: std::mem::take(current_words),
            });
        }
        *current_start = None;
        current_text.clear();
        current_words.clear();
    };

    for cue in &cues {
        let big_gap = last_word_end
            .map(|end| cue.start - end > 0.8)
            .unwrap_or(false);
        if big_gap {
            flush_sentence(
                &mut sentences,
                &mut current_start,
                current_end,
                &mut current_text,
                &mut current_words,
            );
        }

        if current_start.is_none() {
            current_start = Some(cue.start);
        }
        current_end = cue.end;
        current_text.push_str(&cue.text);
        current_words.extend(cue.words.iter().cloned());

        let ends_with_sentence = cue
            .text
            .chars()
            .last()
            .map(|character| sentence_enders.contains(&character))
            .unwrap_or(false);
        if ends_with_sentence {
            flush_sentence(
                &mut sentences,
                &mut current_start,
                current_end,
                &mut current_text,
                &mut current_words,
            );
        }
        last_word_end = Some(cue.end);
    }

    if current_start.is_some() {
        flush_sentence(
            &mut sentences,
            &mut current_start,
            current_end,
            &mut current_text,
            &mut current_words,
        );
    }

    let total_duration = sentences.last().map(|sentence| sentence.end).unwrap_or(0.0);
    let full_text = sentences
        .iter()
        .map(|sentence| sentence.text.as_str())
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
            confidence: None,
        });
    }

    if all_words.is_empty() {
        return vec![];
    }

    // 2. 检测整体语言，选 profile（行业标准 Netflix/BBC：中文单行≤18 字 CPS≤12，英文≤42 字符 CPS≤20）
    let full_text: String = all_words.iter().map(|w| w.text.as_str()).collect();
    let profile = profile_for(&full_text);
    const PAUSE_GAP: f64 = 0.3; // 停顿断句阈值（行业 SubtitleEdit 标准 0.25-0.4s）
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
                || new_char_count > profile.max_chars // 超字数 → 断
                || duration > profile.max_duration   // 超时长 → 断
                || word.start - last_end > PAUSE_GAP); // 语音停顿 > 0.3s → 断

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
            let previous_text = &words[i - 1].text;
            let prev_last = previous_text.chars().last();
            let this_first = w.text.chars().next();
            let alphanumeric_boundary = matches!((prev_last, this_first),
                (Some(a), Some(b)) if a.is_ascii_alphanumeric() && b.is_ascii_alphanumeric());
            let punctuation_boundary = matches!((prev_last, this_first),
                (Some(a), Some(b)) if matches!(a, ',' | ';' | ':' | '!' | '?') && b.is_ascii_alphanumeric());
            let decimal_like = previous_text.ends_with('.')
                && previous_text
                    .trim_end_matches('.')
                    .chars()
                    .all(|c| c.is_ascii_digit())
                && this_first.is_some_and(|c| c.is_ascii_digit());
            let sentence_boundary = prev_last == Some('.')
                && this_first.is_some_and(|c| c.is_ascii_alphanumeric())
                && !decimal_like;
            if alphanumeric_boundary || punctuation_boundary || sentence_boundary {
                out.push(' ');
            }
        }
        out.push_str(&w.text);
    }
    out
}

/// 批量翻译字幕：输入带 text 的 cues，输出填充 translated 的 cues。
/// 不改 start/end/words，避免 AI 幻觉时间戳。
/// 复用 crate::ffmpeg::http_client() 和 DeepSeek 调用模式。
pub async fn translate_subtitles(
    settings: &AppSettings,
    cues: &[SubtitleCue],
    mode: &str,
    context: &str,
) -> anyhow::Result<Vec<SubtitleCue>> {
    let api_key = settings.deepseek_api_key.trim();
    if api_key.is_empty() || cues.is_empty() {
        return Ok(cues.to_vec());
    }

    // 只发 index + text，不发时间戳（避免 AI 改时间戳）
    let input: Vec<serde_json::Value> = cues
        .iter()
        .enumerate()
        .map(|(i, c)| json!({ "index": i, "text": c.text }))
        .collect();

    let system_prompt =
        "你是专业字幕翻译。把每条原文翻译成中文，保留原文含义，适合短视频观看。只返回 JSON。";
    let user_prompt = format!(
        r#"请翻译以下字幕数组，每条 text 翻译成中文填入 translated 字段。
严格按 index 顺序返回，不改原文，不改时间戳。
项目上下文：{context}

只返回 JSON 对象：{{"translations":[{{"index":0,"translated":"中文翻译"}}]}}

原文：
{}"#,
        serde_json::to_string_pretty(&input).unwrap_or_default(),
        context = context.chars().take(2000).collect::<String>()
    );

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
            "temperature": 0.0
        }))
        .send()
        .await?;

    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        anyhow::bail!("DeepSeek 翻译失败：{}", body);
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| anyhow::anyhow!("DeepSeek 返回解析失败：{e}"))?;
    let content = parsed["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("DeepSeek 返回为空"))?;

    let translations = parse_translations(content)?;
    let mut result = cues.to_vec();
    for (i, cue) in result.iter_mut().enumerate() {
        if let Some(t) = translations.get(&i) {
            cue.translated = Some(t.clone());
        }
    }
    if mode == "precise" {
        return Ok(result);
    }
    adapt_translations(settings, &result, mode, context)
        .await
        .or(Ok(result))
}

async fn adapt_translations(
    settings: &AppSettings,
    cues: &[SubtitleCue],
    mode: &str,
    context: &str,
) -> anyhow::Result<Vec<SubtitleCue>> {
    let input: Vec<serde_json::Value> = cues
        .iter()
        .enumerate()
        .map(|(index, cue)| {
            json!({
                "index": index,
                "source": cue.text,
                "direct": cue.translated,
                "duration": (cue.end - cue.start).max(0.2)
            })
        })
        .collect();
    let instruction = if mode == "short_form" {
        "在不改变核心事实的前提下积极压缩重复口语和低信息修饰，使字幕短促有力。"
    } else {
        "把直译调整为自然、简洁、适合短视频阅读的中文；只做轻度压缩，不改变事实。"
    };
    let prompt = format!(
        r#"你是专业字幕语言编辑。以下每条包含原文、直译和可用时长。
{instruction}
保持 index 和条目数量完全一致；术语结合项目上下文保持统一；不要输出解释。
项目上下文：{context}
只返回 JSON：{{"translations":[{{"index":0,"translated":"自然适配后的字幕"}}]}}
输入：{input}"#,
        instruction = instruction,
        context = context.chars().take(2000).collect::<String>(),
        input = serde_json::to_string(&input)?
    );
    let response = crate::ffmpeg::http_client()
        .post("https://api.deepseek.com/chat/completions")
        .bearer_auth(settings.deepseek_api_key.trim())
        .json(&json!({
            "model": "deepseek-v4-flash",
            "messages": [
                {"role":"system","content":"你是字幕自然度与长度适配编辑器，只返回 JSON。"},
                {"role":"user","content":prompt}
            ],
            "response_format":{"type":"json_object"},
            "temperature":0.2
        }))
        .send()
        .await?;
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        anyhow::bail!("DeepSeek 字幕适配失败：HTTP {}", status.as_u16());
    }
    let parsed: serde_json::Value = serde_json::from_str(&body)?;
    let content = parsed["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("DeepSeek 字幕适配返回为空"))?;
    let translations = parse_translations(content)?;
    let mut result = cues.to_vec();
    for (index, cue) in result.iter_mut().enumerate() {
        if let Some(value) = translations.get(&index) {
            cue.translated = Some(value.clone());
        }
    }
    Ok(result)
}

fn parse_translations(content: &str) -> anyhow::Result<std::collections::HashMap<usize, String>> {
    let text = content.trim();
    let text = text
        .strip_prefix("```json")
        .or_else(|| text.strip_prefix("```"))
        .unwrap_or(text)
        .trim_end_matches('`')
        .trim();
    let parsed: serde_json::Value =
        serde_json::from_str(text).map_err(|e| anyhow::anyhow!("翻译结果解析失败：{e}"))?;
    let arr = parsed["translations"]
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("翻译结果缺少 translations 数组"))?;
    let mut map = std::collections::HashMap::new();
    for item in arr {
        let index = item["index"].as_u64().unwrap_or(0) as usize;
        let translated = item["translated"].as_str().unwrap_or("").to_string();
        if !translated.is_empty() {
            map.insert(index, translated);
        }
    }
    Ok(map)
}

/// 生成中文 translated 的 jieba 分词 word 时间戳（均匀分配）。
/// 用于双语模式中文轨的 karaoke 高亮（非精确，但比无 words 好）。
/// 返回 None 表示 translated 非中文或为空。
pub fn generate_chinese_words(cue: &SubtitleCue) -> Option<Vec<WordCue>> {
    let translated = cue.translated.as_ref()?;
    if !is_chinese(translated) {
        return None;
    }
    let trimmed = translated.trim();
    if trimmed.is_empty() {
        return None;
    }
    let words = jieba().cut(trimmed, true);
    let words: Vec<&str> = words.into_iter().filter(|w| !w.trim().is_empty()).collect();
    if words.is_empty() {
        return None;
    }
    let duration = (cue.end - cue.start).max(0.1);
    let per_word = duration / words.len() as f64;
    Some(
        words
            .iter()
            .enumerate()
            .map(|(i, w)| WordCue {
                start: cue.start + i as f64 * per_word,
                end: cue.start + (i + 1) as f64 * per_word,
                text: w.to_string(),
                confidence: Some(0.5),
            })
            .collect(),
    )
}

/// 用 DeepSeek 重新分段 + 整理字幕（AI 语义断句 + 可读性控制）。
/// translate=true 时把原文翻译成中文（双语保留原文）。
pub async fn refine_subtitles(
    settings: &AppSettings,
    cues: &[SubtitleCue],
    translate: bool,
    mode: &str,
    context: &str,
) -> anyhow::Result<Vec<SubtitleCue>> {
    // 第一步：规则分段（保留 whisper words，双语也走规则，不走 AI 重排）
    // segment_subtitles_rules 内部"有 words 直接返回"分支会保留 words 不破坏对应关系
    let mut result = segment_subtitles_rules(cues);

    // 第二步：翻译（单独流程，不改 start/end/words，避免 AI 幻觉时间戳）
    if translate && !settings.deepseek_api_key.trim().is_empty() {
        result = match translate_subtitles(settings, &result, mode, context).await {
            Ok(translated) => translated,
            Err(_) => result, // 翻译失败回退到不翻译，原文仍可用
        };

        // 注：中文轨的 jieba words 在 commands.rs 单独生成（双语模式 cue.words 是英文，不能在此覆盖）
    }

    Ok(result)
}

/// 规范化相邻 cue 间隔：如果 cue[i+1].start - cue[i].end < min_gap，
/// 则截断 cue[i].end = cue[i+1].start - min_gap（保证 cue[i].end > cue[i].start）。
/// 用于修复 CPS 延长侵入间隔、AI 重排返回连续 cue 等问题，保证字幕不连续排列。
fn ensure_min_gap(cues: &mut [SubtitleCue], min_gap: f64) {
    if cues.len() < 2 {
        return;
    }
    for i in 0..cues.len() - 1 {
        let next_start = cues[i + 1].start;
        let gap = next_start - cues[i].end;
        if gap < min_gap {
            let new_end = next_start - min_gap;
            // 确保不倒置，且保留至少 0.1 秒时长（避免截断后 cue 时长过短）
            if new_end > cues[i].start + 0.1 {
                cues[i].end = new_end;
            }
        }
    }
}

/// 纯规则字幕分段（无 AI 依赖，可独立运行）。
/// 三遍处理：合并太短 → 拆分太长 → 时间优化。
pub fn segment_subtitles_rules(cues: &[SubtitleCue]) -> Vec<SubtitleCue> {
    if cues.is_empty() {
        return vec![];
    }

    // 阈值（中英文按行业标准区分，profile_for 自动检测语言选配置）
    const MERGE_GAP: f64 = 0.5; // 合并间隔阈值（秒）
    const MIN_GAP: f64 = 0.1; // 段间最小间隔（秒）
    let full_text: String = cues.iter().map(|c| c.text.as_str()).collect();
    let profile = profile_for(&full_text);

    // 如果原始 cues 已带词级时间戳，说明前端 AI/Layout Engine 已完成最终分组。
    // 必须原样透传 start/end/words；再次截断会让 cue.end 早于最后一个 word.end。
    if cues.iter().any(|c| !c.words.is_empty()) {
        return cues.to_vec();
    }

    // Pass 1: 合并太短的段（间隔 < MERGE_GAP 且合并后不超限）
    let mut merged: Vec<SubtitleCue> = Vec::new();
    for cue in cues {
        if let Some(last) = merged.last_mut() {
            let gap = cue.start - last.end;
            let combined_text = format!("{}{}", last.text, cue.text);
            let combined_dur = cue.end - last.start;
            if gap < MERGE_GAP
                && combined_text.chars().count() <= profile.max_chars
                && combined_dur <= profile.max_duration
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
        if char_count <= profile.max_chars && dur <= profile.max_duration {
            split.push(cue.clone());
            continue;
        }
        // 需要拆分：按标点优先级找断点
        let parts = split_text_by_punctuation(&cue.text, profile.max_chars);
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
        if dur < profile.min_duration {
            end = start + profile.min_duration;
        }

        // CPS 检查：如果字数/时长 > MAX_CPS，延长时长
        let actual_dur = end - start;
        if actual_dur > 0.0 && (char_count as f64 / actual_dur) > profile.max_cps {
            end = start + (char_count as f64 / profile.max_cps).max(profile.min_duration);
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

    // 最终规范化：修复 Pass 3 CPS 延长侵入间隔的问题，保证字幕不连续排列
    ensure_min_gap(&mut result, MIN_GAP);

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

#[cfg(test)]
mod tests {
    use super::{join_words_with_smart_separator, segment_subtitles_rules, whisper_failure_hint};
    use crate::models::{SubtitleCue, WordCue};

    fn word(text: &str, start: f64, end: f64) -> WordCue {
        WordCue {
            text: text.to_string(),
            start,
            end,
            confidence: Some(1.0),
        }
    }

    #[test]
    fn dyld_failure_gets_runtime_library_guidance() {
        let hint = whisper_failure_hint("dyld[1]: Library not loaded: @rpath/libwhisper.1.dylib");
        assert!(hint.contains("动态运行库不完整"));
        assert!(!hint.contains("下载推荐模型"));
    }

    #[test]
    fn english_punctuation_keeps_natural_spacing() {
        let words = vec![
            word("words", 0.0, 0.2),
            word(",", 0.2, 0.25),
            word("but", 0.25, 0.5),
        ];
        assert_eq!(join_words_with_smart_separator(&words), "words, but");
        let decimal = vec![word("3.", 0.0, 0.2), word("14", 0.2, 0.4)];
        assert_eq!(join_words_with_smart_separator(&decimal), "3.14");
    }

    #[test]
    fn word_timed_cues_preserve_timing() {
        let cue = SubtitleCue {
            start: 0.0,
            end: 1.0,
            text: "hello".to_string(),
            translated: None,
            words: vec![word("hello", 0.0, 1.0)],
        };
        let next = SubtitleCue {
            start: 1.02,
            end: 2.0,
            text: "world".to_string(),
            translated: None,
            words: vec![word("world", 1.02, 2.0)],
        };
        let result = segment_subtitles_rules(&[cue.clone(), next.clone()]);
        assert_eq!(result[0].end, cue.end);
        assert_eq!(result[1].start, next.start);
        assert_eq!(result[0].words[0].end, 1.0);
    }
}
