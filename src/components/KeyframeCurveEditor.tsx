import { useCallback, useRef, useState } from "react";
import type { Keyframe } from "../types";
import { moveKeyframe } from "../editor/keyframes";

/**
 * 关键帧曲线编辑器：复用 SpeedCurveEditor 的 SVG 拖拽手势模式。
 * X 轴：相对 clip 起点的秒数（0..duration）；Y 轴：属性值（valueMin..valueMax）。
 * 选中某个非首帧的点，若其 easing === "bezier"，额外渲染两个贝塞尔控制手柄
 * （手柄在该点所属线段的局部单位方框内定位，与 keyframes.ts 的 cubic-bezier 语义一致：
 * x1/x2 是该段内的归一化进度，y1/y2 是该段内的归一化数值，可超出 [0,1] 表示回弹/超调）。
 */

const WIDTH = 240;
const HEIGHT = 110;
const PAD = 10;

type DragTarget =
  | { kind: "point"; originalTime: number }
  | { kind: "handle1"; pointTime: number }
  | { kind: "handle2"; pointTime: number };

export function KeyframeCurveEditor({
  keyframes,
  duration,
  valueMin,
  valueMax,
  onChange,
  onCommit,
}: {
  keyframes: Keyframe[];
  duration: number;
  valueMin: number;
  valueMax: number;
  onChange: (next: Keyframe[]) => void;
  onCommit: () => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragTarget | null>(null);
  const [selectedTime, setSelectedTime] = useState<number | null>(null);

  const span = Math.max(duration, 0.001);
  const valueSpan = Math.max(valueMax - valueMin, 0.001);
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  const timeToX = useCallback((t: number) => PAD + (t / span) * (WIDTH - PAD * 2), [span]);
  const valueToY = useCallback(
    (v: number) => HEIGHT - PAD - ((v - valueMin) / valueSpan) * (HEIGHT - PAD * 2),
    [valueMin, valueSpan],
  );
  const xToTime = useCallback(
    (x: number) => Math.max(0, Math.min(span, ((x - PAD) / (WIDTH - PAD * 2)) * span)),
    [span],
  );
  const yToValue = useCallback(
    (y: number) => Math.max(valueMin, Math.min(valueMax, valueMin + (1 - (y - PAD) / (HEIGHT - PAD * 2)) * valueSpan)),
    [valueMin, valueMax, valueSpan],
  );

  const svgPointFromEvent = useCallback((e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * HEIGHT;
    return { x, y };
  }, []);

  const findIndexByTime = (time: number, tol = 0.05) =>
    sorted.findIndex((k) => Math.abs(k.time - time) <= tol);

  const handlePointDown = (e: React.PointerEvent<SVGCircleElement>, kf: Keyframe) => {
    e.stopPropagation();
    e.preventDefault();
    (e.target as SVGCircleElement).setPointerCapture(e.pointerId);
    dragRef.current = { kind: "point", originalTime: kf.time };
    setSelectedTime(kf.time);
  };

  const handlePointMove = (e: React.PointerEvent<SVGCircleElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.kind !== "point") return;
    const pt = svgPointFromEvent(e);
    if (!pt) return;
    const idx = findIndexByTime(drag.originalTime);
    if (idx === -1) return;
    const time = xToTime(pt.x);
    const value = yToValue(pt.y);
    dragRef.current = { kind: "point", originalTime: time };
    setSelectedTime(time);
    onChange(moveKeyframe(sorted, idx, { time, value }));
  };

  const handlePointUp = (e: React.PointerEvent<SVGCircleElement>) => {
    if (!dragRef.current) return;
    (e.target as SVGCircleElement).releasePointerCapture(e.pointerId);
    dragRef.current = null;
    onCommit();
  };

  const handleDoubleClickSvg = (e: React.PointerEvent<SVGSVGElement>) => {
    const pt = svgPointFromEvent(e);
    if (!pt) return;
    const time = xToTime(pt.x);
    const value = yToValue(pt.y);
    const next = [...sorted.filter((k) => Math.abs(k.time - time) > 0.05), { time, value, easing: "linear" as const }];
    next.sort((a, b) => a.time - b.time);
    onChange(next);
    onCommit();
  };

  const handleDoubleClickPoint = (e: React.MouseEvent<SVGCircleElement>, kf: Keyframe) => {
    e.stopPropagation();
    if (sorted.length <= 1) return;
    onChange(sorted.filter((k) => Math.abs(k.time - kf.time) > 0.05));
    onCommit();
    if (selectedTime !== null && Math.abs(selectedTime - kf.time) <= 0.05) setSelectedTime(null);
  };

  // ---- 贝塞尔控制手柄（仅对选中且 easing === "bezier" 的非首帧点渲染）----
  const selectedIndex = selectedTime !== null ? findIndexByTime(selectedTime) : -1;
  const selectedKf = selectedIndex > 0 ? sorted[selectedIndex] : null;
  const prevKf = selectedIndex > 0 ? sorted[selectedIndex - 1] : null;
  const showBezierHandles = !!selectedKf && !!prevKf && selectedKf.easing === "bezier";
  const bezierPoints = selectedKf?.bezierPoints ?? [0.42, 0, 0.58, 1];

  const segBoxX = (localX: number) => (prevKf && selectedKf ? timeToX(prevKf.time) + localX * (timeToX(selectedKf.time) - timeToX(prevKf.time)) : 0);
  const segBoxY = (localY: number) => (prevKf && selectedKf ? valueToY(prevKf.value) + localY * (valueToY(selectedKf.value) - valueToY(prevKf.value)) : 0);
  const segLocalXFromPixel = (px: number) =>
    prevKf && selectedKf ? Math.max(0, Math.min(1, (px - timeToX(prevKf.time)) / Math.max(1, timeToX(selectedKf.time) - timeToX(prevKf.time)))) : 0;
  const segLocalYFromPixel = (py: number) =>
    prevKf && selectedKf ? (py - valueToY(prevKf.value)) / Math.max(1, valueToY(selectedKf.value) - valueToY(prevKf.value)) : 0;

  const updateBezierPoint = (which: 1 | 2, localX: number, localY: number) => {
    if (!selectedKf) return;
    const idx = findIndexByTime(selectedKf.time);
    if (idx === -1) return;
    const clampedX = Math.max(0, Math.min(1, localX));
    const points: [number, number, number, number] =
      which === 1 ? [clampedX, localY, bezierPoints[2], bezierPoints[3]] : [bezierPoints[0], bezierPoints[1], clampedX, localY];
    const next = sorted.map((k, i) => (i === idx ? { ...k, bezierPoints: points } : k));
    onChange(next);
  };

  const handleHandleDown = (e: React.PointerEvent<SVGRectElement>, which: 1 | 2) => {
    e.stopPropagation();
    e.preventDefault();
    if (!selectedKf) return;
    (e.target as SVGRectElement).setPointerCapture(e.pointerId);
    dragRef.current = which === 1 ? { kind: "handle1", pointTime: selectedKf.time } : { kind: "handle2", pointTime: selectedKf.time };
  };

  const handleHandleMove = (e: React.PointerEvent<SVGRectElement>) => {
    const drag = dragRef.current;
    if (!drag || (drag.kind !== "handle1" && drag.kind !== "handle2")) return;
    const pt = svgPointFromEvent(e);
    if (!pt) return;
    const localX = segLocalXFromPixel(pt.x);
    const localY = segLocalYFromPixel(pt.y);
    updateBezierPoint(drag.kind === "handle1" ? 1 : 2, localX, localY);
  };

  const handleHandleUp = (e: React.PointerEvent<SVGRectElement>) => {
    if (!dragRef.current) return;
    (e.target as SVGRectElement).releasePointerCapture(e.pointerId);
    dragRef.current = null;
    onCommit();
  };

  const pathD = sorted.length > 0
    ? sorted.map((p, i) => `${i === 0 ? "M" : "L"} ${timeToX(p.time).toFixed(2)} ${valueToY(p.value).toFixed(2)}`).join(" ")
    : "";

  return (
    <div className="keyframe-curve-editor" style={{ marginTop: 8 }}>
      <svg
        ref={svgRef}
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        onDoubleClick={handleDoubleClickSvg}
        style={{ background: "rgba(0,0,0,0.25)", borderRadius: 4, cursor: "crosshair", touchAction: "none" }}
      >
        {pathD && <path d={pathD} fill="none" stroke="#4a9eff" strokeWidth={1.5} />}

        {showBezierHandles && prevKf && selectedKf && (
          <>
            <line
              x1={segBoxX(0)}
              y1={segBoxY(0)}
              x2={segBoxX(bezierPoints[0])}
              y2={segBoxY(bezierPoints[1])}
              stroke="rgba(243,201,105,0.6)"
            />
            <line
              x1={segBoxX(1)}
              y1={segBoxY(1)}
              x2={segBoxX(bezierPoints[2])}
              y2={segBoxY(bezierPoints[3])}
              stroke="rgba(243,201,105,0.6)"
            />
            <rect
              x={segBoxX(bezierPoints[0]) - 4}
              y={segBoxY(bezierPoints[1]) - 4}
              width={8}
              height={8}
              fill="#f3c969"
              style={{ cursor: "grab" }}
              onPointerDown={(e) => handleHandleDown(e, 1)}
              onPointerMove={handleHandleMove}
              onPointerUp={handleHandleUp}
            />
            <rect
              x={segBoxX(bezierPoints[2]) - 4}
              y={segBoxY(bezierPoints[3]) - 4}
              width={8}
              height={8}
              fill="#f3c969"
              style={{ cursor: "grab" }}
              onPointerDown={(e) => handleHandleDown(e, 2)}
              onPointerMove={handleHandleMove}
              onPointerUp={handleHandleUp}
            />
          </>
        )}

        {sorted.map((p) => (
          <circle
            key={p.time.toFixed(3)}
            cx={timeToX(p.time)}
            cy={valueToY(p.value)}
            r={selectedTime !== null && Math.abs(selectedTime - p.time) <= 0.05 ? 6 : 5}
            fill={selectedTime !== null && Math.abs(selectedTime - p.time) <= 0.05 ? "#ff9d4a" : "#4a9eff"}
            stroke="rgba(0,0,0,0.6)"
            strokeWidth={1}
            style={{ cursor: "grab" }}
            onPointerDown={(e) => handlePointDown(e, p)}
            onPointerMove={handlePointMove}
            onPointerUp={handlePointUp}
            onDoubleClick={(e) => handleDoubleClickPoint(e, p)}
          />
        ))}
      </svg>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>
        双击空白加点 · 双击圆点删除 · 拖动调整 · 选中自定义曲线点可拖黄色手柄调整贝塞尔
      </div>
    </div>
  );
}
