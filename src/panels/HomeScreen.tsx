import { Clock, Film, MoreVertical, Plus, Search, Trash2, Copy, Edit3 } from "lucide-react";
import { useMemo, useState } from "react";
import type { ProjectSummary } from "../types";

export function HomeScreen({
  projects,
  onOpen,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
}: {
  projects: ProjectSummary[];
  onOpen: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return projects;
    return projects.filter((p) => p.title.toLowerCase().includes(search.toLowerCase()));
  }, [projects, search]);

  return (
    <div className="home-screen">
      <header className="home-header">
        <div className="home-brand">
          <Film size={24} />
          <strong>SceneScript</strong>
          <span>AI 脚本到视频</span>
        </div>
        <div className="home-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索项目..."
          />
        </div>
      </header>

      <div className="home-content">
        <button className="new-project-card" onClick={onCreate}>
          <Plus size={32} />
          <strong>新建项目</strong>
        </button>

        {filtered.map((project) => (
          <div
            key={project.id}
            className="project-tile"
            onClick={() => onOpen(project.id)}
          >
            <div className="project-tile-thumb">
              {project.clipCount > 0 ? (
                <Film size={28} />
              ) : (
                <span className="empty-project">空项目</span>
              )}
            </div>
            <div className="project-tile-info">
              {renaming === project.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => {
                    if (renameValue.trim()) onRename(project.id, renameValue.trim());
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
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
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(menuOpen === project.id ? null : project.id);
              }}
            >
              <MoreVertical size={16} />
            </button>
            {menuOpen === project.id && (
              <div className="project-menu" onClick={(e) => e.stopPropagation()}>
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
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}
