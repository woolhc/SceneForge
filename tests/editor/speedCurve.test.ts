import assert from "node:assert/strict";
import {
  curveTimelineDuration,
  speedAtTimelineTime,
  timelineToSourceTime,
  SPEED_PRESETS,
} from "../../src/editor/speedCurve";

const hero = SPEED_PRESETS.hero.points;
const sourceDuration = 10;

// hero: 1.5 → 0.5 → 0.5 → 1.5 over source 0..10
// timeline duration should be longer than constant 1x (slow middle)
const td = curveTimelineDuration(hero, sourceDuration);
assert.ok(td > sourceDuration, `hero timeline ${td} should exceed source ${sourceDuration}`);

// at timeline start, speed should be near 1.5
const s0 = speedAtTimelineTime(hero, sourceDuration, 0);
assert.ok(Math.abs(s0 - 1.5) < 0.1, `start speed ${s0}`);

// mid timeline should be slower
const midRel = td / 2;
const sMid = speedAtTimelineTime(hero, sourceDuration, midRel);
assert.ok(sMid < 1.0, `mid speed ${sMid} should be slow`);

// source mapping monotonic
const srcA = timelineToSourceTime(hero, sourceDuration, 0);
const srcB = timelineToSourceTime(hero, sourceDuration, midRel);
const srcC = timelineToSourceTime(hero, sourceDuration, td);
assert.ok(srcA <= srcB && srcB <= srcC + 1e-6, `source map ${srcA} ${srcB} ${srcC}`);
assert.ok(Math.abs(srcC - sourceDuration) < 0.05, `end source ${srcC}`);

// empty curve = identity
assert.equal(curveTimelineDuration([], 8), 8);
assert.equal(speedAtTimelineTime([], 8, 3), 1);
assert.equal(timelineToSourceTime([], 8, 3), 3);

console.log("speedCurve.test.ts: ok");
