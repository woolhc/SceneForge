import { useEffect, useRef, useState } from "react";
import { desktopApi } from "../tauri";
import type { Project } from "../types";

interface ProjectHistoryOptions {
  getCurrentProject: () => Project | null;
  setProject: (project: Project) => void;
  setStatus: (message: string) => void;
}

export function useProjectHistory({ getCurrentProject, setProject, setStatus }: ProjectHistoryOptions) {
  const undoStack = useRef<Project[]>([]);
  const redoStack = useRef<Project[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Project | null>(null);

  function pushUndo(current: Project | null) {
    if (!current) return;
    undoStack.current.push(structuredClone(current));
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(false);
  }

  function debouncedSaveProject(project: Project) {
    pendingSaveRef.current = project;
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(async () => {
      const toSave = pendingSaveRef.current;
      saveDebounceRef.current = null;
      if (toSave) {
        await desktopApi.saveProject(toSave);
      }
    }, 500);
  }

  useEffect(() => {
    function flushBeforeUnload() {
      const toSave = pendingSaveRef.current;
      if (toSave) {
        try {
          void desktopApi.saveProject(toSave);
        } catch {
          // Best effort only; the app is closing.
        }
      }
      // 标记正常退出（崩溃恢复检测用）
      try {
        localStorage.setItem("appExitedCleanly", "true");
      } catch {
        // localStorage 不可用时忽略
      }
    }
    window.addEventListener("beforeunload", flushBeforeUnload);
    return () => window.removeEventListener("beforeunload", flushBeforeUnload);
  }, []);

  // G5: 定时 flush pendingSave -- 防止崩溃时丢失 500ms 防抖窗口内的编辑
  useEffect(() => {
    const interval = setInterval(async () => {
      const toSave = pendingSaveRef.current;
      if (toSave && saveDebounceRef.current) {
        // 防抖还在等待中，立即 flush
        if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = null;
        pendingSaveRef.current = null;
        try {
          await desktopApi.saveProject(toSave);
        } catch {
          // 忽略瞬时错误，下次再试
        }
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  function undo() {
    const prev = undoStack.current.pop();
    const project = getCurrentProject();
    if (!prev || !project) return;
    redoStack.current.push(structuredClone(project));
    setProject(prev);
    void desktopApi.saveProject(prev);
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
    setStatus("已撤销");
  }

  function redo() {
    const next = redoStack.current.pop();
    const project = getCurrentProject();
    if (!next || !project) return;
    undoStack.current.push(structuredClone(project));
    setProject(next);
    void desktopApi.saveProject(next);
    setCanUndo(true);
    setCanRedo(redoStack.current.length > 0);
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
