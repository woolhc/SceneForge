import { useEffect, useRef } from "react";
import type { MediaSource, Project } from "../types";
import { desktopApi } from "../tauri";

export function useProxyBackfill({
  project,
  setProject,
  setAssetCachingIds,
  setStatus,
}: {
  project: Project | null;
  setProject: React.Dispatch<React.SetStateAction<Project | null>>;
  setAssetCachingIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setStatus: (status: string) => void;
}) {
  const proxyBackfillRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!project) return;
    const missingProxy = project.media.filter((asset) => shouldBuildProxy(asset, proxyBackfillRef.current));
    if (missingProxy.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const asset of missingProxy) {
        if (cancelled) break;
        proxyBackfillRef.current.add(asset.id);
        setAssetCachingIds((prev) => new Set(prev).add(asset.id));
        setStatus(`正在生成预览代理：${asset.title}`);
        try {
          const updated = await desktopApi.cacheAssetVideo(asset);
          if (cancelled) break;
          setProject((current) => {
            if (!current) return current;
            const next = {
              ...current,
              media: current.media.map((item) => item.id === updated.id ? updated : item),
            };
            void desktopApi.saveProject(next);
            return next;
          });
          setStatus(`预览代理已生成：${asset.title}`);
        } catch (error) {
          if (!cancelled) {
            setProject((current) => {
              if (!current) return current;
              const next = {
                ...current,
                media: current.media.map((item) => (
                  item.id === asset.id ? { ...item, proxyStatus: "failed" as const } : item
                )),
              };
              void desktopApi.saveProject(next);
              return next;
            });
            setStatus(`预览代理生成失败：${error instanceof Error ? error.message : String(error)}`);
          }
        } finally {
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
  }, [project, setAssetCachingIds, setProject, setStatus]);
}

function shouldBuildProxy(asset: MediaSource, inFlight: Set<string>) {
  return asset.kind === "video" &&
    !!asset.localPath &&
    (asset.proxyStatus !== "ready" || !asset.proxyPath?.includes("-proxy-v2")) &&
    asset.proxyStatus !== "failed" &&
    !inFlight.has(asset.id);
}
