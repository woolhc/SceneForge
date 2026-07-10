import { Captions, Music, Sparkles, Type, Video, WandSparkles } from "lucide-react";
import { TOOL_TABS, type ToolTab } from "./editorLayout";

const ICONS = {
  media: Video,
  text: Type,
  audio: Music,
  subtitle: Captions,
  transition: WandSparkles,
  effects: Sparkles,
} satisfies Record<ToolTab, typeof Video>;

export function ToolRail({
  activeTab,
  onTabChange,
}: {
  activeTab: ToolTab;
  onTabChange: (tab: ToolTab) => void;
}) {
  return (
    <nav className="tool-rail" aria-label="编辑工具">
      {TOOL_TABS.map((tab) => {
        const Icon = ICONS[tab.id];
        return (
          <button
            key={tab.id}
            className={`tool-rail-item ${activeTab === tab.id ? "active" : ""}`}
            type="button"
            title={tab.label}
            aria-label={tab.label}
            aria-pressed={activeTab === tab.id}
            onClick={() => onTabChange(tab.id)}
          >
            <Icon size={18} />
            <span className="tool-rail-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
