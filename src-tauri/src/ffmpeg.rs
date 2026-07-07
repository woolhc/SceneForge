use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tokio::process::Command;

/// 缓存的硬件编码器名称（首次检测后缓存）
static HW_ENCODER: OnceLock<String> = OnceLock::new();

/// 在首次渲染时调用，预检测硬件编码器
pub async fn init_hw_encoder() {
    if HW_ENCODER.get().is_some() {
        return;
    }
    let encoder = detect_hw_encoder().await;
    let _ = HW_ENCODER.set(encoder);
}

use crate::models::{Clip, FfmpegStatus, MediaSource, Project, TrackKind};

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

/// 检测可用的硬件编码器（GPU 加速）。
/// macOS: h264_videotoolbox
/// Windows: h264_nvenc (NVIDIA) / h264_qsv (Intel)
/// Linux: h264_vaapi
/// 回退: libx264 (CPU)
pub async fn detect_hw_encoder() -> String {
    let candidates: &[&str] = &[
        "h264_videotoolbox",  // macOS
        "h264_nvenc",         // NVIDIA
        "h264_qsv",           // Intel QuickSync
        "h264_vaapi",         // Linux
    ];
    // M15: -encoders 只跑一次（之前循环内重复跑）
    let encoders_text = match Command::new("ffmpeg").args(["-hide_banner", "-encoders"]).output().await {
        Ok(out) => String::from_utf8_lossy(&out.stdout).to_string(),
        Err(_) => return "libx264".to_string(),
    };
    for &encoder in candidates {
        if !encoders_text.contains(encoder) {
            continue;
        }
        // 验证能否真正工作（快速测试编码）
        let test = Command::new("ffmpeg")
            .args([
                "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.1",
                "-c:v", encoder, "-f", "null", "-",
            ])
            .output()
            .await;
        if let Ok(t) = test {
            if t.status.success() {
                return encoder.to_string();
            }
        }
    }
    "libx264".to_string() // CPU 回退（M15: 删除读未初始化 OnceLock 的死代码）
}

/// 根据编码器返回 (encoder_name, extra_args)。
/// 硬件编码器不需要 preset，需要 bitrate 控制。
/// codec: "h264"（默认）| "hevc"（T4.10）
pub fn encoder_args(encoder: &str, preview: bool) -> (String, Vec<String>) {
    // 优先用传入的 encoder，回退到全局缓存的硬件编码器
    let enc = if encoder == "libx264" || encoder == "libx265" {
        HW_ENCODER.get().map(|s| s.as_str()).unwrap_or("libx264")
    } else {
        encoder
    };
    match enc {
        "h264_videotoolbox" | "h264_nvenc" | "h264_qsv" | "h264_vaapi" => {
            let bitrate = if preview { "2M" } else { "8M" };
            (enc.to_string(), vec!["-b:v".to_string(), bitrate.to_string()])
        }
        "hevc_videotoolbox" | "hevc_nvenc" | "hevc_qsv" | "hevc_vaapi" => {
            // T4.10: HEVC 硬件编码
            let bitrate = if preview { "2M" } else { "6M" }; // HEVC 同等质量码率更低
            (enc.to_string(), vec!["-b:v".to_string(), bitrate.to_string()])
        }
        _ => {
            // 软编：libx264 或 libx265
            let is_hevc = enc.contains("265") || encoder.contains("265") || encoder == "hevc";
            let lib = if is_hevc { "libx265" } else { "libx264" };
            let preset = if preview { "ultrafast" } else { "veryfast" };
            let crf = if preview { "30" } else { if is_hevc { "28" } else { "23" } };
            (lib.to_string(), vec![
                "-preset".to_string(), preset.to_string(),
                "-crf".to_string(), crf.to_string(),
            ])
        }
    }
}

/// 把素材下载 / 缓存到 app 数据目录，返回本地路径。
/// 兼容：本地路径（已是本地则直接返回）、远程 url（下载）。
pub async fn ensure_media_local(
    cache_dir: &Path,
    source: &MediaSource,
) -> anyhow::Result<PathBuf> {
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
        let bytes = reqwest::get(url).await?.bytes().await?;
        tokio::fs::write(&output_path, bytes).await?;
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
    let output_path = audio_dir.join(format!("{}-{}.wav", stem, chrono::Utc::now().timestamp_millis()));

    let output = Command::new("ffmpeg")
        .args([
            "-y",
            "-i",
            &video_path.to_string_lossy(),
            "-vn",          // 不要视频
            "-acodec",
            "pcm_s16le",    // wav 格式
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
    let separator_check = Command::new("audio-separator").arg("--version").output().await;
    if separator_check.is_ok() && separator_check.unwrap().status.success() {
        let output = Command::new("audio-separator")
            .args([
                &audio_path.to_string_lossy(),
                "--two_stems", "vocals",
                "-o", &out_dir.to_string_lossy(),
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
            "-y", "-i", &audio_path.to_string_lossy(),
            "-af", "pan=mono|c0=0.5*FL+0.5*FR",  // 左右相加 = 中置（人声）
            "-ar", "44100",
            &vocals_path.to_string_lossy(),
        ])
        .output().await?;
    if !vocals_out.status.success() {
        anyhow::bail!("人声分离失败（FFmpeg）：{}", String::from_utf8_lossy(&vocals_out.stderr).trim());
    }

    // 伴奏近似：左右相减消除中置（人声）
    let inst_out = Command::new("ffmpeg")
        .args([
            "-y", "-i", &audio_path.to_string_lossy(),
            "-af", "pan=stereo|c0=c0-c1|c1=c1-c0",  // 左右相减 = 消除中置
            "-ar", "44100",
            &instrumental_path.to_string_lossy(),
        ])
        .output().await?;
    if !inst_out.status.success() {
        anyhow::bail!("伴奏分离失败（FFmpeg）：{}", String::from_utf8_lossy(&inst_out.stderr).trim());
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
    let id = format!(
        "{}-{}",
        sanitize_file_stem(stem),
        (at * 1000.0) as u64
    );
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
        let id = format!(
            "{}-{}-{}",
            sanitize_file_stem(stem),
            (t * 1000.0) as u64,
            i
        );
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
    // 用高采样率解码，保留细节（44100Hz = 原始 CD 质量）
    let sample_rate = 44100u32;
    let output = Command::new("ffmpeg")
        .args([
            "-y",
            "-i",
            &audio_path.to_string_lossy(),
            "-ac", "1",           // 单声道
            "-ar", &sample_rate.to_string(),
            "-f", "f32le",        // 32-bit float little-endian PCM
            "pipe:1",             // 输出到 stdout
        ])
        .output()
        .await?;

    if !output.status.success() {
        anyhow::bail!("波形生成失败：{}", String::from_utf8_lossy(&output.stderr).trim());
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
    // 首次渲染时检测硬件编码器（GPU 加速），后续从缓存读取
    if HW_ENCODER.get().is_none() {
        init_hw_encoder().await;
    }
    // T4.10: 根据用户选的 codec（h264/hevc）决定编码器
    let want_hevc = project.render_config.codec == "hevc";
    let hw = if want_hevc {
        // HEVC 模式：把 h264 硬件编码器名替换为 hevc 变体
        match HW_ENCODER.get().map(|s| s.as_str()).unwrap_or("libx264") {
            "h264_videotoolbox" => "hevc_videotoolbox",
            "h264_nvenc" => "hevc_nvenc",
            "h264_qsv" => "hevc_qsv",
            "h264_vaapi" => "hevc_vaapi",
            _ => "libx265",
        }
    } else {
        HW_ENCODER.get().map(|s| s.as_str()).unwrap_or("libx264")
    }.to_string();
    eprintln!("使用编码器: {hw}");

    // 统一计算目标尺寸：preview 用 540p 短边，导出用 renderConfig.resolution
    // 保证所有段 + 字幕坐标系 + xfade 合并全部使用同一组尺寸
    let (target_w, target_h) = if preview {
        dimensions_for_ratio(&project.ratio, true)
    } else {
        export_dimensions_for_project(project)
    };

    // 收集视频轨 + 图片轨（图片轨叠加在视频轨之上）
    let mut video_tracks: Vec<&crate::models::Track> = project
        .tracks
        .iter()
        .filter(|t| t.kind == TrackKind::Video || t.kind == TrackKind::Image)
        .collect();
    video_tracks.sort_by(|a, b| b.order.cmp(&a.order)); // order 大在前=底层
    let video_track_ids: Vec<String> = video_tracks.iter().map(|t| t.id.clone()).collect();

    let video_clips: Vec<&Clip> = project
        .clips
        .iter()
        .filter(|c| video_track_ids.contains(&c.track_id))
        .collect();

    if video_clips.is_empty() {
        anyhow::bail!("时间线上没有视频片段");
    }

    // 计算时间轴总时长
    let total_duration = video_clips
        .iter()
        .map(|c| c.start_on_track + c.duration)
        .fold(0.0_f64, f64::max);

    // 切分时间段：收集所有 clip 的起止边界点
    let mut boundaries: Vec<f64> = vec![0.0];
    for clip in &video_clips {
        boundaries.push(clip.start_on_track);
        boundaries.push(clip.start_on_track + clip.duration);
    }
    boundaries.push(total_duration);
    boundaries.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    boundaries.dedup_by(|a, b| (*a - *b).abs() < 0.01);

    // 构造时间段：相邻边界之间为一段
    let mut segments: Vec<(f64, f64)> = Vec::new();
    for window in boundaries.windows(2) {
        let start = window[0];
        let end = window[1];
        if end - start > 0.05 {
            segments.push((start, end));
        }
    }

    // T2.5: 用 TempDirGuard 管理段渲染临时目录，函数返回时自动清理
    let render_tmp_base = std::path::PathBuf::from("/tmp/scenescript-render");
    tokio::fs::create_dir_all(&render_tmp_base).await.ok();
    let segment_guard = crate::temp::TempDirGuard::new(&render_tmp_base, "segments")?;
    let segment_dir = segment_guard.path().to_path_buf();
    tokio::fs::create_dir_all(&segment_dir).await?;

    // 渲染每一段
    let mut segment_paths = Vec::new();
    let total_segs = segments.len();
    for (seg_index, (seg_start, seg_end)) in segments.iter().enumerate() {
        // T3.3: 检查取消标志
        if let Some(flag) = cancel_flag {
            if flag.load(std::sync::atomic::Ordering::Relaxed) {
                anyhow::bail!("渲染已取消");
            }
        }
        // T3.3: 段级进度（0-70% 分配给段渲染）
        if let Some(cb) = progress_cb {
            let percent = ((seg_index as f64 / total_segs.max(1) as f64) * 70.0) as u32;
            cb(percent, &format!("渲染片段 {}/{total_segs}", seg_index + 1));
        }
        let seg_duration = seg_end - seg_start;
        // 找到该段内活跃的 clip（按轨道层次顺序：底层在前）
        let mut active_clips: Vec<&Clip> = video_clips
            .iter()
            .filter(|c| {
                c.start_on_track < *seg_end - 0.01
                    && c.start_on_track + c.duration > *seg_start + 0.01
            })
            .copied()
            .collect();
        // 按轨道层次排序：video_track_ids 顺序即层次（前=底层）
        active_clips.sort_by_key(|c| video_track_ids.iter().position(|t| *t == c.track_id).unwrap_or(0));

        // 空段（无活跃 clip）：渲染纯黑背景，保证时间线连续
        if active_clips.is_empty() {
            let path = render_black_segment(
                &segment_dir,
                project,
                seg_duration,
                seg_index,
                preview,
                &hw,
                target_w,
                target_h,
            )
            .await?;
            segment_paths.push(path);
            continue;
        }

        let path = render_segment_with_overlay(
            cache_dir,
            &segment_dir,
            project,
            &active_clips,
            *seg_start,
            seg_duration,
            seg_index,
            preview,
            &hw,
            target_w,
            target_h,
        )
        .await?;
        segment_paths.push(path);
    }

    // 合并所有段：有转场的相邻段用 xfade，否则 concat
    let render_dir = projects_dir.join(&project.id).join("renders");
    tokio::fs::create_dir_all(&render_dir).await?;
    let raw_output = render_dir.join(if preview { "preview-raw.mp4" } else { "final-raw.mp4" });

    // 检查是否有任何 clip 设置了转场
    let has_transitions = video_clips.iter().any(|c| {
        c.transition_in.is_some() && c.transition_in.as_deref() != Some("none")
    });

    if !has_transitions || segment_paths.len() <= 1 {
        // 无转场：用 concat copy（快）
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

        let output = Command::new("ffmpeg")
            .args([
                "-y",
                "-f", "concat", "-safe", "0",
                "-i", &list_path.to_string_lossy(),
                "-c", "copy", "-movflags", "+faststart",
                &raw_output.to_string_lossy(),
            ])
            .output()
            .await?;
        if !output.status.success() {
            anyhow::bail!("拼接失败：{}", String::from_utf8_lossy(&output.stderr).trim());
        }
    } else {
        // 有转场：用 filter_complex xfade 逐段合并
        let transition_duration = 0.5; // 默认转场 0.5 秒
        // 收集每段的时长
        let seg_durations: Vec<f64> = segments.iter().map(|(s, e)| e - s).collect();
        // 构建 filter_complex
        let mut args: Vec<String> = vec!["-y".to_string()];
        for p in &segment_paths {
            args.push("-i".to_string());
            args.push(p.to_string_lossy().to_string());
        }
        let mut filter = String::new();
        let mut prev_label = "[0:v]".to_string();
        let mut accumulated = seg_durations[0];
        for i in 1..segment_paths.len() {
            // 查这个段对应的 clip 是否有转场
            let seg_start = segments[i].0;
            let clip_with_trans = video_clips.iter().find(|c| {
                (c.start_on_track - seg_start).abs() < 0.5
                    && c.transition_in.is_some()
                    && c.transition_in.as_deref() != Some("none")
            });
            let xfade_type = clip_with_trans
                .and_then(|c| c.transition_in.as_deref())
                .unwrap_or("fade");
            let xfade_name = match xfade_type {
                "slide" => "slideleft",
                "zoom" => "smoothleft",
                "wipe" => "wipeleft",
                "blur" => "dissolve",
                _ => "fade",
            };
            let this_label = format!("[{}:v]", i);
            let out_label = format!("[v{}]", i);
            // xfade：offset = accumulated - transition_duration（转场从上一段末尾开始重叠）
            let offset = (accumulated - transition_duration).max(0.0);
            filter.push_str(&format!(
                "{prev_label}{this_label}xfade=transition={xfade_name}:duration={transition_duration}:offset={offset:.3}{out_label};"
            ));
            prev_label = out_label.clone();
            // xfade 后总时长 = 前面累积 + 本段 - 转场重叠
            accumulated += seg_durations[i] - transition_duration;
        }
        let filter = filter.trim_end_matches(';');
        args.push("-filter_complex".to_string());
        args.push(filter.to_string());
        args.push("-map".to_string());
        args.push(prev_label);
        // 编码器：统一用 encoder_args（硬件编码器用 bitrate，软编用 preset+crf）
        let (xfade_enc_name, xfade_enc_extra) = encoder_args(&hw, preview);
        args.push("-c:v".to_string());
        args.push(xfade_enc_name);
        args.extend(xfade_enc_extra);
        args.push("-r".to_string());
        args.push(format!("{}", project.render_config.fps));
        args.push("-an".to_string());
        args.push("-movflags".to_string());
        args.push("+faststart".to_string());
        args.push(raw_output.to_string_lossy().to_string());

        let output = Command::new("ffmpeg").args(&args).output().await?;
        if !output.status.success() {
            // xfade 失败时回退到 concat
            eprintln!("xfade 转场失败，回退到 concat：{}", String::from_utf8_lossy(&output.stderr).trim());
            let list_path = cache_dir.join(format!("concat-fallback-{}-{}.txt", project.id, chrono::Utc::now().timestamp_millis()));
            let list_content = segment_paths.iter().map(|path| format!("file '{}'\n", path.to_string_lossy().replace('\'', "'\\''"))).collect::<String>();
            tokio::fs::write(&list_path, list_content).await?;
            let fallback = Command::new("ffmpeg")
                .args(["-y", "-f", "concat", "-safe", "0", "-i", &list_path.to_string_lossy(), "-c", "copy", "-movflags", "+faststart", &raw_output.to_string_lossy()])
                .output().await?;
            if !fallback.status.success() {
                anyhow::bail!("拼接失败：{}", String::from_utf8_lossy(&fallback.stderr).trim());
            }
        }
    }

    // 第二遍：叠加配音轨 + 烧录字幕轨
    // T3.3: 进度 70→85%（视频拼接完成）
    if let Some(cb) = progress_cb {
        cb(70, "视频拼接完成，正在烧录字幕和混音...");
    }
    // 转场偏移表：xfade 会让视频总长缩短，音频/字幕需要同步平移
    // 收集所有转场的发生时间点（转场前一段的结束时间）和缩短量
    let transition_shrink_points = if has_transitions && segments.len() > 1 {
        let td = 0.5_f64;
        let mut points: Vec<(f64, f64)> = Vec::new();
        let mut acc = segments[0].1 - segments[0].0; // 第一段时长
        for i in 1..segments.len() {
            let seg_start = segments[i].0;
            let has_trans = video_clips.iter().any(|c| {
                (c.start_on_track - seg_start).abs() < 0.5
                    && c.transition_in.is_some()
                    && c.transition_in.as_deref() != Some("none")
            });
            if has_trans {
                // 转场在 acc - td 处发生（前一段末尾开始重叠）
                // 该转场使后续时间线累计缩短 td
                points.push((acc, td));
                acc += (segments[i].1 - segments[i].0) - td;
            } else {
                acc += segments[i].1 - segments[i].0;
            }
        }
        points
    } else {
        Vec::new()
    };

    let result = burn_subtitle_and_mix_audio(cache_dir, projects_dir, project, &raw_output, preview, &transition_shrink_points).await?;
    // T3.3: 进度 100%
    if let Some(cb) = progress_cb {
        cb(100, "渲染完成");
    }
    Ok(result)
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
    let (enc_name, enc_extra) = encoder_args(encoder, preview);
    let output_path = segment_dir.join(format!("seg-{:03}.mp4", seg_index));
    let filter = format!("color=c=black:s={width}x{height}:r={},format=yuv420p", project.render_config.fps);
    let mut args: Vec<String> = vec![
        "-y".to_string(),
        "-f".to_string(), "lavfi".to_string(),
        "-i".to_string(), filter,
        "-t".to_string(), format!("{:.3}", seg_duration),
        "-c:v".to_string(), enc_name,
    ];
    args.extend(enc_extra);
    args.extend([
        "-an".to_string(),
        "-movflags".to_string(), "+faststart".to_string(),
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
            cache_dir, segment_dir, project, clip, seg_start, seg_duration, seg_index, preview, encoder, width, height,
        )
        .await;
    }

    // 多 clip：用 filter_complex 叠加
    // 准备每个 clip 的本地文件路径 + 素材类型作为输入
    let mut inputs: Vec<(PathBuf, &Clip, bool)> = Vec::new(); // (path, clip, is_image)
    for clip in active_clips {
        let source = match project
            .media
            .iter()
            .find(|m| Some(&m.id) == clip.source_id.as_ref()) {
            Some(s) => s,
            None => continue, // 跳过未绑定素材的 clip（避免渲染崩溃）
        };
        let local_path = ensure_media_local(cache_dir, source).await?;
        inputs.push((local_path, *clip, source.kind == "image"));
    }
    if inputs.is_empty() {
        anyhow::bail!("该时间段没有已绑定素材的视频片段");
    }

    // 构造 ffmpeg 命令：图片用 -loop 1，视频用 -ss 定位
    let mut args: Vec<String> = vec!["-y".to_string()];
    for (local_path, clip, is_image) in &inputs {
        if *is_image {
            args.push("-loop".to_string());
            args.push("1".to_string());
            args.push("-t".to_string());
            args.push(format!("{:.3}", seg_duration));
            args.push("-i".to_string());
            args.push(local_path.to_string_lossy().to_string());
        } else {
            let offset_into_clip = (seg_start - clip.start_on_track).max(0.0);
            let source_time = clip.source_in + offset_into_clip * clip.speed.clamp(0.25, 4.0);
            args.push("-ss".to_string());
            args.push(format!("{:.3}", source_time));
            args.push("-t".to_string());
            args.push(format!("{:.3}", seg_duration));
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
    for (i, (_path, clip, _is_image)) in inputs.iter().enumerate() {
        let in_label = format!("[{}:v]", i);
        let out_label = format!("[v{}]", i);
        let tf = clip.transform.as_ref();
        // 第一层（底层）：全屏缩放裁切
        // 其他层：按 scale 缩放，按 x/y 定位
        let scale_expr = if i == 0 {
            format!(
                "scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"
            )
        } else {
            let scale_pct = tf.map(|t| t.scale).unwrap_or(100.0).max(1.0) / 100.0;
            let target_w = ((width as f64) * scale_pct).round() as u32;
            let target_h = ((height as f64) * scale_pct).round() as u32;
            format!("scale={target_w}:{target_h}:force_original_aspect_ratio=decrease")
        };

        // 画面裁剪（在 scale 之前，操作源帧）
        let source_crop = clip_source_crop(clip);
        let mut chain = if source_crop.is_empty() {
            scale_expr
        } else {
            format!("{}{}", source_crop.trim_start_matches(','), scale_expr)
        };
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
        if let Some(t) = tf {
            let opacity = (t.opacity).clamp(0.0, 100.0) / 100.0;
            if opacity < 1.0 {
                chain.push_str(&format!(",colorchannelmixer=aa={:.3}", opacity));
            }
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
            let x_pct = (tf.x).clamp(0.0, 100.0) / 100.0;
            let y_pct = (tf.y).clamp(0.0, 100.0) / 100.0;
            let overlay_x = format!("(w-W)*{:.4}", x_pct);
            let overlay_y = format!("(h-H)*{:.4}", y_pct);
            let this_label = format!("[v{}]", i);
            filter.push_str(&format!("{in_label}{chain}{this_label};"));
            let merged = format!("[m{}]", i);
            filter.push_str(&format!(
                "{prev_label}{this_label}overlay={overlay_x}:{overlay_y}{merged};"
            ));
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
    let (ovl_enc_name, ovl_enc_extra) = encoder_args(encoder, preview);
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
        .find(|m| Some(&m.id) == clip.source_id.as_ref()) {
        Some(s) => s,
        None => {
            // 未绑定素材 → 渲染纯黑段（避免崩溃）
            return render_black_segment(segment_dir, project, seg_duration, seg_index, preview, encoder, width, height).await;
        }
    };
    let local_path = ensure_media_local(cache_dir, source).await?;
    let scale_filter = format!(
        "scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},format=yuv420p"
    );
    let speed_abs = clip.speed.abs().clamp(0.25, 4.0);
    let is_reverse = clip.speed < 0.0;
    let color_fx = clip_color_filter(clip);
    let source_crop = clip_source_crop(clip);
    // crop 在 scale 之前执行（操作源帧）
    let mut video_filter = if source_crop.is_empty() {
        scale_filter.clone()
    } else {
        format!("{}{}", source_crop.trim_start_matches(','), scale_filter)
    };
    if is_reverse {
        video_filter.push_str(",reverse");
    }
    if (speed_abs - 1.0).abs() > f64::EPSILON {
        video_filter = format!("{video_filter},setpts={:.6}*PTS", 1.0 / speed_abs);
    }
    video_filter.push_str(&color_fx);

    let offset_into_clip = (seg_start - clip.start_on_track).max(0.0);
    let source_time = clip.source_in + offset_into_clip * speed_abs;
    let output_path = segment_dir.join(format!("seg-{:03}.mp4", seg_index));

    let is_image = source.kind == "image";
    let local_str = local_path.to_string_lossy().to_string();
    let mut args: Vec<String> = vec!["-y".to_string()];
    if is_image {
        // 图片：-loop 1 把单帧当无限循环视频，-t 限制输出时长
        args.push("-loop".to_string());
        args.push("1".to_string());
        args.push("-i".to_string());
        args.push(local_str);
    } else {
        // 视频：-ss 定位 + -stream_loop 循环（素材短于段时长时补足）
        args.push("-ss".to_string());
        args.push(format!("{:.3}", source_time));
        args.push("-stream_loop".to_string());
        args.push("-1".to_string());
        args.push("-i".to_string());
        args.push(local_str);
    }
    args.push("-t".to_string());
    args.push(format!("{:.3}", seg_duration));
    args.push("-vf".to_string());
    args.push(video_filter);
    args.push("-r".to_string());
    args.push(format!("{}", project.render_config.fps));
    // 编码器：统一用 encoder_args
    let (sc_enc_name, sc_enc_extra) = encoder_args(encoder, preview);
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
) -> anyhow::Result<PathBuf> {
    let render_dir = projects_dir.join(&project.id).join("renders");
    let output_path = render_dir.join(if preview { "preview.mp4" } else { "final.mp4" });

    // 收集配音轨 clip 的音频文件（按时间顺序），用于混音
    // 收集音频源 clip：配音轨 + 音频轨 + 未静音的视频轨（视频原声）
    // TrackKind::Video/Image 的 clip 如果 track.muted=false 且 clip.volume>0，
    // 其视频文件的音频流也参与混音（T3.4：视频原声参与导出）
    let mut audio_track_ids: Vec<String> = Vec::new();
    let mut muted_track_ids: Vec<String> = Vec::new();
    for t in &project.tracks {
        match t.kind {
            TrackKind::Voiceover | TrackKind::Audio => {
                audio_track_ids.push(t.id.clone());
            }
            TrackKind::Video | TrackKind::Image => {
                if !t.muted {
                    audio_track_ids.push(t.id.clone());
                } else {
                    muted_track_ids.push(t.id.clone());
                }
            }
            TrackKind::Subtitle => {}
        }
    }
    let mut audio_clips: Vec<&Clip> = project
        .clips
        .iter()
        .filter(|c| {
            // 排除静音轨 + 排除 clip.volume==0 的视频 clip
            if muted_track_ids.contains(&c.track_id) {
                return false;
            }
            if audio_track_ids.contains(&c.track_id) {
                // 视频轨 clip 只在 volume > 0 时参与（volume=0 表示用户单独静音了该 clip）
                return c.volume > 0.0;
            }
            false
        })
        .collect();
    audio_clips.sort_by(|a, b| {
        a.start_on_track
            .partial_cmp(&b.start_on_track)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // 收集字幕轨 clip，生成 .ass 字幕文件
    let subtitle_track_ids: Vec<String> = project
        .tracks
        .iter()
        .filter(|t| t.kind == TrackKind::Subtitle)
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
    let has_audio = audio_clips
        .iter()
        .any(|c| c.source_id.is_some());

    // 无字幕且无配音 → 直接拷贝
    if !has_subtitles && !has_audio {
        tokio::fs::copy(video_input, &output_path).await?;
        return Ok(output_path);
    }

    // 生成 .ass 字幕文件
    let ass_path = if has_subtitles {
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
        match merge_audio_clips(cache_dir, &merged, &audio_clips, project, &project.media, transition_shrink_points).await {
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
    let mut args: Vec<String> = vec!["-y".to_string(), "-i".to_string(), video_input.to_string_lossy().to_string()];

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
        let ass_str = escape_filter_path(&ass_file.to_string_lossy().replace('\\', "/")).replace(':', "\\:");
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
    let (burn_enc_name, burn_enc_extra) = encoder_args(
        HW_ENCODER.get().map(|s| s.as_str()).unwrap_or("libx264"),
        preview,
    );
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

    let output = Command::new("ffmpeg").args(&args).output().await?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        // 字幕/混音失败时尝试无字幕版本（去掉 subtitles 滤镜重试一次）
        eprintln!("字幕烧录/混音失败，尝试无字幕重试：{stderr}");
        // 重新构造命令：去掉 subtitles 滤镜
        let mut retry_args: Vec<String> = vec!["-y".to_string(), "-i".to_string(), video_input.to_string_lossy().to_string()];
        if merged_audio_path.is_some() {
            retry_args.push("-i".to_string());
            retry_args.push(merged_audio_path.as_ref().unwrap().to_string_lossy().to_string());
        }
        retry_args.push("-map".to_string());
        retry_args.push("0:v".to_string());
        if merged_audio_path.is_some() {
            retry_args.push("-map".to_string());
            retry_args.push("1:a".to_string());
        }
        retry_args.push("-c:v".to_string());
        // 重试也用 encoder_args（保持编码器一致，避免 concat 花屏）
        let (retry_enc_name, retry_enc_extra) = encoder_args(
            HW_ENCODER.get().map(|s| s.as_str()).unwrap_or("libx264"),
            preview,
        );
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
        let retry_output = Command::new("ffmpeg").args(&retry_args).output().await?;
        if !retry_output.status.success() {
            // 最终回退：无字幕无混音的裸拷贝
            eprintln!("无字幕重试也失败，输出裸视频：{}", String::from_utf8_lossy(&retry_output.stderr).trim());
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
        let alignment = match style.position.as_str() {
            "top" => 8,
            "center" => 5,
            _ => 2,
        };
        let margin_v = if style.position == "center" { height as i32 / 2 } else { (height as f64 * 0.06).round() as i32 };
        styles_str.push_str(&format!(
            "Style: {name},{font},{size},{primary},{secondary},{outline},&H80000000,0,0,0,0,{sx},{sy},0,{rot},1,4,1,{align},{mlr},{mlr},{mv},1\n",
            name = name,
            font = style.font_family,
            size = style.font_size,
            primary = primary,
            secondary = secondary,
            outline = outline,
            sx = style.scale_x,
            sy = style.scale_y,
            rot = style.rotation,
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
            .sum();
        let start = seconds_to_ass_time((clip.start_on_track - shrink_before).max(0.0));
        let end = seconds_to_ass_time((clip.start_on_track + clip.duration - shrink_before).max(0.0));

        let style_name = if let Some(ref s) = clip.subtitle_style {
            style_names.iter()
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
                    build_karaoke_text(words, clip.start_on_track, clip.duration)
                } else {
                    text.replace('{', "\\{").replace('}', "\\}").replace('\n', "\\N")
                }
            } else {
                text.replace('{', "\\{").replace('}', "\\}").replace('\n', "\\N")
            }
        } else {
            text.replace('{', "\\{").replace('}', "\\}").replace('\n', "\\N")
        };

        ass.push_str(&format!("Dialogue: 0,{start},{end},{style_name},,0,0,0,,{escaped}\n"));
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
        let escaped = w.text.replace('\\', "\\\\").replace('{', "\\{").replace('}', "\\}");
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
    // wav → mp3（libmp3lame）
    let mp3_output = if output.extension().and_then(|e| e.to_str()) == Some("mp3") {
        output.to_path_buf()
    } else {
        // 用户没指定 .mp3 后缀，强制改
        output.with_extension("mp3")
    };
    let convert = Command::new("ffmpeg")
        .args([
            "-y",
            "-i",
            &wav_path.to_string_lossy(),
            "-c:a",
            "libmp3lame",
            "-b:a",
            "192k",
            &mp3_output.to_string_lossy(),
        ])
        .output()
        .await?;
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
    project: &Project,
    media: &[crate::models::MediaSource],
    // 转场偏移表：(转场发生时间点, 缩短量)。clip 的 adelay 减去它之前所有转场的累计缩短量
    transition_shrink_points: &[(f64, f64)],
) -> anyhow::Result<PathBuf> {
    let total_duration = audio_clips
        .iter()
        .map(|c| c.start_on_track + c.duration)
        .fold(0.0_f64, f64::max);

    let tmp_dir = cache_dir.join("audio-merge");
    tokio::fs::create_dir_all(&tmp_dir).await?;

    // 为每个 clip 生成一段音频（在时间线上偏移 + 时长对齐）
    let mut segment_paths: Vec<PathBuf> = Vec::new();
    for (i, clip) in audio_clips.iter().enumerate() {
        let source = clip
            .source_id
            .as_ref()
            .and_then(|sid| media.iter().find(|m| m.id == *sid));
        let Some(source) = source else { continue };
        let Some(local_path) = &source.local_path else { continue };

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
        segment_paths.push(seg_path);
    }

    if segment_paths.is_empty() {
        anyhow::bail!("没有可用的音频片段");
    }

    // 用 adelay + amix 把各段按 startOnTrack 偏移混合
    // 简化版：用 concat + adelay（每段前面插入静音 = startOnTrack - 前一段结束）
    let mut args: Vec<String> = vec!["-y".to_string()];
    for p in &segment_paths {
        args.push("-i".to_string());
        args.push(p.to_string_lossy().to_string());
    }

    // 构造 filter：每个输入加 adelay（按 startOnTrack 偏移）+ afade（淡入淡出），然后 amix
    let mut filter = String::new();
    let n = segment_paths.len();
    // 默认最小淡入淡出 30ms（消除 clip 首尾波形硬切导致的爆音，借鉴 video-use 的切点交叉淡入淡出）
    const DEFAULT_FADE: f64 = 0.03;
    for (i, clip) in audio_clips.iter().enumerate().take(n) {
        // 转场偏移：clip 起点之前所有转场累计缩短的时长，adelay 要减去它
        let shrink_before: f64 = transition_shrink_points
            .iter()
            .filter(|(t, _)| *t <= clip.start_on_track)
            .map(|(_, d)| *d)
            .sum();
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
        // adelay + volume(clip音量) + afade 淡入淡出
        filter.push_str(&format!(
            "[{i}:a]adelay={delay_ms}|{delay_ms},volume={vol:.4},afade=t=in:st=0:d={fade_in:.3},afade=t=out:st={fade_out_start:.3}:d={fade_out:.3}[d{i}];"
        ));
    }
    let inputs_label: String = (0..n).map(|i| format!("[d{i}]")).collect();
    // normalize=0 禁止 amix 自动除以输入数（避免多轨混音变轻）
    filter.push_str(&format!(
        "{inputs_label}amix=inputs={n}:duration=longest:dropout_transition=0:normalize=0[aout]"
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
    if brightness.abs() > 0.001 || (contrast - 1.0).abs() > 0.001 || (saturation - 1.0).abs() > 0.001 {
        parts.push(format!("eq=brightness={brightness:.3}:contrast={contrast:.3}:saturation={saturation:.3}"));
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
                        let lut_str = escape_filter_path(&lut_path.to_string_lossy().replace('\\', "/")).replace(':', "\\:");
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
fn escape_filter_path(path: &str) -> String {
    path.replace('\'', "'\\''")
}

fn sanitize_file_stem(value: &str) -> String {
    value
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect()
}
