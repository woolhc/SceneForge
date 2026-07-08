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

  // 导出预设（剪映式一键配置）
  type Preset = {
    id: string;
    name: string;
    desc: string;
    patch: Partial<RenderConfig>;
  };
  const presets: Preset[] = [
    { id: "draft", name: "草稿预览", desc: "720p · 30fps · 2Mbps", patch: { resolution: "720p", fps: 30, bitrateMbps: 2, codec: "h264" } },
    { id: "sd", name: "标清发布", desc: "720p · 30fps · 4Mbps", patch: { resolution: "720p", fps: 30, bitrateMbps: 4, codec: "h264" } },
    { id: "hd", name: "高清发布", desc: "1080p · 30fps · 8Mbps", patch: { resolution: "1080p", fps: 30, bitrateMbps: 8, codec: "h264" } },
    { id: "hd60", name: "高清高帧率", desc: "1080p · 60fps · 12Mbps", patch: { resolution: "1080p", fps: 60, bitrateMbps: 12, codec: "h264" } },
    { id: "uhd", name: "4K 超清", desc: "4K · 30fps · 25Mbps", patch: { resolution: "4k", fps: 30, bitrateMbps: 25, codec: "hevc" } },
    { id: "tiktok", name: "短视频", desc: "1080p · 30fps · 6Mbps", patch: { resolution: "1080p", fps: 30, bitrateMbps: 6, codec: "h264" } },
  ];

  // 判断当前是否命中某个预设
  const matchedPreset = presets.find((p) =>
    Object.entries(p.patch).every(([k, v]) => (config as Record<string, unknown>)[k] === v),
  );

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

            {/* 导出预设（剪映式一键配置） */}
            <div className="export-section">
              <div className="export-section-title">导出预设</div>
              <div className="preset-grid">
                {presets.map((p) => (
                  <button
                    key={p.id}
                    className={`preset-card ${matchedPreset?.id === p.id ? "active" : ""}`}
                    onClick={() => onConfigChange({ ...config, ...p.patch })}
                    title={p.desc}
                  >
                    <strong>{p.name}</strong>
                    <small>{p.desc}</small>
                  </button>
                ))}
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
                <label>
                  编码格式
                  <select
                    value={config.codec ?? "h264"}
                    onChange={(e) => onConfigChange({ ...config, codec: e.target.value as "h264" | "hevc" })}
                  >
                    <option value="h264">H.264（兼容性好）</option>
                    <option value="hevc">H.265/HEVC（体积小）</option>
                  </select>
                </label>
                <label>
                  导出模式
                  <select
                    value={config.exportMode ?? "video"}
                    onChange={(e) => onConfigChange({ ...config, exportMode: e.target.value as "video" | "audio-only" })}
                  >
                    <option value="video">视频（含画面）</option>
                    <option value="audio-only">仅音频（MP3）</option>
                  </select>
                </label>
                <label>
                  默认转场时长（秒）
                  <input
                    type="number"
                    min={0.1}
                    max={2.0}
                    step={0.1}
                    value={config.transitionDuration ?? 0.5}
                    onChange={(e) => onConfigChange({ ...config, transitionDuration: Number(e.target.value) })}
                  />
                </label>
                <label>
                  字幕处理
                  <select
                    value={config.subtitleMode ?? "burn"}
                    onChange={(e) => onConfigChange({ ...config, subtitleMode: e.target.value as "burn" | "srt" | "none" })}
                  >
                    <option value="burn">烧录到画面</option>
                    <option value="srt">导出 .srt 文件</option>
                    <option value="none">不包含字幕</option>
                  </select>
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
