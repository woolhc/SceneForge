import type { Clip } from "../types";

type LayerParams = {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  brightness: number;
  contrast: number;
  saturation: number;
  cornerRadius: number;
  maskKind: number;
  maskCx: number;
  maskCy: number;
  maskWidth: number;
  maskHeight: number;
  maskRotation: number;
  maskFeather: number;
  maskInvert: boolean;
  lutData?: Uint8Array | null;
};

const VS = `
attribute vec2 a_position;
varying vec2 v_canvas;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_canvas = a_position * 0.5 + 0.5;
}
`;

const FS = `
precision highp float;
varying vec2 v_canvas;
uniform sampler2D u_image;
uniform sampler2D u_lut;
uniform vec2 u_canvasSize;
uniform vec2 u_center;
uniform vec2 u_layerSize;
uniform float u_rotation;
uniform float u_opacity;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_cornerRadius;
uniform int u_maskKind;
uniform vec2 u_maskCenter;
uniform vec2 u_maskSize;
uniform float u_maskRotation;
uniform float u_maskFeather;
uniform bool u_maskInvert;
uniform bool u_useLut;
uniform float u_lutSize;

float roundedRectAlpha(vec2 p, vec2 halfSize, float radius) {
  if (radius <= 0.0) return 1.0;
  vec2 q = abs(p) - halfSize + vec2(radius);
  float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  return 1.0 - smoothstep(-1.0, 1.0, dist);
}

float maskAlpha(vec2 uv) {
  if (u_maskKind == 0) return 1.0;
  vec2 p = uv - u_maskCenter;
  float c = cos(-u_maskRotation);
  float s = sin(-u_maskRotation);
  p = mat2(c, -s, s, c) * p;
  float dist = 0.0;
  if (u_maskKind == 1) {
    vec2 r = max(u_maskSize * 0.5, vec2(0.0001));
    dist = length(p / r) - 1.0;
  } else {
    vec2 d = abs(p) - u_maskSize * 0.5;
    dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }
  float feather = max(u_maskFeather, 0.0001);
  float alpha = 1.0 - smoothstep(0.0, feather, dist);
  return u_maskInvert ? 1.0 - alpha : alpha;
}

vec3 applyLut(vec3 color) {
  float bIdx = color.b * (u_lutSize - 1.0);
  float slice0 = floor(bIdx);
  float slice1 = min(slice0 + 1.0, u_lutSize - 1.0);
  float f = bIdx - slice0;
  float sliceSize = 1.0 / u_lutSize;
  float pixel = 0.5 / (u_lutSize * u_lutSize);
  vec2 uv0 = vec2(slice0 * sliceSize + color.r * (sliceSize - 1.0 / (u_lutSize * u_lutSize)) + pixel,
                  color.g * ((u_lutSize - 1.0) / u_lutSize) + 0.5 / u_lutSize);
  vec2 uv1 = vec2(slice1 * sliceSize + color.r * (sliceSize - 1.0 / (u_lutSize * u_lutSize)) + pixel,
                  uv0.y);
  return mix(texture2D(u_lut, uv0).rgb, texture2D(u_lut, uv1).rgb, f);
}

void main() {
  vec2 canvasPx = vec2(v_canvas.x * u_canvasSize.x, (1.0 - v_canvas.y) * u_canvasSize.y);
  vec2 p = canvasPx - u_center;
  float c = cos(-u_rotation);
  float s = sin(-u_rotation);
  vec2 local = mat2(c, -s, s, c) * p;
  vec2 uv = local / u_layerSize + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;

  vec4 color = texture2D(u_image, uv);
  color.rgb += u_brightness;
  color.rgb = (color.rgb - 0.5) * u_contrast + 0.5;
  float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
  color.rgb = mix(vec3(luma), color.rgb, u_saturation);
  color.rgb = clamp(color.rgb, 0.0, 1.0);
  if (u_useLut) color.rgb = applyLut(color.rgb);

  float alpha = color.a * u_opacity;
  alpha *= roundedRectAlpha(local, u_layerSize * 0.5, u_cornerRadius);
  alpha *= maskAlpha(uv);
  if (alpha <= 0.001) discard;
  gl_FragColor = vec4(color.rgb * alpha, alpha);
}
`;

export class WebGLCompositor {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private sourceTexture: WebGLTexture;
  private lutTexture: WebGLTexture;
  private lutSize = 33;
  private currentLutData: Uint8Array | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", {
      alpha: false,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("WebGL unavailable");
    this.gl = gl;
    const vs = this.compile(gl.VERTEX_SHADER, VS);
    const fs = this.compile(gl.FRAGMENT_SHADER, FS);
    const program = gl.createProgram();
    if (!program) throw new Error("WebGL program unavailable");
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || "WebGL link failed");
    }
    this.program = program;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.sourceTexture = this.createTexture();
    this.lutTexture = this.createTexture();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  resize(width: number, height: number) {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  clear() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  drawLayer(source: CanvasImageSource, params: LayerParams) {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
    } catch (error) {
      console.warn("WebGLCompositor failed to upload media texture", error);
      return;
    }
    gl.uniform1i(gl.getUniformLocation(this.program, "u_image"), 0);

    const useLut = !!params.lutData;
    if (params.lutData && params.lutData !== this.currentLutData) {
      this.currentLutData = params.lutData;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.lutSize * this.lutSize, this.lutSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, params.lutData);
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_lut"), 1);

    this.uniform2("u_canvasSize", this.canvas.width, this.canvas.height);
    this.uniform2("u_center", params.centerX, params.centerY);
    this.uniform2("u_layerSize", params.width, params.height);
    this.uniform2("u_maskCenter", params.maskCx, params.maskCy);
    this.uniform2("u_maskSize", params.maskWidth, params.maskHeight);
    this.uniform1("u_rotation", params.rotation);
    this.uniform1("u_opacity", params.opacity);
    this.uniform1("u_brightness", params.brightness);
    this.uniform1("u_contrast", params.contrast);
    this.uniform1("u_saturation", params.saturation);
    this.uniform1("u_cornerRadius", params.cornerRadius);
    this.uniform1("u_maskRotation", params.maskRotation);
    this.uniform1("u_maskFeather", params.maskFeather);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_maskKind"), params.maskKind);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_maskInvert"), params.maskInvert ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_useLut"), useLut ? 1 : 0);
    this.uniform1("u_lutSize", this.lutSize);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  readPixel(x: number, y: number) {
    const pixel = new Uint8Array(4);
    this.gl.readPixels(x, this.canvas.height - y - 1, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixel);
    return Array.from(pixel);
  }

  dispose() {
    this.gl.deleteTexture(this.sourceTexture);
    this.gl.deleteTexture(this.lutTexture);
    this.gl.deleteProgram(this.program);
  }

  private compile(type: number, source: string) {
    const shader = this.gl.createShader(type);
    if (!shader) throw new Error("WebGL shader unavailable");
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      throw new Error(this.gl.getShaderInfoLog(shader) || "WebGL compile failed");
    }
    return shader;
  }

  private createTexture() {
    const texture = this.gl.createTexture();
    if (!texture) throw new Error("WebGL texture unavailable");
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    return texture;
  }

  private uniform1(name: string, value: number) {
    this.gl.uniform1f(this.gl.getUniformLocation(this.program, name), value);
  }

  private uniform2(name: string, x: number, y: number) {
    this.gl.uniform2f(this.gl.getUniformLocation(this.program, name), x, y);
  }
}

export function layerParamsForClip(
  clip: Clip | null,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  opacity = 1,
  rotation = 0,
  lutData?: Uint8Array | null,
): LayerParams {
  const mask = clip?.mask;
  return {
    centerX,
    centerY,
    width,
    height,
    rotation,
    opacity,
    brightness: (clip?.brightness ?? 0) / 100,
    contrast: 1 + (clip?.contrast ?? 0) / 100,
    saturation: 1 + (clip?.saturation ?? 0) / 100,
    cornerRadius: clip?.transform?.cornerRadius ?? 0,
    maskKind: mask?.kind === "circle" ? 1 : mask?.kind === "rect" ? 2 : 0,
    maskCx: mask?.cx ?? 0.5,
    maskCy: mask?.cy ?? 0.5,
    maskWidth: mask?.width ?? 1,
    maskHeight: mask?.height ?? 1,
    maskRotation: ((mask?.rotation ?? 0) * Math.PI) / 180,
    maskFeather: mask?.feather ?? 0,
    maskInvert: mask?.invert ?? false,
    lutData,
  };
}
