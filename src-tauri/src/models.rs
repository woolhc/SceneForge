use serde::{Deserialize, Serialize};

// ============================================================================
// 应用基础信息
// ============================================================================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub app_data_dir: String,
    pub cache_dir: String,
    pub database_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegStatus {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub error: Option<String>,
}

// ============================================================================
// 设置（结构不变）
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub deepseek_api_key: String,
    pub pexels_api_key: String,
    pub tts_base_url: String,
    pub default_ratio: String,
    pub default_voice_id: Option<String>,
    pub render_preset: String,
    /// whisper-cli 可执行路径（brew 装默认 whisper-cli）
    #[serde(default = "default_whisper_bin")]
    pub whisper_bin: String,
    /// whisper 模型路径（brew 装默认 /opt/homebrew/share/whisper-cpp/large-v3.bin）
    #[serde(default = "default_whisper_model")]
    pub whisper_model: String,
}

fn default_whisper_bin() -> String {
    // macOS: brew install whisper-cpp → whisper-cli
    // Windows/Linux: 手动编译 → whisper-cli 或 whisper-cli.exe
    if cfg!(target_os = "windows") {
        "whisper-cli.exe".to_string()
    } else {
        "whisper-cli".to_string()
    }
}

fn default_whisper_model() -> String {
    // macOS brew: /opt/homebrew/share/whisper-cpp/
    // Windows: 用户自行下载，常见放 Documents 或程序同目录
    if cfg!(target_os = "windows") {
        // Windows 无默认安装路径，留空让用户填
        String::new()
    } else if cfg!(target_os = "macos") {
        // 默认用 medium-q5_0 量化模型（514MB，中文质量优秀，比 large-v3 小 6 倍）
        "/opt/homebrew/share/whisper-cpp/ggml-medium-q5_0.bin".to_string()
    } else {
        // Linux
        "/usr/local/share/whisper-cpp/ggml-medium-q5_0.bin".to_string()
    }
}

/// 单个词/字符的时间戳（用于逐字高亮卡拉OK字幕）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordCue {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// ASR 识别结果（带时间戳的字幕片段，整理前/后的中间结构）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleCue {
    pub start: f64,
    pub end: f64,
    pub text: String,
    /// 逐词/逐字时间戳（whisper -ml 1 模式下产出，可能为空）
    #[serde(default)]
    pub words: Vec<WordCue>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            deepseek_api_key: String::new(),
            pexels_api_key: String::new(),
            tts_base_url: "https://ttsttstts.cas-air.cn".to_string(),
            default_ratio: "9:16".to_string(),
            default_voice_id: None,
            render_preset: "preview-fast".to_string(),
            whisper_bin: default_whisper_bin(),
            whisper_model: default_whisper_model(),
        }
    }
}

// ============================================================================
// 音色（结构不变）
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceProfile {
    pub id: String,
    pub name: String,
    pub sample_path: Option<String>,
    #[serde(default)]
    pub reference_text: Option<String>,
    #[serde(default = "default_voice_language")]
    pub language: String,
    pub provider_voice_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVoiceProfileRequest {
    pub name: String,
    pub sample_path: Option<String>,
    #[serde(default)]
    pub reference_text: Option<String>,
    pub provider_voice_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportVoiceProfileRequest {
    pub name: String,
    pub file_name: String,
    pub bytes: Vec<u8>,
    #[serde(default)]
    pub reference_text: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateVoiceProfileRequest {
    pub name: Option<String>,
    pub reference_text: Option<String>,
    #[serde(default)]
    pub sample_path: Option<String>,
}

/// 替换已有音色的参考音频（重新上传样音）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceVoiceSampleRequest {
    pub voice_id: String,
    pub file_name: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoicePreviewRequest {
    pub voice_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoicePreviewResult {
    pub voice_id: String,
    pub audio_path: String,
    pub duration: f64,
}

fn default_voice_language() -> String {
    "Chinese".to_string()
}

// ============================================================================
// 核心数据模型：剪映式的 Track + Clip 多轨道结构
// ============================================================================

/// 轨道类型 —— 决定渲染层级和默认行为
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TrackKind {
    /// 主视频画面轨（最底层）
    Video,
    /// 图片轨（静态画面，叠加在视频上）
    Image,
    /// AI 配音轨（克隆音色生成的旁白）
    Voiceover,
    /// 本地音乐 / 音效轨
    Audio,
    /// 字幕轨（叠加文字，渲染时烧录）
    Subtitle,
}

impl TrackKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            TrackKind::Video => "video",
            TrackKind::Image => "image",
            TrackKind::Voiceover => "voiceover",
            TrackKind::Audio => "audio",
            TrackKind::Subtitle => "subtitle",
        }
    }
}

/// 素材库实体 —— 一段可播放的源媒体。
/// Pexels 视频、本地导入视频、TTS 配音、本地音频都统一成这个结构。
/// 它是"资产"，Clip 是"资产在时间线上的引用"。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSource {
    pub id: String,
    /// "video" | "audio"
    pub kind: String,
    pub title: String,
    /// 远程下载地址（Pexels 视频原始链接）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// 本地缓存路径（asset 协议播放用，落在 app 数据目录内）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    /// 缩略图（Pexels 封面 / ffmpeg 抽帧 / 本地导入的占位）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    /// 来源标识："pexels" | "local" | "tts"
    pub source: String,
}

/// 画面裁剪（源帧百分比 0-100）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipCrop {
    /// 左上角 X（0-100）
    #[serde(default)]
    pub x: f64,
    /// 左上角 Y（0-100）
    #[serde(default)]
    pub y: f64,
    /// 宽度（0-100，100=全宽）
    #[serde(default = "default_crop_wh")]
    pub width: f64,
    /// 高度（0-100，100=全高）
    #[serde(default = "default_crop_wh")]
    pub height: f64,
    /// 锁定比例："free" | "1:1" | "16:9" | "9:16" | "4:3"
    #[serde(default = "default_crop_ratio")]
    pub ratio: String,
}

fn default_crop_wh() -> f64 { 100.0 }
fn default_crop_ratio() -> String { "free".to_string() }

/// 字幕样式（仅字幕 clip 使用）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleStyle {
    #[serde(default = "default_subtitle_font_size")]
    pub font_size: u32,
    #[serde(default = "default_subtitle_color")]
    pub color: String,
    #[serde(default = "default_subtitle_stroke_color")]
    pub stroke_color: String,
    #[serde(default = "default_subtitle_position")]
    /// "bottom" | "center" | "top" | "custom"
    pub position: String,
    #[serde(default = "default_subtitle_font_family")]
    pub font_family: String,
    /// 自由位置 X（0-100 百分比，50=居中）。position="custom" 时生效
    #[serde(default = "default_subtitle_y")]
    pub x: f64,
    /// 自由位置 Y（0-100 百分比，80=底部偏下）
    #[serde(default = "default_subtitle_y_bottom")]
    pub y: f64,
    /// 水平缩放（百分比，100=正常）
    #[serde(default = "default_subtitle_scale")]
    pub scale_x: f64,
    /// 垂直缩放（百分比，100=正常）
    #[serde(default = "default_subtitle_scale")]
    pub scale_y: f64,
    /// 旋转角度（度）
    #[serde(default)]
    pub rotation: f64,
    /// 是否启用逐字高亮（卡拉OK效果）
    #[serde(default = "default_true")]
    pub karaoke: bool,
    /// 逐字高亮颜色（默认金色）
    #[serde(default = "default_karaoke_color")]
    pub highlight_color: String,
}

impl Default for SubtitleStyle {
    fn default() -> Self {
        Self {
            font_size: default_subtitle_font_size(),
            color: default_subtitle_color(),
            stroke_color: default_subtitle_stroke_color(),
            position: default_subtitle_position(),
            font_family: default_subtitle_font_family(),
            x: default_subtitle_y(),
            y: default_subtitle_y_bottom(),
            scale_x: default_subtitle_scale(),
            scale_y: default_subtitle_scale(),
            rotation: 0.0,
            karaoke: default_true(),
            highlight_color: default_karaoke_color(),
        }
    }
}

fn default_subtitle_font_size() -> u32 {
    48
}
fn default_subtitle_color() -> String {
    "#FFFFFF".to_string()
}
fn default_subtitle_stroke_color() -> String {
    "#000000".to_string()
}
fn default_subtitle_position() -> String {
    "bottom".to_string()
}
fn default_subtitle_font_family() -> String {
    "Noto Sans SC".to_string()
}
fn default_subtitle_y() -> f64 {
    50.0
}
fn default_subtitle_y_bottom() -> f64 {
    80.0
}
fn default_subtitle_scale() -> f64 {
    100.0
}
fn default_true() -> bool {
    true
}
fn default_karaoke_color() -> String {
    "#FFD700".to_string() // 金色高亮
}

/// 画面变换 —— 视频 clip 用（画中画位置/缩放/不透明度/圆角/混合模式）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipTransform {
    /// 水平位置，0-100（百分比，50=居中）
    #[serde(default = "default_transform_xy")]
    pub x: f64,
    /// 垂直位置，0-100（百分比，50=居中）
    #[serde(default = "default_transform_xy")]
    pub y: f64,
    /// 缩放，0-100（百分比，100=原始大小）。画中画默认 100=全屏覆盖
    #[serde(default = "default_transform_scale")]
    pub scale: f64,
    /// 不透明度，0-100（百分比）
    #[serde(default = "default_transform_opacity")]
    pub opacity: f64,
    /// 圆角半径（像素），0=直角
    #[serde(default)]
    pub corner_radius: u32,
    /// 混合模式："normal" | "overlay" | "screen" | "multiply" 等
    #[serde(default = "default_transform_mix")]
    pub mix: String,
}

impl Default for ClipTransform {
    fn default() -> Self {
        Self {
            x: default_transform_xy(),
            y: default_transform_xy(),
            scale: default_transform_scale(),
            opacity: default_transform_opacity(),
            corner_radius: 0,
            mix: default_transform_mix(),
        }
    }
}

fn default_transform_xy() -> f64 {
    50.0
}
fn default_transform_scale() -> f64 {
    100.0
}
fn default_transform_opacity() -> f64 {
    100.0
}
fn default_transform_mix() -> String {
    "normal".to_string()
}

/// 片段 —— 时间线上的一个可编辑单元。
/// 视频/配音/字幕都统一为 clip，区别在于 track_id 指向的轨道类型。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    pub track_id: String,
    /// 引用 MediaSource.id；字幕 clip 可为 None（纯文字）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    /// 在时间线上的起始位置（秒）
    pub start_on_track: f64,
    /// 片段在时间线上的时长（秒）
    pub duration: f64,
    /// 源媒体的入点（秒）—— 视频/音频 clip 用
    #[serde(default)]
    pub source_in: f64,
    /// 源媒体的出点（秒）—— 视频/音频 clip 用
    #[serde(default)]
    pub source_out: f64,
    #[serde(default = "default_speed")]
    pub speed: f64,
    #[serde(default = "default_volume")]
    pub volume: f64,
    /// 音频淡入时长（秒，0=无淡入）
    #[serde(default)]
    pub fade_in: f64,
    /// 音频淡出时长（秒，0=无淡出）
    #[serde(default)]
    pub fade_out: f64,
    /// 滤镜名称（None=无滤镜）。如 "vintage"/"warm"/"cool"/"bw" 等
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
    /// 色彩调节：亮度（-100..100，0=默认）
    #[serde(default)]
    pub brightness: f64,
    /// 色彩调节：对比度（-100..100）
    #[serde(default)]
    pub contrast: f64,
    /// 色彩调节：饱和度（-100..100）
    #[serde(default)]
    pub saturation: f64,
    /// 画面变换 —— 视频 clip 用（画中画）
    #[serde(default)]
    pub transform: Option<ClipTransform>,
    /// 画面搜索词 —— 视频 clip 用（AI 生成的英文 Pexels 关键词）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visual_query: Option<String>,
    /// 画面裁剪（源帧百分比），None=不裁剪
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crop: Option<ClipCrop>,
    /// 字幕文案 —— 字幕 clip 用
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// 字幕样式 —— 字幕 clip 用
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle_style: Option<SubtitleStyle>,
    /// 字幕逐词时间戳 —— 字幕 clip 用（用于逐字高亮；None 表示无词级数据）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub words: Option<Vec<WordCue>>,
    /// 入场转场：None | "fade" | "slide" 等
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_in: Option<String>,
    /// 出场转场
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_out: Option<String>,
}

impl Clip {
    /// 片段在时间线上的结束位置
    pub fn end_on_track(&self) -> f64 {
        self.start_on_track + self.duration
    }
}

fn default_speed() -> f64 {
    1.0
}
fn default_volume() -> f64 {
    1.0
}

/// 轨道
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub kind: TrackKind,
    pub name: String,
    /// 排序序号（从上到下，视频轨在下方为底层）
    pub order: u32,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub locked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderConfig {
    #[serde(default = "default_fps")]
    pub fps: u32,
    /// "preview-fast" | "export-high"
    #[serde(default = "default_render_preset")]
    pub preset: String,
    /// 导出分辨率比例：480p/720p/1080p/4k（对应实际分辨率由 ratio 决定）
    #[serde(default = "default_resolution")]
    pub resolution: String,
    /// 导出码率（Mbps），0 = 用 ffmpeg 默认
    #[serde(default)]
    pub bitrate_mbps: u32,
}

impl Default for RenderConfig {
    fn default() -> Self {
        Self {
            fps: default_fps(),
            preset: default_render_preset(),
            resolution: default_resolution(),
            bitrate_mbps: 0,
        }
    }
}

fn default_fps() -> u32 {
    30
}
fn default_render_preset() -> String {
    "preview-fast".to_string()
}
fn default_resolution() -> String {
    "1080p".to_string()
}

/// 项目 —— 现在是真正的多轨道时间线
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub title: String,
    pub script: String,
    /// "9:16" | "16:9" | "1:1"
    pub ratio: String,
    #[serde(default = "default_fps")]
    pub fps: u32,
    /// 素材库（持久化的所有可用素材）
    #[serde(default)]
    pub media: Vec<MediaSource>,
    /// 轨道列表
    #[serde(default)]
    pub tracks: Vec<Track>,
    /// 所有片段（跨轨道）
    #[serde(default)]
    pub clips: Vec<Clip>,
    #[serde(default)]
    pub render_config: RenderConfig,
    pub preview_path: Option<String>,
    pub final_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub title: String,
    pub ratio: String,
    pub clip_count: usize,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRequest {
    pub title: Option<String>,
    pub ratio: Option<String>,
}

// ============================================================================
// 渲染 / TTS / 命令请求类型
// ============================================================================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderResult {
    pub preview_path: String,
    pub command: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateAudioRequest {
    pub project_id: String,
    /// 可选：只为某个 clip 生成配音（按 track_id 找到 voiceover 轨上的字幕源）
    pub clip_id: Option<String>,
    pub voice_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderProjectRequest {
    pub project_id: String,
    pub preview: bool,
    /// 用户选择的导出路径（None=用默认 app 数据目录）
    #[serde(default)]
    pub output_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PexelsSearchRequest {
    pub query: String,
    pub ratio: String,
    pub per_page: Option<u8>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheAssetRequest {
    pub asset: MediaSource,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentScriptRequest {
    pub script: String,
    pub ratio: String,
}

/// DeepSeek 单段输出
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSegment {
    pub title: String,
    pub text: String,
    pub visual_query: String,
    /// 中文画面关键词（展示用，方便用户理解 visual_query 的含义）
    #[serde(default)]
    pub visual_query_zh: String,
    pub mood: String,
    pub estimated_duration: f64,
    /// 素材策略建议："auto_search"（自动搜 Pexels）| "manual"（手动选）| "color_card"（纯色卡）
    #[serde(default = "default_material_strategy")]
    pub material_strategy: String,
    /// 真实起始时间（秒）。音频模式下由 whisper 提供，文案模式为 0（用 estimatedDuration 累加）
    #[serde(default)]
    pub start: f64,
    /// 真实结束时间（秒）。音频模式下由 whisper 提供
    #[serde(default)]
    pub end: f64,
}

fn default_material_strategy() -> String {
    "auto_search".to_string()
}

/// AI 分段结果 —— 现在直接产出轨道初始编排
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentScriptResult {
    /// 文案片段（用于前端展示 / 编排轨道）
    pub segments: Vec<AiSegment>,
    pub raw_segment_count: usize,
}

/// 带时间戳的句子（音频模式用：whisper 识别出的句子级片段）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimedSentence {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// 音频模式：用 whisper 识别音频，返回句子级（带真实时间戳）的结果。
/// 时间驱动分镜编排，避免 AI 估算时长与真实音频错位。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimedSentencesResult {
    pub sentences: Vec<TimedSentence>,
    pub total_duration: f64,
    pub full_text: String,
}

/// AI 富化请求：给已有的带时间句子补充 title/visualQuery/mood/strategy，不改时间。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrichSegmentsRequest {
    pub sentences: Vec<TimedSentence>,
    pub ratio: String,
}

// ============================================================================
// 新增：本地素材导入 / 缩略图
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportMediaRequest {
    /// 用户选择的源文件绝对路径
    pub source_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailRequest {
    pub source_path: String,
    /// 抽帧时间点（秒）
    #[serde(default = "default_thumb_at")]
    pub at: f64,
}

fn default_thumb_at() -> f64 {
    0.5
}
