import type { Project } from "../../types";
import { measureTextWidth } from "./textMeasure";
import {
  subtitleDocumentFromProject,
  type SubtitleCueDocument,
} from "./document";
import { subtitleLayoutProfile } from "./profiles";
import { resolveSubtitleAnchor } from "./styleContract";
import type { SubtitleQualityIssue } from "./types";

export type SubtitleCueQualityIssue = SubtitleQualityIssue & {
  cueId: string;
};

function readableCharacters(text: string) {
  return [...text].filter((character) => !/\s/.test(character)).length;
}

export function inspectSubtitleCue(
  project: Project,
  cue: SubtitleCueDocument,
): SubtitleCueQualityIssue[] {
  const profile = subtitleLayoutProfile(project, cue.groupId !== null);
  const maxWidth = profile.canvasWidth * profile.maxWidthRatio;
  const lines = cue.text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const duration = cue.end - cue.start;
  const cps = readableCharacters(cue.text) / Math.max(0.1, duration);
  const { y } = resolveSubtitleAnchor(cue.style);
  const issues: SubtitleCueQualityIssue[] = [];
  const add = (issue: SubtitleQualityIssue) =>
    issues.push({ ...issue, cueId: cue.id });

  if (lines.length > profile.maxLines)
    add({
      type: "too_many_lines",
      severity: "error",
      message: "字幕超过建议行数",
    });
  if (
    lines.some(
      (line) =>
        measureTextWidth(
          line,
          cue.style.fontFamily,
          cue.style.fontSize,
          700,
          cue.style.letterSpacing,
        ) >
        maxWidth + 1,
    )
  ) {
    add({ type: "too_wide", severity: "error", message: "字幕超出安全宽度" });
  }
  if (cps > profile.maxCps)
    add({
      type: "reading_speed_too_fast",
      severity: "warning",
      message: `阅读速度过快：${cps.toFixed(1)} 字/秒`,
    });
  if (duration < profile.minDuration)
    add({
      type: "duration_too_short",
      severity: "warning",
      message: "字幕展示时间过短",
    });
  if (duration > 5)
    add({
      type: "duration_too_long",
      severity: "info",
      message: "字幕展示时间过长",
    });
  if (lines.length === 2 && Math.min(...lines.map(readableCharacters)) <= 2) {
    add({ type: "orphan_line", severity: "warning", message: "存在孤立短行" });
  }
  if (project.ratio === "9:16" && y > 76)
    add({
      type: "unsafe_region",
      severity: "warning",
      message: "字幕接近竖屏底部 UI 危险区",
    });
  return issues;
}

export function inspectProjectSubtitleQuality(
  project: Project,
): SubtitleCueQualityIssue[] {
  return subtitleDocumentFromProject(project).cues.flatMap((cue) =>
    inspectSubtitleCue(project, cue),
  );
}
