use serde::{Deserialize, Serialize};

// ============================================================================
// 应用基础信息
// ============================================================================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub app_data_dir: String,
    pub cache_dir: String,
    pub models_dir: String,
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
    #[serde(default)]
    pub fish_audio_api_key: String,
    #[serde(default = "default_fish_audio_model")]
    pub fish_audio_model: String,
    #[serde(default)]
    pub fish_audio_reference_id: String,
    #[serde(default = "default_fish_audio_format")]
    pub fish_audio_format: String,
    #[serde(default = "default_fish_audio_sample_rate")]
    pub fish_audio_sample_rate: u32,
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
    String::new()
}

fn default_fish_audio_model() -> String {
    "s1".to_string()
}

fn default_fish_audio_format() -> String {
    "mp3".to_string()
}

fn default_fish_audio_sample_rate() -> u32 {
    44_100
}

/// 单个词/字符的时间戳（用于逐字高亮卡拉OK字幕）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordCue {
    pub start: f64,
    pub end: f64,
    pub text: String,
    /// whisper 词级置信度（0-1）。None 表示未提供（旧数据/不支持）
    #[serde(default)]
    pub confidence: Option<f64>,
}

/// ASR 识别结果（带时间戳的字幕片段，整理前/后的中间结构）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleCue {
    pub start: f64,
    pub end: f64,
    pub text: String,
    /// 双语模式下的翻译文本（translate=true 时由 DeepSeek 返回）。
    /// translate=false 时为 None。用于双语字幕分轨输出。
    #[serde(default)]
    pub translated: Option<String>,
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
            fish_audio_api_key: String::new(),
            fish_audio_model: default_fish_audio_model(),
            fish_audio_reference_id: String::new(),
            fish_audio_format: default_fish_audio_format(),
            fish_audio_sample_rate: default_fish_audio_sample_rate(),
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
    /// 独立文本图层（不挂 ASR，可自由创建的文字，渲染时烧录）
    Text,
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
    /// 低清代理文件路径（预览优先使用，导出仍使用 local_path/url 原片）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy_path: Option<String>,
    /// 代理生成状态："none" | "ready" | "failed"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy_width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy_height: Option<u32>,
    /// 缩略图（Pexels 封面 / ffmpeg 抽帧 / 本地导入的占位）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    /// 来源标识："pexels" | "local" | "tts"
    pub source: String,
    /// 用户自定标签（素材库筛选用）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// 是否收藏
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favorite: Option<bool>,
    /// 最近一次被拖入时间线的时间（ISO 8601）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,
}

impl Default for MediaSource {
    fn default() -> Self {
        Self {
            id: String::new(),
            kind: String::new(),
            title: String::new(),
            url: None,
            local_path: None,
            proxy_path: None,
            proxy_status: None,
            proxy_width: None,
            proxy_height: None,
            thumbnail_url: None,
            width: 0,
            height: 0,
            duration: 0.0,
            source: String::new(),
            tags: None,
            favorite: None,
            last_used_at: None,
        }
    }
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

fn default_crop_wh() -> f64 {
    100.0
}
fn default_crop_ratio() -> String {
    "free".to_string()
}

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
    /// 描边粗细（像素，0=无描边）
    #[serde(default = "default_subtitle_stroke_width")]
    pub stroke_width: f64,
    /// 背景色（"none" 表示透明）。ASS 导出使用方形底板近似。
    #[serde(default = "default_subtitle_background_color")]
    pub background_color: String,
    /// 背景内边距（像素）。
    #[serde(default = "default_subtitle_background_padding")]
    pub background_padding: f64,
    /// 阴影颜色。
    #[serde(default = "default_subtitle_shadow_color")]
    pub shadow_color: String,
    /// 阴影模糊（像素；ASS 导出使用偏移近似）。
    #[serde(default)]
    pub shadow_blur: f64,
    /// 字间距（像素）。
    #[serde(default)]
    pub letter_spacing: f64,
    /// 行高倍数。当前 ASS 导出保留数据并使用 libass 默认行距。
    #[serde(default = "default_subtitle_line_height")]
    pub line_height: f64,
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
    /// T4.8: 入场动画："none" | "fadeIn" | "slideUp" | "scaleIn"
    #[serde(default)]
    pub animation_in: String,
    /// T4.8: 出场动画："none" | "fadeOut" | "slideDown" | "scaleOut"
    #[serde(default)]
    pub animation_out: String,
    /// T4.8: 动画时长（秒）
    #[serde(default = "default_anim_duration")]
    pub animation_duration: f64,
    /// 花字装饰模板 id。仅预览生效，导出时降级为纯文字样式。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decoration_id: Option<String>,
}

fn default_anim_duration() -> f64 {
    0.3
}

impl Default for SubtitleStyle {
    fn default() -> Self {
        Self {
            font_size: default_subtitle_font_size(),
            color: default_subtitle_color(),
            stroke_color: default_subtitle_stroke_color(),
            stroke_width: default_subtitle_stroke_width(),
            background_color: default_subtitle_background_color(),
            background_padding: default_subtitle_background_padding(),
            shadow_color: default_subtitle_shadow_color(),
            shadow_blur: 0.0,
            letter_spacing: 0.0,
            line_height: default_subtitle_line_height(),
            position: default_subtitle_position(),
            font_family: default_subtitle_font_family(),
            x: default_subtitle_y(),
            y: default_subtitle_y_bottom(),
            scale_x: default_subtitle_scale(),
            scale_y: default_subtitle_scale(),
            rotation: 0.0,
            karaoke: default_true(),
            highlight_color: default_karaoke_color(),
            animation_in: String::new(),
            animation_out: String::new(),
            animation_duration: default_anim_duration(),
            decoration_id: None,
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
fn default_subtitle_stroke_width() -> f64 {
    2.0
}
fn default_subtitle_background_color() -> String {
    "none".to_string()
}
fn default_subtitle_background_padding() -> f64 {
    4.0
}
fn default_subtitle_shadow_color() -> String {
    "#000000".to_string()
}
fn default_subtitle_line_height() -> f64 {
    1.2
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
    /// T4.2: 旋转角度（度，0=不旋转）
    #[serde(default)]
    pub rotation: f64,
}

/// T4.2: 关键帧
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keyframe {
    /// 相对 clip 起点的秒数
    pub time: f64,
    pub value: f64,
    #[serde(default = "default_easing")]
    pub easing: String,
    /// easing == "bezier" 时的三次贝塞尔控制点 [x1,y1,x2,y2]，参考 CSS cubic-bezier
    #[serde(default)]
    pub bezier_points: Option<[f64; 4]>,
}

fn default_easing() -> String {
    "linear".to_string()
}

/// T4.3: 曲线变速控制点
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedPoint {
    /// 源素材归一化位置 0-1
    pub time: f64,
    /// 该点倍速
    pub speed: f64,
}

/// T4.4: 蒙版
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipMask {
    /// "linear" | "mirror" | "circle" | "rect"
    pub kind: String,
    #[serde(default = "default_mask_center")]
    pub cx: f64,
    #[serde(default = "default_mask_center")]
    pub cy: f64,
    #[serde(default = "default_mask_size")]
    pub width: f64,
    #[serde(default = "default_mask_size")]
    pub height: f64,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default)]
    pub feather: f64,
    #[serde(default)]
    pub invert: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionConfig {
    pub name: String,
    #[serde(default = "default_clip_transition_duration")]
    pub duration: f64,
}

fn default_clip_transition_duration() -> f64 {
    0.5
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ClipTransition {
    Legacy(String),
    Config(TransitionConfig),
}

impl ClipTransition {
    pub fn name(&self) -> &str {
        match self {
            ClipTransition::Legacy(name) => name.as_str(),
            ClipTransition::Config(config) => config.name.as_str(),
        }
    }

    pub fn duration(&self, fallback: f64) -> f64 {
        match self {
            ClipTransition::Legacy(_) => fallback,
            ClipTransition::Config(config) => config.duration,
        }
    }
}

fn default_mask_center() -> f64 {
    0.5
}
fn default_mask_size() -> f64 {
    0.8
}

/// T4.2: clip 的关键帧集合
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClipKeyframes {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<Vec<Keyframe>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<Vec<Keyframe>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<Vec<Keyframe>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<Vec<Keyframe>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rotation: Option<Vec<Keyframe>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume: Option<Vec<Keyframe>>,
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
            rotation: 0.0,
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
/// 视觉特效项（剪映式"特效"面板）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipVisualEffect {
    /// 特效类型：vignette | flicker | shake | glow | mirror | invert | grayscale | chromakey
    pub kind: String,
    /// 强度 0-100，默认 50；chromakey 下映射为抠像容差（similarity）
    #[serde(default = "default_effect_intensity")]
    pub intensity: f64,
    /// 抠像目标色（十六进制），仅 kind="chromakey" 使用
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chroma_key_color: Option<String>,
}

fn default_effect_intensity() -> f64 {
    50.0
}

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
    /// T4.3: 曲线变速控制点。time 为源素材归一化位置 0-1，speed 为该点倍速
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speed_curve: Option<Vec<SpeedPoint>>,
    #[serde(default = "default_volume")]
    pub volume: f64,
    /// 音频淡入时长（秒，0=无淡入）
    #[serde(default)]
    pub fade_in: f64,
    /// 音频淡出时长（秒，0=无淡出）
    #[serde(default)]
    pub fade_out: f64,
    /// 音频降噪强度（0-100，0=关闭；剪映"降噪"开关，这里升级为强度滑块）
    /// afftdn 滤镜 nr 参数（噪声降低分贝，0-97，0=关闭）
    #[serde(default)]
    pub noise_reduction: f64,
    /// 变声/音效预设 id（None=无）。仅导出生效，预览不处理
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub voice_effect: Option<String>,
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
    /// 色温（-100..100，负=冷蓝，正=暖红，0=默认）
    #[serde(default)]
    pub temperature: f64,
    /// 色调（-100..100，负=绿，正=品红，0=默认）
    #[serde(default)]
    pub tint: f64,
    /// 画面变换 -- 视频 clip 用（画中画）
    #[serde(default)]
    pub transform: Option<ClipTransform>,
    /// T4.2: 关键帧动画（位置/缩放/不透明度/旋转/音量）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keyframes: Option<ClipKeyframes>,
    /// T4.4: 蒙版
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask: Option<ClipMask>,
    /// 画面搜索词 —— 视频 clip 用（AI 生成的英文 Pexels 关键词）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visual_query: Option<String>,
    /// 视觉特效列表（剪映式特效面板）：每项 { kind, intensity }
    /// kind: "vignette"(暗角) | "flicker"(闪烁) | "shake"(抖动) | "glow"(边缘发光) | "mirror"(镜像)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visual_effects: Option<Vec<ClipVisualEffect>>,
    /// 是否倒放（剪映式"倒放"开关；导出时用 reverse 滤镜）
    #[serde(default)]
    pub reverse: bool,
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
    /// 双语字幕配对 ID。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle_group_id: Option<String>,
    /// source | target
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle_role: Option<String>,
    /// 字幕语言标识。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle_language: Option<String>,
    /// 入场转场：兼容旧 string，也支持 { name, duration }
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_in: Option<ClipTransition>,
    /// 出场转场
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_out: Option<ClipTransition>,
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
    /// 轨道是否隐藏（不参与预览/导出，剪映式隐藏轨道开关）
    #[serde(default)]
    pub hidden: bool,
    /// 轨道高度（像素，0=默认；用户可拖拽调整）
    #[serde(default)]
    pub height: u32,
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
    /// T4.10: 视频编码格式："h264"（默认）| "hevc"
    #[serde(default = "default_codec")]
    pub codec: String,
    /// T4.10: 导出模式："video"（默认）| "audio-only"（仅音频）
    #[serde(default = "default_export_mode")]
    pub export_mode: String,
    /// T4.5: 默认转场时长（秒）
    #[serde(default = "default_transition_duration")]
    pub transition_duration: f64,
    /// 字幕处理："burn"（默认，烧录到画面）| "none"（不包含）| "srt"（导出 .srt 文件）
    #[serde(default = "default_subtitle_mode")]
    pub subtitle_mode: String,
    /// 导出容器格式："mp4"（默认）| "gif" | "webm" | "mov"
    #[serde(default = "default_container")]
    pub container: String,
    /// 是否启用硬件编码器（true 时检测并使用 videotoolbox/nvenc/qsv，false 强制软编）
    #[serde(default = "default_hwaccel_on")]
    pub hwaccel: bool,
    /// CRF（质量，0-51，越小质量越高，默认 23）
    #[serde(default)]
    pub crf: Option<u32>,
    /// 编码器预设："ultrafast"/"superfast"/"veryfast"/"faster"/"fast"/"medium"/"slow"/"slower"
    /// None = 用 preview 默认（preview=ultrafast, export=veryfast/medium）
    #[serde(default)]
    pub encoder_preset: Option<String>,
}

fn default_hwaccel_on() -> bool {
    true
}

fn default_container() -> String {
    "mp4".to_string()
}

fn default_subtitle_mode() -> String {
    "burn".to_string()
}

fn default_transition_duration() -> f64 {
    0.5
}

fn default_codec() -> String {
    "h264".to_string()
}
fn default_export_mode() -> String {
    "video".to_string()
}

impl Default for RenderConfig {
    fn default() -> Self {
        Self {
            fps: default_fps(),
            preset: default_render_preset(),
            resolution: default_resolution(),
            bitrate_mbps: 0,
            codec: default_codec(),
            export_mode: default_export_mode(),
            transition_duration: default_transition_duration(),
            subtitle_mode: default_subtitle_mode(),
            container: default_container(),
            hwaccel: true,
            crf: None,
            encoder_preset: None,
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
    /// 章节标记（剪映式"添加章节"，时间轴上的导航锚点）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub chapters: Vec<Chapter>,
    /// 封面时间点（秒，0=未设置；导出时用作 -frames 1 抽帧或 embed 为 metadata）
    #[serde(default)]
    pub cover_time: Option<f64>,
    pub preview_path: Option<String>,
    pub final_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// 章节标记（剪映式）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    /// 章节起点（秒）
    pub time: f64,
    pub title: String,
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
pub struct GenerateNarrationRequest {
    pub project_id: String,
    pub text: String,
    #[serde(default)]
    pub voice_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateNarrationResult {
    pub audio_path: String,
    pub duration: f64,
    pub source_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderProjectRequest {
    pub project_id: String,
    pub preview: bool,
    /// 用户选择的导出路径（None=用默认 app 数据目录）
    #[serde(default)]
    pub output_path: Option<String>,
    /// P3-4: 批量多比例导出时的比例覆盖（None=用项目当前比例，不影响已保存的项目数据）
    #[serde(default)]
    pub ratio: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PexelsSearchRequest {
    pub query: String,
    pub ratio: String,
    pub per_page: Option<u8>,
    #[serde(default)]
    pub page: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PexelsSearchResult {
    pub assets: Vec<MediaSource>,
    pub page: u32,
    pub has_more: bool,
    pub total_results: u32,
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
    #[serde(default)]
    pub words: Vec<WordCue>,
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
    #[serde(default)]
    pub material_direction: String,
}

/// 只转写项目配音轨，不直接创建字幕。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeProjectNarrationRequest {
    pub project_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSubtitleArtifactRequest {
    pub project_id: String,
    pub artifact: serde_json::Value,
}

/// 从已经完成的单次 Whisper transcript 整理/翻译字幕，不再重新执行 ASR。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefineTranscriptRequest {
    pub sentences: Vec<TimedSentence>,
    #[serde(default)]
    pub translate: bool,
    #[serde(default = "default_generation_subtitle_mode")]
    pub mode: String,
    #[serde(default)]
    pub context: String,
}

fn default_generation_subtitle_mode() -> String {
    "natural".to_string()
}

/// 全局字幕语言上下文分析。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleLanguageContextRequest {
    pub project_title: String,
    pub script: String,
    pub transcript: String,
    #[serde(default = "default_generation_subtitle_mode")]
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleLanguageTerm {
    pub source: String,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleLanguageContextResult {
    pub summary: String,
    pub content_type: String,
    pub tone: String,
    pub terms: Vec<SubtitleLanguageTerm>,
}

/// AI 字幕语义断句：词文本是唯一原文，时间与版式约束仅用于提高语义分组质量。
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleBreakWordTiming {
    pub text: String,
    pub start: f64,
    pub end: f64,
    #[serde(default)]
    pub gap_after: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleBreakConstraints {
    pub ratio: String,
    pub max_lines: usize,
    pub preferred_chars_per_line: usize,
    pub max_chars_per_cue: usize,
    pub min_duration: f64,
    pub preferred_duration: f64,
    pub max_duration: f64,
    pub preferred_cps: f64,
    pub max_cps: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleBreakAdviceRequest {
    pub words: Vec<String>,
    #[serde(default)]
    pub word_timings: Vec<SubtitleBreakWordTiming>,
    #[serde(default)]
    pub constraints: Option<SubtitleBreakConstraints>,
    #[serde(default)]
    pub context: String,
    #[serde(default = "default_generation_subtitle_mode")]
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleProtectedRange {
    pub start_word_index: usize,
    pub end_word_index: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleBreakAdviceResult {
    pub preferred_break_after_indices: Vec<usize>,
    pub protected_ranges: Vec<SubtitleProtectedRange>,
    pub confidence: f64,
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

/// T4.7: 胶片条缩略图请求
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilmstripRequest {
    pub source_path: String,
    #[serde(default)]
    pub source_in: f64,
    #[serde(default)]
    pub source_out: f64,
    #[serde(default = "default_filmstrip_count")]
    pub count: usize,
}

fn default_filmstrip_count() -> usize {
    6
}
