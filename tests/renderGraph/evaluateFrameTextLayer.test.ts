import assert from "node:assert/strict";
import { evaluateFrame } from "../../src/renderGraph/evaluateFrame";
import type { RenderGraph, RenderLayer } from "../../src/renderGraph/types";
import type { Clip } from "../../src/types";

function makeClip(overrides: Partial<Clip>): Clip {
  return {
    id: "clip_text_1",
    trackId: "track_text_1",
    sourceId: null,
    startOnTrack: 0,
    duration: 3,
    sourceIn: 0,
    sourceOut: 3,
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    text: "独立文本图层",
    transitionIn: null,
    transitionOut: null,
    ...overrides,
  };
}

function makeLayer(overrides: Partial<RenderLayer>): RenderLayer {
  return {
    id: "layer_text_1",
    trackId: "track_text_1",
    trackKind: "text",
    trackOrder: 0,
    trackMuted: false,
    clip: makeClip({}),
    media: null,
    ...overrides,
  };
}

const graph: RenderGraph = {
  duration: 5,
  canvas: { width: 1080, height: 1920 },
  layers: [makeLayer({})],
};

const frame = evaluateFrame(graph, 1);

assert.equal(
  frame.subtitleLayers.length,
  1,
  "独立文本图层在播放态必须像字幕轨一样出现在 subtitleLayers 中",
);
assert.equal(frame.subtitleLayers[0].text, "独立文本图层");
assert.equal(frame.visualLayers.length, 0, "文本图层不应进入 visualLayers（无绑定素材）");
assert.equal(frame.audioLayers.length, 0, "文本图层不产生音频");

const outsideRange = evaluateFrame(graph, 10);
assert.equal(outsideRange.subtitleLayers.length, 0, "超出 clip 时间范围时文本图层不应出现");
