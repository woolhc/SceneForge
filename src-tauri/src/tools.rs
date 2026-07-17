use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::{AppHandle, Manager, Runtime};
use tokio::process::Command;

static BUNDLE_ROOTS: OnceLock<Vec<PathBuf>> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeTool {
    Ffmpeg,
    Ffprobe,
    Whisper,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolSource {
    Configured,
    Environment,
    Bundled,
    Path,
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolResolution {
    pub path: PathBuf,
    pub source: ToolSource,
    pub available: bool,
}

impl NativeTool {
    pub fn command_name(self) -> &'static str {
        match self {
            Self::Ffmpeg => "ffmpeg",
            Self::Ffprobe => "ffprobe",
            Self::Whisper => "whisper-cli",
        }
    }

    fn env_names(self) -> &'static [&'static str] {
        match self {
            Self::Ffmpeg => &["SCENEFORGE_FFMPEG_BIN", "FFMPEG_BIN"],
            Self::Ffprobe => &["SCENEFORGE_FFPROBE_BIN", "FFPROBE_BIN"],
            Self::Whisper => &[
                "SCENEFORGE_WHISPER_BIN",
                "SCENEFORGE_WHISPER_CLI_BIN",
                "WHISPER_CLI_BIN",
                "WHISPER_BIN",
            ],
        }
    }
}

pub fn platform_executable_name(tool: NativeTool) -> String {
    if cfg!(target_os = "windows") {
        format!("{}.exe", tool.command_name())
    } else {
        tool.command_name().to_string()
    }
}

fn configured_candidate(value: &str) -> Option<PathBuf> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    Some(PathBuf::from(value))
}

fn existing_file(path: &Path) -> bool {
    path.is_file()
}

pub fn initialize_bundle_roots<R: Runtime>(app: &AppHandle<R>) {
    let mut roots = Vec::new();
    if let Ok(path) = app.path().executable_dir() {
        roots.push(path);
    }
    if let Ok(path) = app.path().resource_dir() {
        if !roots.contains(&path) {
            roots.push(path);
        }
    }
    let _ = BUNDLE_ROOTS.set(roots);
}

pub fn bundled_candidates_for_roots(roots: &[PathBuf], tool: NativeTool) -> Vec<PathBuf> {
    let executable = platform_executable_name(tool);
    roots
        .iter()
        .flat_map(|root| [root.join(&executable), root.join("bin").join(&executable)])
        .collect()
}

fn path_candidates(path: PathBuf, windows: bool) -> Vec<PathBuf> {
    let mut candidates = vec![path.clone()];
    if windows && path.extension().is_none() {
        let mut with_exe = path.into_os_string();
        with_exe.push(".exe");
        candidates.push(PathBuf::from(with_exe));
    }
    candidates
}

fn configured_is_default_name(path: &Path, tool: NativeTool) -> bool {
    let configured = path.to_string_lossy();
    configured == tool.command_name() || configured == platform_executable_name(tool)
}

fn resolve_with(
    tool: NativeTool,
    configured: Option<&str>,
    env_override: Option<PathBuf>,
    current_executable: Option<PathBuf>,
    path_lookup: impl Fn(&str) -> Option<PathBuf>,
) -> ToolResolution {
    if let Some(configured) = configured.and_then(configured_candidate) {
        if !configured_is_default_name(&configured, tool) {
            if let Some(path) = path_candidates(configured.clone(), cfg!(target_os = "windows"))
                .into_iter()
                .find(|path| existing_file(path))
            {
                return ToolResolution {
                    path,
                    source: ToolSource::Configured,
                    available: true,
                };
            }
            if configured.components().count() == 1 {
                if let Some(path) = path_lookup(&configured.to_string_lossy()) {
                    return ToolResolution {
                        path,
                        source: ToolSource::Configured,
                        available: true,
                    };
                }
            }
        }
    }

    if let Some(path) = env_override.and_then(|path| {
        path_candidates(path, cfg!(target_os = "windows"))
            .into_iter()
            .find(|candidate| existing_file(candidate))
    }) {
        return ToolResolution {
            path,
            source: ToolSource::Environment,
            available: true,
        };
    }

    // Development builds can retain stale copied sidecars under target/debug.
    // Homebrew's whisper-cli is dynamically linked relative to its original
    // installation, so the copied executable may exist while being unable to
    // start. Prefer the directly installed PATH command during development;
    // explicit settings and environment overrides still remain authoritative.
    if cfg!(debug_assertions) && tool == NativeTool::Whisper {
        if let Some(path) = path_lookup(tool.command_name()) {
            return ToolResolution {
                path,
                source: ToolSource::Path,
                available: true,
            };
        }
    }

    let mut bundle_roots = BUNDLE_ROOTS.get().cloned().unwrap_or_default();
    if let Some(parent) = current_executable.as_deref().and_then(Path::parent) {
        let parent = parent.to_path_buf();
        if !bundle_roots.contains(&parent) {
            bundle_roots.push(parent);
        }
    }
    if let Some(path) = bundled_candidates_for_roots(&bundle_roots, tool)
        .into_iter()
        .find(|path| existing_file(path))
    {
        return ToolResolution {
            path,
            source: ToolSource::Bundled,
            available: true,
        };
    }

    if let Some(path) = path_lookup(tool.command_name()) {
        return ToolResolution {
            path,
            source: ToolSource::Path,
            available: true,
        };
    }

    ToolResolution {
        path: PathBuf::from(platform_executable_name(tool)),
        source: ToolSource::Missing,
        available: false,
    }
}

pub fn resolve(tool: NativeTool, configured: Option<&str>) -> ToolResolution {
    let env_override = tool
        .env_names()
        .iter()
        .find_map(|name| std::env::var_os(name).map(PathBuf::from));
    let current_executable = std::env::current_exe().ok();
    resolve_with(tool, configured, env_override, current_executable, |name| {
        which::which(name).ok()
    })
}

pub fn command(tool: NativeTool) -> Command {
    Command::new(resolve(tool, None).path)
}

pub fn command_with_config(tool: NativeTool, configured: Option<&str>) -> Command {
    Command::new(resolve(tool, configured).path)
}

pub fn whisper_model_candidates_in_dir(configured: &str, models_dir: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let configured = configured.trim();
    if !configured.is_empty() {
        candidates.push(PathBuf::from(configured));
    }
    for name in [
        "ggml-large-v3.bin",
        "ggml-medium-q5_0.bin",
        "ggml-medium.bin",
        "ggml-small.bin",
    ] {
        candidates.push(models_dir.join(name));
    }
    if cfg!(target_os = "macos") {
        candidates.push(PathBuf::from(
            "/opt/homebrew/share/whisper-cpp/ggml-medium-q5_0.bin",
        ));
        candidates.push(PathBuf::from(
            "/usr/local/share/whisper-cpp/ggml-medium-q5_0.bin",
        ));
    } else if cfg!(target_os = "linux") {
        candidates.push(PathBuf::from(
            "/usr/local/share/whisper-cpp/ggml-medium-q5_0.bin",
        ));
        candidates.push(PathBuf::from("/usr/share/whisper-cpp/ggml-medium-q5_0.bin"));
    }
    candidates
}

#[cfg(test)]
pub fn whisper_model_candidates(configured: &str, app_data_dir: &Path) -> Vec<PathBuf> {
    whisper_model_candidates_in_dir(configured, &app_data_dir.join("models"))
}

fn is_valid_model_file(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .map(|metadata| {
            metadata.file_type().is_file()
                && !metadata.file_type().is_symlink()
                && metadata.len() >= 1_000_000
        })
        .unwrap_or(false)
}

pub fn resolve_whisper_model_in_dir(configured: &str, models_dir: &Path) -> Option<PathBuf> {
    whisper_model_candidates_in_dir(configured, models_dir)
        .into_iter()
        .find(|path| is_valid_model_file(path))
}

pub fn resolve_whisper_model(configured: &str, app_data_dir: &Path) -> Option<PathBuf> {
    resolve_whisper_model_in_dir(configured, &app_data_dir.join("models"))
}

#[cfg(test)]
mod tests {
    use super::{
        bundled_candidates_for_roots, path_candidates, platform_executable_name, resolve_with,
        whisper_model_candidates, NativeTool, ToolSource,
    };
    use std::path::{Path, PathBuf};

    #[test]
    fn explicit_existing_path_has_highest_priority() {
        let current = std::env::current_exe().unwrap();
        let configured = current.to_string_lossy().to_string();
        let result = resolve_with(NativeTool::Whisper, Some(&configured), None, None, |_| None);
        assert!(result.available);
        assert_eq!(result.source, ToolSource::Configured);
    }

    #[test]
    fn development_whisper_prefers_runnable_path_over_stale_bundle() {
        let temp_root = std::env::temp_dir().join(format!(
            "sceneforge-whisper-resolution-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&temp_root).unwrap();
        let bundled = temp_root.join(platform_executable_name(NativeTool::Whisper));
        std::fs::write(&bundled, b"stale copied sidecar").unwrap();
        let path_whisper = PathBuf::from("/opt/homebrew/bin/whisper-cli");

        let result = resolve_with(
            NativeTool::Whisper,
            None,
            None,
            Some(temp_root.join("SceneForge")),
            |_| Some(path_whisper.clone()),
        );

        if cfg!(debug_assertions) {
            assert_eq!(result.source, ToolSource::Path);
            assert_eq!(result.path, path_whisper);
        } else {
            assert_eq!(result.source, ToolSource::Bundled);
            assert_eq!(result.path, bundled);
        }
        let _ = std::fs::remove_dir_all(temp_root);
    }

    #[test]
    fn path_lookup_remains_development_fallback() {
        let result = resolve_with(
            NativeTool::Ffmpeg,
            None,
            None,
            Some(PathBuf::from("/missing/SceneForge")),
            |name| Some(PathBuf::from(format!("/path/{name}"))),
        );
        assert_eq!(result.source, ToolSource::Path);
        assert!(result.path.ends_with("ffmpeg"));
    }

    #[test]
    fn model_candidates_include_app_data_models_directory() {
        let candidates = whisper_model_candidates("", Path::new("/data/SceneForge"));
        assert!(candidates
            .iter()
            .any(|path| path.ends_with("models/ggml-medium-q5_0.bin")));
    }
    #[test]
    fn windows_paths_probe_exe_suffix() {
        let candidates = path_candidates(PathBuf::from(r"C:\tools\whisper-cli"), true);
        assert!(candidates[1].to_string_lossy().ends_with("whisper-cli.exe"));
    }

    #[test]
    fn bundle_roots_cover_executable_and_resource_layouts() {
        let executable_root = PathBuf::from("/app/bin");
        let resource_root = PathBuf::from("/app/resources");
        let executable = platform_executable_name(NativeTool::Ffmpeg);
        let candidates = bundled_candidates_for_roots(
            &[executable_root.clone(), resource_root.clone()],
            NativeTool::Ffmpeg,
        );

        assert_eq!(
            candidates,
            vec![
                executable_root.join(&executable),
                executable_root.join("bin").join(&executable),
                resource_root.join(&executable),
                resource_root.join("bin").join(&executable),
            ]
        );
    }
}
