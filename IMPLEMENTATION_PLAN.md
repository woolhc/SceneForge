# SceneForge Implementation Plan

## Goal

Build the independent Tauri desktop rewrite into a usable AI video workflow without changing the existing `backend/` or `frontend/` app.

## Milestones

1. DeepSeek segmentation
   - Read the script from the editor.
   - Call DeepSeek from Rust using the locally saved settings.
   - Return editable project segments with title, text, suggested visual query, style, and estimated duration.
   - Save generated segments into the current project.

2. TTS and voice profiles
   - Manage cloned voice profiles in local SQLite.
   - Upload sample audio, name the voice, synthesize a test line, and play it back.
   - Generate and cache per-segment narration audio.

3. Pexels material workflow
   - Search Pexels by AI-generated visual query and selected style.
   - Prefer vertical videos for 9:16 projects.
   - Preview, select, download, and cache assets per segment.

4. Timeline trim workflow
   - Show selected video frames while dragging trim points.
   - Save trim start, trim end, and speed per segment.
   - Fit video duration to narration duration by trim or speed.

5. FFmpeg preview/export
   - Render segment clips with narration, crop, scale, subtitles, and short audio fades.
   - Generate low-resolution preview quickly.
   - Generate final export with configurable resolution, frame rate, and bitrate.

## Current First Slice

Implement milestone 1 only: DeepSeek segmentation end to end.

## Acceptance Criteria For First Slice

- Settings still save DeepSeek key locally.
- Clicking AI segmentation calls a Rust Tauri command in desktop mode.
- Missing key shows a clear UI status message.
- Successful response replaces project segments and saves the project.
- Web preview fallback still works without Tauri.
- `npm run build` and `cargo check` pass.
