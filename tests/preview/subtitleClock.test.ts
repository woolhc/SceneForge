import assert from "node:assert/strict";
import { quantizeSubtitleClock, subtitleNeedsLiveClock } from "../../src/preview/subtitleClock";
import type { Clip } from "../../src/types";

const clip = {
  id: "s", trackId: "t", sourceId: null, startOnTrack: 0, duration: 2, sourceIn: 0, sourceOut: 2,
  speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, brightness: 0, contrast: 0, saturation: 0,
  text: "静态字幕", subtitleStyle: { karaoke: false, animationOut: "none" }, words: null,
} as Clip;
assert.equal(subtitleNeedsLiveClock(clip), false);
assert.equal(subtitleNeedsLiveClock({ ...clip, words: [{ text: "字", start: 0, end: 0.2 }], subtitleStyle: { karaoke: true } }), true);
assert.equal(subtitleNeedsLiveClock({ ...clip, subtitleStyle: { karaoke: false, animationOut: "fade" } }), true);
assert.equal(quantizeSubtitleClock(1.234, 20), 1.2);
assert.equal(quantizeSubtitleClock(1.249, 20), 1.2);
assert.equal(quantizeSubtitleClock(1.251, 20), 1.25);
