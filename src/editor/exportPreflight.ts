import type { Project } from "../types";

export type ExportPreflightIssue = {
  id: string;
  severity: "error" | "warning";
  title: string;
  description: string;
};

/**
 * 导出前检查项目数据质量（与 API/依赖就绪无关）。
 * error 应阻止导出；warning 提示后仍可继续。
 */
export function projectExportPreflight(project: Project): ExportPreflightIssue[] {
  const issues: ExportPreflightIssue[] = [];

  if (project.clips.length === 0) {
    issues.push({
      id: "empty-timeline",
      severity: "error",
      title: "时间线为空",
      description: "请先添加素材或生成分镜后再导出。",
    });
    return issues;
  }

  const videoTrackIds = new Set(
    project.tracks
      .filter((track) => track.kind === "video" || track.kind === "image")
      .map((track) => track.id),
  );
  const voiceoverTrackIds = new Set(
    project.tracks.filter((track) => track.kind === "voiceover").map((track) => track.id),
  );

  const videoClips = project.clips.filter((clip) => videoTrackIds.has(clip.trackId));
  const voiceoverClips = project.clips.filter((clip) => voiceoverTrackIds.has(clip.trackId));

  const unbound = videoClips.filter((clip) => !clip.sourceId);
  if (unbound.length > 0) {
    issues.push({
      id: "unbound-video",
      severity: "error",
      title: `${unbound.length} 个画面片段未绑定素材`,
      description: "未绑定的片段会导出为黑场，请在时间线中为橙色标记片段补充素材。",
    });
  }

  const hasVoiceoverAudio = voiceoverClips.some((clip) => Boolean(clip.sourceId));
  const liveNativeAudio = videoClips.filter(
    (clip) => Boolean(clip.sourceId) && (clip.volume ?? 1) > 0,
  );
  if (hasVoiceoverAudio && liveNativeAudio.length > 0) {
    issues.push({
      id: "video-native-audio",
      severity: "warning",
      title: `${liveNativeAudio.length} 个视频片段保留了原声`,
      description:
        "与配音同时导出时，视频切点处的原声淡入淡出可能叠出电音感。可用时间线工具栏「静音视频原声」一键关闭。",
    });
  }

  const voiceFxCount = project.clips.filter((clip) => Boolean(clip.voiceEffect)).length;
  if (voiceFxCount > 0) {
    issues.push({
      id: "voice-effect-export-only",
      severity: "warning",
      title: `${voiceFxCount} 个片段使用了变声/音效`,
      description: "变声仅在导出时生效，预览听到的仍是原声。",
    });
  }

  return issues;
}

export function hasBlockingExportIssues(issues: ExportPreflightIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}
