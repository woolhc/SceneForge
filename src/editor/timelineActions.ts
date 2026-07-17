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
