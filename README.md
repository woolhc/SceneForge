<div align="center">
  <img src="src-tauri/icons/icon.svg" width="112" height="112" alt="SceneForge Logo" />

  # SceneForge

  **AI 驱动的本地桌面视频创作与剪辑工具**

  从文案或录音出发，完成分镜、素材匹配、配音、AI 语义字幕、时间线精修与本地导出。

  [![Desktop Build](https://github.com/woolhc/SceneForge/actions/workflows/desktop-build.yml/badge.svg)](https://github.com/woolhc/SceneForge/actions/workflows/desktop-build.yml)
  [![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app/)
  [![React 19](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev/)
  [![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)](https://www.rust-lang.org/)
  [![License: MIT](https://img.shields.io/badge/License-MIT-F3C969.svg)](LICENSE)
</div>

![SceneForge Editor](smoke-ui.png)

## SceneForge 能做什么

SceneForge 将 AI 自动生成和专业时间线编辑放在同一个桌面工作流中：

```text
文案 / 录音
    ↓
AI 内容理解与分镜
    ↓
旁白、素材、字幕自动生成
    ↓
多轨时间线精修
    ↓
FFmpeg 本地渲染导出
```

### AI 一键成片

- **文案模式**：DeepSeek 理解文案并生成分镜、素材方向和搜索词。
- **音频模式**：Whisper 使用真实词级时间戳识别录音，再驱动画面和字幕编排。
- **智能素材匹配**：搜索 Pexels 视频与图片，结合时长、比例、相关度和重复情况评分。
- **AI 配音**：支持 Fish Audio 音色与参考音频，按整段或片段生成旁白。
- **可恢复流水线**：生成阶段保存会话、错误和中间结果，避免单个步骤失败后全部重来。

### AI-first 字幕系统

- 高置信度 AI 语义边界优先，规则引擎只负责宽度、时长、安全区等硬约束。
- 将词级时间、停顿、画面比例、阅读速度和项目上下文提供给 AI。
- 支持单语字幕和中英文双轨字幕。
- 保护专有名词、固定短语、数字表达，减少机械断句。
- AI 请求失败或低置信度时自动回退确定性规则引擎。
- 预览和 ASS 导出复用相同文本、换行和布局参数。

### 多轨剪辑

- 视频、图片、旁白、音频、字幕多轨道。
- 片段拖动、裁剪、框选、多选、吸附、波形和防误触阈值。
- 位置、缩放、旋转、不透明度、音量关键帧。
- 曲线变速、倒放、画中画、混合模式和蒙版。
- Fade、Wipe、Slide、Circle、Push 等转场。
- LUT、亮度、对比度、饱和度、色温、色调和视觉特效。
- 字幕描边、背景、阴影、字间距、行高、动画和自定义位置。

### 预览与导出

- Media Element 与 WebCodecs 双预览路径。
- WebGL 多层合成和 LUT 预览。
- 静态字幕避免逐帧 React 更新，动态字幕使用受控 UI 时钟。
- H.264、HEVC、MP3 导出。
- VideoToolbox、NVENC、QSV、VAAPI 自动探测，失败时回退软件编码。
- 多轨音频混合、限幅防削波、降噪和变速保音高。
- 支持真实导出进度和取消操作。

## 跨平台状态

| 平台 | 构建方式 | 状态 |
|---|---|---|
| macOS Apple Silicon | DMG / App | 已完成本地原生构建与启动验证 |
| macOS Intel | GitHub Actions 原生构建 | 已配置 |
| Windows 10/11 x64 | NSIS / MSI | 已配置 GitHub Actions |
| Linux x64 | AppImage / deb / rpm | 已配置 GitHub Actions |

正式安装包会携带与目标系统和 CPU 架构匹配的：

- FFmpeg
- FFprobe
- whisper-cli

Whisper 模型体积较大，不放入安装包。首次使用字幕识别时，将模型放入设置页面显示的 `models` 目录，或指定模型文件路径。

跨平台打包细节见 [`docs/CROSS_PLATFORM.md`](docs/CROSS_PLATFORM.md)。

## 技术架构

| 层 | 技术 |
|---|---|
| 桌面运行时 | Tauri 2 |
| 前端 | React 19、TypeScript、Vite、Zustand |
| 后端 | Rust、Tokio、SQLite |
| 预览 | WebCodecs、WebGL、Web Audio、HTML Media Elements |
| 本地渲染 | FFmpeg、FFprobe、libass |
| AI | DeepSeek、whisper.cpp、Fish Audio / 可配置 TTS |
| 素材 | Pexels Video / Photo API |

## 快速开始

### 开发环境

- Node.js 22+
- Rust stable
- macOS / Windows / Linux 对应的 Tauri 系统依赖
- 本地开发需要可访问的 FFmpeg / FFprobe
- 字幕识别开发需要 `whisper-cli` 和 Whisper 模型

```bash
# 安装前端和静态 FFmpeg 构建依赖
npm install

# 启动 Tauri 开发客户端
npm run tauri:dev
```

开发配置使用 `src-tauri/tauri.dev.conf.json`，不会因为缺少打包 sidecar 而阻塞客户端启动。

### 生产构建

FFmpeg 和 FFprobe 会根据当前操作系统及 CPU 架构自动准备。构建 Whisper sidecar 时，通过环境变量指定可执行文件：

```bash
SCENEFORGE_WHISPER_BIN=/path/to/whisper-cli npm run tauri:build
```

构建产物位于：

```text
src-tauri/target/release/bundle/
```

可用的原生工具覆盖变量：

```text
SCENEFORGE_FFMPEG_BIN
SCENEFORGE_FFPROBE_BIN
SCENEFORGE_WHISPER_BIN
```

## 首次配置

打开 SceneForge 设置页面，根据需要配置：

1. **DeepSeek API Key**：内容理解、语义断句和翻译。
2. **Pexels API Key**：在线视频和图片素材搜索。
3. **TTS 服务与音色**：旁白和克隆配音。
4. **Whisper 模型**：放入应用 `models` 目录或选择 `.bin` 文件。

## 使用流程

### 从文案生成

```text
新建项目
  → 输入文案并选择画面比例
  → 选择音色和素材方向
  → AI 分镜与旁白生成
  → 自动匹配素材
  → 生成 AI 语义字幕
  → 时间线精修
  → 导出视频
```

### 从录音生成

```text
导入录音
  → Whisper 词级识别
  → 按真实时间生成分镜
  → AI 生成画面关键词
  → 自动匹配素材
  → 可选双语字幕
  → 精修并导出
```

## 常用快捷键

| 快捷键 | 功能 |
|---|---|
| `Space` | 播放 / 暂停 |
| `← / →` | 帧级步进，按住 Shift 为秒级步进 |
| `Home / End` | 跳到时间线开头 / 结尾 |
| `Ctrl / Cmd + B` | 在播放头处分割 |
| `Ctrl / Cmd + Z` | 撤销 |
| `Ctrl / Cmd + Y` | 重做 |
| `Ctrl / Cmd + C / V` | 复制 / 粘贴片段 |
| `Ctrl / Cmd + D` | 复制片段 |
| `Delete` | 删除片段 |
| `Ctrl / Cmd + 滚轮` | 时间线缩放 |
| 鼠标中键拖动 | 平移时间线 |
| `Alt + 左键拖动` | 平移时间线 |

## 项目结构

```text
tauri-client/
├── src/                         React 前端
│   ├── editor/                  编辑器操作、生成会话、字幕引擎
│   ├── panels/                  素材、字幕、音频、导出等面板
│   ├── preview/                 预览引擎、WebCodecs、WebGL
│   ├── store/                   Zustand 状态管理
│   ├── timeline/                时间线与片段交互
│   └── App.tsx                  应用编排入口
├── src-tauri/
│   ├── src/                     Rust 后端
│   │   ├── ai.rs                DeepSeek 调用
│   │   ├── asr.rs               Whisper 与字幕处理
│   │   ├── ffmpeg.rs            本地渲染与音频处理
│   │   ├── tools.rs             跨平台原生工具解析
│   │   └── storage.rs           SQLite 与应用目录
│   ├── binaries/                构建时生成的 sidecar，不提交 Git
│   └── tauri.conf.json
├── scripts/                     测试和 sidecar 准备脚本
├── tests/                       TypeScript 回归测试
├── .github/workflows/           三平台桌面构建
└── docs/                        设计与跨平台文档
```

## 测试与验证

```bash
# TypeScript 回归测试
npm run test:ts

# 品牌与 Logo 验证
npm run verify:brand

# 前端生产构建
npm run build

# Rust 测试
cd src-tauri && cargo test

# Rust 全目标检查
cd src-tauri && cargo check --all-targets
```

GitHub Actions 会在 macOS、Windows 和 Ubuntu 上运行测试并构建原生安装包，工作流见 [`.github/workflows/desktop-build.yml`](.github/workflows/desktop-build.yml)。

## 数据与外部服务

- 项目文件、时间线、缓存、字幕中间产物和最终渲染保存在本地。
- FFmpeg、FFprobe、Whisper 推理和 SQLite 存储在本机执行。
- 使用 DeepSeek、Pexels 或外部 TTS 时，会向对应服务发送完成请求所需的文案、搜索词或音频数据。
- API Key 保存在本地应用数据库中，不应提交到 Git。

## Roadmap

- [x] 文案 / 音频一键生成
- [x] AI-first 语义字幕与双语分轨
- [x] 多轨道剪辑、关键帧、变速、蒙版和转场
- [x] WebCodecs / WebGL 预览
- [x] H.264 / HEVC / 音频导出
- [x] macOS、Windows、Linux sidecar 与 CI 构建
- [ ] Whisper 模型首次下载与管理界面
- [ ] 安装包签名、公证和自动发布
- [ ] 模板与项目风格系统
- [ ] 国际化界面

## 贡献

欢迎提交 Issue 和 Pull Request。

提交前建议运行：

```bash
npm run test:ts
npm run build
cd src-tauri && cargo test
```

## License

SceneForge 使用 [MIT License](LICENSE)。
