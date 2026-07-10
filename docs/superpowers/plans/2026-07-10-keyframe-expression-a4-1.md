# Keyframe Expression A4.1 Implementation Plan

**Goal:** Align FFmpeg keyframe expressions with RenderGraph sampling semantics.

## Tasks

- [x] Add failing expression tests for boundary clamping and all easing modes.
- [x] Implement pure `ffmpeg_expression` compiler.
- [x] Add failing opacity time-variable and override tests.
- [x] Migrate position, scale, rotation, opacity and volume expression callers.
- [x] Remove duplicate expression builders from `ffmpeg.rs`.
- [x] Run actual FFmpeg expression smoke tests and complete verification.
