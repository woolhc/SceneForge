import type { Clip } from "../types";

/**
 * WebGL 滤镜渲染器（LUT + shader 组合方案）：
 * - 预设滤镜：3D LUT 纹理采样（预览=导出一致）
 * - 色彩调节：shader 实时计算（亮度/对比度/饱和度）
 *
 * 渲染管线：原始帧 → eq(亮度对比度饱和度) → LUT(预设风格) → 输出
 * 导出对应：ffmpeg eq=... , lut3d=...
 */
export class FilterRenderer {
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private videoTexture: WebGLTexture | null = null;
  private lutTexture: WebGLTexture | null = null;
  private canvas: HTMLCanvasElement;
  private video: HTMLVideoElement | HTMLImageElement | null;
  private currentLutName: string | null = null;
  private lutSize = 33;


  /** 当前要渲染的 clip（由 React effect 低频设置） */
  private currentClip: Clip | null = null;
  /** rAF 循环 ID（每帧自动绘制） */
  private rafId: number | null = null;
  private videoFrameCallbackId: number | null = null;

  private static readonly VS = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `;

  // shader：先做色彩调节，再做 LUT 采样
  private static readonly FS = `
    precision highp float;
    varying vec2 v_texCoord;
    uniform sampler2D u_image;
    uniform sampler2D u_lut;      // 3D LUT 打平成 2D 纹理
    uniform float u_lutSize;
    uniform float u_brightness;
    uniform float u_contrast;
    uniform float u_saturation;
    uniform float u_temperature;
    uniform float u_tint;
    uniform bool u_useLut;

    void main() {
      vec4 color = texture2D(u_image, v_texCoord);

      // 第一步：色彩调节（eq 等效）
      color.rgb += u_brightness;
      color.rgb = (color.rgb - 0.5) * u_contrast + 0.5;
      float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      color.rgb = mix(vec3(luma), color.rgb, u_saturation);

      // 色温/色调（colorbalance 等效）：温度正=暖（红增蓝减），色调正=品红（绿减）
      // 强度系数与 ffmpeg 端 colorbalance rm/gm/bm 一致（最大 ±0.5）
      color.r += u_temperature * 0.5;
      color.b -= u_temperature * 0.5;
      color.g -= u_tint * 0.5;
      color.rgb = clamp(color.rgb, 0.0, 1.0);

      // 第二步：LUT 采样（预设滤镜）
      if (u_useLut) {
        // 把 3D LUT 打平成 2D：用 blue 通道做 slice 索引
        float sliceSize = 1.0 / u_lutSize;
        float slicePixelSize = sliceSize / u_lutSize;
        // blue slice 索引（加上半像素偏移避免边缘）
        float bIdx = color.b * (u_lutSize - 1.0);
        float slice0 = floor(bIdx);
        float slice1 = min(slice0 + 1.0, u_lutSize - 1.0);
        float f = bIdx - slice0;

        // 在 slice 内的 UV
        vec2 lutUV;
        lutUV.x = (slice0 * sliceSize) + (color.r * sliceSize * (u_lutSize - 1.0) / u_lutSize) + slicePixelSize * 0.5;
        lutUV.y = (color.g * (u_lutSize - 1.0) / u_lutSize) + slicePixelSize * 0.5;
        vec3 c0 = texture2D(u_lut, lutUV).rgb;

        lutUV.x = (slice1 * sliceSize) + (color.r * sliceSize * (u_lutSize - 1.0) / u_lutSize) + slicePixelSize * 0.5;
        vec3 c1 = texture2D(u_lut, lutUV).rgb;

        color.rgb = mix(c0, c1, f);
      }

      gl_FragColor = vec4(clamp(color.rgb, 0.0, 1.0), 1.0);
    }
  `;

  constructor(canvas: HTMLCanvasElement, video: HTMLVideoElement | HTMLImageElement | null = null) {
    this.canvas = canvas;
    this.video = video;
    this.init();
  }

  private init() {
    const gl = this.canvas.getContext("webgl", { premultipliedAlpha: false, antialias: false });
    if (!gl) return;
    this.gl = gl;

    const vs = this.compile(gl.VERTEX_SHADER, FilterRenderer.VS);
    const fs = this.compile(gl.FRAGMENT_SHADER, FilterRenderer.FS);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    this.program = program;

    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const texCoords = new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]);
    this.createBuffer("a_position", positions, 2);
    this.createBuffer("a_texCoord", texCoords, 2);

    this.videoTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.lutTexture = gl.createTexture();
  }

  private compile(type: number, source: string): WebGLShader | null {
    const gl = this.gl!;
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return null;
    return shader;
  }

  private createBuffer(name: string, data: Float32Array, size: number) {
    const gl = this.gl!;
    const program = this.program!;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }

  /** 解析 .cube 文件并上传为 2D 纹理（3D LUT 打平成 2D） */
  async loadLut(name: string, lutData: Uint8Array) {
    const gl = this.gl;
    if (!gl || !this.lutTexture) return;
    const size = this.lutSize;
    // 把 3D LUT 打平成 2D: width = size*size, height = size
    const w = size * size;
    const h = size;
    gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.currentLutName = name;
    if (this.currentClip?.filter === name) {
      this.render(this.currentClip);
      this.startLoop();
    }
  }

  /** 清除当前 LUT（回到无滤镜） */
  clearLut() {
    this.currentLutName = null;
    if (this.currentClip) this.render(this.currentClip);
  }

  /** 设置当前要渲染的 clip（低频），内部 rAF 循环每帧绘制，不依赖 App 重渲染 */
  setClip(clip: Clip | null) {
    this.currentClip = clip;
    if (clip) {
      this.render(clip);
      this.startLoop();
    } else {
      this.stopLoop();
      this.canvas.style.display = "none";
    }
  }

  /** 活跃媒体切换时更新读取的元素 */
  setVideo(video: HTMLVideoElement | HTMLImageElement) {
    this.video = video;
    if (this.currentClip) {
      this.render(this.currentClip);
      this.restartLoop();
    }
  }



  private startLoop() {
    if (this.rafId !== null || this.videoFrameCallbackId !== null) return;
    if (this.video instanceof HTMLVideoElement && "requestVideoFrameCallback" in this.video) {
      const video = this.video as HTMLVideoElement & {
        requestVideoFrameCallback: (callback: () => void) => number;
      };
      const loop = () => {
        if (!this.currentClip || this.video !== video) {
          this.videoFrameCallbackId = null;
          return;
        }
        this.render(this.currentClip);
        this.videoFrameCallbackId = video.requestVideoFrameCallback(loop);
      };
      this.videoFrameCallbackId = video.requestVideoFrameCallback(loop);
      return;
    }
    const loop = () => {
      if (this.currentClip) this.render(this.currentClip);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stopLoop() {
    if (this.videoFrameCallbackId !== null && this.video instanceof HTMLVideoElement && "cancelVideoFrameCallback" in this.video) {
      const video = this.video as HTMLVideoElement & {
        cancelVideoFrameCallback: (id: number) => void;
      };
      video.cancelVideoFrameCallback(this.videoFrameCallbackId);
      this.videoFrameCallbackId = null;
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private restartLoop() {
    this.stopLoop();
    this.startLoop();
  }

  render(clip: Clip) {
    const gl = this.gl;
    if (!gl || !this.program) return;
    if (!this.video) return;
    if (this.video instanceof HTMLVideoElement && this.video.readyState < 2) return;
    if (this.video instanceof HTMLImageElement && !this.video.complete) return;

    // 判断当前 clip 是否需要滤镜处理
    const hasColor = (clip.brightness ?? 0) !== 0 || (clip.contrast ?? 0) !== 0 || (clip.saturation ?? 0) !== 0
      || (clip.temperature ?? 0) !== 0 || (clip.tint ?? 0) !== 0;
    const hasLut = clip.filter && clip.filter !== "none" && this.currentLutName === clip.filter;
    const needsRender = hasColor || hasLut;

    if (!needsRender) {
      // 无滤镜 → 清空 canvas（透明），让下面的 video 直接显示
      this.canvas.style.display = "none";
      return;
    }
    this.canvas.style.display = "block";

    const w = this.video instanceof HTMLVideoElement ? this.video.videoWidth : this.video.naturalWidth;
    const h = this.video instanceof HTMLVideoElement ? this.video.videoHeight : this.video.naturalHeight;
    if (w === 0 || h === 0) return;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0); // 透明背景
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);
    } catch (error) {
      console.warn("FilterRenderer failed to upload media texture", error);
      return;
    }
    gl.uniform1i(gl.getUniformLocation(this.program, "u_image"), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_lut"), 1);

    const brightness = (clip.brightness ?? 0) / 100;
    const contrast = 1 + (clip.contrast ?? 0) / 100;
    const saturation = 1 + (clip.saturation ?? 0) / 100;
    const temperature = (clip.temperature ?? 0) / 100;
    const tint = (clip.tint ?? 0) / 100;
    gl.uniform1f(gl.getUniformLocation(this.program, "u_lutSize"), this.lutSize);
    gl.uniform1f(gl.getUniformLocation(this.program, "u_brightness"), brightness);
    gl.uniform1f(gl.getUniformLocation(this.program, "u_contrast"), contrast);
    gl.uniform1f(gl.getUniformLocation(this.program, "u_saturation"), saturation);
    gl.uniform1f(gl.getUniformLocation(this.program, "u_temperature"), temperature);
    gl.uniform1f(gl.getUniformLocation(this.program, "u_tint"), tint);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_useLut"), hasLut ? 1 : 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

 dispose() {
   if (this.gl) {
      this.stopLoop();
     if (this.videoTexture) this.gl.deleteTexture(this.videoTexture);
      if (this.lutTexture) this.gl.deleteTexture(this.lutTexture);
      if (this.program) this.gl.deleteProgram(this.program);
    }
    this.gl = null;
  }
}
