import { ChevronDown, FolderPlus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ProjectSummary } from "../types";

/**
 * 顶部项目下拉菜单：点击展开项目列表（切换/新建/删除）。
 * 替代原来左栏的项目列表区块，接近剪映的菜单形态。
 */
export function ProjectMenu({
  projects,
  activeProjectId,
  onSelect,
  onCreate,
  onDelete,
}: {
  projects: ProjectSummary[];
  activeProjectId?: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const active = projects.find((p) => p.id === activeProjectId);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div className="project-menu" ref={ref}>
      <button
        className={`project-menu-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        title="切换项目"
      >
        <span>{active?.title || "选择项目"}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="project-menu-dropdown">
          <button
            className="project-menu-new"
            onClick={() => {
              setOpen(false);
              onCreate();
            }}
          >
            <FolderPlus size={15} />
            新建项目
          </button>
          <div className="project-menu-list">
            {projects.length === 0 && (
              <div className="project-menu-empty">暂无项目</div>
            )}
            {projects.map((item) => (
              <div
                key={item.id}
                className={`project-menu-item ${item.id === activeProjectId ? "active" : ""}`}
                onClick={() => {
                  onSelect(item.id);
                  setOpen(false);
                }}
              >
                <span>{item.title}</span>
                <small>
                  {item.ratio} · {item.clipCount}
                </small>
                <Trash2
                  size={13}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(item.id);
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
