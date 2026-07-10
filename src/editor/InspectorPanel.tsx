import type { ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import type { InspectorTab } from "./editorLayout";

const labels: Record<InspectorTab, string> = {
  basic: "基础",
  visual: "画面",
  animation: "动画",
  audio: "音频",
  subtitle: "字幕样式",
};

export function InspectorPanel({
  title,
  meta,
  selectedCount,
  tabs,
  activeTab,
  onTabChange,
  children,
}: {
  title: string | null;
  meta: string | null;
  selectedCount: number;
  tabs: readonly InspectorTab[];
  activeTab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  children: ReactNode;
}) {
  return (
    <aside className="right-panel">
      <div className="panel-title">
        <div>
          <SlidersHorizontal size={16} />
          <span>属性</span>
        </div>
      </div>
      {title ? (
        <div className="inspector" data-active-tab={activeTab}>
          <div className="inspector-object-summary">
            <div>
              <strong>{title}</strong>
              {meta && <span>{meta}</span>}
            </div>
            {selectedCount > 1 && <em>{selectedCount} 项</em>}
          </div>
          <div className="inspector-tabs" role="tablist" aria-label="属性分类">
            {tabs.map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={activeTab === tab}
                className={activeTab === tab ? "active" : ""}
                onClick={() => onTabChange(tab)}
              >
                {labels[tab]}
              </button>
            ))}
          </div>
          {children}
        </div>
      ) : (
        <div className="empty-state">选中时间线片段后在这里调整属性</div>
      )}
    </aside>
  );
}
