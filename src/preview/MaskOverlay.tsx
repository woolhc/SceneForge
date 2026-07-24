import Moveable from "react-moveable";
import { useEffect, useRef, useState } from "react";
import type { Clip, ClipMask } from "../types";
import { DEFAULT_TRANSFORM } from "../types";
import { visualLayerCssStyle } from "../renderGraph/visualLayout";

/**
 * 蒙版预览区拖拽手柄（剪映式）。
 * 蒙版的 cx/cy/width/height 是相对 clip 自身渲染框（而非舞台）的归一化坐标——
 * 与 PreviewEngine.applyOverlayMask 的 CSS mask-image 百分比坐标系一致。
 * 因此外层包一个与 clip 渲染框同位置/尺寸/旋转的容器，蒙版手柄的 container 用它而非舞台，
 * 保证拖拽换算出的 cx/cy/width/height 直接对应 clip 自身坐标系，不需要额外换算 clip 的位置/缩放/旋转。
 */
export function MaskOverlay({
  clip,
  mask,
  isSelected,
  onChange,
  onCommit,
}: {
  clip: Clip;
  mask: ClipMask;
  isSelected: boolean;
  onChange: (patch: Partial<ClipMask>) => void;
  onCommit: () => void;
}) {
  const clipBoxRef = useRef<HTMLDivElement | null>(null);
  const maskBoxRef = useRef<HTMLDivElement | null>(null);
  const [moveableReady, setMoveableReady] = useState(false);
  // circle/rect 才使用 cx/cy/width/height；linear/mirror 的渲染只吃 rotation+feather（见 PreviewEngine.applyOverlayMask），
  // 拖拽/缩放 cx/cy/width/height 对这两种蒙版没有视觉效果，因此禁用以免误导用户
  const canPosition = mask.kind === "circle" || mask.kind === "rect";
  const canResize = canPosition;

  const transform = clip.transform ?? DEFAULT_TRANSFORM;
  const clipLayout = visualLayerCssStyle({
    x: transform.x,
    y: transform.y,
    scale: transform.scale,
    width: transform.width ?? transform.scale,
    height: transform.height ?? transform.scale,
    rotation: transform.rotation ?? 0,
    effectiveOpacity: 1,
  });

  useEffect(() => {
    if (isSelected && maskBoxRef.current) setMoveableReady(true);
    if (!isSelected) setMoveableReady(false);
  }, [isSelected]);

  return (
    <div
      ref={clipBoxRef}
      style={{
        position: "absolute",
        left: clipLayout.left,
        top: clipLayout.top,
        width: clipLayout.width,
        height: clipLayout.height,
        transform: clipLayout.transform,
        transformOrigin: "center center",
        zIndex: 6,
      }}
    >
      <div
        ref={maskBoxRef}
        className="mask-overlay-box"
        style={{
          position: "absolute",
          left: `${(mask.cx - mask.width / 2) * 100}%`,
          top: `${(mask.cy - mask.height / 2) * 100}%`,
          width: `${mask.width * 100}%`,
          height: `${mask.height * 100}%`,
          transform: `rotate(${mask.rotation ?? 0}deg)`,
          transformOrigin: "center center",
          cursor: isSelected ? "move" : "default",
        }}
      />
      {isSelected && moveableReady && maskBoxRef.current && (
        <Moveable
          target={maskBoxRef}
          container={clipBoxRef.current ?? undefined}
          draggable={canPosition}
          resizable={canResize}
          rotatable={true}
          origin={false}
          renderDirections={canResize ? ["nw", "n", "ne", "w", "e", "sw", "s", "se"] : []}
          throttleDrag={0}
          throttleResize={0}
          throttleRotate={0}
          onDrag={(e) => {
            const rect = clipBoxRef.current!.getBoundingClientRect();
            const cx = (e.left + e.width / 2) / rect.width;
            const cy = (e.top + e.height / 2) / rect.height;
            onChange({ cx: Math.max(0, Math.min(1, cx)), cy: Math.max(0, Math.min(1, cy)) });
          }}
          onDragEnd={() => onCommit()}
          onResize={(e) => {
            const rect = clipBoxRef.current!.getBoundingClientRect();
            const width = Math.max(0.02, Math.min(1, e.width / rect.width));
            const height = Math.max(0.02, Math.min(1, e.height / rect.height));
            const cx = (e.drag.left + e.width / 2) / rect.width;
            const cy = (e.drag.top + e.height / 2) / rect.height;
            onChange({ width, height, cx: Math.max(0, Math.min(1, cx)), cy: Math.max(0, Math.min(1, cy)) });
          }}
          onResizeEnd={() => onCommit()}
          onRotate={(e) => onChange({ rotation: e.rotation })}
          onRotateEnd={() => onCommit()}
        />
      )}
    </div>
  );
}
