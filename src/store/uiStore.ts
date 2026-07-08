import { create } from "zustand";
import type { ExportState } from "../panels/ExportDialog";
import type { ContextMenuState } from "../timeline/ContextMenu";

export type TabKind = "media" | "text" | "audio" | "transition";

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
}));
