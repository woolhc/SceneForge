use serde::Deserialize;

use crate::models::{AppSettings, MediaSource, PexelsSearchRequest, PexelsSearchResult};

/// 把 Pexels HTTP 失败转成可读中文；配额/限流单独点名，方便前端软降级。
fn format_pexels_http_error(status: reqwest::StatusCode, body: &str, kind: &str) -> String {
    let code = status.as_u16();
    let body_lower = body.to_lowercase();
    let body_snip = body.trim();
    let body_snip = if body_snip.len() > 180 {
        format!("{}…", &body_snip[..180])
    } else {
        body_snip.to_string()
    };

    if is_pexels_quota_body(&body_lower) || code == 429 {
        return format!(
            "Pexels {kind}配额已用尽或触发限流（HTTP {code}）。系统会自动尝试备用源；也可在设置中更换 Key 或进编辑器手动选素材。"
        );
    }
    if code == 401 || code == 403 {
        return format!("Pexels API Key 无效或无权限（HTTP {code}）。请在设置中检查 Key。");
    }
    if body_snip.is_empty() {
        format!("Pexels {kind}失败：HTTP {code}")
    } else {
        format!("Pexels {kind}失败：HTTP {code} — {body_snip}")
    }
}

/// Pexels 偶发 HTTP 200 但正文是配额纯文本，也要识别。
fn is_pexels_quota_body(body_lower: &str) -> bool {
    body_lower.contains("quota")
        || body_lower.contains("rate limit")
        || body_lower.contains("too many requests")
        || body_lower.contains("quota has been exceeded")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quota_plain_text_body_is_detected() {
        // Pexels 实测出现的纯文本配额响应
        assert!(is_pexels_quota_body("the quota has been exceeded."));
        assert!(is_pexels_quota_body("[error] the quota has been exceeded."));
        assert!(is_pexels_quota_body("rate limit exceeded"));
        // 正常响应不被误判
        assert!(!is_pexels_quota_body("{\"videos\":[]}"));
        assert!(!is_pexels_quota_body(""));
    }

    #[test]
    fn format_quota_body_returns_chinese_not_raw() {
        // 200 + 配额纯文本：必须翻成中文，且不外泄英文原文
        let msg = format_pexels_http_error(
            reqwest::StatusCode::OK,
            "The quota has been exceeded.",
            "视频搜索",
        );
        assert!(msg.contains("配额"), "应翻成中文配额提示：{msg}");
        assert!(
            !msg.contains("The quota has been exceeded."),
            "不应外泄英文原文：{msg}"
        );
    }

    #[test]
    fn format_429_returns_chinese() {
        let msg = format_pexels_http_error(
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            "",
            "图片搜索",
        );
        assert!(msg.contains("配额"), "{msg}");
    }
}

#[derive(Debug, Deserialize)]
struct PexelsVideoResponse {
    videos: Vec<PexelsVideo>,
    page: u32,
    per_page: u32,
    total_results: u32,
}

#[derive(Debug, Deserialize)]
struct PexelsVideo {
    id: u64,
    width: u32,
    height: u32,
    duration: f64,
    image: Option<String>,
    /// Pexels 素材页 URL（署名/跳转用）
    url: String,
    user: Option<PexelsUser>,
    video_files: Vec<PexelsVideoFile>,
}

#[derive(Debug, Deserialize)]
struct PexelsUser {
    name: Option<String>,
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PexelsVideoFile {
    quality: Option<String>,
    file_type: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    link: String,
}

pub async fn search_videos(
    settings: &AppSettings,
    request: PexelsSearchRequest,
) -> anyhow::Result<PexelsSearchResult> {
    let api_key = settings.pexels_api_key.trim();
    if api_key.is_empty() {
        anyhow::bail!("请先在设置中配置 Pexels API Key");
    }

    let query = request.query.trim();
    if query.is_empty() {
        anyhow::bail!("素材关键词为空");
    }

    let orientation = match request.ratio.as_str() {
        "9:16" => "portrait",
        "16:9" => "landscape",
        _ => "square",
    };

    let per_page = request.per_page.unwrap_or(6).clamp(1, 12).to_string();
    let page = request.page.unwrap_or(1).max(1).to_string();
    let mut url = reqwest::Url::parse("https://api.pexels.com/videos/search")?;
    url.query_pairs_mut()
        .append_pair("query", query)
        .append_pair("orientation", orientation)
        .append_pair("per_page", per_page.as_str())
        .append_pair("page", page.as_str());

    let client = crate::ffmpeg::http_client();
    let response = client
        .get(url)
        .header("Authorization", api_key)
        .send()
        .await?;

    let status = response.status();
    let body = response.text().await?;
    // 配额有时用 429，有时用 200 + 纯文本 body（"The quota has been exceeded."）
    if is_pexels_quota_body(&body.to_lowercase()) {
        anyhow::bail!("{}", format_pexels_http_error(status, &body, "视频搜索"));
    }
    if !status.is_success() {
        anyhow::bail!("{}", format_pexels_http_error(status, &body, "视频搜索"));
    }

    let payload: PexelsVideoResponse = serde_json::from_str(&body).map_err(|error| {
        // 偶发把错误正文当 JSON 解析：把正文带出来
        if is_pexels_quota_body(&body.to_lowercase()) {
            return anyhow::anyhow!("{}", format_pexels_http_error(status, &body, "视频搜索"));
        }
        anyhow::anyhow!(
            "Pexels 视频搜索响应解析失败：{error}。正文：{}",
            body.chars().take(160).collect::<String>()
        )
    })?;
    let has_more = payload.page.saturating_mul(payload.per_page) < payload.total_results;
    let assets = payload
        .videos
        .into_iter()
        .filter_map(|video| video_to_source(video, request.ratio.as_str()))
        .collect();
    Ok(PexelsSearchResult {
        assets,
        page: payload.page,
        has_more,
        total_results: payload.total_results,
    })
}

fn video_to_source(video: PexelsVideo, ratio: &str) -> Option<MediaSource> {
    let file = choose_video_file(&video.video_files, ratio)?;
    let width = file.width.unwrap_or(video.width);
    let height = file.height.unwrap_or(video.height);
    let photographer = video
        .user
        .as_ref()
        .and_then(|user| user.name.as_ref())
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty());
    let photographer_url = video
        .user
        .as_ref()
        .and_then(|user| user.url.as_ref())
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty());
    let page_url = {
        let trimmed = video.url.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    };
    let title = photographer
        .as_ref()
        .map(|name| format!("Video by {name}"))
        .unwrap_or_else(|| format!("Pexels #{}", video.id));
    Some(MediaSource {
        id: format!("pexels-{}", video.id),
        kind: "video".to_string(),
        title,
        // url = 下载链接，local_path 留空，前端绑定后调用 import/cache 下载
        url: Some(file.link.clone()),
        local_path: None,
        proxy_path: None,
        proxy_status: Some("none".to_string()),
        proxy_width: None,
        proxy_height: None,
        thumbnail_url: video.image.clone(),
        width,
        height,
        duration: video.duration,
        source: "pexels".to_string(),
        photographer,
        photographer_url,
        page_url,
        ..Default::default()
    })
}

fn choose_video_file<'a>(files: &'a [PexelsVideoFile], ratio: &str) -> Option<&'a PexelsVideoFile> {
    let mut candidates = files
        .iter()
        .filter(|file| {
            file.file_type
                .as_deref()
                .map(|file_type| file_type.contains("mp4"))
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();

    candidates.sort_by_key(|file| {
        let width = file.width.unwrap_or(0);
        let height = file.height.unwrap_or(0);
        let ratio_penalty = match ratio {
            "9:16" if height >= width => 0,
            "16:9" if width >= height => 0,
            "1:1" if width.abs_diff(height) < width.max(height) / 5 => 0,
            _ => 10,
        };
        let quality_bonus = match file.quality.as_deref() {
            Some("hd") => 0,
            Some("sd") => 2,
            _ => 1,
        };
        (
            ratio_penalty,
            quality_bonus,
            std::cmp::Reverse(width.saturating_mul(height)),
        )
    });

    candidates.first().copied()
}

// ============================================================================
// Pexels 图片搜索（图片复用视频轨，作为静态画面）
// ============================================================================

#[derive(Debug, Deserialize)]
struct PexelsPhotoResponse {
    photos: Vec<PexelsPhoto>,
    page: u32,
    per_page: u32,
    total_results: u32,
}

#[derive(Debug, Deserialize)]
struct PexelsPhoto {
    id: u64,
    width: u32,
    height: u32,
    #[serde(rename = "alt")]
    alt: Option<String>,
    /// Pexels 素材页 URL
    url: Option<String>,
    photographer: Option<String>,
    photographer_url: Option<String>,
    src: PexelsPhotoSrc,
}

#[derive(Debug, Deserialize)]
struct PexelsPhotoSrc {
    large: String,
    medium: String,
}

pub async fn search_photos(
    settings: &AppSettings,
    request: PexelsSearchRequest,
) -> anyhow::Result<PexelsSearchResult> {
    let api_key = settings.pexels_api_key.trim();
    if api_key.is_empty() {
        anyhow::bail!("请先在设置中配置 Pexels API Key");
    }

    let query = request.query.trim();
    if query.is_empty() {
        anyhow::bail!("素材关键词为空");
    }

    let orientation = match request.ratio.as_str() {
        "9:16" => "portrait",
        "16:9" => "landscape",
        _ => "square",
    };

    let per_page = request.per_page.unwrap_or(6).clamp(1, 12).to_string();
    let page = request.page.unwrap_or(1).max(1).to_string();
    let mut url = reqwest::Url::parse("https://api.pexels.com/v1/search")?;
    url.query_pairs_mut()
        .append_pair("query", query)
        .append_pair("orientation", orientation)
        .append_pair("per_page", per_page.as_str())
        .append_pair("page", page.as_str());

    let client = crate::ffmpeg::http_client();
    let response = client
        .get(url)
        .header("Authorization", api_key)
        .send()
        .await?;

    let status = response.status();
    let body = response.text().await?;
    if is_pexels_quota_body(&body.to_lowercase()) {
        anyhow::bail!("{}", format_pexels_http_error(status, &body, "图片搜索"));
    }
    if !status.is_success() {
        anyhow::bail!("{}", format_pexels_http_error(status, &body, "图片搜索"));
    }

    let payload: PexelsPhotoResponse = serde_json::from_str(&body).map_err(|error| {
        if is_pexels_quota_body(&body.to_lowercase()) {
            return anyhow::anyhow!("{}", format_pexels_http_error(status, &body, "图片搜索"));
        }
        anyhow::anyhow!(
            "Pexels 图片搜索响应解析失败：{error}。正文：{}",
            body.chars().take(160).collect::<String>()
        )
    })?;
    let has_more = payload.page.saturating_mul(payload.per_page) < payload.total_results;
    let assets = payload
        .photos
        .into_iter()
        .map(|photo| photo_to_source(photo))
        .collect();
    Ok(PexelsSearchResult {
        assets,
        page: payload.page,
        has_more,
        total_results: payload.total_results,
    })
}

fn photo_to_source(photo: PexelsPhoto) -> MediaSource {
    let photographer = photo
        .photographer
        .as_ref()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty());
    let photographer_url = photo
        .photographer_url
        .as_ref()
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty());
    let page_url = photo
        .url
        .as_ref()
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty());
    let title = photo
        .alt
        .as_ref()
        .map(|alt| alt.trim().to_string())
        .filter(|alt| !alt.is_empty())
        .or_else(|| photographer.as_ref().map(|name| format!("Photo by {name}")))
        .unwrap_or_else(|| format!("Pexels #{}", photo.id));
    // 图片用 large 作为可下载源（画质与体积平衡），medium 做缩略
    MediaSource {
        id: format!("pexels-photo-{}", photo.id),
        kind: "image".to_string(),
        title,
        url: Some(photo.src.large.clone()),
        local_path: None,
        proxy_path: None,
        proxy_status: Some("none".to_string()),
        proxy_width: None,
        proxy_height: None,
        thumbnail_url: Some(photo.src.medium.clone()),
        width: photo.width,
        height: photo.height,
        duration: 0.0,
        source: "pexels".to_string(),
        photographer,
        photographer_url,
        page_url,
        ..Default::default()
    }
}
