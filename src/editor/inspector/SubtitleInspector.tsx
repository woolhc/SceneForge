import type { Clip, SubtitleStyle } from "../../types";
import { DEFAULT_SUBTITLE_STYLE } from "../../types";
import { FONT_OPTIONS } from "../../fonts";
import { subtitleExportWarnings } from "../subtitles/styleContract";

type SubtitlePosition = "bottom" | "center" | "top" | "custom";

function animationControls(
  style: SubtitleStyle,
  onStyleChange: (patch: Partial<SubtitleStyle>, commit?: boolean) => void,
  onCommit: () => void,
) {
  return (
    <>
      <label className="style-field">入场动画<select value={style.animationIn ?? "none"} onChange={(event) => onStyleChange({ animationIn: event.target.value })}><option value="none">无</option><option value="fadeIn">淡入</option><option value="slideUp">上滑</option><option value="scaleIn">缩放</option></select></label>
      <label className="style-field">出场动画<select value={style.animationOut ?? "none"} onChange={(event) => onStyleChange({ animationOut: event.target.value })}><option value="none">无</option><option value="fadeOut">淡出</option><option value="slideDown">下滑</option><option value="scaleOut">缩放</option></select></label>
      <label className="style-field">动画时长（{(style.animationDuration ?? 0.3).toFixed(1)}s）<input type="range" min={0.1} max={2} step={0.1} value={style.animationDuration ?? 0.3} onChange={(event) => onStyleChange({ animationDuration: Number(event.target.value) }, false)} onPointerUp={onCommit} /></label>
    </>
  );
}

export function SubtitleInspector({
  clip,
  onClipChange,
  onCommit,
  onTrackPosition,
  onApplyTrackStyle,
}: {
  clip: Clip;
  onClipChange: (patch: Partial<Clip>, commit?: boolean) => void;
  onCommit: () => void;
  onTrackPosition: (position: Exclude<SubtitlePosition, "custom">) => void;
  onApplyTrackStyle: () => void;
}) {
  const style = clip.subtitleStyle ?? { ...DEFAULT_SUBTITLE_STYLE };
  const onStyleChange = (patch: Partial<SubtitleStyle>, commit = true) => {
    onClipChange({ subtitleStyle: { ...style, ...patch } }, commit);
  };
  const exportWarnings = subtitleExportWarnings(style);

  return (
    <>
      <div className="subtitle-style-editor inspector-category inspector-category-subtitle">
        <label className="style-field">字幕文案<textarea value={clip.text || ""} onChange={(event) => onClipChange({ text: event.target.value }, false)} onBlur={onCommit} /></label>
        <label className="style-field">字体<select value={style.fontFamily || "Noto Sans SC"} style={{ fontFamily: style.fontFamily }} onChange={(event) => onStyleChange({ fontFamily: event.target.value })}>{FONT_OPTIONS.map((font) => <option key={font.family} value={font.family} style={{ fontFamily: font.family }}>{font.label}</option>)}</select></label>
        <label className="style-field">字号<input type="number" min={16} max={120} value={style.fontSize ?? 48} onChange={(event) => onStyleChange({ fontSize: Number(event.target.value) })} /></label>
        <label className="style-field">颜色<input type="color" value={style.color || "#FFFFFF"} onChange={(event) => onStyleChange({ color: event.target.value })} /></label>
        <label className="style-field">描边<input type="color" value={style.strokeColor || "#000000"} onChange={(event) => onStyleChange({ strokeColor: event.target.value })} /></label>
        <label className="style-field">位置<select value={style.position || "bottom"} onChange={(event) => onStyleChange({ position: event.target.value as SubtitlePosition })}><option value="bottom">底部</option><option value="center">居中</option><option value="top">顶部</option><option value="custom">自定义（拖动）</option></select></label>
        <div className="subtitle-track-position-actions">
          <span>整轨位置：</span>
          {(["bottom", "center", "top"] as const).map((position) => <button key={position} className="panel-secondary-action" onClick={() => onTrackPosition(position)}>{position === "bottom" ? "底部" : position === "center" ? "居中" : "顶部"}</button>)}
        </div>
        <label className="style-field subtitle-checkbox-field"><input type="checkbox" checked={(style.karaoke ?? true) && !!clip.words?.length} disabled={!clip.words?.length} onChange={(event) => onStyleChange({ karaoke: event.target.checked })} /><span>逐字高亮{clip.words?.length ? "" : "（需先识别字幕）"}</span></label>
        {(style.karaoke ?? true) && clip.words?.length ? <label className="style-field">高亮色<input type="color" value={style.highlightColor || "#FFD700"} onChange={(event) => onStyleChange({ highlightColor: event.target.value })} /></label> : null}
        {animationControls(style, onStyleChange, onCommit)}
        {exportWarnings.length > 0 ? (
          <p className="style-hint">导出提示：{exportWarnings.join(" ")}</p>
        ) : null}
        <button className="panel-secondary-action" onClick={onApplyTrackStyle}>应用到整条轨</button>
      </div>
      <div className="subtitle-style-editor inspector-category inspector-category-animation">
        {animationControls(style, onStyleChange, onCommit)}
      </div>
    </>
  );
}
