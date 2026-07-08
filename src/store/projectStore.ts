import { create } from "zustand";

type SelectionUpdater = string[] | ((previous: string[]) => string[]);

interface ProjectStore {
  selectedClipIds: string[];
  setSelectedClipIds: (next: SelectionUpdater) => void;
  clearSelection: () => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  selectedClipIds: [],
  setSelectedClipIds: (next) =>
    set((state) => ({
      selectedClipIds: typeof next === "function" ? next(state.selectedClipIds) : next,
    })),
  clearSelection: () => set({ selectedClipIds: [] }),
}));
