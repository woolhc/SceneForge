# Frontend Capability Matrix

> 目的：把“后端已经有能力，但前端没有完整产品闭环”的问题显式化。每个能力必须同时检查数据模型、入口 UI、属性 UI、预览、导出、验证，避免只在 Rust/FFmpeg 或 API 层实现后前端不可用。

## 状态图例

| 状态 | 含义 |
|---|---|
| Done | 当前代码已有可用闭环 |
| Partial | 已有一部分，但仍有用户可见缺口 |
| Missing | 能力存在或需求明确，但前端未接入 |
| Risk | 功能有实现，但存在一致性、性能或可观测性风险 |

## 能力矩阵

| 能力 | 后端/API | 数据模型 | 入口 UI | 属性 UI | 预览 | 导出 | 验证 | 当前结论 |
|---|---|---|---|---|---|---|---|---|
| 媒体导入：视频 | Done | Done | Done | Done | Done | Done | Partial | 可用，仍需更完整回归 |
| 媒体导入：图片 | Done | Done | Done | Partial | Done | Done | Partial | 已补文件选择和轨道放置；图片属性仍需组件化 |
| 媒体导入：音频 | Done | Done | Done | Partial | Partial | Done | Partial | 可放入音频/配音轨；实时音量/静音链路仍需补强 |
| 自动轨道放置 | N/A | Done | Done | N/A | N/A | N/A | Missing | 已按素材类型选择/创建兼容轨；缺针对性单测 |
| 轨道兼容校验 | N/A | Done | Done | N/A | N/A | N/A | Missing | 拖拽到不兼容轨道会阻止并提示；缺测试 |
| 图片轨主画面 | N/A | Done | Done | Partial | Done | Done | Partial | 预览和导出链路已接通，仍需覆盖滤镜/裁剪组合 |
| 图片叠加层 | N/A | Done | Done | Partial | Done | Done | Partial | 可作为视觉叠加轨；仍需覆盖蒙版/滤镜组合 |
| 裁剪 | Done | Done | Done | Done | Done | Done | Partial | 比例计算已修正；缺浏览器级回归 |
| 变换：位置/缩放/透明度 | Done | Done | Done | Done | Done | Done | Partial | 基础闭环可用 |
| 变换：旋转 | Done | Done | Done | Done | Done | Done | Missing | 已补旋转滑块和关键帧入口；待冒烟验证 |
| 混合模式/圆角 | Done | Done | Done | Done | Partial | Done | Partial | 入口存在；需纳入 WebGL/导出一致性测试 |
| 滤镜：CSS/基础调色 | Done | Done | Done | Done | Done | Done | Partial | 已有 fallback；仍需复杂组合验证 |
| 滤镜：LUT | Done | Done | Done | Done | Done | Done | Partial | LUT 加载和 WebGL 冒烟已覆盖；需 UI 选择回归 |
| 蒙版：类型 | Done | Done | Done | Done | Done | Done | Partial | UI/预览/导出均有链路 |
| 蒙版：中心/尺寸/旋转/羽化/反转 | Done | Done | Done | Done | Partial | Done | Partial | UI 已补全；复杂 feather/rotation 场景需更多 WebGL 冒烟 |
| 关键帧：位置/缩放/透明/旋转 | Partial | Done | Done | Done | Partial | Partial | Missing | 入口已补齐；主轨、音量、曲线编辑和标记仍不足 |
| 转场 | Partial | Partial | Done | Partial | Partial | Partial | Partial | 新语义仍未完全落地，需单独继续 |
| 字幕编辑 | Done | Done | Done | Done | Done | Done | Partial | 基础可用；撤销/逐字编辑回归需持续覆盖 |
| 卡拉 OK 字幕 | Done | Done | Done | Partial | Done | Done | Partial | 可显示；样式和编辑体验仍可提升 |
| 配音/音频分离 | Done | Done | Done | Partial | Partial | Done | Missing | 后端能力多，前端入口和状态反馈仍偏弱 |
| 导出配置 | Done | Done | Done | Done | N/A | Done | Partial | HEVC、音频、字幕、蒙版组合需持续回归 |
| 代理剪辑 | Partial | Partial | Missing | Missing | Partial | N/A | Missing | 有预览侧 backfill 迹象，缺完整产品入口和状态 |
| 预览诊断 | N/A | N/A | Done | N/A | Done | N/A | N/A | 已加调试面板，方便定位滤镜/活跃元素问题 |

## 下一批优先级

1. 为媒体放置 helpers 抽出 `editor/mediaPlacement.ts`，补单测覆盖图片、视频、音频、voiceover、锁轨/不兼容轨道。
2. 把视觉属性面板拆成 `VisualPropertiesPanel`、`CropPanel`、`MaskPanel`、`KeyframePanel`，降低 `App.tsx` 修改风险。
3. 给浏览器冒烟测试补 UI 路径：导入/选择滤镜/选择 LUT/调蒙版/调旋转后读取 canvas 或元素样式。
4. 继续补转场新语义、音量关键帧、代理剪辑状态 UI，这三项仍是明显的“后端有但产品闭环不完整”。
