import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// 运行时错误捕获：自动写到 localStorage + Tauri 文件，便于诊断
const ERROR_LOG_KEY = "scenescript-error-log";
const errors: string[] = [];

function flushToFile() {
  const content = errors.join("\n");
  if (!content) return;
  // 尝试通过 Tauri invoke 写文件（桌面端）
  if ("__TAURI_INTERNALS__" in window) {
    import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("write_debug_log", { content }))
      .catch(() => {});
  }
}

function logError(type: string, info: unknown) {
  const entry = `[${new Date().toISOString()}] ${type}: ${info instanceof Error ? info.stack || info.message : String(info)}`;
  console.error(entry);
  errors.push(entry);
  try {
    const prev = localStorage.getItem(ERROR_LOG_KEY) || "";
    const next = (prev + "\n" + entry).slice(-8000);
    localStorage.setItem(ERROR_LOG_KEY, next);
  } catch {
    /* ignore */
  }
  // 防抖写文件（避免高频错误打爆 fs）
  clearTimeout((logError as unknown as { _t?: number })._t);
  (logError as unknown as { _t?: number })._t = window.setTimeout(flushToFile, 500);
}

window.addEventListener("error", (e) => logError("window.error", e.error || e.message));
window.addEventListener("unhandledrejection", (e) => logError("unhandledrejection", e.reason));

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
