/**
 * Google Fonts 字体配置。
 * 预览时通过 CSS link 动态加载；渲染烧录时需要本地字体文件（后续接入）。
 */

export type FontOption = {
  /** CSS font-family 名称（也是渲染时的字体名） */
  family: string;
  /** 显示名称 */
  label: string;
  /** Google Fonts URL 参数（用于预览动态加载） */
  googleFontUrl?: string;
};

/**
 * 可选字体列表（50+ 种），涵盖：
 * - 中文：思源系列、站酷系列、书法手写、宋体、楷体等
 * - 英文：无衬线、衬线、手写、装饰、等宽
 * 全部来自 Google Fonts（免费可商用）。
 */
export const FONT_OPTIONS: FontOption[] = [
  // ========== 中文 - 常用无衬线 ==========
  { family: "Noto Sans SC", label: "思源黑体", googleFontUrl: "Noto+Sans+SC:wght@400;700;900" },
  { family: "Noto Sans TC", label: "思源黑体（繁体）", googleFontUrl: "Noto+Sans+TC:wght@400;700;900" },

  // ========== 中文 - 衬线/宋体 ==========
  { family: "Noto Serif SC", label: "思源宋体", googleFontUrl: "Noto+Serif+SC:wght@400;700;900" },
  { family: "Noto Serif TC", label: "思源宋体（繁体）", googleFontUrl: "Noto+Serif+TC:wght@400;700;900" },
  { family: "Ma Shan Zheng", label: "马善政楷书", googleFontUrl: "Ma+Shan+Zheng" },
  { family: "ZCOOL XiaoWei", label: "站酷小薇", googleFontUrl: "ZCOOL+XiaoWei" },

  // ========== 中文 - 手写/活泼 ==========
  { family: "ZCOOL KuaiLe", label: "站酷快乐体", googleFontUrl: "ZCOOL+KuaiLe" },
  { family: "ZCOOL QingKe HuangYou", label: "站酷庆科黄油体", googleFontUrl: "ZCOOL+QingKe+HuangYou" },
  { family: "Long Cang", label: "龙藏行书", googleFontUrl: "Long+Cang" },
  { family: "Liu Jian Mao Cao", label: "刘建毛草", googleFontUrl: "Liu+Jian+Mao+Cao" },
  { family: "Zhi Mang Xing", label: "志莽行书", googleFontUrl: "Zhi+Mang+Xing" },
  { family: "LXGW WenKai", label: "霞鹜文楷", googleFontUrl: "LXGW+WenKai+TC:wght@400;700" },

  // ========== 中文 - 圆润/可爱 ==========

  // ========== 英文 - 无衬线 ==========
  { family: "Roboto", label: "Roboto", googleFontUrl: "Roboto:wght@400;700;900" },
  { family: "Open Sans", label: "Open Sans", googleFontUrl: "Open+Sans:wght@400;700" },
  { family: "Montserrat", label: "Montserrat", googleFontUrl: "Montserrat:wght@400;700;900" },
  { family: "Poppins", label: "Poppins", googleFontUrl: "Poppins:wght@400;700;900" },
  { family: "Inter", label: "Inter", googleFontUrl: "Inter:wght@400;700;900" },
  { family: "Lato", label: "Lato", googleFontUrl: "Lato:wght@400;700;900" },
  { family: "Raleway", label: "Raleway", googleFontUrl: "Raleway:wght@400;700;900" },
  { family: "Nunito", label: "Nunito", googleFontUrl: "Nunito:wght@400;700;900" },
  { family: "Ubuntu", label: "Ubuntu", googleFontUrl: "Ubuntu:wght@400;700" },
  { family: "Work Sans", label: "Work Sans", googleFontUrl: "Work+Sans:wght@400;700;900" },
  { family: "DM Sans", label: "DM Sans", googleFontUrl: "DM+Sans:wght@400;700" },

  // ========== 英文 - 衬线 ==========
  { family: "Playfair Display", label: "Playfair Display", googleFontUrl: "Playfair+Display:wght@400;700;900" },
  { family: "Merriweather", label: "Merriweather", googleFontUrl: "Merriweather:wght@400;700" },
  { family: "Lora", label: "Lora", googleFontUrl: "Lora:wght@400;700" },
  { family: "PT Serif", label: "PT Serif", googleFontUrl: "PT+Serif:wght@400;700" },
  { family: "Source Serif Pro", label: "Source Serif", googleFontUrl: "Source+Serif+4:wght@400;700" },
  { family: "Cormorant Garamond", label: "Cormorant", googleFontUrl: "Cormorant+Garamond:wght@400;700" },
  { family: "EB Garamond", label: "EB Garamond", googleFontUrl: "EB+Garamond:wght@400;700" },

  // ========== 英文 - 浓缩/标题 ==========
  { family: "Oswald", label: "Oswald", googleFontUrl: "Oswald:wght@400;700" },
  { family: "Bebas Neue", label: "Bebas Neue", googleFontUrl: "Bebas+Neue" },
  { family: "Anton", label: "Anton", googleFontUrl: "Anton" },
  { family: "Archivo Black", label: "Archivo Black", googleFontUrl: "Archivo+Black" },
  { family: "Teko", label: "Teko", googleFontUrl: "Teko:wght@400;700" },
  { family: "Russo One", label: "Russo One", googleFontUrl: "Russo+One" },

  // ========== 英文 - 手写/装饰 ==========
  { family: "Pacifico", label: "Pacifico", googleFontUrl: "Pacifico" },
  { family: "Dancing Script", label: "Dancing Script", googleFontUrl: "Dancing+Script:wght@400;700" },
  { family: "Caveat", label: "Caveat", googleFontUrl: "Caveat:wght@400;700" },
  { family: "Sacramento", label: "Sacramento", googleFontUrl: "Sacramento" },
  { family: "Permanent Marker", label: "Permanent Marker", googleFontUrl: "Permanent+Marker" },
  { family: "Shadows Into Light", label: "Shadows Into Light", googleFontUrl: "Shadows+Into+Light" },
  { family: "Indie Flower", label: "Indie Flower", googleFontUrl: "Indie+Flower" },
  { family: "Gloria Hallelujah", label: "Gloria Hallelujah", googleFontUrl: "Gloria+Hallelujah" },
  { family: "Satisfy", label: "Satisfy", googleFontUrl: "Satisfy" },
  { family: "Great Vibes", label: "Great Vibes", googleFontUrl: "Great+Vibes" },
  { family: "Allura", label: "Allura", googleFontUrl: "Allura" },

  // ========== 英文 - 等宽/科技 ==========
  { family: "JetBrains Mono", label: "JetBrains Mono", googleFontUrl: "JetBrains+Mono:wght@400;700" },
  { family: "Fira Code", label: "Fira Code", googleFontUrl: "Fira+Code:wght@400;700" },
  { family: "Source Code Pro", label: "Source Code Pro", googleFontUrl: "Source+Code+Pro:wght@400;700" },
  { family: "Space Mono", label: "Space Mono", googleFontUrl: "Space+Mono:wght@400;700" },

  // ========== 英文 - 圆润可爱 ==========
  { family: "Fredoka", label: "Fredoka", googleFontUrl: "Fredoka:wght@400;700" },
  { family: "Comfortaa", label: "Comfortaa", googleFontUrl: "Comfortaa:wght@400;700" },
  { family: "Quicksand", label: "Quicksand", googleFontUrl: "Quicksand:wght@400;700" },
  { family: "Baloo 2", label: "Baloo 2", googleFontUrl: "Baloo+2:wght@400;700" },
  { family: "Varela Round", label: "Varela Round", googleFontUrl: "Varela+Round" },
];

/** 已加载的字体集合，避免重复加载 */
const loadedFonts = new Set<string>();

/** 动态加载 Google Font（用于预览显示） */
export function loadFont(family: string): void {
  if (loadedFonts.has(family)) return;
  const option = FONT_OPTIONS.find((f) => f.family === family);
  if (!option?.googleFontUrl) return;

  const href = `https://fonts.googleapis.com/css2?family=${option.googleFontUrl}&display=swap`;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
  loadedFonts.add(family);
}

/** 预加载所有字体（首次打开字体选择器时调用） */
export function preloadAllFonts(): void {
  for (const font of FONT_OPTIONS) {
    if (font.googleFontUrl) loadFont(font.family);
  }
}
