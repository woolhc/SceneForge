import { CheckCircle2, FileText, Loader2, Mic, Sparkles, Upload, X, XCircle } from "lucide-react";
import { useState } from "react";
import type { VoiceProfile } from "../types";
import type { GenerationReport } from "../editor/generationSession";
import { listCompositionTemplates } from "../editor/composition";
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
}: {
  open: boolean;
  onClose: () => void;
  voiceProfiles: VoiceProfile[];
  hasDeepSeekKey: boolean;
  hasPexelsKey: boolean;
  hasFishAudioKey: boolean;
  hasFishAudioVoice: boolean;
  pipeline: PipelineState;
  onStart: (input: {
    script: string;
    ratio: string;
    voiceId: string;
    translate: boolean;
    materialDirection: string;
    audioPath?: string | null;
    compositionTemplateId?: string;
  }) => void;
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
  const [compositionTemplateId, setCompositionTemplateId] = useState("standard-fill");
  const compositionTemplates = listCompositionTemplates();
  const isKnowledgeCard = compositionTemplateId === "knowledge-card";

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

  const warnings = [
    !hasDeepSeekKey ? "需要配置 DeepSeek API Key" : null,
    !hasPexelsKey ? "需要配置 Pexels 或 Pixabay API Key" : null,
    mode === "script" && !hasFishAudioKey ? "需要配置 Fish Audio API Key" : null,
    mode === "script" && !voiceId && !hasFishAudioVoice ? "需要 Fish Reference ID 或选择音色" : null,
    mode === "audio" && !audioPath ? "请先导入音频文件" : null,
  ].filter(Boolean) as string[];

  async function handleImportAudio() {
    const path = await desktopApi.pickMediaFile();
    if (!path) return;
    if (!path.match(/\.(mp3|wav|m4a|aac|flac|ogg)$/i)) {
      setScript("请选择音频文件");
      return;
    }
    setAudioPath(path);
    setScript("");
  }

  function handleSelectComposition(id: string) {
    setCompositionTemplateId(id);
    if (id === "knowledge-card") {
      setRatio("9:16");
      setTranslate(true);
    }
  }

  if (pipeline.active) {
    return (
      <div className="modal-backdrop">
        <div className="generate-wizard generate-wizard-progress">
          <div className="wizard-header">
            <div className="wizard-title">
              <span className="wizard-title-icon"><Sparkles size={18} /></span>
              <div>
                <strong>正在生成视频</strong>
                <small>请稍候，完成后可直接进入编辑器</small>
              </div>
            </div>
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
          {pipeline.error && <div className="pipeline-error">{pipeline.error}</div>}
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
            <div className="wizard-actions">
              <button className="primary-button" onClick={onClose}>
                {pipeline.report ? "进入编辑器" : "关闭"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="generate-wizard" onClick={(e) => e.stopPropagation()}>
        <div className="wizard-header">
          <div className="wizard-title">
            <span className="wizard-title-icon"><Sparkles size={18} /></span>
            <div>
              <strong>一键生成视频</strong>
              <small>文案/音频 → 分镜配音 → 素材匹配 → 字幕版式</small>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="wizard-layout">
          <section className="wizard-main">
            <div className="wizard-segmented" role="tablist" aria-label="生成模式">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "script"}
                className={mode === "script" ? "active" : ""}
                onClick={() => setMode("script")}
              >
                <FileText size={15} />
                文案生成
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "audio"}
                className={mode === "audio" ? "active" : ""}
                onClick={() => setMode("audio")}
              >
                <Mic size={15} />
                音频生成
              </button>
            </div>

            {mode === "script" ? (
              <div className="wizard-section wizard-section-grow">
                <div className="wizard-section-head">
                  <label className="wizard-label" htmlFor="wizard-script">文案内容</label>
                  <span className="wizard-meta">{script.trim().length > 0 ? `${script.trim().length} 字` : "必填"}</span>
                </div>
                <textarea
                  id="wizard-script"
                  className="wizard-script"
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  placeholder={"粘贴你的文案，例如：\n今天分享三个超好用的英语表达，第一个是 hold on..."}
                />
              </div>
            ) : (
              <div className="wizard-section wizard-section-grow">
                <div className="wizard-section-head">
                  <label className="wizard-label">主旁白音频</label>
                  <span className="wizard-meta">mp3 / wav / m4a</span>
                </div>
                {audioPath ? (
                  <div className="audio-imported">
                    <Mic size={16} />
                    <span title={audioPath}>{audioPath.split("/").pop()}</span>
                    <button type="button" onClick={handleImportAudio}>更换</button>
                  </div>
                ) : (
                  <button type="button" className="wizard-upload" onClick={handleImportAudio}>
                    <Upload size={18} />
                    <span>导入音频文件</span>
                    <small>生成时统一 Whisper 转写，分镜与字幕共用时间戳</small>
                  </button>
                )}
              </div>
            )}

            {warnings.length > 0 && (
              <div className="wizard-warn-list" role="status">
                {warnings.map((item) => (
                  <p key={item} className="wizard-warn">{item}</p>
                ))}
              </div>
            )}
          </section>

          <aside className="wizard-side">
            <div className="wizard-section">
              <div className="wizard-section-head">
                <label className="wizard-label">版式</label>
                {isKnowledgeCard && <span className="wizard-chip">9:16 · 双语</span>}
              </div>
              <div className="composition-picker">
                {compositionTemplates.map((template) => {
                  const active = compositionTemplateId === template.id;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      className={`composition-card ${active ? "active" : ""}`}
                      onClick={() => handleSelectComposition(template.id)}
                      aria-pressed={active}
                    >
                      <div className={`composition-phone composition-phone-${template.id}`} aria-hidden>
                        {template.id === "knowledge-card" ? (
                          <>
                            <span className="phone-title" />
                            <span className="phone-sub" />
                            <span className="phone-media" />
                            <span className="phone-caption" />
                            <span className="phone-caption secondary" />
                          </>
                        ) : (
                          <>
                            <span className="phone-fill" />
                            <span className="phone-caption single" />
                          </>
                        )}
                      </div>
                      <div className="composition-copy">
                        <strong>{template.name}</strong>
                        <small>{template.description}</small>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="wizard-section">
              <div className="wizard-section-head">
                <label className="wizard-label">生成选项</label>
              </div>
              <div className="wizard-options">
                <label className="wizard-field">
                  画布比例
                  <select
                    value={ratio}
                    onChange={(e) => setRatio(e.target.value)}
                    disabled={isKnowledgeCard}
                  >
                    <option value="9:16">9:16 竖屏</option>
                    <option value="16:9">16:9 横屏</option>
                    <option value="1:1">1:1 方形</option>
                  </select>
                </label>
                {mode === "script" && (
                  <label className="wizard-field">
                    Fish 音色
                    <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                      <option value="">默认 Reference ID</option>
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
                      placeholder="海边、日落、年轻人、城市夜景"
                    />
                  </label>
                )}
              </div>
              <label className="wizard-checkbox">
                <input
                  type="checkbox"
                  checked={translate}
                  onChange={(e) => setTranslate(e.target.checked)}
                />
                <span>
                  双语字幕
                  <small>英文主字幕 + 中文对照</small>
                </span>
              </label>
              {isKnowledgeCard && (
                <p className="wizard-hint">知识卡片使用 16:9 横版素材落入中间条带，并生成可编辑的主/副标题文字轨。</p>
              )}
            </div>
          </aside>
        </div>

        <div className="wizard-actions">
          <button type="button" className="wizard-btn-ghost" onClick={onClose}>取消</button>
          <button
            type="button"
            className="primary-button wizard-btn-primary"
            disabled={!canStart}
            onClick={() => onStart({
              script,
              ratio: isKnowledgeCard ? "9:16" : ratio,
              voiceId: mode === "audio" ? "" : voiceId,
              translate,
              materialDirection: resolvedMaterialDirection,
              audioPath: mode === "audio" ? audioPath : null,
              compositionTemplateId,
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
