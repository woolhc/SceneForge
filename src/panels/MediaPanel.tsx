import { Loader2, Upload } from "lucide-react";
import { MediaLibrary } from "../library/MediaLibrary";
import type { MediaSource, StockMediaProvider } from "../types";

/**
 * 媒体 Tab：Pexels / Pixabay 搜索 + 本地导入 + 素材网格。
 * 点击素材 = 替换当前选中视频 clip（或追加）。
 */
export function MediaPanel({
  media,
  busy,
  previewingId,
  provider,
  onProviderChange,
  onImportLocal,
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
  onImportLocal: () => void;
  onSearchVideos: (query: string) => void;
  onSearchPhotos: (query: string) => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onPreview: (asset: MediaSource | null) => void;
  onAddToTimeline: (asset: MediaSource) => void;
  onToggleFavorite?: (asset: MediaSource) => void;
}) {
  const importing = busy === "library-import";
  return (
    <div className="panel-content">
      <button
        className={`panel-primary-action ${importing ? "disabled" : ""}`}
        disabled={importing}
        onClick={onImportLocal}
      >
        {importing ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}
        导入本地素材
      </button>
      <MediaLibrary
        media={media}
        busy={busy}
        previewingId={previewingId}
        provider={provider}
        onProviderChange={onProviderChange}
        onSearchVideos={onSearchVideos}
        onSearchPhotos={onSearchPhotos}
        hasMore={hasMore}
        onLoadMore={onLoadMore}
        onPreview={onPreview}
        onAddToTimeline={onAddToTimeline}
        onToggleFavorite={onToggleFavorite}
      />
    </div>
  );
}
