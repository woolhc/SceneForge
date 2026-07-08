#!/usr/bin/env python3
import subprocess
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SMOKE_DIR = ROOT / "public" / "smoke"
PORT = 3137
URL = f"http://127.0.0.1:{PORT}/"


def run(args, **kwargs):
    subprocess.run(args, cwd=ROOT, check=True, **kwargs)


def wait_for_server(proc):
    last_error = None
    for _ in range(80):
        if proc.poll() is not None:
            raise RuntimeError("Vite smoke server exited early")
        try:
            with urllib.request.urlopen(URL, timeout=0.25) as response:
                if response.status == 200:
                    return
        except Exception as error:
            last_error = error
        time.sleep(0.1)
    raise RuntimeError(f"Vite smoke server did not start: {last_error}")


def make_fixture(name, color, size):
    output = SMOKE_DIR / name
    run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=c={color}:s={size}:r=30",
            "-t",
            "1",
            "-c:v",
            "libaom-av1",
            "-cpu-used",
            "8",
            "-crf",
            "40",
            "-pix_fmt",
            "yuv420p",
            "-an",
            str(output),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def run_smoke():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 800, "height": 600})
        logs = []
        page.on("console", lambda msg: logs.append(f"{msg.type}: {msg.text}"))
        page.goto(URL, wait_until="networkidle")
        result = page.evaluate(
            """
            async () => {
              localStorage.setItem('scenescript:webcodecs-preview', '1');
              const mod = await import('/src/preview/WebCodecsRenderer.ts');
              const stage = document.createElement('div');
              stage.style.width = '320px';
              stage.style.height = '180px';
              stage.style.position = 'fixed';
              stage.style.left = '0';
              stage.style.top = '0';
              document.body.appendChild(stage);
              const ticks = [];
              const renderer = new mod.WebCodecsRenderer(stage, state => ticks.push(state));
              renderer.resolveLocal = path => path;
              const project = {
                id: 'smoke', title: 'smoke', script: '', ratio: '16:9', fps: 30,
                media: [
                  { id: 'base', kind: 'video', title: 'base', url: '/smoke/base-av1.mp4', width: 160, height: 90, duration: 1, source: 'local' },
                  { id: 'overlay', kind: 'video', title: 'overlay', url: '/smoke/overlay-av1.mp4', width: 80, height: 44, duration: 1, source: 'local' },
                ],
                tracks: [
                  { id: 'v1', kind: 'video', name: 'base', order: 2, muted: false, locked: false },
                  { id: 'v2', kind: 'video', name: 'overlay', order: 1, muted: false, locked: false },
                ],
                clips: [
                  { id: 'baseClip', trackId: 'v1', sourceId: 'base', startOnTrack: 0, duration: 1, sourceIn: 0, sourceOut: 1, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, brightness: 0, contrast: 0, saturation: 0, transform: null },
                  { id: 'overlayClip', trackId: 'v2', sourceId: 'overlay', startOnTrack: 0, duration: 1, sourceIn: 0, sourceOut: 1, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0, brightness: 0, contrast: 0, saturation: 0, transform: { x: 25, y: 25, scale: 50, opacity: 100, cornerRadius: 0, mix: 'normal', rotation: 0 } },
                ],
                renderConfig: { fps: 30, preset: 'preview-fast', resolution: '1080p', bitrateMbps: 0, codec: 'h264', exportMode: 'video', transitionDuration: 0.5 },
                previewPath: null, finalPath: null, createdAt: '', updatedAt: ''
              };
              renderer.setProject(project);
              const canvas = stage.querySelector('canvas');
              const samplePixel = (x, y) => {
                const gl = canvas.getContext('webgl');
                if (gl) {
                  const pixel = new Uint8Array(4);
                  gl.readPixels(x, canvas.height - y - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                  return Array.from(pixel);
                }
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                return Array.from(ctx.getImageData(x, y, 1, 1).data);
              };
              const sample = () => {
                const w = canvas.width, h = canvas.height;
                if (!w || !h) return { w, h, center: [0,0,0,0], overlay: [0,0,0,0] };
                return {
                  w, h,
                  center: samplePixel(Math.floor(w*0.75), Math.floor(h*0.75)),
                  overlay: samplePixel(Math.floor(w*0.35), Math.floor(h*0.35)),
                };
              };
              let pixels = sample();
              for (let i = 0; i < 50; i++) {
                renderer.seek(0.2);
                await new Promise(resolve => setTimeout(resolve, 100));
                pixels = sample();
                const redBase = pixels.center[0] > 80 && pixels.center[0] > pixels.center[2];
                const blueOverlay = pixels.overlay[2] > pixels.overlay[0] && pixels.overlay[2] > 80;
                if (redBase && blueOverlay) break;
              }
              const finalTick = ticks[ticks.length - 1] || null;
              renderer.dispose();
              return {
                gate: mod.canUseWebCodecsRenderer(),
                videoDecoder: 'VideoDecoder' in window,
                pixels,
                ticks: ticks.length,
                activeVideoClip: finalTick?.activeVideoClip?.id || null,
                overlayCount: finalTick?.activeOverlayClips?.length || 0,
              };
            }
            """
        )
        browser.close()

    assert result["videoDecoder"], "VideoDecoder missing in browser"
    assert result["gate"], "WebCodecs feature gate not enabled"
    center = result["pixels"]["center"]
    overlay = result["pixels"]["overlay"]
    assert center[0] > 80 and center[0] > center[2], f"base red pixel missing: {result}"
    assert overlay[2] > overlay[0] and overlay[2] > 80, f"blue overlay pixel missing: {result}"
    assert result["overlayCount"] == 1, f"overlay publish missing: {result}"
    print(f"webcodecs preview smoke ok: center={center}, overlay={overlay}, ticks={result['ticks']}")


def run_five_clip_smoke():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 800, "height": 600})
        page.goto(URL, wait_until="networkidle")
        result = page.evaluate(
            """
            async () => {
              localStorage.setItem('scenescript:webcodecs-preview', '1');
              const { WebCodecsRenderer } = await import('/src/preview/WebCodecsRenderer.ts');
              const stage = document.createElement('div');
              stage.style.width = '320px';
              stage.style.height = '180px';
              document.body.appendChild(stage);
              const renderer = new WebCodecsRenderer(stage, () => {});
              renderer.resolveLocal = path => path;
              const media = [0,1,2,3,4].map(index => ({
                id: `clip-${index}`,
                kind: 'video',
                title: `clip-${index}`,
                url: `/smoke/clip-${index}.mp4`,
                width: 160,
                height: 90,
                duration: 1,
                source: 'local',
              }));
              const clips = media.map((item, index) => ({
                id: `timeline-${index}`,
                trackId: 'v1',
                sourceId: item.id,
                startOnTrack: index,
                duration: 1,
                sourceIn: 0,
                sourceOut: 1,
                speed: 1,
                volume: 1,
                fadeIn: 0,
                fadeOut: 0,
                brightness: 0,
                contrast: 0,
                saturation: 0,
                transform: null,
              }));
              renderer.setProject({
                id: 'five', title: 'five', script: '', ratio: '16:9', fps: 30,
                media,
                tracks: [{ id: 'v1', kind: 'video', name: 'base', order: 1, muted: false, locked: false }],
                clips,
                renderConfig: { fps: 30, preset: 'preview-fast', resolution: '1080p', bitrateMbps: 0, codec: 'h264', exportMode: 'video', transitionDuration: 0.5 },
                previewPath: null, finalPath: null, createdAt: '', updatedAt: ''
              });
              const canvas = stage.querySelector('canvas');
              const sample = () => {
                const w = canvas.width, h = canvas.height;
                if (!w || !h) return [0,0,0,0];
                const x = Math.floor(w/2), y = Math.floor(h/2);
                const gl = canvas.getContext('webgl');
                if (gl) {
                  const pixel = new Uint8Array(4);
                  gl.readPixels(x, h - y - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
                  return Array.from(pixel);
                }
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                return Array.from(ctx.getImageData(x, y, 1, 1).data);
              };
              const pixels = [];
              for (let index = 0; index < 5; index++) {
                let px = [0,0,0,0];
                for (let retry = 0; retry < 40; retry++) {
                  renderer.seek(index + 0.2);
                  await new Promise(resolve => setTimeout(resolve, 80));
                  px = sample();
                  if (px[0] + px[1] + px[2] > 40) break;
                }
                pixels.push(px);
              }
              renderer.dispose();
              return pixels;
            }
            """
        )
        browser.close()

    for index, pixel in enumerate(result):
        assert sum(pixel[:3]) > 40, f"five-clip smoke frame {index} is blank: {result}"
    print(f"webcodecs five-clip seek smoke ok: pixels={result}")


def run_shader_effect_smoke():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 800, "height": 600})
        page.goto(URL, wait_until="networkidle")
        result = page.evaluate(
            """
            async () => {
              const { WebGLCompositor, layerParamsForClip } = await import('/src/preview/WebGLCompositor.ts');
              const canvas = document.createElement('canvas');
              canvas.width = 160;
              canvas.height = 90;
              document.body.appendChild(canvas);
              const source = document.createElement('canvas');
              source.width = 120;
              source.height = 60;
              const sourceCtx = source.getContext('2d');
              sourceCtx.fillStyle = 'rgb(255,0,0)';
              sourceCtx.fillRect(0, 0, source.width, source.height);
              const lutSize = 33;
              const lut = new Uint8Array(lutSize * lutSize * lutSize * 4);
              let ptr = 0;
              for (let b = 0; b < lutSize; b++) {
                for (let g = 0; g < lutSize; g++) {
                  for (let r = 0; r < lutSize; r++) {
                    lut[ptr++] = 0;
                    lut[ptr++] = 255;
                    lut[ptr++] = 0;
                    lut[ptr++] = 255;
                  }
                }
              }
              const clip = {
                brightness: 0,
                contrast: 0,
                saturation: 0,
                transform: { cornerRadius: 0 },
                mask: { kind: 'circle', cx: 0.5, cy: 0.5, width: 0.82, height: 0.82, rotation: 0.6, feather: 0.08, invert: false },
              };
              const compositor = new WebGLCompositor(canvas);
              compositor.resize(160, 90);
              compositor.clear();
              compositor.drawLayer(source, layerParamsForClip(clip, 80, 45, 120, 60, 1, 0.55, lut));
              const center = compositor.readPixel(80, 45);
              const corner = compositor.readPixel(8, 8);
              compositor.dispose();
              return { center, corner };
            }
            """
        )
        browser.close()
    center = result["center"]
    corner = result["corner"]
    assert center[1] > 180 and center[0] < 80 and center[2] < 80, f"LUT center pixel missing: {result}"
    assert sum(corner[:3]) < 20, f"feather mask corner should be clipped: {result}"
    print(f"webgl shader effect smoke ok: center={center}, corner={corner}")


def run_filter_renderer_paused_lut_smoke():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 800, "height": 600})
        page.goto(URL, wait_until="networkidle")
        result = page.evaluate(
            """
            async () => {
              const { FilterRenderer } = await import('/src/preview/FilterRenderer.ts');
              const source = document.createElement('canvas');
              source.width = 64;
              source.height = 36;
              const sourceCtx = source.getContext('2d');
              sourceCtx.fillStyle = 'rgb(255,0,0)';
              sourceCtx.fillRect(0, 0, source.width, source.height);
              const image = new Image();
              await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = reject;
                image.src = source.toDataURL('image/png');
              });
              const canvas = document.createElement('canvas');
              canvas.width = 64;
              canvas.height = 36;
              document.body.appendChild(canvas);
              const renderer = new FilterRenderer(canvas, image);
              renderer.setClip({ id: 'clip', brightness: 0, contrast: 0, saturation: 0, filter: 'synthetic' });
              const lutSize = 33;
              const lut = new Uint8Array(lutSize * lutSize * lutSize * 4);
              let ptr = 0;
              for (let b = 0; b < lutSize; b++) {
                for (let g = 0; g < lutSize; g++) {
                  for (let r = 0; r < lutSize; r++) {
                    lut[ptr++] = 0;
                    lut[ptr++] = 255;
                    lut[ptr++] = 0;
                    lut[ptr++] = 255;
                  }
                }
              }
              await renderer.loadLut('synthetic', lut);
              const gl = canvas.getContext('webgl');
              const pixel = new Uint8Array(4);
              gl.readPixels(32, 18, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
              renderer.dispose();
              return { pixel: Array.from(pixel), display: canvas.style.display };
            }
            """
        )
        browser.close()
    pixel = result["pixel"]
    assert result["display"] == "block", f"paused LUT canvas was not shown: {result}"
    assert pixel[1] > 180 and pixel[0] < 80 and pixel[2] < 80, f"paused LUT pixel missing: {result}"
    print(f"filter renderer paused LUT smoke ok: pixel={pixel}")


def run_lut_loader_smoke():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 800, "height": 600})
        page.goto(URL, wait_until="networkidle")
        result = page.evaluate(
            """
            async () => {
              const { getLutData } = await import('/src/luts.ts');
              const data = await getLutData('bw');
              return { length: data?.length || 0, first: data ? Array.from(data.slice(0, 4)) : null };
            }
            """
        )
        browser.close()
    assert result["length"] == 33 * 33 * 33 * 4, f"LUT loader failed: {result}"
    print(f"lut loader smoke ok: first={result['first']}")


def main():
    SMOKE_DIR.mkdir(parents=True, exist_ok=True)
    base = SMOKE_DIR / "base-av1.mp4"
    overlay = SMOKE_DIR / "overlay-av1.mp4"
    server = None
    try:
        make_fixture(base.name, "red", "160x90")
        make_fixture(overlay.name, "blue", "80x44")
        for index, color in enumerate(["red", "green", "blue", "yellow", "magenta"]):
            make_fixture(f"clip-{index}.mp4", color, "160x90")
        server = subprocess.Popen(
            ["npx", "vite", "--host", "127.0.0.1", "--port", str(PORT)],
            cwd=ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        wait_for_server(server)
        run_lut_loader_smoke()
        run_shader_effect_smoke()
        run_filter_renderer_paused_lut_smoke()
        run_smoke()
        run_five_clip_smoke()
    finally:
        if server is not None and server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
        base.unlink(missing_ok=True)
        overlay.unlink(missing_ok=True)
        for index in range(5):
            (SMOKE_DIR / f"clip-{index}.mp4").unlink(missing_ok=True)
        try:
            SMOKE_DIR.rmdir()
        except OSError:
            pass


if __name__ == "__main__":
    main()
