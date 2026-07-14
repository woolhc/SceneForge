import assert from "node:assert/strict";
import { claimProxyBackfill } from "../../src/editor/mediaCache";
import type { MediaSource } from "../../src/types";

const asset: MediaSource = {
  id: "asset-1",
  kind: "video",
  title: "Asset",
  url: "https://videos.pexels.com/asset-1.mp4",
  localPath: "/cache/asset-1.mp4",
  proxyPath: null,
  proxyStatus: "none",
  proxyWidth: null,
  proxyHeight: null,
  thumbnailUrl: null,
  width: 1920,
  height: 1080,
  duration: 10,
  source: "pexels",
};

const inFlight = new Set<string>();
assert.equal(claimProxyBackfill(asset, inFlight), true);
assert.deepEqual([...inFlight], [asset.id]);
assert.equal(
  claimProxyBackfill(asset, inFlight),
  false,
  "a replacement effect must not launch a duplicate proxy job",
);
inFlight.delete(asset.id);
assert.equal(claimProxyBackfill(asset, inFlight), true, "the asset can be retried after cleanup");
