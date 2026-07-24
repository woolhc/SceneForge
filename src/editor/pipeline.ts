import type { PipelineState } from "../panels/GenerateWizard";
import type { GenerationSession } from "./generationSession";

export type GeneratePipelineInput = {
  script: string;
  ratio: string;
  voiceId: string;
  translate: boolean;
  materialDirection?: string;
  audioPath?: string | null;
  /** 合成版式模板 id；缺省 standard-fill */
  compositionTemplateId?: string;
};

type StepStatus = PipelineState["steps"][number]["status"];

type GeneratePipelineRunner = {
  createSession: () => Promise<GenerationSession>;
  prepareNarration: (session: GenerationSession) => Promise<GenerationSession>;
  transcribeNarration: (session: GenerationSession) => Promise<GenerationSession>;
  enrichAndBuildTimeline: (session: GenerationSession) => Promise<GenerationSession>;
  selectAssets: (session: GenerationSession) => Promise<GenerationSession>;
  createSubtitles: (session: GenerationSession) => Promise<GenerationSession>;
  complete: (session: GenerationSession) => void;
  fail: (session: GenerationSession | null, message: string) => void;
  startPipeline: (steps: PipelineState["steps"]) => void;
  updateStep: (index: number, status: StepStatus) => void;
};

export function buildGeneratePipelineSteps(input: GeneratePipelineInput): PipelineState["steps"] {
  return [
    { label: "创建生成会话", status: "pending" },
    { label: input.audioPath ? "准备主旁白音频" : "Fish Audio 生成完整旁白", status: "pending" },
    { label: "Whisper 单次转写", status: "pending" },
    { label: "AI 分镜 + 构建时间线", status: "pending" },
    { label: "素材评分 + 去重", status: "pending" },
    { label: "从转写生成字幕", status: "pending" },
    { label: "生成报告", status: "pending" },
  ];
}

export async function runGeneratePipeline(input: GeneratePipelineInput, runner: GeneratePipelineRunner) {
  runner.startPipeline(buildGeneratePipelineSteps(input));
  let session: GenerationSession | null = null;
  try {
    runner.updateStep(0, "running");
    session = await runner.createSession();
    runner.updateStep(0, "done");

    runner.updateStep(1, "running");
    session = await runner.prepareNarration(session);
    runner.updateStep(1, "done");

    runner.updateStep(2, "running");
    session = await runner.transcribeNarration(session);
    runner.updateStep(2, "done");

    runner.updateStep(3, "running");
    session = await runner.enrichAndBuildTimeline(session);
    runner.updateStep(3, "done");

    runner.updateStep(4, "running");
    session = await runner.selectAssets(session);
    runner.updateStep(4, "done");

    runner.updateStep(5, "running");
    session = await runner.createSubtitles(session);
    runner.updateStep(5, "done");

    runner.updateStep(6, "running");
    runner.complete(session);
    runner.updateStep(6, "done");
  } catch (error) {
    runner.fail(session, error instanceof Error ? error.message : String(error));
  }
}
