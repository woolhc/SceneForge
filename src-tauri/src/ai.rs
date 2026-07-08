use serde::Deserialize;
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
    let user_prompt = format!(
        r#"项目比例：{ratio}

下面是 {n} 句已切好的旁白（按时间顺序，带真实时间戳）。请为每一句配画面关键词。

严格约束：
- 输出必须正好 {n} 段，顺序与输入一一对应。
- start / end 必须原样回填，不得修改。
- text 必须原样回填，不得改写。
- 不要合并句子，不要拆分句子，不要增删句子。

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
