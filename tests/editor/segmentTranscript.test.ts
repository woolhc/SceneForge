import assert from "node:assert/strict";
import { segmentTranscriptForLayout } from "../../src/editor/subtitles/segmentTranscript";
import { subtitleLayoutProfile } from "../../src/editor/subtitles/profiles";
import type { Project, WordCue } from "../../src/types";
import { DEFAULT_RENDER_CONFIG } from "../../src/types";

const project: Project = {
  id: "p", title: "p", script: "", ratio: "9:16", fps: 30, media: [], clips: [], tracks: [],
  renderConfig: DEFAULT_RENDER_CONFIG, chapters: [], coverTime: null, previewPath: null, finalPath: null,
  createdAt: "", updatedAt: "",
};

// 回归：逗号处词间隔很短（凑不够 minDuration），算法曾把下一句的连词 "but" 强行拉进当前句尾。
// 参考 Netflix/BBC 字幕规范：连词不应孤立留在上一句末尾，应引出下一句。
const words: WordCue[] = [
  { text: "I", start: 0, end: 0.15 },
  { text: "learned", start: 0.15, end: 0.4 },
  { text: "many", start: 0.4, end: 0.6 },
  { text: "new", start: 0.6, end: 0.75 },
  { text: "words,", start: 0.75, end: 0.95 },
  { text: "but", start: 0.95, end: 1.1 },
  { text: "forgot", start: 1.1, end: 1.4 },
  { text: "most", start: 1.4, end: 1.6 },
  { text: "of", start: 1.6, end: 1.7 },
  { text: "them", start: 1.7, end: 1.95 },
];
const text = words.map((w) => w.text).join(" ");
const segmented = segmentTranscriptForLayout(
  [{ start: 0, end: 1.95, text, words }],
  subtitleLayoutProfile(project, true),
);

for (const cue of segmented) {
  const lastWord = cue.words?.at(-1);
  assert.ok(
    lastWord && lastWord.text.toLowerCase() !== "but",
    `cue 不应以孤立连词 "but" 收尾：${JSON.stringify(cue.words?.map((w) => w.text))}`,
  );
}
