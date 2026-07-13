import type { Clip, Project, TimedSentence, Track, WordCue } from "../types";
import { layoutSubtitleTrack } from "./subtitles/layoutSubtitles";
import { subtitleLayoutProfile } from "./subtitles/profiles";
import { segmentTranscriptForLayout, type SubtitleSegmentationAdvice } from "./subtitles/segmentTranscript";
import type { LayoutedSubtitle, SubtitleQualityIssue } from "./subtitles/types";

export type TranscriptSubtitle = TimedSentence & {
  translated?: string | null;
  words?: WordCue[];
};

export type SubtitleBuildResult = {
  project: Project;
  issueCount: number;
  issues: SubtitleQualityIssue[];
  groupCount: number;
  sourceClipCount: number;
  targetClipCount: number;
};

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function subtitleTrack(name: string): Track {
  return { id: id("track_subtitle"), kind: "subtitle", name, order: 0, muted: false, locked: false };
}

function normalizeTrackOrders(tracks: Track[]): Track[] {
  return tracks.map((track, order) => ({ ...track, order }));
}

function subtitleClip(
  trackId: string,
  item: LayoutedSubtitle,
  metadata: {
    groupId?: string;
    role?: "source" | "target";
    language?: string;
    keepWords?: boolean;
  } = {},
): Clip {
  const duration = Math.max(0.2, item.end - item.start);
  return {
    id: id("subtitle"),
    trackId,
    sourceId: null,
    startOnTrack: item.start,
    duration,
    sourceIn: 0,
    sourceOut: duration,
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    text: item.text,
    subtitleStyle: item.style,
    words: metadata.keepWords && item.words?.length ? item.words : null,
    subtitleGroupId: metadata.groupId ?? null,
    subtitleRole: metadata.role ?? null,
    subtitleLanguage: metadata.language ?? null,
    transitionIn: null,
    transitionOut: null,
  };
}

export function prepareTranscriptSubtitles(
  project: Project,
  transcript: TimedSentence[],
  bilingual: boolean,
  advice?: SubtitleSegmentationAdvice,
): TimedSentence[] {
  return segmentTranscriptForLayout(transcript, subtitleLayoutProfile(project, bilingual), advice);
}

export function buildTranscriptSubtitleProject(
  project: Project,
  transcript: TranscriptSubtitle[],
  bilingual: boolean,
): SubtitleBuildResult {
  const nonSubtitleTrackIds = new Set(project.tracks.filter((track) => track.kind !== "subtitle").map((track) => track.id));
  const nonSubtitleTracks = project.tracks.filter((track) => track.kind !== "subtitle");
  const nonSubtitleClips = project.clips.filter((clip) => nonSubtitleTrackIds.has(clip.trackId));

  if (bilingual) {
    const targetTrack = subtitleTrack("中文字幕");
    const sourceTrack = subtitleTrack("原文字幕");
    const targetLayout = layoutSubtitleTrack(project, transcript, "target");
    const sourceLayout = layoutSubtitleTrack(project, transcript, "source");
    const targetClips: Clip[] = [];
    const sourceClips: Clip[] = [];
    transcript.forEach((_, index) => {
      const groupId = id("subtitle_group");
      const targetItem = targetLayout[index];
      const sourceItem = sourceLayout[index];
      if (targetItem?.translated?.trim()) {
        targetClips.push(subtitleClip(targetTrack.id, targetItem, {
          groupId,
          role: "target",
          language: "zh-CN",
          keepWords: false,
        }));
      }
      if (sourceItem) {
        sourceClips.push(subtitleClip(sourceTrack.id, sourceItem, {
          groupId,
          role: "source",
          language: "source",
          keepWords: true,
        }));
      }
    });
    const issues = [...targetLayout, ...sourceLayout].flatMap((item) => item.quality.issues);
    return {
      project: {
        ...project,
        tracks: normalizeTrackOrders([targetTrack, sourceTrack, ...nonSubtitleTracks]),
        clips: [...nonSubtitleClips, ...targetClips, ...sourceClips],
      },
      issueCount: issues.length,
      issues,
      groupCount: transcript.length,
      sourceClipCount: sourceClips.length,
      targetClipCount: targetClips.length,
    };
  }

  const track = subtitleTrack("字幕");
  const layouted = layoutSubtitleTrack(project, transcript, "single");
  const clips = layouted.map((item) => subtitleClip(track.id, item, {
    role: "source",
    language: "source",
    keepWords: true,
  }));
  const issues = layouted.flatMap((item) => item.quality.issues);
  return {
    project: {
      ...project,
      tracks: normalizeTrackOrders([track, ...nonSubtitleTracks]),
      clips: [...nonSubtitleClips, ...clips],
    },
    issueCount: issues.length,
    issues,
    groupCount: clips.length,
    sourceClipCount: clips.length,
    targetClipCount: 0,
  };
}

export function applyTranscriptSubtitles(
  project: Project,
  transcript: TranscriptSubtitle[],
  bilingual: boolean,
): Project {
  return buildTranscriptSubtitleProject(project, transcript, bilingual).project;
}
