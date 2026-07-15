import assert from "node:assert/strict";
import { inspectProjectSubtitleQuality } from "../../src/editor/subtitles/quality";
import type { Project } from "../../src/types";

const project = {
  id: "quality",
  title: "quality",
  script: "",
  ratio: "9:16",
  fps: 30,
  media: [],
  renderConfig: {
    fps: 30,
    preset: "preview-fast",
    resolution: "1080p",
    bitrateMbps: 0,
  },
  chapters: [],
  coverTime: null,
  previewPath: null,
  finalPath: null,
  createdAt: "",
  updatedAt: "",
  tracks: [
    {
      id: "subtitle",
      kind: "subtitle",
      name: "字幕",
      order: 0,
      muted: false,
      locked: false,
    },
  ],
  clips: [
    {
      id: "cue",
      trackId: "subtitle",
      sourceId: null,
      startOnTrack: 0,
      duration: 0.4,
      sourceIn: 0,
      sourceOut: 0.4,
      speed: 1,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      brightness: 0,
      contrast: 0,
      saturation: 0,
      text: "这是一个非常非常非常长的字幕文本\n短",
      subtitleStyle: { position: "bottom", fontSize: 48 },
    },
  ],
} as Project;

const issues = inspectProjectSubtitleQuality(project);
assert.ok(issues.some((issue) => issue.type === "duration_too_short"));
assert.ok(issues.some((issue) => issue.type === "reading_speed_too_fast"));
assert.ok(issues.some((issue) => issue.type === "orphan_line"));
assert.ok(issues.every((issue) => issue.cueId === "cue"));
