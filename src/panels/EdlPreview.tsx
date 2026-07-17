import { Check, ChevronDown, ChevronUp, Clock, Image as ImageIcon, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { desktopApi } from "../tauri";
import type { AiSegment, MediaSource } from "../types";

/**
 * EDL（编辑决策列表）预览面板 —— 借鉴 video-use 的 EDL 中间层。
 *
 * AI 分段后不直接创建 clip，而是先展示这份"剪辑方案"让用户确认：
 * - 文案 / 关键词（中英）/ 情绪 / 预估时长 / 素材策略
 * - 支持编辑文案、关键词
 * - 支持调序（上移/下移）、删除
 * - 确认后才执行后续编排 + 素材绑定
 */
/**
 * 单个 EDL 卡片的素材缩略图区：搜索 visualQuery 显示前 3 个候选。
 * 用 IntersectionObserver 懒加载，避免卡片多时请求洪泛。
 */
function EdlCardThumbnails({ query, ratio }: { query: string; ratio: string }) {
  const [assets, setAssets] = useState<MediaSource[]>([]);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!query.trim() || loaded) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setLoaded(true);
            void desktopApi
              .searchPexelsVideos({ query, ratio, perPage: 3 })
              .then((result) => setAssets(result.assets))
              .catch(() => setAssets([]));
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: "100px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [query, ratio, loaded]);

  return (
    <div className="edl-card-thumbs" ref={ref}>
      {loaded && assets.length === 0 && <span className="edl-thumb-empty">无匹配素材</span>}
      {assets.map((a) => {
        const src = a.thumbnailUrl ?? null;
        return src ? (
          <img
            key={a.id}
            src={src}
            alt={a.title}
            className="edl-thumb"
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null;
      })}
    </div>
  );
}

export function EdlPreview({
  segments,
  totalDuration,
  onConfirm,
  onCancel,
  busy,
  ratio,
}: {
  segments: AiSegment[];
  totalDuration: number;
  onConfirm: (segments: AiSegment[]) => void;
  onCancel: () => void;
  busy?: boolean;
  ratio?: string;
}) {
  // 本地可编辑副本
  const [items, setItems] = useState<AiSegment[]>(segments);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  if (items.length === 0) return null;

  const update = (idx: number, patch: Partial<AiSegment>) => {
    setItems((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[idx], next[target]] = [next[target], next[idx]];
    setItems(next);
  };

  const remove = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const total = items.reduce((sum, s) => sum + s.estimatedDuration, 0);

  return (
    <div className="edl-preview-overlay">
      <div className="edl-preview-modal">
        <div className="edl-preview-header">
          <div className="edl-preview-title">
            <Sparkles size={18} />
            <span>AI 分镜方案预览</span>
            <span className="edl-preview-meta">
              {items.length} 段 · 约 {Math.round(total)}s · 共 {totalDuration > 0 ? Math.round(totalDuration) : Math.round(total)}s
            </span>
          </div>
          <button className="icon-btn" onClick={onCancel} disabled={busy} title="取消">
            <X size={18} />
          </button>
        </div>

        <div className="edl-preview-list">
          {items.map((seg, idx) => (
            <div key={idx} className={`edl-card ${editingIdx === idx ? "editing" : ""}`}>
              <div className="edl-card-index">{idx + 1}</div>
              <div className="edl-card-body">
                {/* 文案 */}
                <div className="edl-field">
                  <label>文案</label>
                  {editingIdx === idx ? (
                    <textarea
                      value={seg.text}
                      onChange={(e) => update(idx, { text: e.target.value })}
                      rows={2}
                    />
                  ) : (
                    <div className="edl-text" onDoubleClick={() => setEditingIdx(idx)}>
                      {seg.text}
                    </div>
                  )}
                </div>

                {/* 关键词 */}
                <div className="edl-field-row">
                  <div className="edl-field grow">
                    <label>画面关键词（英文，用于搜索）</label>
                    <input
                      type="text"
                      value={seg.visualQuery}
                      onChange={(e) => update(idx, { visualQuery: e.target.value })}
                    />
                  </div>
                  <div className="edl-field">
                    <label>中文</label>
                    <input
                      type="text"
                      value={seg.visualQueryZh || ""}
                      placeholder="—"
                      onChange={(e) => update(idx, { visualQueryZh: e.target.value })}
                    />
                  </div>
                </div>

                {/* 元信息：情绪 / 时长 / 策略 */}
                <div className="edl-field-row">
                  <div className="edl-field">
                    <label>情绪</label>
                    <input
                      type="text"
                      value={seg.mood}
                      onChange={(e) => update(idx, { mood: e.target.value })}
                    />
                  </div>
                  <div className="edl-field narrow">
                    <label>
                      <Clock size={11} /> 时长(秒)
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={0.5}
                      value={seg.estimatedDuration}
                      onChange={(e) => update(idx, { estimatedDuration: Number(e.target.value) })}
                    />
                  </div>
                  <div className="edl-field">
                    <label>
                      <ImageIcon size={11} /> 素材策略
                    </label>
                    <select
                      value={seg.materialStrategy || "auto_search"}
                      onChange={(e) => update(idx, { materialStrategy: e.target.value })}
                    >
                      <option value="auto_search">自动搜索</option>
                      <option value="manual">手动选择</option>
                      <option value="color_card">纯色背景</option>
                    </select>
                  </div>
                </div>

                {/* 素材预览缩略图（懒加载） */}
                {seg.materialStrategy !== "color_card" && (
                  <EdlCardThumbnails query={seg.visualQuery} ratio={ratio || "9:16"} />
                )}
              </div>

              {/* 卡片操作 */}
              <div className="edl-card-actions">
                <button className="icon-btn sm" onClick={() => move(idx, -1)} disabled={idx === 0} title="上移">
                  <ChevronUp size={14} />
                </button>
                <button className="icon-btn sm" onClick={() => move(idx, 1)} disabled={idx === items.length - 1} title="下移">
                  <ChevronDown size={14} />
                </button>
                <button className="icon-btn sm" onClick={() => remove(idx)} title="删除">
                  <Trash2 size={14} />
                </button>
                {editingIdx === idx ? (
                  <button className="icon-btn sm primary" onClick={() => setEditingIdx(null)} title="完成编辑">
                    <Check size={14} />
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div className="edl-preview-footer">
          <span className="edl-hint">双击文案可编辑；调整满意后点击"执行"创建项目</span>
          <div className="edl-actions">
            <button className="btn-ghost" onClick={onCancel} disabled={busy}>
              取消
            </button>
            <button className="btn-primary" onClick={() => onConfirm(items)} disabled={busy || items.length === 0}>
              {busy ? "执行中..." : `执行（创建 ${items.length} 段）`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
