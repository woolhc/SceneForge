import { create } from "zustand";
import type { PipelineState } from "../panels/GenerateWizard";

type PipelineStepStatus = PipelineState["steps"][number]["status"];

interface PipelineStore {
  pipeline: PipelineState;
  setPipeline: (pipeline: PipelineState | ((previous: PipelineState) => PipelineState)) => void;
  startPipeline: (steps: PipelineState["steps"]) => void;
  updateStep: (index: number, status: PipelineStepStatus) => void;
  failRunningStep: (message: string) => void;
  completePipeline: (report: NonNullable<PipelineState["report"]>) => void;
  resetPipeline: () => void;
}

const idlePipeline: PipelineState = { active: false, steps: [], error: null, report: null };

export const usePipelineStore = create<PipelineStore>((set, get) => ({
  pipeline: idlePipeline,
  setPipeline: (pipeline) =>
    set((state) => ({
      pipeline: typeof pipeline === "function" ? pipeline(state.pipeline) : pipeline,
    })),
  startPipeline: (steps) => set({ pipeline: { active: true, steps, error: null, report: null } }),
  updateStep: (index, status) =>
    set((state) => ({
      pipeline: {
        ...state.pipeline,
        steps: state.pipeline.steps.map((step, i) => (i === index ? { ...step, status } : step)),
      },
    })),
  failRunningStep: (message) => {
    const current = get().pipeline;
    const runningIndex = current.steps.findIndex((step) => step.status === "running");
    set({
      pipeline: {
        ...current,
        error: message,
        steps: current.steps.map((step, i) => (
          i === runningIndex ? { ...step, status: "error" } : step
        )),
      },
    });
  },
  completePipeline: (report) => set((state) => ({
    pipeline: { ...state.pipeline, active: true, error: null, report },
  })),
  resetPipeline: () => set({ pipeline: idlePipeline }),
}));
