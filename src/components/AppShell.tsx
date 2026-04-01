import { useRef } from "react";
import type { CSSProperties, Dispatch, MutableRefObject, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  CopyIcon,
  ImageIcon,
  PinIcon,
  SearchIcon,
  SettingsIcon,
  TextIcon,
  TrashIcon,
} from "./Icons";
import type { PlatformMeta, Preferences } from "../types";
import { moduleRegistry as swiftEdgeModuleRegistry } from "../modules";

interface AppShellProps {
  clipboard: {
    clearHistory: () => void;
    deleteItem: (itemId: string) => void;
    filter: "all" | "text" | "image";
    history: Array<{
      id: string;
      signature: string;
      type: "text" | "image";
      text?: string;
      imageDataUrl?: string;
      width?: number;
      height?: number;
      createdAt: string;
    }>;
    isPolling: boolean;
    query: string;
    recopyItem: (item: AppShellProps["clipboard"]["history"][number]) => Promise<void>;
    selectedId: string | null;
    selectedItem: AppShellProps["clipboard"]["history"][number] | null;
    setFilter: (filter: "all" | "text" | "image") => void;
    setSelectedId: (id: string | null) => void;
    updateQuery: (value: string) => void;
    visibleHistory: AppShellProps["clipboard"]["history"];
  };
  loadError: string | null;
  moduleRegistry: typeof swiftEdgeModuleRegistry;
  panel: {
    beginPanelResize: (metaKey: boolean) => void;
    beginSplitResize: (clientX: number) => void;
    beginVerticalReposition: (metaKey: boolean, startScreenY: number) => void;
    isOpen: boolean;
    listWidth: string;
    openPanel: () => void;
    phase: string;
    requestClose: () => void;
    scheduleClose: () => void;
    setIsHandleHovered: (value: boolean) => void;
    setIsPanelHovered: (value: boolean) => void;
    setPreferences: Dispatch<SetStateAction<Preferences>>;
    setSettingsOpen: (value: boolean) => void;
    settingsOpen: boolean;
    splitContainerRef: MutableRefObject<HTMLDivElement | null>;
    togglePinned: () => void;
  };
  platformMeta: PlatformMeta;
  preferences: Preferences;
  setPreferences: Dispatch<SetStateAction<Preferences>>;
}

function formatTimestamp(value: string) {
  const date = /^\d+$/.test(value) ? new Date(Number(value)) : new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(date);
}

function summarizeText(text: string | undefined) {
  if (!text) {
    return "Empty text item";
  }

  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

export function AppShell({
  clipboard,
  loadError,
  moduleRegistry,
  panel,
  platformMeta,
  preferences,
  setPreferences,
}: AppShellProps) {
  const panelBodyStyle = {
    "--swift-list-width": panel.listWidth,
  } as CSSProperties;
  const lastHapticAtRef = useRef(0);

  const triggerHaptic = () => {
    const now = Date.now();

    if (now - lastHapticAtRef.current < 220) {
      return;
    }

    lastHapticAtRef.current = now;
    void invoke("trigger_edge_haptic").catch(() => {
      console.warn("SwiftEdge edge haptic was unavailable.");
    });
  };

  return (
    <div className="app" data-platform={platformMeta.id}>
      <div className="edge-shell">
        <div
          className="edge-trigger"
          data-open={panel.isOpen}
          onMouseEnter={() => {
            panel.setIsHandleHovered(true);
            triggerHaptic();
            panel.openPanel();
          }}
          onMouseLeave={() => {
            panel.setIsHandleHovered(false);
            panel.scheduleClose();
          }}
        >
          <span className="edge-trigger__shine" />
          <span className="edge-trigger__core" />
        </div>

        <section
          className="panel"
          data-open={panel.isOpen}
          onMouseEnter={() => {
            panel.setIsPanelHovered(true);
            panel.openPanel();
          }}
          onMouseLeave={() => {
            panel.setIsPanelHovered(false);
            panel.scheduleClose();
          }}
        >
          <div className="panel__chrome" />
          <div
            className="panel__resize-rail"
            onPointerDown={(event) => {
              if (!event.metaKey) {
                return;
              }
              event.preventDefault();
              void panel.beginPanelResize(event.metaKey);
            }}
          />

          <div className="panel__content">
            <header
              className="panel__header"
              onPointerDown={(event) => {
                if (!event.metaKey) {
                  return;
                }

                event.preventDefault();
                void panel.beginVerticalReposition(event.metaKey, event.screenY);
              }}
            >
              <div className="panel__title-block">
                <span className="panel__eyebrow">{moduleRegistry.clipboard.label}</span>
                <span className="panel__title">SwiftEdge</span>
                <span className="panel__subtitle">{platformMeta.nativeLabel}</span>
              </div>

              <label className="panel__search">
                <SearchIcon />
                <input
                  value={clipboard.query}
                  onChange={(event) => clipboard.updateQuery(event.currentTarget.value)}
                  placeholder="Search clipboard"
                  spellCheck={false}
                />
              </label>

              <div className="panel__toolbar">
                <button
                  className="icon-button"
                  type="button"
                  data-active={preferences.pinned}
                  onClick={panel.togglePinned}
                  aria-label="Toggle pin"
                >
                  <PinIcon />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  data-active={panel.settingsOpen}
                  onClick={() => panel.setSettingsOpen(!panel.settingsOpen)}
                  aria-label="Open settings"
                >
                  <SettingsIcon />
                </button>
              </div>
            </header>

            {panel.settingsOpen ? (
              <div className="settings">
                <div className="settings__section-title">Dismiss</div>
                <button
                  className="settings__option"
                  type="button"
                  onClick={() => {
                    setPreferences((current) => ({
                      ...current,
                      dismissMode: "hover-off",
                    }));
                    panel.setSettingsOpen(false);
                  }}
                >
                  <div>
                    <div className="settings__label">Hover-off close</div>
                    <div className="settings__hint">Closes after pointer leaves the edge and panel.</div>
                  </div>
                  <div className="settings__check">
                    {preferences.dismissMode === "hover-off" ? "On" : ""}
                  </div>
                </button>
                <button
                  className="settings__option"
                  type="button"
                  onClick={() => {
                    setPreferences((current) => ({
                      ...current,
                      dismissMode: "click-away",
                    }));
                    panel.setSettingsOpen(false);
                  }}
                >
                  <div>
                    <div className="settings__label">Click-away close</div>
                    <div className="settings__hint">Stays open until focus leaves or Escape is pressed.</div>
                  </div>
                  <div className="settings__check">
                    {preferences.dismissMode === "click-away" ? "On" : ""}
                  </div>
                </button>
              </div>
            ) : null}

            <div
              className="panel__body"
              ref={panel.splitContainerRef}
              style={panelBodyStyle}
            >
              <aside className="list-pane">
                <div className="list-pane__toolbar">
                  <div className="segment">
                    {[
                      ["all", "All"],
                      ["text", "Text"],
                      ["image", "Images"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        className="segment__button"
                        data-active={clipboard.filter === value}
                        type="button"
                        onClick={() => clipboard.setFilter(value as "all" | "text" | "image")}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="status-pill">
                    <span className="status-dot" data-pending={!clipboard.isPolling} />
                    {platformMeta.statusLabel}
                  </div>
                </div>

                {loadError ? <div className="error-banner">{loadError}</div> : null}

                <div className="history">
                  {clipboard.visibleHistory.length ? (
                    clipboard.visibleHistory.map((item) => (
                      <button
                        key={item.id}
                        className="item"
                        type="button"
                        data-selected={clipboard.selectedId === item.id}
                        onClick={() => clipboard.setSelectedId(item.id)}
                      >
                        <div className="item__row">
                          <div className="item__type">
                            {item.type === "text" ? <TextIcon /> : <ImageIcon />}
                            {item.type === "text" ? "Text" : "Image"}
                          </div>
                          <span className="item__badge">{formatTimestamp(item.createdAt)}</span>
                        </div>

                        {item.type === "text" ? (
                          <div className="item__preview">{summarizeText(item.text)}</div>
                        ) : (
                          <div className="item__preview item__preview--image">
                            <img
                              className="item__thumbnail"
                              src={item.imageDataUrl}
                              alt="Clipboard preview"
                            />
                            <div>
                              <div>{item.width} x {item.height}</div>
                              <div className="item__timestamp">Ready to copy back instantly</div>
                            </div>
                          </div>
                        )}
                      </button>
                    ))
                  ) : (
                    <div className="empty-state">
                      <div className="empty-state__card">
                        <div className="empty-state__title">Clipboard stays ready here</div>
                        <div className="empty-state__body">
                          Copy text or images and SwiftEdge will keep the latest history in this edge panel.
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </aside>

              <div
                className="splitter"
                onPointerDown={(event) => {
                  event.preventDefault();
                  panel.beginSplitResize(event.clientX);
                }}
              />

              <section className="detail-pane">
                <div className="detail-pane__header">
                  <div>
                    <div className="detail-pane__title">Selected item</div>
                    <div className="list-pane__meta">
                      {clipboard.selectedItem
                        ? clipboard.selectedItem.type === "text"
                          ? "Text preview"
                          : "Image preview"
                        : "Clipboard detail"}
                    </div>
                  </div>

                  <div className="detail-pane__actions">
                    <button
                      className="chip-button"
                      type="button"
                      onClick={() => {
                        if (clipboard.selectedItem) {
                          void clipboard.recopyItem(clipboard.selectedItem);
                        }
                      }}
                      disabled={!clipboard.selectedItem}
                    >
                      <CopyIcon />
                    </button>
                    <button
                      className="chip-button"
                      type="button"
                      onClick={() => {
                        if (clipboard.selectedItem) {
                          clipboard.deleteItem(clipboard.selectedItem.id);
                        }
                      }}
                      disabled={!clipboard.selectedItem}
                    >
                      <TrashIcon />
                    </button>
                    <button className="chip-button" type="button" onClick={clipboard.clearHistory}>
                      Clear
                    </button>
                  </div>
                </div>

                <div className="detail-pane__scroll">
                  {clipboard.selectedItem ? (
                    <div className="detail-card">
                      <div className="detail-card__meta">
                        <span>
                          {clipboard.selectedItem.type === "text" ? "Text item" : "Image item"}
                        </span>
                        <span>{formatTimestamp(clipboard.selectedItem.createdAt)}</span>
                      </div>

                      {clipboard.selectedItem.type === "text" ? (
                        <div className="detail-card__text">
                          {clipboard.selectedItem.text || "This text item is empty."}
                        </div>
                      ) : (
                        <>
                          <img
                            className="detail-card__image"
                            src={clipboard.selectedItem.imageDataUrl}
                            alt="Selected clipboard item"
                          />
                          <div className="detail-card__text">
                            {clipboard.selectedItem.width} x {clipboard.selectedItem.height} image ready to
                            restore to the clipboard.
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="startup-state">
                      <div className="startup-state__card">
                        <div className="startup-state__title">Hover, copy, reuse</div>
                        <div className="startup-state__body">
                          SwiftEdge stays narrow until you need it, then opens into a focused clipboard workspace.
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="detail-card" style={{ marginTop: 12 }}>
                    <div className="detail-card__meta">
                      <span>Panel behavior</span>
                      <span>{panel.phase}</span>
                    </div>
                    <div className="detail-pane__placeholder">
                      Right-edge trigger stays visible. Auto-close follows{" "}
                      {preferences.dismissMode === "hover-off" ? "hover-off timing" : "click-away focus"}.
                      Premium web panels stay disabled in this build, but the module slot is reserved.
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
