import type { PipelineState } from "../panels/GenerateWizard";

export type GeneratePipelineInput = {
  script: string;
  ratio: string;
  voiceId: string;
  translate: boolean;
  audioPath?: string | null;
};

type StepStatus = PipelineState["steps"][number]["status"];

type GeneratePipelineRunner = {
  createProject: () => Promise<void>;
  segmentAndBindAssets: () => Promise<void>;
  prepareAudio: () => Promise<void>;
  recognizeSubtitles: () => Promise<void>;
  complete: () => void;
  fail: (message: string) => void;
  startPipeline: (steps: PipelineState["steps"]) => void;
  updateStep: (index: number, status: StepStatus) => void;
};

export function buildGeneratePipelineSteps(input: GeneratePipelineInput): PipelineState["steps"] {
  const isAudioMode = !!input.audioPath;
  return [
    { label: "创建项目", status: "pending" },
    { label: isAudioMode ? "识别音频 + 匹配素材" : "AI 分段 + 匹配素材", status: "pending" },
    { label: input.voiceId ? "生成配音" : "准备音频", status: "pending" },
    { label: "识别字幕", status: "pending" },
    { label: "完成", status: "pending" },
  ];
}

export async function runGeneratePipeline(
  input: GeneratePipelineInput,
  runner: GeneratePipelineRunner,
) {
  runner.startPipeline(buildGeneratePipelineSteps(input));
  try {
    runner.updateStep(0, "running");
    await runner.createProject();
    runner.updateStep(0, "done");

    runner.updateStep(1, "running");
    await wait(200);
    await runner.segmentAndBindAssets();
    runner.updateStep(1, "done");

    runner.updateStep(2, "running");
    await runner.prepareAudio();
    runner.updateStep(2, "done");

    runner.updateStep(3, "running");
    await wait(300);
    await runner.recognizeSubtitles();
    runner.updateStep(3, "done");

    runner.updateStep(4, "done");
    runner.complete();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runner.fail(message);
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
