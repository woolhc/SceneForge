# SceneScript Multi-Part Overlay A3.2 设计

## 目标

让多图层 FFmpeg 渲染完整消费 `SourceWindowPlan.parts`，支持曲线变速、曲线倒放以及跨多个速度段的叠加图层，删除 A3.1 保留的直接源时间兼容回退。

## 现状问题

多图层路径只能直接消费一个 SourceWindow part。当曲线窗口产生多个 part 时，当前实现回退到 `sourceIn + offset * clamp(speed)`，会丢失曲线速度和倒放方向。

## 方案

每个多 part 视频输入只加载一次源媒体，并在 `filter_complex` 内生成时间线连续的视频流：

```text
[input] split=N
  -> trim(part 0) -> reverse? -> setpts(speed 0)
  -> trim(part 1) -> reverse? -> setpts(speed 1)
  -> ...
  -> concat=N -> [source-window]
  -> crop/scale/rotate/opacity/mask
```

part 顺序直接使用 SourceWindow 的时间线顺序。`trim` 使用绝对源时间；每个 part 在 concat 前归零时间戳。

## 模块边界

- `source_window.rs` 继续只负责时间线到源区间的纯数据编译。
- `ffmpeg.rs::compile_multi_part_source_filter` 只把 SourceWindow parts 翻译为 FFmpeg filter 字符串。
- 视觉 crop、scale、关键帧、opacity、mask 和 overlay 链保持现有职责。

## 输入策略

- 图片继续使用 `-loop 1`。
- 单 part 视频继续使用输入级 `-ss/-t`，避免无谓解码。
- 多 part 视频使用单个完整输入，由 filter 的 `trim` 读取各源区间。
- 空 SourceWindow 不进入 inputs，避免生成无效滤镜。

## 测试

- 正向多 part 生成 split、trim、setpts、concat。
- 倒放多 part 每个 part 都包含 reverse，且 concat 顺序保持时间线顺序。
- 单 part 不生成 split/concat。
- `ffmpeg.rs` 不再包含 `source_in + offset_into_clip` 回退。

## 完成标准

- 所有视频图层都使用 SourceWindow 选择源区间。
- 多图层曲线变速和曲线倒放不再回退常速计算。
- Rust、TypeScript、前端构建和 FFmpeg 冒烟脚本全部通过。
