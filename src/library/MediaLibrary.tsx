import { Film, Image, Loader2, Music, Search, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { desktopApi } from "../tauri";
import type { MediaSource } from "../types";

type SearchMode = "video" | "image";
type LibraryFilter = "all" | "video" | "image" | "audio" | "favorite" | "recent";

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
      <div className="library-search">
        <Search size={15} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") doSearch();
          }}
          placeholder={mode === "video" ? "搜索 Pexels 视频" : "搜索 Pexels 图片"}
        />
        <button
          disabled={searching || !query.trim()}
          onClick={doSearch}
          title="搜索"
        >
          {searching ? <Loader2 className="spin" size={14} /> : <Search size={14} />}
        </button>
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
            <span>{media.length === 0 ? "还没有素材，搜索 Pexels 或导入本地文件" : "没有符合条件的素材"}</span>
          </div>
        )}
        {filteredMedia.map((asset) => {
          const thumb = desktopApi.mediaSrc(asset.thumbnailUrl || asset.localPath || null);
          const targetLabel = asset.kind === "image" ? "图片轨" : asset.kind === "audio" ? "音频轨" : "视频轨";
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
              title={`${asset.title} · 悬停预览 / 点击加${targetLabel} / 拖到兼容轨道`}
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
              <small>
                {asset.width > 0 ? `${asset.width}x${asset.height} · ` : ""}
                {asset.kind === "image" ? "图片" : `${asset.duration.toFixed(1)}s`} · {asset.source === "local" ? "本地" : asset.source === "tts" ? "配音" : "Pexels"}
                {asset.kind === "video" && asset.proxyStatus === "ready" ? " · 代理" : ""}
                {asset.kind === "video" && asset.proxyStatus === "failed" ? " · 代理失败" : ""}
              </small>
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
    </div>
  );
}
