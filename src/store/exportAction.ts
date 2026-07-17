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

/** 给批量导出的每个比例生成独立文件名：在扩展名前插入比例后缀，如 xxx.mp4 -> xxx-9x16.mp4 */
function ratioSuffixedPath(outputPath: string, ratio: string): string {
  const suffix = ratio.replace(":", "x");
  const dot = outputPath.lastIndexOf(".");
  if (dot < 0) return `${outputPath}-${suffix}`;
  return `${outputPath.slice(0, dot)}-${suffix}${outputPath.slice(dot)}`;
}

export function useExportAction({ project, refreshProjects, setBusy, setStatus }: ExportActionOptions) {
  const setExportState = useUiStore((state) => state.setExportState);
  const setExportPath = useUiStore((state) => state.setExportPath);
  const setExportPaths = useUiStore((state) => state.setExportPaths);
  const setExportError = useUiStore((state) => state.setExportError);
  const setExportProgress = useUiStore((state) => state.setExportProgress);
  const setExportMessage = useUiStore((state) => state.setExportMessage);
  const setExportEtaSeconds = useUiStore((state) => state.setExportEtaSeconds);

  return useCallback(
    /** ratios 为空/单项时行为等同原单比例导出；多项时按比例依次渲染，产出多个文件 */
    async (outputPath: string | null, ratios?: string[]) => {
      if (!project) return;
      const targets = ratios && ratios.length > 0 ? ratios : [project.ratio];
      setExportProgress(0);
      setExportMessage("");
      setExportEtaSeconds(null);
      setExportError("");
      setExportPaths([]);
      setExportState("exporting");
      setStatus(targets.length > 1 ? `正在批量导出 ${targets.length} 个比例...` : "正在导出视频...");
      try {
        await desktopApi.saveProject(project);
        const paths: string[] = [];
        for (const [index, ratio] of targets.entries()) {
          if (targets.length > 1) {
            setExportMessage(`(${index + 1}/${targets.length}) ${ratio} 渲染中...`);
          }
          const perRatioPath =
            targets.length > 1 && outputPath ? ratioSuffixedPath(outputPath, ratio) : outputPath;
          const result = await desktopApi.renderProject({
            projectId: project.id,
            preview: false,
            outputPath: perRatioPath,
            ratio: targets.length > 1 ? ratio : undefined,
          });
          paths.push(result.previewPath);
        }
        await refreshProjects(project.id);
        setExportPaths(paths);
        setExportPath(paths[paths.length - 1]);
        setExportState("done");
        setStatus(targets.length > 1 ? `批量导出成功，共 ${paths.length} 个文件` : `导出成功：${paths[0]}`);
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
      setExportEtaSeconds,
      setExportMessage,
      setExportPath,
      setExportPaths,
      setExportProgress,
      setExportState,
      setStatus,
    ],
  );
}
