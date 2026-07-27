import type { Project, Clip, Track, TimedSentencesResult, AiSegment } from "../types";
import { desktopApi } from "../tauri";

/** 模块级 clip/track id 生成（原 App.tsx 的 newClipId/newTrackId 原样搬移） */
let _clipSeq = 0;
export function newClipId(): string {
  _clipSeq += 1;
  return `clip_${Date.now().toString(36)}_${_clipSeq}`;
}

let _trackSeq = 0;
export function newTrackId(kind: string): string {
  _trackSeq += 1;
  return `track_${kind}_${Date.now().toString(36)}_${_trackSeq}`;
}

/** 按 track.order 取第一个匹配 kind 的轨道 id */
export function pickPrimaryTrack(tracks: { id: string; kind: string; order: number }[], kind: string): string | undefined {
  const candidates = tracks.filter((t) => t.kind === kind);
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0].id;
  return [...candidates].sort((a, b) => a.order - b.order)[0].id;
}

/**
 * 把 AI 分镜编排成轨道初始结构（原 App.tsx arrangeSegmentsToClips 原样搬移）。
 * 每个 AiSegment -> 视频 clip（占位） + 配音 clip，三者 startOnTrack 对齐。
 */
export function arrangeSegmentsToClips(
  segments: { text: string; visualQuery: string; estimatedDuration: number; start?: number; end?: number }[],
  tracks: { id: string; kind: string; order: number }[],
): Clip[] {
  const videoTrackId = pickPrimaryTrack(tracks, "video");
  const voiceoverTrackId = pickPrimaryTrack(tracks, "voiceover");
  const clips: Clip[] = [];
  let cursor = 0;
  const isAudioMode = segments.some((s) => (s.start ?? 0) !== 0 || (s.end ?? 0) !== 0);
  for (const [index, seg] of segments.entries()) {
    const hasRealTime = (seg.start ?? 0) !== 0 || (seg.end ?? 0) !== 0;
    const start = hasRealTime ? (seg.start ?? cursor) : cursor;
    const duration = hasRealTime ? ((seg.end ?? 0) - (seg.start ?? 0)) : seg.estimatedDuration;
    if (videoTrackId) {
      const vStart = isAudioMode ? start : cursor;
      const nextStart = isAudioMode ? segments[index + 1]?.start : undefined;
      const vDuration = isAudioMode
        ? Math.max(0.05, (nextStart ?? (seg.end ?? (start + duration))) - start)
        : duration;
      clips.push({
        id: newClipId(),
        trackId: videoTrackId,
        sourceId: null,
        startOnTrack: vStart,
        duration: vDuration,
        sourceIn: 0,
        sourceOut: vDuration,
        speed: 1,
        volume: voiceoverTrackId ? 0 : 1,
        fadeIn: 0,
        fadeOut: 0,
        brightness: 0,
        contrast: 0,
        saturation: 0,
        visualQuery: seg.visualQuery,
        transitionIn: null,
        transitionOut: null,
      });
    }
    if (voiceoverTrackId) {
      clips.push({
        id: newClipId(),
        trackId: voiceoverTrackId,
        sourceId: null,
        startOnTrack: start,
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
        text: seg.text,
        transitionIn: null,
        transitionOut: null,
      });
    }
    cursor = hasRealTime ? (seg.end ?? (cursor + duration)) : cursor + duration;
  }
  return clips;
}

/**
 * 基于音频驱动的时间线构建（原 App.tsx buildAudioDrivenTimeline 原样搬移）。
 * 把转写句子 + AI 分镜编排成 clip，挂上旁白素材，保存并返回更新后的项目。
 */
export async function buildAudioDrivenTimeline(
  baseProject: Project,
  narrationSourceId: string,
  transcript: TimedSentencesResult,
  segments: AiSegment[],
  ratio: string,
  deps: {
    setProject: (project: Project) => void;
    setSelectedClipId: (id: string | null) => void;
    onProjectRef: (project: Project) => void;
    refreshProjects: (id: string) => Promise<void>;
  },
): Promise<Project> {
  const clips = arrangeSegmentsToClips(segments, baseProject.tracks);
  const voiceoverTrackId = pickPrimaryTrack(baseProject.tracks, "voiceover");
  const withoutSegmentVoiceover = voiceoverTrackId
    ? clips.filter((clip) => clip.trackId !== voiceoverTrackId)
    : clips;
  if (voiceoverTrackId) {
    withoutSegmentVoiceover.push({
      id: newClipId(),
      trackId: voiceoverTrackId,
      sourceId: narrationSourceId,
      startOnTrack: 0,
      duration: transcript.totalDuration,
      sourceIn: 0,
      sourceOut: transcript.totalDuration,
      speed: 1,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      brightness: 0,
      contrast: 0,
      saturation: 0,
      transitionIn: null,
      transitionOut: null,
    });
  }
  const saved = await desktopApi.saveProject({
    ...baseProject,
    ratio,
    script: transcript.fullText || baseProject.script,
    clips: withoutSegmentVoiceover,
  });
  deps.onProjectRef(saved);
  deps.setProject(saved);
  deps.setSelectedClipId(saved.clips[0]?.id || null);
  await deps.refreshProjects(saved.id);
  return saved;
}
