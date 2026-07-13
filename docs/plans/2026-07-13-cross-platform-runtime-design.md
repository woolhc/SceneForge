# Cross-platform desktop runtime

## Target

SceneForge supports macOS, Windows 10/11, and mainstream desktop Linux distributions from one codebase. Packaged users should not need FFmpeg, FFprobe, or whisper-cli on PATH. Whisper model files remain user data because they are large and independently updateable.

## Runtime resolution

All native tool launches use one resolver with this precedence:

1. Explicit user/configured executable path when applicable.
2. `SCENEFORGE_FFMPEG_BIN`, `SCENEFORGE_FFPROBE_BIN`, or `SCENEFORGE_WHISPER_BIN` environment override.
3. Tauri external binary placed next to the application executable.
4. System PATH for development/backward compatibility.

Windows executable suffixes and path separators are handled centrally. Packaged binaries are staged with the Rust target triple expected by Tauri and are renamed to neutral executable names in the final bundle.

## Packaging

A Node preparation script discovers the current Rust host triple, resolves source tools from environment overrides or PATH, and copies them to `src-tauri/binaries/<tool>-<target-triple>[.exe]`. Tauri `externalBin` packages those files. Generated binaries are ignored by Git; CI prepares them independently for macOS, Windows, and Linux.

## Models and app data

The app creates a `models` directory under its platform data directory. Whisper model discovery checks explicit settings, then common files in that directory, then legacy system locations. Models are not embedded in the installer.

## Verification

Unit tests cover executable naming, sidecar path precedence, environment/PATH fallback, and model discovery. CI builds native installers on macOS, Windows, and Linux. Existing media, subtitle, preview, and render tests remain required on the development platform.
