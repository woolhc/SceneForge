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
  pixabayReady: boolean;
  /** 任一素材源已配置 */
  stockReady: boolean;
  fishAudioReady: boolean;
};

export type ReadinessIssue = {
  id: "whisper" | "deepseek" | "pexels" | "pixabay" | "stock" | "fishAudio";
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
  const pexelsReady = Boolean(settings.pexelsApiKey?.trim());
  const pixabayReady = Boolean(settings.pixabayApiKey?.trim());
  return {
    deepseekReady: Boolean(settings.deepseekApiKey?.trim()),
    pexelsReady,
    pixabayReady,
    stockReady: pexelsReady || pixabayReady,
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
  if (!api.stockReady) {
    issues.push({
      id: "stock",
      severity: "recommended",
      title: "素材源 Key 未配置",
      description: "请配置 Pexels 或 Pixabay API Key，以启用自动素材检索。",
    });
  } else if (!api.pexelsReady && api.pixabayReady) {
    issues.push({
      id: "pexels",
      severity: "recommended",
      title: "仅配置了 Pixabay",
      description: "Pexels 未配置，将使用 Pixabay 搜索视频/图片。",
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
