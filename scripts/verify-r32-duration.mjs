import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

async function duration(path) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  return Number.parseFloat(stdout.trim());
}

async function makeColor(path, color, seconds) {
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=320x180:r=30`,
    "-t",
    String(seconds),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-an",
    path,
  ]);
}

async function makeTransitionUnit(prev, next, output, seconds) {
  await run("ffmpeg", [
    "-y",
    "-i",
    prev,
    "-i",
    next,
    "-filter_complex",
    `[0:v][1:v]xfade=transition=fade:duration=${seconds}:offset=0,format=yuv420p[vout]`,
    "-map",
    "[vout]",
    "-t",
    String(seconds),
    "-c:v",
    "libx264",
    "-an",
    output,
  ]);
}

async function concat(paths, output) {
  const listPath = `${output}.txt`;
  await writeFile(listPath, paths.map((path) => `file '${path.replaceAll("'", "'\\''")}'`).join("\n"));
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", output]);
}

async function verify(name, actual, expected) {
  const delta = Math.abs(actual - expected);
  if (delta > 0.2) {
    throw new Error(`${name}: expected ${expected}s, got ${actual.toFixed(3)}s`);
  }
  console.log(`${name}: ${actual.toFixed(3)}s ok`);
}

async function verifySinglePassOverlay(dir, red, blue, green) {
  const output = join(dir, "single-pass-overlay.mp4");
  await run("ffmpeg", [
    "-y",
    "-i",
    red,
    "-i",
    blue,
    "-i",
    green,
    "-filter_complex",
    [
      "[0:v]scale=320:180:force_original_aspect_ratio=increase,crop=320:180,setpts=PTS-STARTPTS,format=yuv420p[base0]",
      "[1:v]scale=320:180:force_original_aspect_ratio=increase,crop=320:180,setpts=PTS-STARTPTS,format=yuv420p[base1]",
      "[base0][base1]concat=n=2:v=1:a=0[baseout]",
      "[2:v]scale=128:72:force_original_aspect_ratio=decrease,setpts=PTS-STARTPTS+1.000/TB,format=yuva420p,colorchannelmixer=aa=0.800[ov0]",
      "[baseout][ov0]overlay=(w-W)*0.2500:(h-H)*0.2500:enable='between(t,1.000,2.000)'[mix0]",
      "[mix0]format=yuv420p[vout]",
    ].join(";"),
    "-map",
    "[vout]",
    "-t",
    "4",
    "-c:v",
    "libx264",
    "-an",
    output,
  ]);
  await verify("single-pass overlay graph", await duration(output), 4.0);
}

const dir = await mkdtemp(join(tmpdir(), "scenescript-r32-"));
try {
  const red = join(dir, "red.mp4");
  const blue = join(dir, "blue.mp4");
  const green = join(dir, "green.mp4");
  await makeColor(red, "red", 2);
  await makeColor(blue, "blue", 2);
  await makeColor(green, "green", 2);

  const normalA = join(dir, "normal-a.mp4");
  const normalBFull = join(dir, "normal-b-full.mp4");
  const normalBMiddle = join(dir, "normal-b-middle.mp4");
  const normalC = join(dir, "normal-c.mp4");
  const transAB = join(dir, "trans-ab.mp4");
  const transBC = join(dir, "trans-bc.mp4");
  await run("ffmpeg", ["-y", "-i", red, "-t", "1.5", "-c", "copy", normalA]);
  await run("ffmpeg", ["-y", "-i", blue, "-t", "2.0", "-c", "copy", normalBFull]);
  await run("ffmpeg", ["-y", "-i", blue, "-t", "1.5", "-c", "copy", normalBMiddle]);
  await run("ffmpeg", ["-y", "-i", green, "-t", "2.0", "-c", "copy", normalC]);
  await makeTransitionUnit(red, blue, transAB, 0.5);
  await makeTransitionUnit(blue, green, transBC, 0.5);

  const twoClip = join(dir, "two-clip.mp4");
  await concat([normalA, transAB, normalBFull], twoClip);
  await verify("two clips + one transition", await duration(twoClip), 4.0);

  const threeClip = join(dir, "three-clip.mp4");
  await concat([normalA, transAB, normalBMiddle, transBC, normalC], threeClip);
  await verify("three clips + two transitions", await duration(threeClip), 6.0);

  await verifySinglePassOverlay(dir, red, blue, green);
} finally {
  await rm(dir, { recursive: true, force: true });
}
