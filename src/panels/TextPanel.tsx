import { Bot, Captions, Loader2, Sparkles, Type, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { SubtitleStyle } from "../types";
import { FONT_OPTIONS, preloadAllFonts } from "../fonts";

/**
 * 文本 Tab：
 * - 顶部：文案输入框 + AI 分段按钮（核心入口）
 * - 下方：识别字幕（ASR）+ 字幕样式
 */
export function TextPanel({
  script,
  busy,
  onScriptChange,
  onAiSegment,
  onRecognizeSubtitles,
  onAddManualSubtitle,
  subtitleStyle,
  onSubtitleStyleChange,
}: {
  script: string;
  busy: string | null;
  onScriptChange: (script: string) => void;
  onAiSegment: () => void;
  onRecognizeSubtitles: (translate: boolean) => void;
  onAddManualSubtitle: () => void;
  subtitleStyle: SubtitleStyle;
  onSubtitleStyleChange: (style: SubtitleStyle) => void;
}) {
  const segmenting = busy === "segment";
  const recognizing = busy === "subtitles";
  const [translate, setTranslate] = useState(true);

  // 首次渲染时预加载所有 Google Fonts（字体下拉能正确预览）
  useEffect(() => {
    preloadAllFonts();
  }, []);

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
          placeholder="粘贴完整文案，点击 AI 分段后会自动编排到时间线（视频 + 配音两轨）。"
          onChange={(event) => onScriptChange(event.target.value)}
        />
        <button
          className="panel-primary-action"
          disabled={segmenting}
          onClick={onAiSegment}
        >
          {segmenting ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
          AI 分段
        </button>
      </div>

      <div className="text-section">
        <div className="text-section-title">
          <Captions size={15} />
          <span>识别字幕（语音识别）</span>
        </div>
        <p className="style-hint">
          <Bot size={13} />
          基于配音音频，用 whisper 识别文字并带时间戳，AI 自动整理断句。需先生成配音。
        </p>
        <label className="translate-toggle">
          <input
            type="checkbox"
            checked={translate}
            onChange={(event) => setTranslate(event.target.checked)}
          />
          <span>英文配音时翻译成中文（双语字幕）</span>
        </label>
        <button
          className="panel-primary-action"
          disabled={recognizing}
          onClick={() => onRecognizeSubtitles(translate)}
        >
          {recognizing ? <Loader2 className="spin" size={15} /> : <Captions size={15} />}
          {recognizing ? "识别中..." : "识别字幕"}
        </button>
      </div>

      <div className="text-section">
        <div className="text-section-title">
          <Type size={15} />
          <span>手动添加字幕</span>
        </div>
        <p className="style-hint">
          <Bot size={13} />
          添加一条空字幕到字幕轨末尾，然后在右侧属性面板编辑文字、拖动调整位置和时长。
        </p>
        <button className="panel-secondary-action" onClick={onAddManualSubtitle}>
          <Type size={15} />
          添加字幕
        </button>
      </div>

      <div className="text-section">
        <div className="text-section-title">
          <Type size={15} />
          <span>字幕样式（默认）</span>
        </div>
        <div className="subtitle-style-options">
          <label className="style-field">
            字号
            <input
              type="number"
              min={16}
              max={120}
              step={1}
              value={subtitleStyle.fontSize}
              onChange={(event) =>
                onSubtitleStyleChange({ ...subtitleStyle, fontSize: Number(event.target.value) })
              }
            />
          </label>
          <label className="style-field">
            颜色
            <input
              type="color"
              value={subtitleStyle.color}
              onChange={(event) =>
                onSubtitleStyleChange({ ...subtitleStyle, color: event.target.value })
              }
            />
          </label>
          <label className="style-field">
            描边
            <input
              type="color"
              value={subtitleStyle.strokeColor}
              onChange={(event) =>
                onSubtitleStyleChange({ ...subtitleStyle, strokeColor: event.target.value })
              }
            />
          </label>
          <label className="style-field">
            位置
            <select
              value={subtitleStyle.position}
              onChange={(event) =>
                onSubtitleStyleChange({ ...subtitleStyle, position: event.target.value })
              }
            >
              <option value="bottom">底部</option>
              <option value="center">居中</option>
              <option value="top">顶部</option>
            </select>
          </label>
        </div>
        <label className="style-field font-field">
          字体
          <select
            value={subtitleStyle.fontFamily}
            style={{ fontFamily: subtitleStyle.fontFamily }}
            onChange={(event) =>
              onSubtitleStyleChange({ ...subtitleStyle, fontFamily: event.target.value })
            }
          >
            {FONT_OPTIONS.map((font) => (
              <option key={font.family} value={font.family} style={{ fontFamily: font.family }}>
                {font.label} ({font.family})
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

