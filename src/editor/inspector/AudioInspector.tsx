import { Loader2, Mic2 } from "lucide-react";
import type { Clip, TrackKind } from "../../types";
import { audioInspectorCapabilities } from "../editorLayout";

export function AudioInspector({
  clip,
  trackKind,
  busy,
  onGenerateVoice,
  onVolumeChange,
  onClipChange,
  onCommit,
}: {
  clip: Clip;
  trackKind: TrackKind;
  busy: string | null;
  onGenerateVoice: () => void;
  onVolumeChange: (volume: number) => void;
  onClipChange: (patch: Partial<Clip>, commit?: boolean) => void;
  onCommit: () => void;
}) {
  const capabilities = audioInspectorCapabilities(trackKind);
  return (
    <div className="inspector-category inspector-category-audio audio-inspector">
      {capabilities.canGenerateVoice && (
        <button className="wide-action" disabled={busy === "clip-audio"} onClick={onGenerateVoice}>
          {busy === "clip-audio" ? <Loader2 className="spin" size={15} /> : <Mic2 size={15} />}
          生成当前片段配音
        </button>
      )}
      <label className="style-field audio-volume-field">
        <span>音量</span>
        <input
          type="range"
          min={0}
          max={200}
          step={1}
          value={Math.round((clip.volume ?? 1) * 100)}
          onChange={(event) => onVolumeChange(Number(event.target.value) / 100)}
          onPointerUp={onCommit}
        />
        <small>
          {Math.round((clip.volume ?? 1) * 100)}%
          {(clip.volume ?? 1) > 0 ? ` (${(20 * Math.log10(clip.volume ?? 1)).toFixed(1)}dB)` : " (静音)"}
        </small>
      </label>
      {capabilities.canFade && (
        <div className="fade-control">
          <label className="style-field">
            淡入（秒）
            <input type="number" min={0} max={5} step={0.1} value={clip.fadeIn ?? 0} onChange={(event) => onClipChange({ fadeIn: Number(event.target.value) })} />
          </label>
          <label className="style-field">
            淡出（秒）
            <input type="number" min={0} max={5} step={0.1} value={clip.fadeOut ?? 0} onChange={(event) => onClipChange({ fadeOut: Number(event.target.value) })} />
          </label>
        </div>
      )}
      {capabilities.canReduceNoise && (
        <div className="style-field-column">
          <label className="style-field">
            降噪（{(clip.noiseReduction ?? 0).toFixed(0)}）
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={clip.noiseReduction ?? 0}
              onChange={(event) => onClipChange({ noiseReduction: Number(event.target.value) }, false)}
              onPointerUp={onCommit}
            />
          </label>
          <small className="style-hint">降低背景噪声（导出时生效）</small>
        </div>
      )}
      {capabilities.canReduceNoise && (
        <div className="style-field-column">
          <label className="style-field">
            变声/音效
            <select
              value={clip.voiceEffect ?? ""}
              onChange={(event) => onClipChange({ voiceEffect: event.target.value || null })}
            >
              <option value="">无</option>
              <option value="pitch_up">升调</option>
              <option value="pitch_down">降调</option>
              <option value="vibrato">颤音</option>
              <option value="tremolo">震音</option>
            </select>
          </label>
          <small className="style-hint">仅导出时生效，预览听到的仍是原声</small>
        </div>
      )}
    </div>
  );
}
