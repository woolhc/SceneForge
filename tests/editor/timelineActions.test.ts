import assert from "node:assert/strict";
import {
  defaultVideoClipVolume,
  muteAllVideoClips,
  projectHasVoiceoverClips,
} from "../../src/editor/timelineActions";
import type { Clip, Project, Track } from "../../src/types";
import { DEFAULT_RENDER_CONFIG } from "../../src/types";

function track(patch: Partial<Track> = {}): Track {
  return { id: "t", kind: "video", name: "视频", order: 0, muted: false, locked: false, ...patch };
}

function clip(patch: Partial<Clip> = {}): Clip {
  return {
    id: "c", trackId: "t", sourceId: "media", startOnTrack: 0, duration: 5,
    sourceIn: 0, sourceOut: 5, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0,
    brightness: 0, contrast: 0, saturation: 0, ...patch,
  };
}

const project: Project = {
  id: "p", title: "p", script: "", ratio: "9:16", fps: 30, media: [],
  tracks: [track({ id: "v1", kind: "video" }), track({ id: "a1", kind: "voiceover" })],
  clips: [
    clip({ id: "c1", trackId: "v1", volume: 1 }),
    clip({ id: "c2", trackId: "v1", volume: 0.5 }),
    clip({ id: "c3", trackId: "a1", volume: 1 }),
  ],
  renderConfig: DEFAULT_RENDER_CONFIG, chapters: [], coverTime: null, previewPath: null, finalPath: null,
  createdAt: "", updatedAt: "",
};

const result = muteAllVideoClips(project);

// 视频轨片段音量归零
assert.equal(result.clips.find((c) => c.id === "c1")?.volume, 0);
assert.equal(result.clips.find((c) => c.id === "c2")?.volume, 0);
// 非视频轨（配音）片段不受影响
assert.equal(result.clips.find((c) => c.id === "c3")?.volume, 1);

// 已经是 0 的片段返回同一个对象引用（避免不必要的脏标记）
const already = muteAllVideoClips(result);
assert.equal(already.clips.find((c) => c.id === "c1"), result.clips.find((c) => c.id === "c1"));

// 已有配音片段时，新建视频默认静音
assert.equal(projectHasVoiceoverClips(project), true);
assert.equal(defaultVideoClipVolume(project), 0);

const noVoiceover: Project = {
  ...project,
  clips: [clip({ id: "c1", trackId: "v1", volume: 1 })],
};
assert.equal(projectHasVoiceoverClips(noVoiceover), false);
assert.equal(defaultVideoClipVolume(noVoiceover), 1);
