import type { MediaSource } from "../types";

/** Pexels 官方站点（设置页 / 库页固定致谢用） */
export const PEXELS_HOME_URL = "https://www.pexels.com";

/** Pixabay 官方站点 */
export const PIXABAY_HOME_URL = "https://pixabay.com";

export type StockSourceKind = "pexels" | "pixabay";

/** 是否为 Pexels 素材 */
export function isPexelsAsset(asset: Pick<MediaSource, "source"> | null | undefined): boolean {
  return (asset?.source || "").toLowerCase() === "pexels";
}

/** 是否为 Pixabay 素材 */
export function isPixabayAsset(asset: Pick<MediaSource, "source"> | null | undefined): boolean {
  return (asset?.source || "").toLowerCase() === "pixabay";
}

/** 是否为远程 stock 素材（需缓存下载） */
export function isStockRemoteAsset(asset: Pick<MediaSource, "source"> | null | undefined): boolean {
  return isPexelsAsset(asset) || isPixabayAsset(asset);
}

function stockHomeUrl(source: string | undefined): string {
  return isPixabayAsset({ source: source || "" }) ? PIXABAY_HOME_URL : PEXELS_HOME_URL;
}

function stockBrand(source: string | undefined): string {
  return isPixabayAsset({ source: source || "" }) ? "Pixabay" : "Pexels";
}

/** 摄影师署名短句，如 "Photo by Jane" / "Video by Jane" */
export function pexelsCreatorCredit(asset: Pick<MediaSource, "kind" | "photographer" | "source">): string | null {
  if (!isStockRemoteAsset(asset)) return null;
  const name = asset.photographer?.trim();
  if (!name) return null;
  const prefix = asset.kind === "image" ? "Photo by" : "Video by";
  return `${prefix} ${name}`;
}

/** 卡片/悬停 title：标题 + 创作者 + 平台 */
export function pexelsAssetTooltip(asset: MediaSource): string {
  const parts = [asset.title?.trim()].filter(Boolean) as string[];
  const credit = pexelsCreatorCredit(asset);
  if (credit && !parts.some((part) => part.includes(credit))) {
    parts.push(credit);
  }
  if (isStockRemoteAsset(asset)) {
    parts.push(`Provided by ${stockBrand(asset.source)}`);
  }
  return parts.join(" · ");
}

/** 库网格副标题：尺寸/时长 + 来源/署名 */
export function mediaSourceMetaLine(asset: MediaSource): string {
  const bits: string[] = [];
  if (asset.width > 0 && asset.height > 0) {
    bits.push(`${asset.width}x${asset.height}`);
  }
  if (asset.kind === "image") {
    bits.push("图片");
  } else if (asset.kind === "audio") {
    bits.push(asset.duration > 0 ? `${asset.duration.toFixed(1)}s` : "音频");
  } else {
    bits.push(`${asset.duration.toFixed(1)}s`);
  }

  if (asset.source === "local") {
    bits.push("本地");
  } else if (asset.source === "tts") {
    bits.push("配音");
  } else if (isStockRemoteAsset(asset)) {
    const credit = pexelsCreatorCredit(asset);
    bits.push(credit || stockBrand(asset.source));
  } else if (asset.source) {
    bits.push(asset.source);
  }

  if (asset.kind === "video" && asset.proxyStatus === "ready") bits.push("代理");
  if (asset.kind === "video" && asset.proxyStatus === "failed") bits.push("代理失败");

  return bits.join(" · ");
}

/** 库顶栏「Videos/Photos provided by …」文案 */
export function stockProviderCreditLine(mode: "video" | "image", provider: StockSourceKind): string {
  const brand = provider === "pixabay" ? "Pixabay" : "Pexels";
  return `${mode === "video" ? "Videos" : "Photos"} provided by ${brand}`;
}

export function stockProviderHomeUrl(provider: StockSourceKind): string {
  return provider === "pixabay" ? PIXABAY_HOME_URL : PEXELS_HOME_URL;
}

export function stockProviderBrand(provider: StockSourceKind): string {
  return provider === "pixabay" ? "Pixabay" : "Pexels";
}

export { stockHomeUrl, stockBrand };
