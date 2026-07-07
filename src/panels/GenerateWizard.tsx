import { CheckCircle2, FileText, Loader2, Mic, Sparkles, Upload, X, XCircle } from "lucide-react";
import { useState } from "react";
import type { VoiceProfile } from "../types";
import { desktopApi } from "../tauri";

export type PipelineStep = {
  label: string;
  status: "pending" | "running" | "done" | "error";
};

export type PipelineState = {
  active: boolean;
  steps: PipelineStep[];
  error: string | null;
};

export function GenerateWizard({
  open,
  onClose,
  voiceProfiles,
  hasDeepSeekKey,
  hasPexelsKey,
  pipeline,
  onStart,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  voiceProfiles: VoiceProfile[];
  hasDeepSeekKey: boolean;
  hasPexelsKey: boolean;
  pipeline: PipelineState;
  onStart: (input: { script: string; ratio: string; voiceId: string; translate: boolean; audioPath?: string | null }) => void;
  onError?: (message: string) => void;
}) {
  const [mode, setMode] = useState<"script" | "audio">("script");
  const [script, setScript] = useState("");
  const [ratio, setRatio] = useState("9:16");
  const [voiceId, setVoiceId] = useState("");
  const [translate, setTranslate] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [audioPath, setAudioPath] = useState<string | null>(null);

  if (!open) return null;

  const canStart =
    script.trim().length > 0 &&
    (mode === "audio" || voiceId) &&
    hasDeepSeekKey &&
    hasPexelsKey;

  async function handleImportAudio() {
    const path = await desktopApi.pickMediaFile();
    if (!path) return;
    // 只接受音频文件
    if (!path.match(/\.(mp3|wav|m4a|aac|flac|ogg)$/i)) {
      setScript("请选择音频文件");
      return;
    }
    setAudioPath(path);
    setTranscribing(true);
    setScript("");
    try {
      const text = await desktopApi.transcribeToText(path);
      setScript(text);
    } catch (e) {
      setScript("");
      const msg = e instanceof Error ? e.message : String(e);
      // M3: 用 onError 回调替代 alert，由父组件统一用 status 条提示
      onError?.("音频识别失败：" + msg);
    } finally {
      setTranscribing(false);
    }
  }

  // 流水线运行中 → 显示进度
  if (pipeline.active) {
    return (
      <div className="modal-backdrop">
        <div className="generate-wizard">
          <div className="wizard-header">
            <Sparkles size={20} />
            <strong>正在生成视频...</strong>
          </div>
          <div className="pipeline-steps">
            {pipeline.steps.map((step, i) => (
              <div key={i} className={`pipeline-step ${step.status}`}>
                {step.status === "done" && <CheckCircle2 size={18} />}
                {step.status === "running" && <Loader2 className="spin" size={18} />}
                {step.status === "error" && <XCircle size={18} />}
                {step.status === "pending" && <div className="step-pending" />}
                <span>{step.label}</span>
              </div>
            ))}
          </div>
          {pipeline.error && (
            <div className="pipeline-error">{pipeline.error}</div>
          )}
          {pipeline.error && (
            <button className="primary-button" onClick={onClose}>关闭</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="generate-wizard" onClick={(e) => e.stopPropagation()}>
        <div className="wizard-header">
          <div>
            <Sparkles size={20} />
            <strong>一键生成视频</strong>
          </div>
          <button className="icon-button" onClick={onClose}><X size={18} /></button>
        </div>

        {/* 模式选择 */}
        <div className="wizard-modes">
          <button
            className={`mode-card ${mode === "script" ? "active" : ""}`}
            onClick={() => setMode("script")}
          >
            <FileText size={20} />
            <strong>文案生成</strong>
            <small>输入文案，AI 全自动分镜、配音、配素材</small>
          </button>
          <button
            className={`mode-card ${mode === "audio" ? "active" : ""}`}
            onClick={() => setMode("audio")}
          >
            <Mic size={20} />
            <strong>音频生成</strong>
            <small>导入配音音频，识别文字后自动分镜配素材</small>
          </button>
        </div>

        {/* 音频导入（模式 1） */}
        {mode === "audio" && (
          <div className="wizard-section">
            {audioPath ? (
              <div className="audio-imported">
                <Mic size={16} />
                <span>{audioPath.split("/").pop()}</span>
                <button onClick={handleImportAudio} disabled={transcribing}>更换</button>
              </div>
            ) : (
              <button className="wizard-upload" onClick={handleImportAudio} disabled={transcribing}>
                {transcribing ? <Loader2 className="spin" size={18} /> : <Upload size={18} />}
                {transcribing ? "正在识别音频..." : "导入音频文件"}
              </button>
            )}
          </div>
        )}

        {/* 文案输入 */}
        <div className="wizard-section">
          <label className="wizard-label">
            {mode === "audio" ? "识别结果（可编辑）" : "文案内容"}
          </label>
          <textarea
            className="wizard-script"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder={mode === "audio" ? "导入音频后自动识别..." : "粘贴你的文案，例如：\n人生最好的状态，不是一直向前冲，而是知道什么时候停下来..."}
            rows={6}
          />
        </div>

        {/* 设置 */}
        <div className="wizard-options">
          <label className="wizard-field">
            比例
            <select value={ratio} onChange={(e) => setRatio(e.target.value)}>
              <option value="9:16">9:16 竖屏</option>
              <option value="16:9">16:9 横屏</option>
              <option value="1:1">1:1 方形</option>
            </select>
          </label>
          {mode === "script" && (
            <label className="wizard-field">
              配音音色
              <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                <option value="">选择音色</option>
                {voiceProfiles.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </label>
          )}
          <label className="wizard-checkbox">
            <input type="checkbox" checked={translate} onChange={(e) => setTranslate(e.target.checked)} />
            <span>翻译字幕（英文→中文双语）</span>
          </label>
        </div>

        {/* 校验提示 */}
        {!hasDeepSeekKey && <p className="wizard-warn">⚠️ 需要先在设置中配置 DeepSeek API Key</p>}
        {!hasPexelsKey && <p className="wizard-warn">⚠️ 需要先在设置中配置 Pexels API Key</p>}
        {mode === "script" && voiceProfiles.length === 0 && <p className="wizard-warn">⚠️ 需要先在音频 Tab 上传克隆音色</p>}

        {/* 启动按钮 */}
        <div className="wizard-actions">
          <button onClick={onClose}>取消</button>
          <button
            className="primary-button"
            disabled={!canStart}
            onClick={() => onStart({ script, ratio, voiceId: mode === "audio" ? "" : voiceId, translate, audioPath: mode === "audio" ? audioPath : null })}
          >
            <Sparkles size={16} />
            开始生成
          </button>
        </div>
      </div>
    </div>
  );
}
