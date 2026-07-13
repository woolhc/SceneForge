import pLimit from "p-limit";
import type { SubtitleBreakAdviceResult, SubtitleProtectedRange, WordCue } from "../../types";

export type MergedSubtitleSemanticAdvice = {
  preferredBreakAfterIndices: Set<number>;
  strongBreakAfterIndices: Set<number>;
  protectedRanges: SubtitleProtectedRange[];
  confidence: number;
  requestedChunkCount: number;
  successfulChunkCount: number;
  failedChunkCount: number;
  failureCategories: string[];
};

type AdviceRequester = (words: WordCue[]) => Promise<SubtitleBreakAdviceResult>;

function failureCategory(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("api key") || message.includes("unauthorized") || message.includes("401")) return "auth";
  if (message.includes("json") || message.includes("解析") || message.includes("response") || message.includes("返回")) return "response";
  if (message.includes("network") || message.includes("fetch") || message.includes("timeout") || message.includes("连接")) return "network";
  if (message.includes("browser") || message.includes("浏览器")) return "unsupported";
  return "unknown";
}

function normalizeAdvice(result: SubtitleBreakAdviceResult, wordCount: number): SubtitleBreakAdviceResult {
  const lastIndex = wordCount - 1;
  const preferredBreakAfterIndices = [...new Set(result.preferredBreakAfterIndices)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < lastIndex)
    .sort((a, b) => a - b);
  const protectedRanges = result.protectedRanges.filter((range) =>
    Number.isInteger(range.startWordIndex)
    && Number.isInteger(range.endWordIndex)
    && range.startWordIndex >= 0
    && range.startWordIndex < range.endWordIndex
    && range.endWordIndex <= lastIndex
  );
  return {
    preferredBreakAfterIndices,
    protectedRanges,
    confidence: Number.isFinite(result.confidence) ? Math.max(0, Math.min(1, result.confidence)) : 0,
  };
}

export async function requestSubtitleSemanticAdvice(
  words: WordCue[],
  requester: AdviceRequester,
  chunkSize = 120,
  overlapSize = 16,
): Promise<MergedSubtitleSemanticAdvice> {
  const safeChunkSize = Math.max(8, Math.floor(chunkSize));
  const safeOverlap = Math.max(0, Math.min(Math.floor(overlapSize), safeChunkSize - 1));
  const chunks: Array<{
    contextStart: number;
    coreStart: number;
    coreEnd: number;
    words: WordCue[];
  }> = [];

  for (let coreStart = 0; coreStart < words.length; coreStart += safeChunkSize) {
    const coreEnd = Math.min(words.length, coreStart + safeChunkSize);
    const contextStart = Math.max(0, coreStart - safeOverlap);
    const contextEnd = Math.min(words.length, coreEnd + safeOverlap);
    const chunk = words.slice(contextStart, contextEnd);
    if (chunk.length >= 8) chunks.push({ contextStart, coreStart, coreEnd, words: chunk });
  }

  const limit = pLimit(2);
  const chunkResults = await Promise.all(chunks.map((chunk) => limit(async () => {
    try {
      const advice = normalizeAdvice(await requester(chunk.words), chunk.words.length);
      return { ...chunk, advice };
    } catch (error) {
      return { ...chunk, errorCategory: failureCategory(error) };
    }
  })));

  const preferredBreakAfterIndices = new Set<number>();
  const strongBreakAfterIndices = new Set<number>();
  const protectedRangeKeys = new Set<string>();
  const protectedRanges: SubtitleProtectedRange[] = [];
  const confidences: number[] = [];
  let successfulChunkCount = 0;
  let failedChunkCount = 0;
  const failureCategories = new Set<string>();

  for (const result of chunkResults) {
    if ("errorCategory" in result) {
      failedChunkCount += 1;
      failureCategories.add(result.errorCategory);
      continue;
    }
    successfulChunkCount += 1;
    confidences.push(result.advice.confidence);
    if (result.advice.confidence < 0.55) continue;

    result.advice.preferredBreakAfterIndices.forEach((localIndex) => {
      const globalIndex = result.contextStart + localIndex;
      // 每个断点只由其 core window 负责，重叠区仅提供上下文。
      if (globalIndex < result.coreStart || globalIndex >= result.coreEnd || globalIndex >= words.length - 1) return;
      preferredBreakAfterIndices.add(globalIndex);
      if (result.advice.confidence >= 0.82) strongBreakAfterIndices.add(globalIndex);
    });

    result.advice.protectedRanges.forEach((range) => {
      const globalRange = {
        startWordIndex: result.contextStart + range.startWordIndex,
        endWordIndex: result.contextStart + range.endWordIndex,
      };
      if (globalRange.startWordIndex < result.coreStart
        || globalRange.startWordIndex >= result.coreEnd
        || globalRange.endWordIndex >= words.length) return;
      const key = `${globalRange.startWordIndex}:${globalRange.endWordIndex}`;
      if (protectedRangeKeys.has(key)) return;
      protectedRangeKeys.add(key);
      protectedRanges.push(globalRange);
    });
  }

  return {
    preferredBreakAfterIndices,
    strongBreakAfterIndices,
    protectedRanges,
    confidence: confidences.length > 0
      ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
      : 0,
    requestedChunkCount: chunks.length,
    successfulChunkCount,
    failedChunkCount,
    failureCategories: [...failureCategories].sort(),
  };
}
