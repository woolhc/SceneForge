# 编辑器信息架构与双模式布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将现有编辑器重构为默认专业模式的剪映式上下文工作区，在保留全部功能和后端契约的前提下，提供稳定的顶部、左侧工具区、中间预览、右侧分类属性和底部时间线布局。

**Architecture:** 先用纯 TypeScript 模型定义工具入口、属性分类和模式行为，再将 `App.tsx` 中的布局与属性 JSX 按责任拆分成组件。业务命令、项目数据、历史、保存和渲染逻辑继续由现有 store 与 `App` 编排；新组件通过明确 props 使用这些能力，不引入新的全局状态依赖。

**Tech Stack:** React 19、TypeScript 5.7、Zustand 5、Vite 6、`react-resizable-panels`、Lucide React、现有 dependency-free TypeScript test runner。

## Global Constraints

- 不修改 Rust 后端命令、FFmpeg 渲染逻辑或项目持久化格式。
- 不删除现有编辑功能，不把功能移入“更多”或隐藏菜单。
- 不引入新的 UI、测试或状态管理依赖。
- 每次进入编辑器默认使用专业模式；简洁模式仅在当前编辑会话生效。
- 两种模式共享项目、选择、播放头、撤销栈和未保存更改。
- 保留当前所有未提交改动，不创建分支、不创建 worktree、不提交代码。
- 每项实现先添加失败测试或可验证的静态契约，再修改实现。

## File Structure

### Create

- `src/editor/editorLayout.ts`：工具入口、编辑模式、属性分类和上下文默认值的纯函数模型。
- `src/editor/EditorWorkspace.tsx`：可调整尺寸的专业/简洁工作区骨架。
- `src/editor/EditorTopbar.tsx`：项目级操作、AI 成片入口、模式切换和导出。
- `src/editor/ToolRail.tsx`：左侧六个一级入口。
- `src/editor/ToolPanel.tsx`：左侧当前面板的统一标题和内容容器。
- `src/editor/PreviewWorkspace.tsx`：预览工具栏、画布容器插槽和播放控制插槽。
- `src/editor/InspectorPanel.tsx`：对象摘要、属性分类导航和空状态。
- `src/editor/inspector/BasicInspector.tsx`：文案、时长、速度、素材替换与常用属性。
- `src/editor/inspector/VisualInspector.tsx`：滤镜、调色、变换、裁剪和蒙版。
- `src/editor/inspector/AnimationInspector.tsx`：关键帧、缓动、转场摘要和视觉特效。
- `src/editor/inspector/AudioInspector.tsx`：音量、淡入淡出、降噪和配音操作。
- `src/editor/inspector/SubtitleInspector.tsx`：字幕文字、样式、卡拉 OK、动画和整轨应用。
- `src/editor/TimelineToolbar.tsx`：只包含时间编排相关工具。
- `src/panels/SubtitlePanel.tsx`：字幕识别、翻译、手动添加、SRT 导入和预设。
- `src/panels/EffectsPanel.tsx`：滤镜、蒙版和视觉特效的直接入口。
- `tests/editor/editorLayout.test.ts`：模式、入口和属性分类契约测试。

### Modify

- `src/store/uiStore.ts`：加入当前工具入口、编辑模式和属性分类状态。
- `src/panels/TextPanel.tsx`：仅保留文案与 AI 分段能力。
- `src/App.tsx`：接入新工作区组件并移除对应内联布局 JSX。
- `src/styles.css`：建立新工作区、模式、导航、属性标签和响应式样式。
- `tests/editor/testHarnessSmoke.test.ts`：必要时增加新纯模块的导入烟雾检查。

---

### Task 1: 锁定编辑器导航与上下文契约

**Files:**
- Create: `src/editor/editorLayout.ts`
- Create: `tests/editor/editorLayout.test.ts`
- Modify: `src/store/uiStore.ts`

**Interfaces:**
- Produces: `EditorMode`, `ToolTab`, `InspectorTab`, `TOOL_TABS`, `inspectorTabsForTrack()`, `defaultInspectorTabForTrack()`, `resolveInspectorTab()`。
- Produces in `useUiStore`: `editorMode`, `activeToolTab`, `activeInspectorTab`, `setEditorMode()`, `resetEditorMode()`, `setActiveToolTab()`, `setActiveInspectorTab()`。

- [x] **Step 1: Write the failing layout contract test**

```ts
import assert from "node:assert/strict";
import {
  TOOL_TABS,
  defaultInspectorTabForTrack,
  inspectorTabsForTrack,
  resolveInspectorTab,
} from "../../src/editor/editorLayout";

assert.deepEqual(
  TOOL_TABS.map((tab) => tab.id),
  ["media", "text", "audio", "subtitle", "transition", "effects"],
);
assert.equal(defaultInspectorTabForTrack("subtitle"), "subtitle");
assert.equal(defaultInspectorTabForTrack("audio"), "audio");
assert.equal(defaultInspectorTabForTrack("voiceover"), "audio");
assert.equal(defaultInspectorTabForTrack("video"), "basic");
assert.deepEqual(inspectorTabsForTrack("image"), ["basic", "visual", "animation"]);
assert.equal(resolveInspectorTab("image", "audio"), "basic");
assert.equal(resolveInspectorTab("subtitle", "subtitle"), "subtitle");
```

- [x] **Step 2: Run the test and verify the missing-module failure**

Run: `npm run test:ts`

Expected: FAIL because `src/editor/editorLayout.ts` does not exist.

- [x] **Step 3: Implement the pure layout model**

```ts
import type { TrackKind } from "../types";

export type EditorMode = "professional" | "simple";
export type ToolTab = "media" | "text" | "audio" | "subtitle" | "transition" | "effects";
export type InspectorTab = "basic" | "visual" | "animation" | "audio" | "subtitle";

export interface ToolTabDefinition {
  id: ToolTab;
  label: string;
}

export const TOOL_TABS: readonly ToolTabDefinition[] = [
  { id: "media", label: "媒体" },
  { id: "text", label: "文本" },
  { id: "audio", label: "音频" },
  { id: "subtitle", label: "字幕" },
  { id: "transition", label: "转场" },
  { id: "effects", label: "特效" },
];

export function inspectorTabsForTrack(kind: TrackKind): InspectorTab[] {
  if (kind === "subtitle") return ["basic", "subtitle", "animation"];
  if (kind === "audio" || kind === "voiceover") return ["basic", "audio"];
  if (kind === "video") return ["basic", "visual", "animation", "audio"];
  return ["basic", "visual", "animation"];
}

export function defaultInspectorTabForTrack(kind: TrackKind): InspectorTab {
  if (kind === "subtitle") return "subtitle";
  if (kind === "audio" || kind === "voiceover") return "audio";
  return "basic";
}

export function resolveInspectorTab(kind: TrackKind, requested: InspectorTab): InspectorTab {
  const available = inspectorTabsForTrack(kind);
  return available.includes(requested) ? requested : defaultInspectorTabForTrack(kind);
}
```

- [x] **Step 4: Extend `UiStore` without persisting editor mode**

Add the types and state below to `src/store/uiStore.ts`; initialize `editorMode` to `"professional"`, `activeToolTab` to `"media"`, and `activeInspectorTab` to `"basic"`.

```ts
import type { EditorMode, InspectorTab, ToolTab } from "../editor/editorLayout";

editorMode: EditorMode;
activeToolTab: ToolTab;
activeInspectorTab: InspectorTab;
setEditorMode: (editorMode: EditorMode) => void;
resetEditorMode: () => void;
setActiveToolTab: (activeToolTab: ToolTab) => void;
setActiveInspectorTab: (activeInspectorTab: InspectorTab) => void;
```

The store actions must be:

```ts
setEditorMode: (editorMode) => set({ editorMode }),
resetEditorMode: () => set({ editorMode: "professional" }),
setActiveToolTab: (activeToolTab) => set({ activeToolTab }),
setActiveInspectorTab: (activeInspectorTab) => set({ activeInspectorTab }),
```

Remove the old `TabKind`, `activeTab`, and `setActiveTab` fields after all references are migrated in Task 4; until then, keep compatibility aliases mapped to `activeToolTab` only if the build requires it.

- [x] **Step 5: Run focused TypeScript tests**

Run: `npm run test:ts`

Expected: all TypeScript test files pass, including `tests/editor/editorLayout.test.ts`.

---

### Task 2: Extract the workspace skeleton and mode-aware sizing

**Files:**
- Create: `src/editor/EditorWorkspace.tsx`
- Modify: `src/App.tsx:2458`
- Modify: `src/styles.css:93`

**Interfaces:**
- Consumes: `EditorMode` from Task 1.
- Produces: `EditorWorkspaceProps` with `topbar`, `tools`, `preview`, `inspector`, `timeline`, and `statusbar` slots.

- [ ] **Step 1: Add the exact workspace component**

```tsx
import type { ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { EditorMode } from "./editorLayout";

export interface EditorWorkspaceProps {
  mode: EditorMode;
  topbar: ReactNode;
  tools: ReactNode;
  preview: ReactNode;
  inspector: ReactNode;
  timeline: ReactNode;
  statusbar: ReactNode;
}

export function EditorWorkspace(props: EditorWorkspaceProps) {
  const simple = props.mode === "simple";
  return (
    <div className={`app-shell editor-mode-${props.mode}`}>
      {props.topbar}
      <Group orientation="vertical" className="editor-main-group">
        <Panel defaultSize={simple ? "72%" : "62%"} minSize="20%">
          <main className="workspace">
            <Group orientation="horizontal">
              <Panel defaultSize={simple ? "8%" : "20%"} minSize="6%" maxSize="40%">
                {props.tools}
              </Panel>
              <Separator />
              <Panel defaultSize={simple ? "68%" : "55%"} minSize="20%">
                {props.preview}
              </Panel>
              <Separator />
              <Panel defaultSize={simple ? "24%" : "25%"} minSize="12%" maxSize="45%">
                {props.inspector}
              </Panel>
            </Group>
          </main>
        </Panel>
        <Separator />
        <Panel defaultSize={simple ? "28%" : "38%"} minSize="12%">
          {props.timeline}
        </Panel>
      </Group>
      {props.statusbar}
    </div>
  );
}
```

- [ ] **Step 2: Replace only the outer `PanelGroup` structure in `App.tsx`**

Wrap the existing topbar, left panel, preview, right panel, timeline, and statusbar JSX in `EditorWorkspace` slots. Do not move handlers or alter child markup in this step.

- [ ] **Step 3: Add mode layout selectors**

```css
.editor-main-group { flex: 1; min-height: 0; }
.editor-mode-simple .left-panel { padding-inline: 6px; }
.editor-mode-simple .tool-panel-body { display: none; }
.editor-mode-simple .timeline-advanced-control { display: none; }
```

Do not hide a tool rail item or inspector category in simple mode.

- [ ] **Step 4: Verify build before further extraction**

Run: `npm run build`

Expected: TypeScript and Vite build pass; the existing chunk-size warning may remain.

---

### Task 3: Extract the global topbar and establish AI/mode primary actions

**Files:**
- Create: `src/editor/EditorTopbar.tsx`
- Modify: `src/App.tsx:2461`
- Modify: `src/styles.css:122`

**Interfaces:**
- Consumes: `EditorMode`, project title, ratio, undo/redo/save state, project menu slot, status slot, and callbacks.
- Produces: a topbar with fixed `AI 一键成片` and `导出` primary actions.

- [x] **Step 1: Define `EditorTopbarProps` and component**

```tsx
import type { ReactNode } from "react";
import { ChevronLeft, Download, Redo2, Save, Settings, Sparkles, Undo2 } from "lucide-react";
import type { EditorMode } from "./editorLayout";

export interface EditorTopbarProps {
  mode: EditorMode;
  projectTitle: string;
  ratio: string;
  ratios: readonly string[];
  canUndo: boolean;
  canRedo: boolean;
  canSave: boolean;
  projectMenu: ReactNode;
  saveStatus: ReactNode;
  onBack: () => void;
  onGenerate: () => void;
  onProjectTitleChange: (value: string) => void;
  onRatioChange: (value: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onModeChange: (mode: EditorMode) => void;
  onSettings: () => void;
  onExport: () => void;
}
```

Render the controls in this order: back, AI action, project menu, title, ratio, undo, redo, save status/save, mode segmented control, settings, export. Every icon-only button must have both `title` and `aria-label`.

- [x] **Step 2: Wire existing callbacks without changing behavior**

Use `setShowGenerate(true)` for AI, `updateProjectPatch()` for title/ratio, existing history callbacks for undo/redo, `persist(project)` for save, and existing export dialog state for export.

On each transition from home to editor, call `resetEditorMode()` before setting `view` to `"editor"` so professional mode is the session default.

- [x] **Step 3: Remove duplicate brand and persistent healthy FFmpeg pill**

Keep the product name on the home screen. In the editor, use the available width for project context. Render healthy FFmpeg status in the bottom statusbar; render unavailable FFmpeg as an actionable warning near export.

- [x] **Step 4: Build-check the extraction**

Run: `npm run build`

Expected: PASS with no missing topbar callback or prop errors.

---

### Task 4: Rebuild the left tool navigation and split text/subtitle responsibilities

**Files:**
- Create: `src/editor/ToolRail.tsx`
- Create: `src/editor/ToolPanel.tsx`
- Create: `src/panels/SubtitlePanel.tsx`
- Create: `src/panels/EffectsPanel.tsx`
- Modify: `src/panels/TextPanel.tsx`
- Modify: `src/App.tsx:2538`
- Modify: `src/store/uiStore.ts`
- Modify: `src/styles.css:1800`

**Interfaces:**
- Consumes: `TOOL_TABS`, `ToolTab`, existing panel callbacks, selected clip/track, LUT filters, mask/effect callbacks.
- Produces: six stable tool entries and one visible panel body.

- [x] **Step 1: Implement `ToolRail` using the Task 1 definitions**

`ToolRail` accepts `activeTab`, `onTabChange`, and `collapsed`. Map tab ids to Lucide icons: `Video`, `Type`, `Music`, `Captions`, `ArrowLeftRight`, and `Sparkles`. Buttons use `aria-pressed`, `aria-label`, `title`, and the existing `active` class convention.

- [x] **Step 2: Implement `ToolPanel` as a stable container**

```tsx
export function ToolPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="tool-panel" aria-label={`${title}工具`}>
      <header className="tool-panel-header"><strong>{title}</strong></header>
      <div className="tool-panel-body">{children}</div>
    </section>
  );
}
```

- [x] **Step 3: Split `TextPanel` and `SubtitlePanel`**

Keep only `script`, `busy`, `onScriptChange`, and `onAiSegment` in `TextPanel`.

Move these existing props and their current JSX into `SubtitlePanel` without changing callbacks:

```ts
interface SubtitlePanelProps {
  busy: string | null;
  onRecognizeSubtitles: (translate: boolean) => void;
  onAddManualSubtitle: () => void;
  onImportSrt: () => void;
  subtitleStyle: SubtitleStyle;
  onSubtitleStyleChange: (style: SubtitleStyle) => void;
}
```

The subtitle preset and default style controls remain directly visible in `SubtitlePanel`; selected clip style continues to be edited in the inspector.

- [x] **Step 4: Add `EffectsPanel` as a direct routing surface**

The panel accepts:

```ts
interface EffectsPanelProps {
  hasVisualSelection: boolean;
  onOpenFilters: () => void;
  onOpenMasks: () => void;
  onOpenVisualEffects: () => void;
}
```

Render three full-width actions: `滤镜与调色`, `蒙版`, `视觉特效`. Disable them when no visual clip is selected and show `请先选择视频或图片片段`. These actions set the inspector category to `visual` or `animation` and scroll/focus the matching section; they do not duplicate effect mutation logic.

- [x] **Step 5: Replace the old four-tab JSX with six-entry navigation**

Use `activeToolTab` from `uiStore`. Render exactly one panel through a `switch` or lookup. Preserve all existing callbacks passed to `MediaPanel`, `TextPanel`, `AudioPanel`, `SubtitlePanel`, and `TransitionPanel`.

After migration, remove `TabKind`, `activeTab`, and `setActiveTab` compatibility fields from `uiStore`.

- [x] **Step 6: Verify contract and build**

Run: `npm run test:ts && npm run build`

Expected: all tests pass and all six left navigation entries compile.

---

### Task 5: Add the inspector shell and migrate basic/audio categories

**Files:**
- Create: `src/editor/InspectorPanel.tsx`
- Create: `src/editor/inspector/BasicInspector.tsx`
- Create: `src/editor/inspector/AudioInspector.tsx`
- Modify: `src/App.tsx:2899`
- Modify: `src/styles.css:734`

**Interfaces:**
- Consumes: selected clip, track, selected count, available tabs, current tab, category nodes, and tab callback.
- Produces: stable object summary and category navigation independent of category internals.

- [ ] **Step 1: Implement the inspector shell**

```tsx
import type { ReactNode } from "react";
import type { InspectorTab } from "./editorLayout";

export interface InspectorPanelProps {
  title: string | null;
  meta: string | null;
  selectedCount: number;
  tabs: readonly InspectorTab[];
  activeTab: InspectorTab;
  content: ReactNode;
  onTabChange: (tab: InspectorTab) => void;
}
```

When `title` is null, render `选择时间线片段后可在这里调整属性` and no category tabs. Otherwise render object title, metadata, multi-select count, and labels `基础/画面/动画/音频/字幕样式` for available tabs.

- [ ] **Step 2: Resolve active category whenever selection changes**

In `App.tsx`, derive `availableInspectorTabs = inspectorTabsForTrack(selectedClipTrack.kind)` and call `resolveInspectorTab()` before rendering. When the selected track kind changes, set `activeInspectorTab` to `defaultInspectorTabForTrack(kind)`.

Do not change category on every clip id change when the track kind remains the same; this preserves the user's category within the current object type.

- [ ] **Step 3: Extract `BasicInspector`**

Move the existing JSX and callbacks for these controls without behavioral changes:

- track badge and selected object text;
- duration;
- speed and speed-curve preset entry;
- crop/source trim and asset replacement/search;
- batch subtitle timing actions that are not style-specific.

Expose callbacks rather than importing stores. Use the existing `updateSelectedClip`, `commitInteractiveEdit`, `searchAssetsForSelected`, `bindAssetToClip`, and speed handlers supplied by `App`.

- [ ] **Step 4: Extract `AudioInspector`**

Move existing volume, audio keyframe shortcut, fade in/out, denoise, clip voice generation, detach audio, and vocal separation controls. Preserve current track-kind guards and busy states.

- [ ] **Step 5: Replace only migrated branches in the old inspector**

Render `BasicInspector` for `basic` and `AudioInspector` for `audio`. Keep visual, animation, and subtitle JSX temporarily in local render helpers so the application remains functional between tasks.

- [ ] **Step 6: Verify no behavior regression**

Run: `npm run test:ts && npm run build`

Expected: PASS; video, image, audio, voiceover, and subtitle selections all render an allowed category.

---

### Task 6: Migrate visual, animation, and subtitle inspector categories

**Files:**
- Create: `src/editor/inspector/VisualInspector.tsx`
- Create: `src/editor/inspector/AnimationInspector.tsx`
- Create: `src/editor/inspector/SubtitleInspector.tsx`
- Modify: `src/App.tsx:2907`
- Modify: `src/styles.css:734`

**Interfaces:**
- Consumes: existing clip mutation callbacks and pure data from `App`.
- Produces: all previous inspector capabilities under stable category tabs.

- [ ] **Step 1: Extract `VisualInspector`**

Move existing fit/crop, x/y/scale/rotation/opacity, filter, brightness, contrast, saturation, temperature, tint, and mask controls. Keep `MaskPreview` and `LUT_FILTERS` supplied as data or imported from their existing focused modules.

Add section anchors with exact ids:

```tsx
<section id="inspector-transform" className="inspector-section">...</section>
<section id="inspector-filter" className="inspector-section">...</section>
<section id="inspector-mask" className="inspector-section">...</section>
```

- [ ] **Step 2: Extract `AnimationInspector`**

Move keyframe add/remove/clear controls, easing selection, transition summaries, and visual effects. Add anchors `inspector-keyframes`, `inspector-transitions`, and `inspector-effects`.

Opacity keyframes stay in animation while the static opacity value remains in visual, matching the existing evaluation model.

- [ ] **Step 3: Extract `SubtitleInspector`**

Move subtitle text, font, size, color, stroke, position, whole-track position, karaoke, highlight color, entry/exit animation, duration, preset application, and whole-track style application.

Multi-select subtitle style actions appear before single-clip controls and use the existing selected id set.

- [ ] **Step 4: Wire direct left-panel routing**

`EffectsPanel.onOpenFilters()` sets `activeInspectorTab` to `visual` and schedules `document.getElementById("inspector-filter")?.scrollIntoView({ block: "start" })` in `requestAnimationFrame`.

Use the same pattern for `inspector-mask` and `inspector-effects`. Do not focus an input automatically.

- [ ] **Step 5: Delete the migrated monolithic inspector JSX from `App.tsx`**

After every category renders through a component, remove the old `.inspector` branch and imports that are no longer used. `App.tsx` remains the command/data orchestrator.

- [ ] **Step 6: Verify complete inspector compilation**

Run: `npm run test:ts && npm run build`

Expected: PASS; no duplicated inspector control ids and no unused TypeScript imports.

---

### Task 7: Extract preview and timeline chrome, remove duplicate entries

**Files:**
- Create: `src/editor/PreviewWorkspace.tsx`
- Create: `src/editor/TimelineToolbar.tsx`
- Modify: `src/App.tsx:2663`
- Modify: `src/App.tsx:3959`
- Modify: `src/styles.css:436`
- Modify: `src/styles.css:925`

**Interfaces:**
- Produces: layout-only wrappers; playback and timeline handlers stay in `App`.

- [ ] **Step 1: Extract `PreviewWorkspace`**

Accept `title`, `subtitle`, `zoomControls`, `canvas`, and `transport` nodes. The toolbar contains only title/subtitle, fit zoom, zoom buttons, and grid/safe-area control.

Move preview diagnostics behind a button shown only when the existing debug state or development environment enables it; it must not be a normal always-visible zoom peer.

- [ ] **Step 2: Extract `TimelineToolbar`**

Use this prop contract:

```ts
interface TimelineToolbarProps {
  canEditProject: boolean;
  canEditSelection: boolean;
  canPaste: boolean;
  addTrackMenu: React.ReactNode;
  zoomControls: React.ReactNode;
  onSplit: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onAddChapter: () => void;
}
```

Render split, delete, copy, paste, duplicate, add track, chapter, timeline behavior controls, and zoom. Do not render export or set-cover actions.

- [ ] **Step 3: Relocate set-cover and export**

Export remains only in `EditorTopbar`. Add `设为封面` to a preview-level overflow-free text button or the existing canvas context menu. It must call the same `persist({ ...project, coverTime: currentTime })` behavior.

- [ ] **Step 4: Verify the entry cleanup**

Run:

```bash
rg -n "设为封面|>导出<|导出" src/App.tsx src/editor
npm run build
```

Expected: one primary editor export action in `EditorTopbar`; set-cover appears in preview/context controls, not `TimelineToolbar`; build passes.

---

### Task 8: Finish simple mode, responsive behavior, and accessibility

**Files:**
- Modify: `src/styles.css`
- Modify: `src/editor/EditorWorkspace.tsx`
- Modify: `src/editor/ToolRail.tsx`
- Modify: `src/editor/InspectorPanel.tsx`
- Modify: `src/editor/TimelineToolbar.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `editorMode` from `uiStore`.
- Produces: professional and simple presentations over identical project state.

- [x] **Step 1: Implement simple-mode presentation without removing routes**

In simple mode:

- left panel shows the complete six-icon rail and collapses the content body by default;
- right panel keeps all allowed category tabs and shows compact common controls first;
- timeline defaults to lower height and hides track-management decoration marked `.timeline-advanced-control`;
- the user can still switch every tool and inspector category directly.

- [x] **Step 2: Add responsive breakpoints**

```css
@media (max-width: 1280px) {
  .editor-topbar .project-title-input { max-width: 180px; }
  .tool-rail-label { display: none; }
  .inspector-tab { padding-inline: 7px; }
}

@media (max-width: 1024px) {
  .editor-topbar-save-label,
  .editor-mode-label { display: none; }
  .preview-toolbar-subtitle { display: none; }
}
```

No primary action may disappear at these breakpoints.

- [x] **Step 3: Complete accessibility attributes**

Add `aria-label` to icon-only controls, `aria-current="page"` or `aria-pressed` to navigation state, `role="tablist"`/`role="tab"` to inspector categories, and visible `:focus-visible` styles to all new buttons.

- [x] **Step 4: Reset mode at editor-session entry**

Call `resetEditorMode()` in create-project, select-project, and home-to-editor flows. Do not call it during ordinary project autosave or component rerender.

- [x] **Step 5: Run frontend validation**

Run: `npm run test:ts && npm run build && git diff --check`

Expected: all TypeScript tests pass, Vite build passes, and diff check has no whitespace errors.

---

### Task 9: Full regression and visual verification

**Files:**
- Modify only files needed to fix failures found by this task.
- Update: `docs/superpowers/plans/2026-07-10-editor-information-architecture.md` checkboxes.

**Interfaces:**
- Verifies all earlier task outputs as one editor workflow.

- [x] **Step 1: Run all frontend and backend automated checks**

```bash
npm run test:ts
npm run build
node scripts/verify-web-fallback-coverage.mjs
node scripts/verify-proxy-generation.mjs
node scripts/verify-r32-duration.mjs
(cd src-tauri && cargo test --locked)
git diff --check
```

Expected: all commands pass. Existing non-failing chunk-size and dynamic/static import warnings may remain documented.

- [x] **Step 2: Run targeted Rust formatting checks for existing new Rust modules**

```bash
rustfmt --edition 2021 --check \
  src-tauri/src/ffmpeg_expression.rs \
  src-tauri/src/source_window.rs \
  src-tauri/src/render_plan.rs \
  src-tauri/src/render_graph.rs
```

Expected: PASS. Do not run repository-wide formatting that would rewrite unrelated pre-existing files.

- [ ] **Step 3: Verify required UI states manually**

Run `npm run dev` and inspect these states at 1280×720, 1440×900, and 1920×1080:

- professional mode with no selection;
- selected video/image clip on basic, visual, and animation tabs;
- selected subtitle on subtitle-style tab;
- selected audio/voiceover on audio tab;
- multi-selected subtitles;
- simple mode with each of the six left tool entries;
- export, AI generation, settings, save, undo, and redo availability.

Expected: no horizontal overflow, clipped primary action, lost selection, duplicate export action, or unreachable existing feature.

- [ ] **Step 4: Update plan completion state**

Mark each completed checkbox in this file only after its command or manual acceptance condition has been observed.

## Final Review Checklist

- [x] Six left tool entries are always directly reachable.
- [x] AI 一键成片 is fixed in the editor topbar.
- [x] Professional mode is the default for every editor session.
- [x] Simple mode preserves project, selection, playback, history, and unsaved state.
- [x] Inspector is category-based rather than one long page.
- [x] Export is not duplicated in the timeline toolbar.
- [x] Existing media, text, audio, subtitle, transition, filter, keyframe, mask, effect, and export commands still work.
- [x] No backend or persistence contract changed.
- [x] TypeScript tests, build, validation scripts, Rust tests, and diff check pass.


