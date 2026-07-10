import type { ReactNode } from "react";
import {
  ChevronLeft,
  Download,
  Redo2,
  Save,
  Settings,
  Sparkles,
  Undo2,
} from "lucide-react";
import type { EditorMode } from "./editorLayout";

export interface EditorTopbarProps {
  mode: EditorMode;
  projectTitle: string;
  ratio: string;
  ratios: readonly string[];
  canUndo: boolean;
  canRedo: boolean;
  canSave: boolean;
  projectMenu: ReactNode;
  saveStatus: ReactNode;
  onBack: () => void;
  onGenerate: () => void;
  onProjectTitleChange: (value: string) => void;
  onRatioChange: (value: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onModeChange: (mode: EditorMode) => void;
  onSettings: () => void;
  onExport: () => void;
}

export function EditorTopbar({
  mode,
  projectTitle,
  ratio,
  ratios,
  canUndo,
  canRedo,
  canSave,
  projectMenu,
  saveStatus,
  onBack,
  onGenerate,
  onProjectTitleChange,
  onRatioChange,
  onUndo,
  onRedo,
  onSave,
  onModeChange,
  onSettings,
  onExport,
}: EditorTopbarProps) {
  return (
    <header className="topbar editor-topbar">
      <div className="editor-topbar-leading">
        <button className="home-back-btn" onClick={onBack} title="返回首页">
          <ChevronLeft size={16} />
          <span>首页</span>
        </button>
        <button className="ai-generate-button" onClick={onGenerate} title="AI 一键成片">
          <Sparkles size={16} />
          <span>AI 一键成片</span>
        </button>
        {projectMenu}
      </div>

      <div className="editor-project-context">
        <input
          className="project-title-input"
          value={projectTitle}
          placeholder="项目名称"
          aria-label="项目名称"
          onChange={(event) => onProjectTitleChange(event.target.value)}
        />
        <select className="ratio-select" value={ratio} aria-label="画幅比例" onChange={(event) => onRatioChange(event.target.value)}>
          {ratios.map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>

      <div className="top-actions">
        {saveStatus}
        <button className="icon-button" title="撤销 (Ctrl+Z)" aria-label="撤销" disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={18} />
        </button>
        <button className="icon-button" title="重做 (Ctrl+Shift+Z)" aria-label="重做" disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={18} />
        </button>
        <button className="icon-button" title="保存项目" aria-label="保存项目" disabled={!canSave} onClick={onSave}>
          <Save size={18} />
        </button>
        <div className="editor-mode-switch" role="group" aria-label="编辑模式">
          <button className={mode === "professional" ? "active" : ""} aria-pressed={mode === "professional"} onClick={() => onModeChange("professional")}>专业</button>
          <button className={mode === "simple" ? "active" : ""} aria-pressed={mode === "simple"} onClick={() => onModeChange("simple")}>简洁</button>
        </div>
        <button className="icon-button" title="设置" aria-label="设置" onClick={onSettings}>
          <Settings size={18} />
        </button>
        <button className="primary-button" disabled={!canSave} onClick={onExport}>
          <Download size={16} />
          导出
        </button>
      </div>
    </header>
  );
}
