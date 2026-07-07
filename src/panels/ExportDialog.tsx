import { CheckCircle2, Download, FolderOpen, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import type { RenderConfig } from "../types";
import { desktopApi } from "../tauri";

export type ExportState = "idle" | "exporting" | "done" | "error";

export function ExportDialog({
  open,
  onClose,
  config,
  onConfigChange,
  onExport,
  onCancel,
  exportState,
  exportProgress,
  exportMessage,
  outputPath,
  errorMessage,
  defaultName,
}: {
  open: boolean;
  onClose: () => void;
  config: RenderConfig;
  onConfigChange: (config: RenderConfig) => void;
  onExport: (outputPath: string | null) => void;
  onCancel?: () => void;
  exportState: ExportState;
  exportProgress?: number;
  exportMessage?: string;
  outputPath?: string | null;
  errorMessage?: string;
  defaultName: string;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [savePath, setSavePath] = useState<string | null>(null);

  if (!open) return null;

  const resolutions = [
    { v: "480p", label: "480p · 流畅", w: "854×480" },
    { v: "720p", label: "720p · 标清", w: "1280×720" },
    { v: "1080p", label: "1080p · 高清（推荐）", w: "1920×1080" },
    { v: "4k", label: "4K · 超高清", w: "3840×2160" },
  ];

  return (
    <div className="modal-backdrop" onClick={exportState === "exporting" ? undefined : onClose}>
      <div className="export-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          <div>
            <Download size={18} />
            <strong>导出视频</strong>
          </div>
          {exportState !== "exporting" && (
            <button className="icon-button" onClick={onClose}>
              <XCircle size={18} />
            </button>
          )}
        </div>

        {exportState === "idle" && (
          <>
            {/* 保存位置 */}
            <div className="export-section">
              <div className="export-section-title">保存位置</div>
              <div className="save-path-row">
                <code className="save-path">{savePath || `${defaultName}.mp4（默认位置）`}</code>
                <button
                  className="browse-btn"
                  onClick={async () => {
                    const path = await desktopApi.pickExportPath(`${defaultName}.mp4`);
                    if (path) setSavePath(path);
                  }}
                >
                  <FolderOpen size={14} />
                  浏览
                </button>
              </div>
            </div>

            {/* 分辨率选择 */}
            <div className="export-section">
              <div className="export-section-title">分辨率</div>
              <div className="resolution-grid">
                {resolutions.map((r) => (
                  <button
                    key={r.v}
                    className={`resolution-card ${config.resolution === r.v ? "active" : ""}`}
                    onClick={() => onConfigChange({ ...config, resolution: r.v })}
                  >
                    <strong>{r.label}</strong>
                    <small>{r.w}</small>
                  </button>
                ))}
              </div>
            </div>

            {/* 高级设置 */}
            <button className="export-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
              高级设置 {showAdvanced ? "▾" : "▸"}
            </button>
            {showAdvanced && (
              <div className="settings-grid">
                <label>
                  帧率
                  <select
                    value={config.fps}
                    onChange={(e) => onConfigChange({ ...config, fps: Number(e.target.value) })}
                  >
                    <option value={24}>24 fps</option>
                    <option value={25}>25 fps</option>
                    <option value={30}>30 fps</option>
                    <option value={60}>60 fps</option>
                  </select>
                </label>
                <label>
                  码率（Mbps，0=自动）
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={config.bitrateMbps ?? 0}
                    onChange={(e) => onConfigChange({ ...config, bitrateMbps: Number(e.target.value) })}
                  />
                </label>
              </div>
            )}

            {/* 导出按钮 */}
            <div className="modal-actions">
              <button onClick={onClose}>取消</button>
              <button className="primary-button" onClick={() => onExport(savePath)}>
                <Download size={16} />
                开始导出
              </button>
            </div>
          </>
        )}

        {/* 导出中 */}
        {exportState === "exporting" && (
          <div className="export-progress">
            <Loader2 className="spin" size={40} />
            <strong>{exportMessage || "正在渲染视频..."}</strong>
            <div className="export-progress-bar">
              <div className="export-progress-fill" style={{ width: `${exportProgress ?? 0}%` }} />
            </div>
            <span className="export-progress-pct">{exportProgress ?? 0}%</span>
            {onCancel && (
              <button className="export-cancel-btn" onClick={onCancel}>
                取消导出
              </button>
            )}
          </div>
        )}

        {/* 导出完成 */}
        {exportState === "done" && (
          <div className="export-done">
            <CheckCircle2 size={48} color="var(--accent)" />
            <strong>导出成功！</strong>
            {outputPath && (
              <>
                <code className="export-path">{outputPath}</code>
                <div className="modal-actions">
                  <button onClick={onClose}>关闭</button>
                  <button className="primary-button" onClick={() => {
                    if (outputPath) {
                      void desktopApi.revealInFinder(outputPath);
                    }
                  }}>
                    <FolderOpen size={16} />
                    打开文件
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* 导出失败 */}
        {exportState === "error" && (
          <div className="export-done">
            <XCircle size={48} color="#ff6b6b" />
            <strong>导出失败</strong>
            <code className="export-error">{errorMessage}</code>
            <div className="modal-actions">
              <button onClick={onClose}>关闭</button>
              <button className="primary-button" onClick={() => onExport(savePath)}>重试</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
