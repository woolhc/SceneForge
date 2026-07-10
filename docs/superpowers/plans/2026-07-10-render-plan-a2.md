# RenderPlan A2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Rust FFmpeg export path consume a deterministic RenderPlan compiled from the A1 RenderGraph instead of independently re-scanning project tracks and clips.

**Architecture:** Add a pure `render_plan` compiler whose layer indices reference the immutable `RenderGraph.layers` snapshot. Migrate `ffmpeg.rs` to translate those precomputed units into the existing segment, transition, and single-pass commands without changing media I/O, filter generation, encoding, audio mixing, or subtitle burning.

**Tech Stack:** Rust, serde/serde_json already in the project, existing Tauri backend, FFmpeg command builder, Cargo unit tests, shared JSON fixtures.

## Global Constraints

- Do not add npm or Cargo dependencies.
- Do not modify the persisted Project JSON shape.
- Preserve existing FFmpeg command execution and filter behavior unless a test proves planning semantics are wrong.
- Use test-first red/green cycles for every production behavior.
- Keep all changes uncommitted unless the user explicitly requests a commit.

---

### Task 1: Define RenderPlan Contract From Golden Fixture

**Files:**
- Modify: `tests/fixtures/render-graph-golden.json`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/render_plan.rs`

**Interfaces:**
- Consumes: `crate::render_graph::{RenderGraph, RenderLayer}` and the shared golden project's compiled graph.
- Produces: `compile_render_plan(graph: &RenderGraph, fallback_transition_duration: f64) -> RenderPlan` plus public `RenderPlan`, `RenderUnit`, `PlannedTransition`, and `SinglePassPlan` types.

- [x] **Step 1: Add the expected plan to the shared fixture**

Add `planExpected` beside `samples` with duration `10`, visual ids `base`, `overlay`, `reverse`, and four normal units: `0..1`, `1..5`, `5..6`, and `6..10`, each containing the expected active ids in RenderGraph layer order.

- [x] **Step 2: Add a failing Rust golden-plan test**

Declare `mod render_plan;` in `src-tauri/src/lib.rs`. In `src-tauri/src/render_plan.rs`, deserialize `planExpected`, compile the A1 graph, call the wished-for `compile_render_plan`, normalize ids through the graph, and assert equality with the fixture.

- [x] **Step 3: Run the focused test and verify RED**

Run: `cargo test --locked render_plan_matches_shared_golden_fixture -- --nocapture`

Expected: FAIL because `compile_render_plan` and its contract do not exist yet.

- [x] **Step 4: Implement the minimal contract and normal intervals**

Implement visual-layer filtering, graph-order preservation, clip-boundary splitting, black-tail coverage through `graph.duration`, and precomputed active layer indices. Keep transition and single-pass fields empty in this first green step.

- [x] **Step 5: Run the focused test and verify GREEN**

Run: `cargo test --locked render_plan_matches_shared_golden_fixture -- --nocapture`

Expected: PASS.

### Task 2: Compile Deterministic Transition Units

**Files:**
- Modify: `src-tauri/src/render_plan.rs`

**Interfaces:**
- Consumes: visual layers grouped by `clip.track_id`, `ClipTransition::name()`, and `ClipTransition::duration(fallback)`.
- Produces: `RenderUnit::Transition` with `previous_layer_indices`, `next_layer_indices`, and `PlannedTransition { name, source_layer_index }`.

- [x] **Step 1: Add failing transition tests**

Add tests for configured `transitionIn`, legacy `transitionIn`, `transitionOut`, multiple transitions preserving total duration, and simultaneous multi-track transitions selecting the highest visual layer deterministically.

- [x] **Step 2: Run transition tests and verify RED**

Run: `cargo test --locked render_plan::tests::transition -- --nocapture`

Expected: FAIL because the compiler currently emits only normal units.

- [x] **Step 3: Implement transition candidate compilation**

Sort clips per track by start time and id, recognize only adjacent clips within `0.05s`, prefer incoming transition over outgoing transition, clamp duration, resolve same-boundary candidates by topmost track order, then replace the affected normal interval with a transition unit.

- [x] **Step 4: Precompute transition-side layers**

For a transition `[boundary-duration, boundary)`, compute previous layers over that interval and next layers over `[boundary, boundary+duration)`, preserving RenderGraph order.

- [x] **Step 5: Run transition tests and verify GREEN**

Run: `cargo test --locked render_plan::tests::transition -- --nocapture`

Expected: PASS with unit durations summing to the graph duration.

### Task 3: Compile Single-Pass Eligibility

**Files:**
- Modify: `src-tauri/src/render_plan.rs`

**Interfaces:**
- Consumes: graph media association, clip timing, speed, transitions, mask, keyframes, and transforms.
- Produces: `SinglePassPlan { base_layer_indices, overlay_layer_indices }` or `None`.

- [x] **Step 1: Add failing single-pass tests**

Cover a contiguous base track with a simple overlay, a complex overlay transform fallback, a missing-media fallback, a reverse/curve-speed fallback, and graph-duration tail preventing single pass.

- [x] **Step 2: Run focused tests and verify RED**

Run: `cargo test --locked render_plan::tests::single_pass -- --nocapture`

Expected: FAIL because `single_pass` is always `None`.

- [x] **Step 3: Implement the minimum eligibility compiler**

Choose the first RenderGraph visual track as the base, require contiguous base coverage through graph duration, apply the current FFmpeg support predicates to base and overlays, and return layer indices without re-sorting project data.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `cargo test --locked render_plan::tests::single_pass -- --nocapture`

Expected: PASS.

### Task 4: Migrate FFmpeg to RenderPlan

**Files:**
- Modify: `src-tauri/src/ffmpeg.rs`
- Modify: `src-tauri/src/render_plan.rs`

**Interfaces:**
- Consumes: `compile_render_graph(project)` and `compile_render_plan(&graph, fallback)`.
- Produces: existing `render_project_video` behavior with no local track filtering, boundary construction, active-window scan, transition scan, or single-pass semantic planner.

- [x] **Step 1: Add a failing integration-level planner assertion**

Add a test helper that resolves `RenderUnit` indices to clip ids and proves normal and transition units contain exactly the clips FFmpeg must execute, including an empty black-tail unit.

- [x] **Step 2: Run the focused test and verify RED**

Run: `cargo test --locked ffmpeg_plan_supplies_execution_layers -- --nocapture`

Expected: FAIL until the execution-facing resolver is present.

- [x] **Step 3: Add a small layer-index resolver**

Expose or locally define a checked helper that maps plan indices to `&Clip`; invalid indices must be ignored rather than panic, although compiler-produced plans must always be valid.

- [x] **Step 4: Replace render-project planning inputs**

Compile graph and plan once, use `plan.duration`, reject an empty visual plan, build the existing `SinglePassVideoGraph` from single-pass indices, and iterate `plan.units` directly.

- [x] **Step 5: Make transition execution declarative**

Change `render_transition_unit` to receive the planned transition name plus previous and next clip slices. Remove its full-clip scans and active-window lookups.

- [x] **Step 6: Delete obsolete planners and dead merge branch**

Remove `active_clips_for_window`, `build_render_units`, `split_normal_by_clip_boundaries`, `plan_single_pass_video_graph`, their migrated tests, the unused legacy `segments` array, and the unreachable `has_transitions = false` xfade branch.

- [x] **Step 7: Run Rust tests and verify GREEN**

Run: `cargo test --locked`

Expected: all Rust tests pass without new warnings from RenderPlan.

### Task 5: Regression Verification and Review

**Files:**
- Modify: `docs/superpowers/plans/2026-07-10-render-plan-a2.md`

**Interfaces:**
- Consumes: the completed A2 implementation.
- Produces: fresh evidence that A2 preserves editor and export behavior.

- [x] **Step 1: Verify obsolete semantic scans are gone**

Run: `! rg -n "active_clips_for_window|build_render_units|plan_single_pass_video_graph|video_track_ids" src-tauri/src/ffmpeg.rs`

Expected: PASS with no matches.

- [x] **Step 2: Run all TypeScript tests**

Run: `npm run test:ts`

Expected: all TypeScript test files pass.

- [x] **Step 3: Build the frontend**

Run: `npm run build`

Expected: build succeeds; the existing large-chunk warning may remain.

- [x] **Step 4: Run all Rust tests**

Run: `cargo test --locked`

Expected: all Rust tests pass; only previously known pipeline/checkpoint dead-code warnings may remain.

- [x] **Step 5: Run backend behavior scripts**

Run: `node scripts/verify-web-fallback-coverage.mjs && node scripts/verify-proxy-generation.mjs && node scripts/verify-r32-duration.mjs`

Expected: command coverage, proxy generation, and all three duration scenarios pass.

- [x] **Step 6: Run static diff checks**

Run: `git diff --check`

Expected: PASS.

- [x] **Step 7: Review the implementation against the design**

Confirm every FFmpeg planning decision comes from RenderPlan, command execution remains in `ffmpeg.rs`, no dependency was added, no unrelated files were reverted, and all plan checkboxes accurately reflect completed work.
