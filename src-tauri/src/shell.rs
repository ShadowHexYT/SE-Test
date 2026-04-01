use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use tauri::{
    AppHandle, LogicalPosition, LogicalSize, LogicalUnit, Manager, PhysicalPosition, WebviewWindow,
    WindowSizeConstraints,
};

pub const HANDLE_WIDTH: f64 = 16.0;
pub const MIN_PANEL_WIDTH: f64 = 520.0;
pub const MAX_PANEL_WIDTH: f64 = 760.0;
pub const DEFAULT_ANIMATION_MS: u64 = 220;
pub const MIN_PANEL_HEIGHT: f64 = 640.0;
pub const MAX_PANEL_HEIGHT: f64 = 920.0;
pub const WINDOW_VERTICAL_MARGIN: f64 = 24.0;

pub struct ShellState {
    animation_generation: AtomicU64,
    panel_width: Mutex<f64>,
    reveal: Mutex<f64>,
    panel_offset_y: Mutex<f64>,
}

impl Default for ShellState {
    fn default() -> Self {
        Self {
            animation_generation: AtomicU64::new(0),
            panel_width: Mutex::new(MIN_PANEL_WIDTH),
            reveal: Mutex::new(0.0),
            panel_offset_y: Mutex::new(0.0),
        }
    }
}

fn ease_out_cubic(progress: f64) -> f64 {
    1.0 - (1.0 - progress).powi(3)
}

fn current_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "SwiftEdge main window was not available.".to_string())
}

fn docked_frame(
    app: &AppHandle,
    panel_width: f64,
    reveal: f64,
    panel_offset_y: f64,
) -> Result<(LogicalPosition<f64>, LogicalSize<f64>), String> {
    let window = current_window(app)?;
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| "SwiftEdge could not resolve a display.".to_string())?;

    let work_area = monitor.work_area();
    let scale = monitor.scale_factor();
    let clamped_panel_width = panel_width.clamp(MIN_PANEL_WIDTH, MAX_PANEL_WIDTH);
    let total_width = clamped_panel_width + HANDLE_WIDTH;
    let hidden_width = total_width - HANDLE_WIDTH;
    let reveal_progress = reveal.clamp(0.0, 1.0);
    let logical_width = total_width / scale;
    let monitor_height = f64::from(work_area.size.height) / scale;
    let logical_height = (monitor_height * 0.84).clamp(MIN_PANEL_HEIGHT, MAX_PANEL_HEIGHT);
    let logical_right_edge = f64::from(work_area.position.x + work_area.size.width as i32) / scale;
    let logical_top_bound = f64::from(work_area.position.y) / scale + WINDOW_VERTICAL_MARGIN;
    let logical_bottom_bound =
        (f64::from(work_area.position.y) / scale) + monitor_height - logical_height - WINDOW_VERTICAL_MARGIN;
    let centered_y = (f64::from(work_area.position.y) / scale) + ((monitor_height - logical_height) / 2.0);
    let logical_y = (centered_y + panel_offset_y).clamp(logical_top_bound, logical_bottom_bound.max(logical_top_bound));
    let logical_x =
        logical_right_edge - (HANDLE_WIDTH / scale) - ((hidden_width / scale) * reveal_progress);

    Ok((
        LogicalPosition::new(logical_x, logical_y),
        LogicalSize::new(logical_width, logical_height),
    ))
}

fn apply_window_style(window: &WebviewWindow, size: LogicalSize<f64>, reveal: f64) -> Result<(), String> {
    window
        .set_decorations(false)
        .map_err(|error| error.to_string())?;
    window
        .set_always_on_top(true)
        .map_err(|error| error.to_string())?;
    window.set_shadow(false).map_err(|error| error.to_string())?;
    window
        .set_skip_taskbar(true)
        .map_err(|error| error.to_string())?;
    window
        .set_resizable(false)
        .map_err(|error| error.to_string())?;
    window
        .set_focusable(reveal > 0.02)
        .map_err(|error| error.to_string())?;
    window
        .set_size_constraints(WindowSizeConstraints {
            min_width: Some(LogicalUnit::new(MIN_PANEL_WIDTH + HANDLE_WIDTH).into()),
            min_height: Some(LogicalUnit::new(size.height).into()),
            max_width: Some(LogicalUnit::new(MAX_PANEL_WIDTH + HANDLE_WIDTH).into()),
            max_height: Some(LogicalUnit::new(size.height).into()),
        })
        .map_err(|error| error.to_string())
}

fn write_shell_state(app: &AppHandle, panel_width: f64, reveal: f64, panel_offset_y: f64) -> Result<(), String> {
    let shell_state = app.state::<ShellState>();
    *shell_state
        .panel_width
        .lock()
        .map_err(|_| "SwiftEdge shell width lock was poisoned.".to_string())? = panel_width;
    *shell_state
        .reveal
        .lock()
        .map_err(|_| "SwiftEdge shell reveal lock was poisoned.".to_string())? = reveal;
    *shell_state
        .panel_offset_y
        .lock()
        .map_err(|_| "SwiftEdge shell offset lock was poisoned.".to_string())? = panel_offset_y;

    Ok(())
}

pub fn apply_shell_position(
    app: &AppHandle,
    panel_width: f64,
    reveal: f64,
    panel_offset_y: f64,
) -> Result<(), String> {
    let clamped_panel_width = panel_width.clamp(MIN_PANEL_WIDTH, MAX_PANEL_WIDTH);
    let clamped_reveal = reveal.clamp(0.0, 1.0);
    let window = current_window(app)?;
    let (position, size) = docked_frame(app, clamped_panel_width, clamped_reveal, panel_offset_y)?;

    apply_window_style(&window, size, clamped_reveal)?;
    window.set_size(size).map_err(|error| error.to_string())?;
    window
        .set_position(position)
        .map_err(|error| error.to_string())?;

    write_shell_state(app, clamped_panel_width, clamped_reveal, panel_offset_y)
}

pub fn sync_shell(
    app: &AppHandle,
    panel_width: f64,
    reveal: f64,
    panel_offset_y: f64,
) -> Result<(), String> {
    let shell_state = app.state::<ShellState>();
    shell_state.animation_generation.fetch_add(1, Ordering::SeqCst);
    apply_shell_position(app, panel_width, reveal, panel_offset_y)
}

pub fn animate_shell(
    app: &AppHandle,
    panel_width: f64,
    target_reveal: f64,
    panel_offset_y: f64,
    duration_ms: u64,
) -> Result<(), String> {
    let shell_state = app.state::<ShellState>();
    let generation = shell_state.animation_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let start_reveal = *shell_state
        .reveal
        .lock()
        .map_err(|_| "SwiftEdge shell reveal lock was poisoned.".to_string())?;
    let clamped_target = target_reveal.clamp(0.0, 1.0);
    let clamped_width = panel_width.clamp(MIN_PANEL_WIDTH, MAX_PANEL_WIDTH);
    let app_handle = app.clone();

    thread::spawn(move || {
        let shell_state = app_handle.state::<ShellState>();
        let started_at = Instant::now();
        let duration = Duration::from_millis(duration_ms.max(1));

        loop {
            if shell_state.animation_generation.load(Ordering::SeqCst) != generation {
                return;
            }

            let elapsed = started_at.elapsed();
            let progress = (elapsed.as_secs_f64() / duration.as_secs_f64()).min(1.0);
            let eased = ease_out_cubic(progress);
            let reveal = start_reveal + ((clamped_target - start_reveal) * eased);

            let _ = apply_shell_position(&app_handle, clamped_width, reveal, panel_offset_y);

            if progress >= 1.0 {
                return;
            }

            thread::sleep(Duration::from_millis(8));
        }
    });

    Ok(())
}

pub fn initialize_shell(app: &AppHandle) -> Result<(), String> {
    sync_shell(app, 612.0, 0.0, 0.0)?;
    current_window(app)?.show().map_err(|error| error.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellGeometry {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub handle_width: f64,
}

pub fn get_shell_geometry(app: &AppHandle) -> Result<ShellGeometry, String> {
    let window = current_window(app)?;
    let position: PhysicalPosition<i32> = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;

    Ok(ShellGeometry {
        x: f64::from(position.x),
        y: f64::from(position.y),
        width: f64::from(size.width),
        height: f64::from(size.height),
        handle_width: HANDLE_WIDTH,
    })
}
