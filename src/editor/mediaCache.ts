import type { MediaSource, Project } from "../types";

const CACHE_FIELDS = [
  "localPath",
  "proxyPath",
  "proxyStatus",
  "proxyWidth",
  "proxyHeight",
] as const satisfies readonly (keyof MediaSource)[];

/**
 * Merge one completed cache result into the latest project snapshot.
 *
 * Background cache jobs may finish out of order and carry an older copy of
 * the asset's descriptive fields. Only cache-owned fields are applied so
 * earlier cache completions and unrelated user edits are retained.
 */
export function mergeCachedMediaSource(project: Project, cached: MediaSource): Project {
  const existingIndex = project.media.findIndex((asset) => asset.id === cached.id);
  // Cache completion is an update to an asset that was already registered.
  // If the user removed it while the background job was running, ignore the
  // stale completion instead of resurrecting deleted media.
  if (existingIndex < 0) return project;

  const existing = project.media[existingIndex];
  if (CACHE_FIELDS.every((field) => existing[field] === cached[field])) return project;

  const merged = { ...existing };
  for (const field of CACHE_FIELDS) {
    Object.assign(merged, { [field]: cached[field] });
  }
  const media = [...project.media];
  media[existingIndex] = merged;
  return { ...project, media };
}

export function claimProxyBackfill(asset: MediaSource, inFlight: Set<string>) {
  if (!shouldBuildProxy(asset, inFlight)) return false;
  inFlight.add(asset.id);
  return true;
}

export function shouldBuildProxy(asset: MediaSource, inFlight: Set<string>) {
  return asset.kind === "video" &&
    !!asset.localPath &&
    (asset.proxyStatus !== "ready" || !asset.proxyPath?.includes("-proxy-v2")) &&
    asset.proxyStatus !== "failed" &&
    !inFlight.has(asset.id);
}
