import type { Clip, Project } from "../types";
import type { SpeedPoint } from "./speedCurve";
import { curveTimelineDuration } from "./speedCurve";
import { splitClipByTimelineTime } from "./clipTimeMap";

export type OperationResult = {
  project: Project;
  selectedClipId: string | null;
  message: string;
};

export function changeClipSpeed(project: Project, clip: Clip, newSpeed: number): OperationResult {
  const sourceDuration = clip.sourceOut - clip.sourceIn;
  const newDuration = Math.max(0.2, sourceDuration / Math.abs(newSpeed));
  const durationDelta = newDuration - clip.duration;
  const clipEnd = clip.startOnTrack + clip.duration;
  let nextClips = project.clips.map((c) =>
    c.id === clip.id ? { ...c, speed: newSpeed, speedCurve: null, duration: newDuration } : c,
  );
  nextClips = rippleTrackAfter(nextClips, clip, clipEnd, durationDelta);
  return {
    project: { ...project, clips: nextClips },
    selectedClipId: clip.id,
    message: `变速 ${newSpeed}x`,
  };
}

export function applySpeedCurvePreset(
  project: Project,
  clip: Clip,
  curve: SpeedPoint[] | null,
  label: string,
): OperationResult {
  const sourceDuration = clip.sourceOut - clip.sourceIn;
  const nextCurve = curve && curve.length > 0 ? curve : null;
  const newDuration = nextCurve
    ? Math.max(0.2, curveTimelineDuration(nextCurve, sourceDuration))
    : Math.max(0.2, sourceDuration / Math.abs(clip.speed || 1));
  const durationDelta = newDuration - clip.duration;
  const clipEnd = clip.startOnTrack + clip.duration;
  let nextClips = project.clips.map((c) =>
    c.id === clip.id ? { ...c, speedCurve: nextCurve, duration: newDuration } : c,
  );
  nextClips = rippleTrackAfter(nextClips, clip, clipEnd, durationDelta);
  return {
    project: { ...project, clips: nextClips },
    selectedClipId: clip.id,
    message: `曲线变速 ${label}`,
  };
}

export function splitVisualClipAtPlayhead(
  project: Project,
  currentTime: number,
  selectedClip: Clip | null,
): OperationResult | null {
  const visualTrackIds = new Set(
    project.tracks
      .filter((track) => track.kind === "video" || track.kind === "image")
      .sort((a, b) => a.order - b.order)
      .map((track) => track.id),
  );
  const targetClip = project.clips.find(
    (clip) =>
      visualTrackIds.has(clip.trackId) &&
      currentTime >= clip.startOnTrack - 0.01 &&
      currentTime < clip.startOnTrack + clip.duration - 0.01,
  ) || selectedClip;
  if (!targetClip) return null;
  const result = splitClipByTimelineTime(targetClip, currentTime);
  if (!result) return null;
  const [first, second] = result;
  return {
    project: {
      ...project,
      clips: project.clips.flatMap((clip) => (clip.id === targetClip.id ? [first, second] : [clip])),
    },
    selectedClipId: first.id,
    message: `已分割（${first.duration.toFixed(1)}s + ${second.duration.toFixed(1)}s）`,
  };
}

export function deleteClip(project: Project, clip: Clip, ripple = true): OperationResult {
  const gap = clip.duration;
  const gapEnd = clip.startOnTrack + clip.duration;
  const newClips = project.clips
    .filter((c) => c.id !== clip.id)
    .map((c) => {
      if (ripple && c.trackId === clip.trackId && c.startOnTrack >= gapEnd - 0.01) {
        return { ...c, startOnTrack: c.startOnTrack - gap };
      }
      return c;
    });
  return {
    project: { ...project, clips: newClips },
    selectedClipId: newClips.find((c) => c.trackId === clip.trackId)?.id ?? null,
    message: ripple ? "已删除片段（推移）" : "已删除片段（保留空隙）",
  };
}

export function deleteClips(project: Project, clipIds: string[], ripple = true): OperationResult {
  const idsToDelete = new Set(clipIds);
  const newClips: Clip[] = [];
  const trackDeleted: Record<string, { start: number; gap: number }[]> = {};
  for (const clip of project.clips) {
    if (idsToDelete.has(clip.id)) {
      trackDeleted[clip.trackId] = trackDeleted[clip.trackId] || [];
      trackDeleted[clip.trackId].push({ start: clip.startOnTrack, gap: clip.duration });
    }
  }
  for (const clip of project.clips) {
    if (idsToDelete.has(clip.id)) continue;
    let offset = 0;
    if (ripple) {
      const deleted = trackDeleted[clip.trackId] || [];
      for (const item of deleted) {
        if (clip.startOnTrack >= item.start - 0.01) offset += item.gap;
      }
    }
    newClips.push(offset > 0 ? { ...clip, startOnTrack: clip.startOnTrack - offset } : clip);
  }
  return {
    project: { ...project, clips: newClips },
    selectedClipId: null,
    message: ripple ? `已删除 ${idsToDelete.size} 个片段（推移）` : `已删除 ${idsToDelete.size} 个片段（保留空隙）`,
  };
}

export function duplicateClip(project: Project, clip: Clip, generateId: () => string): OperationResult {
  const duplicate: Clip = {
    ...structuredClone(clip),
    id: generateId(),
    startOnTrack: clip.startOnTrack + clip.duration,
  };
  return {
    project: { ...project, clips: [...project.clips, duplicate] },
    selectedClipId: duplicate.id,
    message: "已复制片段",
  };
}

export function pasteClipAtTrackEnd(project: Project, clip: Clip, generateId: () => string): OperationResult {
  const trackClips = project.clips.filter((c) => c.trackId === clip.trackId);
  const endTime = trackClips.reduce((max, c) => Math.max(max, c.startOnTrack + c.duration), 0);
  const pasted: Clip = {
    ...structuredClone(clip),
    id: generateId(),
    startOnTrack: endTime,
  };
  return {
    project: { ...project, clips: [...project.clips, pasted] },
    selectedClipId: pasted.id,
    message: "已粘贴片段",
  };
}

export function selectClipIds(
  project: Project | null,
  previousIds: string[],
  id: string,
  additive: boolean,
  range: boolean,
): string[] {
  const selectedClipId = previousIds[0] ?? null;
  if (range && project && selectedClipId) {
    const anchor = project.clips.find((clip) => clip.id === selectedClipId);
    const target = project.clips.find((clip) => clip.id === id);
    if (anchor && target && anchor.trackId === target.trackId) {
      const sameTrack = project.clips
        .filter((clip) => clip.trackId === target.trackId)
        .sort((a, b) => a.startOnTrack - b.startOnTrack);
      const a = sameTrack.findIndex((clip) => clip.id === anchor.id);
      const b = sameTrack.findIndex((clip) => clip.id === target.id);
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a];
        return sameTrack.slice(from, to + 1).map((clip) => clip.id);
      }
    }
  }
  if (!additive) return [id];
  return previousIds.includes(id)
    ? previousIds.filter((existing) => existing !== id)
    : [...previousIds, id];
}

export function selectClipIdsByBox(previousIds: string[], ids: string[], additive: boolean): string[] {
  if (!additive) return ids;
  const next = new Set(previousIds);
  ids.forEach((id) => next.add(id));
  return Array.from(next);
}

function rippleTrackAfter(clips: Clip[], clip: Clip, originalEnd: number, durationDelta: number) {
  return clips.map((candidate) => {
    if (
      candidate.trackId === clip.trackId &&
      candidate.id !== clip.id &&
      candidate.startOnTrack >= originalEnd - 0.05
    ) {
      return { ...candidate, startOnTrack: candidate.startOnTrack + durationDelta };
    }
    return candidate;
  });
}
