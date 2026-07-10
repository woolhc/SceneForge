import assert from "node:assert/strict";
import { ProjectHistoryBuffer, ProjectSaveCoordinator } from "../../src/store/projectSaveCoordinator";
import type { Project } from "../../src/types";

function project(id: string, title: string): Project {
  return {
    id,
    title,
    script: "",
    ratio: "9:16",
    fps: 30,
    media: [],
    tracks: [],
    clips: [],
    renderConfig: { fps: 30, preset: "preview-fast", resolution: "1080p", bitrateMbps: 0 },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const firstSaveStarted = deferred();
const releaseFirstSave = deferred();
const saveOrder: string[] = [];
const coordinator = new ProjectSaveCoordinator(async (value) => {
  saveOrder.push(value.title);
  if (value.title === "edited") {
    firstSaveStarted.resolve();
    await releaseFirstSave.promise;
  }
  return value;
}, 0);

coordinator.schedule(project("a", "edited"));
await firstSaveStarted.promise;
const undoSave = coordinator.saveNow(project("a", "original"));
assert.deepEqual(saveOrder, ["edited"], "undo waits for an already-started save");
releaseFirstSave.resolve();
await undoSave;
assert.deepEqual(saveOrder, ["edited", "original"], "undo snapshot is the final persisted state");

const debouncedOrder: string[] = [];
const debounced = new ProjectSaveCoordinator(async (value) => {
  debouncedOrder.push(value.title);
  return value;
}, 10);
debounced.schedule(project("a", "first"));
debounced.schedule(project("a", "second"));
await new Promise((resolve) => setTimeout(resolve, 30));
await debounced.flushAll();
assert.deepEqual(debouncedOrder, ["second"], "debounce keeps only the newest snapshot");

const history = new ProjectHistoryBuffer<Project>();
history.activate("a");
history.push(project("a", "a1"));
assert.equal(history.canUndo, true);
history.activate("b");
assert.equal(history.canUndo, false, "switching projects clears undo history");
assert.equal(history.canRedo, false, "switching projects clears redo history");

coordinator.dispose();
debounced.dispose();
