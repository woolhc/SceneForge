import { measureTextWidth } from "./textMeasure";

const STRONG_BREAKS = new Set(["。", "！", "？", "!", "?", ";", "；"]);
const SOFT_BREAKS = new Set(["，", "、", ",", ":", "："]);
const FORBIDDEN_LINE_START = new Set(["，", "。", "！", "？", "、", "；", "：", ",", ".", "!", "?", ")", "）", "]", "】"]);

export type BreakLinesOptions = {
  maxLines: number;
  maxWidth: number;
  fontFamily: string;
  fontSize: number;
  fontWeight?: number;
  letterSpacing?: number;
};

function breakBonus(previous: string, next: string) {
  if (STRONG_BREAKS.has(previous)) return 1;
  if (SOFT_BREAKS.has(previous)) return 0.75;
  if (/\s/.test(previous) || /\s/.test(next)) return 0.55;
  return 0.25;
}

export function breakSubtitleLines(text: string, options: BreakLinesOptions): string[] | null {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return [];
  const width = (value: string) => measureTextWidth(
    value,
    options.fontFamily,
    options.fontSize,
    options.fontWeight ?? 700,
    options.letterSpacing ?? 0,
  );
  if (width(normalized) <= options.maxWidth) return [normalized];
  if (options.maxLines < 2) return null;

  const characters = [...normalized];
  let best: { lines: string[]; score: number } | null = null;
  for (let index = 1; index < characters.length; index += 1) {
    const first = characters.slice(0, index).join("").trim();
    const second = characters.slice(index).join("").trim();
    if (!first || !second || FORBIDDEN_LINE_START.has(second[0])) continue;
    const firstWidth = width(first);
    const secondWidth = width(second);
    if (firstWidth > options.maxWidth || secondWidth > options.maxWidth) continue;
    const balance = 1 - Math.abs(firstWidth - secondWidth) / Math.max(firstWidth, secondWidth);
    const score = balance * 0.7 + breakBonus(characters[index - 1], characters[index]) * 0.3;
    if (!best || score > best.score) best = { lines: [first, second], score };
  }
  return best?.lines ?? null;
}
