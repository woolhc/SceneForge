import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

async function collectTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const tests = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) tests.push(...await collectTests(path));
    else if (entry.name.endsWith(".test.ts")) tests.push(path);
  }
  return tests;
}

const root = fileURLToPath(new URL("..", import.meta.url));
const tests = (await collectTests(join(root, "tests"))).sort();
if (tests.length === 0) throw new Error("no TypeScript tests found");

const outputDir = join(tmpdir(), `scenescript-ts-tests-${process.pid}`);
try {
  for (const [index, test] of tests.entries()) {
    const outfile = join(outputDir, `${index}-${basename(test, ".ts")}.mjs`);
    await build({
      entryPoints: [test],
      outfile,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      sourcemap: "inline",
      logLevel: "silent",
    });
    await import(`${pathToFileURL(outfile).href}?run=${Date.now()}`);
    console.log(`PASS ${relative(root, test)}`);
  }
  console.log(`TypeScript tests passed: ${tests.length}`);
} finally {
  await rm(outputDir, { recursive: true, force: true });
}
