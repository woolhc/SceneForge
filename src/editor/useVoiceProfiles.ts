import { useState } from "react";
import { desktopApi } from "../tauri";
import type { AppSettings, VoiceProfile, VoicePreviewResult } from "../types";

/**
 * 音色管理 hook（原 App.tsx 7 个函数 + 配套状态原样搬移）。
 * 与时间线/预览零耦合，仅依赖 settings/voiceProfiles 等音色相关状态。
 */
export function useVoiceProfiles(deps: {
  settings: AppSettings;
  setSettings: (fn: (current: AppSettings) => AppSettings) => void;
  voiceProfiles: VoiceProfile[];
  setVoiceProfiles: (voices: VoiceProfile[]) => void;
  setStatus: (message: string) => void;
  setBusy: (key: string | null) => void;
}) {
  const { settings, setSettings, setVoiceProfiles, setStatus, setBusy } = deps;
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("");
  const [newVoiceName, setNewVoiceName] = useState("Fish 音色");
  const [newVoiceReferenceText, setNewVoiceReferenceText] = useState("");
  const [voicePreviewText, setVoicePreviewText] = useState("这是一段 Fish Audio 试听，用来检查声音是否自然。");
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null);
  const [voiceNameDrafts, setVoiceNameDrafts] = useState<Record<string, string>>({});
  const [voiceReferenceDrafts, setVoiceReferenceDrafts] = useState<Record<string, string>>({});

  function syncVoiceDrafts(voices: VoiceProfile[]) {
    setVoiceNameDrafts(Object.fromEntries(voices.map((voice) => [voice.id, voice.name])));
    setVoiceReferenceDrafts(Object.fromEntries(voices.map((voice) => [voice.id, voice.referenceText || ""])));
  }

  async function handleImportVoiceProfile(file?: File) {
    if (!file) return;
    const fallbackName = file.name.replace(/\.[^.]+$/, "").trim() || "自定义音色";
    const name = newVoiceName.trim() || fallbackName;
    setBusy("voice");
    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const voice = await desktopApi.importVoiceProfile({
        name,
        fileName: file.name,
        bytes,
        referenceText: newVoiceReferenceText.trim() || null,
      });
      const voices = await desktopApi.listVoiceProfiles();
      const nextSettings = { ...settings, defaultVoiceId: voice.id };
      const savedSettings = await desktopApi.saveSettings(nextSettings);
      setSettings(() => savedSettings);
      setSelectedVoiceId(voice.id);
      setVoiceProfiles(voices);
      syncVoiceDrafts(voices);
      setNewVoiceName("Fish 音色");
      setNewVoiceReferenceText("");
      setStatus(`已上传音色：${voice.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteVoiceProfile(id: string) {
    setBusy("voice");
    try {
      await desktopApi.deleteVoiceProfile(id);
      const voices = await desktopApi.listVoiceProfiles();
      const nextSettings =
        settings.defaultVoiceId === id ? { ...settings, defaultVoiceId: voices[0]?.id || null } : settings;
      const savedSettings = await desktopApi.saveSettings(nextSettings);
      setSettings(() => savedSettings);
      setSelectedVoiceId(nextSettings.defaultVoiceId || voices[0]?.id || "");
      setVoiceProfiles(voices);
      syncVoiceDrafts(voices);
      setStatus("音色已删除");
    } finally {
      setBusy(null);
    }
  }

  async function handleSelectVoiceProfile(id: string) {
    const saved = await desktopApi.saveSettings({ ...settings, defaultVoiceId: id || null });
    setSettings(() => saved);
    setSelectedVoiceId(id || "");
    setStatus("默认音色已更新");
  }

  async function handleSaveVoiceProfile(id: string) {
    setBusy("voice");
    try {
      const updated = await desktopApi.updateVoiceProfile(id, {
        name: voiceNameDrafts[id] || null,
        referenceText: voiceReferenceDrafts[id] || null,
      });
      const voices = await desktopApi.listVoiceProfiles();
      setVoiceProfiles(voices);
      syncVoiceDrafts(voices);
      setStatus(`音色已保存：${updated.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  /** 为已存在的音色重新上传参考音频 */
  async function handleReplaceVoiceSample(id: string, file?: File) {
    if (!file) return;
    setBusy("voice");
    setStatus("正在替换参考音频...");
    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const updated = await desktopApi.replaceVoiceSample({
        voiceId: id,
        fileName: file.name,
        bytes,
      });
      const voices = await desktopApi.listVoiceProfiles();
      setVoiceProfiles(voices);
      syncVoiceDrafts(voices);
      setStatus(`已替换参考音频：${updated.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function handlePreviewVoiceProfile(id = settings.defaultVoiceId || "") {
    if (!id) {
      setStatus("请先选择一个默认音色");
      return;
    }
    setBusy("voice-preview");
    setVoicePreviewUrl(null);
    try {
      const result = await desktopApi.previewVoiceProfile({ voiceId: id, text: voicePreviewText });
      setVoicePreviewUrl(desktopApi.mediaSrc(result.audioPath));
      setStatus(`试听已生成：${result.duration.toFixed(1)}s`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  return {
    selectedVoiceId,
    setSelectedVoiceId,
    newVoiceName,
    setNewVoiceName,
    newVoiceReferenceText,
    setNewVoiceReferenceText,
    voicePreviewText,
    setVoicePreviewText,
    voicePreviewUrl,
    voiceNameDrafts,
    setVoiceNameDrafts,
    voiceReferenceDrafts,
    setVoiceReferenceDrafts,
    syncVoiceDrafts,
    handleImportVoiceProfile,
    handleDeleteVoiceProfile,
    handleSelectVoiceProfile,
    handleSaveVoiceProfile,
    handleReplaceVoiceSample,
    handlePreviewVoiceProfile,
  };
}
