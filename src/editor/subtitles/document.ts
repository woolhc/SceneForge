import type { Clip, Project, SubtitleStyle, Track } from "../../types";
import { normalizeSubtitleStyle } from "./styleContract";

export type SubtitleCueDocument = {
  id: string;
  trackId: string;
  trackName: string;
  trackOrder: number;
  locked: boolean;
  hidden: boolean;
  start: number;
  end: number;
  text: string;
  style: SubtitleStyle;
  words: NonNullable<Clip["words"]>;
  groupId: string | null;
  role: Clip["subtitleRole"];
  language: string | null;
};

export type SubtitleTrackDocument = Pick<
  Track,
  "id" | "name" | "order" | "locked" | "hidden"
> & {
  cueIds: string[];
};

export type SubtitleDocument = {
  tracks: SubtitleTrackDocument[];
  cues: SubtitleCueDocument[];
};

export type SubtitleCuePatch = Partial<
  Pick<
    SubtitleCueDocument,
    | "start"
    | "end"
    | "text"
    | "style"
    | "words"
    | "groupId"
    | "role"
    | "language"
  >
>;

function finite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Creates a stable workbench view without changing the persisted Clip model.
 * All cue ids remain Clip ids so selections and undo/redo can stay project-native.
 */
export function subtitleDocumentFromProject(
  project: Project,
): SubtitleDocument {
  const tracks = project.tracks
    .filter((track) => track.kind === "subtitle")
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const cues = project.clips
    .filter((clip) => trackById.has(clip.trackId))
    .map((clip): SubtitleCueDocument => {
      const track = trackById.get(clip.trackId)!;
      const start = Math.max(0, finite(clip.startOnTrack, 0));
      const duration = Math.max(0.2, finite(clip.duration, 0.2));
      return {
        id: clip.id,
        trackId: clip.trackId,
        trackName: track.name,
        trackOrder: track.order,
        locked: Boolean(track.locked),
        hidden: Boolean(track.hidden),
        start,
        end: start + duration,
        text: clip.text ?? "",
        style: normalizeSubtitleStyle(clip.subtitleStyle),
        words: [...(clip.words ?? [])],
        groupId: clip.subtitleGroupId ?? null,
        role: clip.subtitleRole ?? null,
        language: clip.subtitleLanguage ?? null,
      };
    })
    .sort(
      (a, b) =>
        a.trackOrder - b.trackOrder ||
        a.start - b.start ||
        a.id.localeCompare(b.id),
    );

  return {
    tracks: tracks.map((track) => ({
      id: track.id,
      name: track.name,
      order: track.order,
      locked: Boolean(track.locked),
      hidden: Boolean(track.hidden),
      cueIds: cues
        .filter((cue) => cue.trackId === track.id)
        .map((cue) => cue.id),
    })),
    cues,
  };
}

/**
 * Applies one workbench cue edit back to the existing project Clip. Timing is
 * clamped to the timeline invariants and locked/non-subtitle clips are ignored.
 */
export function applySubtitleCuePatch(
  project: Project,
  cueId: string,
  patch: SubtitleCuePatch,
): Project {
  const clip = project.clips.find((candidate) => candidate.id === cueId);
  const track = clip
    ? project.tracks.find((candidate) => candidate.id === clip.trackId)
    : undefined;
  if (!clip || !track || track.kind !== "subtitle" || track.locked)
    return project;

  const nextStart = Math.max(
    0,
    finite(patch.start ?? clip.startOnTrack, clip.startOnTrack),
  );
  const requestedEnd = finite(
    patch.end ?? clip.startOnTrack + clip.duration,
    clip.startOnTrack + clip.duration,
  );
  const nextEnd = Math.max(nextStart + 0.2, requestedEnd);
  const nextStyle = patch.style
    ? normalizeSubtitleStyle(patch.style)
    : clip.subtitleStyle;
  const nextClip: Clip = {
    ...clip,
    startOnTrack: nextStart,
    duration: nextEnd - nextStart,
    text: patch.text ?? clip.text,
    subtitleStyle: nextStyle,
    words: patch.words ? [...patch.words] : clip.words,
    subtitleGroupId:
      "groupId" in patch ? (patch.groupId ?? null) : clip.subtitleGroupId,
    subtitleRole: "role" in patch ? (patch.role ?? null) : clip.subtitleRole,
    subtitleLanguage:
      "language" in patch ? (patch.language ?? null) : clip.subtitleLanguage,
  };

  return {
    ...project,
    clips: project.clips.map((candidate) =>
      candidate.id === cueId ? nextClip : candidate,
    ),
  };
}

function joinWords(words: NonNullable<Clip["words"]>) {
  return words.reduce((text, word, index) => {
    if (index === 0) return word.text;
    const previous = words[index - 1];
    const needsSpace =
      /[A-Za-z0-9]$/.test(previous.text) && /^[A-Za-z0-9]/.test(word.text);
    return `${text}${needsSpace ? " " : ""}${word.text}`;
  }, "");
}

function subtitleOperationAllowed(project: Project, cueId: string) {
  const clip = project.clips.find((candidate) => candidate.id === cueId);
  const track = clip
    ? project.tracks.find((candidate) => candidate.id === clip.trackId)
    : undefined;
  if (
    !clip ||
    !track ||
    track.kind !== "subtitle" ||
    track.locked ||
    clip.subtitleGroupId
  )
    return null;
  return { clip, track };
}

/** Returns the closest safe word boundary in the cue, or null when the cue cannot be split. */
export function subtitleCueSplitTime(
  clip: Clip,
  playheadTime: number,
): number | null {
  const words = clip.words ?? [];
  if (words.length < 2) return null;
  const start = clip.startOnTrack;
  const end = clip.startOnTrack + clip.duration;
  const candidates = words
    .slice(1)
    .map((word, index) => {
      const previous = words[index];
      const boundary = Math.max(previous.end, Math.min(word.start, end));
      return boundary;
    })
    .filter((boundary) => boundary >= start + 0.2 && boundary <= end - 0.2);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate - playheadTime) < Math.abs(best - playheadTime)
      ? candidate
      : best,
  );
}

export function canSplitSubtitleCue(
  project: Project,
  cueId: string,
  playheadTime: number,
) {
  const target = subtitleOperationAllowed(project, cueId);
  return Boolean(
    target && subtitleCueSplitTime(target.clip, playheadTime) !== null,
  );
}

/**
 * Splits an ungrouped, word-timed subtitle at the closest word boundary.
 * Bilingual groups deliberately stay disabled until paired translation splitting
 * can preserve source/target text fidelity together.
 */
export function splitSubtitleCueAtTime(
  project: Project,
  cueId: string,
  playheadTime: number,
): Project | null {
  const target = subtitleOperationAllowed(project, cueId);
  if (!target) return null;
  const { clip } = target;
  const words = clip.words ?? [];
  const splitTime = subtitleCueSplitTime(clip, playheadTime);
  if (splitTime === null) return null;
  const rightIndex = words.findIndex(
    (word) => word.start >= splitTime - 0.0001,
  );
  if (rightIndex <= 0 || rightIndex >= words.length) return null;

  const leftWords = words.slice(0, rightIndex);
  const rightWords = words.slice(rightIndex);
  const end = clip.startOnTrack + clip.duration;
  const left: Clip = {
    ...clip,
    duration: splitTime - clip.startOnTrack,
    sourceOut: splitTime - clip.startOnTrack,
    text: joinWords(leftWords),
    words: leftWords,
  };
  const rightDuration = end - splitTime;
  const right: Clip = {
    ...clip,
    id: `subtitle_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    startOnTrack: splitTime,
    duration: rightDuration,
    sourceIn: 0,
    sourceOut: rightDuration,
    text: joinWords(rightWords),
    words: rightWords,
  };

  const clips: Clip[] = [];
  for (const candidate of project.clips) {
    if (candidate.id === clip.id) {
      clips.push(left, right);
    } else {
      clips.push(candidate);
    }
  }
  return { ...project, clips };
}

function nextSubtitleCue(project: Project, clip: Clip) {
  return project.clips
    .filter(
      (candidate) =>
        candidate.trackId === clip.trackId && candidate.id !== clip.id,
    )
    .filter(
      (candidate) =>
        candidate.startOnTrack >= clip.startOnTrack + clip.duration - 0.0001,
    )
    .sort(
      (a, b) => a.startOnTrack - b.startOnTrack || a.id.localeCompare(b.id),
    )[0];
}

export function canMergeSubtitleCueWithNext(project: Project, cueId: string) {
  const target = subtitleOperationAllowed(project, cueId);
  if (!target) return false;
  const next = nextSubtitleCue(project, target.clip);
  const nextTrack = next
    ? project.tracks.find((track) => track.id === next.trackId)
    : undefined;
  return Boolean(
    next &&
    nextTrack?.kind === "subtitle" &&
    !nextTrack.locked &&
    !next.subtitleGroupId,
  );
}

/** Merges an ungrouped subtitle cue with the next cue on the same unlocked track. */
export function mergeSubtitleCueWithNext(
  project: Project,
  cueId: string,
): Project | null {
  const target = subtitleOperationAllowed(project, cueId);
  if (!target) return null;
  const { clip } = target;
  const next = nextSubtitleCue(project, clip);
  const nextTrack = next
    ? project.tracks.find((track) => track.id === next.trackId)
    : undefined;
  if (
    !next ||
    nextTrack?.kind !== "subtitle" ||
    nextTrack.locked ||
    next.subtitleGroupId
  )
    return null;

  const mergedWords = [...(clip.words ?? []), ...(next.words ?? [])];
  const mergedEnd = Math.max(
    clip.startOnTrack + clip.duration,
    next.startOnTrack + next.duration,
  );
  const merged: Clip = {
    ...clip,
    duration: mergedEnd - clip.startOnTrack,
    sourceOut: mergedEnd - clip.startOnTrack,
    text: mergedWords.length
      ? joinWords(mergedWords)
      : `${clip.text ?? ""}${clip.text && next.text ? " " : ""}${next.text ?? ""}`,
    words: mergedWords.length ? mergedWords : null,
  };
  return {
    ...project,
    clips: project.clips
      .filter((candidate) => candidate.id !== next.id)
      .map((candidate) => (candidate.id === clip.id ? merged : candidate)),
  };
}
