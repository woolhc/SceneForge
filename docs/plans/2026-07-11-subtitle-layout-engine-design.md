# Subtitle Intelligence & Layout Engine

一键生成字幕采用确定性布局引擎：Whisper words 是唯一时间真相；规则引擎基于停顿、标点、CPS、时长和画布宽度重新生成 Cue；每个 Cue 在生成阶段使用实际字体测量主动写入换行，预览和 ASS 导出复用相同文本。

布局由 9:16、16:9、1:1 Profile 控制，字号按输出画布短边计算，位置落在安全区内。标准字幕关闭默认 karaoke，避免逐词渲染覆盖显式换行。双语字幕使用同一轨道、同一视觉块和同一时间段，不再分散到屏幕顶部和底部。

AI 仅作为后续低置信度语义顾问：只能返回已有 word index 的推荐断点、保护短语和重点词，不得修改原文、时间戳或屏幕几何；AI 失败时规则引擎必须正常完成。

## AI semantic advisor

DeepSeek 可用时，前端将词级 transcript 按最多 160 个词分批并发 2 路请求。协议只允许返回 `preferredBreakAfterIndices`、`protectedRanges` 和置信度；后端过滤越界、最后词断点、倒置区间和重复索引，前端再次校验并将局部 index 转换为全局 index。置信度低于 0.55 的响应不会影响规则引擎。任意批次失败时仅该批回退规则断句，不阻塞字幕生成。

## VideoLingo-inspired bilingual artifacts

双语模式生成两个字幕轨：目标语言主轨与原文辅助轨。每对 Clip 共享 `subtitleGroupId`，并记录 `subtitleRole` 与语言；时间默认完全一致，视觉位置独立。生成前执行一次全文语言上下文分析，产出摘要、内容类型、语气和术语，并提供给语义断句和翻译。翻译采用忠实翻译后再进行自然/短视频长度适配。完整 raw transcript、source cues、translated cues、AI 统计和质量报告同时写入项目 `artifacts/subtitle-latest.json`。
