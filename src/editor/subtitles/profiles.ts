import type { Project } from "../../types";
import type { SubtitleLayoutProfile } from "./types";

function shortEdgeForResolution(resolution: string): number {
  if (resolution === "4k" || resolution === "2160p") return 2160;
  if (resolution === "720p") return 720;
  if (resolution === "480p") return 480;
  return 1080;
}

function canvasSize(ratio: Project["ratio"], resolution: string) {
  const shortEdge = shortEdgeForResolution(resolution);
  if (ratio === "16:9") return { width: Math.round(shortEdge * 16 / 9), height: shortEdge };
  if (ratio === "1:1") return { width: shortEdge, height: shortEdge };
  return { width: shortEdge, height: Math.round(shortEdge * 16 / 9) };
}

export function subtitleLayoutProfile(project: Project, bilingual = false): SubtitleLayoutProfile {
  const ratio = project.ratio === "16:9" || project.ratio === "1:1" ? project.ratio : "9:16";
  const { width, height } = canvasSize(ratio, project.renderConfig.resolution);
  const common = {
    ratio,
    canvasWidth: width,
    canvasHeight: height,
    maxLines: bilingual ? 1 : 2,
    minFontScale: bilingual ? 0.84 : 0.88,
    minDuration: 0.8,
    preferredDuration: 2.2,
    maxDuration: bilingual ? 3.8 : 4.5,
    preferredCps: 8,
    maxCps: bilingual ? 10 : 12,
    minimumGap: 0.08,
  } as const;

  if (ratio === "16:9") {
    return {
      ...common,
      safeInsets: { top: 0.06, right: 0.08, bottom: 0.08, left: 0.08 },
      preferredY: 0.84,
      maxWidthRatio: bilingual ? 0.68 : 0.72,
      primaryFontSizeRatio: 0.043,
      secondaryFontSizeRatio: 0.03,
      preferredCharsPerLine: bilingual ? 18 : 20,
      maxCharsPerLine: bilingual ? 28 : 34,
      maxCharsPerCue: bilingual ? 28 : 58,
    };
  }

  if (ratio === "1:1") {
    return {
      ...common,
      safeInsets: { top: 0.07, right: 0.09, bottom: 0.12, left: 0.09 },
      preferredY: 0.78,
      maxWidthRatio: bilingual ? 0.76 : 0.8,
      primaryFontSizeRatio: 0.046,
      secondaryFontSizeRatio: 0.032,
      preferredCharsPerLine: bilingual ? 13 : 15,
      maxCharsPerLine: bilingual ? 18 : 22,
      maxCharsPerCue: bilingual ? 18 : 38,
    };
  }

  return {
    ...common,
    safeInsets: { top: 0.08, right: 0.14, bottom: 0.18, left: 0.08 },
    preferredY: 0.7,
    maxWidthRatio: bilingual ? 0.74 : 0.78,
    primaryFontSizeRatio: 0.048,
    secondaryFontSizeRatio: 0.034,
    preferredCharsPerLine: bilingual ? 10 : 11,
    maxCharsPerLine: bilingual ? 13 : 15,
    maxCharsPerCue: bilingual ? 13 : 26,
  };
}

export function primaryFontSize(profile: SubtitleLayoutProfile) {
  return Math.max(18, Math.round(Math.min(profile.canvasWidth, profile.canvasHeight) * profile.primaryFontSizeRatio));
}

export function secondaryFontSize(profile: SubtitleLayoutProfile) {
  return Math.max(14, Math.round(Math.min(profile.canvasWidth, profile.canvasHeight) * profile.secondaryFontSizeRatio));
}
