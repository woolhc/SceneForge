import { readFileSync, statSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const requireText = (path, value) => {
  if (!read(path).includes(value)) {
    throw new Error(`${path} must contain ${value}`);
  }
};

const rejectText = (path, value) => {
  if (read(path).includes(value)) {
    throw new Error(`${path} must not contain ${value}`);
  }
};

for (const path of [
  "index.html",
  "src/panels/HomeScreen.tsx",
  "src-tauri/tauri.conf.json",
  "src-tauri/src/lib.rs",
]) {
  requireText(path, "SceneForge");
  rejectText(path, "SceneScript");
}

requireText("src-tauri/tauri.conf.json", '"identifier": "com.scenescript.desktop"');
requireText("src-tauri/src/storage.rs", 'join("SceneScriptDesktop")');
requireText("src-tauri/src/storage.rs", 'join("scenescript.sqlite3")');
requireText("src/tauri.ts", '"scenescript-desktop-web-state"');
requireText("src/panels/HomeScreen.tsx", "SceneForgeLogo");
requireText("src/components/SceneForgeLogo.tsx", "viewBox=\"0 0 1024 1024\"");
rejectText("src/panels/HomeScreen.tsx", "<Film size={24} />");

const svg = read("src-tauri/icons/icon.svg");
for (const value of [
  "0 0 1024 1024",
  "#111416",
  "#22D3A6",
  "#F3C969",
  "#F2F0EA",
]) {
  if (!svg.includes(value)) {
    throw new Error(`icon.svg must contain ${value}`);
  }
}

for (const forbidden of ["<text", "<filter", "linearGradient", "radialGradient"]) {
  if (svg.includes(forbidden)) {
    throw new Error(`icon.svg must not contain ${forbidden}`);
  }
}

for (const path of [
  "src-tauri/icons/icon.png",
  "src-tauri/icons/icon.icns",
  "src-tauri/icons/icon.ico",
  "src-tauri/icons/32x32.png",
  "src-tauri/icons/64x64.png",
  "src-tauri/icons/128x128.png",
  "src-tauri/icons/128x128@2x.png",
]) {
  if (statSync(new URL(`../${path}`, import.meta.url)).size === 0) {
    throw new Error(`${path} is empty`);
  }
}

const png = readFileSync(new URL("../src-tauri/icons/icon.png", import.meta.url));
if (png.readUInt32BE(16) !== 1024 || png.readUInt32BE(20) !== 1024) {
  throw new Error("icon.png must be 1024x1024");
}

console.log("SceneForge brand and icon assets verified.");
