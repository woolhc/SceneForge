# Frontend Preview Parity A4.2 Implementation Plan

**Goal:** Align frontend preview layout and keyframe sampling with the Rust RenderGraph and FFmpeg semantics.

## Tasks

- [ ] Add failing unsorted-keyframe and visual-layout tests.
- [ ] Make frontend keyframe sampling sort defensively.
- [ ] Add shared visual layer box/CSS helpers.
- [ ] Fix PreviewEngine overlay double scaling.
- [ ] Apply evaluated transforms to WebCodecs base rendering.
- [ ] Convert mask rotations from degrees to radians.
- [ ] Add rotation to TypeScript/Rust golden normalization.
- [ ] Run complete frontend/backend verification.
