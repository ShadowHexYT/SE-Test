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
pub struct QuickNote {
    pub id: String,
    pub title: String,
    pub body: String,
    pub hidden: bool,
    pub locked: bool,
    pub starred: bool,
    #[serde(rename = "passwordHint")]
    pub password_hint: Option<String>,
    #[serde(rename = "passwordValue")]
    pub password_value: Option<String>,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedWebsite {
    pub id: String,
    pub label: String,
    pub url: String,
    pub description: String,
    pub tone: String,
    #[serde(default)]
    pub favorite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedAppState {
    #[serde(default)]
    pub history: Vec<ClipboardItem>,
    #[serde(default)]
    pub notes: Vec<QuickNote>,
    pub preferences: Preferences,
    #[serde(default)]
    pub websites: Vec<SavedWebsite>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppBootstrap {
    pub history: Vec<ClipboardItem>,
    pub notes: Vec<QuickNote>,
    pub preferences: Preferences,
    pub platform: String,
    pub websites: Vec<SavedWebsite>,
}
