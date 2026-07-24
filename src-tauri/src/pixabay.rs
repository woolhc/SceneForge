use serde::Deserialize;

use crate::models::{AppSettings, MediaSource, PexelsSearchRequest, PexelsSearchResult};

/// 把 Pixabay HTTP 失败转成可读中文。
fn format_pixabay_http_error(status: reqwest::StatusCode, body: &str, kind: &str) -> String {
    let code = status.as_u16();
    let body_lower = body.to_lowercase();
    let body_snip = body.trim();
    let body_snip = if body_snip.len() > 180 {
        format!("{}…", &body_snip[..180])
    } else {
        body_snip.to_string()
    };

    if code == 429
        || body_lower.contains("rate limit")
        || body_lower.contains("too many requests")
        || body_lower.contains("api rate limit exceeded")
    {
        return format!(
            "Pixabay {kind}触发限流（HTTP {code}）。默认约 100 次/分钟，请稍后再试。剩余分镜可进编辑器手动选素材。"
        );
    }
    if code == 401 || code == 403 || body_lower.contains("invalid api key") {
        return format!("Pixabay API Key 无效或无权限（HTTP {code}）。请在设置中检查 Key。");
    }
    if body_snip.is_empty() {
        format!("Pixabay {kind}失败：HTTP {code}")
    } else {
        format!("Pixabay {kind}失败：HTTP {code} — {body_snip}")
    }
}

fn orientation_for_ratio(ratio: &str) -> &'static str {
    match ratio {
        "9:16" => "vertical",
        "16:9" => "horizontal",
        _ => "all",
    }
}

fn contributor_url(user: &str, user_id: u64) -> String {
    format!("https://pixabay.com/users/{user}-{user_id}/")
}

// ============================================================================
// Video search
// ============================================================================

#[derive(Debug, Deserialize)]
struct PixabayVideoResponse {
    total: u32,
    #[serde(rename = "totalHits")]
    total_hits: u32,
    hits: Vec<PixabayVideoHit>,
}

#[derive(Debug, Deserialize)]
struct PixabayVideoHit {
    id: u64,
    #[serde(rename = "pageURL")]
    page_url: Option<String>,
    tags: Option<String>,
    duration: f64,
    videos: PixabayVideoVariants,
    user: Option<String>,
    user_id: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct PixabayVideoVariants {
    large: Option<PixabayVideoFile>,
    medium: Option<PixabayVideoFile>,
    small: Option<PixabayVideoFile>,
    tiny: Option<PixabayVideoFile>,
}

#[derive(Debug, Deserialize)]
struct PixabayVideoFile {
    url: String,
    width: u32,
    height: u32,
    #[allow(dead_code)]
    size: Option<u64>,
    thumbnail: Option<String>,
}

pub async fn search_videos(
    settings: &AppSettings,
    request: PexelsSearchRequest,
) -> anyhow::Result<PexelsSearchResult> {
    let api_key = settings.pixabay_api_key.trim();
    if api_key.is_empty() {
        anyhow::bail!("请先在设置中配置 Pixabay API Key");
    }

    let query = request.query.trim();
    if query.is_empty() {
        anyhow::bail!("素材关键词为空");
    }

    let per_page = request.per_page.unwrap_or(6).clamp(3, 20).to_string();
    let page = request.page.unwrap_or(1).max(1).to_string();
    let mut url = reqwest::Url::parse("https://pixabay.com/api/videos/")?;
    url.query_pairs_mut()
        .append_pair("key", api_key)
        .append_pair("q", query)
        .append_pair("per_page", per_page.as_str())
        .append_pair("page", page.as_str())
        .append_pair("safesearch", "true")
        .append_pair("video_type", "film");

    // 视频接口无 orientation 参数；用 min_width/min_height 粗滤横竖
    match request.ratio.as_str() {
        "9:16" => {
            url.query_pairs_mut()
                .append_pair("min_width", "360")
                .append_pair("min_height", "640");
        }
        "16:9" => {
            url.query_pairs_mut()
                .append_pair("min_width", "640")
                .append_pair("min_height", "360");
        }
        _ => {}
    }

    let client = crate::ffmpeg::http_client();
    let response = client.get(url).send().await?;
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        anyhow::bail!("{}", format_pixabay_http_error(status, &body, "视频搜索"));
    }

    let payload: PixabayVideoResponse = serde_json::from_str(&body).map_err(|error| {
        anyhow::anyhow!(
            "Pixabay 视频搜索响应解析失败：{error}。正文：{}",
            body.chars().take(160).collect::<String>()
        )
    })?;

    let page_num = request.page.unwrap_or(1).max(1);
    let per_page_num = request.per_page.unwrap_or(6).clamp(3, 20) as u32;
    let has_more = page_num.saturating_mul(per_page_num) < payload.total_hits.max(payload.total);
    let assets = payload
        .hits
        .into_iter()
        .filter_map(|hit| video_to_source(hit, request.ratio.as_str()))
        .collect();

    Ok(PexelsSearchResult {
        assets,
        page: page_num,
        has_more,
        total_results: payload.total_hits.max(payload.total),
    })
}

fn pick_video_file<'a>(
    variants: &'a PixabayVideoVariants,
    ratio: &str,
) -> Option<&'a PixabayVideoFile> {
    let candidates: Vec<&PixabayVideoFile> = [
        variants.large.as_ref(),
        variants.medium.as_ref(),
        variants.small.as_ref(),
        variants.tiny.as_ref(),
    ]
    .into_iter()
    .flatten()
    .filter(|file| !file.url.trim().is_empty() && file.width > 0 && file.height > 0)
    .collect();

    if candidates.is_empty() {
        return None;
    }

    let mut ranked = candidates;
    ranked.sort_by_key(|file| {
        let ratio_penalty = match ratio {
            "9:16" if file.height >= file.width => 0,
            "16:9" if file.width >= file.height => 0,
            "1:1" if file.width.abs_diff(file.height) < file.width.max(file.height) / 5 => 0,
            _ => 10,
        };
        // 优先 medium/large 画质，再按像素面积
        let size_bonus = match (file.width, file.height) {
            (w, h) if w >= 1920 || h >= 1080 => 0,
            (w, h) if w >= 1280 || h >= 720 => 1,
            _ => 3,
        };
        (
            ratio_penalty,
            size_bonus,
            std::cmp::Reverse(file.width.saturating_mul(file.height)),
        )
    });
    ranked.first().copied()
}

fn video_to_source(hit: PixabayVideoHit, ratio: &str) -> Option<MediaSource> {
    let file = pick_video_file(&hit.videos, ratio)?;
    let user = hit.user.unwrap_or_else(|| "Pixabay".to_string());
    let user_id = hit.user_id.unwrap_or(0);
    let title = hit
        .tags
        .as_deref()
        .map(|tags| {
            let first = tags.split(',').next().unwrap_or(tags).trim();
            if first.is_empty() {
                format!("Video by {user}")
            } else {
                format!("{first} · Video by {user}")
            }
        })
        .unwrap_or_else(|| format!("Video by {user}"));

    let thumbnail = [
        hit.videos.medium.as_ref().and_then(|f| f.thumbnail.clone()),
        hit.videos.large.as_ref().and_then(|f| f.thumbnail.clone()),
        hit.videos.small.as_ref().and_then(|f| f.thumbnail.clone()),
        hit.videos.tiny.as_ref().and_then(|f| f.thumbnail.clone()),
    ]
    .into_iter()
    .flatten()
    .find(|url| !url.is_empty());

    Some(MediaSource {
        id: format!("pixabay-{}", hit.id),
        kind: "video".to_string(),
        title,
        url: Some(file.url.clone()),
        local_path: None,
        proxy_path: None,
        proxy_status: Some("none".to_string()),
        proxy_width: None,
        proxy_height: None,
        thumbnail_url: thumbnail,
        width: file.width,
        height: file.height,
        duration: hit.duration,
        source: "pixabay".to_string(),
        photographer: Some(user.clone()),
        photographer_url: Some(contributor_url(&user, user_id)),
        page_url: hit.page_url,
        ..Default::default()
    })
}

// ============================================================================
// Photo search
// ============================================================================

#[derive(Debug, Deserialize)]
struct PixabayPhotoResponse {
    total: u32,
    #[serde(rename = "totalHits")]
    total_hits: u32,
    hits: Vec<PixabayPhotoHit>,
}

#[derive(Debug, Deserialize)]
struct PixabayPhotoHit {
    id: u64,
    #[serde(rename = "pageURL")]
    page_url: Option<String>,
    tags: Option<String>,
    #[serde(rename = "previewURL")]
    preview_url: Option<String>,
    #[serde(rename = "webformatURL")]
    webformat_url: Option<String>,
    #[serde(rename = "largeImageURL")]
    large_image_url: Option<String>,
    #[serde(rename = "imageWidth")]
    image_width: Option<u32>,
    #[serde(rename = "imageHeight")]
    image_height: Option<u32>,
    #[serde(rename = "webformatWidth")]
    webformat_width: Option<u32>,
    #[serde(rename = "webformatHeight")]
    webformat_height: Option<u32>,
    user: Option<String>,
    user_id: Option<u64>,
}

pub async fn search_photos(
    settings: &AppSettings,
    request: PexelsSearchRequest,
) -> anyhow::Result<PexelsSearchResult> {
    let api_key = settings.pixabay_api_key.trim();
    if api_key.is_empty() {
        anyhow::bail!("请先在设置中配置 Pixabay API Key");
    }

    let query = request.query.trim();
    if query.is_empty() {
        anyhow::bail!("素材关键词为空");
    }

    let per_page = request.per_page.unwrap_or(6).clamp(3, 20).to_string();
    let page = request.page.unwrap_or(1).max(1).to_string();
    let orientation = orientation_for_ratio(request.ratio.as_str());
    let mut url = reqwest::Url::parse("https://pixabay.com/api/")?;
    url.query_pairs_mut()
        .append_pair("key", api_key)
        .append_pair("q", query)
        .append_pair("image_type", "photo")
        .append_pair("orientation", orientation)
        .append_pair("per_page", per_page.as_str())
        .append_pair("page", page.as_str())
        .append_pair("safesearch", "true");

    let client = crate::ffmpeg::http_client();
    let response = client.get(url).send().await?;
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        anyhow::bail!("{}", format_pixabay_http_error(status, &body, "图片搜索"));
    }

    let payload: PixabayPhotoResponse = serde_json::from_str(&body).map_err(|error| {
        anyhow::anyhow!(
            "Pixabay 图片搜索响应解析失败：{error}。正文：{}",
            body.chars().take(160).collect::<String>()
        )
    })?;

    let page_num = request.page.unwrap_or(1).max(1);
    let per_page_num = request.per_page.unwrap_or(6).clamp(3, 20) as u32;
    let has_more = page_num.saturating_mul(per_page_num) < payload.total_hits.max(payload.total);
    let assets = payload
        .hits
        .into_iter()
        .filter_map(photo_to_source)
        .collect();

    Ok(PexelsSearchResult {
        assets,
        page: page_num,
        has_more,
        total_results: payload.total_hits.max(payload.total),
    })
}

fn photo_to_source(hit: PixabayPhotoHit) -> Option<MediaSource> {
    let download = hit
        .large_image_url
        .clone()
        .or_else(|| hit.webformat_url.clone())
        .filter(|url| !url.trim().is_empty())?;
    let user = hit.user.unwrap_or_else(|| "Pixabay".to_string());
    let user_id = hit.user_id.unwrap_or(0);
    let width = hit
        .image_width
        .or(hit.webformat_width)
        .unwrap_or(1280)
        .max(1);
    let height = hit
        .image_height
        .or(hit.webformat_height)
        .unwrap_or(720)
        .max(1);
    let title = hit
        .tags
        .as_deref()
        .map(|tags| {
            let first = tags.split(',').next().unwrap_or(tags).trim();
            if first.is_empty() {
                format!("Photo by {user}")
            } else {
                format!("{first} · Photo by {user}")
            }
        })
        .unwrap_or_else(|| format!("Photo by {user}"));

    Some(MediaSource {
        id: format!("pixabay-photo-{}", hit.id),
        kind: "image".to_string(),
        title,
        url: Some(download),
        local_path: None,
        proxy_path: None,
        proxy_status: Some("none".to_string()),
        proxy_width: None,
        proxy_height: None,
        thumbnail_url: hit.preview_url.or(hit.webformat_url),
        width,
        height,
        duration: 0.0,
        source: "pixabay".to_string(),
        photographer: Some(user.clone()),
        photographer_url: Some(contributor_url(&user, user_id)),
        page_url: hit.page_url,
        ..Default::default()
    })
}
