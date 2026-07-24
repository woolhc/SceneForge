import type { CompositionContent } from "./types";

function cleanLine(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[「『"']+|[」』"']+$/g, "")
    .trim();
}

function takeChars(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/[，,。.!！?？、\s]+$/u, "")}`;
}

/**
 * 无 AI 时从文案启发式提取主/副标题。
 * 主标题：首句或前 12 字；副标题：次句或剩余摘要。
 */
export function extractTitlesFromScript(script: string): CompositionContent {
  const normalized = cleanLine(script || "");
  if (!normalized) {
    return { mainTitle: "精彩内容", subTitle: "坚持练习每一天" };
  }

  const parts = normalized
    .split(/[。！？!?.；;]+/u)
    .map(cleanLine)
    .filter(Boolean);

  const first = parts[0] ?? normalized;
  const second = parts[1] ?? parts[0] ?? normalized;

  return {
    mainTitle: takeChars(first, 12),
    subTitle: takeChars(second === first ? `${first}的关键要点` : second, 20),
  };
}
