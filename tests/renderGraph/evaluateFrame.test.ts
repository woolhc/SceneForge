import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileRenderGraph } from "../../src/renderGraph/compileRenderGraph";
import { evaluateFrame } from "../../src/renderGraph/evaluateFrame";
import { normalizeEvaluatedFrame } from "../../src/renderGraph/normalizeFrame";
import type { Project } from "../../src/types";

const fixturePath = resolve("tests/fixtures/render-graph-golden.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  project: Project;
  samples: { time: number; expected: unknown }[];
};
const graph = compileRenderGraph(fixture.project);

for (const sample of fixture.samples) {
  assert.deepEqual(
    normalizeEvaluatedFrame(evaluateFrame(graph, sample.time)),
    sample.expected,
    `frame at ${sample.time}s must match the shared golden result`,
  );
}
