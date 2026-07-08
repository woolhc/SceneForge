import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function run(command, args) {
  try {
    return await exec(command, args, { maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    const stderr = error?.stderr || error?.message || String(error);
    throw new Error(`${command} failed: ${stderr}`);
  }
}

async function streamInfo(path) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,codec_name,avg_frame_rate",
    "-of",
    "json",
    path,
  ]);
  return JSON.parse(stdout).streams[0];
}

const dir = await mkdtemp(join(tmpdir(), "scenescript-proxy-"));
try {
  const source = join(dir, "source-4k.mp4");
  const proxy = join(dir, "proxy-v2.mp4");
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=3840x2160:r=30",
    "-t",
    "1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-an",
    source,
  ]);
  await run("ffmpeg", [
    "-y",
    "-i",
    source,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-vf",
    "scale='if(gte(iw,ih),min(960,iw),-2)':'if(gte(iw,ih),-2,min(960,ih))'",
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-threads",
    "2",
    "-g",
    "30",
    "-keyint_min",
    "30",
    "-sc_threshold",
    "0",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-movflags",
    "+faststart",
    proxy,
  ]);
  const sourceInfo = await streamInfo(source);
  const proxyInfo = await streamInfo(proxy);
  if (sourceInfo.width !== 3840 || sourceInfo.height !== 2160) {
    throw new Error(`unexpected source resolution ${sourceInfo.width}x${sourceInfo.height}`);
  }
  if (proxyInfo.width !== 960 || proxyInfo.height !== 540) {
    throw new Error(`unexpected proxy resolution ${proxyInfo.width}x${proxyInfo.height}`);
  }
  if (proxyInfo.codec_name !== "h264") {
    throw new Error(`unexpected proxy codec ${proxyInfo.codec_name}`);
  }
  if (proxyInfo.avg_frame_rate !== "30/1") {
    throw new Error(`unexpected proxy frame rate ${proxyInfo.avg_frame_rate}`);
  }
  console.log(`proxy generation ok: ${sourceInfo.width}x${sourceInfo.height} -> ${proxyInfo.width}x${proxyInfo.height} ${proxyInfo.codec_name}`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
