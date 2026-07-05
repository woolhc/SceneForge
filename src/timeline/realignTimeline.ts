import type { Clip, Project } from "../types";

/**
 * 时间线重排：以配音轨为"主时间锚"，让视频轨/字幕轨跟随对齐。
 * 支持多视频轨、多配音轨、多字幕轨。
 *
 * 算法：
 * 1. 取所有配音轨的 clip，按 startOnTrack 排序，按各自 duration 首尾相接重排
 *    （多条配音轨时，按轨道顺序合并后排序，视为同一条主时间线）
 * 2. 每个配音 clip 作为"一段叙事"，找到与它对齐的其他轨道 clip
 *    （按原始 startOnTrack 的接近度 + track kind 匹配）
 * 3. 把匹配到的视频/字幕 clip 的 startOnTrack 和 duration 对齐到该配音 clip
 *
 * 用于：生成配音后，配音时长从"预估"变成"真实"，整条时间线按真实时长重排。
 */
export function realignTimeline(project: Project): Project {
  const voiceoverTrackIds = project.tracks
    .filter((t) => t.kind === "voiceover")
    .map((t) => t.id);
  if (voiceoverTrackIds.length === 0) return project;

  // 1. 所有配音 clip 按当前顺序排序，首尾相接重排
  const voiceoverClips = project.clips
    .filter((c) => voiceoverTrackIds.includes(c.trackId))
    .sort((a, b) => a.startOnTrack - b.startOnTrack);

  if (voiceoverClips.length === 0) return project;

  type Segment = {
    voiceClip: Clip;
    originalStart: number;
    newStart: number;
    newDuration: number;
  };

  let cursor = 0;
  const segments: Segment[] = voiceoverClips.map((clip) => {
    const seg: Segment = {
      voiceClip: clip,
      originalStart: clip.startOnTrack,
      newStart: cursor,
      newDuration: clip.duration,
    };
    cursor += clip.duration;
    return seg;
  });

  // 2. 收集所有需要跟随对齐的轨道（视频/字幕/音频，排除配音轨本身）
  const followTrackIds = project.tracks
    .filter((t) => t.kind === "video" || t.kind === "subtitle" || t.kind === "audio")
    .map((t) => t.id);

  // 按轨道分组：每条轨道独立匹配，避免跨轨道误匹配
  function findPeerInTrack(trackId: string, originalStart: number): Clip | undefined {
    return project.clips.find(
      (c) => c.trackId === trackId && Math.abs(c.startOnTrack - originalStart) < 0.5,
    );
  }

  // 3. 重建所有 clip
  const newClips: Clip[] = [];
  const matchedClipIds = new Set<string>();

  for (const seg of segments) {
    // 配音 clip：首尾相接，duration = 音频真实时长（绝不可变）
    newClips.push({
      ...seg.voiceClip,
      startOnTrack: seg.newStart,
      duration: seg.newDuration,
      sourceOut: seg.voiceClip.sourceIn + seg.newDuration,
    });
    matchedClipIds.add(seg.voiceClip.id);

    // 每条跟随轨道独立匹配对齐
    for (const trackId of followTrackIds) {
      const peer = findPeerInTrack(trackId, seg.originalStart);
      if (!peer || matchedClipIds.has(peer.id)) continue;
      matchedClipIds.add(peer.id);

      const source = peer.sourceId ? project.media.find((m) => m.id === peer.sourceId) : undefined;
      const sourceDuration = source?.duration;
      newClips.push({
        ...peer,
        startOnTrack: seg.newStart,
        duration: seg.newDuration,
        // 视频/音频 clip 的 sourceOut 不能超过素材实际时长
        sourceOut: sourceDuration
          ? Math.min(peer.sourceIn + seg.newDuration, sourceDuration)
          : peer.sourceIn + seg.newDuration,
      });
    }
  }

  // 保留未匹配到的 clip（如用户手动添加的、不在三轨对齐关系里的），原样不动
  const unmatched = project.clips.filter((c) => !matchedClipIds.has(c.id));

  return {
    ...project,
    clips: [...newClips, ...unmatched],
  };
}
