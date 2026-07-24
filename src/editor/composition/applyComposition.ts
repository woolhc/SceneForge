import type { Clip, Project, SubtitleStyle, Track } from "../../types";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_TEXT_LAYER_STYLE, DEFAULT_TRANSFORM } from "../../types";
import { projectOutputDuration } from "../projectDuration";
import { extractTitlesFromScript } from "./extractTitles";
import { regionToTransform } from "./regionToTransform";
import type { CompositionContent, CompositionTemplate, LayoutRegion } from "./types";

export const COMP_TITLE_ID = "comp-title-main";
export const COMP_SUBTITLE_ID = "comp-title-sub";
/** 主标题专用文字轨（稳定 id，便于幂等重套版式） */
export const COMP_TITLE_TRACK_ID = "track_comp_title";
/** 副标题专用文字轨 */
export const COMP_SUBTITLE_TRACK_ID = "track_comp_subtitle";
/** 动态模糊背景视频轨（克隆主画面，全画布 cover + blur） */
export const COMP_BG_TRACK_ID = "track_comp_bg";
/** 背景 clip id 前缀：comp-bg-{sourceClipId} */
export const COMP_BG_CLIP_PREFIX = "comp-bg-";

const BG_BLUR_INTENSITY = 80;
const BG_BRIGHTNESS = -38;

function ensureNamedTrack(
  project: Project,
  trackId: string,
  name: string,
  kind: Track["kind"],
  extras: Partial<Track> = {},
): { project: Project; trackId: string } {
  const existing = project.tracks.find((track) => track.id === trackId);
  if (existing) {
    if (existing.kind === kind && existing.name === name) {
      return { project, trackId };
    }
    return {
      project: {
        ...project,
        tracks: project.tracks.map((track) =>
          track.id === trackId ? { ...track, kind, name, ...extras } : track,
        ),
      },
      trackId,
    };
  }

  const maxOrder = project.tracks.reduce((max, track) => Math.max(max, track.order), -1);
  const track: Track = {
    id: trackId,
    kind,
    name,
    order: maxOrder + 1,
    muted: false,
    locked: false,
    ...extras,
  };
  return {
    project: { ...project, tracks: [...project.tracks, track] },
    trackId,
  };
}

function ensureNamedTextTrack(
  project: Project,
  trackId: string,
  name: string,
): { project: Project; trackId: string } {
  return ensureNamedTrack(project, trackId, name, "text");
}

function regionCenterStyle(region: LayoutRegion): Partial<SubtitleStyle> {
  return {
    position: "custom",
    x: region.x + region.width / 2,
    y: region.y + region.height / 2,
    ...(region.style ?? {}),
  };
}

function makeTextClip(
  id: string,
  trackId: string,
  text: string,
  duration: number,
  region: LayoutRegion,
  baseStyle: SubtitleStyle,
): Clip {
  const style: SubtitleStyle = {
    ...baseStyle,
    ...regionCenterStyle(region),
  };
  return {
    id,
    trackId,
    sourceId: null,
    startOnTrack: 0,
    duration: Math.max(0.5, duration),
    sourceIn: 0,
    sourceOut: Math.max(0.5, duration),
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    text,
    subtitleStyle: style,
    transform: null,
    transitionIn: null,
    transitionOut: null,
  };
}

function isCompositionBgClip(clip: Clip): boolean {
  return clip.trackId === COMP_BG_TRACK_ID || clip.id.startsWith(COMP_BG_CLIP_PREFIX);
}

function mainVideoTrackIds(project: Project): Set<string> {
  return new Set(
    project.tracks
      .filter((track) => track.kind === "video" && track.id !== COMP_BG_TRACK_ID)
      .map((track) => track.id),
  );
}

function applyMediaTransforms(project: Project, mediaRegion: LayoutRegion | undefined): Project {
  if (!mediaRegion) return project;
  const videoTrackIds = mainVideoTrackIds(project);
  const transform = regionToTransform(mediaRegion);
  return {
    ...project,
    clips: project.clips.map((clip) =>
      videoTrackIds.has(clip.trackId)
        ? { ...clip, transform: { ...transform } }
        : clip,
    ),
  };
}

function applyCaptionStyles(project: Project, template: CompositionTemplate): Project {
  const primary = template.regions.find((region) => region.role === "captionPrimary");
  const secondary = template.regions.find((region) => region.role === "captionSecondary");
  if (!primary && !secondary) return project;

  const subtitleTrackIds = new Set(
    project.tracks.filter((track) => track.kind === "subtitle").map((track) => track.id),
  );

  return {
    ...project,
    clips: project.clips.map((clip) => {
      if (!subtitleTrackIds.has(clip.trackId)) return clip;
      const role = clip.subtitleRole;
      // target / 无 role → primary；source → secondary
      const region =
        role === "source" ? secondary ?? primary : primary ?? secondary;
      if (!region) return clip;
      const nextStyle: SubtitleStyle = {
        ...(clip.subtitleStyle ?? DEFAULT_SUBTITLE_STYLE),
        ...regionCenterStyle(region),
      };
      return { ...clip, subtitleStyle: nextStyle };
    }),
  };
}

function stripCompositionOwnedClips(project: Project): Project {
  return {
    ...project,
    clips: project.clips.filter(
      (clip) =>
        clip.id !== COMP_TITLE_ID
        && clip.id !== COMP_SUBTITLE_ID
        && !isCompositionBgClip(clip),
    ),
  };
}

/** 去掉版式专用空轨（切回 standard-fill 时清理） */
function stripCompositionOwnedTracks(project: Project): Project {
  const owned = new Set([COMP_TITLE_TRACK_ID, COMP_SUBTITLE_TRACK_ID, COMP_BG_TRACK_ID]);
  const remainingClips = project.clips.filter((clip) => !owned.has(clip.trackId) && !isCompositionBgClip(clip));
  const usedTrackIds = new Set(remainingClips.map((clip) => clip.trackId));
  return {
    ...project,
    clips: remainingClips,
    tracks: project.tracks.filter(
      (track) => !owned.has(track.id) || usedTrackIds.has(track.id),
    ),
  };
}

function existingClipText(project: Project, clipId: string): string | undefined {
  const text = project.clips.find((clip) => clip.id === clipId)?.text?.trim();
  return text || undefined;
}

function applyTitleLayers(
  project: Project,
  template: CompositionTemplate,
  content: CompositionContent,
  duration: number,
): Project {
  const titleRegion = template.regions.find((region) => region.role === "title");
  const subRegion = template.regions.find((region) => region.role === "subtitle");
  if (!titleRegion && !subRegion) return project;

  // 只清旧标题 clip，保留背景等其他 composition 层
  let next: Project = {
    ...project,
    clips: project.clips.filter(
      (clip) => clip.id !== COMP_TITLE_ID && clip.id !== COMP_SUBTITLE_ID,
    ),
  };
  const clips = [...next.clips];

  if (titleRegion) {
    const ensured = ensureNamedTextTrack(next, COMP_TITLE_TRACK_ID, "主标题");
    next = ensured.project;
    clips.push(
      makeTextClip(
        COMP_TITLE_ID,
        ensured.trackId,
        content.mainTitle?.trim() || "主标题",
        duration,
        titleRegion,
        { ...DEFAULT_TEXT_LAYER_STYLE, ...(titleRegion.style as SubtitleStyle) },
      ),
    );
  }

  if (subRegion) {
    const ensured = ensureNamedTextTrack(next, COMP_SUBTITLE_TRACK_ID, "副标题");
    next = ensured.project;
    clips.push(
      makeTextClip(
        COMP_SUBTITLE_ID,
        ensured.trackId,
        content.subTitle?.trim() || "副标题",
        duration,
        subRegion,
        { ...DEFAULT_TEXT_LAYER_STYLE, ...(subRegion.style as SubtitleStyle) },
      ),
    );
  }

  return { ...next, clips };
}

/**
 * 克隆主视频轨片段到背景轨：全画布 cover + 强模糊 + 压暗。
 * 背景轨 order 更高 → 渲染图中排在前面 → 作为 base 垫底；主画面为 overlay 中带。
 */
function applyBackgroundLayer(project: Project, template: CompositionTemplate): Project {
  const bgRegion = template.regions.find((region) => region.role === "background");
  const mediaRegion = template.regions.find((region) => region.role === "media");
  if (!bgRegion || !mediaRegion) return project;
  // 主画面已是全画布时无需额外背景层
  if (mediaRegion.width >= 99.5 && mediaRegion.height >= 99.5) return project;

  const mainIds = mainVideoTrackIds(project);
  const mainClips = project.clips.filter(
    (clip) => mainIds.has(clip.trackId) && clip.sourceId,
  );
  if (mainClips.length === 0) return project;

  const ensured = ensureNamedTrack(project, COMP_BG_TRACK_ID, "背景", "video", {
    muted: true,
  });
  let next = ensured.project;

  // 保证背景轨 order 高于主视频轨 → 成为 visualLayers[0] base
  const maxMainOrder = next.tracks
    .filter((track) => mainIds.has(track.id))
    .reduce((max, track) => Math.max(max, track.order), -1);
  next = {
    ...next,
    tracks: next.tracks.map((track) =>
      track.id === COMP_BG_TRACK_ID && track.order <= maxMainOrder
        ? { ...track, order: maxMainOrder + 1, muted: true }
        : track.id === COMP_BG_TRACK_ID
          ? { ...track, muted: true }
          : track,
    ),
  };

  const bgTransform = {
    ...DEFAULT_TRANSFORM,
    x: 50,
    y: 50,
    scale: 100,
    width: 100,
    height: 100,
    fit: "cover" as const,
    opacity: 100,
  };

  const bgClips: Clip[] = mainClips.map((clip) => ({
    ...clip,
    id: `${COMP_BG_CLIP_PREFIX}${clip.id}`,
    trackId: COMP_BG_TRACK_ID,
    volume: 0,
    fadeIn: 0,
    fadeOut: 0,
    brightness: BG_BRIGHTNESS,
    contrast: 5,
    saturation: 15,
    transform: { ...bgTransform },
    visualEffects: [{ kind: "blur", intensity: BG_BLUR_INTENSITY }],
    text: null,
    subtitleStyle: null,
    words: null,
    subtitleGroupId: null,
    subtitleRole: null,
    subtitleLanguage: null,
    transitionIn: null,
    transitionOut: null,
    mask: null,
    keyframes: null,
  }));

  const withoutOldBg = next.clips.filter((clip) => !isCompositionBgClip(clip));
  return { ...next, clips: [...withoutOldBg, ...bgClips] };
}

function resetMediaToFullFrame(project: Project): Project {
  const videoTrackIds = mainVideoTrackIds(project);
  return {
    ...project,
    clips: project.clips.map((clip) =>
      videoTrackIds.has(clip.trackId)
        ? {
            ...clip,
            transform: {
              ...DEFAULT_TRANSFORM,
              fit: "cover" as const,
              width: 100,
              height: 100,
            },
          }
        : clip,
    ),
  };
}

/**
 * 将合成版式应用到项目：写入 composition 元数据、主画面盒模型、动态背景、标题层、字幕位置。
 * 幂等：重复应用会替换 composition 拥有的标题/背景 clip，不会叠加。
 * 主/副标题各占独立文字轨，可在时间线点选后改文案与样式。
 */
export function applyComposition(
  project: Project,
  template: CompositionTemplate,
  content: CompositionContent = {},
): Project {
  const heuristic = template.requires.titles ? extractTitlesFromScript(project.script) : {};
  // 优先：显式 content → 已有 clip 文案（保护用户编辑）→ 启发式
  const titles = template.requires.titles
    ? {
        mainTitle:
          content.mainTitle?.trim()
          || existingClipText(project, COMP_TITLE_ID)
          || heuristic.mainTitle,
        subTitle:
          content.subTitle?.trim()
          || existingClipText(project, COMP_SUBTITLE_ID)
          || heuristic.subTitle,
      }
    : {
        mainTitle: content.mainTitle,
        subTitle: content.subTitle,
      };

  let next: Project = {
    ...project,
    ratio: template.canvasRatio,
    composition: {
      templateId: template.id,
      content: titles,
      appliedAt: new Date().toISOString(),
    },
  };

  if (template.id === "standard-fill") {
    next = stripCompositionOwnedTracks(next);
    next = resetMediaToFullFrame(next);
    // 标准铺满不改字幕位置，保留 layoutSubtitles / 用户已有样式
    return next;
  }

  const duration = Math.max(projectOutputDuration(next), 1);
  const mediaRegion = template.regions.find((region) => region.role === "media");

  // 先清 composition 拥有层，再写媒体几何 / 背景 / 标题 / 字幕
  next = stripCompositionOwnedClips(next);
  next = applyMediaTransforms(next, mediaRegion);
  next = applyBackgroundLayer(next, template);
  next = applyTitleLayers(next, template, titles, duration);
  next = applyCaptionStyles(next, template);
  return next;
}
