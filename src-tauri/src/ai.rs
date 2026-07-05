use serde::Deserialize;
use serde_json::json;

use crate::models::{AiSegment, AppSettings, SegmentScriptRequest, SegmentScriptResult};

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
      "mood": "治愈/紧张/怀旧/开阔/城市/自然等",
      "estimatedDuration": 6.5
    }}
  ]
}}

要求：
- 不要改写原文核心意思。
- 不要丢句子。
- visualQuery 必须是英文，适合搜索视频素材。
- estimatedDuration 按中文口播速度估计，单位秒，最小 2 秒。

文案：
{script}"#,
        ratio = request.ratio,
        script = script
    );

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
