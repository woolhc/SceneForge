# Preview Cache Black-Screen Repair Plan

## Problem

The active project can contain Pexels media whose downloaded original/proxy files exist on disk while the persisted `MediaSource` has no `localPath` or `proxyPath`. Preview then falls back to the remote Pexels URL, which is not allowed by the current Tauri `media-src` CSP. Clip switches consequently show black frames or appear frozen while media seek/play errors are swallowed.

## Competing approaches

1. **Allow all remote video URLs.** Fast symptom relief, but it leaves the persistence race intact and makes preview depend on network availability.
2. **Add project revisions and replace every whole-project save with patch operations.** Architecturally strongest, but too broad for an urgent targeted repair.
3. **Targeted monotonic cache metadata and stale-save repair.** Preserve valid cache paths across stale snapshots, recover predictable files from disk on project load, prevent render completion from writing an old project snapshot, and allow only the Pexels video origin as a temporary streaming fallback.

## Chosen design

Use approach 3 now, while keeping the implementation compatible with a future revision/patch model.

- Treat valid `localPath`/`proxyPath` as monotonic cache metadata: a stale whole-project save may not erase paths that still exist on disk.
- On `get_project`, reconcile missing cache paths from deterministic cache locations and persist the repaired project.
- At render completion, re-read the latest project and update only `previewPath`/`finalPath` on that latest snapshot.
- Merge cache results into the latest frontend project ref before React state/save, so concurrent cache completions accumulate instead of replacing one another.
- Claim each proxy job against a shared in-flight set immediately before launch; a cleaned-up effect may merge its current completion but cannot launch the rest of its stale queue.
- Treat only SQLite `QueryReturnedNoRows` as a new project during cache-metadata preservation; propagate database and JSON corruption errors instead of overwriting unreadable data.
- Add `https://videos.pexels.com` to `media-src` as a constrained fallback while a proxy is unavailable.
- Keep the default preview engine; do not enable WebCodecs or add dependencies.

## Verification

- Regression test: sequential cache completions preserve earlier cached assets and unrelated project fields.
- Regression test: duplicate proxy claims for the same media id are rejected while the first job is in flight.
- Regression test: corrupt persisted project JSON blocks `save_project` and remains untouched.
- Rust tests: stale saves preserve valid cache metadata; project-load recovery discovers deterministic original/proxy paths.
- Configuration test: Tauri CSP allows only the required Pexels video origin.
- Run TypeScript tests, Rust tests, TypeScript production build, and Cargo check.
- Restart the client and verify the active project reload repairs remote-only sources to local/proxy paths.
