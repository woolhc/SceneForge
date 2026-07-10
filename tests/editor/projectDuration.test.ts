import assert from "node:assert/strict";
import { projectOutputDuration } from "../../src/editor/projectDuration";
import type { Clip, Project, Track, TrackKind } from "../../src/types";

function track(id: string, kind: TrackKind, patch: Partial<Track> = {}): Track {
  return { id, kind, name: id, order: 0, muted: false, locked: false, ...patch };
}

function clip(id: string, trackId: string, startOnTrack: number, duration: number): Clip {
  return {
    id,
    trackId,
    startOnTrack,
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

const tracks = [
  track("video", "video"),
  track("image", "image"),
  track("audio", "audio", { muted: true }),
  track("voice", "voiceover"),
  track("subtitle", "subtitle"),
  track("hidden", "video", { hidden: true }),
];
const project = {
  tracks,
  clips: [
    clip("v", "video", 0, 5),
    clip("i", "image", 1, 6),
    clip("a", "audio", 0, 12),
    clip("voice", "voice", 3, 11),
    clip("sub", "subtitle", 10, 8),
    clip("hidden", "hidden", 0, 30),
    clip("orphan", "missing", 0, 40),
  ],
} as Project;

assert.equal(projectOutputDuration(project), 18, "all visible track kinds define timeline duration");
assert.equal(projectOutputDuration({ ...project, clips: [] }), 0);
