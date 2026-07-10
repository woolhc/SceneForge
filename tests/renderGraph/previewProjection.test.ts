import assert from "node:assert/strict";
import { compileRenderGraph } from "../../src/renderGraph/compileRenderGraph";
import { evaluateFrame } from "../../src/renderGraph/evaluateFrame";
import { projectFrameToEngineState } from "../../src/renderGraph/projectFrameToEngineState";
import type { Project } from "../../src/types";

const project = {
  id: "projection",
  title: "projection",
  script: "",
  ratio: "16:9",
  fps: 30,
  media: [{ id: "media", kind: "video", title: "media", width: 1920, height: 1080, duration: 10, source: "local" }],
  tracks: [
    { id: "base-track", kind: "video", name: "base", order: 10, muted: false, locked: false },
    { id: "overlay-track", kind: "image", name: "overlay", order: 5, muted: false, locked: false },
    { id: "subtitle-low", kind: "subtitle", name: "low", order: 4, muted: false, locked: false },
    { id: "subtitle-top", kind: "subtitle", name: "top", order: 1, muted: false, locked: false }
  ],
  clips: [
    { id: "base", trackId: "base-track", sourceId: "media", startOnTrack: 0, duration: 5, sourceIn: 0, sourceOut: 5, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, brightness: 0, contrast: 0, saturation: 0 },
    { id: "overlay", trackId: "overlay-track", sourceId: "media", startOnTrack: 0, duration: 5, sourceIn: 0, sourceOut: 5, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, brightness: 0, contrast: 0, saturation: 0 },
    { id: "subtitle-low-clip", trackId: "subtitle-low", sourceId: null, startOnTrack: 0, duration: 5, sourceIn: 0, sourceOut: 5, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, brightness: 0, contrast: 0, saturation: 0, text: "low" },
    { id: "subtitle-top-clip", trackId: "subtitle-top", sourceId: null, startOnTrack: 0, duration: 5, sourceIn: 0, sourceOut: 5, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, brightness: 0, contrast: 0, saturation: 0, text: "top" }
  ],
  renderConfig: { fps: 30, preset: "preview-fast", resolution: "1080p", bitrateMbps: 0 },
  createdAt: "",
  updatedAt: ""
} as Project;

const state = projectFrameToEngineState(evaluateFrame(compileRenderGraph(project), 3));
assert.equal(state.activeVideoClip?.id, "base");
assert.deepEqual(state.activeOverlayClips.map((clip) => clip.id), ["overlay"]);
assert.deepEqual(
  state.activeSubtitleClips.map((clip) => clip.id),
  ["subtitle-top-clip", "subtitle-low-clip"],
  "subtitle projection keeps top tracks first for the React overlay",
);
