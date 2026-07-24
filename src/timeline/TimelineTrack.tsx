import { AlertTriangle, ArrowDown, ArrowUp, Clock3, Eye, EyeOff, Image as ImageIcon, Lock, Mic2, MicOff, SlidersHorizontal, Trash2, Type, Unlock, Video } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import type { Clip, ClipKeyframes, Keyframe, MediaSource, Track } from "../types";
import { desktopApi } from "../tauri";
import { usePlaybackStore } from "../store/playbackStore";
import { hasExceededPointerDragThreshold, type DragHandle } from "./clipInteraction";

function TimelineTrackInner({
  track,
  clips,
  media,
  totalDuration,
  timelineWidth,
  selectedClipId,
  selectedClipIds,
  locked,
  isDragBlocked,
  onSelectClip,
  onDragStart,
  onDragMove,
  onDragEnd,
  onBoxSelect,
  onDropAsset,
  onContextMenu,
  onToggleMute,
  onToggleLock,
  onToggleHidden,
  onMoveUp,
  onMoveDown,
  onDeleteTrack,
  onKeyframeClick,
  onKeyframeDrag,
  onEditSubtitleStyle,
}: {
  track: Track;
  clips: Clip[];
  media: MediaSource[];
  totalDuration: number;
  timelineWidth: number;
  pxPerSecond: number;
  selectedClipId: string | null;
  selectedClipIds?: string[];
  locked: boolean;
  /** 当前轨道是否是跨轨拖拽悬停中但不兼容的目标（视觉标红） */
  isDragBlocked?: boolean;
  onSelectClip: (id: string, additive: boolean, range?: boolean) => void;
  onDragStart: (clip: Clip, handle: DragHandle, clientX: number, clientY: number, trackId: string) => void;
  onDragMove: (clientX: number, clientY: number) => void;
  onDragEnd: () => void;
  onBoxSelect: (ids: string[], additive: boolean) => void;
  onDropAsset: (trackId: string, assetId: string, startOnTrack: number) => void;
  onContextMenu: (clip: Clip, trackKind: string, x: number, y: number) => void;
  onToggleMute: (trackId: string) => void;
  onToggleLock: (trackId: string) => void;
  onToggleHidden?: (trackId: string) => void;
  onMoveUp: (trackId: string) => void;
  onMoveDown: (trackId: string) => void;
  onDeleteTrack?: (trackId: string) => void;
  onKeyframeClick?: (clipId: string, prop: keyof ClipKeyframes, time: number) => void;
  onKeyframeDrag?: (clipId: string, prop: keyof ClipKeyframes, kfIndex: number, newTime: number, commit: boolean) => void;
  onEditSubtitleStyle?: (trackId: string) => void;
}) {
  const boxRef = useRef<{
    pointerId: number;
    startX: number;
    currentX: number;
    additive: boolean;
    activated: boolean;
  } | null>(null);
  const keyframeDragRef = useRef<{
    clipId: string;
    prop: keyof ClipKeyframes;
    kfIndex: number;
    startX: number;
    initialTime: number;
    clipDuration: number;
    activated: boolean;
  } | null>(null);
  const pxPerSecond = totalDuration > 0 ? timelineWidth / totalDuration : 1;
  const [dragOver, setDragOver] = useState(false);
  const [boxSelection, setBoxSelection] = useState<{ left: number; width: number } | null>(null);

  /**
   * 拖拽状态本身提升到 App.tsx（跨轨拖拽必须知道全部轨道布局，单轨组件做不到）。
   * 这里只做 pointer capture 管理和坐标转发，不再持有 DragState / 调用 computeDraggedClip。
   */
  function startDrag(
    event: React.PointerEvent<HTMLDivElement>,
    clip: Clip,
    handle: DragHandle,
  ) {
    if (locked) return;
    event.stopPropagation();
    event.preventDefault();
    onSelectClip(clip.id, event.metaKey || event.ctrlKey, event.shiftKey);
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
    onDragStart(clip, handle, event.clientX, event.clientY, track.id);
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    onDragMove(event.clientX, event.clientY);
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.currentTarget as HTMLDivElement).hasPointerCapture(event.pointerId)) {
      (event.currentTarget as HTMLDivElement).releasePointerCapture(event.pointerId);
    }
    onDragEnd();
  }

  function timeFromClientX(clientX: number, element: HTMLDivElement): number {
    const rect = element.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * totalDuration;
  }

  function startBoxSelect(event: React.PointerEvent<HTMLDivElement>) {
    if (locked || event.button !== 0 || event.target !== event.currentTarget) return;
    event.preventDefault();
    event.stopPropagation();
    boxRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      currentX: event.clientX,
      additive: event.metaKey || event.ctrlKey || event.shiftKey,
      activated: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveBoxSelect(event: React.PointerEvent<HTMLDivElement>) {
    const box = boxRef.current;
    if (!box || box.pointerId !== event.pointerId) return;
    if (!box.activated) {
      if (!hasExceededPointerDragThreshold(box.startX, event.clientX)) return;
      box.activated = true;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    box.currentX = event.clientX;
    const x0 = Math.max(0, Math.min(box.startX - rect.left, rect.width));
    const x1 = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    setBoxSelection({
      left: Math.min(x0, x1),
      width: Math.abs(x1 - x0),
    });
  }

  function endBoxSelect(event: React.PointerEvent<HTMLDivElement>) {
    const box = boxRef.current;
    if (!box || box.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (box.activated) {
      const start = timeFromClientX(Math.min(box.startX, box.currentX), event.currentTarget);
      const end = timeFromClientX(Math.max(box.startX, box.currentX), event.currentTarget);
      const ids = clips
        .filter((clip) => clip.startOnTrack < end && clip.startOnTrack + clip.duration > start)
        .map((clip) => clip.id);
      onBoxSelect(ids, box.additive);
    } else {
      onBoxSelect([], box.additive);
    }
    boxRef.current = null;
    setBoxSelection(null);
  }

  /** 素材库拖拽放置：按轨道类型判断是否接受该素材 */
  function isAssetAcceptable(assetId: string): boolean {
    const asset = media.find((m) => m.id === assetId);
    if (!asset) return false;
    // 视频轨接受视频；图片轨接受图片；音频/配音轨接受音频；字幕轨/文字轨不接受素材
    if (track.kind === "video") return asset.kind === "video";
    if (track.kind === "image") return asset.kind === "image";
    if (track.kind === "audio" || track.kind === "voiceover") return asset.kind === "audio";
    return false;
  }

  /** 根据光标 x 计算在该轨道上的起始时间(秒) */
  function timeFromEvent(event: React.DragEvent<HTMLDivElement>): number {
    const el = event.currentTarget;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    return ratio * totalDuration;
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    // dragover 时拿不到 dataTransfer 数据（浏览器限制），统一允许并高亮，drop 时再校验
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!dragOver) setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    setDragOver(false);
    event.preventDefault();
    event.stopPropagation();
    const assetId = event.dataTransfer.getData("text/plain");
    if (!assetId || !isAssetAcceptable(assetId)) return;
    const startOnTrack = timeFromEvent(event);
    onDropAsset(track.id, assetId, startOnTrack);
  }

  return (
    <div
      className={`track track-${track.kind} ${dragOver ? "drag-over" : ""} ${track.hidden ? "track-hidden" : ""} ${isDragBlocked ? "track-drag-blocked" : ""}`}
      data-track-id={track.id}
      style={{ height: track.height && track.height > 0 ? `${track.height}px` : undefined }}
      onPointerDown={startBoxSelect}
      onPointerMove={moveBoxSelect}
      onPointerUp={endBoxSelect}
      onPointerCancel={endBoxSelect}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {boxSelection && <div className="track-selection-box" style={{ left: boxSelection.left, width: boxSelection.width }} />}
      <span className="track-label">
        {track.kind === "video" ? <Video size={15} /> : track.kind === "image" ? <ImageIcon size={15} /> : track.kind === "voiceover" ? <Mic2 size={15} /> : track.kind === "text" ? <Type size={15} /> : null}
        <span className="track-name">{track.name}</span>
        <button
          className={`track-ctrl ${track.muted ? "active" : ""}`}
          title={track.muted ? "取消静音" : "静音"}
          onClick={(e) => { e.stopPropagation(); onToggleMute(track.id); }}
        >
          {track.muted ? <MicOff size={12} /> : <Mic2 size={12} />}
        </button>
        {onEditSubtitleStyle && (track.kind === "subtitle" || track.kind === "text") && (
          <button
            className="track-ctrl"
            title="统一调整本轨字幕样式"
            onClick={(e) => { e.stopPropagation(); onEditSubtitleStyle(track.id); }}
          >
            <SlidersHorizontal size={12} />
          </button>
        )}
        {onToggleHidden && (
          <button
            className={`track-ctrl ${track.hidden ? "active" : ""}`}
            title={track.hidden ? "显示轨道" : "隐藏轨道"}
            onClick={(e) => { e.stopPropagation(); onToggleHidden(track.id); }}
          >
            {track.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        )}
        <button
          className={`track-ctrl ${track.locked ? "active" : ""}`}
          title={track.locked ? "解锁" : "锁定"}
          onClick={(e) => { e.stopPropagation(); onToggleLock(track.id); }}
        >
          {track.locked ? <Lock size={12} /> : <Unlock size={12} />}
        </button>
        <button
          className="track-ctrl"
          title="上移图层"
          onClick={(e) => { e.stopPropagation(); onMoveUp(track.id); }}
        >
          <ArrowUp size={12} />
        </button>
        <button
          className="track-ctrl"
          title="下移图层"
          onClick={(e) => { e.stopPropagation(); onMoveDown(track.id); }}
        >
          <ArrowDown size={12} />
        </button>
        {onDeleteTrack && (
          <button
            className="track-ctrl danger"
            title="删除轨道"
            onClick={(e) => {
              e.stopPropagation();
              if (clips.length > 0) {
                if (!confirm(`该轨道有 ${clips.length} 个片段，删除轨道会一并删除，确认？`)) return;
              }
              onDeleteTrack(track.id);
            }}
          >
            <Trash2 size={12} />
          </button>
        )}
      </span>
      {clips.map((clip) => {
        const leftPct = totalDuration > 0 ? (clip.startOnTrack / totalDuration) * 100 : 0;
        const widthPct = totalDuration > 0 ? (clip.duration / totalDuration) * 100 : 0;
        const source = clip.sourceId ? media.find((m) => m.id === clip.sourceId) : null;
        // 视频/图片 clip 显示缩略图背景
        const thumbUrl = source ? desktopApi.mediaSrc(source.thumbnailUrl || source.localPath || null) : null;
        const clipWidthPx = (widthPct / 100) * timelineWidth;
        const isVideoKind = track.kind === "video" || track.kind === "image";
        const showFilmstrip = isVideoKind && source && source.kind === "video" && clipWidthPx > 60;
        const isUnbound = isVideoKind && !clip.sourceId;
        const showHandles = true;
        const markers = keyframeMarkers(clip);
        return (
          <div
            key={clip.id}
            className={`clip ${track.kind} ${clip.id === selectedClipId ? "selected" : ""} ${selectedClipIds?.includes(clip.id) ? "multi-selected" : ""} ${isUnbound ? "clip-unbound" : ""}`}
            style={{
              left: `${leftPct}%`,
              width: `${widthPct}%`,
              backgroundImage: (!showFilmstrip && thumbUrl) ? `url(${thumbUrl})` : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
            onPointerDown={(e) => startDrag(e, clip, "body")}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSelectClip(clip.id, e.metaKey || e.ctrlKey, e.shiftKey);
              onContextMenu(clip, track.kind, e.clientX, e.clientY);
            }}
          >
            {showFilmstrip && source && (
              <Filmstrip
                source={source}
                clipWidthPx={clipWidthPx}
                sourceIn={clip.sourceIn}
                sourceOut={clip.sourceOut}
                fallbackThumb={thumbUrl}
              />
            )}
            <span className="clip-label" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.9)", position: "relative", zIndex: 2 }}>
              {isUnbound && <AlertTriangle size={12} className="clip-unbound-icon" />}
              {track.kind === "video" || track.kind === "image"
                ? source?.title || "未绑素材"
                : clip.text || track.name}
            </span>
            <small>
              <Clock3 size={12} />
              {clip.duration.toFixed(1)}s
              {Math.abs(clip.speed - 1) > 0.01 && (
                <em className="speed-badge">{clip.speed}x</em>
              )}
            </small>
            {markers.map((m, index) => (
              <span
                key={`${m.prop}-${m.kfIndex}-${index}`}
                className="clip-keyframe-marker"
                style={{ left: `${m.left}%` }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  (e.currentTarget as HTMLSpanElement).setPointerCapture(e.pointerId);
                  keyframeDragRef.current = {
                    clipId: clip.id,
                    prop: m.prop,
                    kfIndex: m.kfIndex,
                    startX: e.clientX,
                    initialTime: m.time,
                    clipDuration: clip.duration,
                    activated: false,
                  };
                }}
                onPointerMove={(e) => {
                  const drag = keyframeDragRef.current;
                  if (!drag || drag.clipId !== clip.id || drag.prop !== m.prop || drag.kfIndex !== m.kfIndex) return;
                  if (!drag.activated) {
                    if (!hasExceededPointerDragThreshold(drag.startX, e.clientX)) return;
                    drag.activated = true;
                  }
                  const deltaPx = e.clientX - drag.startX;
                  const deltaTime = pxPerSecond > 0 ? deltaPx / pxPerSecond : 0;
                  const newTime = Math.max(0, Math.min(drag.clipDuration, drag.initialTime + deltaTime));
                  onKeyframeDrag?.(drag.clipId, drag.prop, drag.kfIndex, newTime, false);
                }}
                onPointerUp={(e) => {
                  const drag = keyframeDragRef.current;
                  if ((e.currentTarget as HTMLSpanElement).hasPointerCapture(e.pointerId)) {
                    (e.currentTarget as HTMLSpanElement).releasePointerCapture(e.pointerId);
                  }
                  keyframeDragRef.current = null;
                  if (!drag || drag.clipId !== clip.id || drag.prop !== m.prop || drag.kfIndex !== m.kfIndex) return;
                  if (drag.activated) {
                    const deltaPx = e.clientX - drag.startX;
                    const deltaTime = pxPerSecond > 0 ? deltaPx / pxPerSecond : 0;
                    const newTime = Math.max(0, Math.min(drag.clipDuration, drag.initialTime + deltaTime));
                    onKeyframeDrag?.(drag.clipId, drag.prop, drag.kfIndex, newTime, true);
                  } else {
                    onKeyframeClick?.(clip.id, m.prop, m.time);
                  }
                }}
                onPointerCancel={() => {
                  keyframeDragRef.current = null;
                }}
                title={`${KEYFRAME_PROP_LABELS[m.prop]} @ ${m.time.toFixed(2)}s`}
              />
            ))}
            {/* 音频/配音轨显示波形 */}
            {(track.kind === "audio" || track.kind === "voiceover") && source?.localPath && (
              <WaveformCanvas
                audioPath={source.localPath}
                duration={clip.duration}
                pxPerSecond={pxPerSecond}
              />
            )}
            {showHandles && !locked && (
              <>
                <div
                  className="clip-handle clip-handle-left"
                  onPointerDown={(e) => startDrag(e, clip, "left")}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
                <div
                  className="clip-handle clip-handle-right"
                  onPointerDown={(e) => startDrag(e, clip, "right")}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 音频波形 canvas 组件：从 Rust 获取峰值数据 → canvas 绘制 min/max 柱状图 */
function WaveformCanvas({
  audioPath,
  duration,
  pxPerSecond,
}: {
  audioPath: string;
  duration: number;
  pxPerSecond: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [peaks, setPeaks] = useState<[number, number][] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void desktopApi.generateWaveform(audioPath).then((data) => {
      if (!cancelled && data && data.length > 0) setPeaks(data);
    });
    return () => { cancelled = true; };
  }, [audioPath]);

  // canvas 宽度 = clip 实际像素宽度（pxPerSecond * duration）
  const canvasWidth = Math.max(60, Math.round(pxPerSecond * duration));
  const canvasHeight = 28;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const mid = h / 2;
    const amp = mid * 0.85;

    // 如果峰值数量 > canvas 宽度，每像素合并多个峰值
    // 如果峰值数量 < canvas 宽度，每峰值占多个像素
    const peaksPerPixel = peaks.length / w;

    ctx.fillStyle = "rgba(243, 201, 105, 0.7)";

    for (let x = 0; x < w; x++) {
      const startIdx = Math.floor(x * peaksPerPixel);
      const endIdx = Math.min(peaks.length, Math.ceil((x + 1) * peaksPerPixel));
      if (startIdx >= endIdx) continue;

      // 合并该像素范围内的所有峰值
      let min = 1.0;
      let max = -1.0;
      for (let j = startIdx; j < endIdx; j++) {
        if (peaks[j][0] < min) min = peaks[j][0];
        if (peaks[j][1] > max) max = peaks[j][1];
      }
      const yMin = mid + min * amp;
      const yMax = mid + max * amp;
      ctx.fillRect(x, yMin, 1, Math.max(0.5, yMax - yMin));
    }

    // 中线
    ctx.strokeStyle = "rgba(243, 201, 105, 0.2)";
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();
  }, [peaks, canvasWidth]);

  if (!peaks) return null;

  return (
    <div ref={containerRef} className="clip-waveform-container" style={{ width: `${canvasWidth}px` }}>
      <canvas
        ref={canvasRef}
        className="clip-waveform"
        width={canvasWidth}
        height={canvasHeight}
      />
    </div>
  );
}

/**
 * T4.7: 视频胶片条缩略图。
 * 异步加载均匀分布的多帧，平铺显示（先回退单张缩略图，加载完替换）。
 * 模块级缓存避免重复 IPC（key 为 sourcePath + 时间区间）。
 */
const filmstripCache = new Map<string, string[]>();
function Filmstrip({
  source,
  clipWidthPx,
  sourceIn,
  sourceOut,
  fallbackThumb,
}: {
  source: MediaSource;
  clipWidthPx: number;
  sourceIn: number;
  sourceOut: number;
  fallbackThumb: string | null;
}) {
  // 按像素宽度决定取几帧（每帧约 80px）
  const count = Math.max(2, Math.min(8, Math.ceil(clipWidthPx / 80)));
  const localPath = source.proxyPath || source.localPath || "";
  const cacheKey = `${localPath}|${sourceIn.toFixed(1)}-${sourceOut.toFixed(1)}|${count}`;
  const cachedFrames = filmstripCache.get(cacheKey) ?? null;
  const [frameState, setFrameState] = useState<{ key: string; frames: string[] } | null>(
    cachedFrames ? { key: cacheKey, frames: cachedFrames } : null,
  );
  const frames = frameState?.key === cacheKey ? frameState.frames : null;

  useEffect(() => {
    if (!localPath) {
      setFrameState(null);
      return;
    }
    if (frameState?.key === cacheKey) return;
    const cached = filmstripCache.get(cacheKey);
    if (cached) {
      setFrameState({ key: cacheKey, frames: cached });
      return;
    }
    setFrameState(null);
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void desktopApi.generateFilmstrip(localPath, sourceIn, sourceOut, count).then((paths) => {
        if (cancelled || paths.length === 0) return;
        const urls = paths.map((p) => desktopApi.mediaSrc(p) ?? "").filter(Boolean);
        if (urls.length > 0) {
          filmstripCache.set(cacheKey, urls);
          setFrameState({ key: cacheKey, frames: urls });
        }
      }).catch(() => { /* 静默失败，保持单张缩略图 */ });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  if (frames && frames.length > 0) {
    return (
      <div className="clip-filmstrip">
        {frames.map((url, i) => (
          <div
            key={i}
            className="clip-filmstrip-frame"
            style={{ backgroundImage: `url(${url})`, flex: 1 }}
          />
        ))}
      </div>
    );
  }
  // 回退：单张缩略图
  return (
    <div
      className="clip-thumb-fallback"
      style={{
        backgroundImage: fallbackThumb ? `url(${fallbackThumb})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
        position: "absolute",
        inset: 0,
      }}
    />
  );
}

type KeyframeMarkerInfo = {
  left: number;
  prop: keyof ClipKeyframes;
  time: number;
  kfIndex: number;
};

const KEYFRAME_PROP_LABELS: Record<keyof ClipKeyframes, string> = {
  x: "X 位置",
  y: "Y 位置",
  scale: "缩放",
  opacity: "不透明度",
  rotation: "旋转",
  volume: "音量",
};

function keyframeMarkers(clip: Clip): KeyframeMarkerInfo[] {
  const keyframes = clip.keyframes;
  if (!keyframes) return [];
  const out: KeyframeMarkerInfo[] = [];
  (Object.keys(keyframes) as (keyof ClipKeyframes)[]).forEach((prop) => {
    const frames: Keyframe[] | undefined = keyframes[prop];
    if (!frames) return;
    frames.forEach((frame, kfIndex) => {
      out.push({
        left: Math.max(0, Math.min(100, (frame.time / Math.max(clip.duration, 0.001)) * 100)),
        prop,
        time: frame.time,
        kfIndex,
      });
    });
  });
  return out;
}

// T2.2: memo 化，props 不变时不重渲染（播放头已从 store 读，不再触发）
export const TimelineTrack = React.memo(TimelineTrackInner);
