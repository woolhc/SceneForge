import type { ReactNode } from "react";
import {
  Bookmark,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Scissors,
  Trash2,
  VolumeX,
} from "lucide-react";

export function TimelineToolbar({
  canEditProject,
  canEditSelection,
  canPaste,
  addTrackMenu,
  zoomControls,
  onSplit,
  onDelete,
  onCopy,
  onPaste,
  onDuplicate,
  onAddChapter,
  onMuteAllVideoAudio,
}: {
  canEditProject: boolean;
  canEditSelection: boolean;
  canPaste: boolean;
  addTrackMenu: ReactNode;
  zoomControls: ReactNode;
  onSplit: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onAddChapter: () => void;
  onMuteAllVideoAudio: () => void;
}) {
  return (
    <div className="timeline-head">
      <div className="timeline-tools">
        <button onClick={onSplit} disabled={!canEditProject} title="分割 (Ctrl+B)">
          <Scissors size={15} />
          分割
        </button>
        <button onClick={onDelete} disabled={!canEditSelection} title="删除片段 (Del)">
          <Trash2 size={15} />
          删除片段
        </button>
        <button onClick={onCopy} disabled={!canEditSelection} title="复制 (Ctrl+C)">
          <Copy size={15} />
          复制
        </button>
        <button onClick={onPaste} disabled={!canPaste} title="粘贴 (Ctrl+V)">
          <ClipboardPaste size={15} />
          粘贴
        </button>
        <button onClick={onDuplicate} disabled={!canEditSelection} title="复制片段 (Ctrl+D)">
          <CopyPlus size={15} />
          复制片段
        </button>
        {addTrackMenu}
        <button onClick={onAddChapter} disabled={!canEditProject} title="在播放头处添加章节标记">
          <Bookmark size={15} />
          章节
        </button>
        <button
          onClick={onMuteAllVideoAudio}
          disabled={!canEditProject}
          title="将所有视频轨片段的原声音量设为 0，常用于导入配音后清除素材自带声音"
        >
          <VolumeX size={15} />
          静音视频原声
        </button>
      </div>
      {zoomControls}
    </div>
  );
}
