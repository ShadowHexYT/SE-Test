export type Platform = "macos" | "windows" | "linux";
export type ClipboardItemType = "text" | "image";
export type ClipboardFilter = "all" | ClipboardItemType;
export type DismissMode = "hover-off" | "click-away";
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

export interface Preferences {
  dismissMode: DismissMode;
  panelWidth: number;
  panelOffsetY: number;
  splitRatio: number;
  pinned: boolean;
  maxHistory: number;
}

export interface PersistedAppState {
  history: ClipboardItem[];
  preferences: Preferences;
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
  dismissMode: "hover-off",
  panelWidth: 612,
  panelOffsetY: 0,
  splitRatio: 0.52,
  pinned: false,
  maxHistory: 50,
};
