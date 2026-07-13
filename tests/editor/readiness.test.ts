import assert from "node:assert/strict";
import {
  createPendingWhisperAction,
  getApiReadiness,
  getReadinessIssues,
  hasWhisperModel,
  shouldGateWhisperAction,
  whisperStatusLabel,
} from "../../src/editor/readiness";
import type { AppSettings, WhisperModelStatus } from "../../src/types";

const settings: AppSettings = {
  deepseekApiKey: "",
  pexelsApiKey: "pexels",
  ttsBaseUrl: "",
  fishAudioApiKey: "",
  fishAudioModel: "s1",
  fishAudioReferenceId: "",
  fishAudioFormat: "mp3",
  fishAudioSampleRate: 44100,
  defaultRatio: "9:16",
  defaultVoiceId: null,
  renderPreset: "preview-fast",
  whisperBin: "whisper-cli",
  whisperModel: "",
};

function modelStatus(patch: Partial<WhisperModelStatus> = {}): WhisperModelStatus {
  return {
    model: {
      id: "medium-q5",
      name: "Medium Q5",
      fileName: "ggml-medium-q5_0.bin",
      sizeBytes: 539212467,
      sha256: "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f",
      description: "recommended",
      recommended: true,
    },
    available: false,
    resolvedPath: null,
    configuredPath: null,
    selectedModelId: null,
    downloadedBytes: 0,
    totalBytes: 539212467,
    partialDownload: false,
    downloading: false,
    modelsDir: "/models",
    whisperAvailable: true,
    whisperPath: "whisper-cli",
    ...patch,
  };
}

assert.equal(hasWhisperModel(null), false);
assert.equal(hasWhisperModel(modelStatus({ available: true })), true);
assert.equal(hasWhisperModel(modelStatus({ available: true, whisperAvailable: false })), false);
assert.equal(hasWhisperModel(modelStatus({ available: false, resolvedPath: "/models/ggml.bin" })), false);
assert.equal(shouldGateWhisperAction(modelStatus()), true);
assert.equal(
  whisperStatusLabel(modelStatus({
    available: true,
    selectedModelId: "custom",
    resolvedPath: "/models/custom.bin",
  })),
  "custom.bin",
);
assert.equal(whisperStatusLabel(modelStatus({ partialDownload: true })), "下载未完成");
assert.equal(
  whisperStatusLabel(modelStatus({ available: true, whisperAvailable: false })),
  "whisper-cli 不可用",
);

assert.deepEqual(getApiReadiness(settings), {
  deepseekReady: false,
  pexelsReady: true,
  fishAudioReady: false,
});
assert.deepEqual(getReadinessIssues(settings, modelStatus()).map((issue) => issue.id), [
  "whisper",
  "deepseek",
  "fishAudio",
]);
assert.deepEqual(createPendingWhisperAction(3, "generate-pipeline", { ratio: "9:16" }), {
  id: 3,
  kind: "generate-pipeline",
  payload: { ratio: "9:16" },
});
