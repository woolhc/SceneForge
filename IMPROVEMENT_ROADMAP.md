# SceneForge 对标剪映改进计划（详细执行版）

> 本文档面向执行开发的 AI 模型编写。每个任务都是独立的、可单独执行的工作单元。
> 请严格按照任务编号顺序执行，**每完成一个任务必须通过验收标准后才能进入下一个任务**。

---

## 0. 执行规则（必读）

1. **一次只做一个任务**。不要合并任务，不要顺手改无关代码。
2. **每个任务完成后必须验证**：前端跑 `npm run build`（在 `tauri-client/` 目录），后端跑 `cargo check`（在 `tauri-client/src-tauri/` 目录），两者都必须通过。
3. **行号是编写文档时的快照**，代码可能已变化。定位代码时优先用文中给出的**函数名/常量名/字符串**做搜索，行号仅作参考。
4. **不要重构任务范围之外的代码**，即使看到问题也只记录不修改。
5. 遵循项目现有代码风格：前端 TypeScript + React 19 函数组件，后端 Rust + anyhow 错误处理。
6. 所有对象更新使用**不可变模式**（展开运算符创建新对象），禁止直接改属性。

---

## 1. 项目现状概览

**技术栈**：React 19 + TypeScript + Vite（前端）/ Rust + Tauri 2 + FFmpeg 子进程（后端）/ SQLite JSON blob 存储。

**核心文件地图**：

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/App.tsx` | 3136 | 上帝组件：全部状态 + 业务逻辑 + 编辑器 UI |
| `src/types.ts` | 294 | 前端数据模型（Track/Clip/SubtitleStyle 等） |
| `src/tauri.ts` | 513 | ~35 个 Tauri command 封装 + web fallback |
| `src/preview/PreviewEngine.ts` | 468 | 播放引擎（rAF 时钟 + 单 video + Web Audio） |
| `src/preview/FilterRenderer.ts` | 221 | WebGL eq + 3D LUT 滤镜 |
| `src/timeline/TimelineTrack.tsx` | 335 | 轨道渲染 + 拖拽交互入口 |
| `src/timeline/clipInteraction.ts` | 181 | 拖拽/trim/吸附/分割纯函数 |
| `src-tauri/src/ffmpeg.rs` | 1511 | 渲染管线（分段渲染→拼接→字幕烧录→混音） |
| `src-tauri/src/commands.rs` | 1157 | 34 个 Tauri command |
| `src-tauri/src/models.rs` | 716 | 后端数据模型（与 types.ts 对应） |
| `src-tauri/src/storage.rs` | 405 | SQLite 持久化 |
| `src-tauri/src/asr.rs` | 720 | whisper-cli 字幕识别 + AI 整理 |

**当前渲染管线**（ffmpeg.rs `render_project_video`）：
时间切片 → 逐段起 ffmpeg 进程渲染（单 clip 或 overlay 叠加）→ concat 拼接（有转场时 xfade 重编码）→ 第二遍烧录 .ass 字幕 + amix 混音。一次导出经历 2-3 代重编码。

**与剪映的功能差距总览**：

| 能力 | 剪映 | 本项目 |
|---|---|---|
| 关键帧动画（位置/缩放/透明度/音量） | ✅ | ❌ 无数据结构 |
| 曲线变速 | ✅ | ❌ 仅常量变速 |
| 蒙版（圆/矩形/线性/镜面） | ✅ | ❌（圆角滤镜还有 bug） |
| 贴纸/特效/调节层 | ✅ | ❌ 无轨道类型 |
| 文字动画/花字模板 | ✅ | ❌ |
| 片段多选/分组 | ✅ | ❌ |
| 视频片段胶片条缩略图 | ✅ | ❌ 单张缩略图 |
| 画中画实时预览 | ✅ | ❌ 预览显示静态图 |
| 变速曲线音频保持音高 | ✅ | ❌ 音频不参与变速 |
| 真实导出进度 + 取消 | ✅ | ❌ 只有 0/90/100 三个点 |
| 代理剪辑 | ✅ | ❌ |
| AI 分镜/克隆配音/自动字幕 | 部分 | ✅ **差异化优势** |

---

## 2. 阶段一：P0 Bug 修复（数据丢失级 / 结果错误级）

### T1.1 时间线拖拽结果不持久化、不可撤销 【最高优先级】

**问题**：`src/timeline/TimelineTrack.tsx` 中拖拽移动/trim 片段时，`onClipDrag(drag.clipId, next, false)` 的 commit 参数**永远是 false**（搜索 `onClipDrag(drag.clipId`）。而 `src/App.tsx` 中 `handleClipDrag` 只在 `commit === true` 时调用 `persist()`；`handleClipCommit`（搜索 `function handleClipCommit`）是空函数。结果：**用户拖动片段后，刷新即丢失，且无法撤销**。

**修复步骤**：
1. 打开 `src/timeline/TimelineTrack.tsx`，找到拖拽结束的逻辑（`mouseup` / `pointerup` 事件处理，或拖拽状态清空 `setDrag(null)` 的位置）。
2. 在拖拽结束时，用最后一次计算的 patch 调用 `onClipDrag(clipId, finalPatch, true)`（commit 传 `true`）。如果拖拽结束处拿不到 patch，把最近一次 patch 存入 drag 状态或 ref。
3. 注意：拖拽过程中（mousemove）保持 `commit=false` 不变，只有结束时才 `true`，避免拖动过程高频写盘。
4. 在 `src/App.tsx` 的 `handleClipDrag` 中确认：`commit=true` 分支走 `persist(next, ...)`（persist 内部含 pushUndo）；`commit=false` 分支只 `setProject`。
5. **撤销栈修正**：`persist` 中 `pushUndo` 保存的应该是**操作前**的快照。拖拽从 mousedown 到 mouseup 之间已多次 `setProject`，所以需要在**拖拽开始时**（mousedown）记录一份 project 快照，commit 时把该快照压入 undo 栈，而不是压入已被拖拽中间态污染的当前值。实现方式：在 App.tsx 增加 `dragStartSnapshotRef`，`handleClipDrag` 第一次被调用（可用 ref 标记）时深拷贝当前 project 存入；commit=true 时用该快照 pushUndo，然后清空 ref。

**验收标准**：
- 拖动一个片段到新位置 → 重启应用 → 片段仍在新位置。
- 拖动片段后按 Ctrl+Z → 片段回到拖动前位置（一次撤销回到位，不是逐像素回退）。
- trim 片段边缘后同样可持久化、可撤销。

---

### T1.2 字幕右键"编辑文字"误触发分割

**问题**：`src/timeline/ContextMenu.tsx` 中字幕专用菜单项"编辑文字"的 onClick 绑定的是 `actions.onSplit()`（搜索 `编辑文字`）。点击"编辑文字"会把字幕片段一分为二。

**修复步骤**：
1. 在 `ContextMenu.tsx` 的 actions 接口中新增 `onEditText?: () => void`。
2. "编辑文字"按钮改为调用 `actions.onEditText?.()`。
3. 在 `src/App.tsx` 渲染 `<ContextMenu>` 的地方传入 `onEditText`，实现为：选中该字幕 clip 并把左侧面板切到文本 Tab（`setActiveTab("text")` 类似逻辑，参考现有 tab 切换代码），或弹出一个简单的 `prompt`/内联输入修改 `clip.subtitleText`（字段名以 types.ts 为准，搜索 `subtitle` 相关字段）。修改后调用 `persist`。

**验收标准**：右键字幕 → 点"编辑文字" → 片段**不被分割**，且能修改字幕文本并保存。

---

### T1.3 属性面板修改不持久化、不可撤销

**问题**：`src/App.tsx` 的 `updateSelectedClip`（搜索 `function updateSelectedClip`）只调用 `setProject`，不调用 `persist`。属性检查器里改音量/滤镜/变换等，重启即丢。

**修复步骤**：
1. 给 `updateSelectedClip` 增加第二个参数 `commit: boolean = true`。
2. `commit=true` 时走 `persist(next, "已更新属性")`；`false` 时只 `setProject`。
3. 检查所有调用点：滑块类控件（音量、亮度、对比度、饱和度、不透明度、缩放等）在 `onChange`（拖动中）传 `commit=false`，在 `onPointerUp` / `onMouseUp` / `onBlur` 时再调用一次传 `commit=true`。开关/下拉类控件直接默认 `commit=true`。
4. 与 T1.1 相同，滑块拖动的 undo 快照要在拖动开始时记录（可复用 T1.1 的 snapshot ref 机制，抽成一个通用函数 `beginInteractiveEdit()` / `commitInteractiveEdit(label)`）。

**验收标准**：改音量滑块 → 重启应用后值仍在；Ctrl+Z 一次恢复到拖动前的值。

---

### T1.4 硬件编码器参数被丢弃（导出核心 bug）

**问题**：`src-tauri/src/ffmpeg.rs` 中三处（搜索 `encoder_args("libx264"`）：

```rust
let (enc_name, enc_args) = encoder_args("libx264", preview); let preset = ...
```

问题有二：① 传入硬编码 `"libx264"` 而不是 `detect_hw_encoder().await` 的结果；② 返回的 `enc_name`/`enc_args` 从未被用于后续 `Command` 参数，实际命令里手写了 `-c:v libx264 -preset veryfast -crf 23`。硬件加速（VideoToolbox/NVENC）**完全没有生效**，README 宣传的 GPU 导出是假的。

**修复步骤**：
1. 找到 `pick_encoder`（ffmpeg.rs 顶部，内部调用 `detect_hw_encoder().await`），确认它返回编码器名。
2. 三处渲染函数（`render_black_segment`、`render_segment_with_overlay`、`render_single_clip_for_segment`）的签名增加 `encoder: &str` 参数，由上层 `render_project_video` 调用 `pick_encoder().await` 一次后传入。
3. 每处将 `encoder_args("libx264", preview)` 改为 `encoder_args(encoder, preview)`，并把命令中手写的 `"-c:v", "libx264", "-preset", preset, "-crf", crf` 替换为 `"-c:v"`, `enc_name` + 展开 `enc_args`（`enc_args` 内部已按硬/软编区分 `-b:v` 或 `-preset/-crf`）。
4. `render_black_segment` 同样使用传入的 encoder，保证所有段编码器一致（否则 concat `-c copy` 拼接会花屏）。
5. xfade 合并路径和 `burn_subtitle_and_mix_audio` 里的编码参数（搜索 `-preset` 找到所有手写处）同样统一改用 `encoder_args`。

**验收标准**：
- `cargo check` 通过。
- macOS 上导出时用 `ps aux | grep ffmpeg` 或日志确认命令行含 `-c:v h264_videotoolbox`（若硬件支持）。
- 导出视频可正常播放，各段拼接处无花屏。

---

### T1.5 导出分辨率设置无效

**问题**：`src-tauri/src/ffmpeg.rs` 中，段渲染取尺寸用 `dimensions_for_ratio(&project.ratio, preview)`（恒定 1080p 短边），而用户在导出对话框选的 480p/720p/4k 只被 `export_dimensions_for_project(project)` 用于 .ass 字幕的 PlayResX/Y。结果：**选 4K 导出的还是 1080p，且字幕坐标系与视频尺寸不匹配，字号错乱**。

**修复步骤**：
1. 在 `render_project_video` 顶部计算一次目标尺寸：`let (width, height) = if preview { dimensions_for_ratio(&project.ratio, true) } else { export_dimensions_for_project(project) };`
2. 把 `(width, height)` 作为参数传给所有段渲染函数（配合 T1.4 一起改签名），删除各函数内部自行调用 `dimensions_for_ratio` 的代码。
3. `burn_subtitle_and_mix_audio` 中 .ass 的 PlayResX/Y 使用同一组 `(width, height)`，保证字幕坐标系与视频一致。
4. 确认 `RenderConfig.bitrate_mbps` 也接入：在 `encoder_args` 或调用处，非 preview 时用 `render_config.bitrate_mbps` 生成 `-b:v {n}M`（硬编）或映射为合理 crf（软编可保持 crf，忽略码率或用 `-maxrate`）。

**验收标准**：导出选择 720p → 用 `ffprobe` 检查输出文件分辨率为 720p 短边；选择 4K → 输出为 4K；两种情况下字幕位置和大小视觉上一致。

---

### T1.6 转场导致音画错位（用了转场必错）

**问题**：ffmpeg.rs 中 xfade 转场让相邻段重叠 0.5s（搜索 `accumulated`，逻辑为 `accumulated += seg_duration - transition_duration`），视频总长每个转场缩短 0.5s；但 `merge_audio_clips` 混音仍按 clip 原始 `start_on_track` 用 adelay 定位。**每加一个转场，后续音频提前 0.5s**。

**修复步骤**（推荐方案 A，改动小）：
1. 在 `render_project_video` 中构建 xfade 链时，记录每个转场发生的时间线位置（转场中点时间）和时长。
2. 把"转场偏移表"传给 `merge_audio_clips`：每个音频 clip 的 adelay 计算改为 `start_on_track - (该 clip 起点之前所有转场累计缩短的时长)`。即起点在第 N 个转场之后的 clip，delay 要减去 `N * transition_duration`。
3. 字幕烧录同理：.ass 的时间戳也要按同样偏移表平移（在生成 .ass 的函数中处理）。

**方案 B（长期更优，可作为后续任务）**：放弃"段间 xfade"，改为剪映式转场——转场只发生在**同一轨道相邻 clip 之间**且占用两侧 clip 各一半时长，不改变时间线总长。这需要重做切片逻辑，暂不在本任务范围。

**验收标准**：创建含 3 个片段、2 个 fade 转场、带配音和字幕的项目 → 导出 → 最后一段的口播与字幕、画面对齐（误差 < 0.1s）。

---

### T1.7 圆角滤镜 geq 表达式错误

**问题**：ffmpeg.rs 中画中画圆角的 geq 表达式（搜索 `geq`）存在笔误：`b='b(X.Y)'` 应为 `b(X,Y)`；圆角距离公式第一项缺少平方（`pow(max({r}-X,0)+...` 应为 `pow(max({r}-X,0),2)+...`）。该滤镜要么报错要么渲染错误。

**修复步骤**：
1. 找到 geq 表达式构建代码，正确的圆角 alpha 公式（以左上角为例，r 为圆角半径）：到圆心 `(r, r)` 的距离超过 r 则透明。四角完整表达式较长，建议改用更简单可靠的方案：**用 `format=yuva420p` + `geq` 只处理 alpha 通道**：

```
format=yuva420p,geq=lum='lum(X,Y)':a='if(gt(pow(max(R-X,0),2)+pow(max(R-Y,0),2),R*R)+gt(pow(max(X-(W-1-R),0),2)+pow(max(R-Y,0),2),R*R)+gt(pow(max(R-X,0),2)+pow(max(Y-(H-1-R),0),2),R*R)+gt(pow(max(X-(W-1-R),0),2)+pow(max(Y-(H-1-R),0),2),R*R),0,255)'
```

（把 R 替换为实际像素半径。四个 `gt(...)` 分别对应四个角，任一角超出圆弧即 alpha=0。）
2. 本机手动验证：`ffmpeg -i test.mp4 -vf "format=yuva420p,geq=..." -frames:v 1 out.png` 查看圆角是否正确。
3. 替换代码中的表达式，跑一次带圆角 PiP 的导出确认。

**验收标准**：给叠加轨片段设置 cornerRadius → 导出视频中该片段四角为圆角，无 ffmpeg 报错。

---

### T1.8 trim 忽略变速导致源区间错误

**问题**：`src/timeline/clipInteraction.ts` 的 `computeDraggedClip` 中左右手柄 trim 分支，`sourceOut = sourceIn + newDuration`，没有乘 `clip.speed`。同文件 `splitClipAt` 的写法是正确的（`sourceIn + firstDuration * clip.speed`）。变速片段 trim 后源区间与时间线时长不匹配，导出内容错误。

**修复步骤**：
1. 打开 `clipInteraction.ts`，找到左手柄和右手柄两个分支。
2. 左手柄（改变 start）：时间线上缩短/伸长 `delta` 秒，源区间应变化 `delta * clip.speed`，即 `sourceIn = clip.sourceIn + delta * clip.speed`。
3. 右手柄：`sourceOut = clip.sourceIn + newTimelineDuration * clip.speed`。
4. 同时检查 trim 的边界 clamp：`sourceIn >= 0`、`sourceOut <= 素材总时长`（若可获取）。
5. 为这两个分支补充单元测试意识上的手动验证：创建 2x 速片段，右手柄拉长 1 秒，确认 `sourceOut` 增加了 2 秒。

**验收标准**：将一个片段设为 2x 速 → trim 右边缘缩短一半 → 播放/导出内容为源素材前半段的 2 倍速版本，不出现内容重复或跳变。

---

### T1.9 滤镜预览渲染的是"选中片段"而非"播放中片段"

**问题**：`src/App.tsx` 中滤镜渲染 effect（搜索 `filterRendererRef.current.render`）**没有依赖数组**（每次渲染都执行），且传入的是 `selectedClip`。播放头移到别的片段时，预览滤镜不切换；选中 A 片段播放 B 片段时显示 A 的滤镜。

**修复步骤**：
1. 计算"当前播放头所在的主视频轨 clip"（引擎已有类似 `findClipAt` 逻辑，或在 App.tsx 里用 `project.clips` + `engineState.currentTime` 过滤视频轨得到）。
2. 滤镜 effect 改为依赖 `[当前播放clip的id, 其filter/brightness/contrast/saturation字段, 视频帧更新信号]`，渲染该 clip 的滤镜而非 selectedClip。
3. 给 effect 加上正确的依赖数组，消除每帧执行。
4. 注意播放中滤镜渲染需要每帧执行（WebGL 画视频帧），正确做法是把"滤镜参数设置"（React effect，低频）与"逐帧绘制"（PreviewEngine 的 rAF 循环内调用 renderer.draw()，高频）分离。若当前架构是 effect 每帧跑，本任务至少先修正"渲染对象错误"，帧循环解耦放到 T2.1。

**验收标准**：片段 A 设电影 LUT、片段 B 无滤镜 → 播放跨过 A/B 边界时预览滤镜正确切换；选中 A 但播放 B 时显示 B 的效果。

---

### T1.10 长耗时 AI 操作覆盖用户并发编辑（lost update）

**问题**：`src-tauri/src/commands.rs` 中 `generate_audio` / `generate_subtitles` / `detach_audio` 等命令的模式是"读 project → await 数分钟（TTS/whisper）→ 整个 project 写回"。期间用户在前端做的任何编辑（已通过 `save_project` 落盘）会被**整体覆盖丢失**。

**修复步骤**（最小改动方案）：
1. 把"写回"从**整项目覆盖**改为**重读 + 定向合并**：await 完成后，重新 `storage::get_project(id)` 拿最新版本，只把本次生成的产物（如某 clip 的 audio path、新增的字幕 clips）合并进最新版本再保存。
2. 具体到每个命令：
   - `generate_audio`：完成后重读 project，按 clip id 定位目标 clip 更新其音频字段；若 clip 已被删除则丢弃结果并返回提示。
   - `generate_subtitles`：完成后重读，替换字幕轨内容（字幕轨 id 定位），保留其他轨道的最新状态。
   - `detach_audio` / `separate_vocals` 同理，按 clip id / track id 定向合并。
3. 每个命令加注释说明合并语义。

**验收标准**：点"全部配音"（耗时操作）后立刻在时间线拖动一个视频片段 → 配音完成后，视频片段仍在拖动后的位置，且配音已挂载。

---

## 3. 阶段二：性能优化（播放卡顿 / 编辑卡顿的根源）

### T2.1 播放时钟与 React 状态解耦（最大性能瓶颈）

**问题**：`src/preview/usePreviewEngine.ts` 每帧（60fps）调用 `setEngineState`，而该状态位于 App 顶层 → **播放时整棵组件树 60fps 全量重渲染**。

**修复步骤**：
1. 引入 zustand（`npm i zustand`，本任务是全项目唯一允许加依赖的任务）。
2. 创建 `src/store/playbackStore.ts`：

```typescript
import { create } from 'zustand'

interface PlaybackState {
  currentTime: number
  isPlaying: boolean
  setCurrentTime: (t: number) => void
  setPlaying: (p: boolean) => void
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  currentTime: 0,
  isPlaying: false,
  setCurrentTime: (currentTime) => set({ currentTime }),
  setPlaying: (isPlaying) => set({ isPlaying }),
}))
```

3. `usePreviewEngine.ts` 的每帧 tick 改为调用 `usePlaybackStore.getState().setCurrentTime(t)`（不经过 React setState）。
4. 需要播放头位置的组件（播放头指示线、时间码显示、SubtitleOverlay、Ruler 高亮）改为各自 `usePlaybackStore((s) => s.currentTime)` 订阅——**只有这些小组件**每帧重渲染。
5. App.tsx 中原来的 engineState 大对象引用逐个替换；不需要每帧更新的地方（如面板）改用 `usePlaybackStore.getState()` 按需读取。
6. 移除 `usePreviewEngine.ts` 里 `setInterval(tryInit, 100)` 轮询初始化，改为在 video/canvas ref 挂载的 effect 中直接初始化。

**验收标准**：React DevTools Profiler 录制播放 5 秒 → App 组件本体重渲染次数接近 0（仅播放头/时间码等小组件在更新）；时间线拖动、播放明显变流畅。

---

### T2.2 TimelineTrack memo 化 + 播放头分离

**问题**：`src/timeline/TimelineTrack.tsx` 未 memo，且接收播放头 prop，每帧全轨道重渲染。

**修复步骤**：
1. 从 TimelineTrack 的 props 中**移除播放头时间**（配合 T2.1，播放头指示线抽成独立组件 `PlayheadLine`，自己订阅 playbackStore，绝对定位覆盖在轨道区域上层）。
2. `export default React.memo(TimelineTrack)`。
3. 检查父组件传给 TimelineTrack 的回调 props（onClipDrag 等）是否每次渲染新建——用 `useCallback` 包裹，否则 memo 无效。
4. WaveformCanvas 波形峰值加缓存：模块级 `Map<string, number[]>`（key 为音频路径+时长），已取过的不再走 IPC。

**验收标准**：播放时 Profiler 中 TimelineTrack 不再逐帧渲染；拖动一个 clip 只有所在轨道重渲染。

---

### T2.3 persist 节流与撤销栈瘦身

**问题**：`src/App.tsx` 的 `persist()` 每次编辑执行"全树深拷贝 pushUndo + IPC 落盘 + refreshProjects 刷新项目列表"三连，高频操作卡顿。

**修复步骤**：
1. `refreshProjects()`（项目列表只用于首页）从 persist 中**移除**，改为进入首页时刷新。
2. `saveProject` IPC 落盘加 500ms 防抖（trailing edge，用 ref 存 timer；组件卸载/窗口关闭时 flush 一次确保不丢）。
3. pushUndo 的 `JSON.parse(JSON.stringify(project))` 改为 `structuredClone(project)`（更快）。
4. 撤销栈上限保持 50 不变。

**验收标准**：连续快速拖动滑块/拖拽片段无卡顿；停止操作 0.5 秒后数据已落盘（重启验证）。

---

### T2.4 键盘监听每帧重订阅

**问题**：`src/App.tsx` 键盘快捷键 effect 无依赖数组，每次渲染 remove + add listener。

**修复步骤**：
1. 将 effect 依赖数组设为 `[]`，handler 内部通过 ref 访问易变值：新建 `const stateRef = useRef(...)`，每次渲染更新 `stateRef.current = { project, selectedClipId, ... }`，keydown handler 从 `stateRef.current` 读取。
2. 或者拆出 `useKeyboardShortcuts(handlers)` 自定义 hook，handlers 存 ref。

**验收标准**：effect 只在挂载时执行一次（可用 console.count 临时验证后删除）；所有快捷键功能不回归（逐个测试 README 列出的快捷键）。

---

### T2.5 后端：临时文件清理 + 子进程超时

**问题**：ffmpeg.rs / commands.rs / asr.rs 产生的临时文件（segments 目录、concat 列表、mixed-audio wav、.ass、asr-merged wav、LUT .cube）全部不清理；所有 ffmpeg/whisper 子进程和 reqwest 请求无超时。

**修复步骤**：
1. 新建 `src-tauri/src/temp.rs`：提供 `struct TempDirGuard(PathBuf)`，`Drop` 时 `fs::remove_dir_all`。每次渲染在专属临时目录（含 uuid）下进行，`render_project_video` 持有 guard，函数返回（无论成败）自动清理。
2. 逐个替换：segments 目录、concat 列表、.ass、混音 wav 全部放进该目录；asr.rs 的临时 wav/json 同理用 guard 或显式 `let _ = fs::remove_file(...)` 收尾。
3. 超时：封装 `run_ffmpeg_with_timeout(cmd, secs)`——用 `tokio::process::Command` + `tokio::time::timeout`，超时 kill 子进程并返回错误。渲染类超时建议 30 分钟，探测类（ffprobe、编码器检测）30 秒。注意当前代码用的是 `std::process::Command`，需改为 tokio 版本（调用方均为 async fn，可行）。
4. reqwest：把裸 `reqwest::get` 替换为共享 `Client`（`OnceLock<reqwest::Client>`），构建时 `.timeout(Duration::from_secs(60))`，ai.rs / tts.rs / pexels.rs / ffmpeg.rs 的下载统一使用。下载改流式写盘：`resp.bytes_stream()` 逐块写文件，不再 `.bytes()` 全量进内存。

**验收标准**：导出一次后检查数据目录，无残留 segments/*.mp4、*.ass、concat-*.txt；断网状态下 Pexels 搜索 60 秒内报错而非永久挂起。

---

## 4. 阶段三：架构重构（为功能扩展铺路）

> ⚠️ 本阶段任务较大，每个任务完成后必须全功能回归测试。

### T3.1 拆分 App.tsx —— 状态迁移到 zustand

**目标**：App.tsx 从 3136 行降到 <400 行，业务状态进 store，逻辑进独立模块。

**步骤**（按顺序小步走，每步可编译）：
1. 创建 `src/store/projectStore.ts`：迁移 `project`、`selectedClipId`、undo/redo 栈及 `pushUndo/undo/redo/persist` 逻辑。actions 内部保持不可变更新。
2. 创建 `src/store/uiStore.ts`：迁移 `activeTab`、`zoom`、`contextMenu`、`exportDialogOpen` 等纯 UI 状态。
3. 创建 `src/store/pipelineStore.ts`：迁移 AI 流水线状态（steps、running、错误）。修复原代码中"错误处理读过期闭包 steps"的问题（在 store action 中用 `get()` 读最新值）。
4. 创建业务逻辑模块（纯函数或 store action，不是组件）：
   - `src/editor/clipOperations.ts`：split/copy/paste/duplicate/changeSpeed/reverse/delete（从 App.tsx 平移）。
   - `src/editor/pipeline.ts`：segmentScript → EDL → 配材 → TTS → ASR 全流程编排。
5. 逐个把面板组件的 props 改为直接从 store 取（消除 20+ props 的 prop drilling，如 AudioPanel）。
6. App.tsx 最终只保留布局骨架 + 顶层组合。
7. **注意**：`changeClipSpeed` 迁移时顺便修复已知 bug——变速 ripple 只推同轨 clip，需同时对齐配音/字幕轨（或至少弹提示告知用户其他轨道未联动）。

**验收标准**：`npm run build` 通过；逐项回归：项目增删改、AI 全流水线、时间线全部交互、撤销重做、导出。App.tsx < 400 行。

---

### T3.2 撤销重做改为操作级（可选，建议在 T3.1 后评估）

当前整树快照方式在 T2.3 优化后可接受。若项目规模增大（>500 clips）再实施命令模式：每个操作记录 `{ do, undo }` 反向补丁（可用 immer 的 patches 功能）。**本任务默认跳过，仅在快照方式实测卡顿时执行。**

---

### T3.3 真实导出进度 + 取消

**问题**：进度只有 0%/90%/100% 三个假点；无法取消；重复导出并发写同一文件。

**步骤**：
1. **渲染互斥**：`AppState` 增加 `render_lock: tokio::sync::Mutex<()>` 与 `cancel_flag: Arc<AtomicBool>`。`render_project` 开头 `try_lock`，已占用则返回"已有导出任务进行中"。
2. **真实进度**：`render_project_video` 已知总段数 N，每完成一段发一次事件：`app.emit("render-progress", json!({"phase":"segments","done":i,"total":N,"percent": i*70/N}))`；xfade 合并占 70→85%；字幕混音占 85→100%。（更细粒度可解析 ffmpeg `-progress pipe:1` 输出的 `out_time_ms`，作为后续增强，本任务先做段级进度。）
3. **取消**：每段渲染前检查 `cancel_flag`，为 true 则中断并清理（T2.5 的 TempDirGuard 自动清理）；新增 command `cancel_render` 置位 flag。改用 `tokio::process::Command` 后也可以直接 kill 当前 child。
4. 前端 `ExportDialog.tsx`：进度条按事件的 percent 更新，显示 phase 文案（"渲染片段 3/12"）；加"取消"按钮调用 `cancel_render`。

**验收标准**：导出 10 段项目时进度条平滑推进并显示阶段文案；点击取消后 3 秒内停止且无残留临时文件；导出中再点导出弹提示。

---

### T3.4 视频原声参与导出 + 轨道静音生效

**问题**：段渲染全部 `-an`，视频原声**永远不进导出**（用户不 detach audio 则导出静音）；`Track.muted` 渲染时被忽略。

**步骤**：
1. `merge_audio_clips` 的输入收集逻辑扩展：除 voiceover/audio 轨外，遍历视频轨 clips（跳过 `track.muted == true` 的轨和 `clip.volume == 0` 的 clip），把视频文件作为音频输入（`-ss sourceIn -t duration -i video.mp4`，取其音频流 `[n:a]`），应用 volume/adelay/afade 后进 amix。
2. 变速视频的原声要跟随 `atempo`（atempo 范围 0.5-2.0，超出范围串联多个 atempo，写一个 `build_atempo_chain(speed) -> String` 辅助函数；speed 为负/倒放时本任务先不处理原声，静音即可）。
3. 前端属性面板确认视频 clip 已有音量控件（有 `clip.volume` 字段）；预览引擎 PreviewEngine 中主 video 元素的 volume 同步 clip.volume 与 track.muted。

**验收标准**：导入带声音的视频不做任何 detach → 导出后有原声；轨道点静音 → 导出无该轨声音；2x 变速片段原声音调正常语速加倍。

---

### T3.5 存储加固：schema 版本 + 项目列表提速

**步骤**：
1. `storage.rs`：settings 表写入 `schema_version`（当前=1）；启动时读取，未来迁移在 `migrate(from: u32)` 中集中处理。
2. projects 表增加冗余摘要列 `name, updated_at, duration, thumbnail`（ALTER TABLE + 首次启动回填），`list_projects` 只查摘要列，不再反序列化全部 payload。
3. 坏行不再静默跳过：`list_projects` 返回结构中带 `corrupted: Vec<String>`（坏项目 id），前端首页显示"N 个项目损坏"提示。

**验收标准**：现有项目升级后正常打开；首页加载不随项目体积线性变慢。

---

## 5. 阶段四：对标剪映功能补齐

> 按用户价值排序。每个功能都遵循同一模式：**types.ts + models.rs 加数据结构（serde default 保证旧项目兼容）→ 预览引擎实现 → ffmpeg 导出实现 → 属性面板 UI**。预览与导出必须视觉一致。

### T4.1 画中画真实视频预览（预览保真度第一步）

**问题**：叠加轨 clip 在预览中是 `<img>` 静态缩略图（App.tsx 预览舞台部分），与导出严重不符。

**步骤**：
1. PreviewEngine 改为**多 video 元素池**：为每个"当前时刻活跃的视频 clip"（含叠加轨）分配一个 `<video>`，按 zIndex 排列在舞台容器中；池上限 4 个，超出的仍显示缩略图并提示。
2. 每个 video 独立执行现有的 seek 追赶逻辑（复用主 video 的 drift 校正代码，抽成 `syncVideoToClip(videoEl, clip, timelineTime, rate)` 函数）。
3. 叠加 clip 的 transform（x/y/scale/opacity/cornerRadius）用 CSS 应用到对应 video 元素（`transform/opacity/border-radius`），与导出参数换算一致（导出用像素，预览用舞台比例换算）。
4. clip 进入/离开可视时间窗时挂载/卸载 video，src 预加载提前 1 秒。
5. 顺带删除假双缓冲死代码（preloader video 从未 swap 的部分），或真正实现 swap——本任务选**删除**，双缓冲另行立项。

**验收标准**：两层视频 PiP 项目 → 预览中两层都在动，位置/缩放/透明度与导出结果一致。

---

### T4.2 关键帧动画（剪映核心能力）

**数据模型**（types.ts + models.rs 同步加，均需 `#[serde(default)]` / 可选字段）：

```typescript
export interface Keyframe {
  time: number          // 相对 clip 起点的秒数
  value: number
  easing: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'
}

export interface ClipKeyframes {
  x?: Keyframe[]
  y?: Keyframe[]
  scale?: Keyframe[]
  opacity?: Keyframe[]
  rotation?: Keyframe[]
  volume?: Keyframe[]
}
// Clip 增加字段: keyframes?: ClipKeyframes
```

**执行拆分为 4 个子任务**：

**T4.2a 数据模型 + 插值函数**：
1. types.ts / models.rs 加上述结构；`ClipTransform` 顺带补上缺失的 `rotation` 字段（前端后端同加）。
2. 新建 `src/editor/keyframes.ts`：`sampleKeyframes(kfs: Keyframe[], t: number): number`——二分找相邻两帧，按 easing 插值；t 越界取端点值。`easeInOut` 用 `t<0.5 ? 2t² : 1-(−2t+2)²/2`。
3. 该文件写成纯函数，附 5 个手工断言用例（文件底部注释形式写明输入输出，方便验证）。

**T4.2b 预览支持**：PreviewEngine 每帧对活跃 clip 调 `sampleKeyframes`，把结果应用到 video 元素 CSS transform / opacity 和 GainNode（volume）。无关键帧的属性回落到静态 `clip.transform` 值。

**T4.2c 导出支持**：ffmpeg 侧把 overlay 的 x/y 参数改为表达式：将关键帧序列编译为 ffmpeg 分段线性表达式，如 `x='if(lt(t,1),100+(t-0)*(300-100)/(1-0), if(lt(t,2),300,...))'`（写一个 `keyframes_to_expr(kfs, offset) -> String` Rust 函数，easing 先全部按 linear 导出，预览端同时标注"导出时缓动按线性近似"）。scale 用 `scale=w='iw*expr'` 成本高，改用 `zoompan` 或每帧 scale 表达式（`scale` 滤镜不支持 t 表达式，需用 `scale2ref` 替代方案或 `zoompan`——如实现困难，v1 先支持 x/y/opacity 三个属性的关键帧导出，scale/rotation 标注为预览 only 并在导出前弹窗提示）。
opacity 关键帧：`format=yuva420p,colorchannelmixer=aa='expr'` 同样不支持 t 表达式，用 `geq` alpha 或 `fade` 组合近似；v1 允许只支持首尾两帧的 opacity（映射为 fade in/out），文档中明确该限制。

**T4.2d 时间线/面板 UI**：属性面板每个可动画属性旁加菱形按钮（当前播放头处打/删关键帧）；clip 条上渲染菱形标记；播放头对齐关键帧时按钮高亮。

**验收标准**：给 PiP 片段打两个位置关键帧 → 预览中片段平滑移动 → 导出后运动轨迹与预览一致（linear）。

---

### T4.3 曲线变速

**数据模型**：`Clip` 增加 `speedCurve?: { time: number; speed: number }[]`（time 为源素材归一化 0-1 位置）。预设曲线（蒙太奇/英雄时刻/子弹时间）存为常量模板。

**步骤**：
1. types.ts / models.rs 加字段 + `src/editor/speedCurve.ts` 提供 `curveToSegments(curve, sourceDuration): {sourceIn, sourceOut, speed}[]`——把曲线离散为 N 段（每段 ≤0.5 秒源时长）常速段。
2. 导出：渲染时若 clip 有 speedCurve，先按 curveToSegments 拆成多个内部子 clip 依次渲染（复用现有单 clip 渲染路径，每段一个 setpts + atempo），拼接。
3. 预览：PreviewEngine 播放到该 clip 时按段查表设置 `video.playbackRate`（浏览器 playbackRate 支持 0.0625-16）。
4. UI：变速面板加"曲线"tab，SVG 折线编辑器（拖动控制点），提供 4 个预设。
5. 时长联动：曲线变化导致 clip 时间线时长改变，按 `changeClipSpeed` 现有 ripple 逻辑处理。

**验收标准**：应用"英雄时刻"预设 → 预览中先快后慢再快 → 导出一致，音频经 atempo 无变调。

---

### T4.4 蒙版

**数据模型**：`Clip` 增加：

```typescript
export interface ClipMask {
  kind: 'linear' | 'mirror' | 'circle' | 'rect'
  cx: number; cy: number       // 中心，0-1 归一化
  width: number; height: number // 0-1
  rotation: number
  feather: number               // 羽化 0-1
  invert: boolean
}
```

**步骤**：
1. 前后端模型加字段。
2. 预览：CSS 实现——circle/rect 用 `clip-path`，linear/mirror 用 `mask-image: linear-gradient(...)`，feather 用渐变过渡带宽度。
3. 导出：ffmpeg `geq` 生成 alpha（circle：到中心椭圆距离；rect：max(|dx|/w,|dy|/h)；linear：投影到法线方向），feather 用 `smoothstep` 形式表达式 `clip((d-edge)/feather,0,1)*255`。写成 `mask_filter_expr(mask: &ClipMask) -> String`。
4. UI：属性面板"蒙版"区，4 种类型按钮 + 参数滑块 + 反转开关；预览舞台上可拖动蒙版中心（复用 react-moveable）。

**验收标准**：圆形蒙版 + 羽化 0.2 → 预览与导出边缘柔和度视觉一致；反转生效。

---

### T4.5 转场系统重做（参数化 + 不改变时长）

**前置**：T1.6 已修复音画错位。本任务实现剪映式转场语义。

**数据模型**：`transitionIn/transitionOut: string` 升级为：

```typescript
export interface Transition {
  name: string        // xfade 支持的全部名称
  duration: number    // 0.1 - 2.0 秒
}
// Clip: transitionIn?: Transition（保留字符串反序列化兼容：models.rs 用 untagged enum 或自定义 Deserialize 兼容旧格式）
```

**步骤**：
1. 转场占用两侧 clip 各 duration/2 的**已有素材**（要求两侧 clip 的 source 留有余量，不足则 clamp duration），时间线总长**不变**——切片逻辑改为：转场区间单独成段，段内用 xfade 合成两 clip 重叠部分。
2. TransitionPanel.tsx 从 6 个占位扩展为 xfade 全集（约 40 种，分类展示：叠化/擦除/滑动/缩放），加 duration 滑块。
3. 预览：v1 用 CSS opacity 交叉淡化近似所有转场（两 video 重叠区间一个淡出一个淡入），面板标注"预览为近似效果"。
4. 删除 TransitionPanel.tsx 中"Phase 6"占位注释。

**验收标准**：加 1 秒 fade 转场 → 导出总时长不变，音画同步；转场期间两侧画面交叠过渡。

---

### T4.6 片段多选 / 框选 / 批量操作

**步骤**：
1. `selectedClipId: string | null` 改为 `selectedClipIds: string[]`（projectStore 中，保留 `selectedClip` 派生 getter 取第一个，减少既有代码改动面）。
2. Ctrl/Cmd+点击 clip 切换加选；Shift+点击同轨范围选。
3. 时间线空白处按下拖动画出框选矩形（半透明 div），松开时选中矩形相交的所有 clip（矩形与 clip 的时间范围 × 轨道行范围相交测试）。
4. 批量操作：Delete 删除全部选中（一次 undo 记录）；拖动任一选中 clip 时整组同步位移（复用 computeDraggedClip，对每个选中 clip 应用相同 delta，任一发生吸附则全组用该吸附 delta）；右键菜单的复制/删除作用于全组。

**验收标准**：框选 3 个 clip 整体拖动 1 秒 → 相对位置不变；Ctrl+Z 一次全部还原。

---

### T4.7 视频片段胶片条缩略图

**步骤**：
1. 后端新 command `generate_filmstrip(path, sourceIn, sourceOut, count) -> Vec<String>`：ffmpeg `-ss` 均匀取 count 帧，输出 96px 高 jpg 到缓存目录（文件名含 path hash + 时间点，命中则跳过生成）。
2. TimelineTrack 中视频 clip 的背景从单张缩略图改为横向平铺的 filmstrip 图片序列（按 clip 像素宽度 / 64px 计算需要几张，`background: url(...) repeat-x` 或 flex img 序列）。
3. 异步加载：先显示现有单张缩略图，filmstrip 就绪后替换；trim/zoom 变化 300ms 防抖后重新请求。

**验收标准**：视频 clip 在时间线上显示连续帧条；放大时间线后帧条细化；滚动/拖动不卡顿。

---

### T4.8 贴纸与文字增强

**T4.8a 贴纸轨**：
1. `TrackKind` 增加 `'sticker'`；贴纸 clip 复用 image clip 结构（source 指向 PNG/GIF/WebP）。
2. 内置贴纸库：`src/assets/stickers/` 放 30 个开源 emoji/形状 PNG，新面板 `StickerPanel.tsx` 网格展示，点击添加到播放头位置（默认 3 秒）。
3. 预览/导出复用现有 image overlay 路径（transform/opacity/关键帧全部继承可用）。GIF 动图导出需 ffmpeg `-ignore_loop 0` 输入，预览用 `<img>` 天然支持。

**T4.8b 文字入场/出场动画**：
1. `SubtitleStyle` 增加 `animationIn?: { name: 'fadeIn'|'slideUp'|'typewriter'|'scaleIn', duration: number }`（出场同理）。
2. 预览：SubtitleOverlay 用 CSS animation 实现 4 种。
3. 导出：.ass 支持 `\fad`、`\move`、`\t` 标签——fadeIn→`\fad(300,0)`，slideUp→`\move`，scaleIn→`\t(\fscx..\fscy..)`，typewriter 用 karaoke `\k` 标签逐字显示。修改 .ass 生成函数按 animation 配置输出对应标签。

**验收标准**：贴纸可添加/移动/缩放/导出；字幕设置 fadeIn 后预览与导出都有淡入。

---

### T4.9 预览引擎音频修复（fade/实时音量/倒放提示）

**步骤**：
1. **fadeIn/fadeOut 生效**：`startAudioScheduling` 为每个 source 建独立 GainNode，按 clip.fadeIn/fadeOut 调用 `gain.linearRampToValueAtTime`（起点 `max(now, clipStart)` 换算到 AudioContext 时钟）。
2. **实时音量**：播放中改 volume 时找到该 clip 活跃 GainNode 直接 `gain.value = v`（引擎维护 `Map<clipId, GainNode>`）。音量上限对齐 UI 的 200%（当前 clamp ≤1，改为 ≤2）。
3. **倒放**：浏览器 video 不支持负 playbackRate。预览端遇到 `speed < 0` 的 clip 显示角标"倒放（预览不支持，导出生效）"，播放时按正速播放。右键"倒放"逻辑保持（导出端已有 reverse 滤镜）。
4. 删除 PreviewEngine.ts 死代码 `buildCssFilter` 和遗留 `console.log`。

**验收标准**：设置 1 秒 fadeIn 的音频 → 预览可听到淡入；播放中拖音量滑块即时变化。

---

### T4.10 导出增强

**步骤**：
1. ExportDialog 增加：编码格式（H.264/HEVC，HEVC 走 `hevc_videotoolbox`/`libx265`，需扩展 `detect_hw_encoder` 与 `encoder_args`）、导出范围（全片/所选片段区间）、仅导出音频（mp3/wav，跳过视频管线直接 merge_audio_clips 输出）、GIF 导出（palettegen+paletteuse 两遍法，限 720p/15fps）。
2. 导出范围：`render_project_video` 加 `range: Option<(f64, f64)>` 参数，切片前先过滤/裁剪 clips 到区间内并整体平移到 0。

**验收标准**：四种新导出模式各出一个文件且内容正确。

---

## 6. 已知次要问题清单（穿插修复，每次触碰相应文件时顺带完成）

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| M1 | `src/fonts.ts` | "ZCOOL XiaoWei" 重复定义（React key 警告） | 删一个 |
| M2 | `src/panels/TextPanel.tsx` | 挂载即注入 50 个 Google Fonts link，离线挂起 | 改为选择字体时按需注入 + 3s 超时降级系统字体 |
| M3 | `src/panels/GenerateWizard.tsx` | 用 `alert()` 报错 | 换为项目内 toast/状态条模式（参考现有 status 提示） |
| M4 | `src/timeline/Ruler.tsx` | 硬编码 30fps | 读 `project.renderConfig.fps` |
| M5 | `src/timeline/clipInteraction.ts` | 吸附阈值 0.3 秒与 zoom 无关 | 改为像素阈值：`8 / pxPerSecond` 秒 |
| M6 | `src/timeline/TimelineTrack.tsx` | `pxPerSecond` prop 被局部变量遮蔽 | 删除死参数 |
| M7 | `src/types.ts` | `MediaSource.kind`、`SubtitleStyle.position` 等用 string | 改 union type，同步 models.rs 校验 |
| M8 | `src/tauri.ts` | 音色样音用 `number[]` JSON 传字节 | 改传文件路径，后端直接读文件 |
| M9 | `src/tauri.ts` | web fallback 缺失的命令直接 throw | 缺失命令返回明确"需要桌面端"错误对象，UI 友好提示 |
| M10 | `src-tauri/src/tts.rs` | `ssl_verify=False`；Python 内联脚本 | 去 Python 化：直接用 reqwest 调 Gradio HTTP API（`POST /call/_clone_fn` + SSE 结果），删除 Python 依赖探测 |
| M11 | `src-tauri/src/tts.rs` | 时长估算 clamp 30s 截断长文本 | 上限提高到 120s 或移除 clamp，按 5.2 字/秒纯估算 |
| M12 | `src-tauri/src/asr.rs` | 翻译路径丢词级时间戳 → 卡拉OK失效 | 翻译后保留原 words，按字数比例映射时间或退化为句级高亮并提示 |
| M13 | `src-tauri/src/asr.rs` | `transcribe_to_sentences` 长停顿断句归属错误 | big_gap 检测应在**追加当前 cue 之前**判断并先断句 |
| M14 | `src-tauri/src/ffmpeg.rs` | subtitles/lut3d 滤镜路径未转义单引号 | 补 `'` → `'\\''` 转义，抽 `escape_filter_path()` 函数统一处理 |
| M15 | `src-tauri/src/ffmpeg.rs` | `detect_hw_encoder` 循环内重复跑 `-encoders`；ffmpeg.rs:83 读未初始化 OnceLock | 提取循环外；删除死代码 |
| M16 | `src-tauri/src/ffmpeg.rs` | 波形生成全量 PCM 进内存 | ffmpeg 输出降采样（`aresample=8000` + 单声道）后再读 |
| M17 | `src-tauri/Cargo.toml` | sha1、thiserror 疑似未使用 | `cargo machete` 或手动确认后删除 |
| M18 | `src-tauri/src/lib.rs` | 初始化 `expect` panic 无用户提示 | 失败时用 dialog 插件弹错误框再退出 |
| M19 | `src-tauri/tauri.conf.json` | `csp: null` | 配置最小 CSP（default-src 'self'; 允许 asset protocol 与所需 API 域名） |
| M20 | `src-tauri/src/commands.rs` | `probe_*` 失败 `unwrap_or(0)` 静默 | 返回 Result 并在调用处给用户可见错误 |
| M21 | `src/main.tsx` / SubtitleOverlay | DOM expando `_lastClick` 双击检测 | 改 `onDoubleClick` |
| M22 | 全局 | `eprintln!` 散落 | 引入 `tauri-plugin-log`，替换为 `log::warn!/error!` |

---

## 7. 执行顺序总表

| 顺序 | 任务 | 规模 | 依赖 |
|---|---|---|---|
| 1 | T1.1 拖拽持久化 | 小 | 无 |
| 2 | T1.2 编辑文字误绑 | 小 | 无 |
| 3 | T1.3 属性面板持久化 | 小 | T1.1（复用 snapshot 机制） |
| 4 | T1.4 硬件编码器 | 中 | 无 |
| 5 | T1.5 导出分辨率 | 中 | T1.4（同批改签名） |
| 6 | T1.6 转场音画同步 | 中 | 无 |
| 7 | T1.7 trim×speed | 小 | 无 |
| 8 | T1.8 滤镜渲染对象 | 小 | 无 |
| 9 | T1.10 lost update | 中 | 无 |
| 10 | T2.1 播放解耦 zustand | 大 | 无 |
| 11 | T2.2 轨道 memo | 小 | T2.1 |
| 12 | T2.3 persist 节流 | 小 | 无 |
| 13 | T2.4 键盘监听 | 小 | 无 |
| 14 | T2.5 临时文件+超时 | 中 | 无 |
| 15 | T3.1 拆分 App.tsx | 大 | T2.1 |
| 16 | T3.3 真实进度+取消 | 中 | T2.5 |
| 17 | T3.4 视频原声导出 | 中 | 无 |
| 18 | T3.5 存储加固 | 小 | 无 |
| 19 | T4.1 PiP 真实预览 | 大 | T2.1 |
| 20 | T4.9 音频修复 | 中 | T4.1 |
| 21 | T4.2a-d 关键帧 | 大 | T4.1, T3.1 |
| 22 | T4.5 转场重做 | 大 | T1.6 |
| 23 | T4.6 多选框选 | 中 | T3.1 |
| 24 | T4.7 胶片条 | 中 | 无 |
| 25 | T4.3 曲线变速 | 大 | T4.2 |
| 26 | T4.4 蒙版 | 大 | T4.1 |
| 27 | T4.8 贴纸+文字动画 | 中 | T4.1 |
| 28 | T4.10 导出增强 | 中 | T1.4, T1.5 |
| — | T1.7~T1.9 / M1-M22 | 小 | 穿插执行 |

---

## 8. 每个任务的通用完成检查清单

- [ ] `npm run build` 通过（前端改动时）
- [ ] `cargo check` 通过（后端改动时）
- [ ] 手动执行任务的验收标准并逐条确认
- [ ] 撤销/重做对新操作生效（编辑类任务）
- [ ] 预览效果与导出效果一致（渲染类任务）
- [ ] 旧项目文件能正常打开（数据模型改动时，用改动前创建的项目验证）
- [ ] 无新增 `console.log` / `eprintln!` 遗留
- [ ] 未修改任务范围之外的代码
