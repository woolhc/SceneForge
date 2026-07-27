import { useEffect, useRef, useState } from "react";
import { desktopApi, parsePipelineError } from "../tauri";
import type { GeneratePipelineInput } from "./pipeline";
import type { AppSettings, SubtitleGenerationMode, WhisperModelDownloadProgress, WhisperModelStatus } from "../types";
import { createPendingWhisperAction, hasWhisperModel, type PendingWhisperAction } from "./readiness";

const RECOMMENDED_WHISPER_MODEL_ID = "medium-q5";

type SubtitleRecognitionPayload = { translate: boolean; mode: SubtitleGenerationMode };
type PendingPayload = GeneratePipelineInput | SubtitleRecognitionPayload;

/**
 * Whisper 模型状态与设置弹窗的全部状态/操作（原 App.tsx 10 个函数 + 5 个状态原样搬移）。
 *
 * 循环依赖说明：resumePendingWhisperAction 需要在模型就绪后回放"一键生成"或"识别字幕"，
 * 但那两个业务函数定义在 App.tsx 里（依赖大量其他状态），不能被这个 hook 直接引用。
 * 用 setCallbacks 做延迟注入：App 挂载后把回调传进来（见 App.tsx 顶部一次性 effect），
 * 行为与原来的直接调用完全一致，只是调用时机从"编译期可见"变成"运行期已注册"。
 */
export function useWhisperSetup(deps: {
  setStatus: (message: string) => void;
  setBusy: (key: string | null) => void;
  setSettings: (fn: (current: AppSettings) => AppSettings) => void;
  setSettingsDraft: (fn: (current: AppSettings) => AppSettings) => void;
}) {
  const { setStatus, setBusy, setSettings, setSettingsDraft } = deps;
  const [whisperModelStatus, setWhisperModelStatus] = useState<WhisperModelStatus | null>(null);
  const [whisperDownloadProgress, setWhisperDownloadProgress] = useState<WhisperModelDownloadProgress | null>(null);
  const [whisperSetupOpen, setWhisperSetupOpen] = useState(false);
  const [whisperSetupError, setWhisperSetupError] = useState<string | null>(null);
  const pendingWhisperActionRef = useRef<PendingWhisperAction<PendingPayload> | null>(null);
  const pendingWhisperActionId = useRef(0);
  const callbacksRef = useRef<{
    runGeneratePipeline: (input: GeneratePipelineInput, control: { skipWhisperGate: true }) => Promise<void>;
    runRecognizeSubtitles: (payload: SubtitleRecognitionPayload, control: { skipWhisperGate: true }) => Promise<void>;
  } | null>(null);

  function setCallbacks(callbacks: {
    runGeneratePipeline: (input: GeneratePipelineInput, control: { skipWhisperGate: true }) => Promise<void>;
    runRecognizeSubtitles: (payload: SubtitleRecognitionPayload, control: { skipWhisperGate: true }) => Promise<void>;
  }) {
    callbacksRef.current = callbacks;
  }

  async function refreshWhisperModelStatus() {
    try {
      setWhisperModelStatus(await desktopApi.getWhisperModelStatus());
    } catch (error) {
      const parsed = parsePipelineError(error);
      setWhisperModelStatus(null);
      setStatus(parsed.message);
    }
  }

  // 挂载时刷新一次状态 + 订阅下载进度事件（模型下载可能耗时数分钟）
  useEffect(() => {
    void refreshWhisperModelStatus();
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void desktopApi.listenWhisperModelProgress((progress) => {
      if (!disposed) setWhisperDownloadProgress(progress);
    }).then((nextUnlisten) => {
      if (disposed) nextUnlisten();
      else unlisten = nextUnlisten;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  function openWhisperSetup() {
    pendingWhisperActionRef.current = null;
    setWhisperSetupError(null);
    setWhisperDownloadProgress(null);
    setWhisperSetupOpen(true);
  }

  function requestWhisperSetup(kind: PendingWhisperAction["kind"], payload: PendingPayload) {
    const nextId = pendingWhisperActionId.current + 1;
    pendingWhisperActionId.current = nextId;
    const pending = createPendingWhisperAction(nextId, kind, payload);
    pendingWhisperActionRef.current = pending;
    setWhisperSetupError(null);
    setWhisperDownloadProgress(null);
    setWhisperSetupOpen(true);
    setStatus("请先完成 Whisper 模型设置");
  }

  async function resumePendingWhisperAction(statusOverride?: WhisperModelStatus | null) {
    if (!hasWhisperModel(statusOverride ?? whisperModelStatus)) return;
    const pending = pendingWhisperActionRef.current;
    pendingWhisperActionRef.current = null;
    setWhisperSetupOpen(false);
    setWhisperSetupError(null);
    setWhisperDownloadProgress(null);
    if (!pending) return;
    const callbacks = callbacksRef.current;
    if (!callbacks) return;
    if (pending.kind === "generate-pipeline") {
      await callbacks.runGeneratePipeline(pending.payload as GeneratePipelineInput, { skipWhisperGate: true });
      return;
    }
    await callbacks.runRecognizeSubtitles(pending.payload as SubtitleRecognitionPayload, { skipWhisperGate: true });
  }

  function cancelPendingWhisperAction() {
    pendingWhisperActionRef.current = null;
    setWhisperSetupOpen(false);
    setWhisperSetupError(null);
    setStatus("已取消 Whisper 设置");
  }

  async function handleDownloadWhisperModel() {
    setBusy("whisper-download");
    setWhisperSetupError(null);
    setWhisperDownloadProgress(null);
    let installedStatus: WhisperModelStatus | null = null;
    try {
      installedStatus = await desktopApi.downloadWhisperModel(RECOMMENDED_WHISPER_MODEL_ID);
      setWhisperModelStatus(installedStatus);
      setSettings((current) => ({
        ...current,
        whisperModel: installedStatus?.configuredPath || installedStatus?.resolvedPath || current.whisperModel,
      }));
      setSettingsDraft((current) => ({
        ...current,
        whisperModel: installedStatus?.configuredPath || installedStatus?.resolvedPath || current.whisperModel,
      }));
      setStatus("Whisper 模型已就绪");
    } catch (error) {
      const parsed = parsePipelineError(error);
      setWhisperSetupError(parsed.message);
      setStatus(`Whisper 模型下载失败：${parsed.message}`);
    } finally {
      setBusy(null);
    }
    if (installedStatus) {
      await resumePendingWhisperAction(installedStatus);
    }
  }

  async function handleCancelWhisperDownload() {
    try {
      await desktopApi.cancelWhisperModelDownload();
      setWhisperDownloadProgress(null);
      setStatus("已取消 Whisper 模型下载");
    } catch (error) {
      setWhisperSetupError(parsePipelineError(error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleSelectWhisperModel() {
    setBusy("whisper-select");
    setWhisperSetupError(null);
    let selectedStatus: WhisperModelStatus | null = null;
    try {
      const path = await desktopApi.pickWhisperModelFile();
      if (!path) return;
      selectedStatus = await desktopApi.selectWhisperModel(path);
      setWhisperModelStatus(selectedStatus);
      setSettings((current) => ({ ...current, whisperModel: path }));
      setSettingsDraft((current) => ({ ...current, whisperModel: path }));
      setStatus("已选择本地 Whisper 模型");
    } catch (error) {
      const parsed = parsePipelineError(error);
      setWhisperSetupError(parsed.message);
      setStatus(`选择 Whisper 模型失败：${parsed.message}`);
    } finally {
      setBusy(null);
    }
    if (selectedStatus) {
      await resumePendingWhisperAction(selectedStatus);
    }
  }

  async function handleDeleteWhisperModel() {
    setBusy("whisper-delete");
    try {
      const nextStatus = await desktopApi.deleteWhisperModel();
      setWhisperModelStatus(nextStatus);
      setSettings((current) => ({ ...current, whisperModel: nextStatus.configuredPath || "" }));
      setSettingsDraft((current) => ({ ...current, whisperModel: nextStatus.configuredPath || "" }));
      setStatus("Whisper 模型已删除");
    } catch (error) {
      setStatus(parsePipelineError(error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleOpenModelsDirectory() {
    try {
      await desktopApi.openModelsDirectory();
    } catch (error) {
      setStatus(parsePipelineError(error).message);
    }
  }

  return {
    whisperModelStatus,
    whisperDownloadProgress,
    whisperSetupOpen,
    whisperSetupError,
    setCallbacks,
    refreshWhisperModelStatus,
    openWhisperSetup,
    requestWhisperSetup,
    resumePendingWhisperAction,
    cancelPendingWhisperAction,
    handleDownloadWhisperModel,
    handleCancelWhisperDownload,
    handleSelectWhisperModel,
    handleDeleteWhisperModel,
    handleOpenModelsDirectory,
  };
}
