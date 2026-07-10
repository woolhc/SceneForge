import assert from "node:assert/strict";
import { compileRenderGraph } from "../../src/renderGraph/compileRenderGraph";
import type { Clip, MediaSource, Project, Track, TrackKind } from "../../src/types";

function track(id: string, kind: TrackKind, order: number, hidden = false): Track {
  return { id, kind, name: id, order, muted: false, locked: false, hidden };
}

function media(id: string, kind: MediaSource["kind"]): MediaSource {
  return {
    id,
    kind,
    title: id,
    width: 1920,
    height: 1080,
    duration: 20,
    source: "local",
  };
}

function clip(id: string, trackId: string, sourceId: string | null, start: number, duration: number): Clip {
  return {
    id,
    trackId,
    sourceId,
    startOnTrack: start,
    duration,
    sourceIn: 0,
    sourceOut: duration,
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    brightness: 0,
    contrast: 0,
    saturation: 0,
  };
}

const project = {
  id: "project",
  title: "RenderGraph",
  script: "",
  ratio: "16:9",
  fps: 30,
  media: [media("video-source", "video"), media("audio-source", "audio")],
  tracks: [
    track("base-track", "video", 10),
    track("overlay-track", "image", 5),
    track("audio-track", "audio", 3),
    track("subtitle-track", "subtitle", 1),
    track("hidden-track", "video", 20, true),
  ],
  clips: [
    clip("subtitle", "subtitle-track", null, 8, 4),
    clip("audio", "audio-track", "audio-source", 0, 11),
    clip("overlay", "overlay-track", "video-source", 1, 4),
    clip("base", "base-track", "video-source", 0, 5),
    clip("hidden", "hidden-track", "video-source", 0, 20),
    clip("orphan", "missing-track", "video-source", 0, 30),
  ],
  renderConfig: { fps: 30, preset: "preview-fast", resolution: "1080p", bitrateMbps: 0 },
  createdAt: "",
  updatedAt: "",
} satisfies Project;

const graph = compileRenderGraph(project);
assert.deepEqual(graph.canvas, { width: 1920, height: 1080 });
assert.equal(graph.duration, 12);
assert.deepEqual(graph.layers.map((layer) => layer.id), ["base", "overlay", "audio", "subtitle"]);
assert.equal(graph.layers.some((layer) => layer.id === "hidden"), false);
assert.equal(graph.layers.some((layer) => layer.id === "orphan"), false);

project.clips[3].duration = 99;
assert.equal(graph.layers[0].clip.duration, 5, "compiled graph owns an immutable snapshot");
