# Multi-Part Overlay A3.2 Implementation Plan

**Goal:** Compile multi-part SourceWindow plans into reusable FFmpeg filter inputs for overlay rendering.

## Tasks

- [x] Add failing filter-string tests for forward and reverse multi-part windows.
- [x] Implement `compile_multi_part_source_filter`.
- [x] Preserve single-part input-level seek optimization.
- [x] Route multi-part overlay inputs through split/trim/setpts/concat.
- [x] Remove direct source-time fallback from multi-layer rendering.
- [x] Run complete Rust, TypeScript, build and FFmpeg verification.
