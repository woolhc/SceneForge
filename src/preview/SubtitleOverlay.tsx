import Moveable from "react-moveable";
import { useEffect, useRef, useState } from "react";
import type { Clip, SubtitleStyle } from "../types";
import { DEFAULT_SUBTITLE_STYLE } from "../types";

/**
 * 字幕叠层组件（剪映式）：用 react-moveable 实现
 * - 拖动主体 → 改 x/y 位置
 * - 拖角点/边中点 → 等比缩放 scale（不改 fontSize）
 * - 拖旋转手柄 → 改 rotation
 * - 双击 → 进入文字编辑模式
 *
 * 字号（fontSize）是基准，scale 是独立缩放因子。
 * 渲染：transform: translate + rotate + scale，moveable 自动跟踪 transform 后的边界。
 */
export function SubtitleOverlay({
  clip,
  targetRef,
  isSelected,
  onMove,
  onScale,
  onRotate,
  onEditStart,
}: {
  clip: Clip;
  /** 预览区容器 ref（用于 moveable 的 bounds 约束） */
  targetRef: React.RefObject<HTMLDivElement | null>;
  isSelected: boolean;
  onMove: (x: number, y: number) => void;
  onScale: (scaleX: number, scaleY: number) => void;
  onRotate: (rotation: number) => void;
  onEditStart: () => void;
}) {
  const textRef = useRef<HTMLDivElement | null>(null);
  const [moveableReady, setMoveableReady] = useState(false);
  // 记录拖动开始时的 scale（用于计算增量）
  const startScaleXRef = useRef(100);
  const startScaleYRef = useRef(100);
  const style: SubtitleStyle = clip.subtitleStyle ?? DEFAULT_SUBTITLE_STYLE;
  const scaleX = (style.scaleX ?? 100) / 100;
  const scaleY = (style.scaleY ?? 100) / 100;
  const rotation = style.rotation ?? 0;
  const fontSize = `${Math.max(12, (style.fontSize ?? 48) * 0.35)}px`;
  const strokeColor = style.strokeColor ?? "#000";
  const strokeShadow = `1px 1px 0 ${strokeColor}, -1px -1px 0 ${strokeColor}, 1px -1px 0 ${strokeColor}, -1px 1px 0 ${strokeColor}`;

  // textRef 就绪后才渲染 Moveable（避免首次渲染 ref 为 null）
  useEffect(() => {
    if (isSelected && textRef.current) {
      setMoveableReady(true);
    }
    if (!isSelected) {
      setMoveableReady(false);
    }
  }, [isSelected]);

  return (
    <>
      {/* 字幕文本元素（moveable 的 target） */}
      <div
        ref={textRef}
        className="subtitle-overlay-text"
        style={{
          position: "absolute",
          left: `${style.x ?? 50}%`,
          top: `${style.y ?? 80}%`,
          transform: `translate(-50%, -50%) rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`,
          transformOrigin: "center center",
          fontFamily: style.fontFamily,
          fontSize,
          fontWeight: 700,
          lineHeight: 1.4,
          color: style.color,
          textShadow: strokeShadow,
          padding: "4px 10px",
          textAlign: "center",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxWidth: "calc(100% - 24px)",
          zIndex: 7,
          cursor: isSelected ? "move" : "default",
          userSelect: "none",
        }}
        onPointerDown={(e) => {
          if (!isSelected) return;
          // 双击检测：两次 pointerdown 间隔 < 300ms → 编辑
          const now = Date.now();
          const last = (e.currentTarget as HTMLElement & { _lastClick?: number })._lastClick ?? 0;
          (e.currentTarget as HTMLElement & { _lastClick?: number })._lastClick = now;
          if (now - last < 300) {
            e.stopPropagation();
            onEditStart();
          }
        }}
      >
        {clip.text || ""}
      </div>

      {/* moveable 控制器：target DOM 就绪后渲染 */}
      {isSelected && moveableReady && textRef.current && (
        <Moveable
          target={textRef}
          container={targetRef.current ?? undefined}
          draggable={true}
          scalable={true}
          rotatable={true}
          origin={false}
          keepRatio={false}
          renderDirections={["nw", "n", "ne", "w", "e", "sw", "s", "se"]}
          throttleDrag={0}
          throttleScale={0}
          throttleRotate={0}
          onDrag={(e) => {
            // 基于容器百分比更新位置
            const container = targetRef.current!;
            const rect = container.getBoundingClientRect();
            const x = ((e.left + e.width / 2) / rect.width) * 100;
            const y = ((e.top + e.height / 2) / rect.height) * 100;
            onMove(Math.max(0, Math.min(100, x)), Math.max(0, Math.min(100, y)));
          }}
          onScaleStart={() => {
            // 记录拖动开始时的 scaleX/scaleY
            startScaleXRef.current = style.scaleX ?? 100;
            startScaleYRef.current = style.scaleY ?? 100;
          }}
          onScale={(e) => {
            // e.scale 是相对于拖动开始的增量比例 [sx, sy]
            const ratioX = e.scale[0];
            const ratioY = e.scale[1];
            const newScaleX = Math.max(10, Math.min(500, startScaleXRef.current * ratioX));
            const newScaleY = Math.max(10, Math.min(500, startScaleYRef.current * ratioY));
            onScale(newScaleX, newScaleY);
          }}
          onRotate={(e) => {
            onRotate(e.rotation);
          }}
        />
      )}
    </>
  );
}
