import assert from "node:assert/strict";
import {
  normalizeSubtitleStyle,
  resolveSubtitleAnchor,
  SUBTITLE_POSITION_ANCHORS,
  subtitleExportWarnings,
} from "../../src/editor/subtitles/styleContract";

assert.deepEqual(
  resolveSubtitleAnchor({ position: "top" }),
  SUBTITLE_POSITION_ANCHORS.top,
);
assert.deepEqual(
  resolveSubtitleAnchor({ position: "center" }),
  SUBTITLE_POSITION_ANCHORS.center,
);
assert.deepEqual(
  resolveSubtitleAnchor({ position: "bottom" }),
  SUBTITLE_POSITION_ANCHORS.bottom,
);
assert.deepEqual(resolveSubtitleAnchor({ position: "custom", x: 17, y: 63 }), {
  x: 17,
  y: 63,
});

const normalized = normalizeSubtitleStyle({
  fontSize: 999,
  strokeWidth: -2,
  backgroundPadding: 100,
  shadowBlur: -1,
  letterSpacing: 999,
  lineHeight: 0,
  x: -1,
  y: 200,
  scaleX: 0,
  scaleY: 999,
  rotation: Number.NaN,
});
assert.equal(normalized.fontSize, 240);
assert.equal(normalized.strokeWidth, 0);
assert.equal(normalized.backgroundPadding, 64);
assert.equal(normalized.shadowBlur, 0);
assert.equal(normalized.letterSpacing, 40);
assert.equal(normalized.lineHeight, 0.8);
assert.equal(normalized.x, 0);
assert.equal(normalized.y, 100);
assert.equal(normalized.scaleX, 10);
assert.equal(normalized.scaleY, 500);
assert.equal(normalized.rotation, 0);

assert.deepEqual(
  subtitleExportWarnings({ backgroundColor: "#000000", lineHeight: 1.5 }),
  [
    "导出会将背景近似为方形底板，暂不支持圆角。",
    "ASS 导出暂不支持自定义行高，将使用字体默认行距。",
  ],
);
assert.equal(
  subtitleExportWarnings({ animationIn: "slideUp", animationOut: "slideDown" })
    .length,
  1,
);
