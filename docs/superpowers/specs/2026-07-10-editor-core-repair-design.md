# SceneScript 编辑内核修复设计

## 目标

先修复会造成项目数据覆盖、时间线源区间错误和预览/导出时长不一致的核心问题，再进入渲染一致性、任务恢复和剪映能力补齐。P0 完成后，普通编辑操作必须满足：保存顺序确定、撤销不反弹、项目历史隔离、常速/曲线变速/倒放的分割裁剪结果连续、导出时长与时间线一致。

## 范围分层

### P0：编辑内核可靠性

1. 建立可运行的 TypeScript 回归测试基线，不新增 npm 依赖。
2. 抽离项目保存调度器，串行化同一项目的保存，并允许撤销/重做取消尚未入队的防抖保存。
3. 历史记录按项目会话隔离，切换项目时清空 undo/redo 和交互快照。
4. 建立统一的 Clip 时间映射，覆盖常速、曲线变速和倒放。
5. 分割和裁剪统一通过时间映射更新 sourceIn/sourceOut，并切片归一化 speedCurve。
6. 建立统一项目输出时长规则，预览和 FFmpeg 导出都使用参与输出的全部轨道。

### P1：预览与导出一致性

1. 建立平台无关 RenderGraph。
2. 默认预览、WebCodecs 和 FFmpeg 使用同一时间线求值结果。
3. 补齐转场、视觉特效、LUT、字体和字幕布局的实时预览。
4. 引入固定逻辑画布，导出分辨率只负责最终缩放。
5. 将 hwaccel、crf、encoderPreset 编译成可测试的 EncoderPolicy。

### P2：任务与存储可靠性

1. 将 AI 一键生成迁移为后端持久化任务。
2. 接入 checkpoint、取消、重试、幂等步骤和恢复。
3. 替换不受控 Python TTS 调用，启用 TLS 校验和超时。
4. 引入素材引用计数、缓存回收、项目版本和数据库迁移框架。
5. API Key 使用系统凭据存储。

### P3：剪映能力补齐

在 P0-P2 稳定后再实现组合片段、链接音视频、roll/slip/slide、运动跟踪、智能抠像、文本式剪辑、音频总线、导出队列和素材箱。不得在共享编辑/渲染语义稳定前继续复制功能到三套执行路径。

## P0 架构

### 1. TypeScript 测试执行器

使用仓库现有的 esbuild 依赖，将 `src/**/*.test.ts` 分别 bundle 到临时目录，再由 Node 执行。测试文件使用 `node:assert/strict`，无需引入 Vitest/Jest。

### 2. ProjectSaveCoordinator

新增纯 TypeScript 类，负责：

- 每个项目仅保留一个待防抖快照。
- 同一项目所有实际保存串行执行。
- `saveNow()` 取消待防抖快照，并排在已开始保存之后执行。
- `cancelPending(projectId)` 只取消尚未入队的保存。
- 保存失败保留错误，不静默把失败状态标记为已保存。
- `dispose()` 清理 timer，但不创建跨项目共享历史。

历史 hook 只负责 undo/redo；项目 ID 变化时清空两个栈。撤销和重做通过 `saveNow()` 落盘，保证其顺序晚于此前已经开始的保存。

### 3. ClipTimeMap

新增纯函数模块：

- `timelineToSourceOffset(clip, timelineOffset)`
- `timelineToSourceTime(clip, timelineOffset)`
- `sliceClipByTimelineRange(clip, start, end, newId?)`
- `splitClipByTimelineTime(clip, timelineTime, newId)`
- `sliceSpeedCurve(curve, sourceStartRatio, sourceEndRatio)`

内部使用现有曲线离散规则。倒放 clip 的实际源时间从 sourceOut 向 sourceIn 递减，但持久化的 sourceIn/sourceOut 始终保持升序。切片后的 speedCurve 重新归一化到 0..1。

### 4. ProjectDurationPolicy

新增前端纯函数和 Rust 对应函数。默认输出时长取所有未隐藏且参与输出轨道 clip 的最大结束时间：视频、图片、配音、音频、字幕均参与；muted 音频轨仍保留时间线长度，hidden 轨不参与。没有画面的输出区间由 FFmpeg 生成黑底，不能截断音频或字幕。

## 错误处理

- 保存失败必须更新状态栏或 toast，不得被空 catch 吞掉。
- 时间映射遇到无效 source range、零速度或非法曲线时返回受控 fallback，不生成 NaN/负区间。
- FFmpeg 输出时长不得小于统一 ProjectDurationPolicy。

## 验收标准

1. 编辑后 500ms 内撤销，等待 1 秒并重新打开项目，仍保持撤销结果。
2. 项目 A 编辑后切到 B，B 的 undo 栈为空；切回 A 不会把 B 的状态写入 A。
3. 常速、2x、曲线变速、speed<0 和 reverse=true 的片段在中点分割后，两个片段源区间连续且总时间线时长不变。
4. 曲线变速片段左右裁剪后，speedCurve 仍覆盖 0..1，sourceIn/sourceOut 合法。
5. 音频或字幕晚于最后视频结束时，导出文件时长与编辑器时间线一致，尾部画面为黑底。
6. `npm run build`、TypeScript 回归测试、`cargo test --locked`、两个 FFmpeg 冒烟脚本和 `git diff --check` 全部通过。

## 非目标

- P0 不实现新的剪映功能。
- P0 不重写整个 App.tsx 或 ffmpeg.rs。
- P0 不启用 WebCodecs 为默认路径。
- P0 不修改数据库 payload schema。
- P0 不新增第三方依赖。

