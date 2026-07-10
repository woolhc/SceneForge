import { Loader2, Sparkles, Wand2 } from "lucide-react";

export function TextPanel({
  script,
  busy,
  onScriptChange,
  onAiSegment,
}: {
  script: string;
  busy: string | null;
  onScriptChange: (script: string) => void;
  onAiSegment: () => void;
}) {
  const segmenting = busy === "segment";

  return (
    <div className="panel-content">
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
