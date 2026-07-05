# SceneScript Desktop

**本地优先的 AI 短视频生成器** — 粘贴文案 → AI 分段 → 自动配素材 → 克隆配音 → 自动字幕 → 导出。全程本地运行，数据不上传。

![SceneScript](smoke-ui.png)

## ✨ 核心特性

- 🤖 **AI 脚本到视频** — 粘贴文案，DeepSeek 自动分段，Pexels 自动匹配素材
- 🎙️ **克隆配音** — 上传参考音频，AI 克隆音色生成旁白
- 📝 **自动字幕** — whisper.cpp 语音识别，AI 整理断句，可选翻译
- 🎬 **多轨道编辑** — 视频/图片/配音/字幕独立轨道，拖拽编辑
- 🎨 **50+ Google Fonts** — 字幕字体/颜色/大小/描边/位置/旋转可调
- 🎭 **LUT 滤镜** — 10 种预设（电影/复古/黑白等），预览=导出一致
- 🖼️ **画中画** — 多视频轨叠加，位置/缩放/不透明度/混合模式
- 🔊 **音频处理** — 淡入淡出、音轨分离、人声分离
- 📤 **GPU 加速导出** — 自动检测硬件编码器（VideoToolbox/NVENC/QSV）
- 🔒 **隐私优先** — 所有 AI 运行在本地，无需云服务

## 🛠️ 技术栈

- **前端**: React 19 + TypeScript + Vite
- **后端**: Rust + Tauri 2
- **渲染**: FFmpeg（叠加/转场/字幕烧录/混音）
- **AI**: DeepSeek（分段）+ whisper.cpp（字幕）+ gradio TTS（配音）

## 📋 前置条件

### 必需
- [Rust](https://rustup.rs/) 工具链
- [Node.js](https://nodejs.org/) 18+
- [FFmpeg](https://ffmpeg.org/)（含 ffprobe，需在 PATH 中）

### 可选（按需配置）
- [DeepSeek API Key](https://platform.deepseek.com/) — AI 分段
- [Pexels API Key](https://www.pexels.com/api/) — 素材搜索
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) — 自动字幕（`brew install whisper-cpp`）
- TTS 服务 — 克隆配音（默认使用公共服务，可自建）

## 🚀 快速开始

```bash
# 安装依赖
npm install

# 开发模式运行
npm run tauri:dev

# 构建生产版本
npm run tauri:build
```

首次启动后，在「设置」中配置：
1. DeepSeek API Key（AI 分段）
2. Pexels API Key（素材搜索）
3. TTS 服务地址（配音）
4. Whisper 路径（字幕识别）

## 📖 使用流程

```
粘贴文案
  ↓
点击「AI 分段」→ 自动拆分成多段，每段匹配 Pexels 素材
  ↓
选择音色 → 点击「全部配音」→ AI 克隆配音
  ↓
点击「识别字幕」→ whisper 语音识别 + AI 整理
  ↓
在预览区调整字幕样式/位置
  ↓
点击「导出」→ 选择分辨率 → GPU 加速渲染
```

## 🏗️ 项目结构

```
tauri-client/
├── src/                    # React 前端
│   ├── preview/            # 预览引擎（WebGL 滤镜 + Web Audio）
│   ├── timeline/           # 时间线组件（拖拽/吸附/波形）
│   ├── panels/             # Tab 面板（媒体/文本/音频/转场/导出）
│   └── types.ts            # 数据模型
├── src-tauri/              # Rust 后端
│   └── src/
│       ├── ffmpeg.rs       # 渲染管线（叠加/转场/字幕/混音）
│       ├── ai.rs           # DeepSeek 分段
│       ├── asr.rs          # whisper 字幕识别
│       ├── tts.rs          # TTS 配音
│       ├── pexels.rs       # Pexels 搜索
│       └── lut_data.rs     # 内置 LUT 滤镜
├── luts/                   # .cube LUT 文件
└── package.json
```

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Space` | 播放/暂停 |
| `←/→` | 帧级步进（Shift = 秒级）|
| `Home/End` | 跳到开头/结尾 |
| `Ctrl+B` | 在播放头处分割 |
| `Ctrl+Z/Y` | 撤销/重做 |
| `Ctrl+C/V` | 复制/粘贴片段 |
| `Ctrl+D` | 复制片段 |
| `Delete` | 涟漪删除 |
| `Ctrl+滚轮` | 时间线缩放 |
| `+/-` | 放大/缩小 |

## 🗺️ 路线图

- [x] AI 脚本到视频全流程
- [x] 多轨道编辑 + 画中画
- [x] LUT 滤镜 + 色彩调节
- [x] GPU 加速导出
- [ ] 逐字高亮字幕（karaoke）
- [ ] 一键生成流水线
- [ ] 英文界面（i18n）
- [ ] 关键帧动画

## 📄 许可证

[MIT License](LICENSE)

## 🤝 贡献

欢迎提交 Issue 和 PR。
