use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, LogicalUnit, Manager, WebviewWindow, WindowSizeConstraints,
};

use crate::models::EdgeSide;

pub const HANDLE_WIDTH: f64 = 22.0;
pub const MIN_PANEL_WIDTH: f64 = 680.0;
pub const MAX_PANEL_WIDTH: f64 = 960.0;
pub const DEFAULT_ANIMATION_MS: u64 = 220;
pub const MIN_PANEL_HEIGHT: f64 = 820.0;
pub const MAX_PANEL_HEIGHT: f64 = 1440.0;
pub const WINDOW_VERTICAL_MARGIN: f64 = 12.0;
pub const EDGE_SWIPE_EVENT: &str = "glint://edge-swipe-open";

pub struct ShellState {
    animation_generation: AtomicU64,
    panel_width: Mutex<f64>,
    reveal: Mutex<f64>,
    panel_offset_y: Mutex<f64>,
    edge_side: Mutex<EdgeSide>,
    geometry: Mutex<ShellGeometry>,
    last_applied_frame: Mutex<Option<AppliedFrame>>,
}

impl Default for ShellState {
    fn default() -> Self {
        Self {
            animation_generation: AtomicU64::new(0),
            panel_width: Mutex::new(MIN_PANEL_WIDTH),
            reveal: Mutex::new(0.0),
            panel_offset_y: Mutex::new(0.0),
            edge_side: Mutex::new(EdgeSide::Right),
            geometry: Mutex::new(ShellGeometry::default()),
            last_applied_frame: Mutex::new(None),
        }
    }
}

#[derive(Clone)]
struct AppliedFrame {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    focusable: bool,
}

struct DockedFrame {
    position: LogicalPosition<f64>,
    size: LogicalSize<f64>,
    geometry: ShellGeometry,
}

fn ease_out_cubic(progress: f64) -> f64 {
    1.0 - (1.0 - progress).powi(3)
}

fn current_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "Glint main window was not available.".to_string())
}

fn docked_frame(
    app: &AppHandle,
    panel_width: f64,
    reveal: f64,
    panel_offset_y: f64,
    edge_side: &EdgeSide,
) -> Result<DockedFrame, String> {
    let window = current_window(app)?;
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| "Glint could not resolve a display.".to_string())?;

    let work_area = monitor.work_area();
    let scale = monitor.scale_factor();
    let clamped_panel_width = panel_width.clamp(MIN_PANEL_WIDTH, MAX_PANEL_WIDTH);
    let total_width = clamped_panel_width + HANDLE_WIDTH;
    let hidden_width = total_width - HANDLE_WIDTH;
    let reveal_progress = reveal.clamp(0.0, 1.0);
    let logical_width = total_width / scale;
    let monitor_height = f64::from(work_area.size.height) / scale;
    let logical_height =
        (monitor_height - (WINDOW_VERTICAL_MARGIN * 2.0)).clamp(MIN_PANEL_HEIGHT, MAX_PANEL_HEIGHT);
    let logical_left_edge = f64::from(work_area.position.x) / scale;
    let logical_right_edge = f64::from(work_area.position.x + work_area.size.width as i32) / scale;
    let logical_top_bound = f64::from(work_area.position.y) / scale + WINDOW_VERTICAL_MARGIN;
    let logical_bottom_bound =
        (f64::from(work_area.position.y) / scale) + monitor_height - logical_height - WINDOW_VERTICAL_MARGIN;
    let centered_y = (f64::from(work_area.position.y) / scale) + ((monitor_height - logical_height) / 2.0);
    let logical_y = (centered_y + panel_offset_y).clamp(logical_top_bound, logical_bottom_bound.max(logical_top_bound));
    let logical_x = match edge_side {
        EdgeSide::Right => {
            logical_right_edge - (HANDLE_WIDTH / scale) - ((hidden_width / scale) * reveal_progress)
        }
        EdgeSide::Left => logical_left_edge - (hidden_width / scale) + ((hidden_width / scale) * reveal_progress),
    };

    Ok(DockedFrame {
        position: LogicalPosition::new(logical_x, logical_y),
        size: LogicalSize::new(logical_width, logical_height),
        geometry: ShellGeometry {
            x: (logical_x * scale).round(),
            y: (logical_y * scale).round(),
            width: (logical_width * scale).round(),
            height: (logical_height * scale).round(),
            handle_width: (HANDLE_WIDTH * scale).round(),
            edge_side: match edge_side {
                EdgeSide::Left => "left".to_string(),
                EdgeSide::Right => "right".to_string(),
            },
            max_offset_y: ((logical_bottom_bound - centered_y).abs()).round(),
        },
    })
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
        .map_err(|_| "Glint shell width lock was poisoned.".to_string())? = panel_width;
    *shell_state
        .reveal
        .lock()
        .map_err(|_| "Glint shell reveal lock was poisoned.".to_string())? = reveal;
    *shell_state
        .panel_offset_y
        .lock()
        .map_err(|_| "Glint shell offset lock was poisoned.".to_string())? = panel_offset_y;

    Ok(())
}

pub fn apply_shell_position(
    app: &AppHandle,
    panel_width: f64,
    reveal: f64,
    panel_offset_y: f64,
    edge_side: EdgeSide,
) -> Result<(), String> {
    let clamped_panel_width = panel_width.clamp(MIN_PANEL_WIDTH, MAX_PANEL_WIDTH);
    let clamped_reveal = reveal.clamp(0.0, 1.0);
    let window = current_window(app)?;
    let frame = docked_frame(app, clamped_panel_width, clamped_reveal, panel_offset_y, &edge_side)?;
    let focusable = clamped_reveal > 0.02;
    let next_applied = AppliedFrame {
        x: frame.position.x,
        y: frame.position.y,
        width: frame.size.width,
        height: frame.size.height,
        focusable,
    };
    let shell_state = app.state::<ShellState>();
    let mut last_applied = shell_state
        .last_applied_frame
        .lock()
        .map_err(|_| "Glint shell frame lock was poisoned.".to_string())?;
    let geometry_changed = last_applied.as_ref().map_or(true, |previous| {
        (previous.x - next_applied.x).abs() > 0.5
            || (previous.y - next_applied.y).abs() > 0.5
            || (previous.width - next_applied.width).abs() > 0.5
            || (previous.height - next_applied.height).abs() > 0.5
    });
    let focus_changed = last_applied
        .as_ref()
        .map_or(true, |previous| previous.focusable != next_applied.focusable);

    if geometry_changed || focus_changed {
        apply_window_style(&window, frame.size, clamped_reveal)?;
    }
    if geometry_changed {
        window.set_size(frame.size).map_err(|error| error.to_string())?;
        window
            .set_position(frame.position)
            .map_err(|error| error.to_string())?;
    }
    *last_applied = Some(next_applied);
    drop(last_applied);

    write_shell_state(app, clamped_panel_width, clamped_reveal, panel_offset_y)?;
    *shell_state
        .edge_side
        .lock()
        .map_err(|_| "Glint shell edge-side lock was poisoned.".to_string())? = edge_side;
    *shell_state
        .geometry
        .lock()
        .map_err(|_| "Glint shell geometry lock was poisoned.".to_string())? = frame.geometry;

    Ok(())
}

pub fn sync_shell(
    app: &AppHandle,
    panel_width: f64,
    reveal: f64,
    panel_offset_y: f64,
    edge_side: EdgeSide,
) -> Result<(), String> {
    let shell_state = app.state::<ShellState>();
    shell_state.animation_generation.fetch_add(1, Ordering::SeqCst);
    apply_shell_position(app, panel_width, reveal, panel_offset_y, edge_side)
}

pub fn animate_shell(
    app: &AppHandle,
    panel_width: f64,
    target_reveal: f64,
    panel_offset_y: f64,
    edge_side: EdgeSide,
    duration_ms: u64,
) -> Result<(), String> {
    let shell_state = app.state::<ShellState>();
    let generation = shell_state.animation_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let start_reveal = *shell_state
        .reveal
        .lock()
        .map_err(|_| "Glint shell reveal lock was poisoned.".to_string())?;
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

            let _ = apply_shell_position(&app_handle, clamped_width, reveal, panel_offset_y, edge_side.clone());

            if progress >= 1.0 {
                return;
            }

            thread::sleep(Duration::from_millis(8));
        }
    });

    Ok(())
}

pub fn initialize_shell(app: &AppHandle) -> Result<(), String> {
    initialize_swipe_monitor(app)?;
    sync_shell(app, 760.0, 0.0, 0.0, EdgeSide::Right)?;
    current_window(app)?.show().map_err(|error| error.to_string())
}

pub fn reveal_shell_from_tray(app: &AppHandle) -> Result<(), String> {
    let shell_state = app.state::<ShellState>();
    let panel_width = *shell_state
        .panel_width
        .lock()
        .map_err(|_| "Glint shell width lock was poisoned.".to_string())?;
    let panel_offset_y = *shell_state
        .panel_offset_y
        .lock()
        .map_err(|_| "Glint shell offset lock was poisoned.".to_string())?;
    let edge_side = shell_state
        .edge_side
        .lock()
        .map_err(|_| "Glint shell edge-side lock was poisoned.".to_string())?
        .clone();

    animate_shell(app, panel_width, 1.0, panel_offset_y, edge_side, DEFAULT_ANIMATION_MS)?;
    let window = current_window(app)?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn initialize_swipe_monitor(app: &AppHandle) -> Result<(), String> {
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2_app_kit::{NSEvent, NSEventMask};

    static SWIPE_MONITOR_INSTALLED: std::sync::OnceLock<()> = std::sync::OnceLock::new();

    if SWIPE_MONITOR_INSTALLED.get().is_some() {
        return Ok(());
    }

    let app_handle = app.clone();
    let monitor_block = RcBlock::new(move |event: NonNull<NSEvent>| {
        let event = unsafe { event.as_ref() };
        let delta_x = event.deltaX();
        let scrolling_delta_x = event.scrollingDeltaX();
        let dominant_delta = if scrolling_delta_x.abs() > delta_x.abs() {
            scrolling_delta_x
        } else {
            delta_x
        };

        if dominant_delta.abs() < 0.2 {
            return;
        }

        let shell_state = app_handle.state::<ShellState>();
        let edge_side = match shell_state.edge_side.lock() {
            Ok(edge_side) => edge_side.clone(),
            Err(_) => return,
        };
        let reveal = match shell_state.reveal.lock() {
            Ok(reveal) => *reveal,
            Err(_) => return,
        };

        if reveal > 0.08 {
            return;
        }

        let should_open = match edge_side {
            EdgeSide::Right => dominant_delta < 0.0,
            EdgeSide::Left => dominant_delta > 0.0,
        };

        if should_open {
            let _ = app_handle.emit(EDGE_SWIPE_EVENT, ());
        }
    });

    let monitor = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(
        NSEventMask::Swipe,
        &monitor_block,
    )
    .ok_or_else(|| "Glint could not register its swipe monitor.".to_string())?;

    std::mem::forget(monitor);
    let _ = SWIPE_MONITOR_INSTALLED.set(());

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn initialize_swipe_monitor(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellGeometry {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub handle_width: f64,
    pub edge_side: String,
    pub max_offset_y: f64,
}

pub fn get_shell_geometry(app: &AppHandle) -> Result<ShellGeometry, String> {
    app.state::<ShellState>()
        .geometry
        .lock()
        .map_err(|_| "Glint shell geometry lock was poisoned.".to_string())
        .map(|geometry| geometry.clone())
}
