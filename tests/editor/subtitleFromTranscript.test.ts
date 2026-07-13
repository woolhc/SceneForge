import assert from "node:assert/strict";
import {
  buildTranscriptSubtitleProject,
  prepareTranscriptSubtitles,
} from "../../src/editor/subtitleFromTranscript";
import type { Project, WordCue } from "../../src/types";
import { DEFAULT_RENDER_CONFIG } from "../../src/types";

const project: Project = {
  id: "p", title: "p", script: "", ratio: "9:16", fps: 30, media: [], clips: [],
  tracks: [{ id: "video", kind: "video", name: "视频", order: 0, muted: false, locked: false }],
  renderConfig: DEFAULT_RENDER_CONFIG, chapters: [], coverTime: null, previewPath: null, finalPath: null,
  createdAt: "now", updatedAt: "now",
};

const text = "人生最好的状态不是一直向前冲而是知道什么时候停下来";
const words: WordCue[] = [...text].map((character, index) => ({
  text: character,
  start: index * 0.18,
  end: (index + 1) * 0.18,
}));
const segmented = prepareTranscriptSubtitles(project, [{ start: 0, end: words.at(-1)!.end, text, words }], false);
assert.ok(segmented.length >= 2, "长句应按屏幕宽度和阅读节奏拆成多个 Cue");
assert.ok(segmented.every((item) => [...item.text].length >= 4), "不能退化成单字或碎片字幕");
assert.equal(segmented.flatMap((item) => item.words ?? []).length, words.length, "拆分后不能丢失词级时间戳");

const single = buildTranscriptSubtitleProject(project, segmented, false);
assert.equal(single.project.tracks.filter((track) => track.kind === "subtitle").length, 1);
assert.ok(single.project.clips.every((clip) => (clip.text?.split("\n").length ?? 0) <= 2));
assert.ok(single.project.clips.every((clip) => clip.subtitleStyle?.karaoke === false));
assert.ok(single.project.clips.every((clip) => (clip.subtitleStyle?.fontSize ?? 0) > 0));
assert.deepEqual(single.project.tracks.map((track) => track.order), [0, 1]);

const bilingualInput = segmented.map((item) => ({ ...item, translated: `译${item.text}` }));
const bilingual = buildTranscriptSubtitleProject(project, bilingualInput, true);
const bilingualTracks = bilingual.project.tracks.filter((track) => track.kind === "subtitle");
assert.equal(bilingualTracks.length, 2);
assert.deepEqual(bilingualTracks.map((track) => track.name), ["中文字幕", "原文字幕"]);
assert.equal(bilingual.targetClipCount, segmented.length);
assert.equal(bilingual.sourceClipCount, segmented.length);
assert.equal(bilingual.project.clips.length, segmented.length * 2);
const grouped = new Map<string, typeof bilingual.project.clips>();
for (const clip of bilingual.project.clips) {
  assert.ok(clip.subtitleGroupId);
  const group = grouped.get(clip.subtitleGroupId!) ?? [];
  group.push(clip);
  grouped.set(clip.subtitleGroupId!, group);
}
assert.equal(grouped.size, segmented.length);
assert.ok([...grouped.values()].every((clips) => clips.length === 2));
assert.ok([...grouped.values()].every((clips) => new Set(clips.map((clip) => clip.subtitleRole)).size === 2));
assert.ok(bilingual.project.clips.every((clip) => clip.subtitleStyle?.position === "custom"));
assert.deepEqual(bilingual.project.tracks.map((track) => track.order), [0, 1, 2]);
assert.ok(bilingual.project.tracks.every((track) => Number.isInteger(track.order) && track.order >= 0));

for (const clips of grouped.values()) {
  const source = clips.find((clip) => clip.subtitleRole === "source")!;
  const target = clips.find((clip) => clip.subtitleRole === "target")!;
  assert.equal(source.startOnTrack, target.startOnTrack);
  assert.equal(source.duration, target.duration);
  assert.notEqual(source.subtitleStyle?.y, target.subtitleStyle?.y);
  assert.ok(!source.text?.startsWith("译"));
  assert.ok(target.text?.startsWith("译"));
}

const aiLeadWords: WordCue[] = Array.from({ length: 20 }, (_, index) => ({
  text: String.fromCharCode(0x4e20 + index), start: index * 0.2, end: index * 0.2 + 0.18,
}));
const aiLed = prepareTranscriptSubtitles(project, [{
  start: 0, end: 4, text: aiLeadWords.map((word) => word.text).join(""), words: aiLeadWords,
}], false, {
  preferredBreakAfterIndices: new Set([4]),
  strongBreakAfterIndices: new Set([4]),
  protectedRanges: [],
});
assert.equal(aiLed[0].words?.at(-1), aiLeadWords[4], "强 AI 语义边界应主导最终分组");

const oversizedWords: WordCue[] = Array.from({ length: 36 }, (_, index) => ({
  text: String.fromCharCode(0x4e60 + index), start: index * 0.2, end: index * 0.2 + 0.18,
}));
const repaired = prepareTranscriptSubtitles(project, [{
  start: 0, end: 7.2, text: oversizedWords.map((word) => word.text).join(""), words: oversizedWords,
}], false, {
  preferredBreakAfterIndices: new Set([29]),
  strongBreakAfterIndices: new Set([29]),
  protectedRanges: [],
});
assert.ok(repaired.length >= 2, "超出硬约束的 AI 语义组必须被规则引擎局部拆分");
assert.ok(repaired.every((cue) => [...cue.text].length <= 26));

for (let count = 8; count <= 80; count += 7) {
  const propertyWords: WordCue[] = Array.from({ length: count }, (_, index) => ({
    text: String.fromCharCode(0x5100 + (index % 200)),
    start: index * 0.21 + Math.floor(index / 17) * 0.9,
    end: index * 0.21 + Math.floor(index / 17) * 0.9 + 0.18,
  }));
  const strongBreaks = new Set<number>();
  for (let index = 5; index < count - 1; index += 9) strongBreaks.add(index);
  const propertyResult = prepareTranscriptSubtitles(project, [{
    start: propertyWords[0].start,
    end: propertyWords.at(-1)!.end,
    text: propertyWords.map((word) => word.text).join(""),
    words: propertyWords,
  }], false, {
    preferredBreakAfterIndices: strongBreaks,
    strongBreakAfterIndices: strongBreaks,
    protectedRanges: [],
  });
  assert.equal(
    propertyResult.flatMap((cue) => cue.words ?? []).map((word) => word.text).join(""),
    propertyWords.map((word) => word.text).join(""),
    `AI-first 分段不得丢失、重复或重排词（count=${count}）`,
  );
}

const punctuationWords: WordCue[] = [
  { text: "words", start: 0, end: 0.35 },
  { text: ",", start: 0.35, end: 0.4 },
  { text: "but", start: 0.4, end: 0.8 },
];
const punctuationResult = prepareTranscriptSubtitles(project, [{
  start: 0, end: 0.8, text: "words,but", words: punctuationWords,
}], false);
assert.equal(punctuationResult.map((cue) => cue.text).join(""), "words, but");
