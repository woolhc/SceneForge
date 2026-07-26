import { Loader2, Music4, Upload } from "lucide-react";
import type { MediaSource } from "../types";

/**
 * P2-4 背景音乐库：
 * - 本地导入音乐（复用 import_media，落素材库 audio）
 * - 素材库中的音频列表 → 一键设为 BGM（铺满全片：audio 轨 + 30% 音量 + 2s 淡入淡出）
 * 预览走 Web Audio 混音，导出走 amix，均已有现成通路。
 */
export function BgmPanel({
  media,
  busy,
  activeBgmSourceId,
  onImportAudio,
  onApplyBgm,
  onRemoveBgm,
}: {
  media: MediaSource[];
  busy: string | null;
  /** 当前作为 BGM 的素材 id（无则 null） */
  activeBgmSourceId: string | null;
  onImportAudio: () => void;
  onApplyBgm: (asset: MediaSource) => void;
  onRemoveBgm: () => void;
}) {
  const audioAssets = media.filter((m) => m.kind === "audio" && m.source !== "tts");
  const applying = busy === "bgm";

  return (
    <div className="bgm-panel">
      <button className="primary-button bgm-import" disabled={busy === "library-import"} onClick={onImportAudio}>
        {busy === "library-import" ? <Loader2 className="spin" size={14} /> : <Upload size={14} />}
        导入本地音乐
      </button>
      <p className="panel-hint">选择音乐后自动铺满全片（音量 30%、首尾 2 秒淡入淡出），可在时间线上继续调整。</p>

      {activeBgmSourceId && (
        <button className="danger-button bgm-remove" disabled={applying} onClick={onRemoveBgm}>
          移除当前背景音乐
        </button>
      )}

      <div className="bgm-list">
        {audioAssets.length === 0 && (
          <div className="library-empty">
            <Music4 size={26} />
            <span>还没有音乐素材，先导入本地音频文件</span>
          </div>
        )}
        {audioAssets.map((asset) => {
          const isActive = asset.id === activeBgmSourceId;
          return (
            <button
              key={asset.id}
              type="button"
              className={`bgm-item ${isActive ? "active" : ""}`}
              disabled={applying}
              onClick={() => onApplyBgm(asset)}
              title={isActive ? "当前背景音乐" : "设为背景音乐"}
            >
              <Music4 size={16} />
              <div className="bgm-item-meta">
                <span>{asset.title}</span>
                <small>{asset.duration > 0 ? `${asset.duration.toFixed(1)}s` : "音频"}</small>
              </div>
              {isActive && <span className="bgm-item-badge">使用中</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
