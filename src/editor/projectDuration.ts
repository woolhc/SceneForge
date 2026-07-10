import type { Project } from "../types";

export function projectOutputDuration(project: Project | null | undefined): number {
  if (!project) return 0;
  const visibleTrackIds = new Set(
    project.tracks.filter((track) => !track.hidden).map((track) => track.id),
  );
  return project.clips.reduce((duration, clip) => {
    if (!visibleTrackIds.has(clip.trackId)) return duration;
    return Math.max(duration, clip.startOnTrack + Math.max(0, clip.duration));
  }, 0);
}
