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
        notes: persisted.notes,
        preferences: persisted.preferences,
        platform: platform.to_string(),
        websites: persisted.websites,
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
fn open_clipboard_image_in_preview(image_data_url: &str) -> Result<(), String> {
    clipboard::open_image_in_preview(image_data_url)
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
            #[cfg(target_os = "macos")]
            {
                use tauri::{
                    menu::{Menu, MenuItem, PredefinedMenuItem},
                    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
                    ActivationPolicy,
                };

                let app_handle = app.handle().clone();
                let _ = app_handle.set_activation_policy(ActivationPolicy::Accessory);
                let _ = app_handle.set_dock_visibility(false);

                let open_item = MenuItem::with_id(&app_handle, "menu_open_memora", "Open Memora", true, None::<&str>)?;
                let quit_item = PredefinedMenuItem::quit(&app_handle, Some("Quit Memora"))?;
                let tray_menu = Menu::with_items(&app_handle, &[&open_item, &quit_item])?;
                let tray_icon = app.default_window_icon().cloned().ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;

                TrayIconBuilder::with_id("memora-tray")
                    .icon(tray_icon)
                    .icon_as_template(true)
                    .show_menu_on_left_click(false)
                    .tooltip("Memora")
                    .menu(&tray_menu)
                    .on_menu_event(|app, event| {
                        if event.id().as_ref() == "menu_open_memora" {
                            let _ = shell::reveal_shell_from_tray(app);
                        }
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let _ = shell::reveal_shell_from_tray(&tray.app_handle());
                        }
                    })
                    .build(&app_handle)?;
            }

            shell::initialize_shell(&app.handle().clone())
                .expect("failed to initialize Memora shell");
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_app_state,
            save_app_state,
            read_clipboard_snapshot,
            copy_text_to_clipboard,
            copy_image_to_clipboard,
            open_clipboard_image_in_preview,
            sync_shell_state,
            animate_shell_state,
            get_shell_geometry,
            trigger_edge_haptic
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
