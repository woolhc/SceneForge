import type { SubtitleStyle } from "../types";

/**
 * 花字/文字模板（剪映式一键应用，用于独立文本图层）。
 * decoration（背景图/边框图）暂缺素材，先只提供纯样式模板；
 * decorationId 字段占位，接入真实装饰素材后再启用。
 */
export type TextTemplate = {
  id: string;
  name: string;
  category: "标题" | "花字" | "综艺" | "简约";
  style: Partial<SubtitleStyle>;
  decoration?: { backgroundImage?: string; borderImage?: string };
};

export const TEXT_TEMPLATES: TextTemplate[] = [
  {
    id: "text-title-bold",
    name: "醒目标题",
    category: "标题",
    style: {
      fontSize: 72,
      color: "#FFFFFF",
      strokeColor: "#000000",
      strokeWidth: 3,
      position: "center",
      fontFamily: "Noto Sans SC",
      animationIn: "scaleIn",
      animationOut: "scaleOut",
      animationDuration: 0.35,
    },
  },
  {
    id: "text-title-clean",
    name: "简约标题",
    category: "简约",
    style: {
      fontSize: 56,
      color: "#FFFFFF",
      strokeColor: "#000000",
      strokeWidth: 0,
      shadowBlur: 6,
      position: "center",
      fontFamily: "Noto Sans SC",
      animationIn: "fadeIn",
      animationOut: "fadeOut",
      animationDuration: 0.4,
    },
  },
  {
    id: "text-variety-pop",
    name: "综艺爆点",
    category: "综艺",
    style: {
      fontSize: 64,
      color: "#FFD700",
      strokeColor: "#FF4444",
      strokeWidth: 4,
      position: "center",
      fontFamily: "Noto Sans SC",
      animationIn: "popIn",
      animationOut: "popOut",
      animationDuration: 0.3,
    },
  },
  {
    id: "text-variety-shout",
    name: "综艺喊话",
    category: "综艺",
    style: {
      fontSize: 60,
      color: "#FFFFFF",
      strokeColor: "#E91E63",
      strokeWidth: 4,
      position: "bottom",
      fontFamily: "Noto Sans SC",
      animationIn: "bounceIn",
      animationOut: "bounceOut",
      animationDuration: 0.35,
    },
  },
  {
    id: "text-flair-gold",
    name: "金色花字",
    category: "花字",
    style: {
      fontSize: 58,
      color: "#FFD700",
      strokeColor: "#8B4513",
      strokeWidth: 3,
      position: "center",
      fontFamily: "Noto Sans SC",
      animationIn: "floatIn",
      animationOut: "fadeOut",
      animationDuration: 0.4,
    },
  },
  {
    id: "text-flair-neon",
    name: "霓虹花字",
    category: "花字",
    style: {
      fontSize: 58,
      color: "#00F0FF",
      strokeColor: "#FF00E5",
      strokeWidth: 2,
      shadowColor: "#00F0FF",
      shadowBlur: 12,
      position: "center",
      fontFamily: "Noto Sans SC",
      animationIn: "scaleIn",
      animationOut: "fadeOut",
      animationDuration: 0.3,
    },
  },
  {
    id: "text-simple-caption",
    name: "简约副标题",
    category: "简约",
    style: {
      fontSize: 40,
      color: "#FFFFFF",
      strokeColor: "#000000",
      strokeWidth: 1,
      position: "bottom",
      fontFamily: "Noto Sans SC",
      animationIn: "slideUp",
      animationOut: "slideDown",
      animationDuration: 0.3,
    },
  },
];
