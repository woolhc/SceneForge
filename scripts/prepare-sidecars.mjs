#!/usr/bin/env node
import { access, chmod, copyFile, mkdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binariesDir = resolve(repoRoot, "src-tauri", "binaries");
const require = createRequire(import.meta.url);

const tools = [
  {
    name: "ffmpeg",
    env: ["SCENEFORGE_FFMPEG_BIN", "FFMPEG_BIN"],
    package: "ffmpeg-static",
    candidates: ["ffmpeg"],
  },
  {
    name: "ffprobe",
    env: ["SCENEFORGE_FFPROBE_BIN", "FFPROBE_BIN"],
    package: "@derhuerst/ffprobe-static",
    candidates: ["ffprobe"],
  },
  {
    name: "whisper-cli",
    env: ["SCENEFORGE_WHISPER_BIN", "SCENEFORGE_WHISPER_CLI_BIN", "WHISPER_CLI_BIN", "WHISPER_BIN"],
    candidates: ["whisper-cli", "main"],
  },
];

function parseArgs(argv) {
  const options = {
    target: process.env.TARGET_TRIPLE || process.env.CARGO_BUILD_TARGET || "",
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target" && argv[index + 1]) {
      options.target = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--target=")) {
      options.target = arg.slice("--target=".length);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    }
  }

  return options;
}

function hostTriple() {
  const output = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
  if (output.status === 0) {
    const host = output.stdout.match(/^host:\s*(.+)$/m)?.[1]?.trim();
    if (host) {
      return host;
    }
  }

  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch;
  if (process.platform === "darwin") return `${arch}-apple-darwin`;
  if (process.platform === "win32") return `${arch}-pc-windows-msvc`;
  if (process.platform === "linux") return `${arch}-unknown-linux-gnu`;

  throw new Error(
    "Unable to determine target triple. Set TARGET_TRIPLE or pass --target <triple>.",
  );
}

function tauriTargetTriple() {
  const { TAURI_ENV_ARCH, TAURI_ENV_PLATFORM, TAURI_ENV_FAMILY } = process.env;
  if (!TAURI_ENV_ARCH || !TAURI_ENV_PLATFORM) {
    return "";
  }

  const arch = TAURI_ENV_ARCH === "x86_64" || TAURI_ENV_ARCH === "aarch64"
    ? TAURI_ENV_ARCH
    : TAURI_ENV_ARCH === "x64"
      ? "x86_64"
      : TAURI_ENV_ARCH === "arm64"
        ? "aarch64"
        : TAURI_ENV_ARCH;

  if (TAURI_ENV_PLATFORM === "darwin" || TAURI_ENV_PLATFORM === "macos") {
    return `${arch}-apple-darwin`;
  }
  if (TAURI_ENV_PLATFORM === "windows" || TAURI_ENV_PLATFORM === "win32") {
    return `${arch}-pc-windows-msvc`;
  }
  if (TAURI_ENV_PLATFORM === "linux" || TAURI_ENV_FAMILY === "unix") {
    return `${arch}-unknown-linux-gnu`;
  }

  return "";
}

function normalizeTarget(target) {
  if (!target || target === "host") {
    return tauriTargetTriple() || hostTriple();
  }
  if (target === "universal-apple-darwin") {
    return target;
  }
  return target;
}

function executableNames(command) {
  const names = [command];
  if (process.platform === "win32" && !command.toLowerCase().endsWith(".exe")) {
    names.push(`${command}.exe`);
  }
  return names;
}

async function isExecutable(path) {
  try {
    const file = await stat(path);
    if (!file.isFile()) return false;
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function findOnPath(command) {
  const pathEntries = (process.env.PATH || "").split(delimiter).filter(Boolean);
  for (const pathEntry of pathEntries) {
    for (const name of executableNames(command)) {
      const candidate = join(pathEntry, name);
      if (await isExecutable(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

async function resolveTool(tool, allowPathDiscovery = true) {
  for (const envName of tool.env) {
    const value = process.env[envName];
    if (!value) continue;

    const candidate = isAbsolute(value) ? value : resolve(repoRoot, value);
    if (await isExecutable(candidate)) {
      return { source: candidate, via: envName };
    }
    throw new Error(`${envName} points to a missing or unreadable file: ${candidate}`);
  }

  if (allowPathDiscovery && tool.package) {
    try {
      const packagePath = require(tool.package);
      if (typeof packagePath === "string" && await isExecutable(packagePath)) {
        return { source: packagePath, via: tool.package };
      }
    } catch {
      // Optional package fallback; PATH discovery below still supports developer tools.
    }
  }

  if (allowPathDiscovery) {
    for (const command of tool.candidates) {
      const candidate = await findOnPath(command);
      if (candidate) {
        return { source: candidate, via: "PATH" };
      }
    }
  }

  throw new Error(
    `Unable to find ${tool.name}. Set ${tool.env[0]} to an executable path or install it on PATH.`,
  );
}

function targetExtension(target) {
  return target.includes("windows") ? ".exe" : "";
}

function targetPlatform(target) {
  if (target.includes("windows")) return "win32";
  if (target.includes("apple-darwin")) return "darwin";
  if (target.includes("linux")) return "linux";
  return "unknown";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const target = normalizeTarget(options.target);
  const extension = targetExtension(target);
  const allowPathDiscovery = targetPlatform(target) === process.platform;

  await mkdir(binariesDir, { recursive: true });

  const staged = [];
  for (const tool of tools) {
    const resolved = await resolveTool(tool, allowPathDiscovery);
    const destination = join(binariesDir, `${tool.name}-${target}${extension}`);

    if (!options.dryRun) {
      await copyFile(resolved.source, destination);
      if (!extension) {
        await chmod(destination, 0o755);
      }
    }

    staged.push({ ...tool, ...resolved, destination });
  }

  for (const item of staged) {
    const relativeDestination = item.destination.replace(`${repoRoot}/`, "");
    console.log(`${options.dryRun ? "Would stage" : "Staged"} ${item.name} from ${item.source} (${item.via}) -> ${relativeDestination}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
