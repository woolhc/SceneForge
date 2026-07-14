import assert from "node:assert/strict";
import tauriConfig from "../../src-tauri/tauri.conf.json";

const csp = tauriConfig.app.security.csp;
assert.match(csp, /media-src[^;]*https:\/\/videos\.pexels\.com/);
