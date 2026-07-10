# SceneScript RenderGraph A1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 TypeScript/Rust 对齐的 RenderGraph 时间点求值器，并让默认预览与 WebCodecs 预览消费统一的活跃图层、源时间、关键帧、转场、音频和字幕结果。

**Architecture:** `compileRenderGraph(Project)` 生成不可变运行时快照，`evaluateFrame(RenderGraph, time)` 生成纯数据 `EvaluatedFrame`。两个预览器只执行求值结果；Rust 用相同黄金 fixture 实现契约，为后续 FFmpeg 编译器迁移提供基础。

**Tech Stack:** React 19、TypeScript 5、Node assert、esbuild、Tauri 2、Rust、serde/serde_json。

## Global Constraints

- 不新增 npm 或 Cargo 依赖。
- 不修改 Project/SQLite 持久化 schema。
- 不提交 Git；当前 `main` 工作树已有未提交 P0 修复。
- 所有行为变化先写失败测试并确认 RED。
- A1 不重写 FFmpeg 主渲染流程。
- A1 不改变现有 React `EngineState` 对外结构。
- 所有浮点黄金断言统一规范化到 6 位小数。

---

### Task 1: TypeScript RenderGraph 契约与编译器

**Files:**
- Create: `src/renderGraph/types.ts`
- Create: `src/renderGraph/compileRenderGraph.ts`
- Create: `tests/renderGraph/compileRenderGraph.test.ts`

**Interfaces:**
- Consumes: `Project`, `Clip`, `MediaSource`, `TrackKind`, `projectOutputDuration(project)`。
- Produces: `compileRenderGraph(project: Project): RenderGraph`。
- Produces: `logicalCanvasForRatio(ratio: string): { width: number; height: number }`。

- [x] **Step 1: 写编译器失败测试**

测试构造 video/image/audio/subtitle/hidden/orphan clip，断言：

```ts
const graph = compileRenderGraph(project);
assert.deepEqual(graph.canvas, { width: 1920, height: 1080 });
assert.equal(graph.duration, 12);
assert.deepEqual(graph.layers.map((layer) => layer.id), ["base", "overlay", "audio", "subtitle"]);
assert.equal(graph.layers.some((layer) => layer.id === "hidden"), false);
assert.equal(graph.layers.some((layer) => layer.id === "orphan"), false);
project.clips[0].duration = 99;
assert.equal(graph.layers[0].clip.duration, 5, "graph owns an immutable snapshot");
```

- [x] **Step 2: 运行测试确认 RED**

Run: `npm run test:ts`

Expected: FAIL，无法解析 `src/renderGraph/compileRenderGraph`。

- [x] **Step 3: 实现最小契约与编译器**

`RenderGraph` 必须包含：

```ts
export type RenderGraph = {
  duration: number;
  canvas: { width: number; height: number };
  layers: RenderLayer[];
};

export type RenderLayer = {
  id: string;
  trackId: string;
  trackKind: TrackKind;
  trackOrder: number;
  trackMuted: boolean;
  clip: Clip;
  media: MediaSource | null;
};
```

编译器通过 `structuredClone(project)` 固化快照，过滤 hidden 和 orphan clip，按 `trackOrder` 降序、`startOnTrack` 升序、id 升序排序。

- [x] **Step 4: 运行测试确认 GREEN**

Run: `npm run test:ts`

Expected: 编译器测试与现有 P0 测试全部 PASS。

---

### Task 2: TypeScript 时间点求值器与黄金 fixture

**Files:**
- Create: `src/renderGraph/evaluateFrame.ts`
- Create: `src/renderGraph/normalizeFrame.ts`
- Create: `tests/fixtures/render-graph-golden.json`
- Create: `tests/renderGraph/evaluateFrame.test.ts`

**Interfaces:**
- Consumes: `RenderGraph`, `timelineToSourceTime`, `sampleAllKeyframes`, `speedAtTimelineTime`, `transitionDuration`, `DEFAULT_SUBTITLE_STYLE`。
- Produces: `evaluateFrame(graph: RenderGraph, time: number): EvaluatedFrame`。
- Produces: `normalizeEvaluatedFrame(frame: EvaluatedFrame): NormalizedEvaluatedFrame`。

- [x] **Step 1: 创建黄金场景和失败测试**

fixture 至少包含时间点 `0`、`1`、`2.5`、`5`、`9.5`，覆盖：

- base + overlay 图层顺序；
- 2x、曲线变速和 reverse 源时间；
- transform/opacity/volume 关键帧；
- transition in/out progress；
- muted 音轨排除和淡入淡出 gain；
- 字幕样式与 activeWordIndex；
- hidden 和孤儿 clip 排除。

测试读取 fixture：

```ts
const graph = compileRenderGraph(fixture.project as Project);
for (const sample of fixture.samples) {
  assert.deepEqual(
    normalizeEvaluatedFrame(evaluateFrame(graph, sample.time)),
    sample.expected,
  );
}
```

- [x] **Step 2: 运行测试确认 RED**

Run: `npm run test:ts`

Expected: FAIL，缺少 `evaluateFrame` 或输出与 fixture 不一致。

- [x] **Step 3: 实现视觉、音频和字幕求值**

求值器规则：

```ts
const relativeTime = clampedTime - clip.startOnTrack;
const sourceTime = timelineToSourceTime(clip, relativeTime);
const sampled = sampleAllKeyframes(clip.keyframes, relativeTime);
const fadeInGain = clip.fadeIn > 0 ? Math.min(1, relativeTime / clip.fadeIn) : 1;
const remaining = clip.duration - relativeTime;
const fadeOutGain = clip.fadeOut > 0 ? Math.min(1, remaining / clip.fadeOut) : 1;
```

转场进度使用单调 0..1：入场为 `relativeTime / duration`；出场为 `remaining / duration`。视觉层 `effectiveOpacity` 乘以两者。

字幕 words 同时兼容绝对项目时间和 clip 相对时间：当所有 cue 都落在 `0..clip.duration` 时按相对时间匹配，否则按绝对时间匹配。

- [x] **Step 4: 运行测试确认 GREEN**

Run: `npm run test:ts`

Expected: 所有 TypeScript 测试 PASS。

---

### Task 3: 两个预览器接入统一求值结果

**Files:**
- Modify: `src/preview/PreviewEngine.ts`
- Modify: `src/preview/WebCodecsRenderer.ts`
- Modify: `src/preview/PreviewRenderer.ts`
- Create: `tests/renderGraph/previewProjection.test.ts`

**Interfaces:**
- Consumes: `compileRenderGraph`, `evaluateFrame`, `EvaluatedFrame`。
- Produces: `projectFrameToEngineState(frame: EvaluatedFrame): Pick<EngineState, "activeVideoClip" | "activeOverlayClips" | "activeSubtitleClips">`。

- [x] **Step 1: 写预览投影失败测试**

```ts
const frame = evaluateFrame(compileRenderGraph(project), 3);
const state = projectFrameToEngineState(frame);
assert.equal(state.activeVideoClip?.id, "base");
assert.deepEqual(state.activeOverlayClips.map((clip) => clip.id), ["overlay"]);
assert.deepEqual(state.activeSubtitleClips.map((clip) => clip.id), ["subtitle-top"]);
```

- [x] **Step 2: 运行测试确认 RED**

Run: `npm run test:ts`

Expected: FAIL，缺少投影函数。

- [x] **Step 3: 实现兼容投影并接入 setProject/tick**

- `setProject()` 编译并缓存 RenderGraph。
- 每次 seek/tick 只调用一次 `evaluateFrame()`，同一帧的同步、绘制和 publish 复用结果。
- 默认预览用 `frame.visualLayers[0]` 作为 base，其余作为 overlay。
- WebCodecs publish 必须开始返回 subtitle layers，不再固定空数组。
- 删除两个预览器中重复的活跃 clip 排序、源时间、关键帧和转场透明度求值函数；媒体查找辅助函数可保留。

- [x] **Step 4: 运行 TypeScript 测试和构建**

Run: `npm run test:ts && npm run build`

Expected: 测试全部 PASS，TypeScript 编译成功。

---

### Task 4: Rust RenderGraph 契约与共享黄金测试

**Files:**
- Create: `src-tauri/src/render_graph.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/render_graph.rs`
- Consume: `tests/fixtures/render-graph-golden.json`

**Interfaces:**
- Consumes: `crate::models::{Project, Clip, MediaSource, TrackKind}`。
- Produces: `compile_render_graph(project: &Project) -> RenderGraph`。
- Produces: `evaluate_frame(graph: &RenderGraph, time: f64) -> EvaluatedFrame`。
- Produces: `normalize_evaluated_frame(frame: &EvaluatedFrame) -> serde_json::Value`。

- [x] **Step 1: 添加 Rust 共享 fixture 失败测试**

```rust
let fixture: GoldenFixture = serde_json::from_str(include_str!(
    "../../tests/fixtures/render-graph-golden.json"
))?;
let graph = compile_render_graph(&fixture.project);
for sample in fixture.samples {
    assert_eq!(normalize_evaluated_frame(&evaluate_frame(&graph, sample.time)), sample.expected);
}
```

- [x] **Step 2: 运行测试确认 RED**

Run: `cd src-tauri && cargo test --locked render_graph`

Expected: FAIL，模块或函数不存在。

- [x] **Step 3: 实现 Rust 最小求值器**

实现与 TypeScript 相同的层过滤、排序、活跃区间、常速/倒放/曲线源时间、线性关键帧、转场、音量淡入淡出和字幕 activeWordIndex。A1 不生成 FFmpeg filter。

- [x] **Step 4: 运行 Rust 测试确认 GREEN**

Run: `cd src-tauri && cargo test --locked render_graph`

Expected: Rust 黄金测试 PASS。

---

### Task 5: A1 完整验证与计划回写

**Files:**
- Modify: `docs/superpowers/plans/2026-07-10-render-graph-a1.md` only for checkbox status.

- [x] 运行 `npm run test:ts`。
- [x] 运行 `npm run build`。
- [x] 运行 `cargo test --locked`。
- [x] 运行 `node scripts/verify-web-fallback-coverage.mjs`。
- [x] 运行 `node scripts/verify-proxy-generation.mjs`。
- [x] 运行 `node scripts/verify-r32-duration.mjs`。
- [x] 运行 `git diff --check`。
- [x] 检查两个预览器不再各自实现活跃图层排序和源时间映射。
- [x] 记录 A2 剩余工作：Rust RenderGraph → FFmpeg segment/filter compiler。
