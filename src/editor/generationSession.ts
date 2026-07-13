import type { AiSegment, TimedSentencesResult } from "../types";
import type { AssetSelectionResult } from "./assetSelection";

export type GenerationSourceType = "script" | "audio";
export type GenerationStage =
  | "created"
  | "narration_ready"
  | "transcribed"
  | "enriched"
  | "timeline_ready"
  | "assets_selected"
  | "subtitles_ready"
  | "completed"
  | "failed";

export type NarrationSource = {
  sourceId: string;
  audioPath: string;
  duration: number;
  origin: GenerationSourceType;
};

export type GenerationSessionError = {
  stage: GenerationStage;
  message: string;
  retryable: boolean;
  occurredAt: string;
};

export type GenerationReport = {
  narrationDuration: number;
  segmentCount: number;
  matchedAssetCount: number;
  duplicateAssetCount: number;
  lowConfidenceSegmentCount: number;
  failedSegmentCount: number;
  subtitleIssueCount: number;
};

export type GenerationSession = {
  id: string;
  projectId: string;
  sourceType: GenerationSourceType;
  stage: GenerationStage;
  narrationSourceId: string | null;
  audioPath: string | null;
  narration: NarrationSource | null;
  transcript: TimedSentencesResult | null;
  segments: AiSegment[];
  assetResults: AssetSelectionResult[];
  errors: GenerationSessionError[];
  report: GenerationReport | null;
  subtitleIssueCount: number;
  createdAt: string;
  updatedAt: string;
};

const STORAGE_PREFIX = "sceneforge-generation-session:";

function timestamp() {
  return new Date().toISOString();
}

function sessionId() {
  return `generation_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

export function createGenerationSession(projectId: string, sourceType: GenerationSourceType): GenerationSession {
  const now = timestamp();
  return {
    id: sessionId(),
    projectId,
    sourceType,
    stage: "created",
    narrationSourceId: null,
    audioPath: null,
    narration: null,
    transcript: null,
    segments: [],
    assetResults: [],
    errors: [],
    report: null,
    subtitleIssueCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateGenerationSession(
  session: GenerationSession,
  patch: Partial<Omit<GenerationSession, "id" | "projectId" | "sourceType" | "createdAt">>,
): GenerationSession {
  return { ...session, ...patch, updatedAt: timestamp() };
}

export function recordGenerationError(
  session: GenerationSession,
  stage: GenerationStage,
  message: string,
  retryable: boolean,
): GenerationSession {
  return updateGenerationSession(session, {
    stage: "failed",
    errors: [...session.errors, { stage, message, retryable, occurredAt: timestamp() }],
  });
}

export function buildGenerationReport(session: GenerationSession): GenerationReport {
  const selectedIds = session.assetResults
    .map((result) => result.selected?.id)
    .filter((id): id is string => Boolean(id));
  const duplicateAssetCount = selectedIds.length - new Set(selectedIds).size;
  return {
    narrationDuration: session.transcript?.totalDuration ?? session.narration?.duration ?? 0,
    segmentCount: session.segments.length,
    matchedAssetCount: session.assetResults.filter((result) => Boolean(result.selected)).length,
    duplicateAssetCount,
    lowConfidenceSegmentCount: session.assetResults.filter((result) => result.requiresManualSelection).length,
    failedSegmentCount: session.assetResults.filter((result) => result.candidates.length === 0).length,
    subtitleIssueCount: session.subtitleIssueCount,
  };
}

export function saveGenerationSession(session: GenerationSession) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(`${STORAGE_PREFIX}${session.projectId}`, JSON.stringify(session));
}

export function loadGenerationSession(projectId: string): GenerationSession | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(`${STORAGE_PREFIX}${projectId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GenerationSession;
  } catch {
    return null;
  }
}
