import type { Project, TrackKind } from "../types";

export const TRACK_KIND_LABELS: Record<TrackKind, string> = {
  video: "视频",
  image: "图片",
  voiceover: "配音",
  audio: "音频",
  subtitle: "字幕",
  text: "文字",
};

export function nextTrackName(project: Project, kind: TrackKind) {
  const sameKindCount = project.tracks.filter((track) => track.kind === kind).length;
  const label = TRACK_KIND_LABELS[kind];
  return sameKindCount > 0 ? `${label} ${sameKindCount + 1}` : label;
}

export function toggleTrackMuted(project: Project, trackId: string) {
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.id === trackId ? { ...track, muted: !track.muted } : track,
    ),
  };
}

export function toggleTrackLocked(project: Project, trackId: string) {
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.id === trackId ? { ...track, locked: !track.locked } : track,
    ),
  };
}

export function toggleTrackHidden(project: Project, trackId: string) {
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.id === trackId ? { ...track, hidden: !track.hidden } : track,
    ),
  };
}

/** 项目是否已有配音轨片段（有则新建视频默认静音，避免原声与旁白叠音/接缝电音）。 */
export function projectHasVoiceoverClips(project: Project): boolean {
  const voiceoverTrackIds = new Set(
    project.tracks.filter((track) => track.kind === "voiceover").map((track) => track.id),
  );
  if (voiceoverTrackIds.size === 0) return false;
  return project.clips.some((clip) => voiceoverTrackIds.has(clip.trackId));
}

/**
 * 新建视频/图片轨片段时的默认音量。
 * 已有配音时默认 0（用户可手动开原声）；无配音时保持 1。
 */
export function defaultVideoClipVolume(project: Project): number {
  return projectHasVoiceoverClips(project) ? 0 : 1;
}

/** 一键静音所有视频轨片段的原声（volume=0），常用于导入配音后清除素材自带声音。 */
export function muteAllVideoClips(project: Project) {
  const videoTrackIds = new Set(
    project.tracks.filter((track) => track.kind === "video").map((track) => track.id),
  );
  return {
    ...project,
    clips: project.clips.map((clip) =>
      videoTrackIds.has(clip.trackId) && clip.volume !== 0 ? { ...clip, volume: 0 } : clip,
    ),
  };
}

export function moveTrack(project: Project, trackId: string, direction: "up" | "down") {
  const sorted = [...project.tracks].sort((a, b) => a.order - b.order);
  const index = sorted.findIndex((track) => track.id === trackId);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= sorted.length) return null;
  const current = sorted[index];
  const target = sorted[targetIndex];
  return {
    ...project,
    tracks: project.tracks.map((track) => {
      if (track.id === current.id) return { ...track, order: target.order };
      if (track.id === target.id) return { ...track, order: current.order };
      return track;
    }),
  };
}

/** 删除轨道 + 该轨所有 clip */
export function deleteTrack(project: Project, trackId: string) {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) return null;
  return {
    ...project,
    tracks: project.tracks.filter((t) => t.id !== trackId),
    clips: project.clips.filter((c) => c.trackId !== trackId),
  };
}
