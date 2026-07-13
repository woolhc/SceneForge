import assert from "node:assert/strict";
import { breakSubtitleLines } from "../../src/editor/subtitles/lineBreaker";
import { subtitleLayoutProfile, primaryFontSize } from "../../src/editor/subtitles/profiles";
import { measureTextWidth } from "../../src/editor/subtitles/textMeasure";
import type { Project } from "../../src/types";
import { DEFAULT_RENDER_CONFIG } from "../../src/types";

function project(ratio: Project["ratio"], resolution = "1080p"): Project {
  return {
    id: ratio, title: ratio, script: "", ratio, fps: 30, media: [], clips: [], tracks: [],
    renderConfig: { ...DEFAULT_RENDER_CONFIG, resolution }, chapters: [], coverTime: null,
    previewPath: null, finalPath: null, createdAt: "now", updatedAt: "now",
  };
}

const vertical = subtitleLayoutProfile(project("9:16"));
const landscape = subtitleLayoutProfile(project("16:9"));
assert.equal(vertical.canvasWidth, 1080);
assert.equal(vertical.canvasHeight, 1920);
assert.equal(landscape.canvasWidth, 1920);
assert.equal(landscape.canvasHeight, 1080);
assert.equal(primaryFontSize(subtitleLayoutProfile(project("9:16", "4k"))), primaryFontSize(vertical) * 2);

const maxWidth = vertical.canvasWidth * vertical.maxWidthRatio;
const lines = breakSubtitleLines("人生最好的状态不是一直向前冲", {
  maxLines: 2,
  maxWidth,
  fontFamily: "Noto Sans SC",
  fontSize: primaryFontSize(vertical),
});
assert.ok(lines && lines.length <= 2);
assert.ok(lines!.every((line) => measureTextWidth(line, "Noto Sans SC", primaryFontSize(vertical)) <= maxWidth));
