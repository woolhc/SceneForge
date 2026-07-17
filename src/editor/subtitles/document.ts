import type { Clip, Project, SubtitleStyle, Track } from "../../types";
import type { SubtitleQualityIssueType } from "./types";
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
  if (!clip || !track || track.kind !== "subtitle" || track.locked)
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
  if (!target) return false;
  if (!target.clip.subtitleGroupId)
    return subtitleCueSplitTime(target.clip, playheadTime) !== null;
  return (
    subtitleGroupSplitTime(
      project,
      target.clip.subtitleGroupId,
      playheadTime,
    ) !== null
  );
}

function splitTextAtRatio(
  text: string,
  ratio: number,
): [string, string] | null {
  const characters = [...text];
  if (characters.length < 2) return null;
  const target = Math.max(
    1,
    Math.min(characters.length - 1, Math.round(characters.length * ratio)),
  );
  const candidates = Array.from(
    { length: characters.length - 1 },
    (_, index) => index + 1,
  );
  const punctuation = new Set([
    "，",
    "。",
    "！",
    "？",
    ",",
    ".",
    "!",
    "?",
    " ",
  ]);
  const index = candidates.reduce((best, candidate) => {
    const candidateScore =
      Math.abs(candidate - target) -
      (punctuation.has(characters[candidate - 1]) ? 0.75 : 0);
    const bestScore =
      Math.abs(best - target) -
      (punctuation.has(characters[best - 1]) ? 0.75 : 0);
    return candidateScore < bestScore ? candidate : best;
  }, target);
  const left = characters.slice(0, index).join("").trim();
  const right = characters.slice(index).join("").trim();
  return left && right ? [left, right] : null;
}

function subtitleClipSplitParts(clip: Clip, splitTime: number) {
  const end = clip.startOnTrack + clip.duration;
  if (splitTime < clip.startOnTrack + 0.2 || splitTime > end - 0.2) return null;
  const words = clip.words ?? [];
  const rightIndex = words.findIndex(
    (word) => word.start >= splitTime - 0.0001,
  );
  const leftWords = rightIndex > 0 ? words.slice(0, rightIndex) : [];
  const rightWords = rightIndex > 0 ? words.slice(rightIndex) : [];
  const textParts =
    leftWords.length && rightWords.length
      ? ([joinWords(leftWords), joinWords(rightWords)] as [string, string])
      : splitTextAtRatio(
          clip.text ?? "",
          (splitTime - clip.startOnTrack) / clip.duration,
        );
  return textParts ? { end, leftWords, rightWords, textParts } : null;
}

function splitSubtitleClipAtTime(
  clip: Clip,
  splitTime: number,
  rightGroupId?: string,
): [Clip, Clip] | null {
  const parts = subtitleClipSplitParts(clip, splitTime);
  if (!parts) return null;
  const { end, leftWords, rightWords, textParts } = parts;
  const leftDuration = splitTime - clip.startOnTrack;
  const rightDuration = end - splitTime;
  const left: Clip = {
    ...clip,
    duration: leftDuration,
    sourceOut: leftDuration,
    text: textParts[0],
    words: leftWords.length ? leftWords : null,
  };
  const right: Clip = {
    ...clip,
    id: `subtitle_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    startOnTrack: splitTime,
    duration: rightDuration,
    sourceIn: 0,
    sourceOut: rightDuration,
    text: textParts[1],
    words: rightWords.length ? rightWords : null,
    subtitleGroupId: rightGroupId ?? clip.subtitleGroupId,
  };
  return [left, right];
}

function subtitleGroupSplitTime(
  project: Project,
  groupId: string,
  playheadTime: number,
): number | null {
  const group = project.clips.filter(
    (clip) => clip.subtitleGroupId === groupId,
  );
  const source =
    group.find(
      (clip) =>
        clip.subtitleRole === "source" && (clip.words?.length ?? 0) >= 2,
    ) ?? group.find((clip) => (clip.words?.length ?? 0) >= 2);
  if (!source || group.length < 2) return null;
  const splitTime = subtitleCueSplitTime(source, playheadTime);
  if (splitTime === null) return null;
  for (const clip of group) {
    const track = project.tracks.find(
      (candidate) => candidate.id === clip.trackId,
    );
    if (
      !track ||
      track.kind !== "subtitle" ||
      track.locked ||
      !subtitleClipSplitParts(clip, splitTime)
    )
      return null;
  }
  return splitTime;
}

function splitSubtitleGroupAtTime(
  project: Project,
  groupId: string,
  playheadTime: number,
): Project | null {
  const splitTime = subtitleGroupSplitTime(project, groupId, playheadTime);
  if (splitTime === null) return null;
  const group = project.clips.filter(
    (clip) => clip.subtitleGroupId === groupId,
  );
  const rightGroupId = `${groupId}_split_${Date.now().toString(16)}`;
  const splitById = new Map<string, [Clip, Clip]>();
  for (const clip of group) {
    const track = project.tracks.find(
      (candidate) => candidate.id === clip.trackId,
    );
    if (!track || track.locked) return null;
    const split = splitSubtitleClipAtTime(clip, splitTime, rightGroupId);
    if (!split) return null;
    splitById.set(clip.id, split);
  }
  const clips: Clip[] = [];
  for (const clip of project.clips) {
    const split = splitById.get(clip.id);
    if (split) clips.push(...split);
    else clips.push(clip);
  }
  return { ...project, clips };
}

/** Splits a word-timed single subtitle or a paired bilingual group at one shared boundary. */
export function splitSubtitleCueAtTime(
  project: Project,
  cueId: string,
  playheadTime: number,
): Project | null {
  const target = subtitleOperationAllowed(project, cueId);
  if (!target) return null;
  const { clip } = target;
  if (clip.subtitleGroupId)
    return splitSubtitleGroupAtTime(project, clip.subtitleGroupId, playheadTime);
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

type SubtitlePair = {
  source: Clip;
  target: Clip;
};

type SubtitlePairMerge = {
  current: SubtitlePair;
  next: SubtitlePair;
  start: number;
  end: number;
};

function subtitlePairForGroup(
  project: Project,
  groupId: string,
): SubtitlePair | null {
  const group = project.clips.filter(
    (clip) => clip.subtitleGroupId === groupId,
  );
  if (group.length !== 2) return null;
  const source = group.find((clip) => clip.subtitleRole === "source");
  const target = group.find((clip) => clip.subtitleRole === "target");
  if (!source || !target || source.trackId === target.trackId) return null;
  for (const clip of group) {
    const track = project.tracks.find(
      (candidate) => candidate.id === clip.trackId,
    );
    if (!track || track.kind !== "subtitle" || track.locked) return null;
  }
  return { source, target };
}

function pairedSubtitleMerge(
  project: Project,
  groupId: string,
): SubtitlePairMerge | null {
  const current = subtitlePairForGroup(project, groupId);
  if (!current) return null;
  const nextSource = nextSubtitleCue(project, current.source);
  const nextTarget = nextSubtitleCue(project, current.target);
  if (
    !nextSource?.subtitleGroupId ||
    nextSource.subtitleGroupId !== nextTarget?.subtitleGroupId
  )
    return null;
  const next = subtitlePairForGroup(project, nextSource.subtitleGroupId);
  if (
    !next ||
    next.source.id !== nextSource.id ||
    next.target.id !== nextTarget.id ||
    next.source.trackId !== current.source.trackId ||
    next.target.trackId !== current.target.trackId
  )
    return null;
  return {
    current,
    next,
    start: Math.min(current.source.startOnTrack, current.target.startOnTrack),
    end: Math.max(
      next.source.startOnTrack + next.source.duration,
      next.target.startOnTrack + next.target.duration,
    ),
  };
}

function mergeSubtitleClips(
  current: Clip,
  next: Clip,
  start = current.startOnTrack,
  end = Math.max(
    current.startOnTrack + current.duration,
    next.startOnTrack + next.duration,
  ),
): Clip {
  const words = [...(current.words ?? []), ...(next.words ?? [])];
  return {
    ...current,
    startOnTrack: start,
    duration: end - start,
    sourceOut: end - start,
    text: joinTextFragments([current.text ?? "", next.text ?? ""]),
    words: words.length ? words : null,
  };
}

export function canMergeSubtitleCueWithNext(project: Project, cueId: string) {
  const target = subtitleOperationAllowed(project, cueId);
  if (!target) return false;
  if (target.clip.subtitleGroupId)
    return pairedSubtitleMerge(project, target.clip.subtitleGroupId) !== null;
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

/** Merges a single cue or both members of a bilingual group with their corresponding next cue. */
export function mergeSubtitleCueWithNext(
  project: Project,
  cueId: string,
): Project | null {
  const target = subtitleOperationAllowed(project, cueId);
  if (!target) return null;
  const { clip } = target;
  if (clip.subtitleGroupId) {
    const pair = pairedSubtitleMerge(project, clip.subtitleGroupId);
    if (!pair) return null;
    const mergedById = new Map([
      [
        pair.current.source.id,
        mergeSubtitleClips(
          pair.current.source,
          pair.next.source,
          pair.start,
          pair.end,
        ),
      ],
      [
        pair.current.target.id,
        mergeSubtitleClips(
          pair.current.target,
          pair.next.target,
          pair.start,
          pair.end,
        ),
      ],
    ]);
    const removedIds = new Set([pair.next.source.id, pair.next.target.id]);
    return {
      ...project,
      clips: project.clips
        .filter((candidate) => !removedIds.has(candidate.id))
        .map((candidate) => mergedById.get(candidate.id) ?? candidate),
    };
  }

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

  const merged = mergeSubtitleClips(clip, next);
  return {
    ...project,
    clips: project.clips
      .filter((candidate) => candidate.id !== next.id)
      .map((candidate) => (candidate.id === clip.id ? merged : candidate)),
  };
}

function joinTextFragments(fragments: string[]) {
  return fragments.reduce((text, fragment) => {
    if (!text) return fragment;
    const needsSpace =
      /[A-Za-z0-9]$/.test(text) && /^[A-Za-z0-9]/.test(fragment);
    return `${text}${needsSpace ? " " : ""}${fragment}`;
  }, "");
}

/** Applies deterministic, non-destructive fixes for the quality issues that have a safe local remedy. */
export function applySubtitleCueQuickFix(
  project: Project,
  cueId: string,
  issueType: SubtitleQualityIssueType,
): Project | null {
  const target = subtitleOperationAllowed(project, cueId);
  if (!target) return null;
  const { clip } = target;
  const style = normalizeSubtitleStyle(clip.subtitleStyle);

  switch (issueType) {
    case "unsafe_region":
      return applySubtitleCuePatch(project, cueId, {
        style: { ...style, position: "custom", x: 50, y: 70 },
      });
    case "too_wide":
      return applySubtitleCuePatch(project, cueId, {
        style: {
          ...style,
          fontSize: Math.max(16, Math.floor(style.fontSize * 0.9)),
        },
      });
    case "too_many_lines":
    case "orphan_line": {
      const compact = joinTextFragments(
        clip.text
          ?.split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean) ?? [],
      );
      if (!compact || compact === clip.text) return null;
      return applySubtitleCuePatch(project, cueId, { text: compact });
    }
    default:
      return null;
  }
}
