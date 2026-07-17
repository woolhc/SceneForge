import assert from "node:assert/strict";
import {
  TOOL_TABS,
  TIMELINE_ACTIONS,
  audioInspectorCapabilities,
  editorLayoutsForMode,
  inspectorTabForInteraction,
  inspectorTabsForSelection,
  defaultInspectorTabForTrack,
  inspectorTabsForTrack,
  resolveInspectorTab,
} from "../../src/editor/editorLayout";

assert.deepEqual(
  TOOL_TABS.map((tab) => tab.id),
  ["media", "text", "audio", "subtitle", "transition", "effects"],
  "all editor capabilities must have a stable primary tool entry",
);

assert.equal(defaultInspectorTabForTrack("subtitle"), "subtitle");
assert.equal(defaultInspectorTabForTrack("audio"), "audio");
assert.equal(defaultInspectorTabForTrack("voiceover"), "audio");
assert.equal(defaultInspectorTabForTrack("video"), "basic");
assert.equal(defaultInspectorTabForTrack("text"), "subtitle");

assert.deepEqual(inspectorTabsForTrack("image"), ["basic", "visual", "animation"]);
assert.deepEqual(inspectorTabsForTrack("video"), ["basic", "visual", "animation", "audio"]);
assert.deepEqual(inspectorTabsForTrack("subtitle"), ["basic", "subtitle", "animation"]);
assert.deepEqual(inspectorTabsForTrack("text"), ["basic", "subtitle", "animation"]);

assert.equal(resolveInspectorTab("image", "audio"), "basic");
assert.equal(resolveInspectorTab("subtitle", "subtitle"), "subtitle");
assert.equal(resolveInspectorTab("text", "subtitle"), "subtitle");

assert.deepEqual(
  TIMELINE_ACTIONS.map((action) => action.id),
  ["split", "delete", "copy", "paste", "duplicate", "track", "chapter"],
);
assert.equal(TIMELINE_ACTIONS.some((action) => action.id === "export"), false);
assert.equal(TIMELINE_ACTIONS.some((action) => action.id === "cover"), false);

assert.deepEqual(audioInspectorCapabilities("video"), {
  canGenerateVoice: false,
  canFade: false,
  canReduceNoise: true,
});
assert.deepEqual(audioInspectorCapabilities("voiceover"), {
  canGenerateVoice: true,
  canFade: true,
  canReduceNoise: true,
});
assert.deepEqual(audioInspectorCapabilities("subtitle"), {
  canGenerateVoice: false,
  canFade: false,
  canReduceNoise: false,
});

assert.deepEqual(editorLayoutsForMode("professional"), {
  vertical: { workspace: 62, timeline: 38 },
  horizontal: { tools: 20, preview: 55, inspector: 25 },
});
assert.deepEqual(editorLayoutsForMode("simple"), {
  vertical: { workspace: 72, timeline: 28 },
  horizontal: { tools: 8, preview: 68, inspector: 24 },
});
assert.equal(inspectorTabForInteraction("keyframe", "video"), "animation");
assert.deepEqual(inspectorTabsForSelection("subtitle", 2), ["subtitle"]);
assert.deepEqual(inspectorTabsForSelection("text", 2), ["subtitle"]);
assert.deepEqual(inspectorTabsForSelection("video", 2), ["basic"]);
assert.deepEqual(inspectorTabsForSelection("video", 1), ["basic", "visual", "animation", "audio"]);
