import type { AppSettings, WhisperModelDownloadProgress, WhisperModelStatus } from "../types";

export type { WhisperModelDownloadProgress, WhisperModelStatus } from "../types";

export type FirstUseActionKind = "generate-pipeline" | "subtitle-recognition";

export type PendingWhisperAction<T = unknown> = {
  id: number;
  kind: FirstUseActionKind;
  payload: T;
};

export type ApiReadiness = {
  deepseekReady: boolean;
  pexelsReady: boolean;
  fishAudioReady: boolean;
};

export type ReadinessIssue = {
  id: "whisper" | "deepseek" | "pexels" | "fishAudio";
  severity: "required" | "recommended";
  title: string;
  description: string;
};

export function hasWhisperModel(status: WhisperModelStatus | null | undefined): boolean {
  return status?.available === true && status.whisperAvailable === true;
}

export function whisperStatusLabel(status: WhisperModelStatus | null | undefined): string {
  if (!status) return "检测中";
  if (status.downloading) return "正在下载";
  if (status.available && !status.whisperAvailable) return "whisper-cli 不可用";
  if (hasWhisperModel(status)) {
    if (status.selectedModelId === "custom") {
      return status.resolvedPath?.split(/[\/]/).pop() || "自定义模型";
    }
    return status.model.name || "已就绪";
  }
  if (status.partialDownload) return "下载未完成";
  return "未安装模型";
}

export function getApiReadiness(settings: AppSettings): ApiReadiness {
  return {
    deepseekReady: Boolean(settings.deepseekApiKey?.trim()),
    pexelsReady: Boolean(settings.pexelsApiKey?.trim()),
    fishAudioReady: Boolean(settings.fishAudioApiKey?.trim() || settings.fishAudioReferenceId?.trim() || settings.defaultVoiceId),
  };
}

export function getReadinessIssues(settings: AppSettings, whisperStatus: WhisperModelStatus | null | undefined): ReadinessIssue[] {
  const api = getApiReadiness(settings);
  const issues: ReadinessIssue[] = [];
  if (!hasWhisperModel(whisperStatus)) {
    issues.push({
      id: "whisper",
      severity: "required",
      title: "Whisper 模型未就绪",
      description: whisperStatus?.available && !whisperStatus.whisperAvailable
        ? "Whisper 模型已安装，但应用未找到 whisper-cli。"
        : "一键生成和字幕识别需要本地 Whisper 模型。",
    });
  }
  if (!api.deepseekReady) {
    issues.push({
      id: "deepseek",
      severity: "recommended",
      title: "DeepSeek Key 未配置",
      description: "AI 分镜、语义断句和文本优化会受限。",
    });
  }
  if (!api.pexelsReady) {
    issues.push({
      id: "pexels",
      severity: "recommended",
      title: "Pexels Key 未配置",
      description: "自动素材检索会受限。",
    });
  }
  if (!api.fishAudioReady) {
    issues.push({
      id: "fishAudio",
      severity: "recommended",
      title: "Fish Audio 未配置",
      description: "文案生成旁白前需要可用音色或 Reference ID。",
    });
  }
  return issues;
}

export function shouldGateWhisperAction(status: WhisperModelStatus | null | undefined): boolean {
  return !hasWhisperModel(status);
}

export function createPendingWhisperAction<T>(
  nextId: number,
  kind: FirstUseActionKind,
  payload: T,
): PendingWhisperAction<T> {
  return { id: nextId, kind, payload };
}
