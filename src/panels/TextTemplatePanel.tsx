import { Sparkles } from "lucide-react";
import { TEXT_TEMPLATES } from "../editor/textTemplates";
import type { SubtitleStyle } from "../types";

/** 花字/文字模板选择器：点击应用到当前选中文本图层，未选中时作为新建文本图层的默认样式。 */
export function TextTemplatePanel({
  onApplyTemplate,
}: {
  onApplyTemplate: (style: Partial<SubtitleStyle>) => void;
}) {
  return (
    <div className="text-section">
      <div className="text-section-title">
        <Sparkles size={15} />
        <span>花字模板</span>
      </div>
      <div className="subtitle-preset-grid">
        {TEXT_TEMPLATES.map((template) => (
          <button
            key={template.id}
            className="subtitle-preset-card"
            title={`${template.category} · ${template.name}`}
            onClick={() => onApplyTemplate(template.style)}
          >
            <span
              className="subtitle-preset-preview"
              style={{
                fontFamily: template.style.fontFamily ?? "Noto Sans SC",
                color: template.style.color ?? "#FFFFFF",
                textShadow: template.style.strokeColor
                  ? `1px 1px 0 ${template.style.strokeColor}, -1px -1px 0 ${template.style.strokeColor}, 1px -1px 0 ${template.style.strokeColor}, -1px 1px 0 ${template.style.strokeColor}`
                  : "none",
              }}
            >
              文字
            </span>
            <span className="subtitle-preset-name">{template.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
