import assert from "node:assert/strict";
import { mergeCachedMediaSource } from "../../src/editor/mediaCache";
import type { MediaSource, Project } from "../../src/types";

const remoteAsset = (id: string): MediaSource => ({
  id,
  kind: "video",
  title: id,
  url: `https://videos.pexels.com/${id}.mp4`,
  localPath: null,
  proxyPath: null,
  proxyStatus: "none",
  proxyWidth: null,
  proxyHeight: null,
  thumbnailUrl: null,
  width: 1920,
  height: 1080,
  duration: 10,
  source: "pexels",
});

const project = {
  id: "project-1",
  title: "keep me",
  script: "latest user edit",
  ratio: "16:9",
  fps: 30,
  media: [remoteAsset("asset-a"), remoteAsset("asset-b")],
  tracks: [],
  clips: [],
  renderConfig: {},
  chapters: [],
  coverTime: null,
  previewPath: null,
  finalPath: null,
  createdAt: "now",
  updatedAt: "now",
} as Project;

project.media[0] = { ...project.media[0], title: "renamed by user" };

const cachedA = {
  ...remoteAsset("asset-a"),
  localPath: "/cache/asset-a.mp4",
  proxyPath: "/cache/asset-a-proxy-v2.mp4",
  proxyStatus: "ready" as const,
};
const cachedB = {
  ...remoteAsset("asset-b"),
  localPath: "/cache/asset-b.mp4",
  proxyPath: "/cache/asset-b-proxy-v2.mp4",
  proxyStatus: "ready" as const,
};

const afterA = mergeCachedMediaSource(project, cachedA);
const afterB = mergeCachedMediaSource(afterA, cachedB);

assert.equal(afterB.script, "latest user edit");
assert.equal(afterB.media.find((asset) => asset.id === "asset-a")?.title, "renamed by user");
assert.equal(afterB.media.find((asset) => asset.id === "asset-a")?.proxyPath, cachedA.proxyPath);
assert.equal(afterB.media.find((asset) => asset.id === "asset-b")?.proxyPath, cachedB.proxyPath);
assert.notEqual(afterA, project);
assert.equal(mergeCachedMediaSource(afterB, cachedB), afterB, "identical cache updates should preserve identity");

const deletedBeforeCompletion = { ...project, media: [] };
assert.equal(
  mergeCachedMediaSource(deletedBeforeCompletion, cachedA),
  deletedBeforeCompletion,
  "a stale cache completion must not resurrect media removed by the user",
);
