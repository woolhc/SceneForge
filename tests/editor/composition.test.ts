import assert from "node:assert/strict";
import {
  applyComposition,
  COMP_BG_CLIP_PREFIX,
  COMP_BG_TRACK_ID,
  COMP_SUBTITLE_ID,
  COMP_SUBTITLE_TRACK_ID,
  COMP_TITLE_ID,
  COMP_TITLE_TRACK_ID,
  compositionMediaRatio,
  extractTitlesFromScript,
  getCompositionTemplate,
  regionToTransform,
  resolveVisualBox,
} from "../../src/editor/composition";
import type { Clip, Project, Track } from "../../src/types";
import { DEFAULT_RENDER_CONFIG, DEFAULT_SUBTITLE_STYLE, DEFAULT_TRANSFORM } from "../../src/types";
import { previewCssFilter } from "../../src/preview/previewFilters";

function makeProject(overrides: Partial<Project> = {}): Project {
  const videoTrack: Track = {
    id: "track_video",
    kind: "video",
    name: "视频",
    order: 0,
    muted: false,
    locked: false,
  };
  const subtitleTrack: Track = {
    id: "track_sub",
    kind: "subtitle",
    name: "字幕",
    order: 1,
    muted: false,
    locked: false,
  };
  const videoClip: Clip = {
    id: "clip_v1",
    trackId: videoTrack.id,
    sourceId: "media1",
    startOnTrack: 0,
    duration: 8,
    sourceIn: 0,
    sourceOut: 8,
    speed: 1,
    volume: 0,
    fadeIn: 0,
    fadeOut: 0,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    text: null,
    subtitleStyle: null,
    transform: { ...DEFAULT_TRANSFORM },
    transitionIn: null,
    transitionOut: null,
  };
  const subPrimary: Clip = {
    ...videoClip,
    id: "clip_sub_en",
    trackId: subtitleTrack.id,
    sourceId: null,
    duration: 2,
    sourceOut: 2,
    text: "Hello world",
    subtitleRole: "target",
    subtitleGroupId: "g1",
    subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE, y: 70 },
    transform: null,
  };
  const subSecondary: Clip = {
    ...subPrimary,
    id: "clip_sub_zh",
    text: "你好世界",
    subtitleRole: "source",
    subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE, y: 78 },
  };

  return {
    id: "p1",
    title: "test",
    script: "今天学习三个英语表达。第一个是 hold on。",
    ratio: "9:16",
    fps: 30,
    media: [],
    tracks: [videoTrack, subtitleTrack],
    clips: [videoClip, subPrimary, subSecondary],
    renderConfig: { ...DEFAULT_RENDER_CONFIG },
    chapters: [],
    coverTime: null,
    previewPath: null,
    finalPath: null,
    createdAt: "now",
    updatedAt: "now",
    ...overrides,
  };
}

// resolveVisualBox：旧 scale 兼容
assert.deepEqual(resolveVisualBox({ scale: 40 }), {
  x: 50,
  y: 50,
  width: 40,
  height: 40,
  fit: "cover",
  rotation: 0,
  opacity: 100,
});

// resolveVisualBox：独立 width/height + contain
assert.deepEqual(
  resolveVisualBox({ x: 50, y: 40, scale: 100, width: 100, height: 36, fit: "contain", opacity: 100 }),
  {
    x: 50,
    y: 40,
    width: 100,
    height: 36,
    fit: "contain",
    rotation: 0,
    opacity: 100,
  },
);

// regionToTransform：左上矩形 → 中心锚点
const mediaTf = regionToTransform({
  role: "media",
  x: 0,
  y: 22,
  width: 100,
  height: 36,
  zIndex: 2,
  fit: "cover",
});
assert.equal(mediaTf.x, 50);
assert.equal(mediaTf.y, 40);
assert.equal(mediaTf.width, 100);
assert.equal(mediaTf.height, 36);
assert.equal(mediaTf.fit, "cover");

// 知识卡片主画面素材比例是 16:9，不是画布 9:16
assert.equal(compositionMediaRatio("knowledge-card", "9:16"), "16:9");
assert.equal(compositionMediaRatio("standard-fill", "9:16"), "9:16");

// 启发式标题
const titles = extractTitlesFromScript("坚持练习每一天。英语会越来越好。");
assert.ok((titles.mainTitle?.length ?? 0) > 0);
assert.ok((titles.mainTitle?.length ?? 0) <= 12);
assert.ok((titles.subTitle?.length ?? 0) > 0);

// applyComposition knowledge-card
const knowledge = getCompositionTemplate("knowledge-card");
const applied = applyComposition(makeProject(), knowledge, {
  mainTitle: "Hold On",
  subTitle: "稍等一下",
});
assert.equal(applied.composition?.templateId, "knowledge-card");
assert.equal(applied.composition?.content.mainTitle, "Hold On");
assert.equal(applied.ratio, "9:16");

const video = applied.clips.find((clip) => clip.id === "clip_v1");
assert.ok(video?.transform);
assert.equal(video?.transform?.width, 100);
assert.equal(video?.transform?.height, 36);
assert.equal(video?.transform?.fit, "cover");
assert.equal(video?.transform?.y, 40);

// 动态模糊背景：克隆主视频到背景轨，全画布 cover + blur + 压暗
const bgTrack = applied.tracks.find((track) => track.id === COMP_BG_TRACK_ID);
assert.equal(bgTrack?.kind, "video");
assert.equal(bgTrack?.muted, true);
assert.ok((bgTrack?.order ?? -1) > (applied.tracks.find((t) => t.id === "track_video")?.order ?? 0));

const bgClip = applied.clips.find((clip) => clip.id === `${COMP_BG_CLIP_PREFIX}clip_v1`);
assert.ok(bgClip);
assert.equal(bgClip?.trackId, COMP_BG_TRACK_ID);
assert.equal(bgClip?.sourceId, "media1");
assert.equal(bgClip?.volume, 0);
assert.equal(bgClip?.transform?.width, 100);
assert.equal(bgClip?.transform?.height, 100);
assert.equal(bgClip?.transform?.fit, "cover");
assert.ok((bgClip?.brightness ?? 0) < 0);
assert.ok(bgClip?.visualEffects?.some((effect) => effect.kind === "blur"));
assert.equal(bgClip?.startOnTrack, video?.startOnTrack);
assert.equal(bgClip?.duration, video?.duration);

// 预览 CSS 应包含 blur
const css = previewCssFilter(bgClip ?? null);
assert.match(css, /blur\(/);
assert.match(css, /brightness\(/);

// 主/副标题各一条独立文字轨，可在时间线点选编辑
const titleTrack = applied.tracks.find((track) => track.id === COMP_TITLE_TRACK_ID);
const subTitleTrack = applied.tracks.find((track) => track.id === COMP_SUBTITLE_TRACK_ID);
assert.equal(titleTrack?.kind, "text");
assert.equal(titleTrack?.name, "主标题");
assert.equal(subTitleTrack?.kind, "text");
assert.equal(subTitleTrack?.name, "副标题");
assert.notEqual(titleTrack?.id, subTitleTrack?.id);

const titleClip = applied.clips.find((clip) => clip.id === COMP_TITLE_ID);
const subTitleClip = applied.clips.find((clip) => clip.id === COMP_SUBTITLE_ID);
assert.equal(titleClip?.text, "Hold On");
assert.equal(titleClip?.trackId, COMP_TITLE_TRACK_ID);
assert.equal(subTitleClip?.text, "稍等一下");
assert.equal(subTitleClip?.trackId, COMP_SUBTITLE_TRACK_ID);
assert.ok((titleClip?.duration ?? 0) >= 8);

const en = applied.clips.find((clip) => clip.id === "clip_sub_en");
const zh = applied.clips.find((clip) => clip.id === "clip_sub_zh");
assert.equal(en?.subtitleStyle?.position, "custom");
assert.ok((en?.subtitleStyle?.y ?? 0) >= 74);
assert.ok((zh?.subtitleStyle?.y ?? 0) >= 84);

// 幂等：再次应用不叠加标题层 / 背景 / 轨道
const reapplied = applyComposition(applied, knowledge, {
  mainTitle: "Hold On",
  subTitle: "稍等一下",
});
assert.equal(reapplied.clips.filter((clip) => clip.id === COMP_TITLE_ID).length, 1);
assert.equal(reapplied.clips.filter((clip) => clip.id === COMP_SUBTITLE_ID).length, 1);
assert.equal(reapplied.clips.filter((clip) => clip.id.startsWith(COMP_BG_CLIP_PREFIX)).length, 1);
assert.equal(reapplied.tracks.filter((track) => track.id === COMP_TITLE_TRACK_ID).length, 1);
assert.equal(reapplied.tracks.filter((track) => track.id === COMP_BG_TRACK_ID).length, 1);

// 重套时保留用户改过的标题文案（未传 content 时）
const userEdited = {
  ...applied,
  clips: applied.clips.map((clip) =>
    clip.id === COMP_TITLE_ID ? { ...clip, text: "用户改的标题" } : clip,
  ),
};
const preserved = applyComposition(userEdited, knowledge, {});
assert.equal(preserved.clips.find((clip) => clip.id === COMP_TITLE_ID)?.text, "用户改的标题");
// 背景仍在
assert.ok(preserved.clips.some((clip) => clip.id.startsWith(COMP_BG_CLIP_PREFIX)));

// standard-fill：清掉 composition 标题/背景轨/clip 并恢复 cover 全屏
const standard = applyComposition(reapplied, getCompositionTemplate("standard-fill"));
assert.equal(standard.composition?.templateId, "standard-fill");
assert.equal(standard.clips.some((clip) => clip.id === COMP_TITLE_ID), false);
assert.equal(standard.tracks.some((track) => track.id === COMP_TITLE_TRACK_ID), false);
assert.equal(standard.clips.some((clip) => clip.id.startsWith(COMP_BG_CLIP_PREFIX)), false);
assert.equal(standard.tracks.some((track) => track.id === COMP_BG_TRACK_ID), false);
const restored = standard.clips.find((clip) => clip.id === "clip_v1");
assert.equal(restored?.transform?.fit, "cover");
assert.equal(restored?.transform?.width, 100);
assert.equal(restored?.transform?.height, 100);

console.log("composition.test.ts: all assertions passed");
