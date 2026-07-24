import { ExternalLink, FolderOpen, Loader2, Save, Settings as SettingsIcon, Trash2, XCircle } from "lucide-react";
import type { AppInfo, AppSettings, FfmpegStatus, WhisperModelStatus } from "../types";
import { getApiReadiness, whisperStatusLabel } from "../editor/readiness";
import { PEXELS_HOME_URL, PIXABAY_HOME_URL } from "../library/pexelsAttribution";

const ratios = ["9:16", "16:9", "1:1"];

export type UnifiedSettingsDialogProps = {
  settings: AppSettings;
  appInfo: AppInfo | null;
  ffmpeg: FfmpegStatus | null;
  whisperStatus: WhisperModelStatus | null;
  busy: string | null;
  onChange: (settings: AppSettings) => void;
  onSave: () => void;
  onClose: () => void;
  onDownloadWhisper: () => void;
  onSelectWhisper: () => void;
  onDeleteWhisper: () => void;
  onOpenModelsDirectory: () => void;
};

export function UnifiedSettingsDialog({
  settings,
  appInfo,
  ffmpeg,
  whisperStatus,
  busy,
  onChange,
  onSave,
  onClose,
  onDownloadWhisper,
  onSelectWhisper,
  onDeleteWhisper,
  onOpenModelsDirectory,
}: UnifiedSettingsDialogProps) {
  const api = getApiReadiness(settings);
  const update = (patch: Partial<AppSettings>) => onChange({ ...settings, ...patch });

  return (
    <div className="modal-backdrop">
      <div className="settings-modal unified-settings-modal">
        <div className="modal-title">
          <div>
            <SettingsIcon size={18} />
            <strong>统一设置</strong>
          </div>
          <button className="icon-button" onClick={onClose}>
            <XCircle size={18} />
          </button>
        </div>

        <section className="settings-section">
          <div className="settings-section-title">AI 服务</div>
          <div className="settings-grid">
            <label>
              DeepSeek Key
              <input
                type="password"
                value={settings.deepseekApiKey}
                onChange={(event) => update({ deepseekApiKey: event.target.value })}
                placeholder="sk-..."
              />
            </label>
            <label>
              Pexels Key
              <input
                type="password"
                value={settings.pexelsApiKey}
                onChange={(event) => update({ pexelsApiKey: event.target.value })}
                placeholder="Pexels API Key"
              />
            </label>
            <label>
              Pixabay Key
              <input
                type="password"
                value={settings.pixabayApiKey || ""}
                onChange={(event) => update({ pixabayApiKey: event.target.value })}
                placeholder="Pixabay API Key（备用素材源）"
              />
            </label>
            <label>
              Fish Audio API Key
              <input
                type="password"
                value={settings.fishAudioApiKey || ""}
                onChange={(event) => update({ fishAudioApiKey: event.target.value })}
                placeholder="Bearer token"
              />
            </label>
            <label>
              Fish 模型
              <input
                value={settings.fishAudioModel || "s1"}
                onChange={(event) => update({ fishAudioModel: event.target.value })}
                placeholder="s1"
              />
            </label>
            <label>
              Fish Reference ID
              <input
                value={settings.fishAudioReferenceId || ""}
                onChange={(event) => update({ fishAudioReferenceId: event.target.value })}
                placeholder="Fish Audio voice/reference id"
              />
            </label>
            <label>
              Fish 输出格式
              <select value={settings.fishAudioFormat || "mp3"} onChange={(event) => update({ fishAudioFormat: event.target.value })}>
                <option value="mp3">MP3</option>
                <option value="wav">WAV</option>
                <option value="aac">AAC</option>
                <option value="opus">OPUS</option>
              </select>
            </label>
            <label>
              Fish 采样率
              <input
                type="number"
                value={settings.fishAudioSampleRate || 44100}
                onChange={(event) => update({ fishAudioSampleRate: Number(event.target.value) || 44100 })}
              />
            </label>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">素材源致谢</div>
          <div className="settings-pexels-credit" role="note">
            <div className="settings-pexels-credit-main">
              <strong>Photos and videos provided by Pexels</strong>
              <p>
                本应用通过 Pexels API 检索免版税图片与视频。展示搜索结果与选用素材时会保留创作者署名；申请更高配额时请附上本页截图。
              </p>
            </div>
            <a
              className="settings-pexels-credit-link"
              href={PEXELS_HOME_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              <ExternalLink size={14} />
              访问 Pexels
            </a>
          </div>
          <div className="settings-pexels-credit" role="note" style={{ marginTop: 10 }}>
            <div className="settings-pexels-credit-main">
              <strong>Images and videos provided by Pixabay</strong>
              <p>
                Pixabay 作为备用素材源。搜索结果与选用素材会显示创作者署名。免费档约 100 次/分钟。
              </p>
            </div>
            <a
              className="settings-pexels-credit-link"
              href={PIXABAY_HOME_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              <ExternalLink size={14} />
              访问 Pixabay
            </a>
          </div>
          <p className="settings-hint">
            官方要求：显著标明素材来源，并为每条素材显示创作者姓名与链接。详见{" "}
            <a href="https://www.pexels.com/api/documentation/?#guideline-attribution" target="_blank" rel="noreferrer noopener">
              Pexels Guidelines
            </a>
            {" · "}
            <a href="https://pixabay.com/service/terms/" target="_blank" rel="noreferrer noopener">
              Pixabay Terms
            </a>
            。
          </p>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">语音识别</div>
          <div className="settings-status-card">
            <div>
              <strong>Whisper 模型</strong>
              <span>{whisperStatusLabel(whisperStatus)}</span>
            </div>
            <div className="settings-inline-actions">
              <button onClick={onDownloadWhisper}>下载模型</button>
              <button onClick={onSelectWhisper}>选择本地</button>
              <button onClick={onOpenModelsDirectory}><FolderOpen size={14} />模型目录</button>
              <button
                className="danger-button"
                onClick={onDeleteWhisper}
                disabled={!whisperStatus?.partialDownload && whisperStatus?.selectedModelId !== "medium-q5"}
                title={whisperStatus?.selectedModelId === "custom" ? "自定义模型不会由 SceneForge 删除" : "删除应用管理的模型"}
              ><Trash2 size={14} />删除</button>
            </div>
          </div>
          <p className="settings-hint">模型下载、选择和删除属于文件管理操作，会立即生效；下方路径文本修改仅在保存设置后生效。</p>
          <div className="settings-grid">
            <label>
              Whisper 命令（通常无需修改）
              <input
                value={settings.whisperBin || whisperStatus?.whisperPath || "whisper-cli"}
                onChange={(event) => update({ whisperBin: event.target.value })}
                placeholder={whisperStatus?.whisperPath || "whisper-cli"}
              />
            </label>
            <label>
              Whisper 模型路径（.bin 文件）
              <input
                value={settings.whisperModel || ""}
                onChange={(event) => update({ whisperModel: event.target.value })}
                placeholder={appInfo?.modelsDir ? `${appInfo.modelsDir}/ggml-medium-q5_0.bin` : "留空则自动扫描应用 models 目录"}
              />
            </label>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">默认值</div>
          <div className="settings-grid">
            <label>
              默认比例
              <select value={settings.defaultRatio} onChange={(event) => update({ defaultRatio: event.target.value })}>
                {ratios.map((ratio) => <option key={ratio}>{ratio}</option>)}
              </select>
            </label>
            <label>
              渲染预设
              <select value={settings.renderPreset} onChange={(event) => update({ renderPreset: event.target.value })}>
                <option value="preview-fast">快速预览</option>
                <option value="export-high">高清导出</option>
              </select>
            </label>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">诊断</div>
          <div className="settings-diagnostics">
            <span className={api.deepseekReady ? "ok" : "warn"}>{api.deepseekReady ? "DeepSeek 已配置" : "DeepSeek 未配置"}</span>
            <span className={api.pexelsReady ? "ok" : "warn"}>{api.pexelsReady ? "Pexels 已配置" : "Pexels 未配置"}</span>
            <span className={api.pixabayReady ? "ok" : "warn"}>{api.pixabayReady ? "Pixabay 已配置" : "Pixabay 未配置"}</span>
            <span className={api.fishAudioReady ? "ok" : "warn"}>{api.fishAudioReady ? "Fish Audio 已配置" : "Fish Audio 未配置"}</span>
            <span className={ffmpeg?.available ? "ok" : "warn"}>{ffmpeg?.available ? `FFmpeg ${ffmpeg.version || "可用"}` : (ffmpeg?.error || "FFmpeg 检测中")}</span>
          </div>
          <p className="settings-hint">导出设置（分辨率/帧率/码率）已移至「导出」弹窗。</p>
          <p className="settings-hint">桌面安装包已内置 FFmpeg、FFprobe 和 whisper-cli。Whisper 模型请放入 {appInfo?.modelsDir || "应用数据 models 目录"}，或在上方指定路径。</p>
        </section>

        <div className="modal-actions">
          <button onClick={onClose}>取消</button>
          <button className="primary-button" onClick={onSave}>
            {busy === "settings" ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
            保存设置
          </button>
        </div>
      </div>
    </div>
  );
}
