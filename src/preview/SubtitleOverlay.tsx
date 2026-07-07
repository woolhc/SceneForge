import Moveable from "react-moveable";
import { useEffect, useRef, useState } from "react";
import type { Clip, SubtitleStyle, WordCue } from "../types";
import { DEFAULT_SUBTITLE_STYLE } from "../types";

/**
 * 字幕叠层组件（剪映式）：用 react-moveable 实现
 * - 拖动主体 → 改 x/y 位置
 * - 拖角点/边中点 → 等比缩放 scale（不改 fontSize）
 * - 拖旋转手柄 → 改 rotation
 * - 双击 → 进入文字编辑模式
 * - 当 clip.words 非空 + style.karaoke=true：逐字高亮（已播到的字变色）
 *
 * 字号（fontSize）是基准，scale 是独立缩放因子。
 * 渲染：transform: translate + rotate + scale，moveable 自动跟踪 transform 后的边界。
 */
export function SubtitleOverlay({
  clip,
  targetRef,
  isSelected,
  currentTime,
  onMove,
  onScale,
  onRotate,
  onEditStart,
}: {
  clip: Clip;
  /** 预览区容器 ref（用于 moveable 的 bounds 约束） */
  targetRef: React.RefObject<HTMLDivElement | null>;
  isSelected: boolean;
  /** 当前播放头时间（秒，时间线坐标）—— 用于逐字高亮判断 */
  currentTime?: number;
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
  const style: SubtitleStyle = { ...DEFAULT_SUBTITLE_STYLE, ...(clip.subtitleStyle ?? {}) };
  const scaleX = (style.scaleX ?? 100) / 100;
  const scaleY = (style.scaleY ?? 100) / 100;
  const rotation = style.rotation ?? 0;
  const fontSize = `${Math.max(12, (style.fontSize ?? 48) * 0.35)}px`;
  const strokeColor = style.strokeColor ?? "#000";
  const baseColor = style.color ?? "#FFFFFF";
  const highlightColor = style.highlightColor ?? "#FFD700";
  const strokeShadow = `1px 1px 0 ${strokeColor}, -1px -1px 0 ${strokeColor}, 1px -1px 0 ${strokeColor}, -1px 1px 0 ${strokeColor}`;

  // 逐字高亮：判断是否启用
  const karaokeEnabled = (style.karaoke ?? true) && (clip.words?.length ?? 0) > 0;
  // word 时间是相对音频整体的，加上 clip 在时间线的偏移 → 得到时间线坐标
  // （ASR 音频从配音轨起始合并；为简化，假设 word.start/end 已与 startOnTrack 同坐标系，
  //   实际播放验证若不对再补偏移）
  const renderWords = (words: WordCue[]) => {
    const t = currentTime ?? -1;
    return words.map((w, i) => {
      // 已播到：word.end <= t 或 word.start <= t < word.end（正在播）
      // 未播到：t < word.start
      const played = t >= w.start;
      // 智能空格：前后都是 ASCII 字母/数字时，词间加空格（英文用）
      const prev = words[i - 1];
      const needSpace =
        i > 0 &&
        prev &&
        /[A-Za-z0-9]$/.test(prev.text) &&
        /^[A-Za-z0-9]/.test(w.text);
      return (
        <span key={i} style={{ color: played ? highlightColor : baseColor }}>
          {needSpace ? " " : ""}
          {w.text}
        </span>
      );
    });
  };

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
        className={`subtitle-overlay-text ${style.animationIn && style.animationIn !== "none" ? `anim-${style.animationIn}` : ""}`}
        style={{
          position: "absolute",
          left: `${style.x ?? 50}%`,
          top: `${style.y ?? 80}%`,
          transform: `translate(-50%, -50%) rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`,
          transformOrigin: "center center",
          // T4.8: 动画时长 CSS 变量
          ["--sub-anim-dur" as string]: `${style.animationDuration ?? 0.3}s`,
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
        // M21: 用标准 onDoubleClick 替代 DOM expando _lastClick 双击检测
        onDoubleClick={() => {
          if (isSelected) onEditStart();
        }}
      >
        {karaokeEnabled && clip.words
          ? renderWords(clip.words)
          : clip.text || ""}
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
