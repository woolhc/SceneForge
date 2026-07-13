mod ai;
mod asr;
mod commands;
mod ffmpeg;
mod ffmpeg_expression;
mod lut_data;
mod models;
mod pexels;
mod render_graph;
mod render_plan;
mod source_window;
mod storage;
mod temp;
mod tools;
mod tts;
mod whisper_models;

use storage::AppState;

pub fn run() {
    // M18: 初始化失败时用原生消息框提示，而不是直接 panic
    let state = match AppState::initialize() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("初始化失败: {e}");
            show_fatal_dialog(&format!(
                "应用存储初始化失败：\n{e}\n\n请检查磁盘空间和权限后重试。"
            ));
            std::process::exit(1);
        }
    };

    tauri::Builder::default()
        .setup(|app| {
            tools::initialize_bundle_roots(app.handle());
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::check_ffmpeg,
            commands::write_debug_log,
            commands::read_lut_file,
            commands::reveal_path,
            commands::generate_waveform,
            commands::load_settings,
            commands::save_settings,
            commands::get_whisper_model_status,
            commands::download_whisper_model,
            commands::cancel_whisper_model_download,
            commands::select_whisper_model,
            commands::delete_whisper_model,
            commands::open_models_directory,
            commands::list_projects,
            commands::create_project,
            commands::get_project,
            commands::save_project,
            commands::delete_project,
            commands::add_track,
            commands::list_voice_profiles,
            commands::create_voice_profile,
            commands::import_voice_profile,
            commands::update_voice_profile,
            commands::delete_voice_profile,
            commands::replace_voice_sample,
            commands::preview_voice_profile,
            commands::segment_script,
            commands::search_pexels_videos,
            commands::search_pexels_photos,
            commands::cache_asset_video,
            commands::generate_narration,
            commands::generate_audio,
            commands::detach_audio,
            commands::separate_vocals,
            commands::generate_subtitles,
            commands::import_srt,
            commands::transcribe_to_text,
            commands::transcribe_to_sentences,
            commands::transcribe_project_narration,
            commands::save_subtitle_artifact,
            commands::refine_transcript,
            commands::analyze_subtitle_language_context,
            commands::advise_subtitle_breaks,
            commands::enrich_segments,
            commands::import_media,
            commands::generate_thumbnail,
            commands::generate_filmstrip,
            commands::render_project,
            commands::cancel_render,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SceneForge");
}

/// 用平台原生消息框显示致命错误（不依赖 Tauri runtime）
#[cfg(target_os = "macos")]
fn show_fatal_dialog(msg: &str) {
    let _ = std::process::Command::new("osascript")
        .args(["-e", &format!("display dialog \"{}\" buttons {{\"退出\"}} default button 1 with title \"SceneForge\" with icon stop", msg.replace('"', "\\\""))])
        .status();
}

#[cfg(not(target_os = "macos"))]
fn show_fatal_dialog(msg: &str) {
    eprintln!("{msg}");
}
