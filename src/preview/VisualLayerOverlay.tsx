import Moveable from "react-moveable";
import { useEffect, useRef, useState } from "react";
import type { Clip } from "../types";
import { DEFAULT_TRANSFORM } from "../types";
import { visualLayerCssStyle } from "../renderGraph/visualLayout";

/**
 * 视频/图片层预览区拖拽叠层（剪映式）。
 * 目标 DOM 是 React 拥有的透明代理框，而不是 PreviewEngine 管理的原生 <video>/<img>：
 * 原生元素的存在与位置由 RAF 渲染循环每帧覆写，直接绑定它会被下一帧的 style 写入打架，
 * 且其生命周期由播放头驱动的元素池管理，与选中态无关，可能在编辑时不存在。
 * 代理框只依据 clip.transform 定位，与原生元素完全解耦，拖拽只更新 transform。
 */
export function VisualLayerOverlay({
  clip,
  targetRef,
  isSelected,
  onMove,
  onMoveEnd,
  onScale,
  onScaleEnd,
  onRotate,
  onRotateEnd,
}: {
  clip: Clip;
  /** 舞台容器 ref（stageRef），用于 moveable 的 bounds + 百分比换算 */
  targetRef: React.RefObject<HTMLDivElement | null>;
  isSelected: boolean;
  onMove: (x: number, y: number) => void;
  onMoveEnd?: () => void;
  onScale: (scale: number) => void;
  onScaleEnd?: () => void;
  onRotate: (rotation: number) => void;
  onRotateEnd?: () => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [moveableReady, setMoveableReady] = useState(false);
  // 记录缩放拖动开始时的 scale（用于计算增量）
  const startScaleRef = useRef(100);
  const transform = clip.transform ?? DEFAULT_TRANSFORM;
  const layout = visualLayerCssStyle({
    x: transform.x,
    y: transform.y,
    scale: transform.scale,
    width: transform.width ?? transform.scale,
    height: transform.height ?? transform.scale,
    rotation: transform.rotation ?? 0,
    effectiveOpacity: 1,
  });

  useEffect(() => {
    if (isSelected && boxRef.current) setMoveableReady(true);
    if (!isSelected) setMoveableReady(false);
  }, [isSelected]);

  return (
    <>
      <div
        ref={boxRef}
        className="visual-layer-overlay-box"
        style={{
          position: "absolute",
          left: layout.left,
          top: layout.top,
          width: layout.width,
          height: layout.height,
          transform: layout.transform,
          transformOrigin: "center center",
          zIndex: 6,
          cursor: isSelected ? "move" : "default",
        }}
      />
      {isSelected && moveableReady && boxRef.current && (
        <Moveable
          target={boxRef}
          container={targetRef.current ?? undefined}
          draggable={true}
          scalable={true}
          rotatable={true}
          keepRatio={true}
          origin={false}
          renderDirections={["nw", "ne", "sw", "se"]}
          throttleDrag={0}
          throttleScale={0}
          throttleRotate={0}
          onDrag={(e) => {
            const container = targetRef.current!;
            const rect = container.getBoundingClientRect();
            const x = ((e.left + e.width / 2) / rect.width) * 100;
            const y = ((e.top + e.height / 2) / rect.height) * 100;
            onMove(Math.max(0, Math.min(100, x)), Math.max(0, Math.min(100, y)));
          }}
          onDragEnd={() => onMoveEnd?.()}
          onScaleStart={() => {
            startScaleRef.current = transform.scale;
          }}
          onScale={(e) => {
            const newScale = Math.max(5, Math.min(100, startScaleRef.current * e.scale[0]));
            onScale(newScale);
          }}
          onScaleEnd={() => onScaleEnd?.()}
          onRotate={(e) => {
            onRotate(e.rotation);
          }}
          onRotateEnd={() => onRotateEnd?.()}
        />
      )}
    </>
  );
}
