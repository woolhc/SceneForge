export type PooledMediaKind = "video" | "image";

export type PooledMedia = {
  mediaId: string;
  kind: PooledMediaKind;
  el: HTMLVideoElement | HTMLImageElement;
  gain: GainNode | null;
  sourceNode: MediaElementAudioSourceNode | null;
  lastUsed: number;
  seekTarget: number | null;
  seeked: boolean;
  styleSignature: string | null;
};

export class MediaElementPool {
  private items = new Map<string, PooledMedia>();

  constructor(
    private container: HTMLElement,
    private getAudioContext: () => Promise<AudioContext>,
    private limit = 6,
  ) {}

  get size() {
    return this.items.size;
  }

  get(mediaId: string) {
    return this.items.get(mediaId) ?? null;
  }

  values() {
    return [...this.items.values()];
  }

  async acquire(mediaId: string, src: string, kind: PooledMediaKind): Promise<PooledMedia> {
    const existing = this.items.get(mediaId);
    if (existing && existing.kind === kind) {
      this.markUsed(mediaId);
      this.ensureSrc(existing, src);
      return existing;
    }
    if (existing) {
      this.release(mediaId);
    }

    const pooled = await this.create(mediaId, src, kind);
    this.items.set(mediaId, pooled);
    this.evictLRU();
    return pooled;
  }

  markUsed(mediaId: string) {
    const item = this.items.get(mediaId);
    if (item) item.lastUsed = performance.now();
  }

  async seekTo(item: PooledMedia, time: number): Promise<void> {
    if (item.kind !== "video") {
      item.seekTarget = null;
      item.seeked = true;
      return;
    }
    const el = item.el as HTMLVideoElement;
    const target = Math.max(0, time);
    if (Math.abs(el.currentTime - target) < 0.05 && el.readyState >= 2) {
      item.seekTarget = target;
      item.seeked = true;
      return;
    }
    item.seekTarget = target;
    item.seeked = false;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = (seeked: boolean) => {
        if (done) return;
        done = true;
        window.clearTimeout(timeoutId);
        el.removeEventListener("seeked", onSeeked);
        el.removeEventListener("canplay", onCanPlay);
        item.seeked = seeked;
        resolve();
      };
      const onSeeked = () => {
        finish(true);
      };
      const onCanPlay = () => {
        if (Math.abs(el.currentTime - target) < 0.2) finish(true);
      };
      const timeoutId = window.setTimeout(() => finish(el.readyState >= 2), 800);
      el.addEventListener("seeked", onSeeked, { once: true });
      el.addEventListener("canplay", onCanPlay, { once: true });
      try {
        el.currentTime = target;
      } catch {
        finish(false);
      }
    });
  }

  release(mediaId: string) {
    const item = this.items.get(mediaId);
    if (!item) return;
    if (item.kind === "video") {
      const video = item.el as HTMLVideoElement;
      try { video.pause(); } catch { /* ignore */ }
      video.removeAttribute("src");
      try { video.load(); } catch { /* ignore */ }
    } else {
      (item.el as HTMLImageElement).removeAttribute("src");
    }
    try { item.sourceNode?.disconnect(); } catch { /* ignore */ }
    try { item.gain?.disconnect(); } catch { /* ignore */ }
    item.el.remove();
    this.items.delete(mediaId);
  }

  dispose() {
    for (const mediaId of [...this.items.keys()]) {
      this.release(mediaId);
    }
  }

  private async create(mediaId: string, src: string, kind: PooledMediaKind): Promise<PooledMedia> {
    const lastUsed = performance.now();
    if (kind === "image") {
      const img = document.createElement("img");
      img.className = "stage-pooled-media stage-pooled-image";
      img.crossOrigin = "anonymous";
      this.applyBaseStyle(img);
      img.src = src;
      this.container.appendChild(img);
      return { mediaId, kind, el: img, gain: null, sourceNode: null, lastUsed, seekTarget: null, seeked: true, styleSignature: null };
    }

    const video = document.createElement("video");
    video.className = "stage-pooled-media stage-pooled-video";
    video.crossOrigin = "anonymous";
    video.muted = false;
    video.playsInline = true;
    video.preload = "auto";
    this.applyBaseStyle(video);
    video.src = src;
    video.load();
    this.container.appendChild(video);

    let gain: GainNode | null = null;
    let sourceNode: MediaElementAudioSourceNode | null = null;
    try {
      const ctx = await this.getAudioContext();
      gain = ctx.createGain();
      gain.gain.value = 0;
      sourceNode = ctx.createMediaElementSource(video);
      sourceNode.connect(gain).connect(ctx.destination);
    } catch {
      gain = null;
      sourceNode = null;
    }

    return { mediaId, kind, el: video, gain, sourceNode, lastUsed, seekTarget: null, seeked: false, styleSignature: null };
  }

  private ensureSrc(item: PooledMedia, src: string) {
    const current = item.kind === "video"
      ? (item.el as HTMLVideoElement).currentSrc || (item.el as HTMLVideoElement).src
      : (item.el as HTMLImageElement).currentSrc || (item.el as HTMLImageElement).src;
    if (current === src) return;
    item.seeked = item.kind === "image";
    item.seekTarget = null;
    item.el.setAttribute("src", src);
    if (item.kind === "video") {
      (item.el as HTMLVideoElement).load();
    }
  }

  private evictLRU() {
    while (this.items.size > this.limit) {
      let oldest: PooledMedia | null = null;
      for (const item of this.items.values()) {
        if (!oldest || item.lastUsed < oldest.lastUsed) oldest = item;
      }
      if (!oldest) break;
      this.release(oldest.mediaId);
    }
  }

  private applyBaseStyle(el: HTMLElement) {
    el.style.position = "absolute";
    el.style.inset = "0";
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.objectFit = "cover";
    el.style.opacity = "0";
    el.style.pointerEvents = "none";
    el.style.zIndex = "3";
  }
}
