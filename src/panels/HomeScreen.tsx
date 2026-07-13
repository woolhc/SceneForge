import {
  ArrowRight,
  AudioWaveform,
  Captions,
  Check,
  Clock,
  Copy,
  Edit3,
  FileText,
  Film,
  ImagePlay,
  MoreVertical,
  Plus,
  Settings,
  Download,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { SceneForgeLogo } from "../components/SceneForgeLogo";
import type { AppSettings, ProjectSummary, WhisperModelStatus } from "../types";
import { getApiReadiness, getReadinessIssues, whisperStatusLabel } from "../editor/readiness";

const workflowSteps = [
  {
    index: "01",
    icon: FileText,
    title: "准备内容",
    description: "输入完整文案，或导入已经录制好的旁白音频。",
  },
  {
    index: "02",
    icon: Sparkles,
    title: "生成草案",
    description: "AI 自动完成旁白、分镜、素材匹配和智能字幕。",
  },
  {
    index: "03",
    icon: SlidersHorizontal,
    title: "编辑导出",
    description: "替换素材、调整字幕与节奏，然后导出最终视频。",
  },
];

const capabilities = [
  {
    icon: AudioWaveform,
    title: "Audio-First 时间线",
    description: "所有分镜与字幕都围绕真实旁白时间生成。",
  },
  {
    icon: ImagePlay,
    title: "AI 智能分镜",
    description: "理解每段语义，生成画面关键词与素材策略。",
  },
  {
    icon: Sparkles,
    title: "智能素材匹配",
    description: "综合画幅、时长、语义与重复度挑选素材。",
  },
  {
    icon: Captions,
    title: "智能字幕",
    description: "AI 语义断句、动态字号、安全区与双语排版。",
  },
];

export function HomeScreen({
  projects,
  onOpen,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
  onGenerate,
  settings,
  whisperStatus,
  onSettings,
  onDownloadWhisper,
}: {
  projects: ProjectSummary[];
  onOpen: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onGenerate: () => void;
  settings: AppSettings;
  whisperStatus: WhisperModelStatus | null;
  onSettings: () => void;
  onDownloadWhisper: () => void;
}) {
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return projects;
    return projects.filter((project) => project.title.toLowerCase().includes(search.toLowerCase()));
  }, [projects, search]);

  const hasProjects = projects.length > 0;
  const readinessIssues = useMemo(() => getReadinessIssues(settings, whisperStatus), [settings, whisperStatus]);
  const apiReadiness = useMemo(() => getApiReadiness(settings), [settings]);

  return (
    <div className="home-screen">
      <header className="home-header">
        <div className="home-brand">
          <SceneForgeLogo size={26} />
          <strong>SceneForge</strong>
          <span>AI 脚本到视频</span>
        </div>
        <div className="home-header-actions">
          <div className="home-search">
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索项目..."
            />
          </div>
          <button className="home-settings-button" onClick={onSettings} title="设置">
            <Settings size={17} />
            设置
          </button>
        </div>
      </header>

      {readinessIssues.length > 0 && (
        <section className="home-readiness-card">
          <div>
            <strong>开始前还差一点配置</strong>
            <span>Whisper：{whisperStatusLabel(whisperStatus)} · API：DeepSeek {apiReadiness.deepseekReady ? "已配置" : "未配置"} / Pexels {apiReadiness.pexelsReady ? "已配置" : "未配置"} / Fish {apiReadiness.fishAudioReady ? "已配置" : "未配置"}</span>
          </div>
          <ul>
            {readinessIssues.slice(0, 3).map((issue) => <li key={issue.id}>{issue.title}</li>)}
          </ul>
          <div className="home-readiness-actions">
            {readinessIssues.some((issue) => issue.id === "whisper") && (
              <button className="primary-button" onClick={onDownloadWhisper}><Download size={15} />下载模型</button>
            )}
            <button onClick={onSettings}>打开设置</button>
          </div>
        </section>
      )}

      <main className={`home-content ${hasProjects ? "has-projects" : "is-empty"}`}>
        <section className="home-create-section">
          <div className="home-section-heading home-create-heading">
            <div>
              <span className="home-eyebrow">START CREATING</span>
              <h1>{hasProjects ? "开始新的创作" : "从旁白开始，生成可编辑视频"}</h1>
              <p>
                {hasProjects
                  ? "继续使用 AI 快速生成草案，或从空白时间线开始。"
                  : "输入文案或导入音频，自动完成分镜、素材匹配、智能字幕和时间线编排。"}
              </p>
            </div>
          </div>

          <div className="home-create-actions">
            <button className="generate-project-card" onClick={onGenerate}>
              <span className="home-action-icon"><Sparkles size={26} /></span>
              <span className="home-action-copy">
                <strong>一键生成</strong>
                <small>文案或音频 → 可编辑视频草案</small>
              </span>
              <ArrowRight className="home-action-arrow" size={18} />
            </button>

            <button className="new-project-card" onClick={onCreate}>
              <span className="home-action-icon"><Plus size={26} /></span>
              <span className="home-action-copy">
                <strong>新建项目</strong>
                <small>从空白时间线开始自由剪辑</small>
              </span>
              <ArrowRight className="home-action-arrow" size={18} />
            </button>
          </div>
        </section>

        {hasProjects && (
          <section className="home-projects-section">
            <div className="home-section-heading compact">
              <div>
                <span className="home-eyebrow">RECENT WORK</span>
                <h2>{search.trim() ? "搜索结果" : "最近项目"}</h2>
              </div>
              <span className="home-project-count">{filtered.length} 个项目</span>
            </div>

            {filtered.length > 0 ? (
              <div className="home-project-grid">
                {filtered.map((project) => (
                  <div
                    key={project.id}
                    className="project-tile"
                    onClick={() => onOpen(project.id)}
                  >
                    <div className="project-tile-thumb">
                      {project.clipCount > 0 ? <Film size={28} /> : <span className="empty-project">空项目</span>}
                    </div>
                    <div className="project-tile-info">
                      {renaming === project.id ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          onBlur={() => {
                            if (renameValue.trim()) onRename(project.id, renameValue.trim());
                            setRenaming(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              if (renameValue.trim()) onRename(project.id, renameValue.trim());
                              setRenaming(null);
                            }
                          }}
                        />
                      ) : (
                        <strong>{project.title}</strong>
                      )}
                      <div className="project-tile-meta">
                        <span><Clock size={11} /> {formatDate(project.updatedAt)}</span>
                        <span>{project.ratio}</span>
                        <span>{project.clipCount} 片段</span>
                      </div>
                    </div>
                    <button
                      className="project-tile-menu"
                      aria-label={`打开 ${project.title} 菜单`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setMenuOpen(menuOpen === project.id ? null : project.id);
                      }}
                    >
                      <MoreVertical size={16} />
                    </button>
                    {menuOpen === project.id && (
                      <div className="project-menu" onClick={(event) => event.stopPropagation()}>
                        <button onClick={() => {
                          setRenaming(project.id);
                          setRenameValue(project.title);
                          setMenuOpen(null);
                        }}>
                          <Edit3 size={14} /> 重命名
                        </button>
                        <button onClick={() => { onDuplicate(project.id); setMenuOpen(null); }}>
                          <Copy size={14} /> 复制
                        </button>
                        <button className="danger" onClick={() => { onDelete(project.id); setMenuOpen(null); }}>
                          <Trash2 size={14} /> 删除
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="home-search-empty">
                <Search size={20} />
                <strong>没有找到匹配项目</strong>
                <span>尝试使用其他项目名称搜索</span>
              </div>
            )}
          </section>
        )}

        <section className="home-workflow-section">
          <div className="home-section-heading">
            <div>
              <span className="home-eyebrow">WORKFLOW</span>
              <h2>从想法到可编辑视频</h2>
              <p>AI 负责生成第一版，你始终保留对素材、字幕和时间线的控制。</p>
            </div>
          </div>
          <div className="home-workflow-grid">
            {workflowSteps.map((step) => {
              const Icon = step.icon;
              return (
                <article className="home-workflow-step" key={step.index}>
                  <div className="home-step-topline">
                    <span className="home-step-index">{step.index}</span>
                    <Icon size={19} />
                  </div>
                  <strong>{step.title}</strong>
                  <p>{step.description}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="home-capabilities-section">
          <div className="home-section-heading compact">
            <div>
              <span className="home-eyebrow">BUILT FOR EDITING</span>
              <h2>生成不是终点</h2>
            </div>
          </div>
          <div className="home-capability-grid">
            {capabilities.map((capability) => {
              const Icon = capability.icon;
              return (
                <article className="home-capability" key={capability.title}>
                  <Icon size={18} />
                  <div>
                    <strong>{capability.title}</strong>
                    <p>{capability.description}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="home-editable-note">
          <div className="home-editable-visual">
            <SceneForgeLogo size={42} />
            <div className="home-editable-pulse" />
          </div>
          <div className="home-editable-copy">
            <span className="home-eyebrow">FULLY EDITABLE</span>
            <h2>一键生成的是草案，不是黑盒结果</h2>
            <p>生成完成后，仍可以逐段替换素材、修改字幕、调整时间线或重新生成局部内容。</p>
          </div>
          <div className="home-editable-checks">
            <span><Check size={14} /> 可替换素材</span>
            <span><Check size={14} /> 可修改字幕</span>
            <span><Check size={14} /> 可调整时间线</span>
            <span><Check size={14} /> 可局部重试</span>
          </div>
        </section>
      </main>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}
