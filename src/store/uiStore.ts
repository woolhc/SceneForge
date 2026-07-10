import { create } from "zustand";
import type { ExportState } from "../panels/ExportDialog";
import type { ContextMenuState } from "../timeline/ContextMenu";

export type TabKind = "media" | "text" | "audio" | "transition";

export type ToastType = "error" | "warning" | "info" | "success";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  action?: ToastAction;
  createdAt: number;
  /** 自动消失延时（ms），0 表示不自动消失 */
  duration?: number;
}

interface UiStore {
  activeTab: TabKind;
  showSettings: boolean;
  showAddTrackMenu: boolean;
  contextMenu: ContextMenuState | null;
  showExport: boolean;
  exportState: ExportState;
  exportPath: string | null;
  exportError: string;
  exportProgress: number;
  exportMessage: string;
  previewZoom: number;
  toasts: Toast[];

  setActiveTab: (activeTab: TabKind) => void;
  setShowSettings: (showSettings: boolean | ((previous: boolean) => boolean)) => void;
  setShowAddTrackMenu: (showAddTrackMenu: boolean | ((previous: boolean) => boolean)) => void;
  setContextMenu: (contextMenu: ContextMenuState | null) => void;
  setShowExport: (showExport: boolean | ((previous: boolean) => boolean)) => void;
  setExportState: (exportState: ExportState) => void;
  setExportPath: (exportPath: string | null) => void;
  setExportError: (exportError: string) => void;
  setExportProgress: (exportProgress: number) => void;
  setExportMessage: (exportMessage: string) => void;
  setPreviewZoom: (next: number | ((previous: number) => number)) => void;
  pushToast: (toast: Omit<Toast, "id" | "createdAt">) => string;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

export const useUiStore = create<UiStore>((set) => ({
  activeTab: "text",
  showSettings: false,
  showAddTrackMenu: false,
  contextMenu: null,
  showExport: false,
  exportState: "idle",
  exportPath: null,
  exportError: "",
  exportProgress: 0,
  exportMessage: "",
  previewZoom: 100,
  toasts: [],

  setActiveTab: (activeTab) => set({ activeTab }),
  setShowSettings: (showSettings) =>
    set((state) => ({
      showSettings: typeof showSettings === "function" ? showSettings(state.showSettings) : showSettings,
    })),
  setShowAddTrackMenu: (showAddTrackMenu) =>
    set((state) => ({
      showAddTrackMenu: typeof showAddTrackMenu === "function" ? showAddTrackMenu(state.showAddTrackMenu) : showAddTrackMenu,
    })),
  setContextMenu: (contextMenu) => set({ contextMenu }),
  setShowExport: (showExport) =>
    set((state) => ({
      showExport: typeof showExport === "function" ? showExport(state.showExport) : showExport,
    })),
  setExportState: (exportState) => set({ exportState }),
  setExportPath: (exportPath) => set({ exportPath }),
  setExportError: (exportError) => set({ exportError }),
  setExportProgress: (exportProgress) => set({ exportProgress }),
  setExportMessage: (exportMessage) => set({ exportMessage }),
  setPreviewZoom: (next) =>
    set((state) => ({
      previewZoom: typeof next === "function" ? next(state.previewZoom) : next,
    })),
  pushToast: (toast) => {
    const id = uid("toast");
    const full: Toast = {
      id,
      createdAt: Date.now(),
      duration: toast.type === "error" ? 0 : 5000,
      ...toast,
    };
    set((state) => ({ toasts: [...state.toasts, full] }));
    return id;
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clearToasts: () => set({ toasts: [] }),
}));
