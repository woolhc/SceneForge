import { desktopApi, parsePipelineError } from "../tauri";
import type { MediaSource, StockMediaProvider } from "../types";

/**
 * Pexels/Pixabay 双源搜索，带自动 fallback + 会话级配额记忆。
 * 原来散落在 App.tsx 的 searchStockVideos / searchStockPhotos 几乎逐行重复（~125 行），
 * 这里合并为一个函数，按 kind 分发到 videos/photos API。
 */

export type SearchOptions = {
  query: string;
  ratio: string;
  perPage?: number;
  page?: number;
  prefer?: StockMediaProvider;
};

type SearchDeps = {
  /** 会话级偏好：Pexels 配额失败后，后续请求直接优先 Pixabay */
  preferPixabayRef: React.MutableRefObject<boolean>;
  /** fallback 通知去重（每个会话只 toast 一次） */
  fallbackNotifiedRef: React.MutableRefObject<boolean>;
  /** 当前 UI 选中的素材源（fallback 成功时同步切换） */
  libraryProvider: StockMediaProvider;
  setLibraryProvider: (provider: StockMediaProvider) => void;
  pushToast: (toast: { type: "info" | "warning" | "error" | "success"; message: string; duration?: number }) => void;
};

export type StockSearchResult = {
  assets: MediaSource[];
  page: number;
  hasMore: boolean;
  totalResults: number;
  provider: StockMediaProvider;
};

export async function searchStockMedia(
  kind: "video" | "photo",
  options: SearchOptions,
  deps: SearchDeps,
): Promise<StockSearchResult> {
  const { preferPixabayRef, fallbackNotifiedRef, libraryProvider, setLibraryProvider, pushToast } = deps;
  const prefer =
    options.prefer
    || (preferPixabayRef.current ? "pixabay" : null)
    || libraryProvider
    || "pexels";
  const order: StockMediaProvider[] =
    prefer === "pixabay" ? ["pixabay", "pexels"] : ["pexels", "pixabay"];
  const errors: string[] = [];
  for (const provider of order) {
    try {
      const result =
        provider === "pixabay"
          ? kind === "video"
            ? await desktopApi.searchPixabayVideos(options)
            : await desktopApi.searchPixabayPhotos(options)
          : kind === "video"
            ? await desktopApi.searchPexelsVideos(options)
            : await desktopApi.searchPexelsPhotos(options);
      // 首源失败后备用源成功 → 记会话偏好 + 轻提示一次
      if (provider === "pixabay" && order[0] === "pexels" && errors.length > 0) {
        preferPixabayRef.current = true;
        if (!fallbackNotifiedRef.current) {
          fallbackNotifiedRef.current = true;
          pushToast({
            type: "info",
            message: "Pexels 不可用，已自动切换到 Pixabay 继续搜素材",
            duration: 5000,
          });
        }
        if (libraryProvider !== "pixabay") setLibraryProvider("pixabay");
      }
      return { ...result, provider };
    } catch (error) {
      const parsed = parsePipelineError(error);
      errors.push(`${provider}: ${parsed.message}`);
      // Pexels 配额/限流：后续分镜直接优先 Pixabay
      if (
        provider === "pexels"
        && (/429|配额|限流|quota|rate limit/i.test(parsed.message) || parsed.code === "PEXELS_429")
      ) {
        preferPixabayRef.current = true;
      }
    }
  }
  throw new Error(
    errors.length
      ? `全部素材源搜索失败。${errors.join(" | ")}`
      : "请先在设置中配置 Pexels 或 Pixabay API Key",
  );
}
