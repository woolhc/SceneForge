import { useRef } from "react";

/**
 * 自适应标尺：根据 pxPerSecond 决定刻度间隔（nice ticks 算法）。
 * 缩放小时显示秒，缩放大时显示帧。
 */
export function Ruler({
  totalDuration,
  pxPerSecond,
  onSeek,
}: {
  totalDuration: number;
  pxPerSecond: number;
  onSeek: (time: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  // 计算合适的刻度间隔（秒）：目标每 ~80px 一个刻度
  const targetPxPerTick = 80;
  const targetSecondsPerTick = targetPxPerTick / pxPerSecond;

  // nice number 算法：找到 >= targetSecondsPerTick 的 1/2/5 × 10ⁿ
  const niceInterval = (target: number): number => {
    if (target <= 0) return 1;
    const exp = Math.floor(Math.log10(target));
    const base = Math.pow(10, exp);
    const norm = target / base;
    if (norm <= 1) return 1 * base;
    if (norm <= 2) return 2 * base;
    if (norm <= 5) return 5 * base;
    return 10 * base;
  };

  const interval = niceInterval(targetSecondsPerTick);
  const tickCount = Math.ceil(totalDuration / interval) + 1;

  // 格式化刻度标签
  const formatTime = (seconds: number): string => {
    if (interval < 0.1) {
      // 帧级别：显示帧号
      const frame = Math.round(seconds * 30); // 假设 30fps
      return `${frame}f`;
    }
    if (seconds >= 60) {
      const m = Math.floor(seconds / 60);
      const s = Math.round(seconds % 60);
      return `${m}:${String(s).padStart(2, "0")}`;
    }
    if (interval < 1) return `${seconds.toFixed(1)}s`;
    return `${Math.round(seconds)}s`;
  };

  function seekFromEvent(event: React.PointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el || totalDuration <= 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    onSeek(ratio * totalDuration);
  }

  return (
    <div
      ref={ref}
      className="ruler ruler-interactive"
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        seekFromEvent(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) seekFromEvent(event);
      }}
      onPointerUp={(event) => {
        dragging.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    >
      {Array.from({ length: tickCount }).map((_, index) => {
        const time = index * interval;
        if (time > totalDuration + interval) return null;
        const leftPct = totalDuration > 0 ? (time / totalDuration) * 100 : 0;
        return (
          <span key={index} style={{ left: `${leftPct}%` }}>
            {formatTime(time)}
          </span>
        );
      })}
    </div>
  );
}
