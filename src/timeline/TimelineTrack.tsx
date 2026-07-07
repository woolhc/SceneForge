import { ArrowDown, ArrowUp, Clock3, Image as ImageIcon, Lock, Mic2, MicOff, Unlock, Video } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import type { Clip, MediaSource, Track } from "../types";
import { desktopApi } from "../tauri";
import { usePlaybackStore } from "../store/playbackStore";
import {
  computeDraggedClip,
  pxToSeconds,
  type DragHandle,
  type DragState,
} from "./clipInteraction";

function TimelineTrackInner({
  track,
  clips,
  media,
  totalDuration,
  timelineWidth,
  selectedClipId,
  locked,
  onSelectClip,
  onClipDrag,
  onClipCommit,
  onDropAsset,
  onContextMenu,
  onToggleMute,
  onToggleLock,
  onMoveUp,
  onMoveDown,
}: {
  track: Track;
  clips: Clip[];
  media: MediaSource[];
  totalDuration: number;
  timelineWidth: number;
  pxPerSecond: number;
  selectedClipId: string | null;
  locked: boolean;
  onSelectClip: (id: string) => void;
  onClipDrag: (clipId: string, patch: Partial<Clip>, commit: boolean) => void;
  onClipCommit: (clipId: string) => void;
  onDropAsset: (trackId: string, assetId: string, startOnTrack: number) => void;
  onContextMenu: (clip: Clip, trackKind: string, x: number, y: number) => void;
  onToggleMute: (trackId: string) => void;
  onToggleLock: (trackId: string) => void;
  onMoveUp: (trackId: string) => void;
  onMoveDown: (trackId: string) => void;
}) {
  const dragRef = useRef<DragState | null>(null);
  const pxPerSecond = totalDuration > 0 ? timelineWidth / totalDuration : 1;
  const [dragOver, setDragOver] = useState(false);

  function startDrag(
    event: React.PointerEvent<HTMLDivElement>,
    clip: Clip,
    handle: DragHandle,
  ) {
    if (locked) return;
    event.stopPropagation();
    event.preventDefault();
    onSelectClip(clip.id);
    const peers = clips.filter((c) => c.id !== clip.id);
    dragRef.current = {
      clipId: clip.id,
      handle,
      startX: event.clientX,
      initial: {
        startOnTrack: clip.startOnTrack,
        duration: clip.duration,
        sourceIn: clip.sourceIn,
        sourceOut: clip.sourceOut,
        speed: clip.speed,
      },
      peers,
      // T2.2: playhead 从 store 按需读（拖拽时才用），避免每帧 prop 变化导致重渲染
      playhead: usePlaybackStore.getState().currentTime,
    };
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaSeconds = pxToSeconds(event.clientX - drag.startX, pxPerSecond);
    const clip = clips.find((c) => c.id === drag.clipId);
    if (!clip) return;
    const source = clip.sourceId ? media.find((m) => m.id === clip.sourceId) : null;
    const sourceDuration = source?.duration;
    const next = computeDraggedClip(drag, deltaSeconds, sourceDuration, pxPerSecond);
    // 存最后一次 patch，endDrag 时用它提交
    drag.lastPatch = next;
    onClipDrag(drag.clipId, next, false);
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    (event.currentTarget as HTMLDivElement).releasePointerCapture(event.pointerId);
    // 用最后一次 patch 提交（commit=true 触发持久化 + 撤销快照）
    if (drag.lastPatch) {
      onClipDrag(drag.clipId, drag.lastPatch, true);
    }
    dragRef.current = null;
  }

  /** 素材库拖拽放置：按轨道类型判断是否接受该素材 */
  function isAssetAcceptable(assetId: string): boolean {
    const asset = media.find((m) => m.id === assetId);
    if (!asset) return false;
    // 视频轨接受视频；图片轨接受图片；音频/配音轨接受音频；字幕轨不接受素材
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
      className={`track track-${track.kind} ${dragOver ? "drag-over" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <span className="track-label">
        {track.kind === "video" ? <Video size={15} /> : track.kind === "image" ? <ImageIcon size={15} /> : track.kind === "voiceover" ? <Mic2 size={15} /> : null}
        <span className="track-name">{track.name}</span>
        <button
          className={`track-ctrl ${track.muted ? "active" : ""}`}
          title={track.muted ? "取消静音" : "静音"}
          onClick={(e) => { e.stopPropagation(); onToggleMute(track.id); }}
        >
          {track.muted ? <MicOff size={12} /> : <Mic2 size={12} />}
        </button>
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
        const showHandles = true;
        return (
          <div
            key={clip.id}
            className={`clip ${track.kind} ${clip.id === selectedClipId ? "selected" : ""}`}
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
              onSelectClip(clip.id);
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
  const localPath = source.localPath || "";
  const cacheKey = `${localPath}|${sourceIn.toFixed(1)}-${sourceOut.toFixed(1)}|${count}`;
  const [frames, setFrames] = useState<string[] | null>(filmstripCache.get(cacheKey) ?? null);

  useEffect(() => {
    if (!localPath || frames) return;
    let cancelled = false;
    void desktopApi.generateFilmstrip(localPath, sourceIn, sourceOut, count).then((paths) => {
      if (cancelled || paths.length === 0) return;
      const urls = paths.map((p) => desktopApi.mediaSrc(p) ?? "").filter(Boolean);
      if (urls.length > 0) {
        filmstripCache.set(cacheKey, urls);
        setFrames(urls);
      }
    }).catch(() => { /* 静默失败，保持单张缩略图 */ });
    return () => { cancelled = true; };
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

// T2.2: memo 化，props 不变时不重渲染（播放头已从 store 读，不再触发）
export const TimelineTrack = React.memo(TimelineTrackInner);
