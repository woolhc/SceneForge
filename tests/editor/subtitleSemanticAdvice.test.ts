import assert from "node:assert/strict";
import { requestSubtitleSemanticAdvice } from "../../src/editor/subtitles/semanticAdvice";
import { segmentTranscriptForLayout } from "../../src/editor/subtitles/segmentTranscript";
import { subtitleLayoutProfile } from "../../src/editor/subtitles/profiles";
import type { Project, WordCue } from "../../src/types";
import { DEFAULT_RENDER_CONFIG } from "../../src/types";

const words: WordCue[] = Array.from({ length: 20 }, (_, index) => ({
  text: String.fromCharCode(0x4e00 + index), start: index * 0.2, end: (index + 1) * 0.2,
}));
const advice = await requestSubtitleSemanticAdvice(words, async () => ({
  preferredBreakAfterIndices: [7, 999, -1, 7],
  protectedRanges: [
    { startWordIndex: 2, endWordIndex: 4 },
    { startWordIndex: 9, endWordIndex: 999 },
  ],
  confidence: 1.4,
}));
assert.deepEqual([...advice.preferredBreakAfterIndices], [7]);
assert.deepEqual(advice.protectedRanges, [{ startWordIndex: 2, endWordIndex: 4 }]);
assert.equal(advice.confidence, 1);

const failed = await requestSubtitleSemanticAdvice(words, async () => { throw new Error("offline"); });
assert.equal(failed.successfulChunkCount, 0);
assert.equal(failed.failedChunkCount, 1);
assert.deepEqual(failed.failureCategories, ["unknown"]);
assert.equal(failed.preferredBreakAfterIndices.size, 0);

const project: Project = {
  id: "p", title: "p", script: "", ratio: "9:16", fps: 30, media: [], clips: [], tracks: [],
  renderConfig: DEFAULT_RENDER_CONFIG, chapters: [], coverTime: null, previewPath: null, finalPath: null,
  createdAt: "", updatedAt: "",
};
const text = words.map((word) => word.text).join("");
const segmented = segmentTranscriptForLayout(
  [{ start: 0, end: 4, text, words }],
  subtitleLayoutProfile(project),
  advice,
);
assert.equal(segmented[0].words?.at(-1), words[7], "AI 推荐断点应参与动态规划评分");

const lowConfidence = await requestSubtitleSemanticAdvice(words, async () => ({
  preferredBreakAfterIndices: [7], protectedRanges: [], confidence: 0.2,
}));
assert.equal(lowConfidence.successfulChunkCount, 1);
assert.equal(lowConfidence.preferredBreakAfterIndices.size, 0, "低置信度 AI 建议不得影响规则引擎");

const strongAdvice = await requestSubtitleSemanticAdvice(words, async () => ({
  preferredBreakAfterIndices: [4], protectedRanges: [], confidence: 0.91,
}));
assert.deepEqual([...strongAdvice.strongBreakAfterIndices], [4], "高置信度 AI 断点应升级为强语义边界");

const mediumAdvice = await requestSubtitleSemanticAdvice(words, async () => ({
  preferredBreakAfterIndices: [4], protectedRanges: [], confidence: 0.7,
}));
assert.equal(mediumAdvice.preferredBreakAfterIndices.has(4), true);
assert.equal(mediumAdvice.strongBreakAfterIndices.size, 0, "中等置信度只作为软建议");

const longWords: WordCue[] = Array.from({ length: 260 }, (_, index) => ({
  text: `词${index}`, start: index * 0.22, end: index * 0.22 + 0.18,
}));
const requestedWindows: WordCue[][] = [];
const overlapped = await requestSubtitleSemanticAdvice(longWords, async (windowWords) => {
  requestedWindows.push(windowWords);
  return {
    preferredBreakAfterIndices: requestedWindows.length === 2 ? [20] : [],
    protectedRanges: [],
    confidence: 0.9,
  };
}, 120, 16);
assert.equal(requestedWindows.length, 3);
assert.ok(requestedWindows[1][0].text !== longWords[120].text, "后续 AI 批次应携带前文重叠上下文");
assert.deepEqual([...overlapped.strongBreakAfterIndices], [124], "重叠窗口的局部 index 必须映射到准确全局 index");

const protectedWords: WordCue[] = Array.from({ length: 14 }, (_, index) => ({
  text: String.fromCharCode(0x4f00 + index), start: index * 0.25, end: index * 0.25 + 0.2,
}));
const protectedSegmented = segmentTranscriptForLayout(
  [{ start: 0, end: 3.5, text: protectedWords.map((word) => word.text).join(""), words: protectedWords }],
  subtitleLayoutProfile(project),
  {
    preferredBreakAfterIndices: new Set([4, 5]),
    strongBreakAfterIndices: new Set([4, 5]),
    protectedRanges: [{ startWordIndex: 3, endWordIndex: 7 }],
  },
);
const protectedCueEnds = protectedSegmented.map((cue) => protectedWords.indexOf(cue.words!.at(-1)!));
assert.ok(protectedCueEnds.every((index) => index < 3 || index >= 7), "AI 不得拆开受保护短语");

const gapWords: WordCue[] = Array.from({ length: 12 }, (_, index) => {
  const shifted = index >= 5 ? 1 : 0;
  return { text: String.fromCharCode(0x5000 + index), start: index * 0.25 + shifted, end: index * 0.25 + shifted + 0.2 };
});
const gapSegmented = segmentTranscriptForLayout(
  [{ start: 0, end: 4, text: gapWords.map((word) => word.text).join(""), words: gapWords }],
  subtitleLayoutProfile(project),
  {
    preferredBreakAfterIndices: new Set([8]),
    strongBreakAfterIndices: new Set([8]),
    protectedRanges: [],
  },
);
assert.equal(gapSegmented[0].words?.at(-1), gapWords[4], "明显静音间隔必须覆盖 AI 的跨停顿分组");
