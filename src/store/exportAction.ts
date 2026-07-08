import { useCallback } from "react";
import { desktopApi } from "../tauri";
import type { Project } from "../types";
import { useUiStore } from "./uiStore";

interface ExportActionOptions {
  project: Project | null;
  refreshProjects: (activeId?: string) => Promise<void>;
  setBusy: (busy: string | null) => void;
  setStatus: (message: string) => void;
}

export function useExportAction({ project, refreshProjects, setBusy, setStatus }: ExportActionOptions) {
  const setExportState = useUiStore((state) => state.setExportState);
  const setExportPath = useUiStore((state) => state.setExportPath);
  const setExportError = useUiStore((state) => state.setExportError);
  const setExportProgress = useUiStore((state) => state.setExportProgress);
  const setExportMessage = useUiStore((state) => state.setExportMessage);

  return useCallback(
    async (outputPath: string | null) => {
      if (!project) return;
      setExportProgress(0);
      setExportMessage("");
      setExportError("");
      setExportState("exporting");
      setStatus("正在导出视频...");
      try {
        await desktopApi.saveProject(project);
        const result = await desktopApi.renderProject({
          projectId: project.id,
          preview: false,
          outputPath,
        });
        await refreshProjects(project.id);
        setExportPath(result.previewPath);
        setExportState("done");
        setStatus(`导出成功：${result.previewPath}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setExportError(message);
        setExportState("error");
        setStatus(`导出失败：${message}`);
      } finally {
        setBusy(null);
      }
    },
    [
      project,
      refreshProjects,
      setBusy,
      setExportError,
      setExportMessage,
      setExportPath,
      setExportProgress,
      setExportState,
      setStatus,
    ],
  );
}
