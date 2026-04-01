import { useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, MutableRefObject, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  CopyIcon,
  EyeOffIcon,
  GlobeIcon,
  ImageIcon,
  LinkIcon,
  LockIcon,
  MoonIcon,
  NoteIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon,
  TextIcon,
  TrashIcon,
} from "./Icons";
import type { PlatformMeta, Preferences } from "../types";

type PrimaryMode = "clipboard" | "notes" | "websites";

interface QuickNote {
  id: string;
  title: string;
  body: string;
  hidden: boolean;
  locked: boolean;
  updatedAt: string;
}

interface SavedWebsite {
  id: string;
  label: string;
  url: string;
  description: string;
  tone: string;
}

interface AppShellProps {
  clipboard: {
    clearHistory: () => void;
    deleteItem: (itemId: string) => void;
    filter: "all" | "text" | "link" | "image";
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
    setFilter: (filter: "all" | "text" | "link" | "image") => void;
    setSelectedId: (id: string | null) => void;
    updateQuery: (value: string) => void;
    visibleHistory: AppShellProps["clipboard"]["history"];
  };
  loadError: string | null;
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
  resolvedTheme: "light" | "dark";
  setPreferences: Dispatch<SetStateAction<Preferences>>;
}

const INITIAL_NOTES: QuickNote[] = [
  {
    id: "note-1",
    title: "Launch notes",
    body: "Keep the side utility fast. Prioritize quick snippets, checklists, and ideas that are worth resurfacing later.",
    hidden: false,
    locked: false,
    updatedAt: "Just now",
  },
  {
    id: "note-2",
    title: "Private copy",
    body: "Account recovery answers and short private references should be lockable before they stay in reach.",
    hidden: false,
    locked: true,
    updatedAt: "12 min ago",
  },
  {
    id: "note-3",
    title: "Hidden scratchpad",
    body: "Temporary working note kept out of the main list until I need it again.",
    hidden: true,
    locked: false,
    updatedAt: "Yesterday",
  },
];

const INITIAL_WEBSITES: SavedWebsite[] = [
  {
    id: "site-1",
    label: "Instagram",
    url: "https://www.instagram.com",
    description: "Saved social feed for quick check-ins while multitasking.",
    tone: "sunrise",
  },
  {
    id: "site-2",
    label: "X / Twitter",
    url: "https://x.com",
    description: "Fast-moving timeline and notifications in a narrow side surface.",
    tone: "midnight",
  },
  {
    id: "site-3",
    label: "Reddit",
    url: "https://www.reddit.com",
    description: "Saved community view for reading and scrolling beside your main work.",
    tone: "ember",
  },
];

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

function isLikelyLink(text: string | undefined) {
  if (!text) {
    return false;
  }

  return /^(https?:\/\/|www\.|mailto:)/i.test(text.trim());
}

function getHostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function normalizeWebsiteUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

export function AppShell({
  clipboard,
  loadError,
  panel,
  platformMeta,
  preferences,
  resolvedTheme,
  setPreferences,
}: AppShellProps) {
  const panelBodyStyle = {
    "--swift-list-width": panel.listWidth,
  } as CSSProperties;
  const lastHapticAtRef = useRef(0);
  const [mode, setMode] = useState<PrimaryMode>("clipboard");
  const [notes, setNotes] = useState<QuickNote[]>(INITIAL_NOTES);
  const [selectedNoteId, setSelectedNoteId] = useState<string>(INITIAL_NOTES[0].id);
  const [notesQuery, setNotesQuery] = useState("");
  const [websites, setWebsites] = useState<SavedWebsite[]>(INITIAL_WEBSITES);
  const [selectedWebsiteId, setSelectedWebsiteId] = useState<string>(INITIAL_WEBSITES[0].id);
  const [websiteQuery, setWebsiteQuery] = useState("");
  const [websiteDraft, setWebsiteDraft] = useState("");

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

  const visibleNotes = useMemo(() => {
    const normalized = notesQuery.trim().toLowerCase();

    return notes.filter((note) => {
      if (!normalized) {
        return true;
      }

      return `${note.title} ${note.body}`.toLowerCase().includes(normalized);
    });
  }, [notes, notesQuery]);

  const selectedNote = visibleNotes.find((note) => note.id === selectedNoteId) ?? visibleNotes[0] ?? null;

  const visibleWebsites = useMemo(() => {
    const normalized = websiteQuery.trim().toLowerCase();

    return websites.filter((site) => {
      if (!normalized) {
        return true;
      }

      return `${site.label} ${site.url} ${site.description}`.toLowerCase().includes(normalized);
    });
  }, [websiteQuery, websites]);

  const selectedWebsite =
    visibleWebsites.find((site) => site.id === selectedWebsiteId) ?? visibleWebsites[0] ?? null;

  const createQuickNote = () => {
    const nextNote: QuickNote = {
      id: `note-${Date.now()}`,
      title: "Untitled note",
      body: "Start typing here. Keep it quick, compact, and easy to revisit from the edge.",
      hidden: false,
      locked: false,
      updatedAt: "Just now",
    };

    setNotes((current) => [nextNote, ...current]);
    setSelectedNoteId(nextNote.id);
    setMode("notes");
  };

  const toggleSelectedNote = (key: "hidden" | "locked") => {
    if (!selectedNote) {
      return;
    }

    setNotes((current) =>
      current.map((note) =>
        note.id === selectedNote.id
          ? {
              ...note,
              [key]: !note[key],
              updatedAt: "Just now",
            }
          : note,
      ),
    );
  };

  const addWebsite = () => {
    const normalizedUrl = normalizeWebsiteUrl(websiteDraft);

    if (!normalizedUrl) {
      return;
    }

    const nextSite: SavedWebsite = {
      id: `site-${Date.now()}`,
      label: getHostname(normalizedUrl),
      url: normalizedUrl,
      description: "New saved destination ready to open inside SwiftEdge.",
      tone: "ocean",
    };

    setWebsites((current) => [nextSite, ...current]);
    setSelectedWebsiteId(nextSite.id);
    setWebsiteDraft("");
    setMode("websites");
  };

  const primarySearchValue =
    mode === "clipboard" ? clipboard.query : mode === "notes" ? notesQuery : websiteQuery;
  const primarySearchPlaceholder =
    mode === "clipboard"
      ? "Search clipboard"
      : mode === "notes"
        ? "Search notes"
        : "Search websites";

  const updatePrimarySearch = (value: string) => {
    if (mode === "clipboard") {
      clipboard.updateQuery(value);
      return;
    }

    if (mode === "notes") {
      setNotesQuery(value);
      return;
    }

    setWebsiteQuery(value);
  };

  return (
    <div
      className="app"
      data-platform={platformMeta.id}
      data-edge-side={preferences.edgeSide}
      data-theme={resolvedTheme}
    >
      <div className="edge-shell" data-edge-side={preferences.edgeSide}>
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
          data-phase={panel.phase}
          onMouseEnter={() => {
            panel.setIsPanelHovered(true);
            panel.openPanel();
          }}
          onMouseLeave={() => {
            panel.setIsPanelHovered(false);
            panel.scheduleClose();
          }}
        >
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
              <div className="panel__masthead">
                <button className="account-chip" type="button" aria-label="Link Google account">
                  <span className="account-chip__avatar">G</span>
                </button>
                <span className="panel__eyebrow">SwiftEdge</span>
                <span className="panel__brand">SwiftEdge</span>
                <div className="theme-toggle" role="group" aria-label="Theme mode">
                  <button
                    className="theme-toggle__option"
                    type="button"
                    data-active={preferences.themeMode === "light"}
                    aria-label="Light mode"
                    onClick={() => {
                      setPreferences((current) => ({
                        ...current,
                        themeMode:
                          current.themeMode === "system"
                            ? resolvedTheme === "light"
                              ? "dark"
                              : "light"
                            : current.themeMode === "light"
                              ? "dark"
                              : "light",
                      }));
                    }}
                  >
                    <SunIcon />
                  </button>
                  <button
                    className="theme-toggle__option"
                    type="button"
                    data-active={preferences.themeMode === "dark"}
                    aria-label="Dark mode"
                    onClick={() => {
                      setPreferences((current) => ({
                        ...current,
                        themeMode:
                          current.themeMode === "system"
                            ? resolvedTheme === "dark"
                              ? "light"
                              : "dark"
                            : current.themeMode === "dark"
                              ? "light"
                              : "dark",
                      }));
                    }}
                  >
                    <MoonIcon />
                  </button>
                </div>
                <div className="panel__toolbar">
                  <button
                    className="icon-button"
                    type="button"
                    data-variant="pin"
                    data-active={preferences.pinned}
                    onClick={panel.togglePinned}
                    aria-label="Toggle pin"
                  >
                    <PinIcon />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    data-variant="settings"
                    data-active={panel.settingsOpen}
                    onClick={() => panel.setSettingsOpen(!panel.settingsOpen)}
                    aria-label="Open settings"
                  >
                    <SettingsIcon />
                  </button>
                </div>
              </div>

              <div className="panel__primary-nav" role="tablist" aria-label="SwiftEdge sections">
                {[
                  { value: "clipboard", label: "Clipboard", icon: <CopyIcon /> },
                  { value: "notes", label: "Notes", icon: <NoteIcon /> },
                  { value: "websites", label: "Websites", icon: <GlobeIcon /> },
                ].map((tab) => (
                  <button
                    key={tab.value}
                    className="panel__primary-tab"
                    data-active={mode === tab.value}
                    role="tab"
                    type="button"
                    onClick={() => setMode(tab.value as PrimaryMode)}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                  </button>
                ))}
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
                <div className="settings__section-title">Open Side</div>
                <div className="settings__segment">
                  <button
                    className="settings__segment-button"
                    type="button"
                    data-active={preferences.edgeSide === "left"}
                    onClick={() => {
                      setPreferences((current) => ({
                        ...current,
                        edgeSide: "left",
                      }));
                    }}
                  >
                    Left
                  </button>
                  <button
                    className="settings__segment-button"
                    type="button"
                    data-active={preferences.edgeSide === "right"}
                    onClick={() => {
                      setPreferences((current) => ({
                        ...current,
                        edgeSide: "right",
                      }));
                    }}
                  >
                    Right
                  </button>
                </div>
                <div className="settings__section-title">Appearance</div>
                <button
                  className="settings__option"
                  type="button"
                  onClick={() => {
                    setPreferences((current) => ({
                      ...current,
                      themeMode: "system",
                    }));
                  }}
                >
                  <div>
                    <div className="settings__label">Use system appearance</div>
                    <div className="settings__hint">Follows your current macOS or Windows light/dark setting.</div>
                  </div>
                  <div className="settings__check">
                    {preferences.themeMode === "system" ? "On" : ""}
                  </div>
                </button>
              </div>
            ) : null}

            {mode === "clipboard" ? (
              <div className="panel__body" ref={panel.splitContainerRef} style={panelBodyStyle}>
                <aside className="list-pane">
                  <div className="list-pane__toolbar">
                    <label className="panel__search panel__search--inline">
                      <SearchIcon />
                      <input
                        value={primarySearchValue}
                        onChange={(event) => updatePrimarySearch(event.currentTarget.value)}
                        placeholder={primarySearchPlaceholder}
                        spellCheck={false}
                      />
                    </label>

                    <div className="list-pane__toolbar-row">
                      <div className="segment">
                        {[
                          ["all", "All"],
                          ["text", "Text"],
                          ["link", "Links"],
                          ["image", "Images"],
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            className="segment__button"
                            data-active={clipboard.filter === value}
                            type="button"
                            onClick={() => clipboard.setFilter(value as "all" | "text" | "link" | "image")}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {loadError ? <div className="error-banner">{loadError}</div> : null}

                  <div className="history">
                    {clipboard.visibleHistory.length ? (
                      clipboard.visibleHistory.map((item) => {
                        const isLinkItem = item.type === "text" && isLikelyLink(item.text);

                        return (
                          <button
                            key={item.id}
                            className="item"
                            type="button"
                            data-selected={clipboard.selectedId === item.id}
                            onClick={() => clipboard.setSelectedId(item.id)}
                          >
                            <div className="item__row">
                              <div className="item__type">
                                {item.type === "image" ? <ImageIcon /> : isLinkItem ? <LinkIcon /> : <TextIcon />}
                                {item.type === "image" ? "Image" : isLinkItem ? "Link" : "Text"}
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
                        );
                      })
                    ) : (
                      <div className="empty-state">
                        <div className="empty-state__card">
                          <div className="empty-state__title">Clipboard stays ready here</div>
                          <div className="empty-state__body">
                            Copy text, links, or images and SwiftEdge will keep the latest history in this edge panel.
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
                            ? isLikelyLink(clipboard.selectedItem.text)
                              ? "Link preview"
                              : "Text preview"
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
                            {clipboard.selectedItem.type === "text"
                              ? isLikelyLink(clipboard.selectedItem.text)
                                ? "Link item"
                                : "Text item"
                              : "Image item"}
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
                            SwiftEdge stays slim on the edge until you need a focused clipboard workspace.
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="detail-card detail-card--muted">
                      <div className="detail-card__meta">
                        <span>Panel behavior</span>
                        <span>{panel.phase}</span>
                      </div>
                      <div className="detail-pane__placeholder">
                        Right-edge trigger stays visible. Auto-close follows{" "}
                        {preferences.dismissMode === "hover-off" ? "hover-off timing" : "click-away focus"}.
                        Premium web panels now have a dedicated mode shell without disturbing clipboard-first flow.
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            ) : null}

            {mode === "notes" ? (
              <div className="panel__body panel__body--mode panel__body--compact-mode">
                <aside className="list-pane">
                  <div className="list-pane__toolbar">
                    <label className="panel__search panel__search--inline">
                      <SearchIcon />
                      <input
                        value={primarySearchValue}
                        onChange={(event) => updatePrimarySearch(event.currentTarget.value)}
                        placeholder={primarySearchPlaceholder}
                        spellCheck={false}
                      />
                    </label>

                    <div className="list-pane__toolbar-row">
                      <button className="chip-button chip-button--accent" type="button" onClick={createQuickNote}>
                        <PlusIcon />
                        New note
                      </button>
                    </div>
                  </div>

                  <div className="history">
                    {visibleNotes.map((note) => (
                      <button
                        key={note.id}
                        className="item item--note"
                        type="button"
                        data-selected={selectedNote?.id === note.id}
                        onClick={() => setSelectedNoteId(note.id)}
                      >
                        <div className="item__row">
                          <div className="item__type">
                            <NoteIcon />
                            {note.title}
                          </div>
                          <span className="item__badge">{note.updatedAt}</span>
                        </div>
                        <div className="note-flags">
                          {note.hidden ? <span className="mini-badge">Hidden</span> : null}
                          {note.locked ? <span className="mini-badge">Locked</span> : null}
                        </div>
                        <div className="item__preview">{summarizeText(note.body)}</div>
                      </button>
                    ))}
                  </div>
                </aside>

                <section className="detail-pane">
                  <div className="detail-pane__header">
                    <div>
                      <div className="detail-pane__title">{selectedNote?.title ?? "No note selected"}</div>
                      <div className="list-pane__meta">
                        {selectedNote ? "Quick access note detail" : "Select or create a note"}
                      </div>
                    </div>

                    <div className="detail-pane__actions">
                      <button className="chip-button" type="button" onClick={() => toggleSelectedNote("hidden")} disabled={!selectedNote}>
                        <EyeOffIcon />
                      </button>
                      <button className="chip-button" type="button" onClick={() => toggleSelectedNote("locked")} disabled={!selectedNote}>
                        <LockIcon />
                      </button>
                    </div>
                  </div>

                  <div className="detail-pane__scroll">
                    {selectedNote ? (
                      <>
                        <div className="detail-card">
                          <div className="detail-card__meta">
                            <span>{selectedNote.hidden ? "Hidden note" : "Visible note"}</span>
                            <span>{selectedNote.updatedAt}</span>
                          </div>
                          <div className="detail-card__text">{selectedNote.body}</div>
                        </div>
                        <div className="detail-card detail-card--muted">
                          <div className="detail-card__meta">
                            <span>Controls</span>
                            <span>Quick note utility</span>
                          </div>
                          <div className="detail-pane__placeholder">
                            Hide notes from the main list when you want less visual noise, or password-protect them
                            before keeping them inside reach.
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="startup-state">
                        <div className="startup-state__card">
                          <div className="startup-state__title">Fast notes, not a big editor</div>
                          <div className="startup-state__body">
                            Notes in SwiftEdge stay quick, compact, and easy to revisit from the screen edge.
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            ) : null}

            {mode === "websites" ? (
              <div className="panel__body panel__body--mode panel__body--compact-mode">
                <aside className="list-pane">
                  <div className="list-pane__toolbar">
                    <label className="panel__search panel__search--inline">
                      <SearchIcon />
                      <input
                        value={primarySearchValue}
                        onChange={(event) => updatePrimarySearch(event.currentTarget.value)}
                        placeholder={primarySearchPlaceholder}
                        spellCheck={false}
                      />
                    </label>

                    <div className="list-pane__toolbar-row">
                      <div />
                    </div>
                    <div className="website-draft">
                      <input
                        value={websiteDraft}
                        onChange={(event) => setWebsiteDraft(event.currentTarget.value)}
                        placeholder="Add a website URL"
                        spellCheck={false}
                      />
                      <button className="chip-button chip-button--accent" type="button" onClick={addWebsite}>
                        <PlusIcon />
                        Add
                      </button>
                    </div>
                  </div>

                  <div className="history">
                    {visibleWebsites.map((site) => (
                      <button
                        key={site.id}
                        className="item item--website"
                        type="button"
                        data-selected={selectedWebsite?.id === site.id}
                        onClick={() => setSelectedWebsiteId(site.id)}
                      >
                        <div className="item__row">
                          <div className="item__type">
                            <GlobeIcon />
                            {site.label}
                          </div>
                          <span className="item__badge">{getHostname(site.url)}</span>
                        </div>
                        <div className="item__preview">{site.description}</div>
                      </button>
                    ))}
                  </div>
                </aside>

                <section className="detail-pane">
                  <div className="detail-pane__header">
                    <div>
                      <div className="detail-pane__title">{selectedWebsite?.label ?? "No site selected"}</div>
                      <div className="list-pane__meta">
                        {selectedWebsite ? "Embedded destination shell" : "Choose a saved destination"}
                      </div>
                    </div>

                    <div className="detail-pane__actions">
                      {selectedWebsite ? (
                        <a className="chip-button chip-button--link" href={selectedWebsite.url} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      ) : null}
                    </div>
                  </div>

                  <div className="detail-pane__scroll">
                    {selectedWebsite ? (
                      <>
                        <div className="detail-card detail-card--browser" data-tone={selectedWebsite.tone}>
                          <div className="browser-shell__bar">
                            <span className="browser-shell__dot" />
                            <span className="browser-shell__dot" />
                            <span className="browser-shell__dot" />
                            <div className="browser-shell__address">{selectedWebsite.url}</div>
                          </div>
                          <div className="browser-shell__frame">
                            <iframe src={selectedWebsite.url} title={selectedWebsite.label} loading="lazy" />
                          </div>
                        </div>
                        <div className="detail-card detail-card--muted">
                          <div className="detail-card__meta">
                            <span>Saved entry</span>
                            <span>Web mode</span>
                          </div>
                          <div className="detail-pane__placeholder">
                            Some sites may limit embedding, but this mode establishes the lightweight web-panel direction
                            without turning SwiftEdge into a heavy browser app.
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="startup-state">
                        <div className="startup-state__card">
                          <div className="startup-state__title">Websites stay lightweight here</div>
                          <div className="startup-state__body">
                            Save links you want beside your work and load them inside this edge utility when needed.
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
