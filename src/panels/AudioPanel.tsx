import {
  Check,
  Loader2,
  Mic2,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import { useRef } from "react";
import type { VoiceProfile } from "../types";

/**
 * 音频 Tab：
 * - 顶部：默认音色选择 + 生成全部配音
 * - 音色管理列表（上传/试听/替换音频/改名/删除）—— 从原设置弹窗迁移
 * - 试听播放器
 */
export function AudioPanel({
  voiceProfiles,
  defaultVoiceId,
  selectedVoiceId,
  previewText,
  previewUrl,
  busy,
  voiceNameDrafts,
  voiceReferenceDrafts,
  newVoiceName,
  newVoiceReferenceText,
  onSelectVoice,
  onGenerateAllAudio,
  onImportVoice,
  onPreviewVoice,
  onPreviewTextChange,
  onDeleteVoice,
  onSaveVoice,
  onReplaceVoice,
  onNameDraftChange,
  onReferenceDraftChange,
  onNewVoiceNameChange,
  onNewVoiceReferenceTextChange,
}: {
  voiceProfiles: VoiceProfile[];
  defaultVoiceId: string | null;
  selectedVoiceId: string;
  previewText: string;
  previewUrl: string | null;
  busy: string | null;
  voiceNameDrafts: Record<string, string>;
  voiceReferenceDrafts: Record<string, string>;
  newVoiceName: string;
  newVoiceReferenceText: string;
  onSelectVoice: (id: string) => void;
  onGenerateAllAudio: () => void;
  onImportVoice: (file?: File) => void;
  onPreviewVoice: (id?: string) => void;
  onPreviewTextChange: (text: string) => void;
  onDeleteVoice: (id: string) => void;
  onSaveVoice: (id: string) => void;
  onReplaceVoice: (id: string, file?: File) => void;
  onNameDraftChange: (id: string, value: string) => void;
  onReferenceDraftChange: (id: string, value: string) => void;
  onNewVoiceNameChange: (value: string) => void;
  onNewVoiceReferenceTextChange: (value: string) => void;
}) {
  const generating = busy === "audio";
  const importing = busy === "voice";
  // 内部文件选择：新增音色 + 替换参考音频共用一个 input，用 targetRef 区分
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileTargetRef = useRef<"new" | string | null>(null);

  function triggerFileInput(target: "new" | string) {
    fileTargetRef.current = target;
    fileInputRef.current?.click();
  }

  return (
    <div className="panel-content">
      {/* 共享隐藏文件输入 */}
      <input
        ref={fileInputRef}
        className="hidden-file-input"
        type="file"
        disabled={importing}
        accept="audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg"
        onChange={(event) => {
          const file = event.target.files?.[0];
          const target = fileTargetRef.current;
          if (file && target === "new") onImportVoice(file);
          else if (file && target) onReplaceVoice(target, file);
          fileTargetRef.current = null;
          if (fileInputRef.current) fileInputRef.current.value = "";
        }}
      />
      <div className="audio-section">
        <label className="voice-picker">
          默认音色
          <select value={selectedVoiceId} onChange={(event) => onSelectVoice(event.target.value)}>
            <option value="">选择音色</option>
            {voiceProfiles.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="panel-primary-action"
          disabled={generating}
          onClick={onGenerateAllAudio}
        >
          {generating ? <Loader2 className="spin" size={15} /> : <Mic2 size={15} />}
          生成全部配音
        </button>
      </div>

      <div className="audio-section">
        <div className="audio-section-title">新增音色</div>
        <div className="voice-form">
          <input
            value={newVoiceName}
            onChange={(event) => onNewVoiceNameChange(event.target.value)}
            placeholder="音色名称，例如：温柔女声"
          />
          <input
            value={newVoiceReferenceText}
            onChange={(event) => onNewVoiceReferenceTextChange(event.target.value)}
            placeholder="参考音频对应文字，可选"
          />
          <button
            type="button"
            className={`voice-upload-label ${importing ? "disabled" : ""}`}
            disabled={importing}
            onClick={() => triggerFileInput("new")}
          >
            {importing ? <Loader2 className="spin" size={15} /> : <Upload size={15} />}
            上传并新增
          </button>
        </div>
      </div>

      <div className="audio-section">
        <div className="audio-section-title">试听</div>
        <textarea
          className="voice-preview-text"
          value={previewText}
          onChange={(event) => onPreviewTextChange(event.target.value)}
        />
        <div className="voice-preview-actions">
          <button
            disabled={busy === "voice-preview" || !defaultVoiceId}
            onClick={() => onPreviewVoice()}
          >
            {busy === "voice-preview" ? <Loader2 className="spin" size={15} /> : <Volume2 size={15} />}
            合成试听
          </button>
          {previewUrl && <audio src={previewUrl} controls />}
        </div>
      </div>

      <div className="audio-section audio-voices">
        <div className="audio-section-title">管理音色</div>
        {voiceProfiles.map((voice) => (
          <div className="voice-row" key={voice.id}>
            <div className="voice-row-main">
              <input
                value={voiceNameDrafts[voice.id] ?? voice.name}
                onChange={(event) => onNameDraftChange(voice.id, event.target.value)}
              />
              <input
                value={voiceReferenceDrafts[voice.id] ?? ""}
                onChange={(event) => onReferenceDraftChange(voice.id, event.target.value)}
                placeholder="参考音频对应文字"
              />
              <small>
                {voice.id === defaultVoiceId ? "默认音色" : voice.language}
                {voice.samplePath ? " · 已上传样音" : " · 未上传样音"}
              </small>
            </div>
            <div className="voice-row-actions">
              <button
                title={voice.id === defaultVoiceId ? "已是默认" : "设为默认"}
                disabled={voice.id === defaultVoiceId}
                onClick={() => onSelectVoice(voice.id)}
              >
                <Check size={14} />
              </button>
              <button
                title="保存音色"
                disabled={importing}
                onClick={() => onSaveVoice(voice.id)}
              >
                <Save size={14} />
              </button>
              <button
                title="试听该音色"
                disabled={busy === "voice-preview"}
                onClick={() => onPreviewVoice(voice.id)}
              >
                <Volume2 size={14} />
              </button>
              <button
                title="替换参考音频"
                disabled={importing}
                onClick={() => triggerFileInput(voice.id)}
              >
                <RefreshCw size={14} />
              </button>
              <button title="删除音色" onClick={() => onDeleteVoice(voice.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
