import assert from "node:assert/strict";
import { needsWordSpace } from "../../src/editor/subtitles/wordSpacing";

// 标点结尾 + 后接字母数字：需要空格（回归：字幕逐字高亮曾漏了这条规则，导致 "words,but" 缺空格）
assert.equal(needsWordSpace("words,", "but"), true);
assert.equal(needsWordSpace("Hello;", "world"), true);
assert.equal(needsWordSpace("wait!", "Go"), true);

// 纯字母数字边界：需要空格
assert.equal(needsWordSpace("And", "so"), true);

// 句号结尾 + 新句：需要空格
assert.equal(needsWordSpace("Done.", "Next"), true);

// 小数点场景：不需要空格
assert.equal(needsWordSpace("3.", "14"), false);

// 中文场景：不需要空格
assert.equal(needsWordSpace("今", "天"), false);

// 空字符串：不需要空格
assert.equal(needsWordSpace("", "but"), false);
assert.equal(needsWordSpace("words,", ""), false);
