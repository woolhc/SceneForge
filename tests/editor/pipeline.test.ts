import assert from "node:assert/strict";
import { buildGeneratePipelineSteps, type GeneratePipelineInput } from "../../src/editor/pipeline";

const baseInput: GeneratePipelineInput = {
  script: "这是一段用于测试的完整文案。",
  ratio: "9:16",
  voiceId: "voice-1",
  translate: false,
  materialDirection: "scenery",
  audioPath: null,
};

assert.deepEqual(buildGeneratePipelineSteps(baseInput).map((step) => step.label), [
  "创建生成会话", "Fish Audio 生成完整旁白", "Whisper 单次转写", "AI 分镜 + 构建时间线", "素材评分 + 去重", "从转写生成字幕", "生成报告",
]);
assert.equal(buildGeneratePipelineSteps({ ...baseInput, audioPath: "/tmp/narration.wav" })[1].label, "准备主旁白音频");

const calls: string[] = [];
const session = {
  id: "s", projectId: "p", sourceType: "script" as const, stage: "created" as const,
  narrationSourceId: null, audioPath: null, narration: null, transcript: null,
  segments: [], assetResults: [], errors: [], report: null, subtitleIssueCount: 0, createdAt: "now", updatedAt: "now",
};
const { runGeneratePipeline } = await import("../../src/editor/pipeline");
await runGeneratePipeline(baseInput, {
  startPipeline: () => calls.push("start"),
  updateStep: () => undefined,
  createSession: async () => { calls.push("create"); return session; },
  prepareNarration: async (value) => { calls.push("narration"); return value; },
  transcribeNarration: async (value) => { calls.push("transcribe"); return value; },
  enrichAndBuildTimeline: async (value) => { calls.push("timeline"); return value; },
  selectAssets: async (value) => { calls.push("assets"); return value; },
  createSubtitles: async (value) => { calls.push("subtitles"); return value; },
  complete: () => calls.push("complete"),
  fail: () => calls.push("fail"),
});
assert.equal(calls.filter((call) => call === "transcribe").length, 1);
assert.deepEqual(calls, ["start", "create", "narration", "transcribe", "timeline", "assets", "subtitles", "complete"]);
