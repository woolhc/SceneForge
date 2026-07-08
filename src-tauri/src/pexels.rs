use serde::Deserialize;

use crate::models::{AppSettings, MediaSource, PexelsSearchRequest};

#[derive(Debug, Deserialize)]
struct PexelsVideoResponse {
    videos: Vec<PexelsVideo>,
}

#[derive(Debug, Deserialize)]
struct PexelsVideo {
    id: u64,
    width: u32,
    height: u32,
    duration: f64,
    image: Option<String>,
    #[allow(dead_code)]
    url: String,
    video_files: Vec<PexelsVideoFile>,
}

#[derive(Debug, Deserialize)]
struct PexelsVideoFile {
    id: u64,
    quality: Option<String>,
    file_type: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    link: String,
}

pub async fn search_videos(
    settings: &AppSettings,
    request: PexelsSearchRequest,
) -> anyhow::Result<Vec<MediaSource>> {
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
    let mut url = reqwest::Url::parse("https://api.pexels.com/videos/search")?;
    url.query_pairs_mut()
        .append_pair("query", query)
        .append_pair("orientation", orientation)
        .append_pair("per_page", per_page.as_str());

    let client = crate::ffmpeg::http_client();
    let response = client
        .get(url)
        .header("Authorization", api_key)
        .send()
        .await?;

    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        anyhow::bail!("Pexels 搜索失败：HTTP {}", status.as_u16());
    }

    let payload: PexelsVideoResponse = serde_json::from_str(&body)?;
    let assets = payload
        .videos
        .into_iter()
        .filter_map(|video| video_to_source(video, request.ratio.as_str()))
        .collect();
    Ok(assets)
}

fn video_to_source(video: PexelsVideo, ratio: &str) -> Option<MediaSource> {
    let file = choose_video_file(&video.video_files, ratio)?;
    let width = file.width.unwrap_or(video.width);
    let height = file.height.unwrap_or(video.height);
    Some(MediaSource {
        id: format!("pexels-{}", video.id),
        kind: "video".to_string(),
        title: format!("Pexels #{}", video.id),
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
}

#[derive(Debug, Deserialize)]
struct PexelsPhoto {
    id: u64,
    width: u32,
    height: u32,
    #[serde(rename = "alt")]
    alt: Option<String>,
    src: PexelsPhotoSrc,
}

#[derive(Debug, Deserialize)]
struct PexelsPhotoSrc {
    original: String,
    large: String,
    medium: String,
    small: String,
}

pub async fn search_photos(
    settings: &AppSettings,
    request: PexelsSearchRequest,
) -> anyhow::Result<Vec<MediaSource>> {
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
    let mut url = reqwest::Url::parse("https://api.pexels.com/v1/search")?;
    url.query_pairs_mut()
        .append_pair("query", query)
        .append_pair("orientation", orientation)
        .append_pair("per_page", per_page.as_str());

    let client = crate::ffmpeg::http_client();
    let response = client
        .get(url)
        .header("Authorization", api_key)
        .send()
        .await?;

    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        anyhow::bail!("Pexels 图片搜索失败：HTTP {}", status.as_u16());
    }

    let payload: PexelsPhotoResponse = serde_json::from_str(&body)?;
    let assets = payload
        .photos
        .into_iter()
        .map(|photo| photo_to_source(photo))
        .collect();
    Ok(assets)
}

fn photo_to_source(photo: PexelsPhoto) -> MediaSource {
    // 图片用 large 作为可下载源（画质与体积平衡），medium 做缩略
    MediaSource {
        id: format!("pexels-photo-{}", photo.id),
        kind: "image".to_string(),
        title: photo.alt.unwrap_or_else(|| format!("Pexels #{}", photo.id)),
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
    }
}
