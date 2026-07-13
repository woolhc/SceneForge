import { desktopApi } from "../../tauri";
import type { Project, SubtitleGenerationMode, SubtitleLanguageContext, TimedSentence } from "../../types";
import type { SubtitleQualityIssue } from "./types";

export type SubtitleArtifactBundle = {
  version: 1;
  projectId: string;
  generatedAt: string;
  mode: SubtitleGenerationMode;
  bilingual: boolean;
  languageContext: SubtitleLanguageContext;
  rawTranscript: TimedSentence[];
  sourceCues: TimedSentence[];
  translatedCues: Array<TimedSentence & { translated?: string | null }>;
  ai: {
    requestedChunks: number;
    successfulChunks: number;
    failedChunks: number;
    failureCategories: string[];
    confidence: number;
    preferredBreakCount: number;
    strongBreakCount: number;
    protectedRangeCount: number;
  };
  output: {
    groupCount: number;
    sourceClipCount: number;
    targetClipCount: number;
    qualityIssues: SubtitleQualityIssue[];
  };
};

const PREFIX = "sceneforge-subtitle-artifact:";

export async function saveSubtitleArtifact(bundle: SubtitleArtifactBundle) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(`${PREFIX}${bundle.projectId}`, JSON.stringify(bundle));
  }
  return desktopApi.saveSubtitleArtifact(bundle.projectId, bundle);
}

export function loadSubtitleArtifact(project: Project): SubtitleArtifactBundle | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(`${PREFIX}${project.id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SubtitleArtifactBundle;
  } catch {
    return null;
  }
}
