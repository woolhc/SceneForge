import { desktopApi, parsePipelineError } from "../tauri";
import type { Project, SubtitleGenerationMode, SubtitleLanguageContext, AppSettings } from "../types";
import type { TimedSentencesResult } from "../types";
import { buildTranscriptSubtitleProject, prepareTranscriptSubtitles } from "./subtitleFromTranscript";
import { requestSubtitleSemanticAdvice } from "./subtitles/semanticAdvice";
import { saveSubtitleArtifact } from "./subtitles/artifacts";
import { subtitleLayoutProfile } from "./subtitles/profiles";

type ToastFn = (toast: { type: "info" | "warning" | "error" | "success"; message: string; duration?: number }) => void;

/**
 * 一键生成管线的字幕构建步骤（原 App.tsx buildOptimizedSubtitles 127 行原样搬移）。
 * 依赖通过参数注入，不引用任何 App 级闭包状态。
 */
export async function buildOptimizedSubtitles(
  currentProject: Project,
  sentences: TimedSentencesResult["sentences"],
  translate: boolean,
  mode: SubtitleGenerationMode,
  settings: AppSettings,
  setStatus: (message: string) => void,
  pushToast: ToastFn,
): Promise<{ project: Project; issueCount: number }> {
  const transcriptWords = sentences.flatMap((sentence) => sentence.words ?? []);
  const rawTranscriptText = sentences.map((sentence) => sentence.text).join("");
  let analyzedContext: SubtitleLanguageContext = {
    summary: currentProject.script || rawTranscriptText.slice(0, 500),
    contentType: "other",
    tone: "natural",
    terms: [],
  };
  if (settings.deepseekApiKey) {
    try {
      analyzedContext = await desktopApi.analyzeSubtitleLanguageContext({
        projectTitle: currentProject.title,
        script: currentProject.script,
        transcript: rawTranscriptText,
        mode,
      });
    } catch {
      setStatus("全局语言分析不可用，继续使用项目原文上下文");
    }
  }
  const languageContext = JSON.stringify(analyzedContext);
  const layoutProfile = subtitleLayoutProfile(currentProject, translate);
  const canUseSemanticAi = Boolean(settings.deepseekApiKey)
    && transcriptWords.length >= 8
    && sentences.every((sentence) => Boolean(sentence.words?.length));
  const semanticAdvice = canUseSemanticAi
    ? await requestSubtitleSemanticAdvice(
        transcriptWords,
        (words) => desktopApi.adviseSubtitleBreaks({
          words: words.map((word) => word.text),
          wordTimings: words.map((word, index) => ({
            text: word.text,
            start: word.start,
            end: word.end,
            gapAfter: Math.max(0, (words[index + 1]?.start ?? word.end) - word.end),
          })),
          constraints: {
            ratio: layoutProfile.ratio,
            maxLines: layoutProfile.maxLines,
            preferredCharsPerLine: layoutProfile.preferredCharsPerLine,
            maxCharsPerCue: layoutProfile.maxCharsPerCue,
            minDuration: layoutProfile.minDuration,
            preferredDuration: layoutProfile.preferredDuration,
            maxDuration: layoutProfile.maxDuration,
            preferredCps: layoutProfile.preferredCps,
            maxCps: layoutProfile.maxCps,
          },
          context: languageContext,
          mode,
        }),
      )
    : null;
  if (semanticAdvice?.successfulChunkCount) {
    const fallbackText = semanticAdvice.failedChunkCount > 0
      ? `，${semanticAdvice.failedChunkCount} 批已规则回退`
      : "";
    setStatus(`AI 语义断句完成：${semanticAdvice.successfulChunkCount}/${semanticAdvice.requestedChunkCount} 批${fallbackText}`);
  } else if (canUseSemanticAi) {
    setStatus("AI 语义断句不可用，已自动回退规则引擎");
  }
  const segmentedTranscript = prepareTranscriptSubtitles(
    currentProject,
    sentences,
    translate,
    semanticAdvice ?? undefined,
  );
  const transcript = translate
    ? await desktopApi.refineTranscript({
        sentences: segmentedTranscript,
        translate: true,
        mode,
        context: languageContext,
      })
    : segmentedTranscript;
  const subtitleBuild = buildTranscriptSubtitleProject(currentProject, transcript, translate);
  const saved = await desktopApi.saveProject(subtitleBuild.project);
  if (subtitleBuild.issueCount > 0) {
    pushToast({
      type: "warning",
      message: `字幕排版完成，${subtitleBuild.issueCount} 个质量提示可在字幕中检查`,
      duration: 8000,
    });
  }
  try {
    await saveSubtitleArtifact({
      version: 1,
      projectId: currentProject.id,
      generatedAt: new Date().toISOString(),
      mode,
      bilingual: translate,
      languageContext: analyzedContext,
      rawTranscript: sentences,
      sourceCues: segmentedTranscript,
      translatedCues: transcript,
      ai: {
        requestedChunks: semanticAdvice?.requestedChunkCount ?? 0,
        successfulChunks: semanticAdvice?.successfulChunkCount ?? 0,
        failedChunks: semanticAdvice?.failedChunkCount ?? 0,
        failureCategories: semanticAdvice?.failureCategories ?? [],
        confidence: semanticAdvice?.confidence ?? 0,
        preferredBreakCount: semanticAdvice?.preferredBreakAfterIndices.size ?? 0,
        strongBreakCount: semanticAdvice?.strongBreakAfterIndices.size ?? 0,
        protectedRangeCount: semanticAdvice?.protectedRanges.length ?? 0,
      },
      output: {
        groupCount: subtitleBuild.groupCount,
        sourceClipCount: subtitleBuild.sourceClipCount,
        targetClipCount: subtitleBuild.targetClipCount,
        qualityIssues: subtitleBuild.issues,
      },
    });
  } catch {
    pushToast({ type: "warning", message: "字幕已生成，但中间产物保存失败" });
  }
  if (translate && subtitleBuild.targetClipCount < subtitleBuild.sourceClipCount) {
    pushToast({ type: "warning", message: `翻译字幕不完整：${subtitleBuild.targetClipCount}/${subtitleBuild.sourceClipCount}` });
  }
  return { project: saved, issueCount: subtitleBuild.issueCount };
}

// 保持 parsePipelineError 导出可用（某些调用方可能通过此模块间接引用）
export { parsePipelineError };
