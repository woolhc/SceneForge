import { useEffect, useRef } from "react";
import type { Clip, TrackKind } from "../types";

export type ContextMenuState = {
  x: number;
  y: number;
  clip: Clip;
  trackKind: TrackKind;
};

export function ContextMenu({
  state,
  onClose,
  actions,
}: {
  state: ContextMenuState;
  onClose: () => void;
  actions: {
    onSplit: () => void;
    onDelete: () => void;
    onCopy: () => void;
    onPaste: () => void;
    onDuplicate: () => void;
    onDetachAudio: () => void;
    onSeparateVocals: () => void;
    onMute: () => void;
    onReverse: () => void;
    onAddSubtitle: () => void;
    onEditText?: () => void;
    onRegenerateAsset?: () => void;
  };
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { clip, trackKind } = state;

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [onClose]);

  const isVideo = trackKind === "video";
  const isAudio = trackKind === "audio" || trackKind === "voiceover";
  const isSubtitle = trackKind === "subtitle" || trackKind === "text";

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: state.x, top: state.y }}
    >
      {/* 编辑操作 */}
      <button onClick={() => { actions.onSplit(); onClose(); }}>
        <ScissorsIcon /> 分割 <kbd>Ctrl+B</kbd>
      </button>
      <button onClick={() => { actions.onDelete(); onClose(); }}>
        <TrashIcon /> 删除 <kbd>Del</kbd>
      </button>
      <button onClick={() => { actions.onCopy(); onClose(); }}>
        <CopyIcon /> 复制 <kbd>Ctrl+C</kbd>
      </button>
      <button onClick={() => { actions.onPaste(); onClose(); }}>
        <PasteIcon /> 粘贴 <kbd>Ctrl+V</kbd>
      </button>
      <button onClick={() => { actions.onDuplicate(); onClose(); }}>
        <DuplicateIcon /> 复制片段 <kbd>Ctrl+D</kbd>
      </button>

      <div className="ctx-divider" />

      {/* 视频专用 */}
      {isVideo && (
        <>
          <button onClick={() => { actions.onMute(); onClose(); }}>
            <VolumeIcon /> {clip.volume > 0 ? "静音" : "取消静音"}
          </button>
          <button onClick={() => { actions.onDetachAudio(); onClose(); }}>
            <MicIcon /> 分离音频
          </button>
          <button onClick={() => { actions.onSeparateVocals(); onClose(); }}>
            <WaveIcon /> 分离人声
          </button>
          <button onClick={() => { actions.onReverse(); onClose(); }}>
            <ReverseIcon /> 倒放
          </button>
          {actions.onRegenerateAsset && (
            <button onClick={() => { actions.onRegenerateAsset?.(); onClose(); }}>
              <RefreshIcon /> 重新匹配素材
            </button>
          )}
        </>
      )}

      {/* 音频专用 */}
      {isAudio && (
        <>
          <button onClick={() => { actions.onMute(); onClose(); }}>
            <VolumeIcon /> {clip.volume > 0 ? "静音" : "取消静音"}
          </button>
          <button onClick={() => { actions.onAddSubtitle(); onClose(); }}>
            <CaptionIcon /> 识别字幕
          </button>
        </>
      )}

      {/* 字幕专用 */}
      {isSubtitle && (
        <button onClick={() => { actions.onEditText?.(); onClose(); }}>
          <EditIcon /> 编辑文字
        </button>
      )}
    </div>
  );
}

// 简单 SVG 图标（避免额外 import）
function ScissorsIcon() { return <span>✂️</span>; }
function TrashIcon() { return <span>🗑️</span>; }
function CopyIcon() { return <span>📋</span>; }
function PasteIcon() { return <span>📎</span>; }
function DuplicateIcon() { return <span>📑</span>; }
function VolumeIcon() { return <span>🔇</span>; }
function MicIcon() { return <span>🎙️</span>; }
function WaveIcon() { return <span>🎵</span>; }
function ReverseIcon() { return <span>⏪</span>; }
function CaptionIcon() { return <span>💬</span>; }
function EditIcon() { return <span>✏️</span>; }
function RefreshIcon() { return <span>🔄</span>; }
