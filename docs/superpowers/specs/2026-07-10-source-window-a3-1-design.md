# SceneScript SourceWindow A3.1 设计

## 目标

建立 Rust 端统一的 `SourceWindowPlan`，把时间线区间编译为 FFmpeg 应读取的源媒体区间。常速、负速度、`reverse=true` 和曲线变速必须与 RenderGraph 的时间映射一致。

本阶段优先修复倒放片段在分段导出中的取帧方向错误，并让单片段渲染与常速多图层渲染消费同一份源窗口计划。

## 已确认问题

- `render_single_clip_for_segment` 对倒放子段仍使用 `sourceIn + timelineOffset * speed`，随后只反转该错误区间。
- `render_segment_with_overlay` 直接计算 `sourceIn + offset * clamp(speed)`，忽略负速度、`reverse` 和 RenderGraph 的映射规则。
- 曲线渲染器单独维护曲线离散算法，并且没有处理倒放曲线。

例如源区间 `10..20`、倒放 clip 的时间线窗口 `2..5`，正确 FFmpeg 输入应为 `15..18` 后执行 reverse；现有实现读取 `12..15`。

## 架构

新增 `src-tauri/src/source_window.rs`：

```rust
pub struct SourceWindowPlan {
    pub parts: Vec<SourceWindowPart>,
}

pub struct SourceWindowPart {
    pub source_start: f64,
    pub source_end: f64,
    pub timeline_duration: f64,
    pub speed: f64,
    pub reverse: bool,
}

pub fn compile_source_window(
    clip: &Clip,
    timeline_start: f64,
    timeline_duration: f64,
) -> SourceWindowPlan;
```

`timeline_start` 使用项目绝对时间。输出 part 按时间线播放顺序排列，`source_start < source_end` 始终成立；倒放通过 `reverse=true` 表达。

## 共享语义

- 将 RenderGraph 内部的曲线离散函数开放为 crate 内共享函数，SourceWindow 不复制曲线算法。
- 常速窗口通过 RenderGraph 的 `timeline_to_source_time` 计算两端源时间。
- 曲线窗口与共享曲线段求交，输出一个或多个恒定速度 part。
- 非法区间、NaN、负时长返回空计划，不生成无效 FFmpeg 参数。

## FFmpeg 接入

### 单片段

- 单 part 使用其 `source_start/source_end/speed/reverse` 构造 `-ss`、`-t`、`reverse` 和 `setpts`。
- 多 part 复用现有子段渲染与 concat 流程，但输入改为 SourceWindow parts。
- 删除 `CurveRenderSegment` 和 `speed_curve_to_segments` 的重复实现。

### 多图层

- 图片维持循环输入。
- 只有一个 SourceWindow part 的视频层使用计划中的源区间、速度和倒放标记。
- 多 part 曲线图层暂保留现有曲线多段限制，不在 A3.1 重写整套 overlay filter graph；A3.2 将加入多 part 输入链。

## 测试

- 常速正向窗口。
- `reverse=true` 子窗口。
- `speed < 0` 子窗口。
- 恒定曲线窗口。
- 倒放曲线窗口。
- 窗口跨越多个曲线速度段。
- FFmpeg 单片段参数计划使用正确源区间。

## 完成标准

- 单片段导出不再直接计算 `sourceIn + offset * speed`。
- 旧曲线段离散实现从 `ffmpeg.rs` 删除。
- 常速多图层路径使用 SourceWindow part 的源时间、速度和倒放。
- Rust、TypeScript、构建与 FFmpeg 冒烟脚本全部通过。
