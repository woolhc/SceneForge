import assert from "node:assert/strict";
import {
  splitClipByTimelineTime,
  timelineToSourceTime,
} from "../../src/editor/clipTimeMap";
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
    transitionIn: { name: "fade", duration: 0.5 },
    transitionOut: { name: "wipeleft", duration: 0.5 },
    ...patch,
  };
}

assert.equal(timelineToSourceTime(clip({ duration: 5, speed: 2 }), 2.5), 5);
assert.equal(timelineToSourceTime(clip({ reverse: true }), 0), 10);
assert.equal(timelineToSourceTime(clip({ reverse: true }), 3), 7);
assert.equal(timelineToSourceTime(clip({ speed: -1 }), 3), 7);

const curved = clip({
  duration: 10,
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
const [curvedFirst, curvedSecond] = splitClipByTimelineTime(curved, 15, "clip-b")!;
assert.ok(Math.abs(curvedFirst.sourceOut - curvedSecond.sourceIn) < 1e-6);
assert.ok(Math.abs(curvedFirst.duration + curvedSecond.duration - curved.duration) < 1e-6);
assert.equal(curvedFirst.speedCurve?.[0]?.time, 0);
assert.equal(curvedFirst.speedCurve?.at(-1)?.time, 1);
assert.equal(curvedSecond.speedCurve?.[0]?.time, 0);
assert.equal(curvedSecond.speedCurve?.at(-1)?.time, 1);
assert.equal(curvedFirst.transitionOut, null, "split boundary must not inherit the original out transition");
assert.equal(curvedSecond.transitionIn, null, "split boundary must not inherit the original in transition");
assert.equal(curvedFirst.keyframes?.opacity?.at(-1)?.time, curvedFirst.duration);
assert.equal(curvedSecond.keyframes?.opacity?.[0]?.time, 0);

const reversed = clip({ reverse: true });
const [reverseFirst, reverseSecond] = splitClipByTimelineTime(reversed, 14, "clip-r")!;
assert.equal(reverseFirst.sourceIn, reverseSecond.sourceOut);
assert.equal(reverseFirst.sourceOut, reversed.sourceOut);
assert.equal(reverseSecond.sourceIn, reversed.sourceIn);
