import type { Project } from "../types";

type SaveProject = (project: Project) => Promise<Project>;
type PendingSave = { project: Project; timer: ReturnType<typeof setTimeout> };

export class ProjectSaveCoordinator {
  private pending = new Map<string, PendingSave>();
  private chains = new Map<string, Promise<void>>();

  constructor(
    private readonly saveProject: SaveProject,
    private readonly delayMs = 500,
    private readonly onError?: (error: unknown) => void,
  ) {}

  schedule(project: Project) {
    this.cancelPending(project.id);
    const snapshot = structuredClone(project);
    const timer = setTimeout(() => {
      this.pending.delete(snapshot.id);
      void this.enqueue(snapshot).catch((error) => this.onError?.(error));
    }, this.delayMs);
    this.pending.set(snapshot.id, { project: snapshot, timer });
  }

  saveNow(project: Project): Promise<Project> {
    this.cancelPending(project.id);
    return this.enqueue(structuredClone(project));
  }

  cancelPending(projectId: string) {
    const pending = this.pending.get(projectId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(projectId);
  }

  async flushAll() {
    const pending = [...this.pending.values()];
    this.pending.clear();
    const queued = pending.map(({ project, timer }) => {
      clearTimeout(timer);
      return this.enqueue(project).catch((error) => {
        this.onError?.(error);
        throw error;
      });
    });
    await Promise.allSettled(queued);
    await Promise.allSettled([...this.chains.values()]);
  }

  dispose() {
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  private enqueue(project: Project): Promise<Project> {
    const previous = this.chains.get(project.id) ?? Promise.resolve();
    const result = previous
      .catch(() => undefined)
      .then(() => this.saveProject(project));
    const settled = result.then(() => undefined, () => undefined);
    this.chains.set(project.id, settled);
    void settled.finally(() => {
      if (this.chains.get(project.id) === settled) this.chains.delete(project.id);
    });
    return result;
  }
}

export class ProjectHistoryBuffer<T> {
  private projectId: string | null = null;
  private undoStack: T[] = [];
  private redoStack: T[] = [];

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  activate(projectId: string | null) {
    if (this.projectId === projectId) return;
    this.projectId = projectId;
    this.undoStack = [];
    this.redoStack = [];
  }

  push(value: T) {
    this.undoStack.push(structuredClone(value));
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(current: T): T | null {
    const previous = this.undoStack.pop();
    if (!previous) return null;
    this.redoStack.push(structuredClone(current));
    return structuredClone(previous);
  }

  redo(current: T): T | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(structuredClone(current));
    return structuredClone(next);
  }
}
