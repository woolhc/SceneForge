mod ai;
mod asr;
mod commands;
mod ffmpeg;
mod lut_data;
mod models;
mod pexels;
mod storage;
mod tts;

use storage::AppState;

pub fn run() {
    let state = AppState::initialize().expect("failed to initialize local app storage");

    tauri::Builder::default()
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
            commands::generate_audio,
            commands::detach_audio,
            commands::separate_vocals,
            commands::generate_subtitles,
            commands::transcribe_to_text,
            commands::transcribe_to_sentences,
            commands::enrich_segments,
            commands::import_media,
            commands::generate_thumbnail,
            commands::render_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SceneScript Desktop");
}
