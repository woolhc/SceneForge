import type { SubtitleProtectedRange, TimedSentence, WordCue } from "../../types";
import { breakSubtitleLines } from "./lineBreaker";
import { primaryFontSize } from "./profiles";
import type { SubtitleLayoutProfile } from "./types";
import { needsWordSpace } from "./wordSpacing";

const SENTENCE_ENDERS = new Set(["。", "！", "？", "!", "?", "."]);
const CLAUSE_ENDERS = new Set(["，", "、", "；", "：", ",", ";", ":"]);
// 剪映/Netflix/BBC 字幕规范均建议避免让连词孤立留在上一句末尾，应与下一句连在一起。
const LEADING_CONJUNCTIONS = new Set(["but", "and", "or", "so", "because", "although", "though", "yet", "而", "但", "但是", "所以", "因为", "并且", "而且"]);

function smartJoin(words: WordCue[]) {
  let result = "";
  for (const [index, word] of words.entries()) {
    if (index > 0 && needsWordSpace(words[index - 1].text, word.text)) result += " ";
    result += word.text;
  }
  return result.trim();
}

function synthesizeWords(sentence: TimedSentence): WordCue[] {
  const units = /[\u3400-\u9fff]/u.test(sentence.text)
    ? [...sentence.text].filter((character) => !/\s/.test(character))
    : sentence.text.match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];
  if (units.length === 0) return [];
  const duration = Math.max(0.1, sentence.end - sentence.start);
  return units.map((text, index) => ({
    text,
    start: sentence.start + duration * index / units.length,
    end: sentence.start + duration * (index + 1) / units.length,
    confidence: 0.5,
  }));
}

function collectWords(transcript: TimedSentence[]) {
  return transcript.flatMap((sentence) => sentence.words?.length ? sentence.words : synthesizeWords(sentence));
}

export type SubtitleSegmentationAdvice = {
  preferredBreakAfterIndices?: ReadonlySet<number>;
  strongBreakAfterIndices?: ReadonlySet<number>;
  protectedRanges?: readonly SubtitleProtectedRange[];
};

function boundaryInsideProtectedRange(endIndex: number, advice?: SubtitleSegmentationAdvice) {
  return advice?.protectedRanges?.some((range) =>
    range.startWordIndex <= endIndex && endIndex < range.endWordIndex
  ) ?? false;
}

function boundaryScore(words: WordCue[], endIndex: number, advice?: SubtitleSegmentationAdvice) {
  const last = words[endIndex].text[words[endIndex].text.length - 1] ?? "";
  const next = words[endIndex + 1];
  const gap = next ? next.start - words[endIndex].end : 0;
  let score = 0;
  if (SENTENCE_ENDERS.has(last)) score += 60;
  else if (CLAUSE_ENDERS.has(last)) score += 35;
  if (advice?.preferredBreakAfterIndices?.has(endIndex)) score += 90;
  if (gap >= 0.6) score += 55;
  else if (gap >= 0.3) score += 28;
  else if (gap >= 0.18) score += 10;
  // 连词（but/而/但…）本应引出下一句，若被拉进当前句尾（常见于凑够 minDuration），
  // 断点会显得突兀、语义割裂：惩罚"以连词收尾"的候选断点，鼓励算法把它留给下一句开头。
  const lastWordLower = words[endIndex].text.toLowerCase();
  if (LEADING_CONJUNCTIONS.has(lastWordLower)) score -= 45;
  return score;
}

function rangeMetrics(words: WordCue[], start: number, end: number) {
  const range = words.slice(start, end + 1);
  const text = smartJoin(range);
  const duration = range.length > 0 ? range[range.length - 1].end - range[0].start : 0;
  const chars = [...text].filter((character) => !/\s/.test(character)).length;
  return { range, text, duration, chars };
}

function evaluateRange(
  words: WordCue[],
  start: number,
  end: number,
  profile: SubtitleLayoutProfile,
  advice?: SubtitleSegmentationAdvice,
) {
  if (boundaryInsideProtectedRange(end, advice)) return null;
  const { text, duration, chars } = rangeMetrics(words, start, end);
  if (!text || duration <= 0 || duration > profile.maxDuration + 0.8 || chars > profile.maxCharsPerCue) return null;
  for (let index = start; index < end; index += 1) {
    if (words[index + 1].start - words[index].end > 0.85) return null;
  }

  const maxWidth = profile.canvasWidth * profile.maxWidthRatio;
  const fontSize = primaryFontSize(profile);
  const lines = breakSubtitleLines(text, {
    maxLines: profile.maxLines,
    maxWidth,
    fontFamily: "Noto Sans SC",
    fontSize,
  });
  if (!lines) return null;

  const cps = chars / Math.max(duration, 0.1);
  const durationDistance = Math.abs(duration - profile.preferredDuration) / profile.preferredDuration;
  const charDistance = Math.abs(chars / lines.length - profile.preferredCharsPerLine) / profile.preferredCharsPerLine;
  let score = -20 - durationDistance * 18 - charDistance * 16 + boundaryScore(words, end, advice);
  if (duration < profile.minDuration) score -= (profile.minDuration - duration) * 90;
  if (cps > profile.maxCps) score -= (cps - profile.maxCps) * 12;
  else score += Math.max(0, 10 - Math.abs(cps - profile.preferredCps));
  if (lines.length === 2) {
    const first = [...lines[0]].length;
    const second = [...lines[1]].length;
    if (Math.min(first, second) <= 2) score -= 35;
  }
  return { score, text, lines };
}

function optimalRanges(
  words: WordCue[],
  rangeStart: number,
  rangeEnd: number,
  profile: SubtitleLayoutProfile,
  advice?: SubtitleSegmentationAdvice,
): Array<[number, number]> | null {
  const count = rangeEnd - rangeStart + 1;
  const best = new Array<number>(count + 1).fill(Number.NEGATIVE_INFINITY);
  const previous = new Array<number>(count + 1).fill(-1);
  best[0] = 0;

  for (let localStart = 0; localStart < count; localStart += 1) {
    if (!Number.isFinite(best[localStart])) continue;
    const start = rangeStart + localStart;
    for (let end = start; end <= rangeEnd && end < start + 36; end += 1) {
      const evaluated = evaluateRange(words, start, end, profile, advice);
      if (!evaluated) continue;
      const localEnd = end - rangeStart + 1;
      const candidate = best[localStart] + evaluated.score;
      if (candidate > best[localEnd]) {
        best[localEnd] = candidate;
        previous[localEnd] = localStart;
      }
    }
  }

  if (previous[count] < 0) return null;
  const ranges: Array<[number, number]> = [];
  let cursor = count;
  while (cursor > 0) {
    const localStart = previous[cursor];
    if (localStart < 0) return null;
    ranges.push([rangeStart + localStart, rangeStart + cursor - 1]);
    cursor = localStart;
  }
  return ranges.reverse();
}

function minimumReadableRange(words: WordCue[], start: number, end: number, profile: SubtitleLayoutProfile) {
  if (end < start) return false;
  const { duration, chars } = rangeMetrics(words, start, end);
  return duration >= profile.minDuration * 0.75 && chars >= 2;
}

function strongSemanticRanges(
  words: WordCue[],
  profile: SubtitleLayoutProfile,
  advice?: SubtitleSegmentationAdvice,
): Array<[number, number]> | null {
  if (!advice?.strongBreakAfterIndices?.size) return null;
  const lastIndex = words.length - 1;
  const candidates = [...advice.strongBreakAfterIndices]
    .filter((index) => index >= 0 && index < lastIndex && !boundaryInsideProtectedRange(index, advice))
    .sort((a, b) => a - b);
  if (candidates.length === 0) return null;

  const selected: number[] = [];
  let start = 0;
  for (const candidate of candidates) {
    if (!minimumReadableRange(words, start, candidate, profile)) continue;
    selected.push(candidate);
    start = candidate + 1;
  }
  while (selected.length > 0 && !minimumReadableRange(words, start, lastIndex, profile)) {
    selected.pop();
    start = (selected.length > 0 ? selected[selected.length - 1] : -1) + 1;
  }
  if (selected.length === 0) return null;

  const semanticRanges: Array<[number, number]> = [];
  start = 0;
  for (const boundary of selected) {
    semanticRanges.push([start, boundary]);
    start = boundary + 1;
  }
  semanticRanges.push([start, lastIndex]);

  const repaired: Array<[number, number]> = [];
  for (const [semanticStart, semanticEnd] of semanticRanges) {
    if (evaluateRange(words, semanticStart, semanticEnd, profile, advice)) {
      repaired.push([semanticStart, semanticEnd]);
      continue;
    }
    const local = optimalRanges(words, semanticStart, semanticEnd, profile, advice);
    if (!local) return null;
    repaired.push(...local);
  }
  return repaired;
}

function renderRanges(words: WordCue[], ranges: Array<[number, number]>, profile: SubtitleLayoutProfile) {
  return ranges.map(([start, end], index) => {
    const rangeWords = words.slice(start, end + 1);
    const nextStart = ranges[index + 1]?.[0];
    const naturalEnd = rangeWords[rangeWords.length - 1].end;
    let endTime = naturalEnd;
    if (nextStart !== undefined) {
      const nextWordStart = words[nextStart].start;
      if (naturalEnd <= nextWordStart) endTime = Math.max(naturalEnd, nextWordStart - profile.minimumGap);
    }
    return {
      start: rangeWords[0].start,
      end: Math.max(rangeWords[0].start + 0.2, endTime),
      text: smartJoin(rangeWords),
      words: rangeWords,
    };
  });
}

export function segmentTranscriptForLayout(
  transcript: TimedSentence[],
  profile: SubtitleLayoutProfile,
  advice?: SubtitleSegmentationAdvice,
): TimedSentence[] {
  const words = collectWords(transcript);
  if (words.length === 0) return [];

  // 高置信度 AI 先确定语义组；规则只在组内违反硬约束时局部修复。
  const semanticRanges = strongSemanticRanges(words, profile, advice);
  const ranges = semanticRanges ?? optimalRanges(words, 0, words.length - 1, profile, advice);
  if (!ranges) {
    return transcript.map((sentence) => ({ ...sentence, words: sentence.words ?? synthesizeWords(sentence) }));
  }
  return renderRanges(words, ranges, profile);
}
