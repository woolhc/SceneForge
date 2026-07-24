import assert from "node:assert/strict";
import { selectClipIds, selectClipIdsByBox } from "../../src/editor/clipOperations";
import type { Clip, Project, Track } from "../../src/types";

function track(id: string, order: number): Track {
  return { id, kind: "video", name: id, order, muted: false, locked: false, hidden: false, height: 48 };
}

function clip(id: string, trackId: string, start: number, duration = 2): Clip {
  return {
    id,
    trackId,
    sourceId: "m1",
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

const project: Project = {
  id: "p1",
  title: "t",
  script: "",
  ratio: "9:16",
  fps: 30,
  media: [],
  tracks: [track("v1", 0), track("v2", 1)],
  clips: [
    clip("a", "v1", 0),
    clip("b", "v1", 2),
    clip("c", "v1", 4),
    clip("x", "v2", 1),
  ],
  renderConfig: { resolution: "1080p", fps: 30, bitrateMbps: 8, codec: "h264", transitionDuration: 0.5 } as any,
  createdAt: "",
  updatedAt: "",
};

// plain select
assert.deepEqual(selectClipIds(project, [], "b", false, false), ["b"]);
// additive toggle
assert.deepEqual(selectClipIds(project, ["a"], "b", true, false), ["a", "b"]);
assert.deepEqual(selectClipIds(project, ["a", "b"], "b", true, false), ["a"]);
// Shift range on same track (anchor = first selected)
assert.deepEqual(selectClipIds(project, ["a"], "c", false, true), ["a", "b", "c"]);
// range reverse order
assert.deepEqual(selectClipIds(project, ["c"], "a", false, true), ["a", "b", "c"]);
// range across tracks falls back to single
assert.deepEqual(selectClipIds(project, ["a"], "x", false, true), ["x"]);
// box select replace
assert.deepEqual(selectClipIdsByBox(["a"], ["b", "c"], false), ["b", "c"]);
// box select additive
assert.deepEqual(selectClipIdsByBox(["a"], ["b", "c"], true).sort(), ["a", "b", "c"]);

console.log("clipOperations.select.test.ts: ok");
