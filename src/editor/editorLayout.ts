import type { TrackKind } from "../types";

export type EditorMode = "professional" | "simple";
export type ToolTab = "media" | "text" | "audio" | "subtitle" | "transition" | "effects";
export type InspectorTab = "basic" | "visual" | "animation" | "audio" | "subtitle";

export interface ToolTabDefinition {
  id: ToolTab;
  label: string;
}

export const TOOL_TABS: readonly ToolTabDefinition[] = [
  { id: "media", label: "媒体" },
  { id: "text", label: "文本" },
  { id: "audio", label: "音频" },
  { id: "subtitle", label: "字幕" },
  { id: "transition", label: "转场" },
  { id: "effects", label: "特效" },
];

export const TIMELINE_ACTIONS = [
  { id: "split", label: "分割" },
  { id: "delete", label: "删除片段" },
  { id: "copy", label: "复制" },
  { id: "paste", label: "粘贴" },
  { id: "duplicate", label: "复制片段" },
  { id: "track", label: "轨道" },
  { id: "chapter", label: "章节" },
] as const;

export function inspectorTabsForTrack(kind: TrackKind): InspectorTab[] {
  if (kind === "subtitle") return ["basic", "subtitle", "animation"];
  if (kind === "audio" || kind === "voiceover") return ["basic", "audio"];
  if (kind === "video") return ["basic", "visual", "animation", "audio"];
  return ["basic", "visual", "animation"];
}

export function inspectorTabsForSelection(kind: TrackKind, selectedCount: number): InspectorTab[] {
  if (selectedCount > 1) {
    return [kind === "subtitle" ? "subtitle" : "basic"];
  }
  return inspectorTabsForTrack(kind);
}

export function defaultInspectorTabForTrack(kind: TrackKind): InspectorTab {
  if (kind === "subtitle") return "subtitle";
  if (kind === "audio" || kind === "voiceover") return "audio";
  return "basic";
}

export function resolveInspectorTab(kind: TrackKind, requested: InspectorTab): InspectorTab {
  const available = inspectorTabsForTrack(kind);
  return available.includes(requested) ? requested : defaultInspectorTabForTrack(kind);
}

export function audioInspectorCapabilities(kind: TrackKind) {
  return {
    canGenerateVoice: kind === "voiceover",
    canFade: kind === "audio" || kind === "voiceover",
    canReduceNoise: kind === "video" || kind === "audio" || kind === "voiceover",
  };
}

export function editorLayoutsForMode(mode: EditorMode) {
  return mode === "simple"
    ? {
        vertical: { workspace: 72, timeline: 28 },
        horizontal: { tools: 8, preview: 68, inspector: 24 },
      }
    : {
        vertical: { workspace: 62, timeline: 38 },
        horizontal: { tools: 20, preview: 55, inspector: 25 },
      };
}

export function inspectorTabForInteraction(
  interaction: "selection" | "keyframe" | "transform" | "effect",
  kind: TrackKind,
): InspectorTab {
  if (interaction === "keyframe" || interaction === "effect") {
    return resolveInspectorTab(kind, "animation");
  }
  if (interaction === "transform") {
    return resolveInspectorTab(kind, "visual");
  }
  return defaultInspectorTabForTrack(kind);
}
