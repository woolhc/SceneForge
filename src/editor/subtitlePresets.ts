import type { SubtitleStyle } from "../types";
import { DEFAULT_SUBTITLE_STYLE } from "../types";

/** 字幕模板预设（剪映式一键应用） */
export type SubtitlePreset = {
  id: string;
  name: string;
  description: string;
  style: Partial<SubtitleStyle>;
};

export const SUBTITLE_PRESETS: SubtitlePreset[] = [
  {
    id: "default",
    name: "默认",
    description: "白字黑描边，底部",
    style: { ...DEFAULT_SUBTITLE_STYLE },
  },
  {
    id: "news",
    name: "新闻字幕",
    description: "中字号白字黑描边，底部",
    style: {
      fontSize: 42,
      color: "#FFFFFF",
      strokeColor: "#000000",
      position: "bottom",
      fontFamily: "Noto Sans SC",
      karaoke: false,
      animationIn: "none",
      animationOut: "none",
    },
  },
  {
    id: "variety",
    name: "综艺花字",
    description: "大字号黄字黑描边，底部",
    style: {
      fontSize: 56,
      color: "#FFD700",
      strokeColor: "#000000",
      position: "bottom",
      fontFamily: "Noto Sans SC",
      karaoke: true,
      highlightColor: "#FF4444",
      animationIn: "scaleIn",
      animationOut: "scaleOut",
      animationDuration: 0.3,
    },
  },
  {
    id: "ins",
    name: "ins风",
    description: "小字号白字无描边，居中",
    style: {
      fontSize: 36,
      color: "#FFFFFF",
      strokeColor: "#000000",
      position: "center",
      fontFamily: "Noto Sans SC",
      karaoke: false,
      animationIn: "fadeIn",
      animationOut: "fadeOut",
      animationDuration: 0.5,
    },
  },
  {
    id: "title",
    name: "标题风",
    description: "超大字号白字阴影，居中",
    style: {
      fontSize: 72,
      color: "#FFFFFF",
      strokeColor: "#000000",
      position: "center",
      fontFamily: "Noto Sans SC",
      karaoke: false,
      animationIn: "scaleIn",
      animationOut: "scaleOut",
      animationDuration: 0.4,
    },
  },
  {
    id: "karaoke",
    name: "卡拉OK",
    description: "逐字高亮，黄底白字",
    style: {
      fontSize: 48,
      color: "#FFFFFF",
      strokeColor: "#000000",
      position: "bottom",
      fontFamily: "Noto Sans SC",
      karaoke: true,
      highlightColor: "#FFD700",
      animationIn: "slideUp",
      animationOut: "slideDown",
      animationDuration: 0.3,
    },
  },
  {
    id: "top",
    name: "顶部字幕",
    description: "白字黑描边，顶部",
    style: {
      fontSize: 44,
      color: "#FFFFFF",
      strokeColor: "#000000",
      position: "top",
      fontFamily: "Noto Sans SC",
      karaoke: false,
      animationIn: "fadeIn",
      animationOut: "fadeOut",
      animationDuration: 0.3,
    },
  },
  {
    id: "pink",
    name: "粉色少女",
    description: "粉字白描边，底部",
    style: {
      fontSize: 48,
      color: "#FF69B4",
      strokeColor: "#FFFFFF",
      position: "bottom",
      fontFamily: "Noto Sans SC",
      karaoke: true,
      highlightColor: "#FF1493",
      animationIn: "scaleIn",
      animationOut: "scaleOut",
      animationDuration: 0.3,
    },
  },
];
