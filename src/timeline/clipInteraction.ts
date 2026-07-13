import type { Clip, Project } from "../types";
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
  /** 拖拽开始时同轨道其他 clip（用于吸附参考） */
  peers: Clip[];
  /** 当前播放头位置（用于吸附） */
  playhead?: number;
  /** 是否已经超过防误触像素阈值并正式进入拖拽。 */
  activated?: boolean;
  /** 拖拽过程中最后一次计算的 patch（endDrag 时用它 commit=true） */
  lastPatch?: Partial<Clip>;
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

/**
 * 尝试吸附到一个参考点列表。返回吸附后的值或原值。
 * pxPerSecond 用于把像素阈值换算成秒阈值（缩放级别相关）。
 */
function snap(value: number, snapPoints: number[], pxPerSecond: number = 64): number {
  const thresholdSec = SNAP_THRESHOLD_PX / pxPerSecond;
  for (const sp of snapPoints) {
    if (Math.abs(value - sp) < thresholdSec) return sp;
  }
  return value;
}

/**
 * 计算拖拽后的 clip 新值。
 * 增强：碰撞检测（不与同轨 clip 重叠）+ 双端吸附（start/end/playhead）。
 */
export function computeDraggedClip(
  drag: DragState,
  deltaSeconds: number,
  sourceDuration?: number,
  pxPerSecond: number = 64,
): Partial<Clip> {
  const { initial, handle, peers, playhead } = drag;
  const result = {
    startOnTrack: initial.startOnTrack,
    duration: initial.duration,
    sourceIn: initial.sourceIn,
    sourceOut: initial.sourceOut,
  };

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
    newStart = snap(newStart, snapPoints, pxPerSecond);
    // 吸附：end 吸附到 peer 边缘/playhead
    const snappedEnd = snap(newEnd, snapPoints, pxPerSecond);
    if (snappedEnd !== newEnd) {
      newStart = snappedEnd - initial.duration;
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
    const snappedEnd = snap(newEnd, snapPoints, pxPerSecond);
    if (snappedEnd !== newEnd) {
      newDuration = Math.max(0.2, snappedEnd - initial.startOnTrack);
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
      return sliceClipByTimelineRange(initial, 0, newDuration);
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
    newStart = snap(newStart, snapPoints, pxPerSecond);
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
      return sliceClipByTimelineRange(initial, Math.max(0, finalOffset), initial.duration);
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

  return result;
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
