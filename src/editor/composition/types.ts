import type { SubtitleStyle } from "../../types";

export type LayoutRole =
  | "background"
  | "media"
  | "title"
  | "subtitle"
  | "captionPrimary"
  | "captionSecondary"
  | "plate";

export type LayoutRegion = {
  role: LayoutRole;
  /** 归一化矩形，单位 %，相对画布 */
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  fit?: "cover" | "contain";
  fill?: string;
  style?: Partial<SubtitleStyle>;
};

export type CompositionTemplate = {
  id: string;
  name: string;
  description: string;
  canvasRatio: "9:16" | "16:9" | "1:1";
  /**
   * 主画面素材搜索/评分比例。
   * 可与 canvasRatio 不同：知识卡片画布 9:16，但中间条带要 16:9 横版素材。
   * 缺省时回退 canvasRatio。
   */
  mediaRatio?: "9:16" | "16:9" | "1:1";
  regions: LayoutRegion[];
  requires: {
    titles?: boolean;
    bilingualCaptions?: boolean;
  };
};

export type CompositionContent = {
  mainTitle?: string;
  subTitle?: string;
};

export type ResolvedVisualBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  fit: "cover" | "contain";
  rotation: number;
  opacity: number;
};
