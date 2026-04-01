export type Platform = "macos" | "windows" | "linux";
export type ClipboardItemType = "text" | "image";
export type ClipboardFilter = "all" | ClipboardItemType | "link";
export type DismissMode = "hover-off" | "click-away";
export type EdgeSide = "left" | "right";
export type ThemeMode = "system" | "light" | "dark";
export type NoteFilter = "all" | "starred" | "hidden" | "locked";
export type PanelPhase =
  | "collapsed"
  | "opening"
  | "expanded"
  | "interacting"
  | "resizing"
  | "repositioning"
  | "closing";

export interface ClipboardItem {
  id: string;
  signature: string;
  type: ClipboardItemType;
  text?: string;
  imageDataUrl?: string;
  width?: number;
  height?: number;
  createdAt: string;
}

export interface ClipboardSnapshot {
  signature: string;
  type: ClipboardItemType;
  text?: string;
  imageDataUrl?: string;
  width?: number;
  height?: number;
  capturedAt: string;
}

export interface QuickNote {
  id: string;
  title: string;
  body: string;
  hidden: boolean;
  locked: boolean;
  starred: boolean;
  passwordHint?: string;
  passwordValue?: string;
  updatedAt: string;
  createdAt: string;
}

export interface SavedWebsite {
  id: string;
  label: string;
  url: string;
  description: string;
  tone: string;
}

export interface Preferences {
  dismissMode: DismissMode;
  edgeSide: EdgeSide;
  themeMode: ThemeMode;
  panelWidth: number;
  panelOffsetY: number;
  splitRatio: number;
  pinned: boolean;
  maxHistory: number;
}

export interface PersistedAppState {
  history: ClipboardItem[];
  notes: QuickNote[];
  preferences: Preferences;
  websites: SavedWebsite[];
}

export interface AppBootstrap extends PersistedAppState {
  platform: Platform;
}

export interface PlatformMeta {
  id: Platform;
  nativeLabel: string;
  statusLabel: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  dismissMode: "click-away",
  edgeSide: "right",
  themeMode: "system",
  panelWidth: 760,
  panelOffsetY: 0,
  splitRatio: 0.52,
  pinned: false,
  maxHistory: 50,
};
