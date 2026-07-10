# SceneForge 第二轮验收报告与修复计划

> 本文档面向执行开发的 AI 模型。这是对第一轮修复（IMPROVEMENT_ROADMAP.md）的**严苛验收结果** + 第二轮修复任务。
> 验收结论：**部分任务真修复，大量任务是表面修复，且引入了 15+ 个新 bug，其中 4 个是"用了就坏"级别。**
> 执行规则与第一轮相同：一次一个任务、过 `npm run build` + `cargo check`、通过验收标准才算完成、禁止越界改动。

---

## 1. 第一轮验收总结论

### 1.1 真修复（验证通过，无需返工）

| 任务 | 内容 |
|---|---|
| T1.2 | ContextMenu 编辑文字（已实现内联编辑） |
| T1.7 | trim × speed（两分支均正确，含源时长 clamp） |
| T1.8/T1.9 | 滤镜按播放 clip 渲染 + FilterRenderer 内部 rAF 分离 |
| T2.3 | persist 防抖 + structuredClone + 移除 refreshProjects |
| T2.4 | 键盘监听 `[]` 依赖 + kbStateRef |
| T3.3 | 渲染互斥 + 取消 + 段级进度（粒度粗，见 R3.4） |
| T1.7(后端) | 圆角 geq 表达式 |
| M1/M3/M4/M5/M11/M14/M15/M16/M18/M19/M21 | 各次要项 |

### 1.2 表面修复 / 部分修复（机制存在但目标未达成，需返工）

| 任务 | 实际状态 |
|---|---|
| **T2.1/T2.2 性能解耦** | **名不副实**。zustand store 建了，但 `App.tsx:306` 顶层订阅 `currentTime` → 3436 行的 App 仍 60fps 全树重渲染；App.tsx **一个 useCallback 都没有**，TimelineTrack 的 memo 因内联回调+每次新建的 clips 数组完全失效 |
| T1.1/T1.3 | snapshot 机制正确，但字幕拖拽/缩放/逐键编辑三处**绕过机制**，每个 move 事件压一次 undo 栈 |
| T1.5 | 分辨率贯通了，但 `bitrate_mbps` 全仓库无人读取；preview 时 ASS PlayRes 与视频尺寸不一致 |
| T1.6 | 单转场正确；≥2 个转场时补偿表坐标系混用（压缩后 vs 原始时间线），仍错位 |
| T1.10 | 只改了 generate_audio（1/3）；generate_subtitles、detach_audio、separate_vocals 仍整体覆盖写回 |
| T2.5 | TempDirGuard 只管 segments 目录；**全仓库无一处超时**；reqwest 未动（无共享 Client/无流式下载）；段目录硬编码 `/tmp` 不兼容 Windows |
| T3.4 | 原声进混音了，但引入 2 个严重新 bug（见 R0.2）；voiceover/audio 轨 muted 被忽略 |
| T3.5 | schema_version 有了；无 migrate 框架、无 corrupted 报告 |
| T4.2 | 插值函数正确；导出只支持 x/y 且仅 overlay 路径；volume 关键帧预览不生效；主视频 clip 关键帧不生效；无 clip 条菱形标记 |
| T4.3 | **预览取曲线平均值恒速播放**（看不出先快后慢）；`curveTimelineDuration` 导出后无人调用，时长不联动；无曲线编辑器 |
| T4.4 | 预览忽略羽化/invert/cx/cy/rotation；导出表达式直接报错（见 R0.3） |
| T4.5 | 数据模型没升级（仍是 string + 全局共享时长）；双压 undo 栈 |
| T4.6 | 只有 Ctrl+点击加选和批量删除；**无框选、无 Shift 范围选、无整组拖动**；选择状态不一致可导致误删 |
| T4.9 | fade 生效了；`setClipVolume` 是死代码（hook 未暴露、无人调用），实时音量没接通 |
| T4.7 | 胶片条有了，但 stale-state bug 导致 trim 后永不刷新 |
| T4.10 | audio-only 可用；HEVC 因两处降级 bug **实际输出永远是 h264** |

### 1.3 完全未做

| 任务 | 说明 |
|---|---|
| **T3.1 拆分 App.tsx** | 未动，反而从 3136 行涨到 **3436 行**。无 projectStore/uiStore/pipelineStore，无 clipOperations.ts |
| T4.5 转场新语义 | 仍是 xfade 缩短总长 + 事后补偿 |
| M2/M6/M9/M10/M13/M22 | 字体按需加载、死参数、fallback 友好化、TTS 去 Python 化（ssl_verify=False 仍在）、ASR 断句、结构化日志 |

---

## 2. R0：新引入的破坏性回归（最先修，用了就坏）

### R0.1 滤镜 canvas 和画中画层被主 video 遮挡【滤镜/PiP 预览整体失效】

**问题**：双缓冲实现给活跃 video 设 inline `zIndex = "5"`（`PreviewEngine.ts` `applyVideoAlignment` 约 252 行、`swapBuffers` 约 422 行）。而 `.stage-filter-canvas` 是 `z-index: 3`（styles.css 约 2194 行），`.stage-overlay-container` 没有 z-index（auto）。正 z-index 5 覆盖它们两个 → **开滤镜时 WebGL canvas 被盖住看不见；画中画 overlay video 也被主 video 盖住**。第一轮的 T4.1（PiP 预览）和滤镜预览在视觉上全部失效。

**修复步骤**：
1. 明确舞台层级设计并写进 CSS（禁止引擎再写 inline zIndex）：
   - 主 video 双缓冲：z-index 3（两个都是 3，用 opacity 切换显隐，不用 zIndex）
   - 滤镜 canvas：z-index 4
   - overlay 容器：z-index 5
   - 字幕层：z-index 8（现状保持）
2. `PreviewEngine.ts`：删除 `applyVideoAlignment` 和 `swapBuffers` 里所有 `style.zIndex` 赋值，交换只操作 `opacity`（新的设 1，旧的设 0）。
3. 验证 DOM 顺序：canvas 在两个 video 之后（已满足），overlay 容器在 canvas 之后（已满足）。

**验收标准**：给 clip 设 LUT 滤镜 → 预览可见滤镜效果；添加叠加轨视频 → 预览可见画中画；切换 clip 时上述都不闪断。

---

### R0.2 混音索引错位【图片 clip 存在时导出音频全部张冠李戴】

**问题**：`ffmpeg.rs` `merge_audio_clips`（约 1638-1669 行）：音频提取失败时 `continue`，`segment_paths` 变短；但 filter 构建用 `audio_clips.iter().enumerate().take(n)` 按**原列表**前 n 个对位。T3.4 把图片 clip（volume 默认 1.0 且有 local_path）也送进了混音列表，图片没有音频流必然提取失败 → **此后所有音频的 adelay/volume/fade 全部错位**（B 的声音配 A 的时间）。

**修复步骤**：
1. 把"提取成功的 (clip, path)"配对收集：`let mut extracted: Vec<(&AudioClipInfo, PathBuf)> = vec![]`，提取成功才 push，filter 构建遍历 `extracted` 而不是原列表 + take(n)。
2. 在收集混音输入的上游（`render_project_video` 内约 1085-1116 行），**过滤掉图片轨/图片素材 clip**（media.kind == "image" 不进混音）。
3. `audio-only` 导出路径（commands.rs 约 1162 行）同样应用第 2 步过滤 + muted 轨过滤。

**验收标准**：项目含"视频+图片+配音"三种 clip → 导出后每段声音的时间位置正确；audio-only 导出同样正确。

---

### R0.3 蒙版导出必失败【geq 表达式引用未定义变量】

**问题**：`ffmpeg.rs` `mask_alpha_expr`（约 1819-1851 行）用了小写 `w`/`h`，geq 只提供大写 `W`/`H` → 滤镜解析失败 → **任何设了蒙版的 PiP 导出直接报错**。且 circle 的归一化写反：`pow((X/w-{cx})*{rx},2)` 应是**除以**半径，现在 mask.width 越大蒙版越小。

**修复步骤**：
1. 全部改用大写 `W`/`H`。
2. circle 表达式改为：`if(gt(pow((X/W-{cx})/{rx},2)+pow((Y/H-{cy})/{ry},2),1),0,255)`，其中 rx = mask.width/2、ry = mask.height/2（归一化半径），除法而非乘法。
3. 羽化：把硬边界 `if(gt(d,1),0,255)` 换成 `255*clip((1+{feather}-d)/{feather},0,1)`（feather 趋 0 时退化为硬边界，注意 feather=0 要特判避免除零）。
4. invert：整体套 `255-(...)`。
5. **本机先验证再写代码**：`ffmpeg -f lavfi -i color=red:s=640x360 -vf "format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='<表达式>'" -frames:v 1 mask-test.png`，确认四种蒙版 + 羽化 + 反转的 PNG 输出正确后再替换代码。
6. 处理与 opacity 的叠加：mask 的 `a=` 表达式要乘以已有 alpha（`alpha(X,Y)*(...)/255`）而不是整体覆盖，否则蒙版会抹掉 colorchannelmixer 设置的透明度。

**验收标准**：四种蒙版各导出一次全部成功；width 增大蒙版范围变大；invert/羽化在导出中生效且与预览一致（预览端修复见 R2.6）。

---

### R0.4 HEVC 双重降级【用户选 HEVC 输出永远是 h264】

**问题**：
① `encoder_args`（ffmpeg.rs 约 88-94 行）：`if encoder == "libx264" || encoder == "libx265"` 分支把 libx265 替换为 HW_ENCODER 缓存的 **h264** 硬编 → 软编 HEVC 不可达。
② `burn_subtitle_and_mix_audio`（约 1219、1258 行）最终遍直接用 `HW_ENCODER.get()`，不用主流程按 codec 选出的编码器 → 即使段是 HEVC，**最终成片仍被重编码回 h264**。

**修复步骤**：
1. `encoder_args` 删除"回退读缓存"的魔法：函数只负责按传入的 encoder 名生成参数，`libx265` 走软编分支（`-preset medium -crf 26`）。回退逻辑收敛到唯一的选择函数 `pick_encoder(codec: &str) -> String`（h264 → 检测 h264 硬编否则 libx264；hevc → 检测 hevc_videotoolbox/hevc_nvenc 否则 libx265）。
2. `render_project_video` 把选好的 encoder 一路传给 `burn_subtitle_and_mix_audio`（改签名），删除其内部的 `HW_ENCODER.get()`。
3. `detect_hw_encoder` 扩展为 `detect_hw_encoder(codec)` 支持 hevc 系列探测（hevc_videotoolbox / hevc_nvenc / hevc_qsv），缓存改为 `OnceLock<HashMap>` 或两个 OnceLock。

**验收标准**：选 HEVC 导出 → `ffprobe -show_streams` 显示 codec_name=hevc；选 H.264 → h264；无 hevc 硬编的机器上 HEVC 走 libx265 成功导出。

---

### R0.5 撤销栈被交互旁路灌爆

**问题**（三处绕过 snapshot 机制，每个 move/keystroke 压一次 undo）：
- `handleSubtitleResize`（App.tsx 约 855-863 行）：pointermove 中 `updateSelectedClip(...)` 走默认 commit=true
- SubtitleOverlay 的 `onMove/onScale/onRotate`（App.tsx 约 2271-2282 行）：同上
- 字幕 textarea `onChange`（App.tsx 约 2252 行）：逐键 commit
- `handleApplyTransition`（App.tsx 约 1601-1612 行）：updateSelectedClip 已 persist，又手动 persist 一次 → **双压 undo，按一次 Ctrl+Z 无效果**
- 转场时长滑块（App.tsx 约 2126-2132 行）：直接 setProject+saveProject 绕过 undo

**修复步骤**：
1. 三处拖拽/缩放：move 事件改传 `commit=false`，在 `onMoveEnd/onScaleEnd/onRotateEnd/pointerup` 调 `commitInteractiveEdit()`（机制已存在，只是没用上）。
2. textarea：onChange 传 `commit=false`；`onBlur` 和退出编辑时 commit 一次。
3. `handleApplyTransition`：删掉手动 persist，只留 updateSelectedClip。
4. 转场时长滑块：改走 updateSelectedClip 同款模式（onChange false + pointerup commit），或至少 onChange 后防抖 persist 且压 undo 一次。

**验收标准**：舞台拖字幕从左到右 → Ctrl+Z 一次回原位；输入 10 个字的字幕 → Ctrl+Z 一次全部撤销；应用转场后 Ctrl+Z 一次即移除。

---

### R0.6 多选状态不一致可导致误删

**问题**：Ctrl+点击取消选中时只更新 `selectedClipIds`，`selectedClipId` 不同步（App.tsx 约 1554 行）；且 `selectedClip` 的 memo 有 `|| project.clips[0]` 兜底（App.tsx 约 317 行）→ 什么都没选时右键删除**会删掉项目第一个 clip**。

**修复步骤**：
1. 删除 `|| project.clips[0]` 兜底——没选中就是 null，所有用到 selectedClip 的地方处理 null（属性面板显示空态）。
2. 统一选择状态：`selectedClipId` 改为派生值 `selectedClipIds[0] ?? null`（用 useMemo），不再独立 setState，从根源消除不同步。全文搜索 `setSelectedClipId` 逐处改为操作 `selectedClipIds`。

**验收标准**：不选任何 clip 时右键菜单删除/复制等操作不可用或无副作用；Ctrl+点击取消选中后属性面板同步清空。

---

### R0.7 胶片条 trim 后永不刷新

**问题**：`TimelineTrack.tsx` Filmstrip 组件（约 383 行）effect 首行 `if (!localPath || frames) return;`——`frames` 有值就直接返回，cacheKey 变化（trim/zoom）后不重新请求。

**修复步骤**：
1. effect 依赖 `[cacheKey]`；内部先查模块级缓存 `filmstripCache.get(cacheKey)`，命中 setFrames，未命中发 IPC（带 300ms 防抖：`setTimeout` + cleanup 清除）。
2. `if (frames)` 提前返回的判断删除，改为"cacheKey 对应的数据已在 state 则跳过"（比较 state 中记录的 key）。

**验收标准**：trim 视频 clip 右边缘 → 0.5 秒内胶片条更新为新区间的帧。

---

### R0.8 overlay video 池只隐藏不回收（内存泄漏）

**问题**：`PreviewEngine.ts` `syncOverlays`（约 305-311 行）对不再活跃的 overlay video 只 `display:none`，从不从池中删除、不释放 src。长项目播完一遍积累大量持有解码器资源的隐藏 video。

**修复步骤**：
1. 引入"宽限期回收"：clip 离开活跃集时记录 `inactiveSince = performance.now()`（Map<clipId, number>）；每次 syncOverlays 末尾扫一遍，隐藏超过 10 秒的元素执行完整释放（pause → removeAttribute("src") → load() → remove()，从池中 delete）。宽限期避免来回 seek 时反复重建。
2. 池总量硬上限 8：超出时立即回收 inactiveSince 最老的。

**验收标准**：播放完含 10 个不同素材 overlay 的项目后，`overlayVideoPool.size <= 8`；来回 seek 同一区间不重复创建元素。

---

### R0.9 图片 clip 用 `<video>` 元素渲染（图片 PiP 黑屏）+ 图片主轨黑屏

**问题**：
① `syncOverlays` 对 `["video","image"]` 的所有 overlay 一律 `document.createElement("video")` 并设 src——**图片文件塞进 video 元素无法显示**，图片叠加层黑屏。
② 主轨（底层）如果是图片轨 clip：`findClipAt(time, "video")` 只查视频轨返回 null → 主 video 清空 src；而 `publish` 的 activeVideoClip 是含 image 的 baseClip 非 null → 连空态提示都不显示 → **图片作为主画面时预览纯黑**（App 中无渲染 base image 的路径）。

**修复步骤**：
1. `syncOverlays` 按 media.kind 分流：image 用 `document.createElement("img")`（transform/mask/关键帧逻辑同样适用，跳过 seek/playbackRate 部分）；video 维持现状。池的 value 类型改为 `HTMLVideoElement | HTMLImageElement`。
2. 主轨图片：`applyVideoAlignment` 改用 `findAllClipsAt(t, ["video","image"])[0]` 作为 base；若 base 是图片，主 video 隐藏（opacity 0），在 overlay 容器**底部**（insertBefore 首位）渲染一个全屏 img（可复用池机制，key 用 base clip id）。
3. FilterRenderer 对图片 base 的滤镜：texImage2D 支持 HTMLImageElement，`setVideo` 参数类型放宽为 `TexImageSource`。

**验收标准**：图片拖到叠加轨 → 预览可见；图片放主轨 → 预览显示图片全屏；图片 clip 设滤镜 → 预览生效。

---

## 3. R1：片段切换卡顿/黑屏 —— 根因与最佳方案（本轮核心）

### 3.1 根因链（按影响排序，全部已核实）

1. **切换协议的"理想路径"极窄，fallback 是常态**（PreviewEngine.ts `applyVideoAlignment` 约 211-226 行）：
   swap 只在 `preloadedClipId === clip.id && preloader.readyState >= 2` 时发生。而预载（`tryPreloadNext`）只覆盖"顺序播放 + 提前 3 秒 + 下一个 clip 紧邻当前 clip 结尾（gap < 0.01s）"的情形。以下全部走 fallback ——**在可见元素上直接改 src → 必黑屏**（src 变更后到首帧解码完成前 video 渲染空白）：
   - 用户点时间线 seek 到任何其他 clip
   - clip 之间有空隙（黑场段之后）
   - 逆向/跳跃播放头移动
   - 预载竞态失败（见第 2 条）
2. **预载竞态**（`tryPreloadNext` 约 460-469 行）：`loadeddata` 后设 `preloader.currentTime = 入点` → **seek 期间 readyState 从 2 掉回 1**。若播放头恰在此刻到达边界，swap 条件不满足 → fallback 黑屏。就绪判定必须等 `seeked` 事件而非 `loadeddata`。此外预载目标变更时旧 listener 未移除（陈旧闭包）。
3. **swap 后目标元素是 paused**：`swapBuffers` 不 play，等 `applyVideoAlignment` 末尾 `videoEl.play()`（异步 Promise）→ 切换点有数帧冻结。正确做法是**边界前就让目标元素起播**（音量 gain=0），到边界瞬间只切 opacity + gain。
4. **同源相邻 clip 也走完整切换**：用户分割 clip 产生的两段是同一个文件、源时间连续。当前逻辑仍触发 swap 或 `src.includes` 比较——本可**什么都不做**（元素继续播即可）。这是最高频场景（分割是最常用操作）。
5. **`videoEl.src.includes(src)` 判断不可靠**：`convertFileSrc` 产生的 URL 有百分号编码差异，includes 误判为不同 → 同文件也重新 load → 黑屏。
6. **切换瞬间主线程拥堵放大卡顿**：clip 边界处 `publish()` 更新 activeVideoClip/activeOverlayClips → **App 全树重渲染**（见 R2.1，T2.1 未真正解耦）+ FilterRenderer 纹理重传 + syncOverlays 每帧全量写 style。视频加载的等待期叠加 React 长任务 → 视觉卡顿。
7. **`activeOverlayClips` 每帧新数组引用**：`publish()` 里 `slice(1)` 每帧新建数组塞进 store → 订阅该字段的 App 每帧重渲染（zustand 默认 Object.is 比较引用）。即使没有 overlay 也一样。

### 3.2 最佳方案：按素材缓存的元素池 + lookahead 预载 + 热切换

放弃"A/B 双缓冲"模型（它假设播放是严格顺序的），改为**媒体元素池**架构。这是浏览器技术栈内的最优解；WebCodecs 统一合成是终极方案但工作量大一个数量级，列为长期方向（R4.5），本轮不做。

**核心设计**：

```
MediaElementPool（按 mediaId 缓存，不是按 clip）
├── Map<mediaId, PooledVideo>   上限 6，LRU 淘汰
│     PooledVideo = { el: HTMLVideoElement, gain: GainNode, lastUsed: number,
│                     seekTarget: number | null, seeked: boolean }
├── 所有池内元素常驻 overlay 容器下层，opacity:0，muted 由 gain 控制
└── 同一素材的多个 clip 复用同一个元素（分割场景零成本）

PreloadScheduler（每 500ms 或 clip 边界触发，不必每帧）
├── 计算 lookahead 窗口：[currentTime, currentTime + 5s] 内所有视频 clip
├── 对窗口内每个 clip 的 media：确保池中有元素、src 已 load、
│     已 seek 到该 clip 的入点（等 `seeked` 事件置 ready 标记）
└── 边界前 300ms：对下一个 clip 的元素调用 play()（gain=0 静默起播）

切换协议（applyVideoAlignment 内，到达 clip 边界时）
├── case 1 同元素续播：新旧 clip 同 mediaId 且
│     |新clip.sourceIn − (旧clip.sourceIn + 旧clip.duration×speed)| < 0.05 且同速
│     → 什么都不做（连 seek 都不要），只更新 currentVideoClipId        ← 分割场景
├── case 2 热切换：目标元素 ready（readyState≥3 且 seeked）且已静默起播
│     → 原子操作：新元素 opacity=1 + gain=音量；旧元素 gain=0，
│       下一帧再 opacity=0 + pause（避免同帧闪黑）
├── case 3 目标未就绪（预载没跟上）
│     → **保持旧画面显示**（不清 src、不黑屏），显示轻量 loading 角标，
│       目标 ready 后立即热切换。宁可画面滞留 100ms，不可黑屏
└── 禁止一切在 opacity=1 元素上的 src 赋值（代码里加注释断言）
```

**关键细节**：
- src 一致性判断：不再比较 URL 字符串，池按 `mediaId` 索引，天然无此问题。
- seek 就绪判定：设 `el.currentTime` 后监听一次性 `seeked` 事件置 `seeked=true`；改 seek 目标时先置 false。移除现在的 `loadeddata` 监听方案。
- `preload="auto"` + 挂载后立即 `load()`。
- Web Audio：每个池元素创建时做一次 `createMediaElementSource`（元素与 source 一一绑定，元素复用则 source 复用，规避"同元素二次绑定抛错"问题——这也顺带修复现存 bug：重进编辑器时 `ensureAudioContext` 对老元素二次 createMediaElementSource 抛错被吞、原声永久静音，PreviewEngine.ts 约 482-492 行的 try/catch）。
- LRU 淘汰时完整释放：`pause → removeAttribute("src") → load() → 断开 source → remove()`。
- 图片素材：池中放 `HTMLImageElement`（与 R0.9 合并实现）。
- overlay 与主轨共用同一个池：主轨 clip 用池元素 + opacity/z 序管理，删除 bufferA/bufferB/preloader/swapBuffers/tryPreloadNext 全套双缓冲代码。

### 3.3 任务拆分

**R1.1 建 MediaElementPool 类**（新文件 `src/preview/MediaElementPool.ts`，~150 行）：
按上述设计实现 acquire(mediaId, src) / markUsed / evictLRU / dispose；元素创建时接入 AudioContext（接受外部传入的 ctx）；`seekTo(el, time)` 封装 seeked 事件跟踪。纯类，不依赖 React。

**R1.2 PreviewEngine 切换到池架构**：
删除 bufferA/bufferB/preloader/preloadedClipId/preloadedSrc/swapBuffers/tryPreloadNext；`applyVideoAlignment` 改为三分支切换协议（同元素续播/热切换/保持旧画面）；构造函数不再接收两个 video 元素，改为接收舞台容器（池元素动态创建在容器内）；`onActiveVideoChange` 语义保留（通知 FilterRenderer 当前活跃元素）。App.tsx 删除两个 `<video>` JSX（保留容器 div）。

**R1.3 PreloadScheduler**：
engine 内部 500ms 间隔 + seek/边界事件触发；lookahead 5 秒；边界前 300ms 静默起播下一元素。**seek 时同样触发**：seek 落点的 clip 若未就绪，走 case 3 保持旧画面 + 就绪后切换（消除点时间线的黑屏）。

**R1.4 publish 引用稳定化**（修根因 7）：
`publish()` 缓存上一次的 activeVideoClip/activeOverlayClips/activeSubtitleClip；仅当 **clip id 集合变化**时才生成新数组/新引用写入 store，否则复用旧引用。currentTime 仍每帧写（订阅它的组件本来就该每帧更新）。

**R1.5 syncOverlays 写入去重**：
每个池元素记录上次应用的 style 签名（字符串拼接 x/y/scale/opacity/rotation/mask），签名不变跳过全部 style 赋值。消除每帧无效 style 写导致的 recalc。

**验收标准（R1 整体）**：
- 顺序播放跨 5 个不同素材的 clip 边界：无黑屏、无可见卡顿（逐帧录屏检查边界 3 帧）。
- 分割一个 clip 成两段后播放跨边界：完全无缝（无 seek 发生，可在 seekTo 里临时 console.count 验证后删除）。
- 点时间线跳到任意 clip 中间：旧画面保持到新画面就绪，无黑屏窗口。
- 播放中 CPU 占用不高于改造前；池内元素数 ≤ 6。
- 退出编辑器再进入：视频原声正常（MediaElementSource 复用验证）。

---

## 4. R2：表面修复返工

### R2.1 真正完成 T2.1/T2.2 播放解耦【与 R1 同等优先级】

**问题**：`App.tsx:306` `const playhead = usePlaybackStore((s) => s.currentTime)` 在顶层订阅每帧字段；App.tsx 无任何 useCallback；`clips={project.clips.filter(...)}` 每次渲染新建数组。**播放时 App 仍 60fps 全树重渲染**——这也是切换卡顿的放大器（根因 6）。

**修复步骤**：
1. 从 App.tsx 顶层**删除** `playhead`、`isPlaying` 之外还有 activeSubtitle* 的订阅（activeVideoClip/activeOverlayClips 在 R1.4 引用稳定后是低频，可留）。逐个消费点拆成自订阅小组件：
   - `PlayheadLine`（时间线播放头竖线）：自己订阅 currentTime，绝对定位。
   - `TimecodeDisplay`（时间码文本）：自己订阅。
   - `StageSubtitleLayer`（字幕渲染层）：订阅 activeSubtitle/activeSubtitleStyle/activeSubtitleClip/currentTime。
   - 关键帧按钮高亮（属性面板 ◆）：该按钮组件内订阅 currentTime。
   - 其余偶发读取（如分割操作取当前时间）改 `usePlaybackStore.getState().currentTime`，不订阅。
2. `import { useCallback } from "react"`，把传给 TimelineTrack / ContextMenu / 面板的**所有**回调用 useCallback 包裹（依赖用 ref 技巧或稳定的 store action）。
3. 每轨 clips 数组用 useMemo 按 `[project.clips, track.id]` 缓存（或一次性 useMemo 出 `Map<trackId, Clip[]>`）。
4. 用 React DevTools Profiler 实测：播放 5 秒，App 本体渲染次数 < 5。

**验收标准**：Profiler 录制播放 5 秒 → App 与 TimelineTrack 渲染次数各 < 5；播放头/时间码正常每帧更新。

### R2.2 补完 T1.10（剩余 2/3 命令）

`generate_subtitles`（commands.rs 约 705-858 行）、`detach_audio`（约 479 行）、`separate_vocals`（约 595 行）改为"await 完成后重读 project + 按 id 定向合并"，完全对照已修好的 `generate_audio`（commands.rs 约 433-459 行）的模式。顺带把 `generate_audio` 里 `sid.contains(clip_id)` 的字符串包含匹配改成精确相等或前缀匹配。

### R2.3 补完 T2.5（超时/reqwest/临时文件）

1. **超时**：新建辅助函数 `pub async fn run_with_timeout(cmd: &mut tokio::process::Command, secs: u64) -> anyhow::Result<Output>`——`tokio::time::timeout` 包 `output()`，超时先 `child.kill()` 再报错。替换全部 `.output().await` 调用点（ffmpeg 渲染 1800s、ffprobe/探测 30s、whisper 1800s）。
2. **reqwest**：`OnceLock<reqwest::Client>` 共享实例（`.timeout(60s).connect_timeout(10s)`），替换 ai.rs / pexels.rs / asr.rs / ffmpeg.rs 全部 `Client::new()` 和 `reqwest::get`；`ensure_media_local` 改 `bytes_stream()` 逐块写盘。
3. **临时文件**：concat 列表、.ass、mixed-audio wav、audio-merge/ 全部改到 TempDirGuard 目录内（guard 已存在，只是没用全）；commands.rs 的 asr-merged/asr-list、asr.rs 的 whisper 输出 json 用完 `let _ = fs::remove_file(...)`。
4. **段目录**：`/tmp/scenescript-render` 硬编码改 `std::env::temp_dir().join("scenescript-render")`。

### R2.4 补完 T3.4/T4.10 遗留

1. voiceover/audio 轨的 `muted` 在混音收集处生效（ffmpeg.rs 约 1088-1091 行的 match 补上判断）。
2. `bitrate_mbps` 接入：`encoder_args` 增加 `bitrate: Option<f32>` 参数，>0 时硬编用 `-b:v {n}M`，软编用 `-crf` 不变但加 `-maxrate {n}M -bufsize {2n}M`；ExportDialog 的码率值传到 RenderConfig（前端已有字段，确认链路通）。
3. audio-only 支持 wav（按扩展名选 `-c:a pcm_s16le` 或 mp3）。

### R2.5 曲线变速做真（T4.3 返工）

1. **时长联动**：应用曲线预设时调用已存在但无人用的 `curveTimelineDuration`（speedCurve.ts）重算 `clip.duration`，并按 changeClipSpeed 的 ripple 逻辑推移后续 clip。
2. **预览分段变速**：PreviewEngine 的 `effectiveSpeed` 删除"平均速"逻辑；播放中每帧（或每 200ms）按 `curveToSegments` 结果查当前源位置所在段，设置 `playbackRate`（变速点少，查表开销可忽略）。seek 追赶的目标源时间计算也要按曲线积分（`curveToSegments` 累加）而非线性乘法——在 speedCurve.ts 加 `timelineToSourceTime(curve, sourceDuration, rel): number`。
3. **导出分段渲染**：`render_single_clip_for_segment` 遇到 speed_curve 时按 `curveToSegments` 等价的 Rust 实现拆成子段（每子段 setpts+atempo），concat 后作为该 clip 的渲染结果。删除"平均速"近似（ffmpeg.rs 约 993-1000 行）。
4. （可选后置）SVG 曲线编辑器。

**验收标准**：应用"英雄时刻"→ clip 时间线时长变化、后续 clip 推移；预览先快后慢肉眼可辨；导出与预览节奏一致。

### R2.6 蒙版预览补齐（配合 R0.3）

预览端（PreviewEngine syncOverlays 蒙版分支）：
1. circle/rect 羽化：clip-path 不支持羽化 → 改用 `mask-image: radial-gradient(...)`（circle）和两层 linear-gradient 合成（rect），羽化映射为渐变过渡带。
2. invert：radial/linear-gradient 的黑白反转即可。
3. linear/mirror 接入 cx/cy/rotation（gradient 角度 = rotation，位置由 cx/cy 计算百分比）。

**验收标准**：四种蒙版 × 羽化 × 反转，预览与导出（R0.3 修好后）逐一对比视觉一致。

### R2.7 多选补全（T4.6 返工）

1. **整组拖动**：`handleClipDrag` 检测被拖 clip ∈ selectedClipIds 且多选时，对组内每个 clip 应用相同 delta（吸附以被拖 clip 为准）；commit 一次含全组的 undo。
2. **框选**：时间线空白处 mousedown 拖出半透明矩形（一个绝对定位 div），mouseup 时把矩形与各轨 clip 的 [时间范围×轨道行] 相交的 clip 设为 selectedClipIds。
3. **Shift+点击**：同轨上次选中 clip 到当前 clip 之间的全部 clip 加选。

### R2.8 实时音量接线（T4.9 返工）

`usePreviewEngine` 返回值暴露 `setClipVolume`；App 音量滑块 onChange 里（除 updateSelectedClip(patch,false) 外）调用 `engine.setClipVolume(clipId, v)`。视频原声同理走 videoGainNodes（池化后即 PooledVideo.gain）。顺带删除 PreviewEngine 的 `buildCssFilter` 死代码和 `play()` 里两条 console.log。

### R2.9 关键帧补漏（T4.2 返工）

1. 主轨（底层）clip 的关键帧在 `applyVideoAlignment` 中采样应用（当前只有 overlay 生效）。
2. volume 关键帧：音频调度时若 clip 有 volume keyframes，用 `setValueCurveAtValueAtTime`/分段 linearRamp 预排（Web Audio 支持在 start 前排好曲线）。
3. 导出：`keyframes_to_overlay_expr` 已支持 x/y；补 opacity（首尾帧 → fade 滤镜近似，中间帧忽略并在 UI 提示）。scale/rotation 导出仍标注预览 only。
4. clip 条上渲染菱形标记（TimelineTrack 内按 clip.keyframes 各属性的 time 换算像素位置）。

### R2.10 转场补偿坐标系修正（T1.6 返工）

shrink 表构建（ffmpeg.rs 约 707-730 行）：记录点必须用**原始时间线坐标**——`acc_original += seg_dur`（不减 td）作为记录点位置，`acc_shrink += td` 作为该点的累计缩短量，存 `(acc_original, acc_shrink)`；消费端 `clip.start_on_track` 与原始坐标比较，减去对应 `acc_shrink`。写完后用 3 段 2 转场的项目实测音画（这是第一轮就错的补偿，必须实测不能只看代码）。

---

## 5. R3：仍未完成的第一轮任务（按原文档执行）

| 任务 | 说明 | 原文档编号 |
|---|---|---|
| R3.1 拆分 App.tsx | **强制执行**。3436 行是所有前端返工困难的根源。按原 T3.1 步骤：projectStore/uiStore/pipelineStore + clipOperations.ts + pipeline.ts，目标 <400 行。建议在 R1/R2.1 完成后立即做 | T3.1 |
| R3.2 转场新语义 | 不改变总时长的剪映式转场 + per-clip `Transition {name, duration}` 模型（含旧 string 反序列化兼容）。完成后 R2.10 的补偿逻辑可整体删除 | T4.5 方案B |
| R3.3 TTS 去 Python 化 | reqwest 直调 Gradio API，删除 `ssl_verify=False` 和 Python 探测 | M10 |
| R3.4 取消粒度 | kill 正在运行的 ffmpeg child（tokio child.kill）；xfade/字幕混音阶段加取消检查 + 85% 进度事件 | T3.3 遗留 |
| R3.5 ASR 断句 | big_gap 判断移到追加当前 cue **之前**（asr.rs 约 240-266 行，第一轮标记已修但实际未修） | M13 |
| R3.6 其余 M 项 | M2（字体按需加载）、M6（死参数）、M9（fallback 友好化）、M12（翻译保词级时间戳）、M20（probe 静默）、M22（结构化日志） | — |

---

## 6. R4：长期方向（本轮不执行，仅立项）

1. **WebCodecs 渲染管线**：VideoDecoder 逐帧解码 → OffscreenCanvas 合成（滤镜/蒙版/变换统一 shader 处理）→ 帧精确、零黑屏、预览=导出像素级一致。剪映网页版同思路。前置条件：R1 池架构稳定、R3.1 拆分完成。
2. **单遍 filter_complex 导出**：消除 2-3 代重编码画质损失（转场新语义 R3.2 完成后评估）。
3. **代理剪辑**：4K 素材自动生成 540p 代理，预览用代理导出用原片。

---

## 7. 执行顺序

| 批次 | 任务 | 理由 |
|---|---|---|
| 第 1 批（破坏性回归） | R0.1 → R0.2 → R0.3 → R0.4 → R0.5 → R0.6 → R0.7 → R0.8 | 均为小改动，当前版本"用了就坏" |
| 第 2 批（本轮核心） | R2.1（真解耦）→ R1.1 → R1.2 → R1.3 → R1.4 → R1.5 → R0.9（并入池实现） | 切换卡顿/黑屏。先 R2.1 是因为全树重渲染会掩盖池化的效果验证 |
| 第 3 批（导出正确性） | R2.10 → R2.2 → R2.3 → R2.4 | 后端返工 |
| 第 4 批（架构还债） | R3.1 拆分 App.tsx | 强制 |
| 第 5 批（功能做真） | R2.5 → R2.6 → R2.7 → R2.8 → R2.9 | 曲线变速/蒙版/多选/音量/关键帧 |
| 第 6 批 | R3.2 → R3.3 → R3.4 → R3.5 → R3.6 | 收尾 |

## 8. 给执行模型的额外纪律（针对第一轮暴露的问题）

1. **禁止"建了机制不接线"**：新写的函数/store/组件必须有真实调用方，PR 内 grep 自查无死代码（第一轮的 setClipVolume、curveTimelineDuration 都是建完没接）。
2. **禁止"改一处漏同类"**：修一个模式问题时全文搜索同模式（第一轮 lost update 只改了 1/3 命令）。
3. **ffmpeg 表达式必须先在本机命令行验证**再写进代码（第一轮蒙版 geq 直接写挂）。
4. **性能优化必须用 Profiler 数字验收**，不能以"用了 zustand"为完成标志。
5. **验收标准逐条手测**，不许只跑 build/check 就标完成。
6. 涉及时间轴/补偿的修改，**必须构造 ≥2 个转场/clip 的项目实际导出验证**，不能只推理。
