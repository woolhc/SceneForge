import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/tauri.ts", import.meta.url), "utf8");

const fallbackCommands = new Set(
  [...source.matchAll(/command === "([^"]+)"/g)].map((match) => match[1]),
);
const apiCommands = new Set(
  [...source.matchAll(/\bcall(?:<[\s\S]*?>)?\(\s*"([^"]+)"/g)].map((match) => match[1]),
);
const missing = [...apiCommands].filter((command) => !fallbackCommands.has(command)).sort();

if (missing.length > 0) {
  throw new Error(`web fallback missing commands: ${missing.join(", ")}`);
}

console.log(`web fallback coverage ok: ${apiCommands.size} commands`);
