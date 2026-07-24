import assert from "node:assert/strict";
import {
  isPexelsAsset,
  isPixabayAsset,
  isStockRemoteAsset,
  mediaSourceMetaLine,
  pexelsAssetTooltip,
  pexelsCreatorCredit,
  stockProviderBrand,
} from "../../src/library/pexelsAttribution";
import type { MediaSource } from "../../src/types";

const base = (patch: Partial<MediaSource> = {}): MediaSource => ({
  id: "pexels-1",
  kind: "video",
  title: "City night",
  width: 1920,
  height: 1080,
  duration: 8,
  source: "pexels",
  photographer: "Jane Doe",
  photographerUrl: "https://www.pexels.com/@jane",
  pageUrl: "https://www.pexels.com/video/1",
  ...patch,
});

assert.equal(isPexelsAsset(base()), true);
assert.equal(isPexelsAsset(base({ source: "local" })), false);
assert.equal(isPixabayAsset(base({ source: "pixabay" })), true);
assert.equal(isStockRemoteAsset(base({ source: "pixabay" })), true);
assert.equal(pexelsCreatorCredit(base()), "Video by Jane Doe");
assert.equal(pexelsCreatorCredit(base({ kind: "image" })), "Photo by Jane Doe");
assert.equal(pexelsCreatorCredit(base({ photographer: null })), null);
assert.match(pexelsAssetTooltip(base()), /Jane Doe/);
assert.match(pexelsAssetTooltip(base()), /Provided by Pexels/);
assert.match(pexelsAssetTooltip(base({ source: "pixabay" })), /Provided by Pixabay/);
assert.match(mediaSourceMetaLine(base()), /Video by Jane Doe/);
assert.match(mediaSourceMetaLine(base({ photographer: undefined })), /Pexels/);
assert.match(mediaSourceMetaLine(base({ source: "pixabay", photographer: undefined })), /Pixabay/);
assert.match(mediaSourceMetaLine(base({ source: "local", photographer: undefined })), /本地/);
assert.equal(stockProviderBrand("pixabay"), "Pixabay");

console.log("pexelsAttribution.test.ts: ok");
