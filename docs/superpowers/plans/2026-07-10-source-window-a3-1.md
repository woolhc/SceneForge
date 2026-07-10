# SourceWindow A3.1 Implementation Plan

**Goal:** Compile timeline windows into deterministic FFmpeg source parts shared by constant-speed, reverse, negative-speed, and curve-speed exports.

**Constraints:** No new dependencies, no persisted schema changes, TDD first, existing FFmpeg execution remains intact.

## Tasks

- [x] Add failing SourceWindow mapping tests.
- [x] Expose RenderGraph curve/time helpers crate-locally.
- [x] Implement `compile_source_window` and pass mapping tests.
- [x] Add failing FFmpeg source-argument regression tests.
- [x] Migrate single-clip and curve rendering to SourceWindow parts.
- [x] Migrate one-part multi-layer inputs to SourceWindow semantics.
- [x] Delete duplicate curve segmentation from `ffmpeg.rs`.
- [x] Run complete Rust, TypeScript, build and FFmpeg verification.
