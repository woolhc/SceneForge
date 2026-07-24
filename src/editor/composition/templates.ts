import type { CompositionTemplate } from "./types";

export const STANDARD_FILL_TEMPLATE: CompositionTemplate = {
  id: "standard-fill",
  name: "标准铺满",
  description: "画面铺满画布，字幕按默认安全区",
  canvasRatio: "9:16",
  regions: [
    {
      role: "media",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      zIndex: 1,
      fit: "cover",
    },
    {
      role: "captionPrimary",
      x: 8,
      y: 66,
      width: 84,
      height: 8,
      zIndex: 4,
    },
    {
      role: "captionSecondary",
      x: 8,
      y: 74,
      width: 84,
      height: 8,
      zIndex: 4,
    },
  ],
  requires: {},
};

export const KNOWLEDGE_CARD_TEMPLATE: CompositionTemplate = {
  id: "knowledge-card",
  name: "知识卡片",
  description: "上标题 · 中 16:9 视频 · 动态模糊背景 · 下双语字幕",
  canvasRatio: "9:16",
  // 画布竖屏，主画面条带是 16:9 窗口 → 搜/评横版素材
  mediaRatio: "16:9",
  regions: [
    {
      // 语义槽：实际由 applyComposition 克隆主视频做动态模糊垫底
      role: "background",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      zIndex: 0,
      fit: "cover",
    },
    {
      role: "title",
      x: 5,
      y: 6,
      width: 90,
      height: 8,
      zIndex: 3,
      style: {
        fontSize: 56,
        color: "#FFD54A",
        strokeColor: "#1A1200",
        strokeWidth: 3,
        fontFamily: "Noto Sans SC",
        position: "custom",
        x: 50,
        y: 10,
        backgroundColor: "transparent",
        karaoke: false,
      },
    },
    {
      role: "subtitle",
      x: 10,
      y: 14,
      width: 80,
      height: 5,
      zIndex: 3,
      style: {
        fontSize: 28,
        color: "#1A1A1A",
        strokeColor: "transparent",
        strokeWidth: 0,
        fontFamily: "Noto Sans SC",
        position: "custom",
        x: 50,
        y: 16.5,
        backgroundColor: "rgba(255,255,255,0.92)",
        backgroundPadding: 10,
        karaoke: false,
      },
    },
    {
      // 中间 16:9 条带：cover 铺满条带，上下黑边由底层动态模糊视频填满
      role: "media",
      x: 0,
      y: 22,
      width: 100,
      height: 36,
      zIndex: 2,
      fit: "cover",
    },
    {
      role: "captionPrimary",
      x: 4,
      y: 74,
      width: 92,
      height: 8,
      zIndex: 4,
      style: {
        fontSize: 36,
        color: "#FFFFFF",
        highlightColor: "#FFD54A",
        strokeColor: "#000000",
        strokeWidth: 2,
        position: "custom",
        x: 50,
        y: 78,
        backgroundColor: "transparent",
        karaoke: true,
      },
    },
    {
      role: "captionSecondary",
      x: 4,
      y: 84,
      width: 92,
      height: 8,
      zIndex: 4,
      style: {
        fontSize: 32,
        color: "#FFD54A",
        strokeColor: "#000000",
        strokeWidth: 2,
        position: "custom",
        x: 50,
        y: 88,
        backgroundColor: "transparent",
        karaoke: false,
      },
    },
  ],
  requires: {
    titles: true,
    bilingualCaptions: true,
  },
};

const REGISTRY: Record<string, CompositionTemplate> = {
  [STANDARD_FILL_TEMPLATE.id]: STANDARD_FILL_TEMPLATE,
  [KNOWLEDGE_CARD_TEMPLATE.id]: KNOWLEDGE_CARD_TEMPLATE,
};

export function listCompositionTemplates(): CompositionTemplate[] {
  return [STANDARD_FILL_TEMPLATE, KNOWLEDGE_CARD_TEMPLATE];
}

export function getCompositionTemplate(id: string | null | undefined): CompositionTemplate {
  if (id && REGISTRY[id]) return REGISTRY[id];
  return STANDARD_FILL_TEMPLATE;
}

/**
 * 主画面素材应使用的搜索/评分比例。
 * knowledge-card → 16:9；其余 → 画布比例。
 */
export function compositionMediaRatio(
  templateId: string | null | undefined,
  fallbackRatio = "9:16",
): string {
  const template = getCompositionTemplate(templateId);
  return template.mediaRatio ?? template.canvasRatio ?? fallbackRatio;
}
