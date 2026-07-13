import assert from "node:assert/strict";
import { selectAssetCandidate } from "../../src/editor/assetSelection";
import type { MediaSource } from "../../src/types";

const asset = (id: string, width: number, height: number, duration: number, title: string): MediaSource => ({
  id, kind: "video", width, height, duration, title, source: "pexels", url: `https://example.com/${title}`,
});

const result = selectAssetCandidate([
  asset("horizontal", 1920, 1080, 12, "business office"),
  asset("vertical", 1080, 1920, 9, "business office team"),
], {
  clipId: "clip-1",
  query: "business office",
  ratio: "9:16",
  targetDuration: 8,
  materialDirection: "business",
});
assert.equal(result.selected?.id, "vertical");

const deduped = selectAssetCandidate([
  asset("used", 1080, 1920, 9, "business office"),
  asset("fresh", 1080, 1920, 9, "business office"),
], {
  clipId: "clip-2",
  query: "business office",
  ratio: "9:16",
  targetDuration: 8,
  materialDirection: "business",
  usedAssetIds: new Set(["used"]),
});
assert.equal(deduped.selected?.id, "fresh");
