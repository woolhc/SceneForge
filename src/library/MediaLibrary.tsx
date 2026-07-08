import { Film, Image, Loader2, Search } from "lucide-react";
import { useState } from "react";
import { desktopApi } from "../tauri";
import type { MediaSource } from "../types";

type SearchMode = "video" | "image";

export function MediaLibrary({
  media,
  busy,
  previewingId,
  onSearchVideos,
  onSearchPhotos,
  onPreview,
  onAddToTimeline,
}: {
  media: MediaSource[];
  busy: string | null;
  previewingId?: string | null;
  onSearchVideos: (query: string) => void;
  onSearchPhotos: (query: string) => void;
  onPreview: (asset: MediaSource | null) => void;
  onAddToTimeline: (asset: MediaSource) => void;
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("video");
  const searching = busy === "library-search";

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

      <div className="library-grid">
        {media.length === 0 && (
          <div className="library-empty">
            <Film size={28} />
            <span>还没有素材，搜索 Pexels 或导入本地文件</span>
          </div>
        )}
        {media.map((asset) => {
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
              {thumb ? (
                <img src={thumb} alt="" draggable={false} />
              ) : (
                <div className="library-card-fallback">
                  {asset.kind === "audio" ? "🎵" : asset.kind === "image" ? <Image size={20} /> : <Film size={20} />}
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
    </div>
  );
}
