import { Loader2, Plus, Sparkles, Type, Wand2 } from "lucide-react";
import { TextTemplatePanel } from "./TextTemplatePanel";
import type { SubtitleStyle } from "../types";

export function TextPanel({
  script,
  busy,
  onScriptChange,
  onAiSegment,
  onAddTextLayer,
  onApplyTextTemplate,
}: {
  script: string;
  busy: string | null;
  onScriptChange: (script: string) => void;
  onAiSegment: () => void;
  onAddTextLayer: () => void;
  onApplyTextTemplate: (style: Partial<SubtitleStyle>) => void;
}) {
  const segmenting = busy === "segment";

  return (
    <div className="panel-content">
      <div className="text-section">
        <div className="text-section-title">
          <Type size={15} />
          <span>文本图层</span>
        </div>
        <button className="panel-primary-action" onClick={onAddTextLayer}>
          <Plus size={15} />
          新建文本图层
        </button>
      </div>
      <TextTemplatePanel onApplyTemplate={onApplyTextTemplate} />
      <div className="text-section">
        <div className="text-section-title">
          <Wand2 size={15} />
          <span>文案与 AI 分段</span>
        </div>
        <textarea
          className="script-box"
          value={script}
          placeholder="粘贴完整文案，点击 AI 分段后会自动编排到时间线。"
          onChange={(event) => onScriptChange(event.target.value)}
        />
        <button className="panel-primary-action" disabled={segmenting} onClick={onAiSegment}>
          {segmenting ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
          AI 分段
        </button>
      </div>
    </div>
  );
}
