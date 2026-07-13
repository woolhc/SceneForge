import {
  Check,
  Loader2,
  Mic2,
  Save,
  Trash2,
  Volume2,
} from "lucide-react";
import type { VoiceProfile } from "../types";

/**
 * 音频 Tab：
 * - 顶部：Fish Audio 默认音色选择 + 生成全部配音
 * - 音色管理列表（provider reference 别名/试听/改名/删除）
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

  return (
    <div className="panel-content">
      <div className="audio-section">
        <label className="voice-picker">
          Fish 默认音色
          <select value={selectedVoiceId} onChange={(event) => onSelectVoice(event.target.value)}>
            <option value="">使用设置中的 Reference ID</option>
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
          Fish 生成全部配音
        </button>
      </div>

      <div className="audio-section">
        <div className="audio-section-title">Fish Audio 音色</div>
        <p className="settings-hint">
          默认 Reference ID 在设置中配置；已有音色可作为 Fish provider voice/reference 的别名继续使用。
        </p>
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
                placeholder="备注，可填写这个 Fish 音色的使用场景"
              />
              <small>
                {voice.id === defaultVoiceId ? "默认音色" : voice.language}
                {voice.providerVoiceId ? ` · ${voice.providerVoiceId}` : " · 使用设置 Reference ID"}
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
                title="删除音色"
                disabled={importing}
                onClick={() => onDeleteVoice(voice.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
