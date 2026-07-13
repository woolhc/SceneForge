import { CheckCircle2, FileText, Loader2, Mic, Sparkles, Upload, X, XCircle } from "lucide-react";
import { useState } from "react";
import type { VoiceProfile } from "../types";
import type { GenerationReport } from "../editor/generationSession";
import { desktopApi } from "../tauri";

export type PipelineStep = {
  label: string;
  status: "pending" | "running" | "done" | "error";
};

export type PipelineState = {
  active: boolean;
  steps: PipelineStep[];
  error: string | null;
  report: GenerationReport | null;
};

export function GenerateWizard({
  open,
  onClose,
  voiceProfiles,
  hasDeepSeekKey,
  hasPexelsKey,
  hasFishAudioKey,
  hasFishAudioVoice,
  pipeline,
  onStart,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  voiceProfiles: VoiceProfile[];
  hasDeepSeekKey: boolean;
  hasPexelsKey: boolean;
  hasFishAudioKey: boolean;
  hasFishAudioVoice: boolean;
  pipeline: PipelineState;
  onStart: (input: { script: string; ratio: string; voiceId: string; translate: boolean; materialDirection: string; audioPath?: string | null }) => void;
  onError?: (message: string) => void;
}) {
  const [mode, setMode] = useState<"script" | "audio">("script");
  const [script, setScript] = useState("");
  const [ratio, setRatio] = useState("9:16");
  const [voiceId, setVoiceId] = useState("");
  const [materialDirection, setMaterialDirection] = useState("auto");
  const [customMaterialKeywords, setCustomMaterialKeywords] = useState("");
  const [translate, setTranslate] = useState(false);
  const [audioPath, setAudioPath] = useState<string | null>(null);

  if (!open) return null;

  const canStart =
    (mode === "audio" ? Boolean(audioPath) : script.trim().length > 0 && Boolean(voiceId || hasFishAudioVoice)) &&
    hasDeepSeekKey &&
    hasPexelsKey &&
    (mode === "audio" || hasFishAudioKey);

  const resolvedMaterialDirection =
    materialDirection === "custom"
      ? `custom:${customMaterialKeywords.trim()}`
      : materialDirection;

  async function handleImportAudio() {
    const path = await desktopApi.pickMediaFile();
    if (!path) return;
    // 只接受音频文件
    if (!path.match(/\.(mp3|wav|m4a|aac|flac|ogg)$/i)) {
      setScript("请选择音频文件");
      return;
    }
    setAudioPath(path);
    // 不在导入阶段预转写；正式生成时只运行一次 Whisper，并复用其时间戳生成字幕。
    setScript("");
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
          {pipeline.report && (
            <div className="generation-report">
              <strong>生成报告</strong>
              <div><span>旁白时长</span><b>{pipeline.report.narrationDuration.toFixed(1)}s</b></div>
              <div><span>分镜数量</span><b>{pipeline.report.segmentCount}</b></div>
              <div><span>成功匹配素材</span><b>{pipeline.report.matchedAssetCount}</b></div>
              <div><span>重复素材</span><b>{pipeline.report.duplicateAssetCount}</b></div>
              <div><span>低置信度片段</span><b>{pipeline.report.lowConfidenceSegmentCount}</b></div>
              <div><span>失败片段</span><b>{pipeline.report.failedSegmentCount}</b></div>
              <div><span>字幕质量提示</span><b>{pipeline.report.subtitleIssueCount}</b></div>
              {pipeline.report.lowConfidenceSegmentCount > 0 && (
                <small>低置信度片段已保留为空素材，可在时间线中逐段搜索、替换或改为文字卡。</small>
              )}
            </div>
          )}
          {(pipeline.error || pipeline.report) && (
            <button className="primary-button" onClick={onClose}>
              {pipeline.report ? "进入编辑器" : "关闭"}
            </button>
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
                <button onClick={handleImportAudio} >更换</button>
              </div>
            ) : (
              <button className="wizard-upload" onClick={handleImportAudio} >
                <Upload size={18} />
                导入音频文件
              </button>
            )}
          </div>
        )}

        {/* 文案输入；音频模式不预转写，避免和正式流水线重复执行 Whisper。 */}
        {mode === "script" ? (
          <div className="wizard-section">
            <label className="wizard-label">文案内容</label>
            <textarea
              className="wizard-script"
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder={"粘贴你的文案，例如：\n人生最好的状态，不是一直向前冲，而是知道什么时候停下来..."}
              rows={6}
            />
          </div>
        ) : (
          <div className="wizard-section wizard-note">
            主旁白会在生成阶段统一执行一次 Whisper 转写；分镜和字幕将复用同一份时间戳。
          </div>
        )}

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
              Fish 音色
              <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                <option value="">使用默认 Reference ID</option>
                {voiceProfiles.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </label>
          )}
          <label className="wizard-field">
            素材方向
            <select value={materialDirection} onChange={(e) => setMaterialDirection(e.target.value)}>
              <option value="auto">AI 自动判断</option>
              <option value="scenery">风景 / 空镜</option>
              <option value="people">人物 / 生活方式</option>
              <option value="business">商业 / 办公</option>
              <option value="abstract">抽象 / 质感</option>
              <option value="custom">自定义关键词</option>
            </select>
          </label>
          {materialDirection === "custom" && (
            <label className="wizard-field wizard-field-wide">
              自定义关键词
              <input
                value={customMaterialKeywords}
                onChange={(e) => setCustomMaterialKeywords(e.target.value)}
                placeholder="例如：海边、日落、年轻人、城市夜景"
              />
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
        {mode === "script" && !hasFishAudioKey && <p className="wizard-warn">⚠️ 需要先在设置中配置 Fish Audio API Key</p>}
        {mode === "script" && !voiceId && !hasFishAudioVoice && <p className="wizard-warn">⚠️ 需要配置 Fish Audio Reference ID，或选择一个 Fish 音色</p>}
        {mode === "audio" && !audioPath && <p className="wizard-warn">⚠️ 音频生成需要先导入音频文件</p>}

        {/* 启动按钮 */}
        <div className="wizard-actions">
          <button onClick={onClose}>取消</button>
          <button
            className="primary-button"
            disabled={!canStart}
            onClick={() => onStart({
              script,
              ratio,
              voiceId: mode === "audio" ? "" : voiceId,
              translate,
              materialDirection: resolvedMaterialDirection,
              audioPath: mode === "audio" ? audioPath : null,
            })}
          >
            <Sparkles size={16} />
            开始生成
          </button>
        </div>
      </div>
    </div>
  );
}
