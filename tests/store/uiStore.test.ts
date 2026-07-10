import assert from "node:assert/strict";
import { useUiStore } from "../../src/store/uiStore";

useUiStore.setState({ activeInspectorTab: "basic", lastInspectorTabByTrackKind: {} });

useUiStore.getState().setInspectorTabForTrack("video", "visual");
assert.equal(useUiStore.getState().activeInspectorTab, "visual");

useUiStore.getState().activateInspectorForTrack("audio");
assert.equal(useUiStore.getState().activeInspectorTab, "audio");

useUiStore.getState().activateInspectorForTrack("video");
assert.equal(useUiStore.getState().activeInspectorTab, "visual");
