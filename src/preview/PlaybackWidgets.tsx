import { Pause, Play } from "lucide-react";
import type { Clip } from "../types";
import { normalizeSubtitleStyle, resolveSubtitleAnchor } from "../editor/subtitles/styleContract";
import { needsWordSpace } from "../editor/subtitles/wordSpacing";
import { usePlaybackStore } from "../store/playbackStore";
import { quantizeSubtitleClock, subtitleNeedsLiveClock } from "./subtitleClock";

/**
 * 播放时钟自订阅小组件（原 App.tsx 195-399 行原样搬移）。
 * 均只订阅 playbackStore 的低频/高频字段，不接触 App 的业务状态——
 * 这是 T2.1 播放解耦的关键：只有这些组件在播放时逐帧重渲染，App 本体不受影响。
 */

/** 时间码格式化：秒 → MM:SS.frame（剪映式） */
export function formatTC(seconds: number, fps = 30): string {
  const totalFrames = Math.round(seconds * fps);
  const frame = totalFrames % fps;
  const totalSec = Math.floor(totalFrames / fps);
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(frame).padStart(2, "0")}`;
}

export function PlayPauseButton({ onToggle }: { onToggle: () => void }) {
  const playing = usePlaybackStore((s) => s.playing);
  return (
    <button className="round-button" title={playing ? "暂停" : "播放"} onClick={onToggle}>
      {playing ? <Pause size={18} /> : <Play size={18} />}
    </button>
  );
}

export function PreviewProgress({ totalDuration, onSeek }: { totalDuration: number; onSeek: (time: number) => void }) {
  const currentTime = usePlaybackStore((s) => s.currentTime);
  const percent = totalDuration > 0 ? Math.min(100, (currentTime / totalDuration) * 100) : 0;
  return (
    <input
      type="range"
      min={0}
      max={100}
      value={percent}
      onChange={(event) => onSeek((Number(event.target.value) / 100) * totalDuration)}
    />
  );
}

export function TimecodeDisplay({ totalDuration, fps }: { totalDuration: number; fps: number }) {
  const currentTime = usePlaybackStore((s) => s.currentTime);
  return (
    <span className="timecode">
      {formatTC(currentTime, fps)} / {formatTC(totalDuration, fps)}
    </span>
  );
}

export function PlayheadLine({ totalDuration }: { totalDuration: number }) {
  const currentTime = usePlaybackStore((s) => s.currentTime);
  const percent = totalDuration > 0 ? Math.min(100, (currentTime / totalDuration) * 100) : 0;
  return (
    <div
      className="playhead"
      style={{ left: `calc(44px + (100% - 58px) * ${percent / 100})` }}
    />
  );
}

/** P0-4：拖拽时命中吸附点后渲染的横跨全部轨道的竖线，坐标系与 PlayheadLine 一致 */
export function SnapLine({ time, totalDuration }: { time: number; totalDuration: number }) {
  const percent = totalDuration > 0 ? Math.min(100, (time / totalDuration) * 100) : 0;
  return (
    <div
      className="timeline-snap-line"
      style={{ left: `calc(44px + (100% - 58px) * ${percent / 100})` }}
    />
  );
}

/** P0-3：跨轨拖拽悬停时的目标轨道预览条（纯视觉，不代表已生效，松手时才判定是否真的跨轨） */
export function CrossTrackGhost({
  left,
  width,
  top,
  height,
  blocked,
}: {
  left: number;
  width: number;
  top: number;
  height: number;
  blocked: boolean;
}) {
  return (
    <div
      className={`timeline-cross-track-ghost ${blocked ? "blocked" : ""}`}
      style={{
        left: `calc(44px + (100% - 58px) * ${left / 100})`,
        width: `calc((100% - 58px) * ${width / 100})`,
        top,
        height,
      }}
    />
  );
}

export function StageSubtitleLayer({ excludeClipId, fontScale }: { excludeClipId?: string; fontScale: number }) {
  const subClips = usePlaybackStore((s) => s.activeSubtitleClips);
  // 选中字幕编辑时，由 SubtitleOverlay 渲染该 clip，这里跳过避免重复
  const visible = subClips.filter((c) => c.id !== excludeClipId && c.text && c.text.trim());
  const needsLiveClock = visible.some(subtitleNeedsLiveClock);
  // 静态字幕不订阅逐帧时钟；动态字幕也只以 20fps 更新 React，CSS 动画仍由浏览器流畅执行。
  const currentTime = usePlaybackStore((s) => needsLiveClock ? quantizeSubtitleClock(s.currentTime) : 0);
  if (visible.length === 0) return null;
  return (
    <>
      {visible.map((clip) => (
        <SubtitleItem key={clip.id} clip={clip} currentTime={currentTime} fontScale={fontScale} />
      ))}
    </>
  );
}

/** 单条字幕渲染（StageSubtitleLayer 内部使用）。 */
export function SubtitleItem({ clip, currentTime, fontScale }: {
  clip: Clip;
  currentTime: number;
  fontScale: number;
}) {
  const s = normalizeSubtitleStyle(clip.subtitleStyle);
  const { x: posX, y: posY } = resolveSubtitleAnchor(s);
  const baseColor = s?.color ?? "#FFFFFF";
  const highlightColor = s?.highlightColor ?? "#FFD700";
  const karaokeOn = (s?.karaoke ?? true) && (clip.words?.length ?? 0) > 0;
  // 出场动画窗口判断：剩余时长 <= animationDuration 时进入出场
  const animDur = s?.animationDuration ?? 0.3;
  const clipEnd = clip.startOnTrack + clip.duration;
  const remaining = clipEnd - currentTime;
  const inOutro = remaining <= animDur && remaining >= 0;
  const animClass = inOutro
    ? (s?.animationOut && s.animationOut !== "none" ? `anim-${s.animationOut}` : "")
    : (s?.animationIn && s.animationIn !== "none" ? `anim-${s.animationIn}` : "");
  // 描边/阴影/背景/字间距/行高
  const strokeWidth = (s?.strokeWidth ?? 2) * fontScale;
  const strokeColor = s?.strokeColor ?? "#000";
  const shadowBlur = s?.shadowBlur ?? 0;
  const shadowColor = s?.shadowColor ?? "#000";
  // 矢量描边（-webkit-text-stroke）代替多重 text-shadow 叠加，避免中文密集笔画产生棋盘噪点
  const finalTextShadow = shadowBlur > 0 ? `0 ${Math.round(shadowBlur / 3)}px ${shadowBlur}px ${shadowColor}` : "none";
  const bgColor = s?.backgroundColor ?? "none";
  const bgPadding = s?.backgroundPadding ?? 4;
  const letterSpacing = s?.letterSpacing ?? 0;
  const lineHeight = s?.lineHeight ?? 1.4;
  return (
    <div
      className={`subtitle-overlay-text ${animClass}`}
      style={{
        position: "absolute",
        left: `${posX}%`,
        top: `${posY}%`,
        transform: `translate(-50%, -50%) rotate(${s.rotation ?? 0}deg) scale(${(s.scaleX ?? 100) / 100}, ${(s.scaleY ?? 100) / 100})`,
        transformOrigin: "center",
        ["--sub-base-transform" as string]: `translate(-50%, -50%) rotate(${s.rotation ?? 0}deg) scale(${(s.scaleX ?? 100) / 100}, ${(s.scaleY ?? 100) / 100})`,
        fontFamily: s?.fontFamily,
        fontSize: `${Math.max(8, (s?.fontSize ?? 48) * fontScale)}px`,
        fontWeight: 700,
        lineHeight,
        color: baseColor,
        textShadow: finalTextShadow,
        WebkitTextStroke: strokeWidth > 0 ? `${strokeWidth}px ${strokeColor}` : undefined,
        paintOrder: "stroke fill",
        letterSpacing: `${letterSpacing * fontScale}px`,
        background: bgColor === "none" ? "transparent" : bgColor,
        padding: bgColor === "none" ? "4px 10px" : `${bgPadding * fontScale}px ${bgPadding * 2 * fontScale}px`,
        borderRadius: bgColor === "none" ? 0 : 4,
        textAlign: "center",
        whiteSpace: "pre-wrap",
        maxWidth: "86%",
        zIndex: 7,
        pointerEvents: "none",
      }}
    >
      {karaokeOn && clip.words
        ? (() => {
            // 兼容旧项目：text 含 \n 时拆分翻译（无高亮）+ 原文（karaoke 高亮）
            const text = clip.text || "";
            const newlinePos = text.indexOf("\n");
            if (newlinePos >= 0) {
              const translated = text.slice(0, newlinePos);
              return (
                <>
                  {translated}
                  <br />
                  {clip.words.map((w, i, arr) => {
                    const prev = arr[i - 1];
                    const needSpace = i > 0 && !!prev && needsWordSpace(prev.text, w.text);
                    return (
                      <span key={i} style={{ color: currentTime >= w.start ? highlightColor : baseColor }}>
                        {needSpace ? " " : ""}
                        {w.text}
                      </span>
                    );
                  })}
                </>
              );
            }
            return clip.words.map((w, i, arr) => {
              const prev = arr[i - 1];
              const needSpace = i > 0 && !!prev && needsWordSpace(prev.text, w.text);
              return (
                <span key={i} style={{ color: currentTime >= w.start ? highlightColor : baseColor }}>
                  {needSpace ? " " : ""}
                  {w.text}
                </span>
              );
            });
          })()
        : clip.text || ""}
    </div>
  );
}
