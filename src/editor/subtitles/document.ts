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
    subtitleGroupId: patch.groupId ?? clip.subtitleGroupId,
    subtitleRole: patch.role ?? clip.subtitleRole,
    subtitleLanguage: patch.language ?? clip.subtitleLanguage,
  };

  return {
    ...project,
    clips: project.clips.map((candidate) =>
      candidate.id === cueId ? nextClip : candidate,
    ),
  };
}
