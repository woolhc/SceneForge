import { projectOutputDuration } from "../editor/projectDuration";
import type { Project } from "../types";
import type { RenderCanvas, RenderGraph, RenderLayer } from "./types";

export function logicalCanvasForRatio(ratio: string): RenderCanvas {
  if (ratio === "9:16") return { width: 1080, height: 1920 };
  if (ratio === "1:1") return { width: 1080, height: 1080 };
  return { width: 1920, height: 1080 };
}

export function compileRenderGraph(project: Project): RenderGraph {
  const snapshot = structuredClone(project);
  const tracks = new Map(snapshot.tracks.filter((track) => !track.hidden).map((track) => [track.id, track]));
  const media = new Map(snapshot.media.map((source) => [source.id, source]));
  const layers: RenderLayer[] = snapshot.clips.flatMap((clip) => {
    const track = tracks.get(clip.trackId);
    if (!track) return [];
    return [{
      id: clip.id,
      trackId: track.id,
      trackKind: track.kind,
      trackOrder: track.order,
      trackMuted: track.muted,
      clip,
      media: clip.sourceId ? media.get(clip.sourceId) ?? null : null,
    }];
  });
  layers.sort((left, right) =>
    right.trackOrder - left.trackOrder ||
    left.clip.startOnTrack - right.clip.startOnTrack ||
    left.id.localeCompare(right.id),
  );
  return {
    duration: projectOutputDuration(snapshot),
    canvas: logicalCanvasForRatio(snapshot.ratio),
    layers,
  };
}
