import { ExternalLink, Film, Image, Loader2, Music, Search, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { desktopApi } from "../tauri";
import type { MediaSource, StockMediaProvider } from "../types";
import {
  isPixabayAsset,
  isPexelsAsset,
  isStockRemoteAsset,
  mediaSourceMetaLine,
  pexelsAssetTooltip,
  pexelsCreatorCredit,
  stockProviderBrand,
  stockProviderHomeUrl,
} from "./pexelsAttribution";

type SearchMode = "video" | "image";
type LibraryFilter = "all" | "video" | "image" | "audio" | "favorite" | "recent";

const PEXELS_FALLBACK = "https://www.pexels.com";
const PIXABAY_FALLBACK = "https://pixabay.com";

const FILTER_TABS: { id: LibraryFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "video", label: "视频" },
  { id: "image", label: "图片" },
  { id: "audio", label: "音频" },
  { id: "favorite", label: "收藏" },
  { id: "recent", label: "最近使用" },
];

function filterMedia(media: MediaSource[], filter: LibraryFilter): MediaSource[] {
  switch (filter) {
    case "video":
    case "image":
    case "audio":
      return media.filter((asset) => asset.kind === filter);
    case "favorite":
      return media.filter((asset) => asset.favorite);
    case "recent":
      return media
        .filter((asset) => asset.lastUsedAt)
        .slice()
        .sort((a, b) => (b.lastUsedAt || "").localeCompare(a.lastUsedAt || ""));
    default:
      return media;
  }
}

export function MediaLibrary({
  media,
  busy,
  previewingId,
  provider,
  onProviderChange,
  onSearchVideos,
  onSearchPhotos,
  hasMore,
  onLoadMore,
  onPreview,
  onAddToTimeline,
  onToggleFavorite,
}: {
  media: MediaSource[];
  busy: string | null;
  previewingId?: string | null;
  provider: StockMediaProvider;
  onProviderChange: (provider: StockMediaProvider) => void;
  onSearchVideos: (query: string) => void;
  onSearchPhotos: (query: string) => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onPreview: (asset: MediaSource | null) => void;
  onAddToTimeline: (asset: MediaSource) => void;
  onToggleFavorite?: (asset: MediaSource) => void;
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("video");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const searching = busy === "library-search";
  const filteredMedia = useMemo(() => filterMedia(media, filter), [media, filter]);
  const hasStockMedia = useMemo(
    () => media.some((asset) => isStockRemoteAsset(asset)),
    [media],
  );
  const brand = stockProviderBrand(provider);
  const homeUrl = stockProviderHomeUrl(provider);

  function doSearch() {
    const q = query.trim();
    if (!q) return;
    if (mode === "video") onSearchVideos(q);
    else onSearchPhotos(q);
  }

  return (
    <div className="media-library">
      <div className="search-mode-tabs">
        <button
          className={mode === "video" ? "active" : ""}
          onClick={() => setMode("video")}
        >
          <Film size={13} />
          视频
        </button>
        <button
          className={mode === "image" ? "active" : ""}
          onClick={() => setMode("image")}
        >
          <Image size={13} />
          图片
        </button>
      </div>

      <div className="library-provider-tabs" role="tablist" aria-label="素材源">
        <button
          type="button"
          className={provider === "pexels" ? "active" : ""}
          onClick={() => onProviderChange("pexels")}
        >
          Pexels
        </button>
        <button
          type="button"
          className={provider === "pixabay" ? "active" : ""}
          onClick={() => onProviderChange("pixabay")}
        >
          Pixabay
        </button>
      </div>

      <div className="library-search">
        <Search size={15} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") doSearch();
          }}
          placeholder={mode === "video" ? `搜索 ${brand} 视频` : `搜索 ${brand} 图片`}
        />
        <button
          disabled={searching || !query.trim()}
          onClick={doSearch}
          title="搜索"
        >
          {searching ? <Loader2 className="spin" size={14} /> : <Search size={14} />}
        </button>
      </div>

      <div className="library-pexels-credit" role="note">
        <span>
          {mode === "video" ? "Videos" : "Photos"} provided by{" "}
          <a href={homeUrl} target="_blank" rel="noreferrer noopener">
            {brand}
          </a>
        </span>
        <a
          className="library-pexels-link"
          href={homeUrl}
          target="_blank"
          rel="noreferrer noopener"
          title={`打开 ${brand}`}
          onClick={(event) => event.stopPropagation()}
        >
          <ExternalLink size={11} />
        </a>
      </div>

      <div className="library-filter-tabs">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.id}
            className={filter === tab.id ? "active" : ""}
            onClick={() => setFilter(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="library-grid">
        {filteredMedia.length === 0 && (
          <div className="library-empty">
            <Film size={28} />
            <span>
              {media.length === 0
                ? `还没有素材，搜索 ${brand} 或导入本地文件`
                : "没有符合条件的素材"}
            </span>
          </div>
        )}
        {filteredMedia.map((asset) => {
          const thumb = desktopApi.mediaSrc(asset.thumbnailUrl || asset.localPath || null);
          const targetLabel = asset.kind === "image" ? "图片轨" : asset.kind === "audio" ? "音频轨" : "视频轨";
          const credit = pexelsCreatorCredit(asset);
          const assetBrand = isPixabayAsset(asset)
            ? "Pixabay"
            : isPexelsAsset(asset)
              ? "Pexels"
              : null;
          const creditHref =
            asset.photographerUrl ||
            asset.pageUrl ||
            (isPixabayAsset(asset) ? PIXABAY_FALLBACK : isPexelsAsset(asset) ? PEXELS_FALLBACK : "");
          return (
            <div
              key={asset.id}
              className={`library-card ${previewingId === asset.id ? "previewing" : ""}`}
              draggable
              role="button"
              tabIndex={0}
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", asset.id);
                event.dataTransfer.effectAllowed = "copy";
              }}
              onMouseEnter={() => onPreview(asset)}
              onMouseLeave={() => onPreview(null)}
              title={`${pexelsAssetTooltip(asset)} · 悬停预览 / 点击加${targetLabel} / 拖到兼容轨道`}
              onClick={() => onAddToTimeline(asset)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onAddToTimeline(asset);
                }
              }}
            >
              {onToggleFavorite && (
                <button
                  className={`library-favorite-star ${asset.favorite ? "active" : ""}`}
                  title={asset.favorite ? "取消收藏" : "收藏"}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleFavorite(asset);
                  }}
                >
                  <Star size={13} fill={asset.favorite ? "currentColor" : "none"} />
                </button>
              )}
              {thumb ? (
                <img src={thumb} alt="" draggable={false} />
              ) : (
                <div className="library-card-fallback">
                  {asset.kind === "audio" ? <Music size={20} /> : asset.kind === "image" ? <Image size={20} /> : <Film size={20} />}
                </div>
              )}
              <span>{asset.title}</span>
              <small>{mediaSourceMetaLine(asset)}</small>
              {credit ? (
                <small className="library-card-credit">
                  {creditHref ? (
                    <a
                      href={creditHref}
                      target="_blank"
                      rel="noreferrer noopener"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {credit}
                    </a>
                  ) : (
                    credit
                  )}
                </small>
              ) : assetBrand ? (
                <small className="library-card-credit">
                  <a
                    href={isPixabayAsset(asset) ? PIXABAY_FALLBACK : PEXELS_FALLBACK}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={(event) => event.stopPropagation()}
                  >
                    Provided by {assetBrand}
                  </a>
                </small>
              ) : null}
            </div>
          );
        })}
      </div>
      {filteredMedia.length > 0 && hasMore && (
        <button className="library-load-more" disabled={searching} onClick={onLoadMore}>
          {searching ? <Loader2 className="spin" size={14} /> : null}
          加载更多
        </button>
      )}
      {hasStockMedia ? (
        <p className="library-pexels-footer">
          素材来自{" "}
          <a href={homeUrl} target="_blank" rel="noreferrer noopener">
            {brand}
          </a>
          等平台，使用时请保留创作者署名。
        </p>
      ) : null}
    </div>
  );
}
