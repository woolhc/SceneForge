use serde::{de::DeserializeOwned, Deserialize};
use serde_json::json;

use crate::models::{
    AiSegment, AppSettings, EnrichSegmentsRequest, SegmentScriptRequest, SegmentScriptResult,
};

#[derive(Debug, Deserialize)]
struct DeepSeekResponse {
    choices: Vec<DeepSeekChoice>,
}

#[derive(Debug, Deserialize)]
struct DeepSeekChoice {
    message: DeepSeekMessage,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct DeepSeekMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
struct AiSegmentPayload {
    segments: Vec<AiSegment>,
}

fn parse_json_content<T: DeserializeOwned>(content: &str) -> anyhow::Result<T> {
    let trimmed = content.trim();
    let unwrapped = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```JSON"))
        .or_else(|| trimmed.strip_prefix("```"))
        .and_then(|value| value.strip_suffix("```"))
        .map(str::trim)
        .unwrap_or(trimmed);
    if let Ok(payload) = serde_json::from_str(unwrapped) {
        return Ok(payload);
    }
    let start = unwrapped
        .find('{')
        .ok_or_else(|| anyhow::anyhow!("AI 响应中没有 JSON 对象"))?;
    let end = unwrapped
        .rfind('}')
        .ok_or_else(|| anyhow::anyhow!("AI 响应中的 JSON 对象不完整"))?;
    Ok(serde_json::from_str(&unwrapped[start..=end])?)
}

pub async fn segment_script(
    settings: &AppSettings,
    request: SegmentScriptRequest,
) -> anyhow::Result<SegmentScriptResult> {
    let api_key = settings.deepseek_api_key.trim();
    if api_key.is_empty() {
        anyhow::bail!("请先在设置中配置 DeepSeek API Key");
    }

    let script = request.script.trim();
    if script.is_empty() {
        anyhow::bail!("请先输入文案，再进行 AI 分段");
    }

    let system_prompt = "你是短视频剪辑助手。请把中文口播文案按语义拆成适合剪映时间线的片段，每段通常 1-3 句话。只返回 JSON，不要 Markdown。";
    let user_prompt = format!(
        r#"项目比例：{ratio}

请把下面文案拆成短视频片段。返回 JSON：
{{
  "segments": [
    {{
      "title": "不超过12字的片段标题",
      "text": "该片段完整口播文案",
      "visualQuery": "适合去 Pexels 搜索的英文视频关键词，偏风景/空镜",
      "visualQueryZh": "visualQuery 对应的中文关键词（2-4字）",
      "mood": "治愈/紧张/怀旧/开阔/城市/自然等",
      "estimatedDuration": 6.5,
      "materialStrategy": "auto_search"
    }}
  ]
}}

要求：
- 不要改写原文核心意思。
- 不要丢句子。
- visualQuery 必须是英文，适合搜索视频素材。
- visualQueryZh 是该关键词的中文表述，方便用户理解。
- estimatedDuration 按中文口播速度估计，单位秒，最小 2 秒。
- materialStrategy 取值：auto_search（自动搜素材，默认）/ manual（需手动挑选，适合抽象概念）/ color_card（纯色背景卡，适合金句/语录类）。

文案：
{script}"#,
        ratio = request.ratio,
        script = script
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
            "temperature": 0.2
        }))
        .send()
        .await?;

    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        anyhow::bail!("DeepSeek 分段失败：HTTP {}", status.as_u16());
    }

    let deepseek: DeepSeekResponse = serde_json::from_str(&body)?;
    let content = deepseek
        .choices
        .first()
        .map(|choice| choice.message.content.trim())
        .filter(|content| !content.is_empty())
        .ok_or_else(|| anyhow::anyhow!("DeepSeek 返回为空"))?;

    let payload: AiSegmentPayload = serde_json::from_str(content).map_err(|error| {
        anyhow::anyhow!("DeepSeek 返回 JSON 解析失败：{}。请重试或调整文案。", error)
    })?;

    if payload.segments.is_empty() {
        anyhow::bail!("DeepSeek 没有生成任何片段");
    }

    let raw_segment_count = payload.segments.len();
    // 规范化 estimatedDuration 下限
    let segments = payload
        .segments
        .into_iter()
        .map(|mut segment| {
            if segment.estimated_duration < 2.0 {
                segment.estimated_duration = 2.0;
            }
            segment
        })
        .collect();

    Ok(SegmentScriptResult {
        segments,
        raw_segment_count,
    })
}

/// 音频模式：给 whisper 识别出的"带时间句子"补充 title/visualQuery/mood/strategy。
/// 关键约束：不改变句子的数量、顺序、时间（start/end 原样保留）。
/// DeepSeek 只负责"理解每句在讲什么 → 配一个合适的画面搜索词"。
pub async fn enrich_segments(
    settings: &AppSettings,
    request: EnrichSegmentsRequest,
) -> anyhow::Result<Vec<AiSegment>> {
    let api_key = settings.deepseek_api_key.trim();
    if api_key.is_empty() {
        anyhow::bail!("请先在设置中配置 DeepSeek API Key");
    }
    if request.sentences.is_empty() {
        anyhow::bail!("没有可富化的句子");
    }

    // 构造输入：带 index 的句子列表（让 AI 知道顺序，但不允许合并/拆分）
    let input: Vec<serde_json::Value> = request
        .sentences
        .iter()
        .enumerate()
        .map(|(i, s)| json!({ "index": i, "start": s.start, "end": s.end, "text": s.text }))
        .collect();

    let system_prompt = "你是短视频剪辑助手。我会给你一组已经切好的句子（每句带时间戳）。你的任务是为每句配一个画面搜索词，但绝对不能改变句子的数量、顺序、时间。只返回 JSON。";
    let material_direction = describe_material_direction(&request.material_direction);
    let user_prompt = format!(
        r#"项目比例：{ratio}
素材方向：{material_direction}

下面是 {n} 句已切好的旁白（按时间顺序，带真实时间戳）。请为每一句配画面关键词。

严格约束：
- 输出必须正好 {n} 段，顺序与输入一一对应。
- start / end 必须原样回填，不得修改。
- text 必须原样回填，不得改写。
- 不要合并句子，不要拆分句子，不要增删句子。
- 如果素材方向不是 AI 自动判断，请让 visualQuery 明显贴合该方向，但仍需尊重每句文案语义。

返回 JSON：
{{
  "segments": [
    {{
      "index": 0,
      "start": 0.0,
      "end": 3.5,
      "text": "原样回填的句子",
      "title": "不超过10字的标题",
      "visualQuery": "英文 Pexels 关键词",
      "visualQueryZh": "中文关键词",
      "mood": "情绪标签",
      "materialStrategy": "auto_search"
    }}
  ]
}}

句子：
{input}"#,
        ratio = request.ratio,
        material_direction = material_direction,
        n = request.sentences.len(),
        input = serde_json::to_string_pretty(&input).unwrap_or_default()
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
            "temperature": 0.3
        }))
        .send()
        .await?;

    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        anyhow::bail!("DeepSeek 富化失败：HTTP {}", status.as_u16());
    }

    let deepseek: DeepSeekResponse = serde_json::from_str(&body)?;
    let content = deepseek
        .choices
        .first()
        .map(|c| c.message.content.trim())
        .filter(|c| !c.is_empty())
        .ok_or_else(|| anyhow::anyhow!("DeepSeek 返回为空"))?;

    // 解析：用原文句子作为权威来源，AI 输出按 index 匹配
    #[derive(Deserialize)]
    struct EnrichPayload {
        #[serde(default)]
        segments: Vec<EnrichItem>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct EnrichItem {
        #[serde(default)]
        index: Option<usize>,
        #[serde(default)]
        title: String,
        #[serde(default)]
        visual_query: String,
        #[serde(default)]
        visual_query_zh: String,
        #[serde(default)]
        mood: String,
        #[serde(default = "default_material_strategy")]
        material_strategy: String,
    }
    fn default_material_strategy() -> String {
        "auto_search".to_string()
    }

    let payload: EnrichPayload = serde_json::from_str(content)
        .map_err(|e| anyhow::anyhow!("DeepSeek 富化 JSON 解析失败：{e}"))?;

    // 用原文句子的时间/text 作为权威，AI 字段按 index 对齐
    let mut by_index: std::collections::HashMap<usize, &EnrichItem> =
        std::collections::HashMap::new();
    for item in &payload.segments {
        let idx = item.index.unwrap_or(0);
        by_index.insert(idx, item);
    }

    let result: Vec<AiSegment> = request
        .sentences
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let enrich = by_index.get(&i).copied();
            let fallback = payload.segments.get(i);
            let item = enrich.or(fallback);
            let duration = (s.end - s.start).max(0.5);
            AiSegment {
                title: item
                    .map(|x| x.title.clone())
                    .filter(|t| !t.is_empty())
                    .unwrap_or_else(|| s.text.chars().take(10).collect()),
                text: s.text.clone(),
                visual_query: item
                    .map(|x| x.visual_query.clone())
                    .filter(|t| !t.is_empty())
                    .unwrap_or_else(|| "nature landscape".to_string()),
                visual_query_zh: item.map(|x| x.visual_query_zh.clone()).unwrap_or_default(),
                mood: item
                    .map(|x| x.mood.clone())
                    .filter(|t| !t.is_empty())
                    .unwrap_or_else(|| "neutral".to_string()),
                estimated_duration: duration,
                material_strategy: item
                    .map(|x| x.material_strategy.clone())
                    .unwrap_or_else(|| "auto_search".to_string()),
                start: s.start,
                end: s.end,
            }
        })
        .collect();

    Ok(result)
}

fn describe_material_direction(value: &str) -> String {
    match value {
        "scenery" => "风景/空镜：自然、城市远景、道路、天空、海洋、环境氛围镜头".to_string(),
        "people" => "人物/生活方式：人物动作、情绪、家庭、工作、手部、行走、日常生活".to_string(),
        "business" => "商业/办公：办公、会议、产品、科技、创业、金融、团队协作".to_string(),
        "abstract" => "抽象/质感：纹理、光影、微距、慢动作、符号化画面、情绪氛围".to_string(),
        custom if custom.starts_with("custom:") => {
            let keywords = custom.trim_start_matches("custom:").trim();
            if keywords.is_empty() {
                "AI 自动判断：根据每句文案语义选择最自然的素材类型".to_string()
            } else {
                format!("自定义关键词：优先融合这些关键词和每句语义：{keywords}")
            }
        }
        _ => "AI 自动判断：根据每句文案语义选择最自然的素材类型".to_string(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum SubtitleProtectedRangePayload {
    Object(crate::models::SubtitleProtectedRange),
    Pair([usize; 2]),
}

impl SubtitleProtectedRangePayload {
    fn into_range(self) -> crate::models::SubtitleProtectedRange {
        match self {
            Self::Object(range) => range,
            Self::Pair([start_word_index, end_word_index]) => {
                crate::models::SubtitleProtectedRange {
                    start_word_index,
                    end_word_index,
                }
            }
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubtitleBreakAdvicePayload {
    #[serde(default)]
    preferred_break_after_indices: Vec<usize>,
    #[serde(default)]
    protected_ranges: Vec<SubtitleProtectedRangePayload>,
    #[serde(default)]
    confidence: f64,
}

pub async fn advise_subtitle_breaks(
    settings: &AppSettings,
    request: crate::models::SubtitleBreakAdviceRequest,
) -> anyhow::Result<crate::models::SubtitleBreakAdviceResult> {
    let api_key = settings.deepseek_api_key.trim();
    if api_key.is_empty() {
        anyhow::bail!("未配置 DeepSeek API Key");
    }
    if request.words.len() < 2 {
        return Ok(crate::models::SubtitleBreakAdviceResult {
            preferred_break_after_indices: vec![],
            protected_ranges: vec![],
            confidence: 1.0,
        });
    }
    if request.words.len() > 180 {
        anyhow::bail!("单次字幕语义分析最多支持 180 个词");
    }

    let has_complete_timings = request.word_timings.len() == request.words.len();
    let indexed_words: Vec<serde_json::Value> = request
        .words
        .iter()
        .enumerate()
        .map(|(index, text)| {
            if has_complete_timings {
                let timing = &request.word_timings[index];
                json!({
                    "index": index,
                    "text": text,
                    "start": timing.start,
                    "end": timing.end,
                    "duration": (timing.end - timing.start).max(0.0),
                    "gapAfter": timing.gap_after.max(0.0)
                })
            } else {
                json!({ "index": index, "text": text })
            }
        })
        .collect();
    let constraints = request
        .constraints
        .as_ref()
        .map(serde_json::to_string)
        .transpose()?
        .unwrap_or_else(|| "{}".to_string());
    let system_prompt = "你是资深短视频字幕编辑。语义完整性优先，同时严格尊重给定时间、停顿和版式限制。你只能引用输入中已有的 word index，不能改写、添加、删除或重排文字。只返回 JSON。";
    let user_prompt = format!(
        r#"请把以下连续口播词序列规划成自然、可读、有节奏的字幕语义组。

返回 JSON：
{{
  "preferredBreakAfterIndices": [8, 17],
  "protectedRanges": [
    {{"startWordIndex": 3, "endWordIndex": 6}}
  ],
  "confidence": 0.86
}}

决策优先级：
1. 先理解完整语义、修饰关系、因果/转折、专有名词和固定短语，避免把一句话从语义中间切断。
2. 利用 start/end/gapAfter：明显停顿通常适合断开，连续紧密发音通常不应强拆。
3. 尽量让每组接近 preferredDuration 与 preferredCharsPerLine，同时不得主动规划超过 maxDuration 或 maxCharsPerCue 的组。
4. 避免只有 1-2 个短词的闪烁字幕；避免上一条尾部或下一条开头成为孤立成分。
5. short_form 模式可更有节奏但仍保持短语完整；precise 模式更忠于语法；natural 模式优先自然口语语义。
6. preferredBreakAfterIndices 表示在对应 index 的词之后断开，不要返回最后一个 index。
7. protectedRanges 用于绝不能从中间拆开的名称、数字表达、固定搭配或强绑定短语，区间包含首尾 index。
8. 所有 index 必须来自输入；不返回文字内容，不返回时间戳。
9. confidence 表示你对整批语义断点的可靠程度；只有真正理解上下文时才给高置信度。

字幕模式：{mode}
版式与阅读约束：{constraints}
项目上下文：{context}
带时间词序列：
{words}"#,
        mode = request.mode,
        constraints = constraints,
        context = request.context.chars().take(2000).collect::<String>(),
        words = serde_json::to_string(&indexed_words)?
    );

    let client = crate::ffmpeg::http_client();
    let mut last_error: Option<anyhow::Error> = None;
    for model in ["deepseek-v4-flash", "deepseek-chat"] {
        let response = client
            .post("https://api.deepseek.com/chat/completions")
            .bearer_auth(api_key)
            .json(&json!({
                "model": model,
                "messages": [
                    { "role": "system", "content": system_prompt },
                    { "role": "user", "content": user_prompt }
                ],
                "response_format": { "type": "json_object" },
                "temperature": 0.1
            }))
            .send()
            .await;
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                last_error = Some(error.into());
                continue;
            }
        };
        let status = response.status();
        let body = response.text().await?;
        if !status.is_success() {
            last_error = Some(anyhow::anyhow!(
                "DeepSeek 字幕断句失败：HTTP {}",
                status.as_u16()
            ));
            continue;
        }
        let deepseek: DeepSeekResponse = match serde_json::from_str(&body) {
            Ok(value) => value,
            Err(error) => {
                last_error = Some(anyhow::anyhow!("DeepSeek 响应解析失败：{error}"));
                continue;
            }
        };
        let content = match deepseek
            .choices
            .first()
            .map(|choice| choice.message.content.trim())
            .filter(|content| !content.is_empty())
        {
            Some(content) => content,
            None => {
                last_error = Some(anyhow::anyhow!("DeepSeek 字幕断句返回为空"));
                continue;
            }
        };
        let payload: SubtitleBreakAdvicePayload = match parse_json_content(content) {
            Ok(payload) => payload,
            Err(error) => {
                last_error = Some(anyhow::anyhow!("DeepSeek 字幕断句 JSON 解析失败：{error}"));
                continue;
            }
        };
        let last_index = request.words.len() - 1;
        let mut preferred = payload
            .preferred_break_after_indices
            .into_iter()
            .filter(|index| *index < last_index)
            .collect::<Vec<_>>();
        preferred.sort_unstable();
        preferred.dedup();
        let protected_ranges = payload
            .protected_ranges
            .into_iter()
            .map(SubtitleProtectedRangePayload::into_range)
            .filter(|range| {
                range.start_word_index < range.end_word_index && range.end_word_index <= last_index
            })
            .collect();
        return Ok(crate::models::SubtitleBreakAdviceResult {
            preferred_break_after_indices: preferred,
            protected_ranges,
            confidence: payload.confidence.clamp(0.0, 1.0),
        });
    }
    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("DeepSeek 字幕断句失败")))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubtitleLanguageContextPayload {
    summary: String,
    #[serde(default)]
    content_type: String,
    #[serde(default)]
    tone: String,
    #[serde(default)]
    terms: Vec<crate::models::SubtitleLanguageTerm>,
}

pub async fn analyze_subtitle_language_context(
    settings: &AppSettings,
    request: crate::models::SubtitleLanguageContextRequest,
) -> anyhow::Result<crate::models::SubtitleLanguageContextResult> {
    let api_key = settings.deepseek_api_key.trim();
    if api_key.is_empty() {
        anyhow::bail!("未配置 DeepSeek API Key");
    }
    let prompt = format!(
        r#"分析以下视频字幕项目，为后续断句和翻译生成全局语言上下文。
只返回 JSON：
{{
  "summary":"两到三句内容摘要",
  "contentType":"tutorial/interview/marketing/documentary/conversation/other",
  "tone":"professional/casual/emotional/educational/cinematic",
  "terms":[{{"source":"术语","target":"建议中文译法","note":"含义或使用说明"}}]
}}
要求：术语不超过 20 个；优先人名、品牌、产品、技术概念；不要改写 transcript。
字幕模式：{mode}
项目标题：{title}
用户原始文案：{script}
识别文本：{transcript}"#,
        mode = request.mode,
        title = request.project_title,
        script = request.script.chars().take(4000).collect::<String>(),
        transcript = request.transcript.chars().take(10000).collect::<String>()
    );
    let response = crate::ffmpeg::http_client()
        .post("https://api.deepseek.com/chat/completions")
        .bearer_auth(api_key)
        .json(&json!({
          "model":"deepseek-v4-flash",
          "messages":[
            {"role":"system","content":"你是字幕项目的全局语言分析器，只返回 JSON。"},
            {"role":"user","content":prompt}
          ],
          "response_format":{"type":"json_object"},
          "temperature":0.1
        }))
        .send()
        .await?;
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        anyhow::bail!("DeepSeek 全局字幕分析失败：HTTP {}", status.as_u16());
    }
    let parsed: serde_json::Value = serde_json::from_str(&body)?;
    let content = parsed["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("DeepSeek 全局字幕分析返回为空"))?;
    let payload: SubtitleLanguageContextPayload = parse_json_content(content)?;
    Ok(crate::models::SubtitleLanguageContextResult {
        summary: payload.summary,
        content_type: if payload.content_type.is_empty() {
            "other".to_string()
        } else {
            payload.content_type
        },
        tone: if payload.tone.is_empty() {
            "natural".to_string()
        } else {
            payload.tone
        },
        terms: payload.terms.into_iter().take(20).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::{parse_json_content, SubtitleBreakAdvicePayload};

    #[test]
    fn subtitle_break_payload_accepts_pair_ranges() {
        let payload: SubtitleBreakAdvicePayload = parse_json_content(
            r#"{"preferredBreakAfterIndices":[6],"protectedRanges":[[0,6]],"confidence":0.9}"#,
        )
        .expect("pair protected range should parse");
        assert_eq!(payload.preferred_break_after_indices, vec![6]);
        assert_eq!(payload.protected_ranges.len(), 1);
    }

    #[test]
    fn json_content_accepts_markdown_fences() {
        let payload: SubtitleBreakAdvicePayload = parse_json_content(
            "```json\n{\"preferredBreakAfterIndices\":[3],\"protectedRanges\":[],\"confidence\":0.8}\n```",
        )
        .expect("fenced json should parse");
        assert_eq!(payload.preferred_break_after_indices, vec![3]);
    }
}
