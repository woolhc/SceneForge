import type { PipelineState } from "../panels/GenerateWizard";
import type { GenerationSession, GenerationStage } from "./generationSession";

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

/** stage → 已完成的步骤数（0-6），用于断点续跑时跳过已完成步骤 */
function completedStepCount(stage: GenerationStage | undefined): number {
  switch (stage) {
    case "created": return 1;
    case "narration_ready": return 2;
    case "transcribed": return 3;
    case "enriched":
    case "timeline_ready": return 4;
    case "assets_selected": return 5;
    case "subtitles_ready":
    case "completed": return 6;
    default: return 0;
  }
}

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

/**
 * 执行一键生成管线。
 * resumeSession：传入上次失败时保存的 session，自动跳过已完成步骤从断点续跑。
 */
export async function runGeneratePipeline(
  input: GeneratePipelineInput,
  runner: GeneratePipelineRunner,
  resumeSession?: GenerationSession | null,
) {
  const skipSteps = resumeSession ? completedStepCount(resumeSession.stage) : 0;
  const steps = buildGeneratePipelineSteps(input);
  // 断点续跑：已完成步骤标记为 done
  for (let i = 0; i < skipSteps && i < steps.length; i++) {
    steps[i].status = "done";
  }
  runner.startPipeline(steps);
  let session: GenerationSession | null = resumeSession ?? null;
  try {
    if (skipSteps < 1) {
      runner.updateStep(0, "running");
      session = await runner.createSession();
      runner.updateStep(0, "done");
    }

    if (skipSteps < 2) {
      runner.updateStep(1, "running");
      session = await runner.prepareNarration(session!);
      runner.updateStep(1, "done");
    }

    if (skipSteps < 3) {
      runner.updateStep(2, "running");
      session = await runner.transcribeNarration(session!);
      runner.updateStep(2, "done");
    }

    if (skipSteps < 4) {
      runner.updateStep(3, "running");
      session = await runner.enrichAndBuildTimeline(session!);
      runner.updateStep(3, "done");
    }

    if (skipSteps < 5) {
      runner.updateStep(4, "running");
      session = await runner.selectAssets(session!);
      runner.updateStep(4, "done");
    }

    if (skipSteps < 6) {
      runner.updateStep(5, "running");
      session = await runner.createSubtitles(session!);
      runner.updateStep(5, "done");
    }

    runner.updateStep(6, "running");
    runner.complete(session!);
    runner.updateStep(6, "done");
  } catch (error) {
    runner.fail(session, error instanceof Error ? error.message : String(error));
  }
}
