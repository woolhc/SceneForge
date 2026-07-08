import { useRef, useState, useCallback } from "react";
import type { SpeedPoint } from "../types";
import { addSpeedPoint, removeSpeedPointAt, updateSpeedPoint } from "../editor/speedCurve";

/**
 * 曲线变速编辑器：SVG 折线 + 可拖控制点。
 * - X 轴：源素材归一化时间 0-1
 * - Y 轴：倍速 0-4（1x 居中）
 * - 拖圆点：更新该点 time/speed
 * - 双击空白：在该位置加点
 * - 双击圆点：删除该点
 *
 * 受控组件：curve 由父组件传入，onChange 输出新的 SpeedPoint[]。
 * 父组件负责持久化与 duration 重算（applySpeedCurvePreset 已处理）。
 */

const WIDTH = 220;
const HEIGHT = 120;
const PAD = 8;
const SPEED_MIN = 0.0625;
const SPEED_MAX = 4;
const SPEED_RANGE = SPEED_MAX - SPEED_MIN;

type DragState = {
  pointerId: number;
  originalTime: number;
  moved: boolean;
};

export function SpeedCurveEditor({
  curve,
  onChange,
}: {
  curve: SpeedPoint[];
  onChange: (next: SpeedPoint[]) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);

  const timeToX = useCallback((t: number) => PAD + t * (WIDTH - PAD * 2), []);
  const speedToY = useCallback((s: number) => {
    const clamped = Math.max(SPEED_MIN, Math.min(SPEED_MAX, s));
    return HEIGHT - PAD - ((clamped - SPEED_MIN) / SPEED_RANGE) * (HEIGHT - PAD * 2);
  }, []);
  const xToTime = useCallback((x: number) => {
    const t = (x - PAD) / (WIDTH - PAD * 2);
    return Math.max(0, Math.min(1, t));
  }, []);
  const yToSpeed = useCallback((y: number) => {
    const ratio = 1 - (y - PAD) / (HEIGHT - PAD * 2);
    return Math.max(SPEED_MIN, Math.min(SPEED_MAX, SPEED_MIN + ratio * SPEED_RANGE));
  }, []);

  const pointFromEvent = useCallback(
    (e: { clientX: number; clientY: number }): { time: number; speed: number } | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const sx = (x / rect.width) * WIDTH;
      const sy = (y / rect.height) * HEIGHT;
      return { time: xToTime(sx), speed: yToSpeed(sy) };
    },
    [xToTime, yToSpeed],
  );

  const handlePointerDownPoint = (e: React.PointerEvent<SVGCircleElement>, p: SpeedPoint) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as SVGCircleElement).setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, originalTime: p.time, moved: false };
  };

  const handlePointerMovePoint = (e: React.PointerEvent<SVGCircleElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const pt = pointFromEvent(e);
    if (!pt) return;
    drag.moved = true;
    onChange(updateSpeedPoint(curve, drag.originalTime, { time: pt.time, speed: pt.speed }));
  };

  const handlePointerUpPoint = (e: React.PointerEvent<SVGCircleElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    (e.target as SVGCircleElement).releasePointerCapture(e.pointerId);
    dragRef.current = null;
  };

  const handleDoubleClickSvg = (e: React.PointerEvent<SVGSVGElement>) => {
    // 双击空白：加点
    const pt = pointFromEvent(e);
    if (!pt) return;
    onChange(addSpeedPoint(curve, pt));
  };

  const handleDoubleClickPoint = (e: React.MouseEvent<SVGCircleElement>, p: SpeedPoint) => {
    e.stopPropagation();
    onChange(removeSpeedPointAt(curve, p.time));
  };

  const handleMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const pt = pointFromEvent(e);
    if (!pt) {
      setHoverPoint(null);
      return;
    }
    setHoverPoint({ x: timeToX(pt.time), y: speedToY(pt.speed) });
  };

  const handleLeave = () => setHoverPoint(null);

  const sorted = [...curve].sort((a, b) => a.time - b.time);
  const pathD = sorted.length > 0
    ? sorted.map((p, i) => `${i === 0 ? "M" : "L"} ${timeToX(p.time).toFixed(2)} ${speedToY(p.speed).toFixed(2)}`).join(" ")
    : "";
  const y1x = speedToY(1);

  return (
    <div className="speed-curve-editor" style={{ marginTop: 8 }}>
      <svg
        ref={svgRef}
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        onPointerMove={handleMove}
        onPointerLeave={handleLeave}
        onDoubleClick={handleDoubleClickSvg}
        style={{ background: "rgba(0,0,0,0.25)", borderRadius: 4, cursor: "crosshair", touchAction: "none" }}
      >
        {/* 1x 基线 */}
        <line x1={PAD} y1={y1x} x2={WIDTH - PAD} y2={y1x} stroke="rgba(255,255,255,0.15)" strokeDasharray="2 3" />
        {/* Y 轴标签：0.5x / 1x / 2x */}
        <text x={2} y={speedToY(2) + 3} fill="rgba(255,255,255,0.4)" fontSize={8}>2x</text>
        <text x={2} y={y1x + 3} fill="rgba(255,255,255,0.4)" fontSize={8}>1x</text>
        <text x={2} y={speedToY(0.5) + 3} fill="rgba(255,255,255,0.4)" fontSize={8}>0.5x</text>

        {/* 折线 */}
        {pathD && <path d={pathD} fill="none" stroke="#4a9eff" strokeWidth={1.5} />}

        {/* 鼠标十字线 */}
        {hoverPoint && (
          <>
            <line x1={hoverPoint.x} y1={PAD} x2={hoverPoint.x} y2={HEIGHT - PAD} stroke="rgba(255,255,255,0.15)" />
            <line x1={PAD} y1={hoverPoint.y} x2={WIDTH - PAD} y2={hoverPoint.y} stroke="rgba(255,255,255,0.15)" />
          </>
        )}

        {/* 控制点 */}
        {sorted.map((p, i) => (
          <circle
            key={`${p.time.toFixed(3)}-${i}`}
            cx={timeToX(p.time)}
            cy={speedToY(p.speed)}
            r={5}
            fill="#f3c969"
            stroke="rgba(0,0,0,0.6)"
            strokeWidth={1}
            style={{ cursor: "grab" }}
            onPointerDown={(e) => handlePointerDownPoint(e, p)}
            onPointerMove={handlePointerMovePoint}
            onPointerUp={handlePointerUpPoint}
            onDoubleClick={(e) => handleDoubleClickPoint(e, p)}
          />
        ))}
      </svg>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
        双击空白加点 · 双击黄点删除 · 拖动调整
      </div>
    </div>
  );
}
