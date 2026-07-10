import { useEffect, useRef, useState } from "react";
import { desktopApi } from "../tauri";
import type { Project } from "../types";
import { ProjectHistoryBuffer, ProjectSaveCoordinator } from "./projectSaveCoordinator";

interface ProjectHistoryOptions {
  projectId: string | null;
  getCurrentProject: () => Project | null;
  setProject: (project: Project) => void;
  setStatus: (message: string) => void;
}

export function useProjectHistory({ projectId, getCurrentProject, setProject, setStatus }: ProjectHistoryOptions) {
  const historyRef = useRef(new ProjectHistoryBuffer<Project>());
  const saveCoordinatorRef = useRef<ProjectSaveCoordinator | null>(null);
  if (!saveCoordinatorRef.current) {
    saveCoordinatorRef.current = new ProjectSaveCoordinator(
      desktopApi.saveProject,
      500,
      (error) => setStatus(`自动保存失败：${error instanceof Error ? error.message : String(error)}`),
    );
  }
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  function syncHistoryState() {
    setCanUndo(historyRef.current.canUndo);
    setCanRedo(historyRef.current.canRedo);
  }

  useEffect(() => {
    historyRef.current.activate(projectId);
    syncHistoryState();
  }, [projectId]);

  function pushUndo(current: Project | null) {
    if (!current) return;
    historyRef.current.activate(current.id);
    historyRef.current.push(current);
    syncHistoryState();
  }

  function debouncedSaveProject(project: Project) {
    saveCoordinatorRef.current?.schedule(project);
  }

  useEffect(() => {
    function flushBeforeUnload() {
      void saveCoordinatorRef.current?.flushAll();
      // 标记正常退出（崩溃恢复检测用）
      try {
        localStorage.setItem("appExitedCleanly", "true");
      } catch {
        // localStorage 不可用时忽略
      }
    }
    window.addEventListener("beforeunload", flushBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", flushBeforeUnload);
      saveCoordinatorRef.current?.dispose();
    };
  }, []);

  function undo() {
    const project = getCurrentProject();
    if (!project) return;
    historyRef.current.activate(project.id);
    const prev = historyRef.current.undo(project);
    if (!prev) return;
    setProject(prev);
    void saveCoordinatorRef.current?.saveNow(prev).catch((error) => {
      setStatus(`撤销保存失败：${error instanceof Error ? error.message : String(error)}`);
    });
    syncHistoryState();
    setStatus("已撤销");
  }

  function redo() {
    const project = getCurrentProject();
    if (!project) return;
    historyRef.current.activate(project.id);
    const next = historyRef.current.redo(project);
    if (!next) return;
    setProject(next);
    void saveCoordinatorRef.current?.saveNow(next).catch((error) => {
      setStatus(`重做保存失败：${error instanceof Error ? error.message : String(error)}`);
    });
    syncHistoryState();
    setStatus("已重做");
  }

  async function persist(next: Project, message = "已保存") {
    pushUndo(getCurrentProject());
    setProject(next);
    debouncedSaveProject(next);
    setStatus(message);
  }

  async function persistWithSnapshot(next: Project, snapshot: Project | null, message = "已保存") {
    pushUndo(snapshot);
    setProject(next);
    debouncedSaveProject(next);
    setStatus(message);
  }

  return {
    canUndo,
    canRedo,
    pushUndo,
    undo,
    redo,
    debouncedSaveProject,
    persist,
    persistWithSnapshot,
  };
}
