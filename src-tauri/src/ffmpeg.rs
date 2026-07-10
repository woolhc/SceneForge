use std::path::{Path, PathBuf};
use std::process::Output;
use std::sync::OnceLock;
use std::time::Duration;

use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;

/// 按 codec 缓存的编码器名称（首次检测后缓存）
static H264_ENCODER: OnceLock<String> = OnceLock::new();
static HEVC_ENCODER: OnceLock<String> = OnceLock::new();
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

use crate::models::{Clip, FfmpegStatus, MediaSource, Project, TrackKind};
use crate::ffmpeg_expression::{
    compile_keyframe_expression, compile_opacity_alpha_filter,
    compile_static_opacity_filter,
};
use crate::render_graph::compile_render_graph;
use crate::render_plan::{
    clips_for_indices, compile_render_plan, RenderUnit as PlannedRenderUnit,
};
use crate::source_window::{compile_source_window, SourceWindowPart};

fn apply_source_window_filter(mut filter: String, part: &SourceWindowPart) -> String {
    if part.reverse {
        filter.push_str(",reverse");
    }
    if (part.speed - 1.0).abs() > f64::EPSILON {
        filter.push_str(&format!(
            ",setpts={:.6}*(PTS-STARTPTS)",
            1.0 / part.speed
        ));
    } else {
        filter.push_str(",setpts=PTS-STARTPTS");
    }
    filter
}

fn compile_multi_part_source_filter(
    input_index: usize,
    parts: &[SourceWindowPart],
) -> Option<(String, String)> {
    if parts.len() <= 1 {
        return None;
    }
    let input_labels = (0..parts.len())
        .map(|part_index| format!("[src{input_index}in{part_index}]"))
        .collect::<String>();
    let mut filter = format!("[{input_index}:v]split={}{input_labels};", parts.len());
    for (part_index, part) in parts.iter().enumerate() {
        let part_filter = apply_source_window_filter(
            format!(
                "trim=start={:.6}:end={:.6}",
                part.source_start, part.source_end
            ),
            part,
        );
        filter.push_str(&format!(
            "[src{input_index}in{part_index}]{part_filter}[src{input_index}part{part_index}];"
        ));
    }
    let part_labels = (0..parts.len())
        .map(|part_index| format!("[src{input_index}part{part_index}]"))
        .collect::<String>();
    let output_label = format!("[src{input_index}]");
    filter.push_str(&format!(
        "{part_labels}concat=n={}:v=1:a=0{output_label};",
        parts.len()
    ));
    Some((filter, output_label))
}

pub async fn run_with_timeout(cmd: &mut Command, secs: u64) -> anyhow::Result<Output> {
    cmd.kill_on_drop(true);
    match timeout(Duration::from_secs(secs), cmd.output()).await {
        Ok(result) => Ok(result?),
        Err(_) => anyhow::bail!("命令执行超时（{}s）", secs),
    }
}

async fn run_with_timeout_and_cancel(
    cmd: &mut Command,
    secs: u64,
    cancel_flag: Option<&std::sync::atomic::AtomicBool>,
) -> anyhow::Result<Output> {
    cmd.kill_on_drop(true);
    let output = cmd.output();
    tokio::pin!(output);
    let deadline = tokio::time::sleep(Duration::from_secs(secs));
    tokio::pin!(deadline);
    let cancel = async {
        loop {
            if let Some(flag) = cancel_flag {
                if flag.load(std::sync::atomic::Ordering::Relaxed) {
                    break;
                }
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    };
    tokio::pin!(cancel);

    tokio::select! {
        result = &mut output => Ok(result?),
        _ = &mut deadline => anyhow::bail!("命令执行超时（{}s）", secs),
        _ = &mut cancel, if cancel_flag.is_some() => anyhow::bail!("渲染已取消"),
    }
}

fn check_cancel(cancel_flag: Option<&std::sync::atomic::AtomicBool>) -> anyhow::Result<()> {
    if let Some(flag) = cancel_flag {
        if flag.load(std::sync::atomic::Ordering::Relaxed) {
            anyhow::bail!("渲染已取消");
        }
    }
    Ok(())
}

pub fn http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            .build()
            .expect("failed to build reqwest client")
    })
}

pub fn collect_mix_audio_clips(project: &Project) -> Vec<&Clip> {
    let mut audio_clips: Vec<&Clip> = project
        .clips
        .iter()
        .filter(|clip| {
            if clip.volume <= 0.0 {
                return false;
            }
            let Some(track) = project.tracks.iter().find(|t| t.id == clip.track_id) else {
                return false;
            };
            if track.muted || track.hidden {
                return false;
            }
            match track.kind {
                TrackKind::Voiceover | TrackKind::Audio | TrackKind::Video => {}
                TrackKind::Image | TrackKind::Subtitle => return false,
            }
            let Some(source_id) = &clip.source_id else {
                return false;
            };
            let Some(media) = project.media.iter().find(|m| m.id == *source_id) else {
                return false;
            };
            media.kind != "image"
        })
        .collect();
    audio_clips.sort_by(|a, b| {
        a.start_on_track
            .partial_cmp(&b.start_on_track)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    audio_clips
}

#[cfg(test)]
fn project_output_duration(project: &Project) -> f64 {
    let visible_track_ids: std::collections::HashSet<&str> = project
        .tracks
        .iter()
        .filter(|track| !track.hidden)
        .map(|track| track.id.as_str())
        .collect();
    project
        .clips
        .iter()
        .filter(|clip| visible_track_ids.contains(clip.track_id.as_str()))
        .map(|clip| clip.start_on_track + clip.duration.max(0.0))
        .fold(0.0_f64, f64::max)
}

pub async fn check_ffmpeg() -> FfmpegStatus {
    match Command::new("ffmpeg").arg("-version").output().await {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let version = stdout.lines().next().map(|line| line.to_string());
            FfmpegStatus {
                available: true,
                version,
                path: Some("ffmpeg".to_string()),
                error: None,
            }
        }
        Ok(output) => FfmpegStatus {
            available: false,
            version: None,
            path: Some("ffmpeg".to_string()),
            error: Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        },
        Err(error) => FfmpegStatus {
            available: false,
            version: None,
            path: None,
            error: Some(error.to_string()),
        },
    }
}

/// 检测可用的硬件编码器（GPU 加速），按目标 codec 分开探测。
pub async fn detect_hw_encoder(codec: &str) -> String {
    let (candidates, fallback): (&[&str], &str) = if codec == "hevc" {
        (
            &["hevc_videotoolbox", "hevc_nvenc", "hevc_qsv", "hevc_vaapi"],
            "libx265",
        )
    } else {
        (
            &["h264_videotoolbox", "h264_nvenc", "h264_qsv", "h264_vaapi"],
            "libx264",
        )
    };
    // M15: -encoders 只跑一次（之前循环内重复跑）
    let encoders_text = match Command::new("ffmpeg")
        .args(["-hide_banner", "-encoders"])
        .output()
        .await
    {
        Ok(out) => String::from_utf8_lossy(&out.stdout).to_string(),
        Err(_) => return fallback.to_string(),
    };
    for &encoder in candidates {
        if !encoders_text.contains(encoder) {
            continue;
        }
        // 验证能否真正工作（快速测试编码）
        let test = Command::new("ffmpeg")
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=64x64:d=0.1",
                "-c:v",
                encoder,
                "-f",
                "null",
                "-",
            ])
            .output()
            .await;
        if let Ok(t) = test {
            if t.status.success() {
                return encoder.to_string();
            }
        }
    }
    fallback.to_string()
}

pub async fn pick_encoder(codec: &str) -> String {
    if codec == "hevc" {
        if let Some(encoder) = HEVC_ENCODER.get() {
            return encoder.clone();
        }
        let encoder = detect_hw_encoder("hevc").await;
        let _ = HEVC_ENCODER.set(encoder.clone());
        return encoder;
    }
    if let Some(encoder) = H264_ENCODER.get() {
        return encoder.clone();
    }
    let encoder = detect_hw_encoder("h264").await;
    let _ = H264_ENCODER.set(encoder.clone());
    encoder
}

/// 根据编码器返回 (encoder_name, extra_args)。
/// 硬件编码器不需要 preset，需要 bitrate 控制。
/// codec: "h264"（默认）| "hevc"（T4.10）
pub fn encoder_args(
    encoder: &str,
    preview: bool,
    bitrate_mbps: Option<u32>,
) -> (String, Vec<String>) {
    let configured_bitrate = bitrate_mbps.filter(|b| *b > 0).map(|b| format!("{b}M"));
    match encoder {
        "h264_videotoolbox" | "h264_nvenc" | "h264_qsv" | "h264_vaapi" => {
            let bitrate =
                configured_bitrate.unwrap_or_else(|| if preview { "2M" } else { "8M" }.to_string());
            (encoder.to_string(), vec!["-b:v".to_string(), bitrate])
        }
        "hevc_videotoolbox" | "hevc_nvenc" | "hevc_qsv" | "hevc_vaapi" => {
            // T4.10: HEVC 硬件编码
            let bitrate =
                configured_bitrate.unwrap_or_else(|| if preview { "2M" } else { "6M" }.to_string());
            (encoder.to_string(), vec!["-b:v".to_string(), bitrate])
        }
        "libx265" => {
            let preset = if preview { "ultrafast" } else { "medium" };
            let crf = if preview { "30" } else { "26" };
            let mut args = vec![
                "-preset".to_string(),
                preset.to_string(),
                "-crf".to_string(),
                crf.to_string(),
            ];
            if let Some(bitrate) = configured_bitrate {
                let bufsize = format!(
                    "{}M",
                    bitrate
                        .trim_end_matches('M')
                        .parse::<u32>()
                        .unwrap_or(0)
                        .saturating_mul(2)
                );
                args.extend([
                    "-maxrate".to_string(),
                    bitrate,
                    "-bufsize".to_string(),
                    bufsize,
                ]);
            }
            (encoder.to_string(), args)
        }
        _ => {
            // H.264 软编
            let preset = if preview { "ultrafast" } else { "veryfast" };
            let crf = if preview { "30" } else { "23" };
            let mut args = vec![
                "-preset".to_string(),
                preset.to_string(),
                "-crf".to_string(),
                crf.to_string(),
            ];
            if let Some(bitrate) = configured_bitrate {
                let bufsize = format!(
                    "{}M",
                    bitrate
                        .trim_end_matches('M')
                        .parse::<u32>()
                        .unwrap_or(0)
                        .saturating_mul(2)
                );
                args.extend([
                    "-maxrate".to_string(),
                    bitrate,
                    "-bufsize".to_string(),
                    bufsize,
                ]);
            }
            ("libx264".to_string(), args)
        }
    }
}

/// 把素材下载 / 缓存到 app 数据目录，返回本地路径。
/// 兼容：本地路径（已是本地则直接返回）、远程 url（下载）。
pub async fn ensure_media_local(cache_dir: &Path, source: &MediaSource) -> anyhow::Result<PathBuf> {
    // 已有本地路径且存在
    if let Some(local) = source.local_path.as_deref() {
        let path = PathBuf::from(local);
        if path.is_file() {
            return Ok(path);
        }
    }
    // 远程下载
    let url = source
        .url
        .as_deref()
        .filter(|url| url.starts_with("http://") || url.starts_with("https://"))
        .ok_or_else(|| anyhow::anyhow!("素材既没有本地文件也没有可下载地址"))?;

    let video_dir = cache_dir.join("media");
    tokio::fs::create_dir_all(&video_dir).await?;
    let ext = url_ext(url).unwrap_or_else(|| "mp4".to_string());
    let output_path = video_dir.join(format!("{}.{}", sanitize_file_stem(&source.id), ext));
    if !output_path.exists() || output_path.metadata().map(|m| m.len()).unwrap_or(0) == 0 {
        let response = http_client().get(url).send().await?.error_for_status()?;
        let mut stream = response.bytes_stream();
        let mut file = tokio::fs::File::create(&output_path).await?;
        while let Some(chunk) = stream.next().await {
            file.write_all(&chunk?).await?;
        }
        file.flush().await?;
    }
    Ok(output_path)
}

/// 从视频文件提取音轨，返回 wav 路径
pub async fn extract_audio_from_video(
    cache_dir: &Path,
    video_path: &Path,
) -> anyhow::Result<PathBuf> {
    let audio_dir = cache_dir.join("extracted-audio");
    tokio::fs::create_dir_all(&audio_dir).await?;
    let stem = video_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("audio");
    let output_path = audio_dir.join(format!(
        "{}-{}.wav",
        stem,
        chrono::Utc::now().timestamp_millis()
    ));

    let output = Command::new("ffmpeg")
        .args([
            "-y",
            "-i",
            &video_path.to_string_lossy(),
            "-vn", // 不要视频
            "-acodec",
            "pcm_s16le", // wav 格式
            "-ar",
            "44100",
            "-ac",
            "2",
            &output_path.to_string_lossy(),
        ])
        .output()
        .await?;

    if !output.status.success() {
        anyhow::bail!(
            "提取音频失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(output_path)
}

/// 分离人声：返回 (人声路径, 伴奏路径)
/// 优先用 audio-separator（高质量），未安装则用 FFmpeg 相位消除（快速但质量一般）
pub async fn separate_vocals(
    cache_dir: &Path,
    audio_path: &Path,
) -> anyhow::Result<(PathBuf, PathBuf)> {
    let out_dir = cache_dir.join("vocal-separation");
    tokio::fs::create_dir_all(&out_dir).await?;
    let stem = audio_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("audio");
    let timestamp = chrono::Utc::now().timestamp_millis();

    // 尝试 audio-separator（高质量，需要 pip install audio-separator）
    let separator_check = Command::new("audio-separator")
        .arg("--version")
        .output()
        .await;
    if separator_check.is_ok() && separator_check.unwrap().status.success() {
        let output = Command::new("audio-separator")
            .args([
                &audio_path.to_string_lossy(),
                "--two_stems",
                "vocals",
                "-o",
                &out_dir.to_string_lossy(),
            ])
            .output()
            .await;
        if let Ok(out) = output {
            if out.status.success() {
                // audio-separator 输出：<stem>_vocals.wav 和 <stem>_instrumental.wav
                let vocals = out_dir.join(format!("{}_vocals.wav", stem));
                let instrumental = out_dir.join(format!("{}_instrumental.wav", stem));
                if vocals.exists() && instrumental.exists() {
                    return Ok((vocals, instrumental));
                }
            }
        }
    }

    // 回退：FFmpeg 相位消除（快速，质量一般）
    // 人声通常在立体声中心，左右相减可消除中心内容（得到伴奏）
    // 反之，左右相加增强中心（得到人声近似）
    let vocals_path = out_dir.join(format!("{}_vocals_{}.wav", stem, timestamp));
    let instrumental_path = out_dir.join(format!("{}_instrumental_{}.wav", stem, timestamp));

    // 人声近似：提取中置声道（L+R 的和）
    let vocals_out = Command::new("ffmpeg")
        .args([
            "-y",
            "-i",
            &audio_path.to_string_lossy(),
            "-af",
            "pan=mono|c0=0.5*FL+0.5*FR", // 左右相加 = 中置（人声）
            "-ar",
            "44100",
            &vocals_path.to_string_lossy(),
        ])
        .output()
        .await?;
    if !vocals_out.status.success() {
        anyhow::bail!(
            "人声分离失败（FFmpeg）：{}",
            String::from_utf8_lossy(&vocals_out.stderr).trim()
        );
    }

    // 伴奏近似：左右相减消除中置（人声）
    let inst_out = Command::new("ffmpeg")
        .args([
            "-y",
            "-i",
            &audio_path.to_string_lossy(),
            "-af",
            "pan=stereo|c0=c0-c1|c1=c1-c0", // 左右相减 = 消除中置
            "-ar",
            "44100",
            &instrumental_path.to_string_lossy(),
        ])
        .output()
        .await?;
    if !inst_out.status.success() {
        anyhow::bail!(
            "伴奏分离失败（FFmpeg）：{}",
            String::from_utf8_lossy(&inst_out.stderr).trim()
        );
    }

    Ok((vocals_path, instrumental_path))
}

fn url_ext(url: &str) -> Option<String> {
    let path = url.split('?').next().unwrap_or(url);
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
}

/// 给任意本地媒体文件抽一帧做缩略图。
pub async fn generate_thumbnail(
    cache_dir: &Path,
    source_path: &Path,
    at: f64,
) -> anyhow::Result<PathBuf> {
    let thumb_dir = cache_dir.join("thumbnails");
    tokio::fs::create_dir_all(&thumb_dir).await?;
    let stem = source_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("media");
    let id = format!("{}-{}", sanitize_file_stem(stem), (at * 1000.0) as u64);
    let output_path = thumb_dir.join(format!("{}.jpg", id));
    if output_path.exists() {
        return Ok(output_path);
    }
    let output = Command::new("ffmpeg")
        .args([
            "-y",
            "-ss",
            &format!("{:.3}", at.max(0.0)),
            "-i",
            &source_path.to_string_lossy(),
            "-frames:v",
            "1",
            "-vf",
            "scale=480:-1",
            "-q:v",
            "4",
            &output_path.to_string_lossy(),
        ])
        .output()
        .await?;
    if !output.status.success() {
        anyhow::bail!(
            "缩略图生成失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(output_path)
}

/// 生成预览代理视频：长边不超过 960px，H.264，短 GOP，方便时间线 seek。
/// 导出仍使用原始 local_path/url；代理只给前端预览读取。
pub async fn generate_proxy_video(
    cache_dir: &Path,
    source_path: &Path,
    media_id: &str,
) -> anyhow::Result<(PathBuf, u32, u32)> {
    let proxy_dir = cache_dir.join("proxies");
    tokio::fs::create_dir_all(&proxy_dir).await?;
    let proxy_path = proxy_dir.join(format!("{media_id}-proxy-v2.mp4"));
    if proxy_path.exists() {
        let (w, h) = probe_video_resolution_public(&proxy_path)
            .await
            .unwrap_or((0, 0));
        return Ok((proxy_path, w, h));
    }

    let scale = "scale='if(gte(iw,ih),min(960,iw),-2)':'if(gte(iw,ih),-2,min(960,ih))'";
    let mut cmd = Command::new("ffmpeg");
    cmd.args([
        "-y",
        "-i",
        &source_path.to_string_lossy(),
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-vf",
        scale,
        "-r",
        "30",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-threads",
        "2",
        "-g",
        "30",
        "-keyint_min",
        "30",
        "-sc_threshold",
        "0",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-movflags",
        "+faststart",
        &proxy_path.to_string_lossy(),
    ]);
    let output = run_with_timeout(&mut cmd, 1800).await?;
    if !output.status.success() {
        anyhow::bail!(
            "生成代理视频失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }

    let (w, h) = probe_video_resolution_public(&proxy_path)
        .await
        .unwrap_or((0, 0));
    Ok((proxy_path, w, h))
}

async fn probe_video_resolution_public(path: &Path) -> anyhow::Result<(u32, u32)> {
    let mut cmd = Command::new("ffprobe");
    cmd.args([
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=s=x:p=0",
        &path.to_string_lossy(),
    ]);
    let output = run_with_timeout(&mut cmd, 30).await?;
    if !output.status.success() {
        anyhow::bail!("ffprobe 无视频流");
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parts: Vec<&str> = text.split('x').collect();
    if parts.len() != 2 {
        anyhow::bail!("解析代理分辨率失败");
    }
    Ok((parts[0].parse()?, parts[1].parse()?))
}

/// T4.7: 生成视频胶片条缩略图（均匀取 count 帧，输出到缓存目录）。
/// 返回每帧的本地路径列表（前端用 asset 协议加载）。
pub async fn generate_filmstrip(
    cache_dir: &Path,
    source_path: &Path,
    source_in: f64,
    source_out: f64,
    count: usize,
) -> anyhow::Result<Vec<PathBuf>> {
    let filmstrip_dir = cache_dir.join("filmstrip");
    tokio::fs::create_dir_all(&filmstrip_dir).await?;
    let stem = source_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("media");
    let dur = (source_out - source_in).max(0.1);
    let mut paths = Vec::with_capacity(count);
    for i in 0..count {
        // 均匀分布的取帧时间点（避免首尾边界）
        let t = source_in + dur * (i as f64 + 0.5) / count as f64;
        let id = format!("{}-{}-{}", sanitize_file_stem(stem), (t * 1000.0) as u64, i);
        let output_path = filmstrip_dir.join(format!("{}.jpg", id));
        if !output_path.exists() {
            let output = Command::new("ffmpeg")
                .args([
                    "-y",
                    "-ss",
                    &format!("{:.3}", t.max(0.0)),
                    "-i",
                    &source_path.to_string_lossy(),
                    "-frames:v",
                    "1",
                    "-vf",
                    "scale=160:-1", // 胶片条帧宽 160px（高度按比例）
                    "-q:v",
                    "5",
                    &output_path.to_string_lossy(),
                ])
                .output()
                .await?;
            if !output.status.success() {
                // 单帧失败不阻塞，跳过
                continue;
            }
        }
        paths.push(output_path);
    }
    Ok(paths)
}

/// 生成音频波形数据：解码为低采样率 PCM → 计算 min/max 峰值对。
/// 返回 Vec<(min, max)>，每对代表一个时间桶的振幅范围。
pub async fn generate_waveform(
    audio_path: &Path,
    samples_per_second: u32,
) -> anyhow::Result<Vec<(f32, f32)>> {
    // M16: 降采样到 8000Hz（波形显示不需要 CD 质量），大幅减少内存占用
    let sample_rate = 8000u32;
    let output = Command::new("ffmpeg")
        .args([
            "-y",
            "-i",
            &audio_path.to_string_lossy(),
            "-ac",
            "1", // 单声道
            "-ar",
            &sample_rate.to_string(),
            "-f",
            "f32le",  // 32-bit float little-endian PCM
            "pipe:1", // 输出到 stdout
        ])
        .output()
        .await?;

    if !output.status.success() {
        anyhow::bail!(
            "波形生成失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }

    // 解析 PCM 数据
    let pcm = output.stdout;
    if pcm.len() < 4 {
        return Ok(vec![]);
    }
    let samples: Vec<f32> = pcm
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect();

    // 高分辨率桶：每秒 200 个峰值（比之前 100 精细 2 倍）
    let target_per_second = samples_per_second.max(200);
    let bucket_size = (sample_rate / target_per_second).max(1) as usize;
    let mut peaks: Vec<(f32, f32)> = Vec::new();
    for chunk in samples.chunks(bucket_size) {
        let min = chunk.iter().cloned().fold(f32::INFINITY, f32::min);
        let max = chunk.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        peaks.push((min, max));
    }
    Ok(peaks)
}

/// 渲染整个项目为单个 mp4，支持多视频轨叠加（画中画）。
///
/// 算法：时间段切片 + overlay 叠加
/// 1. 收集所有视频轨 clip，按轨道 order 分层（order 大=底层，order 小=上层覆盖）
/// 2. 把时间轴按所有 clip 的起止边界切成若干"段"，每段内活跃 clip 集合固定
/// 3. 每段：渲染每个活跃 clip 的画面流（含变换），再用 overlay 链按层叠加
/// 4. concat 所有段 → 输出
pub async fn render_project_video(
    cache_dir: &Path,
    projects_dir: &Path,
    project: &Project,
    preview: bool,
    // T3.3: 进度回调 (percent 0-100, phase 文案)，需 Send + Sync 以跨 await
    progress_cb: Option<&(dyn Fn(u32, &str) + Send + Sync)>,
    // T3.3: 取消标志（为 true 时中断渲染）
    cancel_flag: Option<&std::sync::atomic::AtomicBool>,
) -> anyhow::Result<PathBuf> {
    // T4.10: 根据用户选的 codec（h264/hevc）决定编码器。
    let encoder = pick_encoder(&project.render_config.codec).await;
    eprintln!("使用编码器: {encoder}");

    // 统一计算目标尺寸：preview 用 540p 短边，导出用 renderConfig.resolution
    // 保证所有段 + 字幕坐标系 + xfade 合并全部使用同一组尺寸
    let (target_w, target_h) = if preview {
        dimensions_for_ratio(&project.ratio, true)
    } else {
        export_dimensions_for_project(project)
    };

    let render_graph = compile_render_graph(project);
    let render_plan = compile_render_plan(
        &render_graph,
        project.render_config.transition_duration.max(0.1),
    );
    if render_plan.visual_layer_indices.is_empty() {
        anyhow::bail!("时间线上没有视频片段");
    }
    let total_duration = render_plan.duration;

    if let Some(single_pass_plan) = render_plan.single_pass.as_ref() {
        let single_pass_graph = SinglePassVideoGraph {
            base_clips: clips_for_indices(&render_graph, &single_pass_plan.base_layer_indices),
            overlay_clips: clips_for_indices(
                &render_graph,
                &single_pass_plan.overlay_layer_indices,
            ),
        };
        eprintln!(
            "渲染路径: 单遍 (base_clips={}, overlay_clips={})",
            single_pass_graph.base_clips.len(),
            single_pass_graph.overlay_clips.len()
        );
        let render_dir = projects_dir.join(&project.id).join("renders");
        tokio::fs::create_dir_all(&render_dir).await?;
        let raw_output = render_dir.join(if preview {
            "preview-raw.mp4"
        } else {
            "final-raw.mp4"
        });
        if let Some(cb) = progress_cb {
            cb(35, "正在单遍渲染视频图...");
        }
        check_cancel(cancel_flag)?;
        render_single_pass_video_graph(
            cache_dir,
            project,
            &single_pass_graph,
            &raw_output,
            preview,
            &encoder,
            target_w,
            target_h,
            cancel_flag,
        )
        .await?;

        let transition_shrink_points: Vec<(f64, f64)> = Vec::new();
        if let Some(cb) = progress_cb {
            cb(85, "正在烧录字幕和混音...");
        }
        check_cancel(cancel_flag)?;
        let result = burn_subtitle_and_mix_audio(
            cache_dir,
            projects_dir,
            project,
            &raw_output,
            preview,
            &transition_shrink_points,
            &encoder,
            cancel_flag,
        )
        .await?;
        if let Some(cb) = progress_cb {
            cb(100, "渲染完成");
        }
        return Ok(result);
    }

    // T2.5: 用 TempDirGuard 管理段渲染临时目录，函数返回时自动清理
    let render_tmp_base = std::env::temp_dir().join("scenescript-render");
    tokio::fs::create_dir_all(&render_tmp_base).await.ok();
    let segment_guard = crate::temp::TempDirGuard::new(&render_tmp_base, "segments")?;
    let segment_dir = segment_guard.path().to_path_buf();
    tokio::fs::create_dir_all(&segment_dir).await?;

    eprintln!(
        "渲染路径: 段渲染 (segments={}, total_duration={:.2}s)",
        render_plan.units.len(),
        total_duration
    );
    // 渲染每一段
    let mut segment_paths = Vec::new();
    let total_segs = render_plan.units.len();
    for (seg_index, unit) in render_plan.units.iter().enumerate() {
        check_cancel(cancel_flag)?;
        // T3.3: 段级进度（0-70% 分配给段渲染）
        if let Some(cb) = progress_cb {
            let percent = ((seg_index as f64 / total_segs.max(1) as f64) * 70.0) as u32;
            cb(percent, &format!("渲染片段 {}/{total_segs}", seg_index + 1));
        }
        let (path, render_duration, active_clips) = match unit {
            PlannedRenderUnit::Normal {
                start,
                end,
                layer_indices,
            } => {
                let render_duration = end - start;
                let active_clips = clips_for_indices(&render_graph, layer_indices);
                let path = if active_clips.is_empty() {
                    render_black_segment(
                        &segment_dir,
                        project,
                        render_duration,
                        seg_index,
                        preview,
                        &encoder,
                        target_w,
                        target_h,
                    )
                    .await?
                } else {
                    render_segment_with_overlay(
                        cache_dir,
                        &segment_dir,
                        project,
                        &active_clips,
                        *start,
                        render_duration,
                        seg_index,
                        preview,
                        &encoder,
                        target_w,
                        target_h,
                    )
                    .await?
                };
                (path, render_duration, active_clips)
            }
            PlannedRenderUnit::Transition {
                start,
                boundary,
                end,
                previous_layer_indices,
                next_layer_indices,
                transition,
            } => {
                let render_duration = end - start;
                let previous_clips = clips_for_indices(&render_graph, previous_layer_indices);
                let next_clips = clips_for_indices(&render_graph, next_layer_indices);
                let path = render_transition_unit(
                    cache_dir,
                    &segment_dir,
                    project,
                    &previous_clips,
                    &next_clips,
                    &transition.name,
                    *start,
                    *boundary,
                    render_duration,
                    seg_index,
                    preview,
                    &encoder,
                    target_w,
                    target_h,
                    cancel_flag,
                )
                .await?;
                if let Ok(meta) = tokio::fs::metadata(&path).await {
                    eprintln!(
                        "段 {seg_index:03}: 类型=transition 时长={render_duration:.2}s 大小={}KB",
                        meta.len() / 1024
                    );
                }
                segment_paths.push(path);
                continue;
            }
        };
        if active_clips.is_empty() {
            eprintln!("段 {seg_index:03}: 类型=black 时长={render_duration:.2}s（空段）");
        }
        // 诊断：记录每段输出文件大小 + ffprobe 时长
        if let Ok(meta) = tokio::fs::metadata(&path).await {
            let size_kb = meta.len() / 1024;
            let probe_dur = tokio::process::Command::new("ffprobe")
                .args([
                    "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    &path.to_string_lossy(),
                ])
                .output()
                .await
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_else(|| "?".to_string());
            eprintln!(
                "段 {seg_index:03}: 类型=overlay 时长={render_duration:.2}s 实际={probe_dur}s 大小={size_kb}KB clips={}",
                active_clips.iter().map(|c| c.id.as_str()).collect::<Vec<_>>().join(",")
            );
        }
        segment_paths.push(path);
    }

    // 转场已经渲染成独立片段，最终只需按计划顺序拼接。
    let render_dir = projects_dir.join(&project.id).join("renders");
    tokio::fs::create_dir_all(&render_dir).await?;
    let raw_output = render_dir.join(if preview {
        "preview-raw.mp4"
    } else {
        "final-raw.mp4"
    });

    check_cancel(cancel_flag)?;
    {
        // 先尝试 concat copy（快），若失败则 fallback 到 concat filter（重编码）
        // 注意：concat copy 要求所有段的编码参数（timebase/SAR/profile/pix_fmt）严格一致，
        // 不同源视频/图片/黑屏段混排时往往不一致，会导致输出"时长对但后半黑屏"。
        // 因此 fallback 路径用 concat filter 重新编码保证统一。
        let list_path = cache_dir.join(format!(
            "concat-{}-{}.txt",
            project.id,
            chrono::Utc::now().timestamp_millis()
        ));
        let list_content = segment_paths
            .iter()
            .map(|path| format!("file '{}'\n", path.to_string_lossy().replace('\'', "'\\''")))
            .collect::<String>();
        tokio::fs::write(&list_path, list_content).await?;

        // 先尝试 concat copy
        let mut cmd = Command::new("ffmpeg");
        cmd.args([
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            &list_path.to_string_lossy(),
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            &raw_output.to_string_lossy(),
        ]);
        let copy_output = run_with_timeout_and_cancel(&mut cmd, 1800, cancel_flag).await?;

        if copy_output.status.success() {
            // 验证输出时长是否接近 total_duration（容差 0.5s）
            // 若偏差过大说明 concat copy 失败，走 fallback
            let probe_ok = tokio::process::Command::new("ffprobe")
                .args([
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "default=noprint_wrappers=1:nokey=1",
                    &raw_output.to_string_lossy(),
                ])
                .output()
                .await
                .ok()
                .filter(|o| o.status.success())
                .and_then(|o| {
                    String::from_utf8_lossy(&o.stdout)
                        .trim()
                        .parse::<f64>()
                        .ok()
                });

            let duration_ok = probe_ok
                .map(|d| (d - total_duration).abs() < 0.5)
                .unwrap_or(false);

            if duration_ok {
                // concat copy 成功且时长正确，跳过 fallback
            } else {
                eprintln!(
                    "concat copy 输出时长异常（probe={:?}, 期望 {total_duration}），回退到 concat filter 重编码",
                    probe_ok
                );
                // fallback: concat filter（re-encode）
                let mut fb_args: Vec<String> = vec!["-y".to_string()];
                for p in &segment_paths {
                    fb_args.push("-i".to_string());
                    fb_args.push(p.to_string_lossy().to_string());
                }
                let concat_labels: String = (0..segment_paths.len())
                    .map(|i| format!("[{i}:v]"))
                    .collect::<String>();
                let fb_filter = format!(
                    "{concat_labels}concat=n={}:v=1:a=0[vout]",
                    segment_paths.len()
                );
                fb_args.push("-filter_complex".to_string());
                fb_args.push(fb_filter);
                fb_args.push("-map".to_string());
                fb_args.push("[vout]".to_string());
                fb_args.push("-r".to_string());
                fb_args.push(format!("{}", project.render_config.fps));
                let (fb_enc_name, fb_enc_extra) =
                    encoder_args(&encoder, preview, Some(project.render_config.bitrate_mbps));
                fb_args.push("-c:v".to_string());
                fb_args.push(fb_enc_name);
                fb_args.extend(fb_enc_extra);
                fb_args.push("-an".to_string());
                fb_args.push("-movflags".to_string());
                fb_args.push("+faststart".to_string());
                fb_args.push(raw_output.to_string_lossy().to_string());

                check_cancel(cancel_flag)?;
                let mut fb_cmd = Command::new("ffmpeg");
                fb_cmd.args(&fb_args);
                let fb_output =
                    run_with_timeout_and_cancel(&mut fb_cmd, 1800, cancel_flag).await?;
                if !fb_output.status.success() {
                    anyhow::bail!(
                        "concat filter 重编码失败：{}",
                        String::from_utf8_lossy(&fb_output.stderr).trim()
                    );
                }
            }
        } else {
            // concat copy 直接失败，走 fallback
            eprintln!(
                "concat copy 失败，回退到 concat filter 重编码：{}",
                String::from_utf8_lossy(&copy_output.stderr).trim()
            );
            let mut fb_args: Vec<String> = vec!["-y".to_string()];
            for p in &segment_paths {
                fb_args.push("-i".to_string());
                fb_args.push(p.to_string_lossy().to_string());
            }
            let concat_labels: String = (0..segment_paths.len())
                .map(|i| format!("[{i}:v]"))
                .collect::<String>();
            let fb_filter = format!(
                "{concat_labels}concat=n={}:v=1:a=0[vout]",
                segment_paths.len()
            );
            fb_args.push("-filter_complex".to_string());
            fb_args.push(fb_filter);
            fb_args.push("-map".to_string());
            fb_args.push("[vout]".to_string());
            fb_args.push("-r".to_string());
            fb_args.push(format!("{}", project.render_config.fps));
            let (fb_enc_name, fb_enc_extra) =
                encoder_args(&encoder, preview, Some(project.render_config.bitrate_mbps));
            fb_args.push("-c:v".to_string());
            fb_args.push(fb_enc_name);
            fb_args.extend(fb_enc_extra);
            fb_args.push("-an".to_string());
            fb_args.push("-movflags".to_string());
            fb_args.push("+faststart".to_string());
            fb_args.push(raw_output.to_string_lossy().to_string());

            check_cancel(cancel_flag)?;
            let mut fb_cmd = Command::new("ffmpeg");
            fb_cmd.args(&fb_args);
            let fb_output =
                run_with_timeout_and_cancel(&mut fb_cmd, 1800, cancel_flag).await?;
            if !fb_output.status.success() {
                anyhow::bail!(
                    "concat filter 重编码失败：{}",
                    String::from_utf8_lossy(&fb_output.stderr).trim()
                );
            }
        }
    }

    // 第二遍：叠加配音轨 + 烧录字幕轨
    // T3.3: 进度 70→85%（视频拼接完成）
    if let Some(cb) = progress_cb {
        cb(70, "视频拼接完成，正在烧录字幕和混音...");
    }
    check_cancel(cancel_flag)?;
    // R3.2: 转场段通过额外 handle 抵消 xfade overlap，视频总时长保持原时间线长度。
    // 因此音频/字幕不再需要 shrink 平移。
    let transition_shrink_points: Vec<(f64, f64)> = Vec::new();

    if let Some(cb) = progress_cb {
        cb(85, "正在烧录字幕和混音...");
    }
    check_cancel(cancel_flag)?;
    let result = burn_subtitle_and_mix_audio(
        cache_dir,
        projects_dir,
        project,
        &raw_output,
        preview,
        &transition_shrink_points,
        &encoder,
        cancel_flag,
    )
    .await?;
    // T3.3: 进度 100%
    if let Some(cb) = progress_cb {
        cb(100, "渲染完成");
    }
    Ok(result)
}

struct SinglePassVideoGraph<'a> {
    base_clips: Vec<&'a Clip>,
    overlay_clips: Vec<&'a Clip>,
}

async fn render_single_pass_video_graph(
    cache_dir: &Path,
    project: &Project,
    graph: &SinglePassVideoGraph<'_>,
    output_path: &Path,
    preview: bool,
    encoder: &str,
    width: u32,
    height: u32,
    cancel_flag: Option<&std::sync::atomic::AtomicBool>,
) -> anyhow::Result<()> {
    let mut args: Vec<String> = vec!["-y".to_string()];
    let all_clips: Vec<&Clip> = graph
        .base_clips
        .iter()
        .chain(graph.overlay_clips.iter())
        .copied()
        .collect();
    for clip in &all_clips {
        let source = project
            .media
            .iter()
            .find(|media| Some(&media.id) == clip.source_id.as_ref())
            .ok_or_else(|| anyhow::anyhow!("单遍导出缺少素材：{}", clip.id))?;
        let local_path = ensure_media_local(cache_dir, source).await?;
        if source.kind == "image" {
            args.extend([
                "-loop".to_string(),
                "1".to_string(),
                "-t".to_string(),
                format!("{:.3}", clip.duration),
                "-i".to_string(),
                local_path.to_string_lossy().to_string(),
            ]);
        } else {
            args.extend([
                "-ss".to_string(),
                format!("{:.3}", clip.source_in),
                "-stream_loop".to_string(),
                "-1".to_string(),
                "-t".to_string(),
                format!("{:.3}", clip.duration),
                "-i".to_string(),
                local_path.to_string_lossy().to_string(),
            ]);
        }
    }

    let mut filter = String::new();
    for (index, clip) in graph.base_clips.iter().enumerate() {
        let scale_filter = format!(
            "scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"
        );
        let source_crop = clip_source_crop(clip);
        let mut chain = if source_crop.is_empty() {
            scale_filter
        } else {
            format!("{},{}", source_crop.trim_start_matches(','), scale_filter)
        };
        if (clip.speed - 1.0).abs() > f64::EPSILON {
            chain.push_str(&format!(",setpts={:.6}*(PTS-STARTPTS)", 1.0 / clip.speed));
        } else {
            chain.push_str(",setpts=PTS-STARTPTS");
        }
        chain.push_str(&clip_color_filter(clip));
        chain.push_str(",format=yuv420p");
        filter.push_str(&format!("[{index}:v]{chain}[base{index}];"));
    }
    let concat_inputs = (0..graph.base_clips.len())
        .map(|index| format!("[base{index}]"))
        .collect::<String>();
    filter.push_str(&format!(
        "{concat_inputs}concat=n={}:v=1:a=0[baseout];",
        graph.base_clips.len()
    ));
    let mut prev_label = "[baseout]".to_string();
    for (overlay_index, clip) in graph.overlay_clips.iter().enumerate() {
        let input_index = graph.base_clips.len() + overlay_index;
        let default_tf = crate::models::ClipTransform::default();
        let transform = clip.transform.as_ref().unwrap_or(&default_tf);
        let scale_pct = transform.scale.max(1.0) / 100.0;
        let target_w = ((width as f64) * scale_pct).round().max(1.0) as u32;
        let target_h = ((height as f64) * scale_pct).round().max(1.0) as u32;
        let source_crop = clip_source_crop(clip);
        let mut chain = if source_crop.is_empty() {
            format!("scale={target_w}:{target_h}:force_original_aspect_ratio=decrease")
        } else {
            format!(
                "{},scale={target_w}:{target_h}:force_original_aspect_ratio=decrease",
                source_crop.trim_start_matches(',')
            )
        };
        if (clip.speed - 1.0).abs() > f64::EPSILON {
            chain.push_str(&format!(
                ",setpts={:.6}*(PTS-STARTPTS)+{:.3}/TB",
                1.0 / clip.speed,
                clip.start_on_track
            ));
        } else {
            chain.push_str(&format!(
                ",setpts=PTS-STARTPTS+{:.3}/TB",
                clip.start_on_track
            ));
        }
        chain.push_str(&clip_color_filter(clip));
        chain.push_str(",format=yuva420p");
        let opacity = (transform.opacity).clamp(0.0, 100.0) / 100.0;
        if opacity < 1.0 {
            chain.push_str(&format!(",colorchannelmixer=aa={:.3}", opacity));
        }
        let overlay_label = format!("[ov{overlay_index}]");
        filter.push_str(&format!("[{input_index}:v]{chain}{overlay_label};"));
        let x_pct = transform.x.clamp(0.0, 100.0) / 100.0;
        let y_pct = transform.y.clamp(0.0, 100.0) / 100.0;
        let x_expr = format!("(w-W)*{x_pct:.4}");
        let y_expr = format!("(h-H)*{y_pct:.4}");
        let out_label = format!("[mix{overlay_index}]");
        let end = clip.start_on_track + clip.duration;
        filter.push_str(&format!(
            "{prev_label}{overlay_label}overlay={x_expr}:{y_expr}:enable='between(t,{:.3},{:.3})'{out_label};",
            clip.start_on_track,
            end
        ));
        prev_label = out_label;
    }
    filter.push_str(&format!("{prev_label}format=yuv420p[vout]"));

    let (enc_name, enc_extra) =
        encoder_args(encoder, preview, Some(project.render_config.bitrate_mbps));
    args.extend([
        "-filter_complex".to_string(),
        filter,
        "-map".to_string(),
        "[vout]".to_string(),
        "-r".to_string(),
        project.render_config.fps.to_string(),
        "-c:v".to_string(),
        enc_name,
    ]);
    args.extend(enc_extra);
    args.extend([
        "-an".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        output_path.to_string_lossy().to_string(),
    ]);

    check_cancel(cancel_flag)?;
    let mut cmd = Command::new("ffmpeg");
    cmd.args(&args);
    let output = run_with_timeout_and_cancel(&mut cmd, 1800, cancel_flag).await?;
    if !output.status.success() {
        anyhow::bail!(
            "单遍视频图渲染失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

/// 渲染纯黑背景段（无活跃 clip 的时间段，保证时间线连续）。
async fn render_black_segment(
    segment_dir: &Path,
    project: &Project,
    seg_duration: f64,
    seg_index: usize,
    preview: bool,
    encoder: &str,
    width: u32,
    height: u32,
) -> anyhow::Result<PathBuf> {
    let (enc_name, enc_extra) =
        encoder_args(encoder, preview, Some(project.render_config.bitrate_mbps));
    let output_path = segment_dir.join(format!("seg-{:03}.mp4", seg_index));
    let filter = format!(
        "color=c=black:s={width}x{height}:r={},format=yuv420p",
        project.render_config.fps
    );
    let mut args: Vec<String> = vec![
        "-y".to_string(),
        "-f".to_string(),
        "lavfi".to_string(),
        "-i".to_string(),
        filter,
        "-t".to_string(),
        format!("{:.3}", seg_duration),
        "-c:v".to_string(),
        enc_name,
    ];
    args.extend(enc_extra);
    args.extend([
        "-an".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        output_path.to_string_lossy().to_string(),
    ]);
    let output = Command::new("ffmpeg").args(&args).output().await?;
    if !output.status.success() {
        anyhow::bail!(
            "渲染黑屏段 {} 失败：{}",
            seg_index,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(output_path)
}

/// 渲染一个时间段：把该段内所有活跃视频 clip 叠加成一个 mp4 片段。
/// 用 ffmpeg filter_complex：每个 clip 作为一个输入流，经变换后用 overlay 链叠加。
async fn render_segment_with_overlay(
    cache_dir: &Path,
    segment_dir: &Path,
    project: &Project,
    active_clips: &[&Clip],
    seg_start: f64,
    seg_duration: f64,
    seg_index: usize,
    preview: bool,
    encoder: &str,
    width: u32,
    height: u32,
) -> anyhow::Result<PathBuf> {
    let fps = project.render_config.fps;

    // 单 clip 的情况：直接渲染（无需 overlay）
    if active_clips.len() == 1 {
        let clip = active_clips[0];
        return render_single_clip_for_segment(
            cache_dir,
            segment_dir,
            project,
            clip,
            seg_start,
            seg_duration,
            seg_index,
            preview,
            encoder,
            width,
            height,
        )
        .await;
    }

    // 多 clip：用 filter_complex 叠加
    // 准备每个 clip 的本地文件路径 + 素材类型作为输入
    let mut inputs: Vec<(PathBuf, &Clip, bool, Vec<SourceWindowPart>)> = Vec::new();
    for clip in active_clips {
        let source = match project
            .media
            .iter()
            .find(|m| Some(&m.id) == clip.source_id.as_ref())
        {
            Some(s) => s,
            None => continue, // 跳过未绑定素材的 clip（避免渲染崩溃）
        };
        let local_path = ensure_media_local(cache_dir, source).await?;
        let is_image = source.kind == "image";
        let source_parts = if is_image {
            Vec::new()
        } else {
            let plan = compile_source_window(clip, seg_start, seg_duration);
            if plan.parts.is_empty() {
                continue;
            }
            plan.parts
        };
        inputs.push((local_path, *clip, is_image, source_parts));
    }
    if inputs.is_empty() {
        anyhow::bail!("该时间段没有已绑定素材的视频片段");
    }

    // 构造 ffmpeg 命令：图片用 -loop 1，视频用 -ss 定位
    let mut args: Vec<String> = vec!["-y".to_string()];
    for (local_path, _clip, is_image, source_parts) in &inputs {
        if *is_image {
            args.push("-loop".to_string());
            args.push("1".to_string());
            args.push("-t".to_string());
            args.push(format!("{:.3}", seg_duration));
            args.push("-i".to_string());
            args.push(local_path.to_string_lossy().to_string());
        } else if let [part] = source_parts.as_slice() {
            args.push("-ss".to_string());
            args.push(format!("{:.3}", part.source_start));
            args.push("-t".to_string());
            args.push(format!("{:.3}", part.source_end - part.source_start));
            args.push("-i".to_string());
            args.push(local_path.to_string_lossy().to_string());
        } else {
            args.push("-i".to_string());
            args.push(local_path.to_string_lossy().to_string());
        }
    }

    // 构造 filter_complex：
    // [0:v] 缩放裁切到目标尺寸 + 变换 → [v0]
    // [1:v] 缩放到画中画尺寸 + 变换 → [v1]
    // [v0][v1] overlay=x:y → [vout]
    let mut filter = String::new();
    let mut prev_label = String::new();
    for (i, (_path, clip, _is_image, source_parts)) in inputs.iter().enumerate() {
        let in_label = if let Some((source_filter, source_label)) =
            compile_multi_part_source_filter(i, source_parts)
        {
            filter.push_str(&source_filter);
            source_label
        } else {
            format!("[{}:v]", i)
        };
        let out_label = format!("[v{}]", i);
        let tf = clip.transform.as_ref();
        // 第一层（底层）：全屏缩放裁切
        // 其他层：按 scale 缩放，按 x/y 定位
        let scale_expr = if i == 0 {
            format!(
                "scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"
            )
        } else {
            let scale_kfs = clip
                .keyframes
                .as_ref()
                .and_then(|k| k.scale.as_ref().filter(|v| !v.is_empty()));
            if let Some(kfs) = scale_kfs {
                // B3: scale 关键帧 -- 用表达式 + eval=frame 每帧重算
                let offset = clip.start_on_track - seg_start;
                let expr = compile_keyframe_expression(
                    kfs,
                    tf.map(|t| t.scale).unwrap_or(100.0),
                    offset,
                    "t",
                );
                format!(
                    "scale=w='{width}*({expr})/100':h='{height}*({expr})/100':eval=frame:force_original_aspect_ratio=decrease"
                )
            } else {
                let scale_pct = tf.map(|t| t.scale).unwrap_or(100.0).max(1.0) / 100.0;
                let target_w = ((width as f64) * scale_pct).round() as u32;
                let target_h = ((height as f64) * scale_pct).round() as u32;
                format!("scale={target_w}:{target_h}:force_original_aspect_ratio=decrease")
            }
        };

        // 画面裁剪（在 scale 之前，操作源帧）
        let source_crop = clip_source_crop(clip);
        let mut chain = if source_crop.is_empty() {
            scale_expr
        } else {
            format!("{},{}", source_crop.trim_start_matches(','), scale_expr)
        };
        if let [part] = source_parts.as_slice() {
            chain = apply_source_window_filter(chain, part);
        }
        // B2/B4: 旋转（仅叠加层，避免底层旋转导致黑边）
        if i > 0 {
            let rot_kfs = clip
                .keyframes
                .as_ref()
                .and_then(|k| k.rotation.as_ref().filter(|v| !v.is_empty()));
            if let Some(kfs) = rot_kfs {
                // B4: 关键帧旋转 -- 用 rotate + 表达式
                let offset = clip.start_on_track - seg_start;
                let deg_expr = compile_keyframe_expression(
                    kfs,
                    tf.map(|t| t.rotation).unwrap_or(0.0),
                    offset,
                    "t",
                );
                chain.push_str(&format!(
                    ",format=rgba,rotate=angle='({deg_expr})*PI/180':fillcolor=black@0:ow=hypot(iw,ih):oh=hypot(iw,ih):eval=frame,format=yuva420p"
                ));
            } else if let Some(t) = tf {
                // B2: 静态旋转
                let rot = rotation_filter(t.rotation);
                if !rot.is_empty() {
                    chain.push_str(&rot);
                }
            }
        }
        // 圆角：用 geq 在 alpha 通道上做四角圆切（radius 像素）
        if let Some(t) = tf {
            if t.corner_radius > 0 {
                let r = t.corner_radius as f64;
                // 四角圆心距离判断：到任一角圆心距离 > r 则透明。
                // 四个 gt(...) 分别对应四个角，任一超出圆弧（距离平方 > r²）即 alpha=0。
                chain.push_str(&format!(
                    ",format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gt(pow(max({r}-X,0),2)+pow(max({r}-Y,0),2),{r2})+gt(pow(max(X-(W-1-{r}),0),2)+pow(max({r}-Y,0),2),{r2})+gt(pow(max({r}-X,0),2)+pow(max(Y-(H-1-{r}),0),2),{r2})+gt(pow(max(X-(W-1-{r}),0),2)+pow(max(Y-(H-1-{r}),0),2),{r2}),0,255)'",
                    r = r,
                    r2 = r * r
                ));
            }
        }
        chain.push_str(",format=yuva420p");
        // 不透明度
        let opacity_keyframes = clip
            .keyframes
            .as_ref()
            .and_then(|keyframes| keyframes.opacity.as_deref())
            .filter(|keyframes| !keyframes.is_empty());
        chain.push_str(&compile_static_opacity_filter(
            tf.map(|transform| transform.opacity).unwrap_or(100.0),
            opacity_keyframes.is_some(),
        ));
        if let Some(opacity_kfs) = opacity_keyframes {
            if let Some(opacity_fade) = compile_opacity_alpha_filter(
                opacity_kfs,
                clip.start_on_track - seg_start,
            ) {
                chain.push_str(&opacity_fade);
            }
        }
        // T4.4: 蒙版（geq alpha）
        if let Some(mask) = clip.mask.as_ref() {
            let expr = mask_alpha_expr(mask);
            chain.push_str(&format!(",geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='{expr}'"));
        }

        if i == 0 {
            filter.push_str(&format!("{in_label}{chain}{out_label};"));
            prev_label = out_label;
        } else {
            // overlay 定位：x/y 是 0-100% 百分比，0=左/上，50=居中，100=右/下
            // ffmpeg overlay 变量：w/h=主画面宽高, W/H=被叠加画面宽高
            // 偏移 = (主画面 - 叠加画面) * 百分比，即 0%=贴左, 50%=居中, 100%=贴右
            let default_tf = crate::models::ClipTransform::default();
            let tf = tf.unwrap_or(&default_tf);
            // T4.2: 关键帧导出 —— x/y 用分段线性表达式（含 t 变量）
            let kfs = clip.keyframes.as_ref();
            let x_expr = if let Some(x_kfs) = kfs.and_then(|k| k.x.as_ref()) {
                keyframes_to_overlay_expr(x_kfs, tf.x, clip.start_on_track - seg_start, "x")
            } else {
                let x_pct = (tf.x).clamp(0.0, 100.0) / 100.0;
                format!("(w-W)*{:.4}", x_pct)
            };
            let y_expr = if let Some(y_kfs) = kfs.and_then(|k| k.y.as_ref()) {
                keyframes_to_overlay_expr(y_kfs, tf.y, clip.start_on_track - seg_start, "y")
            } else {
                let y_pct = (tf.y).clamp(0.0, 100.0) / 100.0;
                format!("(h-H)*{:.4}", y_pct)
            };
            let this_label = format!("[v{}]", i);
            filter.push_str(&format!("{in_label}{chain}{this_label};"));
            let merged = format!("[m{}]", i);
            // B1: 混合模式（overlay/screen/multiply）用 overlay 滤镜的 mode 参数
            // overlay 的 mode 参数直接支持 blend 模式，且正确处理 alpha 通道
            let mix_mode = tf.mix.as_str();
            if mix_mode != "normal" && !mix_mode.is_empty() {
                filter.push_str(&format!(
                    "{prev_label}{this_label}overlay={x_expr}:{y_expr}:mode={mix_mode}{merged};"
                ));
            } else {
                filter.push_str(&format!(
                    "{prev_label}{this_label}overlay={x_expr}:{y_expr}{merged};"
                ));
            }
            prev_label = merged;
        }
    }
    // 最后一个 merged 标签作为输出（去掉末尾分号）
    let filter = filter.trim_end_matches(';');

    args.push("-filter_complex".to_string());
    args.push(filter.to_string());
    args.push("-map".to_string());
    args.push(prev_label);
    args.push("-r".to_string());
    args.push(format!("{}", fps));
    // 编码器：统一用 encoder_args
    let (ovl_enc_name, ovl_enc_extra) =
        encoder_args(encoder, preview, Some(project.render_config.bitrate_mbps));
    args.push("-c:v".to_string());
    args.push(ovl_enc_name);
    args.extend(ovl_enc_extra);
    args.push("-an".to_string());
    args.push("-movflags".to_string());
    args.push("+faststart".to_string());

    let output_path = segment_dir.join(format!("seg-{:03}.mp4", seg_index));
    args.push(output_path.to_string_lossy().to_string());

    let output = Command::new("ffmpeg").args(&args).output().await?;
    if !output.status.success() {
        anyhow::bail!(
            "叠加渲染段 {} 失败：{}",
            seg_index,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(output_path)
}

async fn render_transition_unit(
    cache_dir: &Path,
    segment_dir: &Path,
    project: &Project,
    prev_clips: &[&Clip],
    next_clips: &[&Clip],
    transition_name: &str,
    start: f64,
    boundary: f64,
    duration: f64,
    seg_index: usize,
    preview: bool,
    encoder: &str,
    width: u32,
    height: u32,
    cancel_flag: Option<&std::sync::atomic::AtomicBool>,
) -> anyhow::Result<PathBuf> {
    let xfade_name = xfade_filter_name(transition_name);

    let work_dir = segment_dir.join(format!("transition-{:03}", seg_index));
    tokio::fs::create_dir_all(&work_dir).await?;

    let prev_path = if prev_clips.is_empty() {
        render_black_segment(
            &work_dir, project, duration, 0, preview, encoder, width, height,
        )
        .await?
    } else {
        render_segment_with_overlay(
            cache_dir,
            &work_dir,
            project,
            prev_clips,
            start,
            duration,
            0,
            preview,
            encoder,
            width,
            height,
        )
        .await?
    };
    let next_path = if next_clips.is_empty() {
        render_black_segment(
            &work_dir, project, duration, 1, preview, encoder, width, height,
        )
        .await?
    } else {
        render_segment_with_overlay(
            cache_dir,
            &work_dir,
            project,
            next_clips,
            boundary,
            duration,
            1,
            preview,
            encoder,
            width,
            height,
        )
        .await?
    };

    let output_path = segment_dir.join(format!("seg-{:03}.mp4", seg_index));
    let filter = format!(
        "[0:v][1:v]xfade=transition={xfade_name}:duration={duration:.3}:offset=0,format=yuv420p[vout]"
    );
    let (enc_name, enc_extra) =
        encoder_args(encoder, preview, Some(project.render_config.bitrate_mbps));
    let mut args: Vec<String> = vec![
        "-y".to_string(),
        "-i".to_string(),
        prev_path.to_string_lossy().to_string(),
        "-i".to_string(),
        next_path.to_string_lossy().to_string(),
        "-filter_complex".to_string(),
        filter,
        "-map".to_string(),
        "[vout]".to_string(),
        "-r".to_string(),
        project.render_config.fps.to_string(),
        "-c:v".to_string(),
        enc_name,
    ];
    args.extend(enc_extra);
    args.extend([
        "-an".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        output_path.to_string_lossy().to_string(),
    ]);

    check_cancel(cancel_flag)?;
    let mut cmd = Command::new("ffmpeg");
    cmd.args(&args);
    let output = run_with_timeout_and_cancel(&mut cmd, 1800, cancel_flag).await?;
    if !output.status.success() {
        anyhow::bail!(
            "转场渲染段 {} 失败：{}",
            seg_index,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(output_path)
}

/// 渲染单 clip 的一个时间段（无叠加，底层或独立 clip 用）。
async fn render_single_clip_for_segment(
    cache_dir: &Path,
    segment_dir: &Path,
    project: &Project,
    clip: &Clip,
    seg_start: f64,
    seg_duration: f64,
    seg_index: usize,
    preview: bool,
    encoder: &str,
    width: u32,
    height: u32,
) -> anyhow::Result<PathBuf> {
    let source = match project
        .media
        .iter()
        .find(|m| Some(&m.id) == clip.source_id.as_ref())
    {
        Some(s) => s,
        None => {
            // 未绑定素材 → 渲染纯黑段（避免崩溃）
            return render_black_segment(
                segment_dir,
                project,
                seg_duration,
                seg_index,
                preview,
                encoder,
                width,
                height,
            )
            .await;
        }
    };
    let local_path = ensure_media_local(cache_dir, source).await?;
    let scale_filter = format!(
        "scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},format=yuv420p"
    );
    let is_image = source.kind == "image";
    let source_plan = (!is_image).then(|| compile_source_window(clip, seg_start, seg_duration));
    if source_plan
        .as_ref()
        .is_some_and(|plan| plan.parts.is_empty())
    {
        return render_black_segment(
            segment_dir,
            project,
            seg_duration,
            seg_index,
            preview,
            encoder,
            width,
            height,
        )
        .await;
    }
    if let Some(parts) = source_plan
        .as_ref()
        .map(|plan| plan.parts.as_slice())
        .filter(|parts| parts.len() > 1)
    {
        return render_source_window_parts_for_segment(
            segment_dir,
            project,
            &local_path,
            seg_duration,
            seg_index,
            preview,
            encoder,
            width,
            height,
            &scale_filter,
            clip,
            parts,
        )
        .await;
    }

    let color_fx = clip_color_filter(clip);
    let source_crop = clip_source_crop(clip);
    // crop 在 scale 之前执行（操作源帧）
    let mut video_filter = if source_crop.is_empty() {
        scale_filter.clone()
    } else {
        format!("{},{}", source_crop.trim_start_matches(','), scale_filter)
    };
    let source_part = source_plan.as_ref().and_then(|plan| plan.parts.first());
    if let Some(part) = source_part {
        video_filter = apply_source_window_filter(video_filter, part);
    }
    video_filter.push_str(&color_fx);

    let output_path = segment_dir.join(format!("seg-{:03}.mp4", seg_index));

    let local_str = local_path.to_string_lossy().to_string();
    let mut args: Vec<String> = vec!["-y".to_string()];
    if is_image {
        // 图片：-loop 1 把单帧当无限循环视频，-t 限制输出时长
        args.push("-loop".to_string());
        args.push("1".to_string());
        args.push("-i".to_string());
        args.push(local_str);
    } else {
        let part = source_part.expect("video source window checked above");
        args.push("-ss".to_string());
        args.push(format!("{:.3}", part.source_start));
        args.push("-t".to_string());
        args.push(format!("{:.3}", part.source_end - part.source_start));
        args.push("-stream_loop".to_string());
        args.push("-1".to_string());
        args.push("-i".to_string());
        args.push(local_str);
    }
    args.push("-t".to_string());
    args.push(format!(
        "{:.3}",
        source_part
            .map(|part| part.timeline_duration)
            .unwrap_or(seg_duration)
    ));
    args.push("-vf".to_string());
    args.push(video_filter);
    args.push("-r".to_string());
    args.push(format!("{}", project.render_config.fps));
    // 编码器：统一用 encoder_args
    let (sc_enc_name, sc_enc_extra) =
        encoder_args(encoder, preview, Some(project.render_config.bitrate_mbps));
    args.push("-c:v".to_string());
    args.push(sc_enc_name);
    args.extend(sc_enc_extra);
    args.push("-an".to_string());
    args.push("-movflags".to_string());
    args.push("+faststart".to_string());
    args.push(output_path.to_string_lossy().to_string());

    let output = Command::new("ffmpeg").args(&args).output().await?;
    if !output.status.success() {
        anyhow::bail!(
            "渲染段 {} 失败：{}",
            seg_index,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(output_path)
}

async fn render_source_window_parts_for_segment(
    segment_dir: &Path,
    project: &Project,
    local_path: &Path,
    seg_duration: f64,
    seg_index: usize,
    preview: bool,
    encoder: &str,
    width: u32,
    height: u32,
    scale_filter: &str,
    clip: &Clip,
    parts: &[SourceWindowPart],
) -> anyhow::Result<PathBuf> {
    if parts.is_empty() {
        return render_black_segment(
            segment_dir,
            project,
            seg_duration,
            seg_index,
            preview,
            encoder,
            width,
            height,
        )
        .await;
    }

    let source_crop = clip_source_crop(clip);
    let color_fx = clip_color_filter(clip);
    let base_filter = if source_crop.is_empty() {
        scale_filter.to_string()
    } else {
        format!("{},{}", source_crop.trim_start_matches(','), scale_filter)
    };
    let output_path = segment_dir.join(format!("seg-{:03}.mp4", seg_index));
    let mut part_paths = Vec::new();

    for (part_index, part) in parts.iter().enumerate() {
        let source_span = (part.source_end - part.source_start).max(0.001);
        let mut video_filter = apply_source_window_filter(base_filter.clone(), part);
        video_filter.push_str(&color_fx);

        let part_path =
            segment_dir.join(format!("seg-{:03}-curve-{:03}.mp4", seg_index, part_index));
        let mut args: Vec<String> = vec![
            "-y".to_string(),
            "-ss".to_string(),
            format!("{:.3}", part.source_start),
            "-i".to_string(),
            local_path.to_string_lossy().to_string(),
            "-t".to_string(),
            format!("{:.3}", source_span),
            "-vf".to_string(),
            video_filter,
            "-r".to_string(),
            format!("{}", project.render_config.fps),
        ];
        let (enc_name, enc_extra) =
            encoder_args(encoder, preview, Some(project.render_config.bitrate_mbps));
        args.push("-c:v".to_string());
        args.push(enc_name);
        args.extend(enc_extra);
        args.push("-an".to_string());
        args.push("-movflags".to_string());
        args.push("+faststart".to_string());
        args.push("-t".to_string());
        args.push(format!("{:.3}", part.timeline_duration));
        args.push(part_path.to_string_lossy().to_string());

        let output = Command::new("ffmpeg").args(&args).output().await?;
        if !output.status.success() {
            anyhow::bail!(
                "曲线变速子段 {}-{} 渲染失败：{}",
                seg_index,
                part_index,
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
        part_paths.push(part_path);
    }

    if part_paths.is_empty() {
        return render_black_segment(
            segment_dir,
            project,
            seg_duration,
            seg_index,
            preview,
            encoder,
            width,
            height,
        )
        .await;
    }
    if part_paths.len() == 1 {
        tokio::fs::copy(&part_paths[0], &output_path).await?;
        return Ok(output_path);
    }

    let list_path = segment_dir.join(format!(
        "curve-concat-{}-{}.txt",
        seg_index,
        chrono::Utc::now().timestamp_millis()
    ));
    let list_content = part_paths
        .iter()
        .map(|path| format!("file '{}'\n", path.to_string_lossy().replace('\'', "'\\''")))
        .collect::<String>();
    tokio::fs::write(&list_path, list_content).await?;

    let output = Command::new("ffmpeg")
        .args([
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            &list_path.to_string_lossy(),
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            &output_path.to_string_lossy(),
        ])
        .output()
        .await?;
    if !output.status.success() {
        anyhow::bail!(
            "曲线变速段 {} 拼接失败：{}",
            seg_index,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(output_path)
}

/// 第二遍：把配音轨混进视频、字幕轨烧录到画面。
/// （Phase 6 前先用占位实现：若有配音轨则混入，字幕留到 Phase 6。）
async fn burn_subtitle_and_mix_audio(
    cache_dir: &Path,
    projects_dir: &Path,
    project: &Project,
    video_input: &Path,
    preview: bool,
    // 转场偏移表：(转场发生时间点, 缩短量)。音频/字幕按此平移以对齐 xfade 后的视频
    transition_shrink_points: &[(f64, f64)],
    encoder: &str,
    cancel_flag: Option<&std::sync::atomic::AtomicBool>,
) -> anyhow::Result<PathBuf> {
    let render_dir = projects_dir.join(&project.id).join("renders");
    let output_path = render_dir.join(if preview { "preview.mp4" } else { "final.mp4" });

    // 收集音频源 clip：配音轨 + 音频轨 + 未静音的视频轨（视频原声）。
    // 图片轨/图片素材没有音频流，必须排除，否则提取失败会导致后续混音索引错位。
    let audio_clips = collect_mix_audio_clips(project);

    // 收集字幕轨 clip，生成 .ass 字幕文件
    let subtitle_track_ids: Vec<String> = project
        .tracks
        .iter()
        .filter(|t| t.kind == TrackKind::Subtitle && !t.hidden)
        .map(|t| t.id.clone())
        .collect();
    let mut subtitle_clips: Vec<&Clip> = project
        .clips
        .iter()
        .filter(|c| subtitle_track_ids.contains(&c.track_id))
        .collect();
    subtitle_clips.sort_by(|a, b| {
        a.start_on_track
            .partial_cmp(&b.start_on_track)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let has_subtitles = !subtitle_clips.is_empty();
    let has_audio = audio_clips.iter().any(|c| c.source_id.is_some());

    // 无字幕且无配音 → 直接拷贝
    if !has_subtitles && !has_audio {
        check_cancel(cancel_flag)?;
        tokio::fs::copy(video_input, &output_path).await?;
        return Ok(output_path);
    }

    // 生成 .ass 字幕文件（subtitle_mode="none" 或 "srt" 时跳过烧录）
    // SRT 模式：单独生成 .srt 文件，不烧录到画面
    let srt_mode = project.render_config.subtitle_mode == "srt";
    let burn_subtitles = project.render_config.subtitle_mode != "none" && !srt_mode;

    // SRT 模式：按轨分组生成 .srt 文件到 render_dir
    // 多轨时每轨一个文件（final-中文字幕.srt / final-英文字幕.srt），单轨保持 final.srt
    if has_subtitles && srt_mode {
        tokio::fs::create_dir_all(&render_dir).await?;
        // 按 track_id 分组 clips，保持时间顺序
        let mut track_groups: Vec<(String, String, Vec<&Clip>)> = Vec::new();
        for clip in &subtitle_clips {
            let track = project.tracks.iter().find(|t| t.id == clip.track_id);
            let track_name = track.map(|t| t.name.clone()).unwrap_or_else(|| "unknown".to_string());
            if let Some(group) = track_groups.iter_mut().find(|(id, _, _)| *id == clip.track_id) {
                group.2.push(*clip);
            } else {
                track_groups.push((clip.track_id.clone(), track_name, vec![*clip]));
            }
        }
        let multi_track = track_groups.len() > 1;
        for (_, name, clips) in &track_groups {
            let srt = generate_srt_subtitles(clips, transition_shrink_points);
            let suffix = if multi_track {
                // 清理文件名非法字符
                let safe: String = name
                    .chars()
                    .map(|c| match c {
                        '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
                        _ => c,
                    })
                    .collect();
                format!("-{}", safe)
            } else {
                String::new()
            };
            let filename = if preview {
                format!("preview{}.srt", suffix)
            } else {
                format!("final{}.srt", suffix)
            };
            let srt_path = render_dir.join(filename);
            tokio::fs::write(&srt_path, &srt).await?;
        }
    }

    let ass_path = if has_subtitles && burn_subtitles {
        let ass = generate_ass_subtitles(&subtitle_clips, project, transition_shrink_points);
        let ass_file = cache_dir.join(format!(
            "subtitles-{}-{}.ass",
            project.id,
            chrono::Utc::now().timestamp_millis()
        ));
        tokio::fs::write(&ass_file, &ass).await?;
        Some(ass_file)
    } else {
        None
    };

    // 合并配音音频为一个 wav（按时间线排列，空隙静音）
    let merged_audio_path = if has_audio {
        let merged = cache_dir.join(format!(
            "mixed-audio-{}-{}.wav",
            project.id,
            chrono::Utc::now().timestamp_millis()
        ));
        match merge_audio_clips(
            cache_dir,
            &merged,
            &audio_clips,
            project,
            &project.media,
            transition_shrink_points,
        )
        .await
        {
            Ok(p) => Some(p),
            Err(e) => {
                eprintln!("音频混音失败，导出将无音轨：{e}");
                None
            }
        }
    } else {
        None
    };

    // 构造 ffmpeg 命令：烧录字幕 + 混入配音
    let mut args: Vec<String> = vec![
        "-y".to_string(),
        "-i".to_string(),
        video_input.to_string_lossy().to_string(),
    ];

    // 如果有配音，加入第二个输入
    if let Some(ref audio_path) = merged_audio_path {
        args.push("-i".to_string());
        args.push(audio_path.to_string_lossy().to_string());
    }

    // 视频滤镜：烧录字幕
    let mut vf = String::new();
    if let Some(ref ass_file) = ass_path {
        // subtitles 滤镜烧录 .ass；force_style 可覆盖样式（.ass 内已含样式）
        // M14: 转义单引号 + 冒号（ffmpeg 滤镜路径语法）
        let ass_str =
            escape_filter_path(&ass_file.to_string_lossy().replace('\\', "/")).replace(':', "\\:");
        vf = format!("subtitles='{}'", ass_str);
    }

    // 音频滤镜：用配音替换原音频（视频本身无音频）
    // -map 0:v（视频）+ -map 1:a（配音）

    if !vf.is_empty() {
        args.push("-vf".to_string());
        args.push(vf);
    }

    args.push("-map".to_string());
    args.push("0:v".to_string());
    if merged_audio_path.is_some() {
        args.push("-map".to_string());
        args.push("1:a".to_string());
    }

    args.push("-c:v".to_string());
    // 编码器：统一用 encoder_args（硬件用 bitrate，软编用 preset+crf）
    let (burn_enc_name, burn_enc_extra) =
        encoder_args(encoder, preview, Some(project.render_config.bitrate_mbps));
    args.push(burn_enc_name);
    args.extend(burn_enc_extra);

    if merged_audio_path.is_some() {
        args.push("-c:a".to_string());
        args.push("aac".to_string());
        args.push("-b:a".to_string());
        args.push("128k".to_string());
    } else {
        args.push("-an".to_string());
    }

    args.push("-movflags".to_string());
    args.push("+faststart".to_string());
    args.push(output_path.to_string_lossy().to_string());

    check_cancel(cancel_flag)?;
    let mut cmd = Command::new("ffmpeg");
    cmd.args(&args);
    let output = run_with_timeout_and_cancel(&mut cmd, 1800, cancel_flag).await?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        // 字幕/混音失败时尝试无字幕版本（去掉 subtitles 滤镜重试一次）
        eprintln!("字幕烧录/混音失败，尝试无字幕重试：{stderr}");
        // 重新构造命令：去掉 subtitles 滤镜
        let mut retry_args: Vec<String> = vec![
            "-y".to_string(),
            "-i".to_string(),
            video_input.to_string_lossy().to_string(),
        ];
        if merged_audio_path.is_some() {
            retry_args.push("-i".to_string());
            retry_args.push(
                merged_audio_path
                    .as_ref()
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
            );
        }
        retry_args.push("-map".to_string());
        retry_args.push("0:v".to_string());
        if merged_audio_path.is_some() {
            retry_args.push("-map".to_string());
            retry_args.push("1:a".to_string());
        }
        retry_args.push("-c:v".to_string());
        // 重试也用 encoder_args（保持编码器一致，避免 concat 花屏）
        let (retry_enc_name, retry_enc_extra) =
            encoder_args(encoder, preview, Some(project.render_config.bitrate_mbps));
        retry_args.push(retry_enc_name);
        retry_args.extend(retry_enc_extra);
        if merged_audio_path.is_some() {
            retry_args.push("-c:a".to_string());
            retry_args.push("aac".to_string());
        } else {
            retry_args.push("-an".to_string());
        }
        retry_args.push("-movflags".to_string());
        retry_args.push("+faststart".to_string());
        retry_args.push(output_path.to_string_lossy().to_string());
        check_cancel(cancel_flag)?;
        let mut retry_cmd = Command::new("ffmpeg");
        retry_cmd.args(&retry_args);
        let retry_output = run_with_timeout_and_cancel(&mut retry_cmd, 1800, cancel_flag).await?;
        if !retry_output.status.success() {
            // 最终回退：无字幕无混音的裸拷贝
            eprintln!(
                "无字幕重试也失败，输出裸视频：{}",
                String::from_utf8_lossy(&retry_output.stderr).trim()
            );
            check_cancel(cancel_flag)?;
            tokio::fs::copy(video_input, &output_path).await?;
        }
    }
    Ok(output_path)
}

/// 生成 .ass 字幕文件内容（含样式：字体/字号/颜色/位置/描边）
fn generate_ass_subtitles(
    subtitle_clips: &[&Clip],
    project: &Project,
    // 转场偏移表：字幕时间戳按此平移以对齐 xfade 后的视频
    transition_shrink_points: &[(f64, f64)],
) -> String {
    let (width, height) = export_dimensions_for_project(project);
    let default_style = crate::models::SubtitleStyle::default();

    // 多字幕轨 Layer 映射：order 大=底层=Layer 0，order 小=上层=Layer 大
    // libass 中 Layer 数值大的后绘制 = 覆盖在上层。order 小的轨道在画面上层。
    let mut subtitle_tracks_sorted: Vec<&crate::models::Track> = project
        .tracks
        .iter()
        .filter(|t| t.kind == TrackKind::Subtitle && !t.hidden)
        .collect();
    subtitle_tracks_sorted.sort_by(|a, b| b.order.cmp(&a.order));
    let track_layer: Vec<(String, i32)> = subtitle_tracks_sorted
        .iter()
        .enumerate()
        .map(|(i, t)| (t.id.clone(), i as i32))
        .collect();

    // margin: 帧宽的 7%（剪映式像素宽度换行，不贴边）
    let margin_lr = (width as f64 * 0.07).round() as i32;

    // 收集所有不同的样式（按 font+size+color+stroke+position 分组），生成多个 Style 行
    let mut style_names: Vec<(String, &crate::models::SubtitleStyle)> = Vec::new();
    style_names.push(("Default".to_string(), &default_style));

    let mut style_counter = 0u32;
    for clip in subtitle_clips {
        if let Some(ref s) = clip.subtitle_style {
            let exists = style_names.iter().any(|(_, existing)| {
                existing.font_family == s.font_family
                    && existing.font_size == s.font_size
                    && existing.color == s.color
                    && existing.stroke_color == s.stroke_color
                    && existing.position == s.position
            });
            if !exists {
                style_counter += 1;
                let name = format!("S{style_counter}");
                style_names.push((name, s));
            }
        }
    }

    // 生成 Style 行（加宽 margin + 描边 4px 提升可读性）
    let mut styles_str = String::new();
    for (name, style) in &style_names {
        // 逐字高亮（karaoke）：PrimaryColour=高亮色（已播过），SecondaryColour=文字色（未播）
        // ASS \kf：颜色从 Secondary 渐变到 Primary
        let (primary, secondary) = if style.karaoke {
            let hi = hex_to_ass_color(&style.highlight_color);
            let base = hex_to_ass_color(&style.color);
            (hi, base)
        } else {
            let c = hex_to_ass_color(&style.color);
            (c.clone(), c)
        };
        let outline = hex_to_ass_color(&style.stroke_color);
        // 统一用 Alignment=5（中中锚点），位置由 Dialogue 行的 \pos 接管，与前端 SubtitleOverlay 对齐
        // ScaleX/Y/Rotation 也移到 Dialogue 行用 \fscx/\fscy/\frz，避免 Style 级别缩放干扰布局
        let alignment = 5;
        let margin_v = 0;
        styles_str.push_str(&format!(
            "Style: {name},{font},{size},{primary},{secondary},{outline},&H80000000,0,0,0,0,100,100,0,0,1,4,1,{align},{mlr},{mlr},{mv},1\n",
            name = name,
            font = style.font_family,
            size = style.font_size,
            primary = primary,
            secondary = secondary,
            outline = outline,
            align = alignment,
            mlr = margin_lr,
            mv = margin_v,
        ));
    }

    // ASS header: WrapStyle 2 = 不自动换行（我们用 \N 控制），
    // 但实际我们让 libass 按像素宽度自动换行（WrapStyle 0 智能换行 + UAX#14 CJK 支持）
    let mut ass = format!(
        "[Script Info]\n\
         ScriptType: v4.00+\n\
         PlayResX: {}\n\
         PlayResY: {}\n\
         WrapStyle: 0\n\
         ScaledBorderAndShadow: yes\n\
         \n\
         [V4+ Styles]\n\
         Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n\
         {styles}\
         \n\
         [Events]\n\
         Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n",
        width, height,
        styles = styles_str,
    );

    for clip in subtitle_clips {
        let text = clip.text.as_deref().unwrap_or("");
        if text.trim().is_empty() {
            continue;
        }
        // 转场偏移：字幕时间戳减去它之前所有转场的累计缩短量
        let shrink_before: f64 = transition_shrink_points
            .iter()
            .filter(|(t, _)| *t <= clip.start_on_track)
            .map(|(_, d)| *d)
            .last()
            .unwrap_or(0.0);
        let start = seconds_to_ass_time((clip.start_on_track - shrink_before).max(0.0));
        let end =
            seconds_to_ass_time((clip.start_on_track + clip.duration - shrink_before).max(0.0));

        let style_name = if let Some(ref s) = clip.subtitle_style {
            style_names
                .iter()
                .find(|(_, existing)| {
                    existing.font_family == s.font_family
                        && existing.font_size == s.font_size
                        && existing.color == s.color
                        && existing.stroke_color == s.stroke_color
                        && existing.position == s.position
                })
                .map(|(n, _)| n.clone())
                .unwrap_or_else(|| "Default".to_string())
        } else {
            "Default".to_string()
        };

        // 逐字高亮（卡拉OK \kf）：当 clip 有 words 且样式启用 karaoke 时
        let karaoke_enabled = clip
            .subtitle_style
            .as_ref()
            .map(|s| s.karaoke)
            .unwrap_or(true); // 默认 SubtitleStyle::default().karaoke = true
        let escaped = if karaoke_enabled {
            if let Some(words) = clip.words.as_ref() {
                if !words.is_empty() {
                    let karaoke_text = build_karaoke_text(words, clip.start_on_track, clip.duration);
                    // 双语模式：text = "翻译\n原文"
                    // 第一行显示翻译（无高亮），第二行显示原文（karaoke 高亮）
                    if let Some(newline_pos) = text.find('\n') {
                        let translated = &text[..newline_pos];
                        let escaped_translated = translated
                            .replace('{', "\\{")
                            .replace('}', "\\}");
                        format!("{}\\N{}", escaped_translated, karaoke_text)
                    } else {
                        karaoke_text
                    }
                } else {
                    text.replace('{', "\\{")
                        .replace('}', "\\}")
                        .replace('\n', "\\N")
                }
            } else {
                text.replace('{', "\\{")
                    .replace('}', "\\}")
                    .replace('\n', "\\N")
            }
        } else {
            text.replace('{', "\\{")
                .replace('}', "\\}")
                .replace('\n', "\\N")
        };

        // T4.8: 入场/出场动画 → ASS \fad(in,out) 标签（单位厘秒）
        let style = clip.subtitle_style.as_ref();
        let anim_dur = (style.map(|s| s.animation_duration).unwrap_or(0.3) * 100.0) as u32;
        let anim_in = style.map(|s| s.animation_in.as_str()).unwrap_or("");
        let anim_out = style.map(|s| s.animation_out.as_str()).unwrap_or("");
        let fade_in_cs = if anim_in == "fadeIn" || anim_in == "slideUp" || anim_in == "scaleIn" {
            anim_dur
        } else {
            0
        };
        let fade_out_cs =
            if anim_out == "fadeOut" || anim_out == "slideDown" || anim_out == "scaleOut" {
                anim_dur
            } else {
                0
            };
        let fade_tag = if fade_in_cs > 0 || fade_out_cs > 0 {
            format!("{{\\fad({fade_in_cs},{fade_out_cs})}}")
        } else {
            String::new()
        };

        let layer = track_layer
            .iter()
            .find(|(id, _)| id == &clip.track_id)
            .map(|(_, l)| *l)
            .unwrap_or(0);
        // 与前端 StageSubtitleLayer 对齐：单字幕按 position 渲染，不做多轨错开
        // bottom -> y=88%, center -> y=50%, top -> y=12%, custom -> (x%, y%)
        // 多字幕轨时由用户设置不同 position 避免叠加（与前端逻辑一致）
        let style_pos = style.map(|s| s.position.as_str()).unwrap_or("bottom");
        let (pos_x, pos_y) = match style_pos {
            "top" => (width as f64 / 2.0, height as f64 * 0.12),
            "center" => (width as f64 / 2.0, height as f64 * 0.50),
            "custom" => {
                let cx = style.map(|s| s.x).unwrap_or(50.0);
                let cy = style.map(|s| s.y).unwrap_or(80.0);
                (width as f64 * cx / 100.0, height as f64 * cy / 100.0)
            }
            _ => (width as f64 / 2.0, height as f64 * 0.88),
        };
        // 缩放和旋转（对应前端 transform: scale + rotate）
        let sx = style.map(|s| s.scale_x).unwrap_or(100.0);
        let sy = style.map(|s| s.scale_y).unwrap_or(100.0);
        let rot = style.map(|s| s.rotation).unwrap_or(0.0);
        let transform_tag = format!(
            "{{\\pos({pos_x:.1},{pos_y:.1})\\fscx{sx:.0}\\fscy{sy:.0}\\frz{rot:.0}}}",
        );
        ass.push_str(&format!(
            "Dialogue: {layer},{start},{end},{style_name},,0,0,0,,{fade_tag}{transform_tag}{escaped}\n"
        ));
    }
    ass
}

/// 构建逐字高亮 ASS 文本：每个词/字用 {\kfNN} 标签包裹。
/// NN = 该词的持续时间（厘秒，1/100 秒）。
/// word 时间是相对音频整体的，需要减去字幕块的起始偏移，得到相对字幕块显示的时间。
/// 同时把所有词的持续时间按比例缩放到字幕块的实际 duration，保证 \kf 总时长 == 字幕块时长。
fn build_karaoke_text(
    words: &[crate::models::WordCue],
    clip_start_on_track: f64,
    clip_duration: f64,
) -> String {
    if words.is_empty() {
        return String::new();
    }
    // 原始词级总时长（最后一个词的 end - 第一个词的 start）
    let words_start = words.first().map(|w| w.start).unwrap_or(0.0);
    let words_end = words.last().map(|w| w.end).unwrap_or(0.0);
    let words_total = (words_end - words_start).max(0.001);

    // 缩放因子：让词级总时长贴合字幕块 duration
    // （字幕块 duration 可能因最小时长规则被拉长，按比例分配）
    let scale = (clip_duration / words_total).max(0.01);

    let mut out = String::new();
    for (i, w) in words.iter().enumerate() {
        // 英文单词间加空格（放在 \kf 标签外，不占高亮时间）
        if i > 0 {
            let prev_last = words[i - 1].text.chars().last();
            let this_first = w.text.chars().next();
            let need_space = matches!((prev_last, this_first),
                (Some(a), Some(b)) if a.is_ascii_alphanumeric() && b.is_ascii_alphanumeric());
            if need_space {
                out.push(' ');
            }
        }
        // 每个词相对字幕块开始的偏移时长（秒）→ 厘秒
        let word_dur = ((w.end - w.start) * scale).max(0.01);
        let cs = (word_dur * 100.0).round().clamp(1.0, 8600.0) as u32; // ASS \kf 上限约 86s
                                                                       // 转义花括号（词文本一般不含，但保险）
        let escaped = w
            .text
            .replace('\\', "\\\\")
            .replace('{', "\\{")
            .replace('}', "\\}");
        out.push_str(&format!("{{\\kf{cs}}}{escaped}"));
    }
    // 触发 ASS 重绘对齐：开头的 \kf 从字幕块 0 时刻开始
    let _ = clip_start_on_track; // 词时间已是相对音频，与 start_on_track 解耦
    out
}

/// #RRGGBB → .ass 颜色 &H00BBGGRR
fn hex_to_ass_color(hex: &str) -> String {
    let hex = hex.trim_start_matches('#');
    if hex.len() != 6 {
        return "&H00FFFFFF".to_string();
    }
    let r = &hex[0..2];
    let g = &hex[2..4];
    let b = &hex[4..6];
    format!("&H00{b}{g}{r}").to_uppercase()
}

/// 秒 → .ass 时间格式 HH:MM:SS.cc
fn seconds_to_ass_time(seconds: f64) -> String {
    let total_cs = (seconds * 100.0).round() as u64;
    let cs = total_cs % 100;
    let total_s = total_cs / 100;
    let s = total_s % 60;
    let total_m = total_s / 60;
    let m = total_m % 60;
    let h = total_m / 60;
    format!("{h:01}:{m:02}:{s:02}.{cs:02}")
}

/// SRT 时间格式：HH:MM:SS,mmm（毫秒，3 位）
fn seconds_to_srt_time(seconds: f64) -> String {
    let total_ms = (seconds * 1000.0).round() as u64;
    let ms = total_ms % 1000;
    let total_s = total_ms / 1000;
    let s = total_s % 60;
    let total_m = total_s / 60;
    let m = total_m % 60;
    let h = total_m / 60;
    format!("{h:02}:{m:02}:{s:02},{ms:03}")
}

/// 生成 SRT 字幕文件内容（不支持逐字高亮/动画/样式，仅纯文本 + 时间戳）
fn generate_srt_subtitles(
    subtitle_clips: &[&Clip],
    transition_shrink_points: &[(f64, f64)],
) -> String {
    let mut srt = String::new();
    let mut index = 1u32;
    for clip in subtitle_clips {
        let text = clip.text.as_deref().unwrap_or("");
        if text.trim().is_empty() {
            continue;
        }
        let shrink_before: f64 = transition_shrink_points
            .iter()
            .filter(|(t, _)| *t <= clip.start_on_track)
            .map(|(_, d)| *d)
            .last()
            .unwrap_or(0.0);
        let start = (clip.start_on_track - shrink_before).max(0.0);
        let end = (clip.start_on_track + clip.duration - shrink_before).max(start + 0.001);

        srt.push_str(&format!("{index}\n"));
        srt.push_str(&format!(
            "{} --> {}\n",
            seconds_to_srt_time(start),
            seconds_to_srt_time(end)
        ));
        // SRT 换行用真实换行符；ASS 的 \N 在 SRT 里无意义，转成换行
        let escaped = text.replace("\\N", "\n").replace("\\n", "\n");
        srt.push_str(&escaped);
        srt.push_str("\n\n");
        index += 1;
    }
    srt
}

/// 合并配音音频 clip 为一个 wav（按时间线排列，空隙静音）
/// T4.10: 仅导出音频（跳过视频管线，混音后输出 mp3）。
pub async fn render_audio_only(
    cache_dir: &Path,
    output: &Path,
    audio_clips: &[&Clip],
    project: &Project,
    media: &[crate::models::MediaSource],
) -> anyhow::Result<PathBuf> {
    // 先用 merge_audio_clips 生成 wav（复用现有混音逻辑，含 fade/atempo/adelay）
    let wav_path = cache_dir.join(format!(
        "audio-only-{}.wav",
        chrono::Utc::now().timestamp_millis()
    ));
    merge_audio_clips(cache_dir, &wav_path, audio_clips, project, media, &[]).await?;
    if output
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("wav"))
        .unwrap_or(false)
    {
        tokio::fs::copy(&wav_path, output).await?;
        let _ = tokio::fs::remove_file(&wav_path).await;
        return Ok(output.to_path_buf());
    }

    // wav → mp3（libmp3lame）
    let mp3_output = if output.extension().and_then(|e| e.to_str()) == Some("mp3") {
        output.to_path_buf()
    } else {
        // 用户没指定 .mp3 后缀，强制改
        output.with_extension("mp3")
    };
    let mut cmd = Command::new("ffmpeg");
    cmd.args([
        "-y",
        "-i",
        &wav_path.to_string_lossy(),
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        &mp3_output.to_string_lossy(),
    ]);
    let convert = run_with_timeout(&mut cmd, 1800).await?;
    if !convert.status.success() {
        anyhow::bail!(
            "音频转 mp3 失败：{}",
            String::from_utf8_lossy(&convert.stderr).trim()
        );
    }
    // 清理临时 wav
    let _ = tokio::fs::remove_file(&wav_path).await;
    Ok(mp3_output)
}

/// 构建 atempo 滤镜链（变速保持音高）。
/// atempo 单次范围 0.5-2.0，超出需串联。speed=1.0 返回空字符串。
fn build_atempo_chain(speed: f64) -> String {
    if (speed - 1.0).abs() < 0.001 {
        return String::new();
    }
    let mut s = speed.max(0.0625); // ffmpeg atempo 下限
    let mut parts: Vec<String> = Vec::new();
    while s > 2.0 {
        parts.push("atempo=2.0".to_string());
        s /= 2.0;
    }
    while s < 0.5 {
        parts.push("atempo=0.5".to_string());
        s /= 0.5;
    }
    parts.push(format!("atempo={:.4}", s));
    parts.join(",")
}

async fn merge_audio_clips(
    cache_dir: &Path,
    output: &Path,
    audio_clips: &[&Clip],
    _project: &Project,
    media: &[crate::models::MediaSource],
    // 转场偏移表：(转场发生时间点, 缩短量)。clip 的 adelay 减去它之前所有转场的累计缩短量
    transition_shrink_points: &[(f64, f64)],
) -> anyhow::Result<PathBuf> {
    let tmp_dir = cache_dir.join("audio-merge");
    tokio::fs::create_dir_all(&tmp_dir).await?;

    // 为每个 clip 生成一段音频（在时间线上偏移 + 时长对齐），并只保留提取成功的配对。
    let mut extracted: Vec<(&Clip, PathBuf)> = Vec::new();
    for (i, clip) in audio_clips.iter().enumerate() {
        let source = clip
            .source_id
            .as_ref()
            .and_then(|sid| media.iter().find(|m| m.id == *sid));
        let Some(source) = source else { continue };
        let Some(local_path) = &source.local_path else {
            continue;
        };

        let seg_path = tmp_dir.join(format!("audio-{i}.wav"));
        let start = clip.source_in;
        let speed = clip.speed.abs().max(0.25);
        // 变速视频原声：源时长 = 时间线时长 × speed（T3.4）
        let source_dur = clip.duration * speed;
        // atempo 链：变速后保持音高（atempo 范围 0.5-2.0，超出串联多个）
        let atempo_filter = build_atempo_chain(speed);
        // 提取该段音频（按源时长提取，再 atempo 变速到时间线时长）
        let af = if atempo_filter.is_empty() {
            "anull".to_string()
        } else {
            atempo_filter
        };
        let extract = Command::new("ffmpeg")
            .args([
                "-y",
                "-ss",
                &format!("{start:.3}"),
                "-i",
                &local_path.clone(),
                "-t",
                &format!("{source_dur:.3}"),
                "-af",
                &af,
                "-ar",
                "44100",
                "-ac",
                "2",
                "-c:a",
                "pcm_s16le",
                &seg_path.to_string_lossy(),
            ])
            .output()
            .await?;
        if !extract.status.success() {
            continue;
        }
        extracted.push((*clip, seg_path));
    }

    if extracted.is_empty() {
        anyhow::bail!("没有可用的音频片段");
    }
    let total_duration = extracted
        .iter()
        .map(|(clip, _)| clip.start_on_track + clip.duration)
        .fold(0.0_f64, f64::max);

    // 用 adelay + amix 把各段按 startOnTrack 偏移混合
    // 简化版：用 concat + adelay（每段前面插入静音 = startOnTrack - 前一段结束）
    let mut args: Vec<String> = vec!["-y".to_string()];
    for (_, p) in &extracted {
        args.push("-i".to_string());
        args.push(p.to_string_lossy().to_string());
    }

    // 构造 filter：每个输入加 adelay（按 startOnTrack 偏移）+ afade（淡入淡出），然后 amix
    let mut filter = String::new();
    let n = extracted.len();
    // 默认最小淡入淡出 30ms（消除 clip 首尾波形硬切导致的爆音，借鉴 video-use 的切点交叉淡入淡出）
    const DEFAULT_FADE: f64 = 0.03;
    for (i, (clip, _)) in extracted.iter().enumerate() {
        // 转场偏移：clip 起点之前所有转场累计缩短的时长，adelay 要减去它
        let shrink_before: f64 = transition_shrink_points
            .iter()
            .filter(|(t, _)| *t <= clip.start_on_track)
            .map(|(_, d)| *d)
            .last()
            .unwrap_or(0.0);
        let adjusted_start = (clip.start_on_track - shrink_before).max(0.0);
        let delay_ms = (adjusted_start * 1000.0).round() as u64;
        let dur = clip.duration;
        // 用户没设 fade 时给 30ms 默认值（足够消除爆音，听感上无感知）
        let fade_in = if clip.fade_in > 0.001 {
            clip.fade_in.min(dur / 2.0)
        } else {
            DEFAULT_FADE.min(dur / 2.0)
        };
        let fade_out = if clip.fade_out > 0.001 {
            clip.fade_out.min(dur / 2.0)
        } else {
            DEFAULT_FADE.min(dur / 2.0)
        };
        let fade_out_start = (dur - fade_out).max(0.0);
        let vol = clip.volume.max(0.0); // 线性增益，0=静音
        // 降噪：noise_reduction 0-100 映射到 afftdn nr 0-25dB（剪映默认强度适中，避免过降噪损伤人声）
        let nr_db = (clip.noise_reduction / 100.0 * 25.0).clamp(0.0, 25.0);
        let nr_filter = if nr_db > 0.01 {
            format!(",afftdn=nr={nr_db:.2}:nf=-25")
        } else {
            String::new()
        };
        // B5: volume 关键帧 -- 有则用动态表达式，否则静态值
        let vol_filter = if let Some(vol_kfs) = clip
            .keyframes
            .as_ref()
            .and_then(|k| k.volume.as_ref().filter(|v| !v.is_empty()))
        {
            keyframes_to_volume_filter(vol_kfs, vol)
        } else {
            format!("volume={vol:.4}")
        };
        // adelay + volume(clip音量/关键帧) + 降噪 + afade 淡入淡出
        filter.push_str(&format!(
            "[{i}:a]adelay={delay_ms}|{delay_ms},{vol_filter}{nr_filter},afade=t=in:st=0:d={fade_in:.3},afade=t=out:st={fade_out_start:.3}:d={fade_out:.3}[d{i}];"
        ));
    }
    let inputs_label: String = (0..n).map(|i| format!("[d{i}]")).collect();
    // normalize=0 禁止 amix 自动除以输入数（避免多轨混音变轻）
    // alimiter=limit=0.95 限峰到 -0.45dB，防止多轨叠加削波产生的电音/爆音
    filter.push_str(&format!(
        "{inputs_label}amix=inputs={n}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95:attack=5:release=50[aout]"
    ));

    args.push("-filter_complex".to_string());
    args.push(filter);
    args.push("-map".to_string());
    args.push("[aout]".to_string());
    args.push("-t".to_string());
    args.push(format!("{total_duration:.3}"));
    args.push("-ar".to_string());
    args.push("44100".to_string());
    args.push("-ac".to_string());
    args.push("2".to_string());
    args.push("-c:a".to_string());
    args.push("pcm_s16le".to_string());
    args.push(output.to_string_lossy().to_string());

    let mix_output = Command::new("ffmpeg").args(&args).output().await?;
    if !mix_output.status.success() {
        anyhow::bail!(
            "音频合并失败：{}",
            String::from_utf8_lossy(&mix_output.stderr).trim()
        );
    }
    Ok(output.to_path_buf())
}

/// 根据比例 + 预览/导出分辨率计算宽高
/// 根据 clip 的滤镜和色彩调节生成 ffmpeg filter 片段
/// 返回追加到视频 filter 链后面的字符串（如 ",eq=brightness=0.1:contrast=1.2:saturation=1.5"）
/// 画面裁剪（源帧百分比 → ffmpeg crop 滤镜，在 scale 之前执行）
fn clip_source_crop(clip: &Clip) -> String {
    if let Some(ref crop) = clip.crop {
        let has_crop = (crop.width - 100.0).abs() > 0.01
            || (crop.height - 100.0).abs() > 0.01
            || crop.x.abs() > 0.01
            || crop.y.abs() > 0.01;
        if has_crop {
            let x = crop.x / 100.0;
            let y = crop.y / 100.0;
            let w = crop.width / 100.0;
            let h = crop.height / 100.0;
            return format!(",crop=iw*{w:.5}:ih*{h:.5}:iw*{x:.5}:ih*{y:.5}:exact=0");
        }
    }
    String::new()
}

fn clip_color_filter(clip: &Clip) -> String {
    let mut parts: Vec<String> = Vec::new();

    // 第一步：色彩调节（eq 滤镜，和预览 shader 一致）
    let brightness = clip.brightness / 100.0;
    let contrast = 1.0 + clip.contrast / 100.0;
    let saturation = 1.0 + clip.saturation / 100.0;
    if brightness.abs() > 0.001
        || (contrast - 1.0).abs() > 0.001
        || (saturation - 1.0).abs() > 0.001
    {
        parts.push(format!(
            "eq=brightness={brightness:.3}:contrast={contrast:.3}:saturation={saturation:.3}"
        ));
    }

    // 色温/色调（colorbalance 滤镜）
    // temperature -100..100 映射到 rs/rm/rh (-0.5..0.5)：正=暖（红增强），负=冷（蓝增强）
    // tint -100..100 映射到 gs/gm/gh (-0.5..0.5)：正=品红（绿减少），负=绿（绿增强）
    let temperature = clip.temperature / 100.0;
    let tint = clip.tint / 100.0;
    if temperature.abs() > 0.001 || tint.abs() > 0.001 {
        // 色温：红正向，蓝反向（-temperature）使冷色更冷
        // 色调：绿反向（-tint）使正值为品红
        let rs = temperature * 0.3;
        let rm = temperature * 0.5;
        let rh = temperature * 0.3;
        let gs = -tint * 0.3;
        let gm = -tint * 0.5;
        let gh = -tint * 0.3;
        let bs = -temperature * 0.3;
        let bm = -temperature * 0.5;
        let bh = -temperature * 0.3;
        parts.push(format!(
            "colorbalance=rs={rs:.4}:gs={gs:.4}:bs={bs:.4}:rm={rm:.4}:gm={gm:.4}:bm={bm:.4}:rh={rh:.4}:gh={gh:.4}:bh={bh:.4}"
        ));
    }

    // 视觉特效（剪映式"特效"面板）
    if let Some(effects) = &clip.visual_effects {
        for eff in effects {
            let intensity = eff.intensity.max(0.0).min(100.0) / 100.0;
            match eff.kind.as_str() {
                // 暗角：vignette 滤镜
                "vignette" => {
                    let k = intensity * 0.8;
                    parts.push(format!("vignette=PI/5+{k:.4}"));
                }
                // 边缘发光：gblur 简化版（完整 glow 需 overlay blend，这里单独模糊）
                "glow" => {
                    let sigma = 1.0 + intensity * 4.0;
                    parts.push(format!("gblur=sigma={sigma:.2}"));
                }
                // 镜像
                "mirror" => {
                    parts.push("hflip".to_string());
                }
                // 反色
                "invert" => {
                    parts.push("negate".to_string());
                }
                // 灰度
                "grayscale" => {
                    parts.push("format=gray,format=yuv420p".to_string());
                }
                // 闪烁：hue 周期性偏移
                "flicker" => {
                    let h = intensity * 30.0;
                    parts.push(format!("hue=h='{h}*sin(t)'"));
                }
                // 抖动：crop 周期性偏移
                "shake" => {
                    let amp = intensity * 8.0;
                    parts.push(format!(
                        "crop=iw-2*{amp}:ih-2*{amp}:x='{amp}+{amp}*sin(2*PI*t)':y='{amp}+{amp}*cos(3*PI*t)'"
                    ));
                }
                _ => {}
            }
        }
    }

    // 第二步：LUT 预设滤镜（lut3d，和预览 WebGL LUT 一致 → WYSIWYG）
    if let Some(filter_name) = &clip.filter {
        if filter_name != "none" {
            // 检查是否有嵌入的 LUT 数据
            if let Some(lut_content) = crate::lut_data::get_lut(filter_name) {
                // 写到临时文件供 ffmpeg lut3d 读取
                if let Ok(temp_dir) = std::env::temp_dir().canonicalize() {
                    let lut_path = temp_dir.join(format!("scenescript-lut-{filter_name}.cube"));
                    if std::fs::write(&lut_path, lut_content).is_ok() {
                        // M14: 统一路径转义（单引号 + 冒号）
                        let lut_str =
                            escape_filter_path(&lut_path.to_string_lossy().replace('\\', "/"))
                                .replace(':', "\\:");
                        parts.push(format!("lut3d=file='{lut_str}'"));
                    }
                }
            }
        }
    }

    if parts.is_empty() {
        String::new()
    } else {
        format!(",{}", parts.join(","))
    }
}

/// 统一的尺寸计算：根据比例 + 短边像素返回 (width, height)
fn dims_for_ratio(ratio: &str, short_edge: u32) -> (u32, u32) {
    match ratio {
        "16:9" => {
            // 横屏：短边=高度，宽度=短边*16/9
            let h = short_edge;
            let w = (h as f64 * 16.0 / 9.0) as u32;
            (w, h)
        }
        "1:1" => (short_edge, short_edge),
        _ => {
            // 9:16 竖屏：短边=宽度，高度=短边*16/9
            let w = short_edge;
            let h = (w as f64 * 16.0 / 9.0) as u32;
            (w, h)
        }
    }
}

/// 预览用低分辨率，导出用 renderConfig.resolution
fn dimensions_for_ratio(ratio: &str, preview: bool) -> (u32, u32) {
    if preview {
        return dims_for_ratio(ratio, 540); // 预览 540p 短边
    }
    dims_for_ratio(ratio, 1080) // 默认 1080p 短边
}

/// 根据项目的 renderConfig 返回导出尺寸
fn export_dimensions_for_project(project: &Project) -> (u32, u32) {
    let short_edge = match project.render_config.resolution.as_str() {
        "480p" => 480,
        "720p" => 720,
        "4k" | "2160p" => 2160,
        _ => 1080,
    };
    dims_for_ratio(&project.ratio, short_edge)
}

/// 转义 ffmpeg 滤镜参数里的单引号（M14）：' → '\''（用于 subtitles/lut3d 的 file= 路径）

/// T4.4: 生成蒙版的 alpha 滤镜表达式（用于 geq 的 a 通道）。
/// 返回的字符串是 geq 的 a= 表达式（不含 "a=" 前缀）。
fn mask_alpha_expr(mask: &crate::models::ClipMask) -> String {
    let feather = mask.feather.max(0.0);
    let base = match mask.kind.as_str() {
        "circle" => {
            let rx = (mask.width / 2.0).max(0.01);
            let ry = (mask.height / 2.0).max(0.01);
            let cx = mask.cx;
            let cy = mask.cy;
            let d = format!("pow((X/W-{cx})/{rx},2)+pow((Y/H-{cy})/{ry},2)");
            if feather <= 0.0001 {
                format!("if(gt(({d}),1),0,255)")
            } else {
                format!("255*clip((1+{feather}-({d}))/{feather},0,1)")
            }
        }
        "rect" => {
            let l = mask.cx - mask.width / 2.0;
            let r = mask.cx + mask.width / 2.0;
            let t = mask.cy - mask.height / 2.0;
            let b = mask.cy + mask.height / 2.0;
            let edge_dist = format!("min(min(X/W-{l},{r}-X/W),min(Y/H-{t},{b}-Y/H))");
            if feather <= 0.0001 {
                format!("if(lt({edge_dist},0),0,255)")
            } else {
                format!("255*clip(({edge_dist})/{feather},0,1)")
            }
        }
        "linear" | "mirror" => {
            let f = feather.max(0.0001);
            if mask.kind == "mirror" {
                format!("255*clip((1-abs(2*X/W-1))/{f},0,1)")
            } else {
                format!("255*clip((X/W)/{f},0,1)")
            }
        }
        _ => "255".to_string(),
    };
    let masked = if mask.invert {
        format!("255-({base})")
    } else {
        base
    };
    format!("alpha(X,Y)*({masked})/255")
}

/// T4.2: 把关键帧序列编译为 ffmpeg overlay 的 x/y 分段线性表达式。
/// 输出形如：if(lt(t,t0),v0+(t-t0)*(v1-v0)/(t1-t0), if(lt(t,t1),...))
/// t 是 ffmpeg 内置时间变量（秒）。offset 把关键帧的相对 clip 时间对齐到段内时间。
/// axis "x" → (w-W)*pct，"y" → (h-H)*pct（把 0-100 值转成像素百分比）
fn keyframes_to_overlay_expr(
    kfs: &[crate::models::Keyframe],
    fallback: f64,
    offset: f64,
    axis: &str,
) -> String {
    let (dim, dim_cap) = if axis == "x" { ("w", "W") } else { ("h", "H") };
    if kfs.is_empty() {
        let pct = fallback.clamp(0.0, 100.0) / 100.0;
        return format!("({dim}-{dim_cap})*{pct:.4}");
    }
    let expr = compile_keyframe_expression(kfs, fallback, offset, "t");
    format!("({dim}-{dim_cap})*({expr})/100")
}

/// B5: 把 volume 关键帧编译为 ffmpeg volume 滤镜的表达式。
/// volume 值是线性增益（1.0=原音量，0.0=静音）。
/// t 变量在 adelay 之后从 0 开始，对应 clip 播放时间，所以 offset=0。
fn keyframes_to_volume_filter(kfs: &[crate::models::Keyframe], fallback: f64) -> String {
    if kfs.is_empty() {
        return format!("volume={fallback:.4}");
    }
    let expr = compile_keyframe_expression(kfs, fallback, 0.0, "t");
    format!("volume='{expr}':eval=frame")
}

/// B2: 静态旋转滤镜。90/180/270 度用 transpose（更快），其他角度用 rotate。
/// 返回的字符串不含前导逗号（调用方自行加）。
fn rotation_filter(rotation: f64) -> String {
    if rotation.abs() < 0.01 {
        return String::new();
    }
    let deg = rotation % 360.0;
    if (deg - 90.0).abs() < 0.5 {
        ",transpose=1".to_string()
    } else if (deg - 180.0).abs() < 0.5 {
        ",transpose=1,transpose=1".to_string()
    } else if (deg - 270.0).abs() < 0.5 || (deg + 90.0).abs() < 0.5 {
        ",transpose=2".to_string()
    } else {
        let rad = deg * std::f64::consts::PI / 180.0;
        format!(",format=rgba,rotate={rad:.6}:fillcolor=black@0:ow=hypot(iw,ih):oh=hypot(iw,ih),format=yuva420p")
    }
}

fn escape_filter_path(path: &str) -> String {
    path.replace('\'', "'\\''")
}

fn sanitize_file_stem(value: &str) -> String {
    value
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect()
}

fn xfade_filter_name(name: &str) -> &str {
    match name {
        "slide" => "slideleft",
        "zoom" => "smoothleft",
        "wipe" => "wipeleft",
        "blur" => "dissolve",
        "fade" | "dissolve" | "fadeblack" | "fadewhite" | "wipeleft" | "wiperight" | "wipeup"
        | "wipedown" | "slideleft" | "slideright" | "slideup" | "slidedown" | "smoothleft"
        | "smoothright" | "smoothup" | "smoothdown" | "circleopen" | "circleclose" | "radial"
        | "horzopen" | "horzclose" | "vertopen" | "vertclose" | "diagbl" | "diagbr" | "diagtl"
        | "diagtr" | "hlslice" | "hrslice" | "vuslice" | "vdslice" | "hblur" | "fadegrays"
        | "pixellize" | "sshred" => name,
        _ => "fade",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{MediaSource, Project, RenderConfig, Track, TrackKind};
    use crate::source_window::SourceWindowPart;

    fn clip(id: &str, track_id: &str, start: f64, duration: f64) -> Clip {
        Clip {
            id: id.to_string(),
            track_id: track_id.to_string(),
            source_id: Some(format!("source-{id}")),
            start_on_track: start,
            duration,
            source_in: 0.0,
            source_out: duration,
            speed: 1.0,
            speed_curve: None,
            volume: 1.0,
            fade_in: 0.0,
            fade_out: 0.0,
            noise_reduction: 0.0,
            filter: None,
            brightness: 0.0,
            contrast: 0.0,
            saturation: 0.0,
        temperature: 0.0,
        tint: 0.0,
            transform: None,
            keyframes: None,
            mask: None,
        visual_effects: None,
        reverse: false,
            visual_query: None,
            crop: None,
            text: None,
            subtitle_style: None,
            words: None,
            transition_in: None,
            transition_out: None,
        }
    }

    fn media(id: &str) -> MediaSource {
        MediaSource {
            id: id.to_string(),
            kind: "video".to_string(),
            title: id.to_string(),
            url: None,
            local_path: Some(format!("/tmp/{id}.mp4")),
            proxy_path: None,
            proxy_status: None,
            proxy_width: None,
            proxy_height: None,
            thumbnail_url: None,
            width: 1920,
            height: 1080,
            duration: 10.0,
            source: "local".to_string(),
        }
    }

    fn track(id: &str, order: u32) -> Track {
        Track {
            id: id.to_string(),
            kind: TrackKind::Video,
            name: id.to_string(),
            order,
            muted: false,
            locked: false,
        hidden: false,
        height: 0,
        }
    }

    fn track_kind(id: &str, kind: TrackKind, hidden: bool) -> Track {
        Track {
            id: id.to_string(),
            kind,
            name: id.to_string(),
            order: 0,
            muted: false,
            locked: false,
            hidden,
            height: 0,
        }
    }

    fn project_for(clips: Vec<Clip>) -> Project {
        let media = clips
            .iter()
            .filter_map(|clip| clip.source_id.as_deref())
            .map(media)
            .collect();
        Project {
            id: "p".to_string(),
            title: "p".to_string(),
            script: String::new(),
            ratio: "16:9".to_string(),
            fps: 30,
            media,
            tracks: vec![track("v1", 2), track("v2", 1)],
            clips,
            render_config: RenderConfig::default(),
            chapters: Vec::new(),
            cover_time: None,
            preview_path: None,
            final_path: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn project_output_duration_uses_all_visible_track_kinds() {
        let mut project = project_for(vec![
            clip("video", "video", 0.0, 5.0),
            clip("audio", "audio", 0.0, 12.0),
            clip("subtitle", "subtitle", 10.0, 8.0),
            clip("hidden", "hidden", 0.0, 30.0),
            clip("orphan", "missing", 0.0, 40.0),
        ]);
        project.tracks = vec![
            track_kind("video", TrackKind::Video, false),
            track_kind("audio", TrackKind::Audio, false),
            track_kind("subtitle", TrackKind::Subtitle, false),
            track_kind("hidden", TrackKind::Video, true),
        ];

        assert!((project_output_duration(&project) - 18.0).abs() < 0.001);
    }

    #[test]
    fn source_window_filter_reverses_and_retimes_the_selected_source_range() {
        let part = SourceWindowPart {
            source_start: 15.0,
            source_end: 18.0,
            timeline_duration: 1.5,
            speed: 2.0,
            reverse: true,
        };

        let filter = apply_source_window_filter("scale=1920:1080".to_string(), &part);

        assert_eq!(
            filter,
            "scale=1920:1080,reverse,setpts=0.500000*(PTS-STARTPTS)"
        );
    }

    #[test]
    fn multi_part_source_filter_splits_trims_retimes_and_concats() {
        let parts = vec![
            SourceWindowPart {
                source_start: 0.0,
                source_end: 1.0,
                timeline_duration: 1.0,
                speed: 1.0,
                reverse: false,
            },
            SourceWindowPart {
                source_start: 2.0,
                source_end: 4.0,
                timeline_duration: 1.0,
                speed: 2.0,
                reverse: false,
            },
        ];

        let (filter, label) = compile_multi_part_source_filter(3, &parts)
            .expect("multiple parts must compile a source filter");

        assert_eq!(label, "[src3]");
        assert!(filter.contains("[3:v]split=2[src3in0][src3in1]"));
        assert!(filter.contains(
            "[src3in0]trim=start=0.000000:end=1.000000,setpts=PTS-STARTPTS[src3part0]"
        ));
        assert!(filter.contains(
            "[src3in1]trim=start=2.000000:end=4.000000,setpts=0.500000*(PTS-STARTPTS)[src3part1]"
        ));
        assert!(filter.contains("[src3part0][src3part1]concat=n=2:v=1:a=0[src3]"));
    }

    #[test]
    fn multi_part_source_filter_preserves_reverse_timeline_order() {
        let parts = vec![
            SourceWindowPart {
                source_start: 3.0,
                source_end: 4.0,
                timeline_duration: 1.0,
                speed: 1.0,
                reverse: true,
            },
            SourceWindowPart {
                source_start: 1.0,
                source_end: 3.0,
                timeline_duration: 1.0,
                speed: 2.0,
                reverse: true,
            },
        ];

        let (filter, _) = compile_multi_part_source_filter(0, &parts)
            .expect("reverse parts must compile");

        let first = filter
            .find("trim=start=3.000000:end=4.000000,reverse")
            .expect("first reverse part missing");
        let second = filter
            .find("trim=start=1.000000:end=3.000000,reverse")
            .expect("second reverse part missing");
        assert!(first < second);
    }

}
