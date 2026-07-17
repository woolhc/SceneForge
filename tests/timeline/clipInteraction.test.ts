import assert from "node:assert/strict";
import {
  computeDraggedClip,
  computeTrackAtY,
  hasExceededPointerDragThreshold,
  isClipTrackCompatible,
  resolveCrossTrackDrop,
  shouldStartTimelinePan,
  type DragHandle,
  type DragState,
  type TrackLayoutEntry,
} from "../../src/timeline/clipInteraction";
import type { Clip, MediaSource, Track } from "../../src/types";

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

function drag(initial: Clip, handle: DragHandle, peers: Clip[] = [], playhead?: number): DragState {
  return {
    clipId: initial.id,
    handle,
    startX: 0,
    initial,
    peers,
    playhead,
    sourceTrackId: initial.trackId,
    currentTrackId: initial.trackId,
    crossTrackEnabled: handle === "body",
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
const rightTrim = computeDraggedClip(drag(curved, "right"), -5).patch;
assert.equal(rightTrim.duration, 5);
assert.ok((rightTrim.sourceOut ?? 0) < curved.sourceOut);
assert.equal(rightTrim.speedCurve?.[0]?.time, 0);
assert.equal(rightTrim.speedCurve?.at(-1)?.time, 1);
assert.equal(rightTrim.keyframes?.opacity?.at(-1)?.time, 5);

const reversed = clip({ reverse: true });
const leftTrim = computeDraggedClip(drag(reversed, "left"), 4).patch;
assert.equal(leftTrim.startOnTrack, 14);
assert.equal(leftTrim.duration, 6);
assert.equal(leftTrim.sourceIn, 0);
assert.equal(leftTrim.sourceOut, 6);

assert.equal(hasExceededPointerDragThreshold(100, 104), false, "4px 手抖不应触发拖拽");
assert.equal(hasExceededPointerDragThreshold(100, 105), true, "达到 5px 后才正式拖拽");
assert.equal(shouldStartTimelinePan(0, false), false, "普通左键拖动不应误触时间轴平移");
assert.equal(shouldStartTimelinePan(1, false), true, "中键可平移时间轴");
assert.equal(shouldStartTimelinePan(0, true), true, "Alt+左键可平移时间轴");

// ---- 吸附命中：computeDraggedClip 返回的 snapLine ----
const peerClip = clip({ id: "peer", startOnTrack: 20, duration: 5 });
const nearPeerEnd = computeDraggedClip(drag(clip({ startOnTrack: 10 }), "body", [peerClip]), 15);
assert.equal(nearPeerEnd.snapLine, 25, "拖到 peer 结束边缘附近应吸附并报告吸附线");
const farFromAnySnap = computeDraggedClip(drag(clip({ startOnTrack: 10 }), "body", [peerClip]), 3);
assert.equal(farFromAnySnap.snapLine, null, "远离所有吸附点时不应命中吸附线");

// ---- isClipTrackCompatible ----
function mediaSource(patch: Partial<MediaSource> = {}): MediaSource {
  return {
    id: "media",
    kind: "video",
    title: "素材",
    width: 1080,
    height: 1920,
    duration: 10,
    source: "local",
    ...patch,
  };
}
function track(patch: Partial<Track> = {}): Track {
  return {
    id: "track-1",
    kind: "video",
    name: "轨道",
    order: 0,
    muted: false,
    locked: false,
    ...patch,
  };
}

const videoMedia = mediaSource({ id: "m-video", kind: "video" });
const audioMedia = mediaSource({ id: "m-audio", kind: "audio" });
const imageMedia = mediaSource({ id: "m-image", kind: "image" });
const videoClip = clip({ sourceId: "m-video" });
const imageClip = clip({ sourceId: "m-image" });
const subtitleClip = clip({ sourceId: null, text: "字幕文本" });

assert.equal(isClipTrackCompatible(videoClip, track({ kind: "video" }), [videoMedia]), true, "视频 clip 可移动到视频轨");
assert.equal(isClipTrackCompatible(videoClip, track({ kind: "audio" }), [videoMedia]), false, "视频 clip 不能移动到音频轨");
assert.equal(isClipTrackCompatible(subtitleClip, track({ kind: "subtitle" }), []), true, "字幕 clip 可移动到字幕轨");
assert.equal(isClipTrackCompatible(subtitleClip, track({ kind: "video" }), []), false, "字幕 clip 不能移动到视频轨");
assert.equal(isClipTrackCompatible(imageClip, track({ kind: "image" }), [imageMedia]), true, "图片 clip 可移动到图片轨");
assert.equal(isClipTrackCompatible(imageClip, track({ kind: "video" }), [imageMedia]), false, "图片 clip 不能移动到视频轨");
assert.equal(isClipTrackCompatible(videoClip, track({ kind: "video" }), []), false, "找不到绑定素材时应视为不兼容");
assert.equal(isClipTrackCompatible(videoClip, track({ kind: "voiceover" }), [audioMedia]), false, "视频 clip 不能移动到配音轨");

// ---- computeTrackAtY ----
const layout: TrackLayoutEntry[] = [
  { trackId: "t1", top: 0, height: 40 },
  { trackId: "t2", top: 42, height: 40 },
  { trackId: "t3", top: 84, height: 40 },
];
assert.equal(computeTrackAtY(10, layout), "t1", "命中第一条轨道");
assert.equal(computeTrackAtY(50, layout), "t2", "命中第二条轨道");
assert.equal(computeTrackAtY(90, layout), "t3", "命中第三条轨道");
assert.equal(computeTrackAtY(41, layout), null, "落在轨道缝隙应返回 null");
assert.equal(computeTrackAtY(200, layout), null, "超出全部轨道范围应返回 null");

// ---- resolveCrossTrackDrop ----
const dropInitial = clip({ startOnTrack: 10, duration: 5 });
const patchNoOverlap = { startOnTrack: 30, duration: 5 };
const targetClipsNoOverlap = [clip({ id: "other", startOnTrack: 0, duration: 5 })];
const resolvedNoOverlap = resolveCrossTrackDrop(patchNoOverlap, dropInitial, "target-track", targetClipsNoOverlap);
assert.equal(resolvedNoOverlap.trackId, "target-track", "无重叠时应写入目标轨道 trackId");

const patchOverlap = { startOnTrack: 2, duration: 5 };
const targetClipsOverlap = [clip({ id: "other", startOnTrack: 0, duration: 5 })];
const resolvedOverlap = resolveCrossTrackDrop(patchOverlap, dropInitial, "target-track", targetClipsOverlap);
assert.equal(resolvedOverlap.trackId, undefined, "有重叠时应作废跨轨，原 patch 不含 trackId");
assert.equal(resolvedOverlap.startOnTrack, 2, "有重叠时其余 patch 字段保持不变");
