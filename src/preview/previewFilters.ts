import type { Clip } from "../types";

/**
 * 预览用 CSS filter，与导出侧 clip_color_filter / visualEffects 语义对齐。
 * 覆盖：brightness/contrast/saturation、命名滤镜、blur/glow 特效。
 */
export function previewCssFilter(clip: Clip | null): string {
  if (!clip) return "none";
  const filters = [
    `brightness(${Math.max(0, 1 + (clip.brightness ?? 0) / 100)})`,
    `contrast(${Math.max(0, 1 + (clip.contrast ?? 0) / 100)})`,
    `saturate(${Math.max(0, 1 + (clip.saturation ?? 0) / 100)})`,
  ];
  switch (clip.filter) {
    case "bw":
      filters.push("grayscale(1)");
      break;
    case "sepia":
      filters.push("sepia(0.8)", "saturate(0.85)");
      break;
    case "warm":
      filters.push("sepia(0.18)", "saturate(1.18)", "hue-rotate(-8deg)");
      break;
    case "cool":
      filters.push("saturate(1.08)", "hue-rotate(10deg)");
      break;
    case "vintage":
      filters.push("sepia(0.35)", "contrast(0.95)", "saturate(0.85)");
      break;
    case "cinematic":
      filters.push("contrast(1.12)", "saturate(0.9)");
      break;
    case "fresh":
      filters.push("brightness(1.04)", "saturate(1.12)");
      break;
    case "moody":
      filters.push("contrast(1.18)", "brightness(0.94)", "saturate(0.85)");
      break;
    case "soft":
      filters.push("contrast(0.94)", "brightness(1.03)", "saturate(0.92)");
      break;
  }

  for (const effect of clip.visualEffects ?? []) {
    const intensity = Math.max(0, Math.min(100, effect.intensity)) / 100;
    if (effect.kind === "blur") {
      // intensity 0-100 → 0-40px，知识卡片背景约 80 → 32px
      filters.push(`blur(${(intensity * 40).toFixed(1)}px)`);
    } else if (effect.kind === "glow") {
      filters.push(`blur(${(1 + intensity * 4).toFixed(1)}px)`);
    } else if (effect.kind === "grayscale") {
      filters.push("grayscale(1)");
    } else if (effect.kind === "invert") {
      filters.push("invert(1)");
    }
  }

  return filters.join(" ");
}
