import type { Project, SubtitleStyle, TimedSentence } from "../../types";
import { DEFAULT_SUBTITLE_STYLE } from "../../types";
import { breakSubtitleLines } from "./lineBreaker";
import { primaryFontSize, secondaryFontSize, subtitleLayoutProfile } from "./profiles";
import { measureTextWidth } from "./textMeasure";
import type { LayoutedSubtitle, SubtitleQualityIssue, SubtitleQualityResult } from "./types";

function countReadableCharacters(text: string) {
  return [...text].filter((character) => !/\s/.test(character)).length;
}

function quality(
  item: TimedSentence,
  lines: string[],
  fontSize: number,
  maxWidth: number,
  y: number,
  project: Project,
): SubtitleQualityResult {
  const issues: SubtitleQualityIssue[] = [];
  const duration = item.end - item.start;
  const cps = countReadableCharacters(item.text) / Math.max(0.1, duration);
  if (lines.length > 2) issues.push({ type: "too_many_lines", severity: "error", message: "字幕超过两行" });
  if (lines.some((line) => measureTextWidth(line, "Noto Sans SC", fontSize) > maxWidth + 1)) {
    issues.push({ type: "too_wide", severity: "error", message: "字幕超出安全宽度" });
  }
  if (cps > 12) issues.push({ type: "reading_speed_too_fast", severity: "warning", message: `阅读速度过快：${cps.toFixed(1)} 字/秒` });
  if (duration < 0.8) issues.push({ type: "duration_too_short", severity: "warning", message: "字幕展示时间过短" });
  if (duration > 5) issues.push({ type: "duration_too_long", severity: "info", message: "字幕展示时间过长" });
  if (lines.length === 2 && Math.min(...lines.map((line) => countReadableCharacters(line))) <= 2) {
    issues.push({ type: "orphan_line", severity: "warning", message: "存在孤立短行" });
  }
  if (project.ratio === "9:16" && y > 76) {
    issues.push({ type: "unsafe_region", severity: "warning", message: "字幕接近竖屏底部 UI 危险区" });
  }
  const penalty = issues.reduce((sum, issue) => sum + (issue.severity === "error" ? 30 : issue.severity === "warning" ? 15 : 5), 0);
  return { score: Math.max(0, 100 - penalty), issues };
}

function resolvedStyle(fontSize: number, y: number, bilingual: boolean): SubtitleStyle {
  return {
    ...DEFAULT_SUBTITLE_STYLE,
    fontSize,
    position: "custom",
    x: 50,
    y,
    lineHeight: bilingual ? 1.25 : 1.2,
    karaoke: false,
    animationIn: "none",
    animationOut: "none",
    animationDuration: 0.18,
  };
}

function fitLines(text: string, maxLines: number, maxWidth: number, fontSize: number) {
  const scales = [1, 0.94, 0.88, 0.84];
  for (const scale of scales) {
    const size = Math.round(fontSize * scale);
    const lines = breakSubtitleLines(text, {
      maxLines,
      maxWidth,
      fontFamily: "Noto Sans SC",
      fontSize: size,
    });
    if (lines) return { lines, fontSize: size };
  }
  return { lines: [text], fontSize: Math.round(fontSize * scales[scales.length - 1]) };
}

export function layoutTranscriptSubtitles(
  project: Project,
  transcript: Array<TimedSentence & { translated?: string | null }>,
  bilingual: boolean,
): LayoutedSubtitle[] {
  const profile = subtitleLayoutProfile(project, bilingual);
  const baseFontSize = primaryFontSize(profile);
  const secondFontSize = secondaryFontSize(profile);
  const maxWidth = profile.canvasWidth * profile.maxWidthRatio;
  const y = profile.preferredY * 100;

  return transcript.map((item) => {
    if (bilingual) {
      const source = fitLines(item.text, 1, maxWidth, secondFontSize);
      const translated = fitLines(item.translated?.trim() || item.text, 1, maxWidth, baseFontSize);
      const text = `${translated.lines[0]}\n${source.lines[0]}`;
      const lines = [translated.lines[0], source.lines[0]];
      return {
        ...item,
        text,
        lines,
        translatedLines: translated.lines,
        fontSize: Math.min(translated.fontSize, source.fontSize),
        secondaryFontSize: source.fontSize,
        x: 50,
        y,
        maxWidth,
        style: resolvedStyle(Math.min(translated.fontSize, source.fontSize), y, true),
        quality: quality({ ...item, text }, lines, Math.min(translated.fontSize, source.fontSize), maxWidth, y, project),
      };
    }

    const fitted = fitLines(item.text, profile.maxLines, maxWidth, baseFontSize);
    const lines = fitted.lines;
    const text = lines.join("\n");
    return {
      ...item,
      text,
      lines,
      fontSize: fitted.fontSize,
      secondaryFontSize: fitted.fontSize,
      x: 50,
      y,
      maxWidth,
      style: resolvedStyle(fitted.fontSize, y, false),
      quality: quality({ ...item, text }, lines, fitted.fontSize, maxWidth, y, project),
    };
  });
}


export type SubtitleTrackRole = "single" | "source" | "target";

function roleY(project: Project, role: SubtitleTrackRole) {
  if (role === "single") return subtitleLayoutProfile(project, false).preferredY * 100;
  if (project.ratio === "16:9") return role === "target" ? 80 : 88;
  if (project.ratio === "1:1") return role === "target" ? 73 : 82;
  return role === "target" ? 66 : 74;
}

export function layoutSubtitleTrack(
  project: Project,
  transcript: Array<TimedSentence & { translated?: string | null }>,
  role: SubtitleTrackRole,
): LayoutedSubtitle[] {
  if (role === "single") return layoutTranscriptSubtitles(project, transcript, false);
  const profile = subtitleLayoutProfile(project, true);
  const maxWidth = profile.canvasWidth * profile.maxWidthRatio;
  const baseSize = role === "target" ? primaryFontSize(profile) : secondaryFontSize(profile);
  const maxLines = role === "target" ? 2 : 1;
  const y = roleY(project, role);
  return transcript.map((item) => {
    const sourceText = role === "target" ? (item.translated?.trim() || item.text) : item.text;
    const fitted = fitLines(sourceText, maxLines, maxWidth, baseSize);
    const text = fitted.lines.join("\n");
    const style = resolvedStyle(fitted.fontSize, y, true);
    if (role === "source") {
      style.color = "#D7D9D5";
      style.strokeWidth = 1;
      style.highlightColor = "#D7D9D5";
    }
    return {
      ...item,
      text,
      lines: fitted.lines,
      fontSize: fitted.fontSize,
      secondaryFontSize: fitted.fontSize,
      x: 50,
      y,
      maxWidth,
      style,
      quality: quality({ ...item, text }, fitted.lines, fitted.fontSize, maxWidth, y, project),
    };
  });
}
