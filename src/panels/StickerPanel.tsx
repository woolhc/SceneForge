import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { MediaSource } from "../types";

/**
 * P2-2 贴纸库：内置 emoji/符号贴纸，前端 canvas 渲染为 PNG → 后端落盘为 image 素材。
 * 添加到时间线后复用现有 image overlay 全套能力（transform/关键帧/蒙版/导出）。
 */

type StickerDef = { id: string; label: string; glyph: string };

const STICKER_GROUPS: { name: string; items: StickerDef[] }[] = [
  {
    name: "表情",
    items: [
      { id: "emoji-smile", label: "笑脸", glyph: "😄" },
      { id: "emoji-laugh", label: "笑哭", glyph: "😂" },
      { id: "emoji-love", label: "爱心眼", glyph: "😍" },
      { id: "emoji-cool", label: "墨镜", glyph: "😎" },
      { id: "emoji-wow", label: "惊讶", glyph: "😮" },
      { id: "emoji-cry", label: "大哭", glyph: "😭" },
      { id: "emoji-angry", label: "生气", glyph: "😡" },
      { id: "emoji-think", label: "思考", glyph: "🤔" },
    ],
  },
  {
    name: "手势",
    items: [
      { id: "hand-thumbup", label: "点赞", glyph: "👍" },
      { id: "hand-clap", label: "鼓掌", glyph: "👏" },
      { id: "hand-ok", label: "OK", glyph: "👌" },
      { id: "hand-heart", label: "比心", glyph: "🫶" },
      { id: "hand-point", label: "指向", glyph: "👉" },
      { id: "hand-muscle", label: "加油", glyph: "💪" },
    ],
  },
  {
    name: "符号",
    items: [
      { id: "sym-heart", label: "红心", glyph: "❤️" },
      { id: "sym-fire", label: "火", glyph: "🔥" },
      { id: "sym-star", label: "星星", glyph: "⭐" },
      { id: "sym-sparkles", label: "闪光", glyph: "✨" },
      { id: "sym-100", label: "100分", glyph: "💯" },
      { id: "sym-check", label: "对勾", glyph: "✅" },
      { id: "sym-cross", label: "错叉", glyph: "❌" },
      { id: "sym-warn", label: "警告", glyph: "⚠️" },
      { id: "sym-question", label: "问号", glyph: "❓" },
      { id: "sym-exclaim", label: "叹号", glyph: "❗" },
    ],
  },
  {
    name: "氛围",
    items: [
      { id: "vibe-party", label: "彩带", glyph: "🎉" },
      { id: "vibe-balloon", label: "气球", glyph: "🎈" },
      { id: "vibe-gift", label: "礼物", glyph: "🎁" },
      { id: "vibe-crown", label: "皇冠", glyph: "👑" },
      { id: "vibe-money", label: "钱袋", glyph: "💰" },
      { id: "vibe-rocket", label: "火箭", glyph: "🚀" },
      { id: "vibe-camera", label: "相机", glyph: "📷" },
      { id: "vibe-music", label: "音符", glyph: "🎵" },
    ],
  },
];

const STICKER_SIZE = 256;

/** 把 emoji 渲染成透明底 PNG 字节 */
async function renderStickerPng(glyph: string): Promise<{ bytes: number[]; width: number; height: number }> {
  const canvas = document.createElement("canvas");
  canvas.width = STICKER_SIZE;
  canvas.height = STICKER_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 不可用");
  ctx.clearRect(0, 0, STICKER_SIZE, STICKER_SIZE);
  ctx.font = `${Math.floor(STICKER_SIZE * 0.82)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(glyph, STICKER_SIZE / 2, STICKER_SIZE / 2 + STICKER_SIZE * 0.04);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("贴纸渲染失败");
  const buffer = await blob.arrayBuffer();
  return { bytes: Array.from(new Uint8Array(buffer)), width: STICKER_SIZE, height: STICKER_SIZE };
}

export function StickerPanel({
  busy,
  onAddSticker,
}: {
  busy: string | null;
  /** 渲染完成后回调：把贴纸素材加入项目并落到时间线（App 决定轨道与时长） */
  onAddSticker: (payload: {
    stickerId: string;
    title: string;
    bytes: number[];
    width: number;
    height: number;
  }) => Promise<void> | void;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function handleClick(item: StickerDef) {
    if (pendingId) return;
    setPendingId(item.id);
    try {
      const { bytes, width, height } = await renderStickerPng(item.glyph);
      await onAddSticker({ stickerId: item.id, title: `贴纸·${item.label}`, bytes, width, height });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="sticker-panel">
      <p className="panel-hint">点击贴纸添加到播放头位置（默认 3 秒，可拖动调整）。</p>
      {STICKER_GROUPS.map((group) => (
        <section key={group.name} className="sticker-group">
          <div className="sticker-group-title">{group.name}</div>
          <div className="sticker-grid">
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="sticker-cell"
                title={item.label}
                disabled={busy === "sticker" || pendingId !== null}
                onClick={() => void handleClick(item)}
              >
                {pendingId === item.id ? <Loader2 className="spin" size={18} /> : <span className="sticker-glyph">{item.glyph}</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** 贴纸素材判断（时间线/检查器可用） */
export function isStickerAsset(asset: Pick<MediaSource, "source"> | null | undefined): boolean {
  return asset?.source === "sticker";
}
