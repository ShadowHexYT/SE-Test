use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::models::{DismissMode, EdgeSide, PersistedAppState, Preferences, ThemeMode};

fn default_preferences() -> Preferences {
    Preferences {
        dismiss_mode: DismissMode::ClickAway,
        edge_side: EdgeSide::Right,
        theme_mode: ThemeMode::System,
        panel_width: 760.0,
        panel_offset_y: 0.0,
        split_ratio: 0.52,
        pinned: false,
        max_history: 50,
    }
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;

    fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;

    Ok(app_data_dir.join("swiftedge-state.json"))
}

pub fn load_state(app: &AppHandle) -> Result<PersistedAppState, String> {
    let path = state_path(app)?;

    if !path.exists() {
      return Ok(PersistedAppState {
          history: Vec::new(),
          notes: Vec::new(),
          preferences: default_preferences(),
          websites: Vec::new(),
      });
    }

    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;

    serde_json::from_str(&content).map_err(|error| error.to_string())
}

pub fn save_state(app: &AppHandle, state: &PersistedAppState) -> Result<(), String> {
    let path = state_path(app)?;
    let payload = serde_json::to_string_pretty(state).map_err(|error| error.to_string())?;

    fs::write(path, payload).map_err(|error| error.to_string())
}
