import assert from "node:assert/strict";
import { computeDraggedClip, type DragState } from "../../src/timeline/clipInteraction";
import type { Clip } from "../../src/types";

function clip(patch: Partial<Clip> = {}): Clip {
  return {
    id: "clip-a",
    trackId: "video",
    sourceId: "media",
    startOnTrack: 10,
    duration: 10,
    sourceIn: 0,
    sourceOut: 10,
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    transitionIn: null,
    transitionOut: null,
    ...patch,
  };
}

function drag(initial: Clip, handle: "left" | "right"): DragState {
  return {
    clipId: initial.id,
    handle,
    startX: 0,
    initial,
    peers: [],
  };
}

const curved = clip({
  speedCurve: [
    { time: 0, speed: 0.5 },
    { time: 0.5, speed: 2 },
    { time: 1, speed: 1 },
  ],
  keyframes: {
    opacity: [
      { time: 0, value: 0, easing: "linear" },
      { time: 10, value: 100, easing: "linear" },
    ],
  },
});
const rightTrim = computeDraggedClip(drag(curved, "right"), -5);
assert.equal(rightTrim.duration, 5);
assert.ok((rightTrim.sourceOut ?? 0) < curved.sourceOut);
assert.equal(rightTrim.speedCurve?.[0]?.time, 0);
assert.equal(rightTrim.speedCurve?.at(-1)?.time, 1);
assert.equal(rightTrim.keyframes?.opacity?.at(-1)?.time, 5);

const reversed = clip({ reverse: true });
const leftTrim = computeDraggedClip(drag(reversed, "left"), 4);
assert.equal(leftTrim.startOnTrack, 14);
assert.equal(leftTrim.duration, 6);
assert.equal(leftTrim.sourceIn, 0);
assert.equal(leftTrim.sourceOut, 6);
