import assert from "node:assert/strict";
import {
  applySubtitleCuePatch,
  applySubtitleCueQuickFix,
  canMergeSubtitleCueWithNext,
  canSplitSubtitleCue,
  mergeSubtitleCueWithNext,
  splitSubtitleCueAtTime,
  subtitleDocumentFromProject,
} from "../../src/editor/subtitles/document";
import type { Project } from "../../src/types";

const project = {
  id: "project",
  title: "Project",
  script: "",
  ratio: "9:16",
  fps: 30,
  media: [],
  renderConfig: {
    fps: 30,
    preset: "preview-fast",
    resolution: "1080p",
    bitrateMbps: 0,
  },
  chapters: [],
  coverTime: null,
  previewPath: null,
  finalPath: null,
  createdAt: "",
  updatedAt: "",
  tracks: [
    {
      id: "video",
      kind: "video",
      name: "视频",
      order: 3,
      muted: false,
      locked: false,
    },
    {
      id: "sub-source",
      kind: "subtitle",
      name: "原文",
      order: 1,
      muted: false,
      locked: false,
    },
    {
      id: "sub-target",
      kind: "subtitle",
      name: "译文",
      order: 0,
      muted: false,
      locked: true,
      hidden: true,
    },
  ],
  clips: [
    {
      id: "video-1",
      trackId: "video",
      sourceId: "media",
      startOnTrack: 0,
      duration: 5,
      sourceIn: 0,
      sourceOut: 5,
      speed: 1,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      brightness: 0,
      contrast: 0,
      saturation: 0,
    },
    {
      id: "source-1",
      trackId: "sub-source",
      sourceId: null,
      startOnTrack: 1,
      duration: 1.4,
      sourceIn: 0,
      sourceOut: 1.4,
      speed: 1,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      brightness: 0,
      contrast: 0,
      saturation: 0,
      text: "Hello world",
      subtitleStyle: { position: "bottom", fontSize: 48 },
      words: [
        { text: "Hello", start: 1, end: 1.4 },
        { text: "world", start: 1.45, end: 2.2 },
      ],
      subtitleGroupId: "group-1",
      subtitleRole: "source",
      subtitleLanguage: "en",
    },
    {
      id: "target-1",
      trackId: "sub-target",
      sourceId: null,
      startOnTrack: 1,
      duration: 1.4,
      sourceIn: 0,
      sourceOut: 1.4,
      speed: 1,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      brightness: 0,
      contrast: 0,
      saturation: 0,
      text: "你好，世界",
      subtitleGroupId: "group-1",
      subtitleRole: "target",
      subtitleLanguage: "zh-CN",
    },
  ],
} as Project;

const document = subtitleDocumentFromProject(project);
assert.deepEqual(
  document.tracks.map((track) => track.id),
  ["sub-target", "sub-source"],
);
assert.deepEqual(
  document.cues.map((cue) => cue.id),
  ["target-1", "source-1"],
);
assert.equal(document.cues[0].locked, true);
assert.equal(document.cues[0].hidden, true);
assert.equal(document.cues[1].words.length, 2);
assert.equal(document.cues[1].style.fontSize, 48);
assert.equal(document.cues[1].style.position, "bottom");
assert.equal(
  project.clips[1].subtitleStyle?.x,
  undefined,
  "adapter must not mutate persisted clips",
);

const patched = applySubtitleCuePatch(project, "source-1", {
  start: -1,
  end: -0.5,
  text: "Edited",
  style: { position: "custom", x: 25, y: 70 },
  groupId: null,
});
const patchedCue = patched.clips.find((clip) => clip.id === "source-1")!;
assert.equal(patchedCue.startOnTrack, 0);
assert.equal(patchedCue.duration, 0.2);
assert.equal(patchedCue.text, "Edited");
assert.equal(patchedCue.subtitleStyle?.position, "custom");
assert.equal(patchedCue.subtitleStyle?.x, 25);
assert.equal(
  patchedCue.subtitleGroupId,
  null,
  "explicit null must clear optional metadata",
);
assert.equal(project.clips[1].text, "Hello world", "patch must be immutable");

assert.equal(
  applySubtitleCuePatch(project, "target-1", { text: "不能改" }),
  project,
  "locked tracks must reject workbench edits",
);
assert.equal(
  applySubtitleCuePatch(project, "video-1", { text: "不能改" }),
  project,
  "non-subtitle clips must reject workbench edits",
);

const splitProject = {
  ...project,
  tracks: [
    {
      id: "subtitle",
      kind: "subtitle",
      name: "字幕",
      order: 0,
      muted: false,
      locked: false,
    },
  ],
  clips: [
    {
      ...project.clips[1],
      id: "split-1",
      trackId: "subtitle",
      startOnTrack: 1,
      duration: 2,
      sourceOut: 2,
      text: "Hello world again",
      words: [
        { text: "Hello", start: 1, end: 1.4 },
        { text: "world", start: 1.5, end: 1.9 },
        { text: "again", start: 2, end: 2.5 },
      ],
      subtitleGroupId: null,
    },
    {
      ...project.clips[1],
      id: "split-2",
      trackId: "subtitle",
      startOnTrack: 3.1,
      duration: 0.8,
      sourceOut: 0.8,
      text: "Final cue",
      words: [
        { text: "Final", start: 3.1, end: 3.4 },
        { text: "cue", start: 3.45, end: 3.9 },
      ],
      subtitleGroupId: null,
    },
  ],
} as Project;
assert.equal(canSplitSubtitleCue(splitProject, "split-1", 1.55), true);
const split = splitSubtitleCueAtTime(splitProject, "split-1", 1.55)!;
const splitCues = split.clips.filter((clip) => clip.trackId === "subtitle");
assert.equal(splitCues.length, 3);
assert.equal(splitCues[0].text, "Hello");
assert.equal(splitCues[1].text, "world again");
assert.equal(
  splitCues[0].startOnTrack + splitCues[0].duration,
  splitCues[1].startOnTrack,
);
assert.equal(splitCues[0].words?.length, 1);
assert.equal(splitCues[1].words?.length, 2);

assert.equal(canMergeSubtitleCueWithNext(splitProject, "split-1"), true);
const merged = mergeSubtitleCueWithNext(splitProject, "split-1")!;
const mergedCue = merged.clips.find((clip) => clip.id === "split-1")!;
assert.equal(mergedCue.text, "Hello world again Final cue");
assert.ok(Math.abs(mergedCue.duration - 2.9) < 1e-9);
assert.equal(mergedCue.words?.length, 5);

const grouped = {
  ...splitProject,
  clips: splitProject.clips.map((clip) => ({
    ...clip,
    subtitleGroupId: "pair",
  })),
};
assert.equal(canSplitSubtitleCue(grouped, "split-1", 1.55), false);
assert.equal(splitSubtitleCueAtTime(grouped, "split-1", 1.55), null);
assert.equal(canMergeSubtitleCueWithNext(grouped, "split-1"), false);

const qualityProject = {
  ...splitProject,
  ratio: "9:16",
  clips: [
    {
      ...splitProject.clips[0],
      id: "quality-fix",
      text: "第一行\n短",
      startOnTrack: 0,
      duration: 1,
      subtitleStyle: { position: "bottom", fontSize: 48 },
      words: null,
    },
  ],
};
const movedSafe = applySubtitleCueQuickFix(
  qualityProject,
  "quality-fix",
  "unsafe_region",
)!;
assert.equal(movedSafe.clips[0].subtitleStyle?.y, 70);
const narrowed = applySubtitleCueQuickFix(
  qualityProject,
  "quality-fix",
  "too_wide",
)!;
assert.equal(narrowed.clips[0].subtitleStyle?.fontSize, 43);
const joined = applySubtitleCueQuickFix(
  qualityProject,
  "quality-fix",
  "orphan_line",
)!;
assert.equal(joined.clips[0].text, "第一行短");
assert.equal(
  applySubtitleCueQuickFix(
    qualityProject,
    "quality-fix",
    "reading_speed_too_fast",
  ),
  null,
);
