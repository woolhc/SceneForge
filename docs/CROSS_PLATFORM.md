# Cross-Platform Desktop Packaging

SceneForge targets macOS, Windows 10/11, and desktop Linux through Tauri 2. Native installers package these command-line sidecars next to the application executable:

- `ffmpeg`
- `ffprobe`
- `whisper-cli`

Whisper model files are intentionally not embedded because they are large. Put a model such as `ggml-medium-q5_0.bin` in the app data `models` directory shown in Settings, or select an explicit model path.

## Runtime resolution order

The Rust backend resolves native tools in this order:

1. Explicit configured executable path, when supported.
2. `SCENEFORGE_FFMPEG_BIN`, `SCENEFORGE_FFPROBE_BIN`, or `SCENEFORGE_WHISPER_BIN`.
3. A bundled Tauri sidecar next to the SceneForge executable.
4. System `PATH` for development and backward compatibility.

This keeps packaged users independent of shell PATH configuration while preserving local developer overrides.

## Preparing sidecars

Tauri requires build inputs with a Rust target-triple suffix. The preparation script copies source executables to the expected names:

```bash
npm run prepare:sidecars
```

Examples:

- `src-tauri/binaries/ffmpeg-aarch64-apple-darwin`
- `src-tauri/binaries/ffmpeg-x86_64-unknown-linux-gnu`
- `src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe`

Generated files under `src-tauri/binaries/` are ignored by Git.

### Environment overrides

FFmpeg and FFprobe default to architecture-specific static npm packages. You can still override all tools with portable/self-contained executables:

```bash
SCENEFORGE_FFMPEG_BIN=/portable/ffmpeg \
SCENEFORGE_FFPROBE_BIN=/portable/ffprobe \
SCENEFORGE_WHISPER_BIN=/portable/whisper-cli \
npm run tauri:build
```

Compatibility aliases are accepted: `FFMPEG_BIN`, `FFPROBE_BIN`, `SCENEFORGE_WHISPER_CLI_BIN`, `WHISPER_CLI_BIN`, and `WHISPER_BIN`.

The script only discovers tools from PATH when the requested target platform matches the host platform. Cross-target staging requires explicit environment overrides, preventing a macOS executable from being accidentally renamed as a Windows or Linux sidecar.

## Local development

Run `npm install` to obtain native FFmpeg/FFprobe binaries. Install or build whisper.cpp locally, or provide a whisper executable override. Release builds run strict sidecar staging through `tauri.conf.json`. Development uses `src-tauri/tauri.dev.conf.json`, which disables bundled sidecars and falls back to explicit paths or system PATH so UI/backend development is not blocked by a missing Whisper installation.

```bash
npm run tauri:dev
npm run tauri:build
```

Package-manager binaries are acceptable for local development. They may link to machine-specific shared libraries and therefore should not be used as release sidecars.

## CI

`.github/workflows/desktop-build.yml` builds native installers on macOS, Windows, and Linux. It:

1. Installs architecture-specific static FFmpeg/FFprobe packages through `npm ci`.
2. Builds a static whisper-cli from a pinned whisper.cpp revision.
3. Runs TypeScript and Rust tests.
4. Stages target-specific sidecars.
5. Builds native Tauri bundles.
6. Uploads DMG/app, NSIS/MSI, AppImage/deb/rpm artifacts.

Each operating system is built natively. Tauri installers should not be produced by merely renaming binaries from another platform.

## Optional tools

`audio-separator` remains an optional PATH-only enhancement for vocal separation. When it is unavailable, SceneForge uses the existing FFmpeg fallback; it is not part of the required cross-platform runtime bundle.
