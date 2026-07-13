import assert from "node:assert/strict";
import { buildGenerationReport, createGenerationSession, updateGenerationSession } from "../../src/editor/generationSession";

let session = createGenerationSession("project-1", "audio");
session = updateGenerationSession(session, {
  segments: [{ title: "A", text: "hello", visualQuery: "city", mood: "calm", estimatedDuration: 2 }],
  transcript: { sentences: [{ start: 0, end: 2, text: "hello" }], totalDuration: 2, fullText: "hello" },
  assetResults: [{ clipId: "clip-1", query: "city", candidates: [], selected: null, confidence: 0, requiresManualSelection: true, reason: "none" }],
});
const report = buildGenerationReport(session);
assert.equal(report.narrationDuration, 2);
assert.equal(report.segmentCount, 1);
assert.equal(report.lowConfidenceSegmentCount, 1);
assert.equal(report.failedSegmentCount, 1);
assert.equal(report.subtitleIssueCount, 0);
