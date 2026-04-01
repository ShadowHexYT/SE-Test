mod clipboard;
mod models;
mod persistence;
mod shell;

use models::{AppBootstrap, EdgeSide, PersistedAppState};
use tauri::AppHandle;

#[cfg(target_os = "macos")]
fn trigger_shell_haptic() -> Result<(), String> {
    use objc2_app_kit::{
        NSHapticFeedbackManager, NSHapticFeedbackPattern, NSHapticFeedbackPerformanceTime,
        NSHapticFeedbackPerformer,
    };

    let performer = NSHapticFeedbackManager::defaultPerformer();
    performer.performFeedbackPattern_performanceTime(
        NSHapticFeedbackPattern::LevelChange,
        NSHapticFeedbackPerformanceTime::Now,
    );

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn trigger_shell_haptic() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn load_app_state(app: AppHandle) -> Result<AppBootstrap, String> {
    let persisted = persistence::load_state(&app)?;
    let platform = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    };

    Ok(AppBootstrap {
        history: persisted.history,
        preferences: persisted.preferences,
        platform: platform.to_string(),
    })
}

#[tauri::command]
fn save_app_state(app: AppHandle, payload: PersistedAppState) -> Result<(), String> {
    persistence::save_state(&app, &payload)
}

#[tauri::command]
fn read_clipboard_snapshot() -> Result<Option<models::ClipboardSnapshot>, String> {
    clipboard::read_clipboard_snapshot()
}

#[tauri::command]
fn copy_text_to_clipboard(text: &str) -> Result<(), String> {
    clipboard::copy_text_to_clipboard(text)
}

#[tauri::command]
fn copy_image_to_clipboard(image_data_url: &str) -> Result<(), String> {
    clipboard::copy_image_to_clipboard(image_data_url)
}

#[tauri::command]
fn sync_shell_state(
    app: AppHandle,
    panel_width: f64,
    reveal: f64,
    panel_offset_y: f64,
    edge_side: EdgeSide,
) -> Result<(), String> {
    shell::sync_shell(&app, panel_width, reveal, panel_offset_y, edge_side)
}

#[tauri::command]
fn animate_shell_state(
    app: AppHandle,
    panel_width: f64,
    target_reveal: f64,
    panel_offset_y: f64,
    edge_side: EdgeSide,
    duration_ms: Option<u64>,
) -> Result<(), String> {
    shell::animate_shell(
        &app,
        panel_width,
        target_reveal,
        panel_offset_y,
        edge_side,
        duration_ms.unwrap_or(shell::DEFAULT_ANIMATION_MS),
    )
}

#[tauri::command]
fn get_shell_geometry(app: AppHandle) -> Result<shell::ShellGeometry, String> {
    shell::get_shell_geometry(&app)
}

#[tauri::command]
fn trigger_edge_haptic() -> Result<(), String> {
    trigger_shell_haptic()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(shell::ShellState::default())
        .setup(|app| {
            shell::initialize_shell(&app.handle().clone())
                .expect("failed to initialize SwiftEdge shell");
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_app_state,
            save_app_state,
            read_clipboard_snapshot,
            copy_text_to_clipboard,
            copy_image_to_clipboard,
            sync_shell_state,
            animate_shell_state,
            get_shell_geometry,
            trigger_edge_haptic
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
