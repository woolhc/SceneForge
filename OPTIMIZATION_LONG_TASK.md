# SceneForge Long-Run Optimization Task

This file is the execution plan for finishing the remaining performance and rendering work.

## Goal

Make preview playback smooth on large projects, keep preview/export timing semantics consistent, and prepare a WebCodecs renderer without breaking the current HTML media renderer.

## Phase 1: Exact Transition Semantics

Status: implemented and verified with unit tests plus ffmpeg/ffprobe fixtures

Target:
- Per-clip transition model is `{ name, duration }`.
- Legacy string transitions still load.
- Transitions do not shorten total timeline duration.
- Audio and subtitles stay on original timeline coordinates.

Implementation steps:
- Replace the current handle-based xfade approximation with explicit render spans:
  - normal span
  - transition span
  - normal span
- For a transition at boundary `B` with duration `D`:
  - previous clip contributes `[B - D, B]`
  - next clip contributes `[B, B + D]`
  - output transition span is `[B - D, B]` while sampling the next side from `[B, B + D]`
  - timeline total remains unchanged.
- Clamp `D` to available source/timeline handles.
- Keep the current handle-based implementation only as fallback while exact transition rendering is built.
Completed:
- Render units now split normal spans and transition spans before final concatenation.
- A transition unit renders previous/next composites separately, then `xfade`s them into one timeline-length segment.
- Final video merge uses concat, so audio/subtitle coordinates stay on the original timeline.
- Added Rust unit tests for config transitions, legacy string transitions, and multiple transitions preserving total render-unit duration.
- Added `scripts/verify-r32-duration.mjs` ffmpeg/ffprobe fixture for two-clip and three-clip transition duration checks plus single-pass overlay graph smoke.

Acceptance:
- Two adjacent clips with a 0.5s transition export to `clipA.duration + clipB.duration`.
- Three clips with two transitions keep total timeline duration.
- Subtitle/audio timestamps do not shift.
- Legacy projects with `transitionIn: "fade"` still export.

## Phase 2: Single-Pass Export Graph

Status: completed MVP for simple continuous base track plus static overlay tracks

Target:
- Reduce intermediate re-encoding.
- Build one `filter_complex` graph for timeline video composition when possible.
- Fall back to segmented render for unsupported cases.

Implementation steps:
- Build a timeline graph planner independent from ffmpeg command emission.
- Emit graph nodes for:
  - trim
  - crop
  - scale
  - speed
  - filters
  - masks
  - overlays
  - transitions
- Add capability fallback:
  - simple projects use single pass
  - complex curve speed / unsupported masks can fall back initially.

Acceptance:
- Simple two-clip project exports with one ffmpeg invocation for video graph.
- Visual result matches current segmented renderer.
- HEVC/H.264 selection still works.

Completed:
- Added a conservative single-pass planner for continuous base video/image track timelines.
- The single-pass path emits one `filter_complex` graph with trim/input seek, crop, scale, color filters, speed `setpts`, base concat, and static overlay clips with enable windows.
- Projects with transitions, keyframes, masks, curve speed, gaps, rotation/corner/mix overlays, or unsupported media fall back to segmented rendering.
- Added planner tests for simple overlay acceptance and complex overlay fallback.

## Phase 3: App Split Continuation

Status: completed for the requested continuation scope

Target:
- Continue reducing `App.tsx`.
- Keep stores/modules as real call sites, not empty scaffolding.

Implementation steps:
- Move project persistence and undo/redo into `projectStore`.
- Move export state/actions into `exportStore` or `uiStore`.
- Move timeline handlers into `timelineActions`.
- Move generation pipeline orchestration into `editor/pipeline.ts`.

Acceptance:
- App remains buildable after each extraction.
- Undo/redo behavior unchanged.
- Generate pipeline handles errors through store actions.

Completed:
- Moved project undo/redo and debounced persistence into `store/projectHistory.ts`.
- Moved export action state transitions and render invocation into `store/exportAction.ts`; App now wires the dialog to the hook.
- Moved track naming and timeline track mute/lock/reorder mutations into `editor/timelineActions.ts`.
- Moved one-click generation pipeline step orchestration/error handling into `editor/pipeline.ts`; App now supplies business callbacks.

## Phase 4: WebCodecs Renderer MVP

Status: completed experimental base-track VideoDecoder path behind feature gate

Target:
- Add `WebCodecsRenderer` behind `PreviewRenderer`.
- Keep `PreviewEngine` as fallback.

Implementation steps:
- Add renderer selection gate.
- Decode one base video track through `VideoDecoder`.
- Draw frames to canvas.
- Support seek/play/pause with proxy media first.
- Fall back to HTML renderer when WebCodecs is unavailable.

Acceptance:
- One video track plays through WebCodecs renderer.
- Seek does not black-screen.
- HTML renderer fallback still works.

Completed:
- Added `WebCodecsRenderer` behind the `PreviewRenderer` interface.
- Added explicit feature gate: `VideoDecoder` support plus `localStorage.scenescript:webcodecs-preview=1`.
- Added lazy `mp4box` demuxing and `VideoDecoder` frame output to canvas for the active base track.
- Kept HTML video-to-canvas fallback inside the experimental renderer when demux/decode is unsupported.
- Default preview path remains `PreviewEngine`, so current HTML renderer fallback is preserved.
- Added `scripts/smoke-webcodecs-preview.py` browser smoke that verifies `VideoDecoder` gate, nonblack base pixels, overlay pixels, playback-store overlay publication, and five adjacent clip seeks.

## Phase 5: WebCodecs Composition

Status: completed WebGL shader composition for supported overlay/filter/mask effects

Target:
- Move transform/filter/mask/overlay composition into canvas/WebGL.

Implementation steps:
- Add timeline compositor shared with export planner.
- Add overlay tracks.
- Add opacity/position/scale/rotation keyframes.
- Add shader path for filters/masks.

Acceptance:
- Preview visual path matches export semantics for supported effects.
- React does not rerender per frame.

Completed:
- `WebCodecsRenderer` now composites active overlay clips into the same canvas, preferring the `WebGLCompositor` shader path and falling back to 2D canvas if WebGL is unavailable.
- Overlay clips use proxy/original media, timeline source-time alignment, x/y/scale/opacity/rotation keyframes, brightness/contrast/saturation, LUT data, round corners, feathered/inverted circle and rect masks, and publish `activeOverlayClips` through the playback store.
- WebGL keeps the drawing buffer stable after seek renders so delayed readback and static preview frames do not collapse to black.
- Rendering remains outside React per frame; React receives only playback state ticks.
- Browser smoke verifies LUT shader remapping, feathered rotated mask clipping, red base AV1 frame, blue overlay composited into the same canvas, and five adjacent clips seek without black frames.

## Phase 6: Verification

Status: automated core checks passing

Checks after every phase:
- `npm run build`
- `cargo check`
- `cargo test ffmpeg::tests`
- `node scripts/verify-r32-duration.mjs`
- `node scripts/verify-proxy-generation.mjs`
- `python scripts/smoke-webcodecs-preview.py`
- `git diff --check`

Manual cases:
- Existing project with old string transitions.
- New project with per-clip transition durations.
- 4K video project after proxy generation. Covered by `verify-proxy-generation.mjs` for 4K -> 960px proxy parameters.
- Five adjacent clips playback. Covered by `smoke-webcodecs-preview.py` five-clip seek check.
- Export duration equals timeline duration.
