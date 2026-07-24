import type { Clip, MediaSource, Project } from "../types";
import { projectOutputDuration } from "../editor/projectDuration";
import { compileRenderGraph } from "../renderGraph/compileRenderGraph";
import { evaluateFrame } from "../renderGraph/evaluateFrame";
import { projectFrameToEngineState } from "../renderGraph/projectFrameToEngineState";
import type { EvaluatedFrame, RenderGraph } from "../renderGraph/types";
import { visualLayerCssStyle } from "../renderGraph/visualLayout";
import { MediaElementPool, type PooledMedia } from "./MediaElementPool";
import type { EngineState, PreviewRenderer } from "./PreviewRenderer";
import { previewCssFilter } from "./previewFilters";

/** 把 ClipCrop (0-100 百分比) 转为 CSS clip-path inset() 字符串。无裁剪返回空串。 */
function cropToClipPath(crop: Clip["crop"] | null | undefined): string {
  if (!crop) return "";
  const { x, y, width, height } = crop;
  // 默认值（全显示）时不应用 clip-path，避免无意义重绘
  if (x <= 0 && y <= 0 && width >= 100 && height >= 100) return "";
  const top = Math.max(0, y);
  const left = Math.max(0, x);
  const right = Math.max(0, 100 - x - width);
  const bottom = Math.max(0, 100 - y - height);
  return `inset(${top}% ${right}% ${bottom}% ${left}%)`;
}

/**
 * 实时预览引擎：按统一的 currentTime 时钟，同步调度
 *  - 视频轨：主 <video> 元素 + 一个预加载 <video>（提前加载下一个 clip）
 *  - 配音/音频轨：Web Audio API 预加载 AudioBuffer，精确调度
 *  - 字幕轨：通过回调通知当前应显示的字幕
 *
 * 切换 clip 时的黑屏缓解：主 video 切换 src 前若已预加载，可减少等待。
 */
export class PreviewEngine implements PreviewRenderer {
  private project: Project | null = null;
  private renderGraph: RenderGraph | null = null;
  private mediaPool: MediaElementPool;
  private videoEl: HTMLVideoElement | HTMLImageElement | null = null;
  private audioCtx: AudioContext | null = null;
  private audioBuffers = new Map<string, AudioBuffer>();
  private activeAudioSources = new Set<AudioBufferSourceNode>();
  /** T4.9: clipId → 活跃 GainNode，用于播放中实时改音量 */
  private clipGainNodes = new Map<string, GainNode>();
  /** 视频元素 → Web Audio 路由（让视频自带声音可控） */
  private videoSourceNode: MediaElementAudioSourceNode | null = null;
  private videoGainNode: GainNode | null = null;

  private playing = false;
  private currentTime = 0;
  private lastFrameAt = 0;
  /**
   * 音频硬件时钟锚点：{ctxTime, timelineTime} 记录"某个 AudioContext.currentTime 对应的时间线时间"。
   * RAF 的 performance.now() 增量累加与音频硬件采样时钟是两个独立时钟源，长时间播放会缓慢漂移
   * （字幕/画面越播越"飘"）。用这个锚点周期性把 RAF 累加时钟拉回音频硬件时钟，音频听感为准。
   */
  private audioClockAnchor: { ctxTime: number; timelineTime: number } | null = null;
  private lastPreloadAt = 0;
  private rafId: number | null = null;
  private alignmentInFlight = false;
  private pendingAlignmentForce = false;
  private preloadInFlight = false;

 private onTick: (state: EngineState) => void;
  private currentVideoClipId: string | null = null;
 private activeBaseClip: Clip | null = null;
  private lastPublishedVideoClip: Clip | null = null;
  private lastPublishedOverlayIds = "";
  private lastPublishedOverlayClips: Clip[] = [];
  private lastPublishedSubIds = "";
  private lastPublishedSubs: Clip[] = [];
  /** 活跃缓冲区变化时通知外部（FilterRenderer 需要更新读取的 video） */
  onActiveVideoChange: ((el: HTMLVideoElement | HTMLImageElement) => void) | null = null;

  /**
   * T4.1: 画中画叠加层 video 池。
   * key = overlay clip.id，value = 独立 <video> 元素（由引擎动态创建/销毁）。
   * 容器由 App.tsx 通过 overlayContainer 提供；引擎在内部增删 video 子节点。
   */
  private overlayContainer: HTMLElement | null = null;
  private overlayVideoPool = new Map<string, HTMLVideoElement | HTMLImageElement>();
  private overlayInactiveSince = new Map<string, number>();
  private overlayStyleSignatures = new Map<string, string>();
  private overlaySyncedClips = new Set<string>();

 constructor(stageContainer: HTMLElement, onTick: (state: EngineState) => void) {
   this.mediaPool = new MediaElementPool(stageContainer, () => this.ensureAudioContext(), 6);
   this.onTick = onTick;
 }

  /** T4.1: 设置画中画叠加层容器（引擎在里面动态管理 video 子节点） */
  setOverlayContainer(container: HTMLElement | null) {
    this.overlayContainer = container;
    // 容器变化时清空旧池
    this.clearOverlayPool();
  }

  get activeVideo(): HTMLVideoElement | HTMLImageElement | null {
    return this.videoEl;
  }

  setProject(project: Project | null) {
    const ratioChanged = this.project?.ratio !== project?.ratio;
    const prevId = this.project?.id;
    this.project = project;
    this.renderGraph = project ? compileRenderGraph(project) : null;
    if (ratioChanged || prevId !== project?.id) {
      this.pause();
      this.currentTime = 0;
    }
    this.lastPublishedVideoClip = null;
    this.lastPublishedOverlayIds = "";
    this.lastPublishedOverlayClips = [];
    this.lastPublishedSubIds = "";
    this.lastPublishedSubs = [];
    this.currentVideoClipId = null;
    this.applyVideoAlignment(true);
    void this.preloadLookahead();
    this.publish();
  }

  isPlaying() {
    return this.playing;
  }

  getCurrentTime() {
    return this.currentTime;
  }

  getDuration(): number {
    return this.renderGraph?.duration ?? projectOutputDuration(this.project);
  }

  private evaluatedFrame(): EvaluatedFrame | null {
    return this.renderGraph ? evaluateFrame(this.renderGraph, this.currentTime) : null;
  }

  play() {
    if (!this.project || this.playing) return;
    const duration = this.getDuration();
    if (this.currentTime >= duration - 0.05) {
      this.currentTime = 0;
    }
    this.playing = true;
    this.lastFrameAt = performance.now();
    // 同步创建并 resume AudioContext（用户手势上下文，避免异步链路丢失手势）
    if (!this.audioCtx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new Ctx();
    }
    if (this.audioCtx.state === "suspended") {
      void this.audioCtx.resume();
    }
    // 同步打锚点，避免 startAudioScheduling 的异步间隙里仍用 RAF 累加导致开局就漂
    this.captureAudioClockAnchor();
    this.startAudioScheduling();
    this.applyVideoAlignment(true);
    this.loop();
  }

  pause() {
    this.playing = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.stopAudioScheduling();
    if (this.videoEl instanceof HTMLVideoElement) {
      this.videoEl.pause();
    }
    this.publish();
  }

 seek(time: number) {
   const wasPlaying = this.playing;
   if (wasPlaying) {
     this.stopAudioScheduling();
   }
    this.currentTime = Math.max(0, Math.min(time, this.getDuration()));
    this.currentVideoClipId = null;
   // 同步 resume AudioContext（用户手势上下文）
   if (this.audioCtx && this.audioCtx.state === "suspended") {
     void this.audioCtx.resume();
   }
   this.applyVideoAlignment(true);
    void this.preloadLookahead();
    this.syncOverlays();
    if (wasPlaying) {
      this.captureAudioClockAnchor();
      this.startAudioScheduling();
      this.lastFrameAt = performance.now();
      this.loop();
    } else {
      this.publish();
    }
  }

  dispose() {
    this.pause();
    this.activeAudioSources.forEach((node) => {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
    });
    this.activeAudioSources.clear();
    this.audioBuffers.clear();
    this.mediaPool.dispose();
    this.clearOverlayPool();
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
    this.project = null;
  }

  /** T4.1: 清空画中画 video 池 */
  private clearOverlayPool() {
    this.overlayVideoPool.forEach((_, clipId) => this.releaseOverlayVideo(clipId));
    this.overlayVideoPool.clear();
    this.overlayInactiveSince.clear();
    this.overlayStyleSignatures.clear();
    this.overlaySyncedClips.clear();
  }

  private releaseOverlayVideo(clipId: string) {
    const v = this.overlayVideoPool.get(clipId);
    if (!v) return;
    if (v instanceof HTMLVideoElement) {
      try { v.pause(); } catch { /* ignore */ }
    }
    v.removeAttribute("src");
    if (v instanceof HTMLVideoElement) {
      try { v.load(); } catch { /* ignore */ }
    }
    v.remove();
    this.overlayVideoPool.delete(clipId);
    this.overlayInactiveSince.delete(clipId);
    this.overlayStyleSignatures.delete(clipId);
    this.overlaySyncedClips.delete(clipId);
  }

  private loop = () => {
    if (!this.playing) return;
    const now = performance.now();
    const delta = (now - this.lastFrameAt) / 1000;
    this.lastFrameAt = now;

    this.advanceClockFromMaster(delta);
    const duration = this.getDuration();
    if (this.currentTime >= duration) {
      this.currentTime = duration;
      this.pause();
      return;
    }

    this.applyVideoAlignment(false);
    if (now - this.lastPreloadAt > 500) {
      this.lastPreloadAt = now;
      void this.preloadLookahead();
    }
    this.syncOverlays();
    this.updateAudioGainsLive();
    this.publish();
    this.rafId = requestAnimationFrame(this.loop);
  };

  /** 记录 AudioContext ↔ 时间线的锚点，供 RAF 主时钟校正。 */
  private captureAudioClockAnchor() {
    if (!this.audioCtx || this.audioCtx.state === "closed") return;
    this.audioClockAnchor = {
      ctxTime: this.audioCtx.currentTime,
      timelineTime: this.currentTime,
    };
  }

  /**
   * 主时钟优先级：
   * 1) 运行中的 AudioContext（Web Audio 配音/BGM 与硬件采样率同源）
   * 2) 当前正在播的视频元素媒体时钟（无独立音轨、只听视频原声时）
   * 3) RAF performance.now() 增量（纯画面/时钟不可用时的兜底）
   */
  private advanceClockFromMaster(rafDelta: number) {
    if (this.audioClockAnchor && this.audioCtx?.state === "running") {
      this.currentTime =
        this.audioClockAnchor.timelineTime + (this.audioCtx.currentTime - this.audioClockAnchor.ctxTime);
      return;
    }
    const videoTimeline = this.readTimelineTimeFromActiveVideo();
    if (videoTimeline !== null) {
      this.currentTime = videoTimeline;
      return;
    }
    this.currentTime += rafDelta;
  }

  /** 从当前 base 视频元素反推时间线时间；仅在视频确实在播时可用。 */
  private readTimelineTimeFromActiveVideo(): number | null {
    if (!(this.videoEl instanceof HTMLVideoElement) || !this.activeBaseClip) return null;
    const video = this.videoEl;
    if (video.paused || video.readyState < 2) return null;
    const clip = this.activeBaseClip;
    const speed = Math.max(0.0001, Math.abs(clip.speed || 1));
    const timeline =
      clip.startOnTrack + (video.currentTime - clip.sourceIn) / speed;
    if (!Number.isFinite(timeline)) return null;
    // 防止异常 seek/元数据错误把时间线甩飞
    if (timeline < clip.startOnTrack - 0.25 || timeline > clip.startOnTrack + clip.duration + 0.25) {
      return null;
    }
    return timeline;
  }

  /** T4.9+: 播放中实时更新活跃音频 clip 的 gain（关键帧 + fadeIn/fadeOut） */
  private updateAudioGainsLive() {
    if (!this.project) return;
    const audioLayers = new Map((this.evaluatedFrame()?.audioLayers ?? []).map((layer) => [layer.id, layer]));
    for (const [clipId, gain] of this.clipGainNodes) {
      const layer = audioLayers.get(clipId);
      if (!layer) {
        gain.gain.value = 0;
        continue;
      }
      gain.gain.value = layer.gain;
    }
  }

 private applyVideoAlignment(force: boolean) {
   if (this.alignmentInFlight) {
     this.pendingAlignmentForce = this.pendingAlignmentForce || force;
     return;
   }
   this.alignmentInFlight = true;
   void this.applyVideoAlignmentAsync(force)
     .catch(() => { /* preview alignment is best-effort */ })
     .finally(() => {
       this.alignmentInFlight = false;
       if (this.pendingAlignmentForce) {
         const pendingForce = this.pendingAlignmentForce;
         this.pendingAlignmentForce = false;
         this.applyVideoAlignment(pendingForce);
       }
     });
 }

 private async applyVideoAlignmentAsync(force: boolean) {
   if (!this.project) return;
   const evaluated = this.evaluatedFrame()?.visualLayers[0] ?? null;
   const clip = evaluated?.clip ?? null;
   const media = evaluated?.media ?? null;
   const src = media ? this.resolveSrc(media) : null;

   if (!evaluated || !clip || !media || !src) {
     this.currentVideoClipId = null;
     this.activeBaseClip = null;
     for (const item of this.mediaPool.values()) {
       if (item.el.style.zIndex === "3") item.el.style.opacity = "0";
       if (item.kind === "video") {
         try { (item.el as HTMLVideoElement).pause(); } catch { /* ignore */ }
       }
       if (item.gain) item.gain.gain.value = 0;
     }
     return;
   }

   const kind = media.kind === "image" ? "image" : "video";
   const rel = evaluated.relativeTime;
   const rate = evaluated.speed;
   const targetSourceTime = evaluated.sourceTime;
   const previousClip = this.activeBaseClip;
   const sameMediaContinuous =
     previousClip &&
     previousClip.sourceId === clip.sourceId &&
     !clip.speedCurve?.length &&
     !previousClip.speedCurve?.length &&
     Math.abs(clip.sourceIn - previousClip.sourceOut) < 0.05 &&
     Math.abs(rate - Math.max(0.0001, Math.abs(previousClip.speed || 1))) < 0.01;

   const item = await this.mediaPool.acquire(media.id, src, kind);
   item.el.style.zIndex = "3";
   item.el.style.objectFit = evaluated.fit === "contain" ? "contain" : "cover";
   // base 层也读取 clip.transform（图片底层需要支持位置/缩放/旋转/不透明度）
   const layout = visualLayerCssStyle(evaluated);
   item.el.style.inset = "auto";
   item.el.style.left = layout.left;
   item.el.style.top = layout.top;
   item.el.style.width = layout.width;
   item.el.style.height = layout.height;
   item.el.style.transformOrigin = "center center";
   item.el.style.transform = layout.transform;
   // T4.x: 裁剪 + 入场/出场转场近似（fade 类）
   const cropPath = cropToClipPath(clip.crop);
   item.el.style.clipPath = cropPath || "";
   item.el.style.opacity = layout.opacity;
   item.el.style.filter = previewCssFilter(clip);
   // 主轨也应用蒙版（此前仅 overlay 路径有，导致 base 设蒙版预览无效）
   this.applyOverlayMask(item.el, clip.mask);

   if (kind === "video") {
     const video = item.el as HTMLVideoElement;
     const drift = video.currentTime - targetSourceTime;
     const absDrift = Math.abs(drift);
     // 硬 seek：切换素材/强制对齐/偏差过大时直接跳转
     const hardSeekThreshold = 0.18 + rate * 0.1;
     if (force || !sameMediaContinuous || absDrift > hardSeekThreshold) {
       video.playbackRate = rate;
       await this.mediaPool.seekTo(item, Math.min(Math.max(0, targetSourceTime), Math.max(0, (media.duration || 0) - 0.05)));
     } else if (this.playing && absDrift > 0.035) {
       // 软校正：视频略慢/略快时微调 playbackRate，避免 0.3s 容差内越漂越远
       // drift > 0 表示视频超前 → 略减速；drift < 0 表示落后 → 略加速
       const correction = Math.max(0.9, Math.min(1.1, 1 - drift * 0.8));
       video.playbackRate = Math.max(0.05, rate * correction);
     } else {
       video.playbackRate = rate;
     }
     if (item.gain) {
       const audioLayer = this.evaluatedFrame()?.audioLayers.find((layer) => layer.id === clip.id);
       item.gain.gain.value = audioLayer?.gain ?? 0;
       this.clipGainNodes.set(clip.id, item.gain);
     }
     if (this.playing && video.paused) void video.play().catch(() => {});
     if (!this.playing && !video.paused) video.pause();
   }

   this.videoEl = item.el;
   this.currentVideoClipId = clip.id;
   this.activeBaseClip = clip;
   this.onActiveVideoChange?.(item.el);

   for (const other of this.mediaPool.values()) {
     if (other.mediaId === item.mediaId) continue;
     if (other.el.style.zIndex !== "3") continue;
     other.el.style.opacity = "0";
     if (other.kind === "video") {
       try { (other.el as HTMLVideoElement).pause(); } catch { /* ignore */ }
     }
     if (other.gain) other.gain.gain.value = 0;
   }
 }

  private async preloadLookahead() {
    if (this.preloadInFlight) return;
    this.preloadInFlight = true;
    try {
    if (!this.project) return;
    const windowEnd = this.currentTime + 5;
    const mediaClips = this.project.clips
      .filter((clip) => {
        const track = this.project?.tracks.find((t) => t.id === clip.trackId);
        if (!track || (track.kind !== "video" && track.kind !== "image")) return false;
        if (track.hidden) return false;
        return clip.startOnTrack < windowEnd && clip.startOnTrack + clip.duration > this.currentTime;
      })
      .sort((a, b) => a.startOnTrack - b.startOnTrack);

    for (const clip of mediaClips) {
      const media = this.findMedia(clip.sourceId);
      const src = media ? this.resolveSrc(media) : null;
      if (!media || !src) continue;
      const kind = media.kind === "image" ? "image" : "video";
      const item = await this.mediaPool.acquire(media.id, src, kind);
      if (item.el !== this.videoEl) item.el.style.opacity = "0";
      if (kind === "video") {
        const evaluationTime = Math.max(this.currentTime, clip.startOnTrack);
        const target = this.renderGraph
          ? evaluateFrame(this.renderGraph, evaluationTime).visualLayers.find((layer) => layer.id === clip.id)?.sourceTime
          : undefined;
        if (!item.seeked || item.seekTarget === null) {
          await this.mediaPool.seekTo(item, Math.max(0, target ?? clip.sourceIn));
        }
      }
    }

    const next = mediaClips.find((clip) => clip.startOnTrack > this.currentTime && clip.startOnTrack - this.currentTime <= 0.3);
    if (!next) return;
    const media = this.findMedia(next.sourceId);
    const src = media ? this.resolveSrc(media) : null;
    if (!media || !src || media.kind === "image") return;
    const item = await this.mediaPool.acquire(media.id, src, "video");
    await this.mediaPool.seekTo(item, Math.max(0, next.sourceIn));
    if (item.gain) item.gain.gain.value = 0;
    const video = item.el as HTMLVideoElement;
    if (this.playing && video.paused) void video.play().catch(() => {});
    } finally {
      this.preloadInFlight = false;
    }
  }

  /**
   * T4.1: 同步画中画叠加层 —— 为每个活跃 overlay clip 分配/更新一个 <video>。
   * 池上限 3，超出的 clip 不渲染（剪映也有类似限制）。
   * 每个 overlay video 独立执行 seek 追赶 + transform 应用。
   */
  private syncOverlays() {
    if (!this.project) return;
    const overlays = this.evaluatedFrame()?.visualLayers.slice(1) ?? [];
    const activeIds = new Set(overlays.map((layer) => layer.id));
    const now = performance.now();

    // 1. 移除不再活跃的 overlay video
    for (const [clipId, v] of this.overlayVideoPool) {
      if (!activeIds.has(clipId)) {
        if (v instanceof HTMLVideoElement) {
          try { v.pause(); } catch { /* ignore */ }
        }
        v.style.display = "none";
        this.overlaySyncedClips.delete(clipId);
        if (!this.overlayInactiveSince.has(clipId)) {
          this.overlayInactiveSince.set(clipId, now);
        }
      }
    }

    // 2. 为活跃 clip 分配 video（上限 3）
    const MAX_OVERLAYS = 3;
    let allocated = 0;
    for (const evaluated of overlays) {
      if (allocated >= MAX_OVERLAYS) break;
      allocated++;
      const clip = evaluated.clip;
      const media = evaluated.media;
      const src = media ? this.resolveSrc(media) : null;
      if (!src) continue;

      let v = this.overlayVideoPool.get(clip.id);
      if (!v) {
        if (!this.overlayContainer) continue;
        v = media?.kind === "image" ? document.createElement("img") : document.createElement("video");
        v.className = "stage-overlay-video";
        v.crossOrigin = "anonymous";
        if (v instanceof HTMLVideoElement) {
          v.muted = true; // 叠加层不发声（音频由主混音管）
          v.playsInline = true;
        }
        v.style.position = "absolute";
        v.style.pointerEvents = "none";
        v.style.transformOrigin = "center center";
        this.overlayContainer.appendChild(v);
        this.overlayVideoPool.set(clip.id, v);
      }
      this.overlayInactiveSince.delete(clip.id);
      v.style.display = "block";

      // 设置 src（仅当变化时）
      if (!v.getAttribute("src") || !v.getAttribute("src")?.includes(src)) {
        v.src = src;
        if (v instanceof HTMLVideoElement) v.load();
      }

      // 应用 transform（位置/缩放/不透明度/混合模式）
      // T4.2: 有 keyframes 时按当前时间采样覆盖
      const tf = clip.transform;
      const layout = visualLayerCssStyle(evaluated);
      // T4.4: 蒙版（CSS clip-path / mask 近似）
      const m = clip.mask;
      const cssFilter = previewCssFilter(clip);
      // T4.x: 裁剪（crop）+ 入场/出场转场近似（fade 类）
      const cropPath = cropToClipPath(clip.crop);
      const objectFit = evaluated.fit === "contain" ? "contain" : "cover";
      const styleSignature = JSON.stringify({ layout, mix: tf?.mix ?? "", mask: m ?? null, cssFilter, cropPath, objectFit });
      if (this.overlayStyleSignatures.get(clip.id) !== styleSignature) {
        this.overlayStyleSignatures.set(clip.id, styleSignature);
        v.style.left = layout.left;
        v.style.top = layout.top;
        v.style.width = layout.width;
        v.style.height = layout.height;
        v.style.transform = layout.transform;
        v.style.opacity = layout.opacity;
        v.style.filter = cssFilter;
        v.style.clipPath = cropPath || "";
        v.style.objectFit = objectFit;
        if (tf?.mix) {
          (v.style.mixBlendMode as string) = tf.mix;
        } else {
          v.style.mixBlendMode = "";
        }
        this.applyOverlayMask(v, m);
      }

      // seek 追赶（同主 video 逻辑，rel 已在上面计算）
      const targetSourceTime = evaluated.sourceTime;
      const rate = evaluated.speed;
      if (v instanceof HTMLVideoElement) {
        v.playbackRate = rate;
        const drift = v.currentTime - targetSourceTime;
        const absDrift = Math.abs(drift);
        const hardSeekThreshold = 0.18 + rate * 0.1;
        if (absDrift > hardSeekThreshold) {
          v.playbackRate = rate;
          try {
            v.currentTime = Math.min(
              Math.max(0, targetSourceTime),
              Math.max(0, (media?.duration || 0) - 0.05),
            );
          } catch { /* metadata not ready */ }
        } else if (this.playing && absDrift > 0.035) {
          const correction = Math.max(0.9, Math.min(1.1, 1 - drift * 0.8));
          v.playbackRate = Math.max(0.05, rate * correction);
        } else {
          v.playbackRate = rate;
        }
        if (this.playing && v.paused) {
          void v.play().catch(() => {});
        }
        if (!this.playing && !v.paused) {
          v.pause();
        }
      }
    }

    this.sweepOverlayPool(now);
  }

  private applyOverlayMask(el: HTMLElement, mask: Clip["mask"]) {
    // 不清理 clipPath：crop 与 mask 可叠加（crop 用 clip-path，mask 用 mask-image）
    el.style.maskImage = "";
    el.style.webkitMaskImage = "";
    el.style.maskComposite = "";
    el.style.webkitMaskComposite = "";
    if (!mask) return;

    const feather = Math.max(0, Math.min(0.5, mask.feather ?? 0));
    const setMask = (value: string) => {
      el.style.maskImage = value;
      el.style.webkitMaskImage = value;
    };
    if (mask.kind === "circle") {
      const rx = Math.max(1, (mask.width / 2) * 100);
      const ry = Math.max(1, (mask.height / 2) * 100);
      const outer = 100;
      const inner = Math.max(0, 100 - feather * 100);
      const visible = mask.invert
        ? `transparent 0%, transparent ${inner}%, black ${outer}%`
        : `black 0%, black ${inner}%, transparent ${outer}%`;
      setMask(`radial-gradient(ellipse ${rx}% ${ry}% at ${mask.cx * 100}% ${mask.cy * 100}%, ${visible})`);
      return;
    }
    if (mask.kind === "rect") {
      const l = (mask.cx - mask.width / 2) * 100;
      const r = (mask.cx + mask.width / 2) * 100;
      const t = (mask.cy - mask.height / 2) * 100;
      const b = (mask.cy + mask.height / 2) * 100;
      const f = feather * 100;
      const color = mask.invert ? "transparent" : "black";
      const cut = mask.invert ? "black" : "transparent";
      const horizontal = `linear-gradient(90deg, ${cut} ${l - f}%, ${color} ${l}%, ${color} ${r}%, ${cut} ${r + f}%)`;
      const vertical = `linear-gradient(0deg, ${cut} ${t - f}%, ${color} ${t}%, ${color} ${b}%, ${cut} ${b + f}%)`;
      setMask(`${horizontal}, ${vertical}`);
      el.style.maskComposite = "intersect";
      el.style.webkitMaskComposite = "source-in";
      return;
    }
    if (mask.kind === "linear" || mask.kind === "mirror") {
      const angle = mask.rotation ?? (mask.kind === "mirror" ? 90 : 180);
      const f = Math.max(1, feather * 100);
      const gradient = mask.kind === "mirror"
        ? (mask.invert
            ? `linear-gradient(${angle}deg, black 0%, transparent ${50 - f}%, transparent ${50 + f}%, black 100%)`
            : `linear-gradient(${angle}deg, transparent 0%, black ${50 - f}%, black ${50 + f}%, transparent 100%)`)
        : (mask.invert
            ? `linear-gradient(${angle}deg, black 0%, transparent ${f}%, transparent 100%)`
            : `linear-gradient(${angle}deg, transparent 0%, black ${f}%, black 100%)`);
      setMask(gradient);
    }
  }

  private sweepOverlayPool(now: number) {
    const GRACE_MS = 10_000;
    const MAX_POOL = 8;
    for (const [clipId, inactiveAt] of [...this.overlayInactiveSince]) {
      if (now - inactiveAt >= GRACE_MS) {
        this.releaseOverlayVideo(clipId);
      }
    }
    while (this.overlayVideoPool.size > MAX_POOL && this.overlayInactiveSince.size > 0) {
      let oldestClipId: string | null = null;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [clipId, inactiveAt] of this.overlayInactiveSince) {
        if (inactiveAt < oldestAt) {
          oldestAt = inactiveAt;
          oldestClipId = clipId;
        }
      }
      if (!oldestClipId) break;
      this.releaseOverlayVideo(oldestClipId);
    }
  }

  private async ensureAudioContext(): Promise<AudioContext> {
    if (!this.audioCtx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new Ctx();
    }
    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  async preloadAudioBuffers(resolveSrc: (media: MediaSource) => string | null) {
    if (!this.project) return;
    const audioMedia = this.project.media.filter(
      (m) => m.kind === "audio" || this.isVoiceoverMedia(m),
    );
    if (audioMedia.length === 0) return;
    const ctx = await this.ensureAudioContext();
    let loadedNew = false;
    for (const media of audioMedia) {
      if (this.audioBuffers.has(media.id)) continue;
      const src = resolveSrc(media);
      if (!src) continue;
      try {
        const resp = await fetch(src);
        const buf = await resp.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(buf);
        this.audioBuffers.set(media.id, audioBuffer);
        loadedNew = true;
      } catch {
        /* 单个失败不阻塞 */
      }
    }
    // 播放中才加载完 buffer 时，补一次调度，否则整段配音会静音、主时钟也没有真实音频源可对齐
    if (loadedNew && this.playing) {
      this.stopAudioScheduling();
      this.captureAudioClockAnchor();
      this.startAudioScheduling();
    }
  }

  private isVoiceoverMedia(media: MediaSource) {
    return media.source === "tts" || media.kind === "audio";
  }

  private startAudioScheduling() {
    if (!this.project) return;
    void this.ensureAudioContext().then((ctx) => {
      if (!this.playing || !this.project) return;
      const now = ctx.currentTime;
      this.audioClockAnchor = { ctxTime: now, timelineTime: this.currentTime };
      const audioTrackIds = new Set(
        this.project.tracks.filter((t) => t.kind === "voiceover" || t.kind === "audio").map((t) => t.id),
      );
      for (const clip of this.project.clips) {
        if (!audioTrackIds.has(clip.trackId)) continue;
        const track = this.findTrack(clip.trackId);
        if (track?.muted || track?.hidden) continue;
        const media = this.findMedia(clip.sourceId);
        if (!media) continue;
        const buffer = this.audioBuffers.get(media.id);
        if (!buffer) continue;

        const clipEnd = clip.startOnTrack + clip.duration;
        if (clipEnd <= this.currentTime) continue;
        const offsetIntoClip = Math.max(0, this.currentTime - clip.startOnTrack);
        const evaluationTime = Math.max(this.currentTime, clip.startOnTrack);
        const evaluated = this.renderGraph
          ? evaluateFrame(this.renderGraph, evaluationTime).audioLayers.find((layer) => layer.id === clip.id)
          : undefined;
        if (!evaluated) continue;
        const sourceOffset = evaluated.sourceTime;
        const whenOffset = Math.max(0, clip.startOnTrack - this.currentTime);
        const remainingDuration = clip.duration - offsetIntoClip;

        const node = ctx.createBufferSource();
        node.buffer = buffer;
        // playbackRate 在 start 时固定；曲线变速取当前瞬时速度（完整动态曲线需分段 AudioBufferSource）
        node.playbackRate.value = evaluated.speed;
        const gain = ctx.createGain();
        const vol = evaluated.volume;
        // T4.9: fadeIn/fadeOut 用 linearRamp；有 volume 关键帧时按时间线采样分段 ramp
        const fadeIn = Math.max(0, clip.fadeIn ?? 0);
        const fadeOut = Math.max(0, clip.fadeOut ?? 0);
        const startAt = now + whenOffset;
        const endAt = startAt + remainingDuration;
        const volumeKfs = clip.keyframes?.volume;
        if (volumeKfs && volumeKfs.length > 0 && this.renderGraph) {
          // 每 50ms 采样一次 volume 关键帧（含 fade 乘子）
          const step = 0.05;
          let t = 0;
          while (t <= remainingDuration + 1e-6) {
            const timelineT = this.currentTime + whenOffset + t;
            const layer = evaluateFrame(this.renderGraph, timelineT).audioLayers.find((l) => l.id === clip.id);
            const g = layer?.gain ?? vol;
            if (t === 0) gain.gain.setValueAtTime(g, startAt);
            else gain.gain.linearRampToValueAtTime(g, startAt + t);
            t += step;
          }
        } else if (fadeIn > 0.001 && offsetIntoClip < fadeIn) {
          gain.gain.setValueAtTime(0, startAt);
          gain.gain.linearRampToValueAtTime(vol, startAt + fadeIn);
        } else {
          gain.gain.value = vol;
        }
        if ((!volumeKfs || volumeKfs.length === 0) && fadeOut > 0.001 && remainingDuration > fadeOut) {
          gain.gain.setValueAtTime(vol, endAt - fadeOut);
          gain.gain.linearRampToValueAtTime(0, endAt);
        }
        node.connect(gain).connect(ctx.destination);
        try {
          node.start(now + whenOffset, sourceOffset, remainingDuration);
          this.activeAudioSources.add(node);
          // T4.9: 记录 clipId→gain 映射，播放中可实时改音量
          this.clipGainNodes.set(clip.id, gain);
          node.onended = () => {
            this.activeAudioSources.delete(node);
            this.clipGainNodes.delete(clip.id);
          };
        } catch {
          /* scheduling error */
        }
      }
    });
  }

  private stopAudioScheduling() {
    this.activeAudioSources.forEach((node) => {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
    });
    this.activeAudioSources.clear();
    this.clipGainNodes.clear();
    this.audioClockAnchor = null;
  }

  /** T4.9: 播放中实时改某 clip 音量（找到活跃 GainNode 直接赋值） */
  setClipVolume(clipId: string, volume: number) {
    const gain = this.clipGainNodes.get(clipId);
    if (gain) {
      gain.gain.value = Math.min(2, Math.max(0, volume));
    }
  }

  private publish() {
    if (!this.project) {
      this.onTick({
        currentTime: this.currentTime,
        playing: this.playing,
        activeSubtitleClips: [],
        activeVideoClip: null,
        activeOverlayClips: [],
      });
      return;
    }
    const frame = this.evaluatedFrame();
    if (!frame) return;
    const projection = projectFrameToEngineState(frame);
    const sortedSubs = projection.activeSubtitleClips;
    // 引用比较：clip id 集合不变则复用旧数组，避免每帧触发 React 重渲染
    const subIds = sortedSubs.map((c) => c.id).join("|");
    const activeSubtitleClips = subIds === this.lastPublishedSubIds
      ? this.lastPublishedSubs
      : sortedSubs;
    if (subIds !== this.lastPublishedSubIds) {
      this.lastPublishedSubIds = subIds;
      this.lastPublishedSubs = sortedSubs;
    }
    // 所有活跃画面 clip（视频轨 + 图片轨，按 order 降序：底层在前）
    const baseClip = projection.activeVideoClip;
    const overlayCandidates = projection.activeOverlayClips;
    const overlayIds = overlayCandidates.map((clip) => clip.id).join("|");
    const overlayClips = overlayIds === this.lastPublishedOverlayIds
      ? this.lastPublishedOverlayClips
      : overlayCandidates;
    if (overlayIds !== this.lastPublishedOverlayIds) {
      this.lastPublishedOverlayIds = overlayIds;
      this.lastPublishedOverlayClips = overlayCandidates;
    }
    const activeVideoClip = baseClip?.id === this.lastPublishedVideoClip?.id ? this.lastPublishedVideoClip : baseClip;
    this.lastPublishedVideoClip = activeVideoClip;
    this.onTick({
      currentTime: this.currentTime,
      playing: this.playing,
      activeSubtitleClips,
      activeVideoClip,
      activeOverlayClips: overlayClips,
    });
  }

  private findTrack(trackId: string) {
    return this.project?.tracks.find((t) => t.id === trackId);
  }


  private findMedia(sourceId?: string | null): MediaSource | null {
    if (!this.project || !sourceId) return null;
    return this.project.media.find((m) => m.id === sourceId) || null;
  }

  private resolveSrc(media: MediaSource): string | null {
    if (media.kind === "video" && media.proxyPath) return this.resolveLocal(media.proxyPath);
    if (media.localPath) return this.resolveLocal(media.localPath);
    if (media.url) return media.url;
    return null;
  }

  resolveLocal: (localPath: string) => string = (p) => p;
}
