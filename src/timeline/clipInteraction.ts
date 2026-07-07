import type { Clip, Project } from "../types";

/** 拖拽手柄类型 */
export type DragHandle = "body" | "left" | "right";

export type DragState = {
  clipId: string;
  handle: DragHandle;
  /** 拖拽起点 pointer x */
  startX: number;
  /** 拖拽开始时 clip 的快照 */
  initial: {
    startOnTrack: number;
    duration: number;
    sourceIn: number;
    sourceOut: number;
    speed: number;
  };
  /** 拖拽开始时同轨道其他 clip（用于吸附参考） */
  peers: Clip[];
  /** 当前播放头位置（用于吸附） */
  playhead?: number;
  /** 拖拽过程中最后一次计算的 patch（endDrag 时用它 commit=true） */
  lastPatch?: Partial<Clip>;
};

/** 像素 → 秒换算 */
export function pxToSeconds(deltaPx: number, pxPerSecond: number) {
  return deltaPx / pxPerSecond;
}

/** 吸附阈值（秒） */
const SNAP_THRESHOLD = 0.3;

/**
 * 尝试吸附到一个参考点列表。返回吸附后的值或原值。
 */
function snap(value: number, snapPoints: number[]): number {
  for (const sp of snapPoints) {
    if (Math.abs(value - sp) < SNAP_THRESHOLD) return sp;
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
): Pick<Clip, "startOnTrack" | "duration" | "sourceIn" | "sourceOut"> {
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
    newStart = snap(newStart, snapPoints);
    // 吸附：end 吸附到 peer 边缘/playhead
    const snappedEnd = snap(newEnd, snapPoints);
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
    const snappedEnd = snap(newEnd, snapPoints);
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

    // 受源媒体时长限制（源区间 = 时间线时长 × speed）
    const speed = initial.speed || 1;
    if (sourceDuration !== undefined) {
      const maxBySource = (sourceDuration - initial.sourceIn) / speed;
      if (newDuration > maxBySource) newDuration = Math.max(0.2, maxBySource);
    }
    result.duration = newDuration;
    // sourceOut 必须乘 speed：时间线缩短 1s → 源区间变化 speed 秒
    result.sourceOut = initial.sourceIn + newDuration * speed;
  } else {
    // 左边缘
    let deltaStart = deltaSeconds;
    if (initial.sourceIn + deltaStart < 0) deltaStart = -initial.sourceIn;
    if (initial.startOnTrack + deltaStart < 0) deltaStart = -initial.startOnTrack;

    let newStart = Math.max(0, initial.startOnTrack + deltaStart);
    let newDuration = Math.max(0.2, initial.duration - deltaStart);

    // 吸附：左边缘吸附
    newStart = snap(newStart, snapPoints);
    newDuration = initial.duration - (newStart - initial.startOnTrack);

    // 碰撞：不能覆盖前一个 clip
    for (const peer of peers) {
      if (newStart < peer.startOnTrack + peer.duration - 0.01 &&
          newStart + newDuration > peer.startOnTrack + 0.01) {
        newStart = peer.startOnTrack + peer.duration;
        newDuration = initial.duration - (newStart - initial.startOnTrack);
      }
    }

    // 左手柄 trim：时间线 delta → 源区间 delta × speed
    const speed = initial.speed || 1;
    result.sourceIn = initial.sourceIn + (newStart - initial.startOnTrack) * speed;
    result.startOnTrack = Math.max(0, newStart);
    result.duration = Math.max(0.2, newDuration);
    result.sourceOut = result.sourceIn + result.duration * speed;
  }

  return result;
}

/**
 * 在 playhead 处把一个 clip 一分为二。
 */
export function splitClipAt(clip: Clip, playheadTime: number): [Clip, Clip] | null {
  const rel = playheadTime - clip.startOnTrack;
  if (rel <= 0.1 || rel >= clip.duration - 0.1) return null;
  const firstDuration = rel;
  const secondDuration = clip.duration - rel;
  const splitSourcePoint = clip.sourceIn + firstDuration * clip.speed;
  const secondId = `clip_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  return [
    { ...clip, duration: firstDuration, sourceOut: splitSourcePoint },
    {
      ...clip,
      id: secondId,
      startOnTrack: clip.startOnTrack + firstDuration,
      duration: secondDuration,
      sourceIn: splitSourcePoint,
    },
  ];
}

/** 从项目里删除一个 clip */
export function removeClip(project: Project, clipId: string): Project {
  return {
    ...project,
    clips: project.clips.filter((c) => c.id !== clipId),
  };
}
