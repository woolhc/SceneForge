import type { Clip, MediaSource, Project, Track } from "../types";
import { sliceClipByTimelineRange, splitClipByTimelineTime } from "../editor/clipTimeMap";

/** 拖拽手柄类型 */
export type DragHandle = "body" | "left" | "right";

export type DragState = {
  clipId: string;
  handle: DragHandle;
  /** 拖拽起点 pointer x */
  startX: number;
  /** 拖拽开始时 clip 的快照 */
  initial: Clip;
  /** 拖拽开始时同轨道其他 clip（用于吸附参考，拖拽全程不随跨轨悬停变化） */
  peers: Clip[];
  /** 当前播放头位置（用于吸附） */
  playhead?: number;
  /** 是否已经超过防误触像素阈值并正式进入拖拽。 */
  activated?: boolean;
  /** 拖拽过程中最后一次计算的 patch（endDrag 时用它 commit=true） */
  lastPatch?: Partial<Clip>;
  /** 拖拽发起时所在轨道 id */
  sourceTrackId: string;
  /** 当前鼠标悬停命中的轨道 id（纯视觉，跨轨真正生效与否只在松手时判定一次） */
  currentTrackId: string;
  /** 是否允许跨轨（body handle 且单选时为 true；left/right 手柄或多选为 false） */
  crossTrackEnabled: boolean;
};

/** 像素 → 秒换算 */
export function pxToSeconds(deltaPx: number, pxPerSecond: number) {
  return deltaPx / pxPerSecond;
}

export const POINTER_DRAG_THRESHOLD_PX = 5;

export function hasExceededPointerDragThreshold(startX: number, currentX: number, threshold = POINTER_DRAG_THRESHOLD_PX) {
  return Math.abs(currentX - startX) >= threshold;
}

export function shouldStartTimelinePan(button: number, altKey: boolean) {
  return button === 1 || (button === 0 && altKey);
}

/** 吸附阈值（像素）—— M5: 不再固定秒数，按 8px 像素阈值换算 */
const SNAP_THRESHOLD_PX = 8;

type SnapResult = { value: number; snappedTo: number | null };

/**
 * 尝试吸附到一个参考点列表。返回吸附后的值，以及命中的吸附点（未命中为 null）。
 * pxPerSecond 用于把像素阈值换算成秒阈值（缩放级别相关）。
 */
function snap(value: number, snapPoints: number[], pxPerSecond: number = 64): SnapResult {
  const thresholdSec = SNAP_THRESHOLD_PX / pxPerSecond;
  for (const sp of snapPoints) {
    if (Math.abs(value - sp) < thresholdSec) return { value: sp, snappedTo: sp };
  }
  return { value, snappedTo: null };
}

/** computeDraggedClip 的返回值：patch 供直接 merge 进 Clip，snapLine 供 UI 渲染吸附提示线 */
export type DragComputeResult = {
  patch: Partial<Clip>;
  snapLine: number | null;
};

/**
 * 计算拖拽后的 clip 新值。
 * 增强：碰撞检测（不与同轨 clip 重叠）+ 双端吸附（start/end/playhead）。
 * 注意：只处理同轨道内的水平时间轴计算，不感知跨轨——跨轨是否生效由调用方在松手时另行判定。
 */
export function computeDraggedClip(
  drag: DragState,
  deltaSeconds: number,
  sourceDuration?: number,
  pxPerSecond: number = 64,
): DragComputeResult {
  const { initial, handle, peers, playhead } = drag;
  const result = {
    startOnTrack: initial.startOnTrack,
    duration: initial.duration,
    sourceIn: initial.sourceIn,
    sourceOut: initial.sourceOut,
  };
  let snapLine: number | null = null;

  // 收集吸附点：所有 peer 的 start/end + playhead + 0
  const snapPoints: number[] = [0];
  if (playhead !== undefined) snapPoints.push(playhead);
  for (const peer of peers) {
    snapPoints.push(peer.startOnTrack);
    snapPoints.push(peer.startOnTrack + peer.duration);
  }

  if (handle === "body") {
    let newStart = Math.max(0, initial.startOnTrack + deltaSeconds);
    const newEnd = newStart + initial.duration;

    // 吸附：start 吸附到 peer 边缘/playhead
    const startSnap = snap(newStart, snapPoints, pxPerSecond);
    newStart = startSnap.value;
    if (startSnap.snappedTo !== null) snapLine = startSnap.snappedTo;
    // 吸附：end 吸附到 peer 边缘/playhead
    const endSnap = snap(newEnd, snapPoints, pxPerSecond);
    if (endSnap.snappedTo !== null) {
      newStart = endSnap.value - initial.duration;
      snapLine = endSnap.snappedTo;
    }

    // 碰撞检测：不与同轨其他 clip 重叠
    for (const peer of peers) {
      const peerStart = peer.startOnTrack;
      const peerEnd = peer.startOnTrack + peer.duration;
      // 如果 newStart..newEnd 和 peer 有重叠
      if (newStart < peerEnd - 0.01 && newStart + initial.duration > peerStart + 0.01) {
        // 推开：如果拖向右（deltaSeconds > 0），贴到 peer 的 end 之后
        if (deltaSeconds > 0) {
          newStart = peerEnd;
        } else {
          // 拖向左，贴到 peer 的 start 之前
          newStart = peerStart - initial.duration;
        }
        newStart = Math.max(0, newStart);
      }
    }

    result.startOnTrack = newStart;
  } else if (handle === "right") {
    let newDuration = Math.max(0.2, initial.duration + deltaSeconds);
    const newEnd = initial.startOnTrack + newDuration;

    // 吸附：右边缘吸附到 peer 边缘/playhead
    const endSnap = snap(newEnd, snapPoints, pxPerSecond);
    if (endSnap.snappedTo !== null) {
      newDuration = Math.max(0.2, endSnap.value - initial.startOnTrack);
      snapLine = endSnap.snappedTo;
    }

    // 碰撞检测：不能覆盖下一个 clip
    for (const peer of peers) {
      if (initial.startOnTrack + newDuration > peer.startOnTrack + 0.01 &&
          initial.startOnTrack < peer.startOnTrack + peer.duration - 0.01) {
        newDuration = Math.max(0.2, peer.startOnTrack - initial.startOnTrack);
      }
    }

    const speed = Math.max(0.0001, Math.abs(initial.speed || 1));
    const reverse = initial.reverse === true || initial.speed < 0;
    if (initial.speedCurve?.length) {
      newDuration = Math.min(newDuration, initial.duration);
    } else if (sourceDuration !== undefined) {
      const maxBySource = reverse
        ? initial.sourceOut / speed
        : (sourceDuration - initial.sourceIn) / speed;
      if (newDuration > maxBySource) newDuration = Math.max(0.2, maxBySource);
    }

    if (newDuration <= initial.duration + 1e-9) {
      return { patch: sliceClipByTimelineRange(initial, 0, newDuration), snapLine };
    }

    result.duration = newDuration;
    if (reverse) result.sourceIn = Math.max(0, initial.sourceOut - newDuration * speed);
    else result.sourceOut = initial.sourceIn + newDuration * speed;
  } else {
    // 左边缘
    let deltaStart = deltaSeconds;
    if (initial.sourceIn + deltaStart < 0) deltaStart = -initial.sourceIn;
    if (initial.startOnTrack + deltaStart < 0) deltaStart = -initial.startOnTrack;

    let newStart = Math.max(0, initial.startOnTrack + deltaStart);
    let newDuration = Math.max(0.2, initial.duration - deltaStart);

    // 吸附：左边缘吸附
    const startSnap = snap(newStart, snapPoints, pxPerSecond);
    newStart = startSnap.value;
    if (startSnap.snappedTo !== null) snapLine = startSnap.snappedTo;
    newDuration = initial.duration - (newStart - initial.startOnTrack);

    // 碰撞：不能覆盖前一个 clip
    for (const peer of peers) {
      if (newStart < peer.startOnTrack + peer.duration - 0.01 &&
          newStart + newDuration > peer.startOnTrack + 0.01) {
        newStart = peer.startOnTrack + peer.duration;
        newDuration = initial.duration - (newStart - initial.startOnTrack);
      }
    }

    const offset = newStart - initial.startOnTrack;
    if (initial.speedCurve?.length && offset < 0) {
      newStart = initial.startOnTrack;
      newDuration = initial.duration;
    }

    const finalOffset = newStart - initial.startOnTrack;
    if (finalOffset >= -1e-9) {
      return { patch: sliceClipByTimelineRange(initial, Math.max(0, finalOffset), initial.duration), snapLine };
    }

    const speed = Math.max(0.0001, Math.abs(initial.speed || 1));
    const reverse = initial.reverse === true || initial.speed < 0;
    result.startOnTrack = Math.max(0, newStart);
    result.duration = Math.max(0.2, newDuration);
    if (reverse) {
      result.sourceOut = sourceDuration === undefined
        ? initial.sourceOut - finalOffset * speed
        : Math.min(sourceDuration, initial.sourceOut - finalOffset * speed);
    } else {
      result.sourceIn = Math.max(0, initial.sourceIn + finalOffset * speed);
    }
  }

  return { patch: result, snapLine };
}

/**
 * 在 playhead 处把一个 clip 一分为二。
 */
export function splitClipAt(clip: Clip, playheadTime: number): [Clip, Clip] | null {
  return splitClipByTimelineTime(clip, playheadTime);
}

/** 从项目里删除一个 clip */
export function removeClip(project: Project, clipId: string): Project {
  return {
    ...project,
    clips: project.clips.filter((c) => c.id !== clipId),
  };
}

/** 单条轨道的布局信息（相对轨道容器顶部的像素位置），由调用方实测 DOM 得出 */
export type TrackLayoutEntry = {
  trackId: string;
  /** 该轨道顶部相对容器顶部的像素偏移 */
  top: number;
  /** 该轨道高度（不含 margin） */
  height: number;
};

/**
 * 根据鼠标相对轨道容器的 y 偏移，结合各轨道实测布局，判断当前悬停在哪个轨道。
 * 落在轨道之间的缝隙或容器范围外时返回 null。
 */
export function computeTrackAtY(relativeY: number, layout: TrackLayoutEntry[]): string | null {
  for (const entry of layout) {
    if (relativeY >= entry.top && relativeY < entry.top + entry.height) {
      return entry.trackId;
    }
  }
  return null;
}

/**
 * 判断一个已存在的 clip 是否可以移动到目标轨道（跨轨拖拽兼容性校验）。
 * 字幕/文字类 clip（无绑定素材）只能在字幕/文字轨间移动；其余按绑定素材类型匹配轨道类型。
 */
export function isClipTrackCompatible(clip: Clip, targetTrack: Track, media: MediaSource[]): boolean {
  if (targetTrack.kind === "subtitle" || targetTrack.kind === "text") {
    return clip.sourceId == null && typeof clip.text === "string";
  }
  if (clip.sourceId == null) return false;
  const source = media.find((m) => m.id === clip.sourceId);
  if (!source) return false;
  if (targetTrack.kind === "video") return source.kind === "video";
  if (targetTrack.kind === "image") return source.kind === "image";
  if (targetTrack.kind === "audio" || targetTrack.kind === "voiceover") return source.kind === "audio";
  return false;
}

/**
 * 松手时一次性判定跨轨是否生效：若最终区间与目标轨道现有 clip 重叠，则放弃跨轨，
 * 返回不含 trackId 的原 patch（留在原轨道，按同轨逻辑算出的位置生效）；否则补上 trackId。
 */
export function resolveCrossTrackDrop(
  finalPatch: Partial<Clip>,
  initial: Clip,
  targetTrackId: string,
  targetTrackClips: Clip[],
): Partial<Clip> {
  const start = finalPatch.startOnTrack ?? initial.startOnTrack;
  const duration = finalPatch.duration ?? initial.duration;
  const end = start + duration;
  const overlaps = targetTrackClips.some((peer) => {
    const peerStart = peer.startOnTrack;
    const peerEnd = peer.startOnTrack + peer.duration;
    return start < peerEnd - 0.01 && end > peerStart + 0.01;
  });
  if (overlaps) return finalPatch;
  return { ...finalPatch, trackId: targetTrackId };
}
