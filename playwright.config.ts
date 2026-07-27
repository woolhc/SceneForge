import { defineConfig } from "@playwright/test";

/**
 * SceneForge E2E 配置。
 * Tauri 桌面应用的 E2E 需要 `tauri-driver`（WebDriver 适配），
 * 开发阶段先用 web 预览模式（vite dev server）跑 UI 冒烟，
 * 后续接入 tauri-driver 做完整桌面 E2E。
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3100",
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: true,
    timeout: 30000,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
