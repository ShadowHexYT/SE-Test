use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClipboardType {
    Text,
    Image,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardSnapshot {
    pub signature: String,
    #[serde(rename = "type")]
    pub item_type: ClipboardType,
    pub text: Option<String>,
    #[serde(rename = "imageDataUrl")]
    pub image_data_url: Option<String>,
    pub width: Option<usize>,
    pub height: Option<usize>,
    #[serde(rename = "capturedAt")]
    pub captured_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DismissMode {
    HoverOff,
    ClickAway,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EdgeSide {
    Left,
    Right,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ThemeMode {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preferences {
    #[serde(rename = "dismissMode")]
    pub dismiss_mode: DismissMode,
    #[serde(rename = "edgeSide")]
    pub edge_side: EdgeSide,
    #[serde(rename = "themeMode")]
    pub theme_mode: ThemeMode,
    #[serde(rename = "panelWidth")]
    pub panel_width: f64,
    #[serde(rename = "panelOffsetY")]
    pub panel_offset_y: f64,
    #[serde(rename = "splitRatio")]
    pub split_ratio: f64,
    pub pinned: bool,
    #[serde(rename = "maxHistory")]
    pub max_history: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardItem {
    pub id: String,
    pub signature: String,
    #[serde(rename = "type")]
    pub item_type: ClipboardType,
    pub text: Option<String>,
    #[serde(rename = "imageDataUrl")]
    pub image_data_url: Option<String>,
    pub width: Option<usize>,
    pub height: Option<usize>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedAppState {
    pub history: Vec<ClipboardItem>,
    pub preferences: Preferences,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppBootstrap {
    pub history: Vec<ClipboardItem>,
    pub preferences: Preferences,
    pub platform: String,
}
