import type { MediaSource } from "../types";

export type AssetScoreBreakdown = {
  aspectRatio: number;
  duration: number;
  semantic: number;
  direction: number;
  duplicatePenalty: number;
};

export type ScoredAsset = {
  asset: MediaSource;
  score: number;
  breakdown: AssetScoreBreakdown;
};

export type AssetSelectionResult = {
  clipId: string;
  query: string;
  candidates: ScoredAsset[];
  selected: MediaSource | null;
  confidence: number;
  requiresManualSelection: boolean;
  reason: string | null;
};

type SelectionOptions = {
  clipId: string;
  query: string;
  ratio: string;
  targetDuration?: number;
  materialDirection?: string;
  usedAssetIds?: ReadonlySet<string>;
  minimumConfidence?: number;
};

const DIRECTION_TERMS: Record<string, string[]> = {
  scenery: ["nature", "landscape", "city", "sky", "ocean", "road", "mountain", "自然", "风景", "城市", "海", "天空"],
  people: ["people", "person", "woman", "man", "family", "life", "lifestyle", "人物", "家庭", "生活"],
  business: ["business", "office", "meeting", "technology", "finance", "team", "商业", "办公", "会议", "科技"],
  abstract: ["abstract", "texture", "light", "shadow", "macro", "motion", "抽象", "纹理", "光影", "质感"],
};

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function targetAspectRatio(ratio: string) {
  const [width, height] = ratio.split(":").map(Number);
  return width > 0 && height > 0 ? width / height : 9 / 16;
}

function aspectScore(asset: MediaSource, ratio: string) {
  if (asset.width <= 0 || asset.height <= 0) return 0.45;
  const delta = Math.abs(Math.log((asset.width / asset.height) / targetAspectRatio(ratio)));
  return Math.max(0, 1 - delta / 1.2);
}

function durationScore(asset: MediaSource, targetDuration?: number) {
  if (asset.kind === "image" || !targetDuration || targetDuration <= 0) return 1;
  if (asset.duration <= 0) return 0.25;
  const coverage = asset.duration / targetDuration;
  if (coverage >= 1) return Math.max(0.7, 1 - Math.min(coverage - 1, 2) * 0.1);
  return Math.max(0, coverage);
}

function semanticScore(asset: MediaSource, query: string) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0.5;
  const haystack = new Set(tokenize(`${asset.title} ${asset.url ?? ""}`));
  const matches = queryTokens.filter((token) => haystack.has(token)).length;
  // Pexels already sorts by relevance, so retain a neutral floor when metadata is sparse.
  return Math.min(1, 0.45 + (matches / queryTokens.length) * 0.55);
}

function directionScore(asset: MediaSource, materialDirection = "auto") {
  if (materialDirection === "auto" || materialDirection.startsWith("custom:")) return 0.65;
  const terms = DIRECTION_TERMS[materialDirection] ?? [];
  if (terms.length === 0) return 0.65;
  const text = `${asset.title} ${asset.url ?? ""}`.toLowerCase();
  return terms.some((term) => text.includes(term)) ? 1 : 0.35;
}

export function scoreAssetCandidates(assets: MediaSource[], options: SelectionOptions): ScoredAsset[] {
  return assets
    .map((asset, index) => {
      const breakdown: AssetScoreBreakdown = {
        aspectRatio: aspectScore(asset, options.ratio),
        duration: durationScore(asset, options.targetDuration),
        semantic: semanticScore(asset, options.query),
        direction: directionScore(asset, options.materialDirection),
        duplicatePenalty: options.usedAssetIds?.has(asset.id) ? 0.35 : 0,
      };
      const relevancePrior = Math.max(0, 1 - index * 0.08);
      const score = Math.max(0, Math.min(1,
        breakdown.aspectRatio * 0.25 +
        breakdown.duration * 0.25 +
        breakdown.semantic * 0.25 +
        breakdown.direction * 0.15 +
        relevancePrior * 0.1 -
        breakdown.duplicatePenalty,
      ));
      return { asset, score, breakdown };
    })
    .sort((a, b) => b.score - a.score);
}

export function selectAssetCandidate(assets: MediaSource[], options: SelectionOptions): AssetSelectionResult {
  const candidates = scoreAssetCandidates(assets, options);
  const best = candidates[0] ?? null;
  const runnerUp = candidates[1] ?? null;
  const minimumConfidence = options.minimumConfidence ?? 0.52;
  const confidence = best
    ? Math.max(0, Math.min(1, best.score * 0.8 + Math.max(0, best.score - (runnerUp?.score ?? 0)) * 0.2))
    : 0;
  const requiresManualSelection = !best || confidence < minimumConfidence;
  return {
    clipId: options.clipId,
    query: options.query,
    candidates,
    selected: requiresManualSelection ? null : best.asset,
    confidence,
    requiresManualSelection,
    reason: !best ? "没有找到素材候选" : requiresManualSelection ? "素材匹配置信度较低，建议手动选择或使用文字卡" : null,
  };
}
