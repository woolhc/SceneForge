# SceneScript Editor Core P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除保存/撤销竞态、跨项目历史污染、变速倒放分割裁剪错误和导出时长截断。

**Architecture:** 用无依赖 TypeScript 测试执行器锁定编辑语义；用 ProjectSaveCoordinator 串行保存；用 ClipTimeMap 统一时间映射；前后端共享同一项目输出时长规则。修改保持局部，不在 P0 重写 UI 或渲染器。

**Tech Stack:** React 19、TypeScript 5、esbuild、Node.js、Tauri 2、Rust、FFmpeg。

## Global Constraints

- 不新增 npm 或 Cargo 依赖。
- 不提交 Git；当前工作树已有上一轮未提交修复。
- 所有行为修复先写失败测试并确认 RED。
- 前端模型字段保持兼容，不修改 SQLite payload schema。
- 每个任务完成后运行对应最小测试。

---

### Task 1: TypeScript 回归测试执行器

**Files:**
- Create: `scripts/run-ts-tests.mjs`
- Modify: `package.json`
- Create: `src/editor/testHarnessSmoke.test.ts`

**Interfaces:**
- Produces: `npm run test:ts`，执行所有 `src/**/*.test.ts`。

- [x] 创建一个故意失败的 smoke test，使用 `node:assert/strict`。
- [x] 创建 esbuild bundle runner，输出到系统临时目录并逐个执行测试文件。
- [x] 运行 `npm run test:ts`，确认因 smoke assertion 失败。
- [x] 将 smoke assertion 改为通过，重新运行并确认 PASS。

### Task 2: 保存队列和项目历史隔离

**Files:**
- Create: `src/store/projectSaveCoordinator.ts`
- Create: `src/store/projectSaveCoordinator.test.ts`
- Modify: `src/store/projectHistory.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `ProjectSaveCoordinator.schedule(project)`, `saveNow(project)`, `cancelPending(projectId)`, `dispose()`。
- Produces: `useProjectHistory` 根据当前 `projectId` 自动重置历史。

- [x] 写测试：schedule(A1) 后 saveNow(A0) 的实际保存顺序必须为 A1、A0，最终状态为撤销快照 A0。
- [x] 写测试：连续 schedule(A1)、schedule(A2) 只保存 A2。
- [x] 写测试：项目 ID 变化时历史栈状态重置。
- [x] 运行测试并确认现有实现无法满足。
- [x] 实现 ProjectSaveCoordinator 串行队列和防抖替换。
- [x] 将 projectHistory 的直接 IPC 保存替换为 coordinator。
- [x] 项目切换时重置 undo/redo、交互快照和选择状态。
- [x] 运行保存协调器测试和前端构建。

### Task 3: 统一 Clip 时间映射

**Files:**
- Create: `src/editor/clipTimeMap.ts`
- Create: `src/editor/clipTimeMap.test.ts`
- Modify: `src/timeline/clipInteraction.ts`
- Modify: `src/editor/clipOperations.ts`
- Modify: `src/preview/PreviewEngine.ts`
- Modify: `src/preview/WebCodecsRenderer.ts`

**Interfaces:**
- Produces: `timelineToSourceTime`, `sliceClipByTimelineRange`, `splitClipByTimelineTime`, `sliceSpeedCurve`。

- [x] 写常速 1x/2x 中点映射测试。
- [x] 写 `speed < 0` 和 `reverse=true` 的倒放映射测试。
- [x] 写曲线变速分割后源区间连续、总时长保持测试。
- [x] 写曲线裁剪后控制点重新归一化测试。
- [x] 运行测试并确认 RED。
- [x] 实现 ClipTimeMap 最小纯函数。
- [x] 替换 splitClipAt 的常量 speed 计算。
- [x] 替换 trim 左右手柄的源区间计算。
- [x] 让 PreviewEngine 和 WebCodecsRenderer 使用统一映射。
- [x] 运行 TypeScript 测试和构建。

### Task 4: 统一项目输出时长

**Files:**
- Create: `src/editor/projectDuration.ts`
- Create: `src/editor/projectDuration.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/preview/PreviewEngine.ts`
- Modify: `src/preview/WebCodecsRenderer.ts`
- Modify: `src-tauri/src/ffmpeg.rs`

**Interfaces:**
- Produces: 前端 `projectOutputDuration(project)`。
- Produces: Rust `project_output_duration(project: &Project) -> f64`。

- [x] 写前端测试：音频/字幕晚于视频时返回最长结束时间，hidden 轨不参与。
- [x] 写 Rust 测试覆盖相同规则。
- [x] 运行测试确认 RED。
- [x] 前端所有 duration 读取统一调用 projectOutputDuration。
- [x] Rust 渲染时长改用 project_output_duration。
- [x] 对无活跃画面的尾部输出黑底并保持音频/字幕时长。
- [x] 运行 TS、Rust 和 FFmpeg 时长测试。

### Task 5: P0 完整验证

**Files:**
- Modify: `docs/superpowers/plans/2026-07-10-editor-core-p0.md` only for checkbox status.

- [x] 运行 `npm run test:ts`，预期全部通过。
- [x] 运行 `npm run build`，预期 exit 0。
- [x] 运行 `cargo test --locked`，预期 0 failed。
- [x] 运行 `node scripts/verify-proxy-generation.mjs`。
- [x] 运行 `node scripts/verify-r32-duration.mjs`。
- [x] 运行 `node scripts/verify-web-fallback-coverage.mjs`。
- [x] 运行 `git diff --check` 并检查变更范围。
- [x] 记录剩余 P1 风险，不在 P0 顺手修改。
