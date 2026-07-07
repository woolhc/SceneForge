import type { Clip, MediaSource, Project, TrackKind } from "../types";
import { sampleAllKeyframes } from "../editor/keyframes";

/** T4.3: 曲线变速的有效速度（v1 用曲线平均速度） */
function effectiveSpeed(clip: Clip): number {
  if (clip.speedCurve && clip.speedCurve.length > 0) {
    const avg = clip.speedCurve.reduce((s, p) => s + Math.abs(p.speed), 0) / clip.speedCurve.length;
    return Math.min(16, Math.max(0.0625, avg));
  }
  return Math.min(4, Math.max(0.25, Math.abs(clip.speed)));
}

/**
 * 实时预览引擎：按统一的 currentTime 时钟，同步调度
 *  - 视频轨：主 <video> 元素 + 一个预加载 <video>（提前加载下一个 clip）
 *  - 配音/音频轨：Web Audio API 预加载 AudioBuffer，精确调度
 *  - 字幕轨：通过回调通知当前应显示的字幕
 *
 * 切换 clip 时的黑屏缓解：主 video 切换 src 前若已预加载，可减少等待。
 */
export class PreviewEngine {
  private project: Project | null = null;
  private videoEl: HTMLVideoElement;
  private preloader: HTMLVideoElement;
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
  private rafId: number | null = null;

  private onTick: (state: EngineState) => void;
  private currentVideoClipId: string | null = null;
  private preloadedSrc: string | null = null;

  /**
   * T4.1: 画中画叠加层 video 池。
   * key = overlay clip.id，value = 独立 <video> 元素（由引擎动态创建/销毁）。
   * 容器由 App.tsx 通过 overlayContainer 提供；引擎在内部增删 video 子节点。
   */
  private overlayContainer: HTMLElement | null = null;
  private overlayVideoPool = new Map<string, HTMLVideoElement>();
  private overlaySyncedClips = new Set<string>();

  constructor(mainVideo: HTMLVideoElement, preloadVideo: HTMLVideoElement, onTick: (state: EngineState) => void) {
    this.videoEl = mainVideo;
    this.preloader = preloadVideo;
    this.preloader.style.opacity = "0";
    this.preloader.style.pointerEvents = "none";
    this.onTick = onTick;
  }

  /** T4.1: 设置画中画叠加层容器（引擎在里面动态管理 video 子节点） */
  setOverlayContainer(container: HTMLElement | null) {
    this.overlayContainer = container;
    // 容器变化时清空旧池
    this.clearOverlayPool();
  }

  get activeVideo(): HTMLVideoElement {
    return this.videoEl;
  }

  setProject(project: Project | null) {
    const ratioChanged = this.project?.ratio !== project?.ratio;
    const prevId = this.project?.id;
    this.project = project;
    if (ratioChanged || prevId !== project?.id) {
      this.pause();
      this.currentTime = 0;
    }
    this.currentVideoClipId = null;
    this.applyVideoAlignment(true);
    this.publish();
  }

  isPlaying() {
    return this.playing;
  }

  getCurrentTime() {
    return this.currentTime;
  }

  getDuration(): number {
    if (!this.project || this.project.clips.length === 0) return 0;
    return Math.max(...this.project.clips.map((c) => c.startOnTrack + c.duration));
  }

  play() {
    console.log("[PreviewEngine] play() called, project:", !!this.project, "playing:", this.playing);
    if (!this.project || this.playing) return;
    const duration = this.getDuration();
    console.log("[PreviewEngine] duration:", duration, "currentTime:", this.currentTime);
    if (this.currentTime >= duration - 0.05) {
      this.currentTime = 0;
    }
    this.playing = true;
    this.lastFrameAt = performance.now();
    this.startAudioScheduling();
    this.loop();
  }

  pause() {
    this.playing = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.stopAudioScheduling();
    this.videoEl?.pause();
    this.publish();
  }

  seek(time: number) {
    const wasPlaying = this.playing;
    if (wasPlaying) {
      this.stopAudioScheduling();
    }
    this.currentTime = Math.max(0, Math.min(time, this.getDuration()));
    this.currentVideoClipId = null;
    this.applyVideoAlignment(true);
    this.syncOverlays();
    if (wasPlaying) {
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
    this.clearOverlayPool();
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
    this.project = null;
  }

  /** T4.1: 清空画中画 video 池 */
  private clearOverlayPool() {
    this.overlayVideoPool.forEach((v) => {
      try { v.pause(); } catch { /* ignore */ }
      v.removeAttribute("src");
      try { v.load(); } catch { /* ignore */ }
      v.remove();
    });
    this.overlayVideoPool.clear();
    this.overlaySyncedClips.clear();
  }

  private loop = () => {
    if (!this.playing) return;
    const now = performance.now();
    const delta = (now - this.lastFrameAt) / 1000;
    this.lastFrameAt = now;

    this.currentTime += delta;
    const duration = this.getDuration();
    if (this.currentTime >= duration) {
      this.currentTime = duration;
      this.pause();
      return;
    }

    this.applyVideoAlignment(false);
    this.syncOverlays();
    this.publish();
    this.rafId = requestAnimationFrame(this.loop);
  };

  private applyVideoAlignment(force: boolean) {
    if (!this.project) return;
    const clip = this.findClipAt(this.currentTime, "video");
    const media = clip ? this.findMedia(clip.sourceId) : null;
    const src = media ? this.resolveSrc(media) : null;

    if (clip?.id !== this.currentVideoClipId || force) {
      this.currentVideoClipId = clip?.id ?? null;
      if (src) {
        // 如果主 video 还没加载过任何内容，或 src 不同，则加载
        if (!this.videoEl.src || !this.videoEl.src.includes(src)) {
          this.videoEl.src = src;
          this.videoEl.load();
        }
      } else {
        this.videoEl.removeAttribute("src");
        this.videoEl.load();
      }
      // 预加载下一个 clip 的 src 到 preloader
      this.preloadNextClip(clip);
    }

    if (!clip || !media) {
      this.videoEl.pause();
      return;
    }

    const rel = this.currentTime - clip.startOnTrack;
    const targetSourceTime = clip.sourceIn + Math.max(0, rel) * effectiveSpeed(clip);
    const rate = effectiveSpeed(clip);
    this.videoEl.playbackRate = rate;
    // 视频自带音轨音量通过 GainNode 控制（video 元素保持 muted 避免双重音频）
    // 检查视频轨是否被静音
    const videoTrack = this.project.tracks.find((t) => t.id === clip.trackId);
    const trackMuted = videoTrack?.muted ?? false;
    if (this.videoGainNode) {
      // T4.9: 音量上限对齐 UI 的 200%（之前 clamp ≤1）
      this.videoGainNode.gain.value = trackMuted ? 0 : Math.min(2, Math.max(0, clip.volume));
    }

    // 画面裁剪预览：用 transform 模拟（不破坏 position:inset:0）
    if (clip.crop && (clip.crop.width < 99 || clip.crop.height < 99)) {
      const crop = clip.crop;
      const scaleX = 100 / crop.width;
      const scaleY = 100 / crop.height;
      const scale = Math.max(scaleX, scaleY);
      const px = -(crop.x * scale) + (scale > scaleX ? (100 - crop.width * scale) / 2 : 0);
      const py = -(crop.y * scale) + (scale > scaleY ? (100 - crop.height * scale) / 2 : 0);
      this.videoEl.style.transform = `scale(${scale}) translate(${px / scale}%, ${py / scale}%)`;
      this.videoEl.style.transformOrigin = "0 0";
    } else {
      this.videoEl.style.transform = "";
      this.videoEl.style.transformOrigin = "";
    }

    // seek 策略：只在 clip 切换/强制/偏差过大时 seek。
    // 播放中让 video 按 playbackRate 自己走，不每帧强制 seek（避免倍速卡顿）。
    // 偏差阈值随 speed 放大（倍速时允许更大偏差，减少 seek）
    const seekThreshold = 0.3 + rate * 0.2;
    if (force || Math.abs(this.videoEl.currentTime - targetSourceTime) > seekThreshold) {
      try {
        this.videoEl.currentTime = Math.min(
          Math.max(0, targetSourceTime),
          Math.max(0, (media.duration || 0) - 0.05),
        );
      } catch {
        /* metadata not ready */
      }
    }

    if (this.playing && this.videoEl.paused) {
      void this.videoEl.play().catch(() => {});
    }
    if (!this.playing && !this.videoEl.paused) {
      this.videoEl.pause();
    }
  }

  /**
   * T4.1: 同步画中画叠加层 —— 为每个活跃 overlay clip 分配/更新一个 <video>。
   * 池上限 3，超出的 clip 不渲染（剪映也有类似限制）。
   * 每个 overlay video 独立执行 seek 追赶 + transform 应用。
   */
  private syncOverlays() {
    if (!this.project) return;
    const overlays = this.findAllClipsAt(this.currentTime, ["video", "image"]).slice(1);
    const activeIds = new Set(overlays.map((c) => c.id));

    // 1. 移除不再活跃的 overlay video
    for (const [clipId, v] of this.overlayVideoPool) {
      if (!activeIds.has(clipId)) {
        try { v.pause(); } catch { /* ignore */ }
        v.style.display = "none";
        this.overlaySyncedClips.delete(clipId);
      }
    }

    // 2. 为活跃 clip 分配 video（上限 3）
    const MAX_OVERLAYS = 3;
    let allocated = 0;
    for (const clip of overlays) {
      if (allocated >= MAX_OVERLAYS) break;
      allocated++;
      const media = this.findMedia(clip.sourceId);
      const src = media ? this.resolveSrc(media) : null;
      if (!src) continue;

      let v = this.overlayVideoPool.get(clip.id);
      if (!v) {
        // 动态创建 video（需在 overlayContainer 内）
        if (!this.overlayContainer) continue;
        v = document.createElement("video");
        v.className = "stage-overlay-video";
        v.muted = true; // 叠加层不发声（音频由主混音管）
        v.playsInline = true;
        v.style.position = "absolute";
        v.style.pointerEvents = "none";
        v.style.transformOrigin = "center center";
        this.overlayContainer.appendChild(v);
        this.overlayVideoPool.set(clip.id, v);
      }
      v.style.display = "block";

      // 设置 src（仅当变化时）
      if (!v.src || !v.src.includes(src)) {
        v.src = src;
        v.load();
      }

      // 应用 transform（位置/缩放/不透明度/混合模式）
      // T4.2: 有 keyframes 时按当前时间采样覆盖
      const tf = clip.transform;
      const rel = this.currentTime - clip.startOnTrack;
      const kf = sampleAllKeyframes(clip.keyframes, rel);
      const x = kf.x ?? tf?.x ?? 50;
      const y = kf.y ?? tf?.y ?? 50;
      const scaleVal = kf.scale ?? tf?.scale ?? 100;
      const scale = scaleVal / 100;
      const opacity = (kf.opacity ?? tf?.opacity ?? 100) / 100;
      const rotation = kf.rotation ?? tf?.rotation ?? 0;
      v.style.left = `${x}%`;
      v.style.top = `${y}%`;
      v.style.width = `${scaleVal}%`;
      v.style.transform = `translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`;
      v.style.opacity = String(opacity);
      if (tf?.mix) {
        (v.style.mixBlendMode as string) = tf.mix;
      }
      // T4.4: 蒙版（CSS clip-path / mask 近似）
      const m = clip.mask;
      if (m && m.kind !== "linear" && m.kind !== "mirror") {
        if (m.kind === "circle") {
          const r = Math.min(m.width, m.height) * 50;
          v.style.clipPath = `circle(${r}% at ${m.cx * 100}% ${m.cy * 100}%)`;
        } else if (m.kind === "rect") {
          const l = (m.cx - m.width / 2) * 100;
          const t = (m.cy - m.height / 2) * 100;
          v.style.clipPath = `inset(${t}% ${100 - l - m.width * 100}% ${100 - t - m.height * 100}% ${l}%)`;
        }
      } else if (m && (m.kind === "linear" || m.kind === "mirror")) {
        const dir = m.kind === "mirror" ? "90deg" : "180deg";
        v.style.webkitMaskImage = `linear-gradient(${dir}, transparent ${m.feather * 50}%, black ${(1 - m.feather) * 50}%)`;
        v.style.maskImage = `linear-gradient(${dir}, transparent ${m.feather * 50}%, black ${(1 - m.feather) * 50}%)`;
      } else {
        v.style.clipPath = "";
        v.style.maskImage = "";
        v.style.webkitMaskImage = "";
      }

      // seek 追赶（同主 video 逻辑，rel 已在上面计算）
      const targetSourceTime = clip.sourceIn + Math.max(0, rel) * effectiveSpeed(clip);
      const rate = effectiveSpeed(clip);
      v.playbackRate = rate;
      const seekThreshold = 0.3 + rate * 0.2;
      if (Math.abs(v.currentTime - targetSourceTime) > seekThreshold) {
        try {
          v.currentTime = Math.min(
            Math.max(0, targetSourceTime),
            Math.max(0, (media?.duration || 0) - 0.05),
          );
        } catch { /* metadata not ready */ }
      }
      if (this.playing && v.paused) {
        void v.play().catch(() => {});
      }
      if (!this.playing && !v.paused) {
        v.pause();
      }
    }
  }

  /** 预加载下一个视频 clip 的 src 到 preloader video（提前缓存，切换时更快） */
  private preloadNextClip(currentClip: Clip | null) {
    if (!this.project || !currentClip) return;
    const videoTrackIds = new Set(
      this.project.tracks.filter((t) => t.kind === "video").map((t) => t.id),
    );
    const upcoming = this.project.clips
      .filter((c) => videoTrackIds.has(c.trackId) && c.startOnTrack > currentClip.startOnTrack)
      .sort((a, b) => a.startOnTrack - b.startOnTrack);
    const nextClip = upcoming[0];
    if (!nextClip) {
      this.preloadedSrc = null;
      return;
    }
    const nextMedia = this.findMedia(nextClip.sourceId);
    const nextSrc = nextMedia ? this.resolveSrc(nextMedia) : null;
    if (!nextSrc || this.preloadedSrc === nextSrc) return;
    this.preloadedSrc = nextSrc;
    try {
      this.preloader.src = nextSrc;
      this.preloader.load();
    } catch {
      /* ignore preload errors */
    }
  }

  private async ensureAudioContext(): Promise<AudioContext> {
    if (!this.audioCtx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new Ctx();
      // 把视频元素的音轨路由到 AudioContext（video 保持 muted 但声音通过 Web Audio 出来）
      try {
        this.videoGainNode = this.audioCtx.createGain();
        this.videoGainNode.gain.value = 1.0;
        this.videoSourceNode = this.audioCtx.createMediaElementSource(this.videoEl);
        this.videoSourceNode.connect(this.videoGainNode).connect(this.audioCtx.destination);
      } catch {
        // 如果 video 已经被其他 source 连接过会报错，忽略
      }
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
    for (const media of audioMedia) {
      if (this.audioBuffers.has(media.id)) continue;
      const src = resolveSrc(media);
      if (!src) continue;
      try {
        const resp = await fetch(src);
        const buf = await resp.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(buf);
        this.audioBuffers.set(media.id, audioBuffer);
      } catch {
        /* 单个失败不阻塞 */
      }
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
      const audioTrackIds = new Set(
        this.project.tracks.filter((t) => t.kind === "voiceover" || t.kind === "audio").map((t) => t.id),
      );
      for (const clip of this.project.clips) {
        if (!audioTrackIds.has(clip.trackId)) continue;
        const track = this.findTrack(clip.trackId);
        if (track?.muted) continue;
        const media = this.findMedia(clip.sourceId);
        if (!media) continue;
        const buffer = this.audioBuffers.get(media.id);
        if (!buffer) continue;

        const clipEnd = clip.startOnTrack + clip.duration;
        if (clipEnd <= this.currentTime) continue;
        const offsetIntoClip = Math.max(0, this.currentTime - clip.startOnTrack);
        const sourceOffset = clip.sourceIn + offsetIntoClip * clip.speed;
        const whenOffset = Math.max(0, clip.startOnTrack - this.currentTime);
        const remainingDuration = clip.duration - offsetIntoClip;

        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.playbackRate.value = Math.min(4, Math.max(0.25, clip.speed));
        const gain = ctx.createGain();
        // T4.9: 音量上限对齐 UI 200%（之前 clamp ≤1）
        const vol = Math.min(2, Math.max(0, clip.volume));
        // T4.9: fadeIn/fadeOut 用 linearRampToValueAtTime
        const fadeIn = Math.max(0, clip.fadeIn ?? 0);
        const fadeOut = Math.max(0, clip.fadeOut ?? 0);
        const startAt = now + whenOffset;
        const endAt = startAt + remainingDuration;
        if (fadeIn > 0.001 && offsetIntoClip < fadeIn) {
          // 还在 fadeIn 区间内：从 0 ramp 到 vol
          gain.gain.setValueAtTime(0, startAt);
          gain.gain.linearRampToValueAtTime(vol, startAt + fadeIn);
        } else {
          gain.gain.value = vol;
        }
        if (fadeOut > 0.001 && remainingDuration > fadeOut) {
          // fadeOut：在 clip 结束前 ramp 到 0
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
        activeSubtitle: null,
        activeSubtitleClip: null,
        activeVideoClip: null,
        activeOverlayClips: [],
      });
      return;
    }
    const subtitleClip = this.findClipAt(this.currentTime, "subtitle");
    // 所有活跃画面 clip（视频轨 + 图片轨，按 order 降序：底层在前）
    const allVideoClips = this.findAllClipsAt(this.currentTime, ["video", "image"]);
    const baseClip = allVideoClips[0] || null;
    const overlayClips = allVideoClips.slice(1);
    this.onTick({
      currentTime: this.currentTime,
      playing: this.playing,
      activeSubtitle: subtitleClip?.text || null,
      activeSubtitleStyle: subtitleClip?.subtitleStyle || null,
      activeSubtitleClip: subtitleClip || null,
      activeVideoClip: baseClip,
      activeOverlayClips: overlayClips,
    });
  }

  /** 找当前时间所有活跃的指定 kind clip（按轨道 order 降序：底层在前） */
  private findAllClipsAt(time: number, kinds: TrackKind[]): Clip[] {
    if (!this.project) return [];
    // 收集该 kind 的所有轨道，按 order 降序（order 大=底层，排前面）
    const tracks = this.project.tracks
      .filter((t) => kinds.includes(t.kind))
      .sort((a, b) => b.order - a.order);
    const trackIds = new Set(tracks.map((t) => t.id));
    const clips = this.project.clips.filter(
      (clip) =>
        trackIds.has(clip.trackId) &&
        time >= clip.startOnTrack - 1e-3 &&
        time < clip.startOnTrack + clip.duration - 1e-3,
    );
    // 按轨道 order 降序（底层在前）
    clips.sort((a, b) => {
      const oa = tracks.find((t) => t.id === a.trackId)?.order ?? 0;
      const ob = tracks.find((t) => t.id === b.trackId)?.order ?? 0;
      return ob - oa;
    });
    return clips;
  }

  /** 根据 clip 的滤镜和色彩调节生成 CSS filter 字符串 */
  private buildCssFilter(clip: Clip): string {
    const parts: string[] = [];
    // 色彩调节（CSS brightness/contrast/saturate）
    const b = 1 + (clip.brightness ?? 0) / 100;
    const c = 1 + (clip.contrast ?? 0) / 100;
    const s = 1 + (clip.saturation ?? 0) / 100;
    if (Math.abs(b - 1) > 0.001) parts.push(`brightness(${b.toFixed(3)})`);
    if (Math.abs(c - 1) > 0.001) parts.push(`contrast(${c.toFixed(3)})`);
    if (Math.abs(s - 1) > 0.001) parts.push(`saturate(${s.toFixed(3)})`);
    // 滤镜预设
    switch (clip.filter ?? null as string | null) {
      case "vintage": parts.push("sepia(0.4) contrast(1.1) saturate(1.3)"); break;
      case "bw": case "grayscale": parts.push("grayscale(1)"); break;
      case "sepia": parts.push("sepia(0.8)"); break;
      case "warm": parts.push("sepia(0.2) saturate(1.3) hue-rotate(-10deg)"); break;
      case "cool": parts.push("saturate(1.1) hue-rotate(15deg) brightness(0.95)"); break;
      case "sharpen": parts.push("contrast(1.2)"); break;
      case "blur": parts.push("blur(2px)"); break;
    }
    return parts.length > 0 ? parts.join(" ") : "none";
  }

  private findTrack(trackId: string) {
    return this.project?.tracks.find((t) => t.id === trackId);
  }

  private findClipAt(time: number, kind: TrackKind): Clip | null {
    if (!this.project) return null;
    const trackIds = new Set(
      this.project.tracks.filter((t) => t.kind === kind).map((t) => t.id),
    );
    return (
      this.project.clips.find(
        (clip) =>
          trackIds.has(clip.trackId) &&
          time >= clip.startOnTrack - 1e-3 &&
          time < clip.startOnTrack + clip.duration - 1e-3,
      ) || null
    );
  }

  private findMedia(sourceId?: string | null): MediaSource | null {
    if (!this.project || !sourceId) return null;
    return this.project.media.find((m) => m.id === sourceId) || null;
  }

  private resolveSrc(media: MediaSource): string | null {
    if (media.localPath) return this.resolveLocal(media.localPath);
    if (media.url) return media.url;
    return null;
  }

  resolveLocal: (localPath: string) => string = (p) => p;
}

export type EngineState = {
  currentTime: number;
  playing: boolean;
  activeSubtitle: string | null;
  activeSubtitleStyle?: { fontSize: number; color: string; strokeColor: string; position: string; fontFamily: string; x: number; y: number; scaleX: number; scaleY: number; rotation: number; karaoke?: boolean; highlightColor?: string } | null;
  /** 当前活跃字幕 clip（含 words，用于逐字高亮） */
  activeSubtitleClip: Clip | null;
  activeVideoClip: Clip | null;
  /** 画中画叠加层：除底层外的活跃视频 clip */
  activeOverlayClips: Clip[];
};
