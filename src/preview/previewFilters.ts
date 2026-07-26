import type { Clip } from "../types";

/**
 * 预览用 CSS filter，与导出侧 clip_color_filter / visualEffects 语义对齐。
 * 覆盖：brightness/contrast/saturation、色温/色调近似、命名滤镜、blur/glow/grayscale/invert 特效。
 * mirror 走 transform（见 previewCssTransformExtra）；vignette 走叠加层（见 previewVignetteOverlay）。
 */
export function previewCssFilter(clip: Clip | null): string {
  if (!clip) return "none";
  const filters = [
    `brightness(${Math.max(0, 1 + (clip.brightness ?? 0) / 100)})`,
    `contrast(${Math.max(0, 1 + (clip.contrast ?? 0) / 100)})`,
    `saturate(${Math.max(0, 1 + (clip.saturation ?? 0) / 100)})`,
  ];

  // 色温/色调 CSS 近似：导出用 colorbalance（rs/rm/rh 等），CSS 无逐通道平衡，
  // 用 sepia+hue-rotate+saturate 组合近似暖冷方向。目标：方向与强度趋势一致。
  const temperature = (clip.temperature ?? 0) / 100; // -1..1，正=暖
  const tint = (clip.tint ?? 0) / 100; // -1..1，正=品红
  if (Math.abs(temperature) > 0.01) {
    if (temperature > 0) {
      filters.push(`sepia(${(temperature * 0.35).toFixed(3)})`, `saturate(${(1 + temperature * 0.15).toFixed(3)})`, `hue-rotate(${(-temperature * 10).toFixed(1)}deg)`);
    } else {
      filters.push(`hue-rotate(${(-temperature * 18).toFixed(1)}deg)`, `saturate(${(1 + temperature * 0.1).toFixed(3)})`);
    }
  }
  if (Math.abs(tint) > 0.01) {
    // 正 tint = 品红（洋红偏移）；负 = 绿
    filters.push(`hue-rotate(${(tint * 12).toFixed(1)}deg)`);
  }

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

/**
 * 需要 transform 表达的特效（mirror=水平翻转，导出为 hflip）。
 * 返回追加到元素 transform 末尾的字符串（含前导空格），无则空串。
 */
export function previewCssTransformExtra(clip: Clip | null): string {
  if (!clip) return "";
  const hasMirror = (clip.visualEffects ?? []).some((effect) => effect.kind === "mirror");
  return hasMirror ? " scaleX(-1)" : "";
}

/**
 * 暗角特效（导出为 vignette 滤镜）的 CSS 近似：inset box-shadow 内阴影。
 * 直接作用在媒体元素上，无需额外 DOM。返回 box-shadow 值；无 vignette 返回空串。
 */
export function previewVignetteBoxShadow(clip: Clip | null): string {
  if (!clip) return "";
  const effect = (clip.visualEffects ?? []).find((item) => item.kind === "vignette");
  if (!effect) return "";
  const intensity = Math.max(0, Math.min(100, effect.intensity)) / 100;
  const spread = Math.round(30 + intensity * 90);
  const alpha = (0.45 + intensity * 0.4).toFixed(2);
  return `inset 0 0 ${spread}px ${Math.round(spread / 2)}px rgba(0,0,0,${alpha})`;
}
