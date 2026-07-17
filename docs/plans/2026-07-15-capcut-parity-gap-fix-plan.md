# 对标剪映功能差距修复方案

> 本方案基于直接阅读当前源码得出的差距核查结论设计，未参考仓库内已有的 `FRONTEND_CAPABILITY_MATRIX.md` / `IMPROVEMENT_ROADMAP.md` 等文档。方案按依赖关系和改造成本分为 P0~P3 四个阶段，阶段内模块相对独立可拆开排期。

## 差距核查结论（现状）

### 时间线交互
- 跨轨道拖拽不支持：`clipInteraction.ts` 的 `computeDraggedClip` 只在单轨坐标系内计算，`startOnTrack` 会改但 `trackId` 从未被写入。
- 分割只处理视觉轨：`clipOperations.ts` 的 `splitVisualClipAtPlayhead` 硬编码 `visualTrackIds` 只含 video/image，音频/字幕轨无法在播放头统一分割。
- 轨道高度不可调、不可折叠；轨道重排序只能上移/下移不能拖拽。
- 吸附计算存在（`clipInteraction.ts` 的 `snap()`）但完全没有可视化吸附线。
- 关键帧在时间线上只能点击跳转（`TimelineTrack.tsx` 的 `keyframeMarkers` onPointerDown 只调 `onKeyframeClick`），不能拖拽调整。
- 素材替换只有"AI 重新搜索匹配"，没有手动选文件替换的入口。
- 无组合/嵌套片段能力；无通用 marker（只有项目级章节标记，且不参与吸附）。
- 播放头移出可视区时间线不会自动滚动。

### 视觉特效/调色/蒙版/关键帧
- LUT 仅 9 个内置，无分类无缩略图，且不支持自定义导入。
- 调色无 before/after 对比开关。
- 特效库只有 7 种基础 CSS 效果，没有剪映式画面特效/人物特效分类预设库。
- 蒙版编辑只能靠面板滑杆调（`VisualTransformInspector.tsx`），预览画面上不能直接拖蒙版手柄，`MaskPreview.tsx` 只是静态 80x45 SVG 缩略图。
- 关键帧缓动仅 4 种预置（`keyframes.ts` 的 `applyEasing` 硬编码二次函数），无贝塞尔曲线自定义。
- 变速曲线编辑器（`SpeedCurveEditor.tsx`）是项目里做得最完整的模块，可作为其他可视化编辑器的实现参考。
- 转场 18 种够用但无真实缩略图预览。
- 抠像/绿幕完全缺失。
- 预览区拖拽生成关键帧缺失：只有字幕层用 `react-moveable`（`SubtitleOverlay.tsx`）支持拖拽，视频/图片层没有等价交互。

### 字幕与文字系统
- 有逐字时间戳数据但没有逐字文本编辑 UI，只能整条改文案；预览区不能直接拖字幕块调入出点。
- 字幕背景框导出会退化成方形丢圆角，`styleContract.ts` 的 `subtitleExportWarnings` 已自证预览/导出不一致。
- 全局字幕动画预设 8 种入场，但单条 Inspector 只暴露 4 种，两处能力不一致。
- **花字/文字模板库缺失**：只有 8 个"字幕预设"，本质是颜色字体组合，没有剪映式带装饰边框/贴图的花字库。
- **独立文本图层缺失**：`TrackKind` 没有 "text" 类型，所有文字必须挂在字幕轨下，`handleAddManualSubtitle` 强制要求先有字幕轨，无法自由添加/定位纯文字贴图。
- 贴纸/表情库完全缺失。
- 用户不能把自定义样式保存成模板复用。

### 音频与素材管理
- 音频波形后端一次性解码整段音频进内存算峰值，无分片/缓存/进度提示，大文件会阻塞。
- 音量关键帧类型已定义（`ClipKeyframes.volume`）但 `AudioInspector.tsx` 没有接入 UI，淡入淡出只是数字输入框，没有可视化拖拽手柄。
- 变声/音效完全缺失。
- **降噪是伪功能**：前端有滑杆，但后端只是导出时套用通用 ffmpeg `afftdn` 滤镜，不是真正的 AI 人声分离，预览时不生效——这类"承诺了做不到的事"的功能需要优先修正或明确降级提示。
- AI 配音没有语速调整 UI，只支持 Fish Audio 单一供应商。
- 背景音乐库完全缺失，只能自己导入音频文件。
- 素材库（`MediaLibrary.tsx`）只有网格+搜索，无分类/标签/收藏/最近使用。
- Pexels 搜索 `per_page` 硬编码 clamp 到 1-12，前端没有分页/加载更多。
- 撤销/重做栈实现标准但无历史记录可视化 UI。

### 导出与预览
- 导出进度是硬编码阶段百分比，不是真实帧级进度，无剩余时间预估。
- 预览区完全没有全屏预览/安全区/网格线/参考线。
- 批量/多比例导出完全缺失，一次只能导一个分辨率。
- Scrubbing 拖动预览性能和音画同步已经做得扎实，不需要改动。

---

## P0：结构性改造

### P0-1 独立文本图层（差距最大项，是 P2-1/P2-2 的前置依赖）

**数据结构改动（`src/types.ts:98`）**
```ts
export type TrackKind = "video" | "image" | "voiceover" | "audio" | "subtitle" | "text";
```
`Clip` 不新增字段，复用现有 `text` + `subtitleStyle`（文本图层是"不挂 ASR、可自由创建的字幕 clip"，没有 `words`、没有 `subtitleGroupId`），最大化复用现有渲染管线（`SubtitleOverlay.tsx`、`ffmpeg.rs` 的 ASS 生成）。

**状态：已实施完成（2026-07-15）**

**改动清单**
1. `src/types.ts`：`TrackKind` 加 `"text"`；新增 `DEFAULT_TEXT_LAYER_STYLE`（基于 `DEFAULT_SUBTITLE_STYLE`，字号 64、居中、关闭逐字高亮）。
2. `src/App.tsx`
   - **不要**把 `text` 塞进 `isVisualTrackKind()`：该函数同时驱动素材绑定信息、AI 画面关键词搜索、分离音频/人声、`VisualTransformInspector`/`VisualEffectsInspector`/`KeyframeInspector` 等一整套"绑定了媒体素材"的 UI，文本图层没有 `sourceId`、走 `subtitleStyle` 定位，不该有这些能力。改为单独扩展 `isSelectedSubtitle`（3294 行）判断为 `track.kind === "subtitle" || track.kind === "text"`，让文本图层复用字幕的编辑态/`SubtitleOverlay` 拖拽路径。
   - 新增 `handleAddTextLayer()`：没有 `text` 轨时自动创建；新 clip `startOnTrack` 取播放头当前时间；默认样式用 `DEFAULT_TEXT_LAYER_STYLE`。同时修正了 `handleAddManualSubtitle()` 强制要求先建字幕轨的问题，改为自动创建字幕轨。
   - Inspector 分支（3551 行）`selectedClipTrack.kind === "subtitle"` 扩展为 `|| kind === "text"`，复用 `SubtitleInspector`。
   - `TextPanel` 新增"新建文本图层"入口按钮；添加轨道下拉菜单新增"文字轨"选项。
3. `src/editor/editorLayout.ts`：`inspectorTabsForTrack`、`inspectorTabsForSelection`、`defaultInspectorTabForTrack` 补 `text` → 同 `subtitle` 处理。
4. `src/preview/SubtitleOverlay.tsx`：无需改动，天然兼容（`karaokeEnabled` 判断已是 `words?.length ?? 0 > 0`）。
5. `src/timeline/ContextMenu.tsx`：`isSubtitle` 判断扩展为 `trackKind === "subtitle" || trackKind === "text"`，复用"编辑文字"菜单项。
6. `src/timeline/TimelineTrack.tsx`：`isAssetAcceptable` 对未识别的轨道类型本就返回 `false`，`text` 轨天然排斥素材拖入，无需额外分支；轨道图标补充 `Type` 图标；"统一调整本轨字幕样式"按钮扩展为对 `text` 轨也生效。
7. `src/editor/timelineActions.ts`：`TRACK_KIND_LABELS` 补 `text: "文字"`。
8. `src/styles.css`：新增 `.clip.text` 样式（紫色系），与字幕轨（蓝）区分。
9. **关键发现（原方案未预料到的联动点）**：`src/renderGraph/evaluateFrame.ts` 的 `subtitleLayers` filter 硬编码 `layer.trackKind === "subtitle"`，是播放态字幕渲染的唯一数据源（经 `projectFrameToEngineState.ts` → `playbackStore.activeSubtitleClips` → `App.tsx` 的 `StageSubtitleLayer`），与编辑选中态的 `isSelectedSubtitle` 是两条独立路径。必须同时扩展为 `|| layer.trackKind === "text"`，否则文本图层只有选中编辑时可见，播放时不显示。已修复并补充测试（`tests/renderGraph/evaluateFrameTextLayer.test.ts`）。
10. `src-tauri/src/models.rs`：`TrackKind` enum 加 `Text` 变体。Rust 的 exhaustive match 在 `ffmpeg.rs:140` 的 `collect_mix_audio_clips` 处立即报编译错误，验证了这是发现所有需处理分支的可靠机制——修复为 `TrackKind::Image | TrackKind::Subtitle | TrackKind::Text => return false`（文字层无音频）。
11. `src-tauri/src/ffmpeg.rs`：ASS 字幕生成严格按 `TrackKind::Subtitle` 过滤（非按"是否有 subtitleStyle"过滤），**结论确认为需要修改**（推翻此前"可能不需要改"的猜测）。两处过滤（收集字幕轨 clip 的 `subtitle_track_ids`、`generate_ass_subtitles` 里的 layer 排序）均扩展为 `t.kind == TrackKind::Subtitle || t.kind == TrackKind::Text`。
12. `src-tauri/src/commands.rs`：`add_track` 命令的 `kind` 字符串匹配新增 `"text" => TrackKind::Text`。其余 `TrackKind::Subtitle` 引用（ASR 自动建轨查找逻辑，1095/1102/1251/1592/1600 行附近）均为字幕识别专用轨查找，与手动创建的文本图层无关，未改动。

**验证**：`npx tsc --noEmit` 无错；`npm run test:ts` 29/29 通过（新增 1 个）；`npm run build` 成功；`cargo check`/`cargo test` 54/54 通过。

**提示**：引入新 union 成员后，TypeScript 的穷尽检查（若已用）会在所有遗漏分支报错，可借此定位所有需要改动的点。

### P0-2 预览区可视化直接操纵（视频/图片层）

技术风险最高的一项，建议先做"仅位置拖拽"的最小验证版本，再逐步补全缩放/旋转/蒙版。

**新增文件 `src/preview/VisualLayerOverlay.tsx`**，结构参考 `SubtitleOverlay.tsx`，核心区别：
- `SubtitleOverlay` 的 target 是组件自己渲染的 `<div ref={textRef}>`；视频/图片层的 DOM 元素是 `PreviewEngine.ts`（367-378、525-539 行）通过 `MediaElementPool` 动态创建、直接改 `el.style` 的原生元素，不受 React 管理。
- 需要 `PreviewEngine.ts` 新增回调（如 `onActiveElementChange?: (clipId: string, el: HTMLElement | null) => void`），把当前选中 clip 对应的 DOM 元素传给 React 层；`App.tsx` 用 state 存这个引用传给 `VisualLayerOverlay`。
- `Moveable` 的 `target` 支持传入普通 DOM 元素，但 `onDrag`/`onScale`/`onRotate` 回调不能直接改 `el.style`（会被 `PreviewEngine` 渲染循环覆盖），必须只更新 store（`onTransformChange({ x, y }, false)`），让 `PreviewEngine` 按新的 `clip.transform` 重新计算样式。
- 蒙版手柄拆成独立子组件 `MaskHandleOverlay`，与 transform 的 moveable 实例分层叠加。

**改动点**：`App.tsx` viewport 渲染区（3244-3376 行）在 `overlayContainerRef` 之后新增渲染位置，仅 `selectedClipTrack.kind === "video" || "image"` 时渲染。`VisualTransformInspector.tsx` 滑杆保留作为精确数值输入的备选（剪映也是两者并存）。

### P0-3 跨轨道拖拽

当前 `DragState`（`clipInteraction.ts:7-22`）和拖拽事件监听都绑在单个 `TimelineTrack` 组件实例上，天然做不到跨轨。

**改造**：把拖拽状态提升到父级（父容器统一管理，而非各轨道自管）。
1. `DragState` 新增 `sourceTrackId`、`currentTrackId`。
2. `pointermove` 监听要挂在所有轨道的父容器上，新增 `computeTrackAtY(clientY, trackLayout): string | null`，按各轨道高度累积计算当前鼠标所在轨道。
3. 跨轨时复用 `isAssetAcceptable` 同类逻辑做兼容性校验，不兼容则视觉标红/禁止，松手不生效。
4. `onClipDrag` 的 `patch: Partial<Clip>` 需要能表达 `trackId` 变化。
5. `App.tsx` 接收端（`updateSelectedClip` 或批量版本）处理 `trackId` patch。

建议与吸附可视化线（P0-4）合并实现，因为两者都需要"状态提升到父级容器"这一前置改造。

### P0-4 吸附可视化提示线

`clipInteraction.ts` 的 `snap()`（46-52 行）目前只返回吸附后的数值，不返回是否吸附、吸附到哪个点。

```ts
function snap(value: number, snapPoints: number[], pxPerSecond = 64): { value: number; snappedTo: number | null } {
  const thresholdSec = SNAP_THRESHOLD_PX / pxPerSecond;
  for (const sp of snapPoints) {
    if (Math.abs(value - sp) < thresholdSec) return { value: sp, snappedTo: sp };
  }
  return { value, snappedTo: null };
}
```
`computeDraggedClip` 返回值扩展 `snapLine?: number`，`TimelineTrack.tsx` 的 `moveDrag`（97-113 行）拿到后 setState 一个 `activeSnapLine`，渲染跨越所有轨道高度的竖线（新增 CSS class `.timeline-snap-line`）。需要渲染在轨道容器层级而非单轨道内才能跨轨可见。

---

## P1：铺开可视化操纵能力（依赖 P0-2）

### P1-1 蒙版预览区拖拽手柄
`MaskHandleOverlay` 子组件：
- 矩形/圆形蒙版：`Moveable` target 指向按 `mask.cx/cy/width/height`（`types.ts:233-245`）动态定位的透明 div，`renderDirections` 只开四角四边，`onDrag`/`onScale`/`onRotate` 映射到 `cx/cy`/`width/height`/`rotation`。
- 线性/镜面蒙版：自实现单点拖拽 handle（一维参数，不适合用 Moveable 的多向手柄）。
- 羽化保留在 `VisualTransformInspector.tsx` 滑杆（剪映本身羽化也是滑杆，非拖拽手柄）。
- 预览区手柄和面板滑杆共享同一个 `onMaskChange` 回调，自动保持同步。

### P1-2 关键帧曲线编辑器（贝塞尔缓动）

**`src/types.ts:207-212` 改动**
```ts
export type Keyframe = {
  time: number;
  value: number;
  easing: "linear" | "easeIn" | "easeOut" | "easeInOut" | "bezier";
  /** easing === "bezier" 时的三次贝塞尔控制点 [x1,y1,x2,y2]，参考 CSS cubic-bezier */
  bezierPoints?: [number, number, number, number];
};
```

**`src/editor/keyframes.ts` 改动**：`applyEasing`（12-24 行）新增 `case "bezier"`，用牛顿迭代反解 t 再算 y（8 次迭代足够精度）；`updateKeyframeEasing`（115-124 行）签名扩展 `bezierPoints` 可选参数。

**新增 `src/components/KeyframeCurveEditor.tsx`**：直接复用 `SpeedCurveEditor.tsx` 的 SVG 拖拽手势代码模式（项目里最成熟的交互实现）。画出属性随时间的曲线，每个 keyframe 是可拖拽点（拖动改 time/value），选中点若 `easing === "bezier"` 额外渲染两个控制手柄。`KeyframeInspector.tsx` 的 easing 下拉加"自定义曲线"选项。

### P1-3 时间线上直接拖拽关键帧点

`TimelineTrack.tsx` 的 `keyframeMarkers` 渲染（353-365 行）现在 `onPointerDown` 只调 `onKeyframeClick`。新增：
```ts
type KeyframeDragState = {
  clipId: string;
  prop: keyof ClipKeyframes;
  kfIndex: number;
  startX: number;
  initialTime: number;
};
```
区分点击（无位移，走 `onKeyframeClick`）和拖拽（超过防误触阈值，走新的 `onKeyframeDrag`，复用 `hasExceededPointerDragThreshold`）。`keyframes.ts` 新增 `moveKeyframe(keyframes, prop, kfIndex, newTime)`，更新后保持数组按 time 排序。

---

## P2：内容库类功能（不改架构，可与 P0/P1 并行，除 P2-1 依赖 P0-1）

### P2-1 花字/文字模板库
新增 `src/editor/textTemplates.ts`（参考 `subtitlePresets.ts` 但加装饰层）：
```ts
export type TextTemplate = {
  id: string;
  name: string;
  category: "标题" | "花字" | "综艺" | "简约";
  thumbnailUrl: string;
  style: Partial<SubtitleStyle>;
  decoration?: { backgroundImage?: string; borderImage?: string };
};
```
`SubtitleStyle`（`types.ts:122-163`）新增可选 `decorationId?: string | null`。`SubtitleOverlay.tsx` 渲染时若存在 `decorationId`，在文字 div 外包一层带背景图容器。导出侧 ASS 格式做不到任意图案背景，需在 `styleContract.ts` 的 `subtitleExportWarnings` 新增警告"花字装饰仅预览生效，导出时降级为纯文字样式"——诚实暴露技术限制，避免重蹈降噪伪功能的问题。UI：新增 `src/panels/TextTemplatePanel.tsx`，依赖 P0-1 先落地。

### P2-2 贴纸库
建议复用 `image` 轨而不新增 `TrackKind`：贴纸是预置透明背景 PNG/动图，加 `MediaSource.source` 值 `"sticker"` 区分来源即可。新增 `src/library/StickerLibrary.tsx`，静态资源打包进 `public/stickers/`，点击复用现有"添加图片素材到 image 轨"逻辑。

### P2-3 素材库分类/标签/收藏/最近使用
`types.ts` 的 `MediaSource`（100-120 行）新增：
```ts
tags?: string[];
favorite?: boolean;
lastUsedAt?: string | null;
```
`MediaLibrary.tsx` 新增筛选栏（全部/视频/图片/音频/收藏/最近使用），卡片加收藏星标（需要 `projectStore.ts` 新增 `updateMediaSource` 方法）。`lastUsedAt` 在素材拖入时间线时更新（`TimelineTrack.tsx` 的 `handleDrop`，211 行附近）。

### P2-4 背景音乐库
建议先做本地曲库（成本低）：`public/bgm/` 打包若干 CC0 音乐 + `bgm-manifest.json`（曲名/时长/分类/BPM）。新增 `src/panels/MusicLibraryPanel.tsx`，试听交互参考 `AudioPanel.tsx` 已有的音色试听模式。在线曲库需先确认版权可用的 API（如 Freesound、Jamendo），待明确需求后再评估接入。

### P2-5 Pexels 分页
`src-tauri/src/pexels.rs`：`per_page` 硬编码 clamp（51、183 行）放开上限（Pexels 支持到 80），搜索函数增加 `page: u32` 参数，`PexelsSearchResult` 增加 `total_results`/`has_more` 字段。`src/panels/MediaPanel.tsx` 结果列表下方加"加载更多"，拼接而非覆盖结果数组。

---

## P3：高投入或独立性强的项

### P3-1 抠像/绿幕
`src/preview/WebGLCompositor.ts` 新增 chroma key shader pass（目标色+相似度阈值+平滑度，作为新的 `ClipVisualEffect.kind: "chromakey"`，`ClipVisualEffect` 加 `chromaKeyColor?: string`）。`ffmpeg.rs` 导出侧对应加 `colorkey=color:similarity:blend` filter（参照现有 vignette/glow 特效的 filter 链拼接模式）。建议单独立项评估 WebGL 实现成本。

### P3-2 变声/音效预设
`src-tauri/src/voice_effect.rs`（新文件）用 FFmpeg `asetrate`+`atempo` 组合实现变调不变速，或先做固定预设（升调/降调/`vibrato`/`tremolo`）。`Clip` 新增 `voiceEffect?: string | null`。**预览侧变调需要 Web Audio `AudioWorklet` 做实时处理，成本较高**，折中方案是预览不变声、仅导出生效，并在 UI 明确提示"效果仅导出后生效"（避免重复降噪功能的"预览听到的不是最终效果"误导问题）。

### P3-3 真实导出进度 + 剩余时间预估
`ffmpeg.rs` 渲染命令加 `-progress pipe:1`，异步解析 stdout 的 `out_time_ms=` 字段算真实百分比（`out_time_ms / total_duration_ms`），通过现有 `render-progress` 事件上报。剩余时间用 `(总时长-已完成)/已完成*已耗时` 滑动平均估算。

### P3-4 批量/多比例导出
`RenderConfig`（`types.ts:340-362`）目前单一配置。`ExportDialog.tsx` 支持勾选多组配置（如同时 9:16+16:9），`ffmpeg.rs` 渲染函数循环调用多次各自产出文件。优先级低于其他项。

### P3-5 预览区安全区/网格线/参考线
纯 CSS 叠加，不涉及数据模型。`uiStore.ts` 新增 `showSafeArea`/`showGrid` 状态，`PreviewWorkspace.tsx`（3-19 行）viewport 内叠加 `<div className="stage-safe-area-overlay">`，CSS `outline` 画安全区框线，网格用 `repeating-linear-gradient`。工具栏加两个 toggle 按钮。成本很低，可插空做，不依赖其他模块。

---

## 排期建议

1. P0-1 独立文本图层（架构缺口，解锁 P2-1/P2-2）
2. P0-4 吸附可视化线 + P3-5 安全区/网格线（成本低、体验提升明显，可先做）
3. P0-3 跨轨道拖拽（时间线基本操作缺失，用户会直接感知）
4. P0-2 预览区可视化操纵（技术风险最高，单独排期，先做最小验证版本）
5. P1 系列（依赖 P0-2）
6. P2 系列（除 P2-1 依赖 P0-1，其余可与 P0/P1 并行）
7. P3 系列（视资源情况酌情安排，抠像和变声属于加分项）
