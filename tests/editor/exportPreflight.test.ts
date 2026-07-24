import assert from "node:assert/strict";
import {
  hasBlockingExportIssues,
  projectExportPreflight,
} from "../../src/editor/exportPreflight";
import type { Clip, Project, Track } from "../../src/types";
import { DEFAULT_RENDER_CONFIG } from "../../src/types";

function track(patch: Partial<Track> = {}): Track {
  return {
    id: "t",
    kind: "video",
    name: "视频",
    order: 0,
    muted: false,
    locked: false,
    ...patch,
  };
}

function clip(patch: Partial<Clip> = {}): Clip {
  return {
    id: "c",
    trackId: "v1",
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
    ...patch,
  };
}

function project(patch: Partial<Project> = {}): Project {
  return {
    id: "p",
    title: "p",
    script: "",
    ratio: "9:16",
    fps: 30,
    media: [],
    tracks: [
      track({ id: "v1", kind: "video" }),
      track({ id: "a1", kind: "voiceover", name: "配音", order: 1 }),
    ],
    clips: [],
    renderConfig: DEFAULT_RENDER_CONFIG,
    chapters: [],
    coverTime: null,
    previewPath: null,
    finalPath: null,
    createdAt: "",
    updatedAt: "",
    ...patch,
  };
}

{
  const issues = projectExportPreflight(project());
  assert.equal(issues.length, 1);
  assert.equal(issues[0].id, "empty-timeline");
  assert.equal(issues[0].severity, "error");
  assert.equal(hasBlockingExportIssues(issues), true);
}

{
  const issues = projectExportPreflight(
    project({
      clips: [
        clip({ id: "v", trackId: "v1", sourceId: null }),
        clip({ id: "a", trackId: "a1", sourceId: "narration", volume: 1 }),
      ],
    }),
  );
  assert.ok(issues.some((issue) => issue.id === "unbound-video" && issue.severity === "error"));
  assert.equal(hasBlockingExportIssues(issues), true);
}

{
  const issues = projectExportPreflight(
    project({
      clips: [
        clip({ id: "v", trackId: "v1", sourceId: "vid", volume: 1 }),
        clip({ id: "a", trackId: "a1", sourceId: "narration", volume: 1 }),
      ],
    }),
  );
  const native = issues.find((issue) => issue.id === "video-native-audio");
  assert.ok(native);
  assert.equal(native?.severity, "warning");
  assert.equal(hasBlockingExportIssues(issues), false);
}

{
  const issues = projectExportPreflight(
    project({
      clips: [
        clip({ id: "v", trackId: "v1", sourceId: "vid", volume: 0 }),
        clip({ id: "a", trackId: "a1", sourceId: "narration", volume: 1 }),
      ],
    }),
  );
  assert.equal(
    issues.find((issue) => issue.id === "video-native-audio"),
    undefined,
  );
}

{
  const issues = projectExportPreflight(
    project({
      clips: [clip({ id: "v", trackId: "v1", sourceId: "vid", voiceEffect: "robot" })],
    }),
  );
  const fx = issues.find((issue) => issue.id === "voice-effect-export-only");
  assert.ok(fx);
  assert.equal(fx?.severity, "warning");
}
