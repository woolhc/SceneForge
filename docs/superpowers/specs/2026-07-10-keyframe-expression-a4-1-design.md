# SceneScript Keyframe Expression A4.1 设计

## 目标

统一 FFmpeg 的关键帧表达式编译，使位置、缩放、旋转、透明度和音量与 RenderGraph 的关键帧采样规则一致。

## 已确认问题

1. 当前表达式在第一个关键帧之前继续线性外推，而 RenderGraph 固定使用首帧值。
2. FFmpeg 所有关键帧都按 linear 处理，忽略 `easeIn`、`easeOut` 和 `easeInOut`。
3. opacity 关键帧会与静态 opacity 相乘；RenderGraph 语义是关键帧覆盖静态值。
4. opacity 使用 `geq`，其时间变量应为 `T`，当前表达式使用 overlay/volume 的小写 `t`。

## 架构

新增 `src-tauri/src/ffmpeg_expression.rs`，提供无 I/O 的纯表达式编译：

```rust
pub fn compile_keyframe_expression(
    keyframes: &[Keyframe],
    fallback: f64,
    offset: f64,
    time_variable: &str,
) -> String;

pub fn compile_opacity_alpha_filter(
    keyframes: &[Keyframe],
    offset: f64,
) -> Option<String>;
```

## 插值规则

- 无关键帧：返回 fallback。
- 单关键帧：始终返回该关键帧值。
- 首帧之前：固定首帧值。
- 末帧之后：固定末帧值。
- 区间内部：使用目标关键帧的 easing，与 Rust/TypeScript RenderGraph 保持一致。
- 非法或未知 easing 按 linear。

## Easing 表达式

- linear：`p`
- easeIn：`p*p`
- easeOut：`1-(1-p)*(1-p)`
- easeInOut：`if(lt(p,0.5),2*p*p,1-(-2*p+2)*(-2*p+2)/2)`

## FFmpeg 接入

- x/y、scale、rotation 和 volume 使用时间变量 `t`。
- opacity geq 使用时间变量 `T`。
- 当存在 opacity 关键帧时，不再提前应用静态 `colorchannelmixer` opacity。
- 删除 `ffmpeg.rs` 内重复的通用与 opacity 插值构造。

## 完成标准

- 表达式包含首尾夹取和 easing。
- opacity 关键帧覆盖静态 opacity。
- 实际 FFmpeg geq 冒烟接受生成的 `T` 表达式。
- 全部测试、构建和渲染脚本通过。
