import { sampleAllKeyframes } from "../editor/keyframes";
import { getLutData } from "../luts";
import type { Clip, MediaSource, Project } from "../types";
import type { EngineState, PreviewRenderer } from "./PreviewRenderer";
import { WebGLCompositor, layerParamsForClip } from "./WebGLCompositor";

type MP4Buffer = ArrayBuffer & { fileStart?: number };

type DecodedClip = {
  src: string;
  codec: string;
  codedWidth: number;
  codedHeight: number;
  timescale: number;
  samples: Mp4Sample[];
  description?: Uint8Array;
};

type Mp4Track = {
  id: number;
  codec: string;
  timescale: number;
  track_width: number;
  track_height: number;
  video?: { width?: number; height?: number };
};

type Mp4Info = {
  videoTracks: Mp4Track[];
};

type Mp4Sample = {
  cts?: number;
  data?: Uint8Array;
  dts: number;
  duration: number;
  is_sync: boolean;
  number: number;
  timescale: number;
  description?: unknown;
};

type DataStreamCtor = {
  BIG_ENDIAN: number;
  new (arrayBuffer?: ArrayBuffer | DataView<ArrayBuffer> | number, byteOffset?: number, endianness?: number): {
    dynamicSize: number;
    buffer: ArrayBuffer;
    getPosition(): number;
  };
};

function visualTrackIds(project: Project): string[] {
  return project.tracks
    .filter((track) => track.kind === "video" || track.kind === "image")
    .sort((a, b) => b.order - a.order)
    .map((track) => track.id);
}

function mediaForClip(project: Project, clip: Clip | null): MediaSource | null {
  if (!clip?.sourceId) return null;
  return project.media.find((media) => media.id === clip.sourceId) ?? null;
}

export function canUseWebCodecsRenderer() {
  return (
    typeof window !== "undefined" &&
    "VideoDecoder" in window &&
    window.localStorage.getItem("scenescript:webcodecs-preview") === "1"
  );
}

export class WebCodecsRenderer implements PreviewRenderer {
  resolveLocal: (localPath: string) => string = (localPath) => localPath;
  onActiveVideoChange: ((el: HTMLVideoElement | HTMLImageElement) => void) | null = null;

  private project: Project | null = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private video: HTMLVideoElement;
  private currentTime = 0;
  private playing = false;
  private rafId: number | null = null;
  private startedAt = 0;
  private playheadAtStart = 0;
  private currentClipId: string | null = null;
  private decodedClip: DecodedClip | null = null;
  private decodePromise: Promise<DecodedClip | null> | null = null;
  private decoder: VideoDecoder | null = null;
  private decodedFrame: VideoFrame | null = null;
  private lastDecodedSampleNumber: number | null = null;
  private webCodecsFailed = false;
  private overlayElements = new Map<string, HTMLVideoElement | HTMLImageElement>();
  private compositor: WebGLCompositor | null = null;
  private lutCache = new Map<string, Uint8Array | null>();
  private uploadCanvas: HTMLCanvasElement | null = null;
  private uploadCtx: CanvasRenderingContext2D | null = null;

  constructor(stageContainer: HTMLElement, private onTick: (state: EngineState) => void) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "webcodecs-preview-canvas";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.objectFit = "contain";
    this.canvas.style.background = "#000";
    try {
      this.compositor = new WebGLCompositor(this.canvas);
    } catch {
      this.compositor = null;
      this.ctx = this.canvas.getContext("2d", { alpha: false });
    }
    this.video = document.createElement("video");
    this.video.crossOrigin = "anonymous";
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.preload = "auto";
    stageContainer.appendChild(this.canvas);
  }

  setProject(project: Project | null) {
    const previousProjectId = this.project?.id ?? null;
    this.project = project;
    if (!project || previousProjectId !== project.id) {
      this.currentClipId = null;
      this.decodedClip = null;
      this.decodePromise = null;
      this.currentTime = 0;
    }
    this.syncVideoElement();
    void this.syncFrame().then(() => {
      this.draw();
      this.publish();
    });
  }

  setOverlayContainer(_container: HTMLElement | null) {}

  async preloadAudioBuffers(_resolveSrc: (media: Project["media"][number]) => string | null) {}

  play() {
    if (!this.project || this.playing) return;
    this.playing = true;
    this.startedAt = performance.now();
    this.playheadAtStart = this.currentTime;
    void this.video.play().catch(() => {});
    this.tick();
  }

  pause() {
    this.playing = false;
    this.video.pause();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.publish();
  }

  seek(time: number) {
    this.currentTime = Math.max(0, Math.min(time, this.getDuration()));
    this.playheadAtStart = this.currentTime;
    this.startedAt = performance.now();
    void this.syncFrame().then(() => {
      this.draw();
      this.publish();
    });
  }

  isPlaying() {
    return this.playing;
  }

  getCurrentTime() {
    return this.currentTime;
  }

  getDuration() {
    if (!this.project || this.project.clips.length === 0) return 0;
    return Math.max(...this.project.clips.map((clip) => clip.startOnTrack + clip.duration));
  }

  setClipVolume(_clipId: string, _volume: number) {}

  dispose() {
    this.pause();
    this.decoder?.close();
    this.decoder = null;
    this.decodedFrame?.close();
    this.decodedFrame = null;
    this.overlayElements.forEach((element) => {
      if (element instanceof HTMLVideoElement) {
        element.pause();
        element.removeAttribute("src");
        element.load();
      }
    });
    this.overlayElements.clear();
    this.compositor?.dispose();
    this.compositor = null;
    this.video.removeAttribute("src");
    this.video.load();
    this.canvas.remove();
  }

  private tick = () => {
    if (!this.playing) return;
    this.currentTime = Math.min(
      this.getDuration(),
      this.playheadAtStart + (performance.now() - this.startedAt) / 1000,
    );
    if (this.currentTime >= this.getDuration()) {
      this.pause();
      return;
    }
    void this.syncFrame().then(() => {
      this.draw();
      this.publish();
    });
    this.rafId = requestAnimationFrame(this.tick);
  };

  private activeBaseClip(): Clip | null {
    return this.activeVisualClips()[0] ?? null;
  }

  private activeOverlayClips(): Clip[] {
    return this.activeVisualClips().slice(1);
  }

  private activeVisualClips(): Clip[] {
    if (!this.project) return [];
    const trackIds = visualTrackIds(this.project);
    return this.project.clips
      .filter(
        (clip) =>
          trackIds.includes(clip.trackId) &&
          this.currentTime >= clip.startOnTrack &&
          this.currentTime < clip.startOnTrack + clip.duration,
      )
      .sort((a, b) => trackIds.indexOf(a.trackId) - trackIds.indexOf(b.trackId));
  }

  private syncVideoElement() {
    if (!this.project) return null;
    const clip = this.activeBaseClip();
    const media = mediaForClip(this.project, clip);
    if (!clip || !media) {
      this.currentClipId = null;
      this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return null;
    }
    const src = media.proxyPath
      ? this.resolveLocal(media.proxyPath)
      : media.localPath
        ? this.resolveLocal(media.localPath)
        : media.url;
    if (!src) return null;
    if (this.currentClipId !== clip.id || this.video.currentSrc !== src) {
      this.currentClipId = clip.id;
      this.video.src = src;
      this.decodedClip = null;
      this.decodePromise = null;
      this.lastDecodedSampleNumber = null;
      this.onActiveVideoChange?.(this.video);
    }
    const rel = Math.max(0, this.currentTime - clip.startOnTrack);
    const sourceTime = clip.sourceIn + rel * Math.max(0.25, Math.abs(clip.speed || 1));
    if (Number.isFinite(sourceTime) && Math.abs(this.video.currentTime - sourceTime) > 0.12) {
      this.video.currentTime = sourceTime;
    }
    return { clip, src, sourceTime };
  }

  private async syncFrame() {
    const aligned = this.syncVideoElement();
    this.syncOverlayElements();
    if (!aligned || this.webCodecsFailed || !("VideoDecoder" in window)) return;
    try {
      if (!this.decodedClip || this.decodedClip.src !== aligned.src) {
        this.decodedClip = await this.loadDecodedClip(aligned.src);
        this.lastDecodedSampleNumber = null;
      }
      if (!this.decodedClip) return;
      await this.decodeNearestFrame(this.decodedClip, aligned.sourceTime);
      await Promise.all(this.activeVisualClips().map((clip) => this.ensureLutForClip(clip)));
    } catch (error) {
      console.warn("WebCodecs preview failed; falling back to HTML video canvas", error);
      this.webCodecsFailed = true;
      this.decodedFrame?.close();
      this.decodedFrame = null;
      this.decoder?.close();
      this.decoder = null;
    }
  }

  private async loadDecodedClip(src: string): Promise<DecodedClip | null> {
    if (this.decodePromise) return this.decodePromise;
    this.decodePromise = demuxVideo(src);
    return this.decodePromise;
  }

  private ensureDecoder(clip: DecodedClip) {
    if (this.decoder && this.decoder.state !== "closed") return;
    this.decoder = new VideoDecoder({
      output: (frame) => {
        this.decodedFrame?.close();
        this.decodedFrame = frame;
      },
      error: (error) => {
        console.warn("WebCodecs decoder error", error);
        this.webCodecsFailed = true;
      },
    });
    this.decoder.configure({
      codec: clip.codec,
      codedWidth: clip.codedWidth,
      codedHeight: clip.codedHeight,
      description: clip.description,
    });
  }

  private async decodeNearestFrame(clip: DecodedClip, sourceTime: number) {
    const keySample = nearestSyncBoundedSample(clip.samples, sourceTime, clip.timescale);
    if (!keySample?.data || keySample.number === this.lastDecodedSampleNumber) return;
    this.ensureDecoder(clip);
    const decoder = this.decoder;
    if (!decoder || decoder.state === "closed") return;
    this.decodedFrame?.close();
    this.decodedFrame = null;

    const startIndex = Math.max(0, clip.samples.findIndex((sample) => sample.number === keySample.number));
    const targetUs = sourceTime * 1_000_000;
    for (let index = startIndex; index < clip.samples.length; index += 1) {
      const sample = clip.samples[index];
      if (!sample.data) continue;
      const timestampUs = ((sample.cts ?? sample.dts) / sample.timescale) * 1_000_000;
      decoder.decode(
        new EncodedVideoChunk({
          type: sample.is_sync ? "key" : "delta",
          timestamp: timestampUs,
          duration: (sample.duration / sample.timescale) * 1_000_000,
          data: sample.data,
        }),
      );
      this.lastDecodedSampleNumber = sample.number;
      if (timestampUs >= targetUs || index - startIndex > 90) break;
    }
    await decoder.flush();
  }

  private draw() {
    if (this.decodedFrame) {
      const width = this.decodedFrame.displayWidth || this.canvas.clientWidth || 1;
      const height = this.decodedFrame.displayHeight || this.canvas.clientHeight || 1;
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      this.drawBaseImage(this.decodedFrame);
      this.drawOverlays();
      return;
    }

    const width = this.video.videoWidth || this.canvas.clientWidth || 1;
    const height = this.video.videoHeight || this.canvas.clientHeight || 1;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      this.drawBaseImage(this.video);
    }
    this.drawOverlays();
  }

  private drawBaseImage(source: CanvasImageSource) {
    const baseClip = this.activeBaseClip();
    if (this.compositor) {
      this.compositor.resize(this.canvas.width || 1, this.canvas.height || 1);
      this.compositor.clear();
      this.compositor.drawLayer(
        this.webglSource(source),
        layerParamsForClip(
          baseClip,
          this.canvas.width / 2,
          this.canvas.height / 2,
          this.canvas.width,
          this.canvas.height,
          1,
          0,
          this.lutForClip(baseClip),
        ),
      );
      return;
    }
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.save();
    ctx.filter = canvasFilter(baseClip);
    ctx.drawImage(source, 0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  }

  private webglSource(source: CanvasImageSource): CanvasImageSource {
    if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) {
      if (!this.uploadCanvas) {
        this.uploadCanvas = document.createElement("canvas");
        this.uploadCtx = this.uploadCanvas.getContext("2d", { alpha: false });
      }
      const width = source.displayWidth || source.codedWidth || 1;
      const height = source.displayHeight || source.codedHeight || 1;
      if (this.uploadCanvas.width !== width) this.uploadCanvas.width = width;
      if (this.uploadCanvas.height !== height) this.uploadCanvas.height = height;
      this.uploadCtx?.drawImage(source, 0, 0, width, height);
      return this.uploadCanvas;
    }
    return source;
  }

  private syncOverlayElements() {
    if (!this.project) return;
    const activeIds = new Set(this.activeOverlayClips().map((clip) => clip.id));
    for (const [clipId, element] of this.overlayElements) {
      if (activeIds.has(clipId)) continue;
      if (element instanceof HTMLVideoElement) {
        element.pause();
        element.removeAttribute("src");
        element.load();
      }
      this.overlayElements.delete(clipId);
    }

    for (const clip of this.activeOverlayClips()) {
      const media = mediaForClip(this.project, clip);
      if (!media) continue;
      const src = media.proxyPath
        ? this.resolveLocal(media.proxyPath)
        : media.localPath
          ? this.resolveLocal(media.localPath)
          : media.url;
      if (!src) continue;
      let element = this.overlayElements.get(clip.id);
      if (!element) {
        element =
          media.kind === "image"
            ? document.createElement("img")
            : document.createElement("video");
        element.crossOrigin = "anonymous";
        if (element instanceof HTMLVideoElement) {
          element.muted = true;
          element.playsInline = true;
          element.preload = "auto";
        }
        this.overlayElements.set(clip.id, element);
      }
      if (element instanceof HTMLImageElement) {
        if (element.src !== src) element.src = src;
      } else {
        if (element.currentSrc !== src && element.src !== src) element.src = src;
        const rel = Math.max(0, this.currentTime - clip.startOnTrack);
        const sourceTime = clip.sourceIn + rel * Math.max(0.25, Math.abs(clip.speed || 1));
        if (Number.isFinite(sourceTime) && Math.abs(element.currentTime - sourceTime) > 0.12) {
          element.currentTime = sourceTime;
        }
        if (this.playing) void element.play().catch(() => {});
        else element.pause();
      }
    }
  }

  private drawOverlays() {
    for (const clip of this.activeOverlayClips()) {
      const element = this.overlayElements.get(clip.id);
      if (!element || !mediaElementReady(element)) continue;
      const transform = clip.transform;
      const rel = Math.max(0, this.currentTime - clip.startOnTrack);
      const sampled = sampleAllKeyframes(clip.keyframes, rel);
      const scale = Math.max(0.01, (sampled.scale ?? transform?.scale ?? 100) / 100);
      const opacity = Math.max(0, Math.min(1, (sampled.opacity ?? transform?.opacity ?? 100) / 100));
      const maxWidth = this.canvas.width * scale;
      const maxHeight = this.canvas.height * scale;
      const intrinsicWidth =
        element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth;
      const intrinsicHeight =
        element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight;
      if (!intrinsicWidth || !intrinsicHeight) continue;
      const fit = Math.min(maxWidth / intrinsicWidth, maxHeight / intrinsicHeight);
      const drawWidth = intrinsicWidth * fit;
      const drawHeight = intrinsicHeight * fit;
      const x = (this.canvas.width - drawWidth) * Math.max(0, Math.min(1, (sampled.x ?? transform?.x ?? 50) / 100));
      const y = (this.canvas.height - drawHeight) * Math.max(0, Math.min(1, (sampled.y ?? transform?.y ?? 50) / 100));
      const rotation = ((sampled.rotation ?? transform?.rotation ?? 0) * Math.PI) / 180;

      if (this.compositor) {
        this.compositor.drawLayer(
          element,
          layerParamsForClip(
            clip,
            x + drawWidth / 2,
            y + drawHeight / 2,
            drawWidth,
            drawHeight,
            opacity,
            rotation,
            this.lutForClip(clip),
          ),
        );
        continue;
      }

      const ctx = this.ctx;
      if (!ctx) continue;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.filter = canvasFilter(clip);
      ctx.translate(x + drawWidth / 2, y + drawHeight / 2);
      ctx.rotate(rotation);
      applyClipPath(ctx, clip, drawWidth, drawHeight);
      ctx.drawImage(element, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
      ctx.restore();
    }
  }

  private publish() {
    const activeVideoClip = this.activeBaseClip();
    const activeOverlayClips = this.activeOverlayClips();
    this.onTick({
      currentTime: this.currentTime,
      playing: this.playing,
      activeSubtitle: null,
      activeSubtitleStyle: null,
      activeSubtitleClip: null,
      activeVideoClip,
      activeOverlayClips,
    });
  }

  private async ensureLutForClip(clip: Clip | null) {
    const filter = clip?.filter;
    if (!filter || filter === "none" || this.lutCache.has(filter)) return;
    this.lutCache.set(filter, await getLutData(filter));
  }

  private lutForClip(clip: Clip | null) {
    const filter = clip?.filter;
    if (!filter || filter === "none") return null;
    void this.ensureLutForClip(clip);
    return this.lutCache.get(filter) ?? null;
  }
}

function mediaElementReady(element: HTMLVideoElement | HTMLImageElement) {
  if (element instanceof HTMLVideoElement) {
    return element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && element.videoWidth > 0;
  }
  return element.complete && element.naturalWidth > 0;
}

function canvasFilter(clip: Clip | null) {
  if (!clip) return "none";
  const brightness = 1 + clip.brightness / 100;
  const contrast = 1 + clip.contrast / 100;
  const saturation = 1 + clip.saturation / 100;
  return `brightness(${Math.max(0, brightness)}) contrast(${Math.max(0, contrast)}) saturate(${Math.max(0, saturation)})`;
}

function applyClipPath(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  drawWidth: number,
  drawHeight: number,
) {
  const cornerRadius = clip.transform?.cornerRadius ?? 0;
  const mask = clip.mask;
  if (!mask && cornerRadius <= 0) return;
  ctx.beginPath();
  if (mask && !mask.invert && mask.kind === "circle") {
    ctx.ellipse(
      -drawWidth / 2 + drawWidth * mask.cx,
      -drawHeight / 2 + drawHeight * mask.cy,
      Math.max(1, (drawWidth * mask.width) / 2),
      Math.max(1, (drawHeight * mask.height) / 2),
      mask.rotation,
      0,
      Math.PI * 2,
    );
  } else if (mask && !mask.invert && mask.kind === "rect") {
    const x = -drawWidth / 2 + drawWidth * (mask.cx - mask.width / 2);
    const y = -drawHeight / 2 + drawHeight * (mask.cy - mask.height / 2);
    ctx.rect(x, y, drawWidth * mask.width, drawHeight * mask.height);
  } else if (cornerRadius > 0 && "roundRect" in ctx) {
    ctx.roundRect(-drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight, cornerRadius);
  } else {
    ctx.rect(-drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  }
  ctx.clip();
}

async function demuxVideo(src: string): Promise<DecodedClip | null> {
  const { DataStream, createFile } = await import("mp4box");
  const response = await fetch(src);
  if (!response.ok) throw new Error(`failed to fetch video: ${response.status}`);
  const buffer = (await response.arrayBuffer()) as MP4Buffer;
  buffer.fileStart = 0;

  const file = createFile();
  const samples: Mp4Sample[] = [];
  let selectedTrack: Mp4Track | null = null;

  const ready = new Promise<void>((resolve, reject) => {
    file.onError = (_module, message) => reject(new Error(message));
    file.onSamples = (_id: number, _user: unknown, nextSamples: unknown[]) => {
      samples.push(...(nextSamples as Mp4Sample[]));
    };
    file.onReady = (info: unknown) => {
      const mp4Info = info as Mp4Info;
      selectedTrack = mp4Info.videoTracks[0] ?? null;
      if (!selectedTrack) {
        reject(new Error("MP4 has no video track"));
        return;
      }
      file.setExtractionOptions(selectedTrack.id, undefined, { nbSamples: 1000 });
      file.start();
      resolve();
    };
  });

  file.appendBuffer(buffer);
  file.flush();
  await ready;
  file.flush();

  const track = selectedTrack as Mp4Track | null;
  if (!track || samples.length === 0) return null;
  samples.sort((a, b) => a.dts - b.dts);
  const firstDescription = samples.find((sample) => sample.description)?.description;
  const description = firstDescription ? codecDescription(firstDescription, DataStream) : undefined;
  const codedWidth = track.video?.width ?? (Number.isFinite(track.track_width) ? Math.round(track.track_width) : 1);
  const codedHeight = track.video?.height ?? (Number.isFinite(track.track_height) ? Math.round(track.track_height) : 1);
  const config: VideoDecoderConfig = {
    codec: track.codec,
    codedWidth,
    codedHeight,
    description,
  };
  const support = await VideoDecoder.isConfigSupported(config);
  if (!support.supported) throw new Error(`unsupported WebCodecs config: ${track.codec}`);

  return {
    src,
    codec: support.config?.codec ?? track.codec,
    codedWidth,
    codedHeight,
    timescale: track.timescale,
    samples,
    description,
  };
}

function codecDescription(description: unknown, DataStream: DataStreamCtor): Uint8Array | undefined {
  const entry = description as unknown as Record<string, unknown>;
  const box = (entry.avcC ?? entry.hvcC ?? entry.av1C ?? entry.vpcC) as
    | { write?: (stream: InstanceType<DataStreamCtor>) => void }
    | undefined;
  if (!box?.write) return undefined;
  const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
  stream.dynamicSize = 1;
  box.write(stream);
  const bytes = new Uint8Array(stream.buffer, 0, stream.getPosition());
  return bytes.length > 8 ? bytes.slice(8) : bytes;
}

function nearestSyncBoundedSample(samples: Mp4Sample[], sourceTime: number, timescale: number) {
  const target = sourceTime * timescale;
  let syncSample: Mp4Sample | null = null;
  for (const sample of samples) {
    const timestamp = sample.cts ?? sample.dts;
    if (timestamp <= target && sample.is_sync) {
      syncSample = sample;
    }
    if (timestamp > target) break;
  }
  return syncSample ?? samples.find((sample) => sample.is_sync) ?? samples[0] ?? null;
}
