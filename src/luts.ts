/**
 * LUT 滤镜配置。
 * .cube 文件在 src-tauri/luts/ 目录，通过 Tauri 命令读取。
 * 预览端：WebGL 3D 纹理采样（FilterRenderer）
 * 导出端：ffmpeg lut3d 滤镜
 */

export type LutFilter = {
  id: string;       // 文件名（不含 .cube）
  label: string;    // 显示名称
};

/** 内置 LUT 滤镜列表（对应 luts/ 目录下的 .cube 文件） */
export const LUT_FILTERS: LutFilter[] = [
  { id: "none", label: "无" },
  { id: "cinematic", label: "电影" },
  { id: "vintage", label: "复古" },
  { id: "bw", label: "黑白" },
  { id: "sepia", label: "怀旧" },
  { id: "warm", label: "暖色" },
  { id: "cool", label: "冷色" },
  { id: "fresh", label: "清新" },
  { id: "moody", label: "质感" },
  { id: "soft", label: "柔和" },
];

/** 缓存已加载的 LUT 数据（id → 打平的 Uint8Array） */
const lutCache = new Map<string, Uint8Array>();

/**
 * 解析 .cube 文件文本 → 打平的 RGBA Uint8Array（33*33*33*4 字节）。
 * 3D LUT 打平成 2D：每个 blue slice 是一行（width=33），所有 slice 堆叠成 height=33。
 */
export function parseCubeData(cubeText: string, size = 33): Uint8Array {
  const lines = cubeText.split("\n");
  const data = new Uint8Array(size * size * size * 4);
  let idx = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("TITLE") ||
        trimmed.startsWith("LUT_3D_SIZE") || trimmed.startsWith("DOMAIN")) {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length < 3 || idx >= size * size * size) continue;
    const r = Math.round(parseFloat(parts[0]) * 255);
    const g = Math.round(parseFloat(parts[1]) * 255);
    const b = Math.round(parseFloat(parts[2]) * 255);
    data[idx * 4] = r;
    data[idx * 4 + 1] = g;
    data[idx * 4 + 2] = b;
    data[idx * 4 + 3] = 255;
    idx++;
  }
  return data;
}

/**
 * 获取 LUT 数据（从 Tauri 命令读取 .cube 文件）。
 * 结果缓存在内存，避免重复解析。
 */
export async function getLutData(lutId: string): Promise<Uint8Array | null> {
  if (lutCache.has(lutId)) return lutCache.get(lutId)!;
  try {
    // 通过 Tauri invoke 读取 .cube 文件内容
    const { invoke } = await import("@tauri-apps/api/core");
    const isTauri = "__TAURI_INTERNALS__" in window;
    if (!isTauri) return null;

    const content = await invoke<string>("read_lut_file", { name: lutId });
    const data = parseCubeData(content);
    lutCache.set(lutId, data);
    return data;
  } catch {
    return null;
  }
}
