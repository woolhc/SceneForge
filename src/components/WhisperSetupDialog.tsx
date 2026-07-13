import { Download, FileUp, Loader2, XCircle } from "lucide-react";
import type { WhisperModelDownloadProgress, WhisperModelStatus } from "../types";
import { hasWhisperModel, whisperStatusLabel } from "../editor/readiness";

export type WhisperSetupDialogProps = {
  open: boolean;
  status: WhisperModelStatus | null;
  progress: WhisperModelDownloadProgress | null;
  busy: boolean;
  error: string | null;
  onDownload: () => void;
  onSelectLocal: () => void;
  onContinue: () => void;
  onCancelDownload: () => void;
  onCancel: () => void;
};

function progressNumbers(progress: WhisperModelDownloadProgress | null) {
  if (!progress) return { downloaded: 0, total: 0, percent: 0 };
  const downloaded = progress.downloadedBytes ?? 0;
  const total = progress.totalBytes ?? 0;
  const percent = progress.progress ?? (total > 0 ? (downloaded / total) * 100 : 0);
  return { downloaded, total, percent: Math.max(0, Math.min(100, percent)) };
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function WhisperSetupDialog({
  open,
  status,
  progress,
  busy,
  error,
  onDownload,
  onSelectLocal,
  onContinue,
  onCancelDownload,
  onCancel,
}: WhisperSetupDialogProps) {
  if (!open) return null;
  const ready = hasWhisperModel(status);
  const { downloaded, total, percent } = progressNumbers(progress);
  const hasProgress = Boolean(progress && (downloaded > 0 || total > 0 || progress.message));

  return (
    <div className="modal-backdrop">
      <div className="whisper-setup-dialog">
        <div className="modal-title">
          <div>
            <Download size={18} />
            <strong>首次使用 Whisper 模型</strong>
          </div>
          <button className="icon-button" onClick={busy ? onCancelDownload : onCancel}><XCircle size={18} /></button>
        </div>
        <div className="whisper-setup-body">
          <p>一键生成和字幕识别需要本地 Whisper 模型。模型在本机运行，音频不会上传到第三方。</p>
          {status?.model && (
            <div className="whisper-model-card">
              <div>
                <strong>{status.model.name}</strong>
                <span>推荐 · {formatBytes(status.model.sizeBytes)}</span>
              </div>
              <p>{status.model.description}</p>
            </div>
          )}
          <div className={`whisper-status ${ready ? "ok" : "warn"}`}>
            <span>当前状态</span>
            <strong>{whisperStatusLabel(status)}</strong>
          </div>
          {hasProgress && (
            <div className="download-progress">
              <div>
                <span>{progress?.message || "正在下载模型"}</span>
                <strong>{percent.toFixed(0)}%</strong>
              </div>
              <progress value={percent} max={100} />
              <small>{formatBytes(downloaded)}{total > 0 ? ` / ${formatBytes(total)}` : ""}</small>
            </div>
          )}
          {(error) && <div className="settings-error">{error}</div>}
        </div>
        <div className="modal-actions">
          {busy ? <button onClick={onCancelDownload}>取消下载</button> : <button onClick={onCancel}>取消</button>}
          <button onClick={onSelectLocal} disabled={busy}><FileUp size={16} />选择本地</button>
          <button onClick={onDownload} disabled={busy}>
            {busy ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
            下载模型
          </button>
          <button className="primary-button" onClick={onContinue} disabled={!ready || busy}>继续</button>
        </div>
      </div>
    </div>
  );
}
