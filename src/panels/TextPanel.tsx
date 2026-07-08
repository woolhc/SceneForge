import { Bot, Captions, FileText, Loader2, Sparkles, Type, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { SubtitleStyle } from "../types";
import { FONT_OPTIONS, preloadAllFonts } from "../fonts";
import { SUBTITLE_PRESETS } from "../editor/subtitlePresets";

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
  onImportSrt,
  subtitleStyle,
  onSubtitleStyleChange,
}: {
  script: string;
  busy: string | null;
  onScriptChange: (script: string) => void;
  onAiSegment: () => void;
  onRecognizeSubtitles: (translate: boolean) => void;
  onAddManualSubtitle: () => void;
  onImportSrt: () => void;
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
          <FileText size={15} />
          <span>导入 SRT 字幕</span>
        </div>
        <p className="style-hint">
          <Bot size={13} />
          选择 .srt 字幕文件，自动按时间戳生成字幕片段到字幕轨。适合已有外语字幕文件、或用其他工具精修时间轴后导入。
        </p>
        <button
          className="panel-secondary-action"
          disabled={recognizing}
          onClick={onImportSrt}
        >
          <FileText size={15} />
          导入 SRT 文件
        </button>
      </div>

      <div className="text-section">
        <div className="text-section-title">
          <Sparkles size={15} />
          <span>字幕模板</span>
        </div>
        <div className="subtitle-preset-grid">
          {SUBTITLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              className="subtitle-preset-card"
              title={preset.description}
              onClick={() => onSubtitleStyleChange({ ...subtitleStyle, ...preset.style })}
            >
              <span
                className="subtitle-preset-preview"
                style={{
                  fontFamily: preset.style.fontFamily ?? "Noto Sans SC",
                  color: preset.style.color ?? "#FFFFFF",
                  textShadow: preset.style.strokeColor
                    ? `1px 1px 0 ${preset.style.strokeColor}, -1px -1px 0 ${preset.style.strokeColor}, 1px -1px 0 ${preset.style.strokeColor}, -1px 1px 0 ${preset.style.strokeColor}`
                    : "none",
                }}
              >
                字幕
              </span>
              <span className="subtitle-preset-name">{preset.name}</span>
            </button>
          ))}
        </div>
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
            描边粗细（{(subtitleStyle.strokeWidth ?? 2).toFixed(0)}px）
            <input
              type="range"
              min={0}
              max={8}
              step={1}
              value={subtitleStyle.strokeWidth ?? 2}
              onChange={(event) =>
                onSubtitleStyleChange({ ...subtitleStyle, strokeWidth: Number(event.target.value) })
              }
            />
          </label>
          <label className="style-field">
            背景
            <input
              type="color"
              value={(subtitleStyle.backgroundColor ?? "none") === "none" ? "#000000" : subtitleStyle.backgroundColor}
              onChange={(event) =>
                onSubtitleStyleChange({ ...subtitleStyle, backgroundColor: event.target.value })
              }
            />
          </label>
          <label className="style-field">
            <input
              type="checkbox"
              checked={(subtitleStyle.backgroundColor ?? "none") === "none"}
              onChange={(event) =>
                onSubtitleStyleChange({ ...subtitleStyle, backgroundColor: event.target.checked ? "none" : "#000000" })
              }
            />
            <span>背景透明</span>
          </label>
          <label className="style-field">
            阴影模糊（{(subtitleStyle.shadowBlur ?? 0).toFixed(0)}px）
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              value={subtitleStyle.shadowBlur ?? 0}
              onChange={(event) =>
                onSubtitleStyleChange({ ...subtitleStyle, shadowBlur: Number(event.target.value) })
              }
            />
          </label>
          <label className="style-field">
            字间距（{(subtitleStyle.letterSpacing ?? 0).toFixed(0)}px）
            <input
              type="range"
              min={-5}
              max={20}
              step={1}
              value={subtitleStyle.letterSpacing ?? 0}
              onChange={(event) =>
                onSubtitleStyleChange({ ...subtitleStyle, letterSpacing: Number(event.target.value) })
              }
            />
          </label>
          <label className="style-field">
            行高（{((subtitleStyle.lineHeight ?? 1.4)).toFixed(2)}）
            <input
              type="range"
              min={0.8}
              max={2.5}
              step={0.05}
              value={subtitleStyle.lineHeight ?? 1.4}
              onChange={(event) =>
                onSubtitleStyleChange({ ...subtitleStyle, lineHeight: Number(event.target.value) })
              }
            />
          </label>
          <label className="style-field">
            位置
            <select
              value={subtitleStyle.position}
             onChange={(event) =>
              onSubtitleStyleChange({ ...subtitleStyle, position: event.target.value as "bottom" | "center" | "top" | "custom" })
              }
            >
              <option value="bottom">底部</option>
              <option value="center">居中</option>
              <option value="top">顶部</option>
              <option value="custom">自定义</option>
            </select>
          </label>
          <label className="style-field">
            高亮色
            <input
              type="color"
              value={subtitleStyle.highlightColor ?? "#FFD700"}
              onChange={(event) =>
                onSubtitleStyleChange({ ...subtitleStyle, highlightColor: event.target.value })
              }
            />
          </label>
          <label className="style-field">
            <input
              type="checkbox"
              checked={subtitleStyle.karaoke ?? true}
              onChange={(event) =>
                onSubtitleStyleChange({ ...subtitleStyle, karaoke: event.target.checked })
              }
            />
            <span>逐字高亮（卡拉OK）</span>
          </label>
          <label className="style-field">
            入场动画
            <select
              value={subtitleStyle.animationIn ?? "none"}
              onChange={(event) =>
                onSubtitleStyleChange({ ...subtitleStyle, animationIn: event.target.value as SubtitleStyle["animationIn"] })
              }
            >
              <option value="none">无</option>
              <option value="fadeIn">淡入</option>
              <option value="slideUp">上滑</option>
              <option value="scaleIn">缩放</option>
              <option value="bounceIn">弹跳</option>
              <option value="floatIn">浮现</option>
              <option value="popIn">弹出</option>
              <option value="typewriter">打字机</option>
            </select>
          </label>
          <label className="style-field">
            出场动画
            <select
              value={subtitleStyle.animationOut ?? "none"}
              onChange={(event) =>
                onSubtitleStyleChange({ ...subtitleStyle, animationOut: event.target.value as SubtitleStyle["animationOut"] })
              }
            >
              <option value="none">无</option>
              <option value="fadeOut">淡出</option>
              <option value="slideDown">下滑</option>
              <option value="scaleOut">缩放</option>
              <option value="bounceOut">弹跳出</option>
              <option value="popOut">爆裂出</option>
            </select>
          </label>
          <label className="style-field">
            动画时长（{(subtitleStyle.animationDuration ?? 0.3).toFixed(2)}s）
            <input
              type="range"
              min={0.1}
              max={2.0}
              step={0.1}
              value={subtitleStyle.animationDuration ?? 0.3}
              onChange={(event) =>
                onSubtitleStyleChange({ ...subtitleStyle, animationDuration: Number(event.target.value) })
              }
            />
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
