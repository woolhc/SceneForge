import type { SubtitleStyle, TimedSentence, WordCue } from "../../types";

export type SubtitleMode = "standard" | "keyword" | "karaoke";

export type SubtitleLayoutProfile = {
  ratio: "9:16" | "16:9" | "1:1";
  canvasWidth: number;
  canvasHeight: number;
  safeInsets: { top: number; right: number; bottom: number; left: number };
  preferredY: number;
  maxWidthRatio: number;
  maxLines: number;
  primaryFontSizeRatio: number;
  secondaryFontSizeRatio: number;
  minFontScale: number;
  preferredCharsPerLine: number;
  maxCharsPerLine: number;
  maxCharsPerCue: number;
  minDuration: number;
  preferredDuration: number;
  maxDuration: number;
  preferredCps: number;
  maxCps: number;
  minimumGap: number;
};

export type SubtitleQualityIssueType =
  | "too_many_lines"
  | "too_wide"
  | "reading_speed_too_fast"
  | "duration_too_short"
  | "duration_too_long"
  | "orphan_line"
  | "unsafe_region";

export type SubtitleQualityIssue = {
  type: SubtitleQualityIssueType;
  severity: "info" | "warning" | "error";
  message: string;
};

export type SubtitleQualityResult = {
  score: number;
  issues: SubtitleQualityIssue[];
};

export type LayoutedSubtitle = TimedSentence & {
  lines: string[];
  translated?: string | null;
  translatedLines?: string[];
  words?: WordCue[];
  fontSize: number;
  secondaryFontSize: number;
  x: number;
  y: number;
  maxWidth: number;
  style: SubtitleStyle;
  quality: SubtitleQualityResult;
};
