# SceneScript Frontend Preview Parity A4.2 设计

## 目标

重新审查 A3/A4 后端语义对应的前端实现，修复默认 PreviewEngine、WebCodecsRenderer 和跨语言 RenderGraph 契约之间的不一致。

## 已确认问题

1. `sampleKeyframes` 假设输入已排序；导入或旧项目中的乱序关键帧会得到错误值，而 Rust 会排序。
2. WebCodecs 基础层固定全画布、opacity=1、rotation=0，忽略 evaluated x/y/scale/rotation/effectiveOpacity。
3. 默认 PreviewEngine overlay 同时设置 `width=scale%` 和 CSS `scale(scale)`，导致缩放平方。
4. WebGL 和 Canvas 2D 蒙版旋转直接使用角度值，但底层 API 要求弧度。
5. TypeScript EvaluatedVisualLayer 有 rotation，Rust 黄金输出没有，跨端契约未覆盖旋转。

## 方案

- `sampleKeyframes` 内部复制并排序，兼容不可信项目数据。
- 新增纯函数 `positionVisualLayerBox` 和 `visualLayerCssStyle`，统一位置、尺寸、旋转和透明度布局。
- PreviewEngine overlay 使用 width/height 表达缩放，不再额外 scale；translate 百分比根据 x/y 修正边缘对齐。
- WebCodecs 基础层使用 evaluated box、rotation 和 opacity，Canvas/WebGL 路径共享结果。
- 所有 Canvas/WebGL 旋转输入统一从度转换为弧度。
- 将 rotation 加入 TypeScript/Rust 黄金规范化结果。

## 非目标

- 本阶段不重写 WebGL 的 object-fit/crop shader。
- 不统一 CSS mask 与 FFmpeg geq 的像素级羽化结果。
- 不修改 React-facing EngineState 的 Clip 兼容接口。

## 完成标准

- 两个预览器消费同一 evaluated transform。
- overlay scale 不再平方。
- 乱序关键帧前后端结果一致。
- rotation 进入共享黄金 fixture。
- TypeScript、Rust、构建与渲染脚本全部通过。
