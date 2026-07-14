import { useEffect, useRef } from "react";
import type React from "react";
import { claimProxyBackfill, mergeCachedMediaSource, shouldBuildProxy } from "../editor/mediaCache";
import type { MediaSource, Project } from "../types";
import { desktopApi } from "../tauri";

export function useProxyBackfill({
  project,
  projectRef,
  setProject,
  setAssetCachingIds,
  setStatus,
}: {
  project: Project | null;
  projectRef: React.MutableRefObject<Project | null>;
  setProject: React.Dispatch<React.SetStateAction<Project | null>>;
  setAssetCachingIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setStatus: (status: string) => void;
}) {
  const proxyBackfillRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!project) return;
    const projectId = project.id;
    const missingProxy = project.media.filter((asset) => shouldBuildProxy(asset, proxyBackfillRef.current));
    if (missingProxy.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const asset of missingProxy) {
        // A cleaned-up effect may still merge the job already in flight, but it
        // must not start later queued jobs. The replacement effect owns those.
        if (cancelled) break;
        if (!claimProxyBackfill(asset, proxyBackfillRef.current)) continue;
        setAssetCachingIds((prev) => new Set(prev).add(asset.id));
        setStatus(`正在生成预览代理：${asset.title}`);
        try {
          const updated = await desktopApi.cacheAssetVideo(asset);
          if (projectRef.current?.id !== projectId) break;
          setProject((current) => {
            if (!current || current.id !== projectId) return current;
            const next = mergeCachedMediaSource(current, updated);
            projectRef.current = next;
            void desktopApi.saveProject(next);
            return next;
          });
          if (!cancelled) setStatus(`预览代理已生成：${asset.title}`);
        } catch (error) {
          if (projectRef.current?.id === projectId) {
            setProject((current) => {
              if (!current || current.id !== projectId) return current;
              const next = {
                ...current,
                media: current.media.map((item) => (
                  item.id === asset.id ? { ...item, proxyStatus: "failed" as const } : item
                )),
              };
              projectRef.current = next;
              void desktopApi.saveProject(next);
              return next;
            });
            if (!cancelled) {
              setStatus(`预览代理生成失败：${error instanceof Error ? error.message : String(error)}`);
            }
          }
        } finally {
          proxyBackfillRef.current.delete(asset.id);
          setAssetCachingIds((prev) => {
            const next = new Set(prev);
            next.delete(asset.id);
            return next;
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project, projectRef, setAssetCachingIds, setProject, setStatus]);
}
