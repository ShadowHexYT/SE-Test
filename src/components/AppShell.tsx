import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, MutableRefObject, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  CopyIcon,
  DownloadIcon,
  GlobeIcon,
  ImageIcon,
  LinkIcon,
  LockIcon,
  MoonIcon,
  CloudIcon,
  NoteIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
  SunIcon,
  TextIcon,
  TrashIcon,
} from "./Icons";
import type {
  NoteFilter,
  PlatformMeta,
  Preferences,
  QuickNote,
  SavedWebsite,
} from "../types";

type PrimaryMode = "clipboard" | "notes" | "websites";
type NoteExportFormat = "txt" | "md" | "json";

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
  notes: QuickNote[];
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
  setNotes: Dispatch<SetStateAction<QuickNote[]>>;
  setPreferences: Dispatch<SetStateAction<Preferences>>;
  setWebsites: Dispatch<SetStateAction<SavedWebsite[]>>;
  websites: SavedWebsite[];
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

function noteTimeStamp() {
  return new Date().toISOString();
}

function formatNoteRelativeLabel(value: string) {
  const timestamp = new Date(value).getTime();
  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));

  if (diffMinutes < 1) {
    return "Just now";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  }

  return formatTimestamp(value);
}

function downloadBlob(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function AppShell({
  clipboard,
  loadError,
  notes,
  panel,
  platformMeta,
  preferences,
  resolvedTheme,
  setNotes,
  setPreferences,
  setWebsites,
  websites,
}: AppShellProps) {
  const panelBodyStyle = {
    "--swift-list-width": panel.listWidth,
  } as CSSProperties;
  const lastHapticAtRef = useRef(0);
  const noteEditorBodyRef = useRef<HTMLTextAreaElement | null>(null);

  const [mode, setMode] = useState<PrimaryMode>("clipboard");
  const [noteFilter, setNoteFilter] = useState<NoteFilter>("all");
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(notes[0]?.id ?? null);
  const [notesQuery, setNotesQuery] = useState("");
  const [noteMenu, setNoteMenu] = useState<{ noteId: string; x: number; y: number } | null>(null);
  const [noteUnlockPassword, setNoteUnlockPassword] = useState("");
  const [unlockedNoteIds, setUnlockedNoteIds] = useState<string[]>([]);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editorTitle, setEditorTitle] = useState("");
  const [editorBody, setEditorBody] = useState("");
  const [exportFormat, setExportFormat] = useState<NoteExportFormat>("md");

  const [selectedWebsiteId, setSelectedWebsiteId] = useState<string | null>(websites[0]?.id ?? null);
  const [websiteDraft, setWebsiteDraft] = useState("");

  useEffect(() => {
    if (!notes.length) {
      setSelectedNoteId(null);
      return;
    }

    if (!selectedNoteId || !notes.some((note) => note.id === selectedNoteId)) {
      setSelectedNoteId(notes[0].id);
    }
  }, [notes, selectedNoteId]);

  useEffect(() => {
    if (!websites.length) {
      setSelectedWebsiteId(null);
      return;
    }

    if (!selectedWebsiteId || !websites.some((site) => site.id === selectedWebsiteId)) {
      setSelectedWebsiteId(websites[0].id);
    }
  }, [selectedWebsiteId, websites]);

  useEffect(() => {
    const dismissMenu = () => setNoteMenu(null);
    window.addEventListener("click", dismissMenu);
    return () => window.removeEventListener("click", dismissMenu);
  }, []);

  const triggerHaptic = () => {
    const now = Date.now();

    if (now - lastHapticAtRef.current < 220) {
      return;
    }

    lastHapticAtRef.current = now;
    void invoke("trigger_edge_haptic").catch(() => {
      console.warn("Memora edge haptic was unavailable.");
    });
  };

  const visibleNotes = useMemo(() => {
    const normalized = notesQuery.trim().toLowerCase();

    return notes
      .filter((note) => {
        if (noteFilter === "starred" && !note.starred) {
          return false;
        }
        if (noteFilter === "hidden" && !note.hidden) {
          return false;
        }
        if (noteFilter === "locked" && !note.locked) {
          return false;
        }
        if (noteFilter === "all" && note.hidden) {
          return false;
        }

        if (!normalized) {
          return true;
        }

        return `${note.title} ${note.body}`.toLowerCase().includes(normalized);
      })
      .sort((a, b) => {
        if (a.starred !== b.starred) {
          return a.starred ? -1 : 1;
        }

        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [noteFilter, notes, notesQuery]);

  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? visibleNotes[0] ?? null;
  const selectedWebsite = websites.find((site) => site.id === selectedWebsiteId) ?? null;
  const isEditingNote = editingNoteId !== null;
  const selectedNoteLocked =
    !!selectedNote?.locked &&
    !!selectedNote.passwordValue &&
    !unlockedNoteIds.includes(selectedNote.id);

  const favoriteWebsiteCount = useMemo(
    () => websites.filter((site) => site.favorite).length,
    [websites],
  );

  const visibleWebsites = useMemo(
    () =>
      [...websites].sort((a, b) => {
        if (a.favorite !== b.favorite) {
          return a.favorite ? -1 : 1;
        }

        return a.label.localeCompare(b.label);
      }),
    [websites],
  );

  const createQuickNote = () => {
    const createdAt = noteTimeStamp();
    const nextNote: QuickNote = {
      id: `note-${Date.now()}`,
      title: "Untitled note",
      body: "",
      hidden: false,
      locked: false,
      starred: false,
      updatedAt: createdAt,
      createdAt,
    };

    setNotes((current) => [...current, nextNote]);
    setSelectedNoteId(nextNote.id);
    setMode("notes");
    setEditingNoteId(nextNote.id);
    setEditorTitle(nextNote.title);
    setEditorBody(nextNote.body);
  };

  const openNoteEditor = (note: QuickNote) => {
    if (note.locked && note.passwordValue && !unlockedNoteIds.includes(note.id)) {
      setSelectedNoteId(note.id);
      return;
    }

    setEditingNoteId(note.id);
    setEditorTitle(note.title);
    setEditorBody(note.body);
    setNoteMenu(null);
  };

  const saveEditedNote = () => {
    if (!editingNoteId) {
      return;
    }

    const updatedAt = noteTimeStamp();
    setNotes((current) =>
      current.map((note) =>
        note.id === editingNoteId
          ? {
              ...note,
              title: editorTitle.trim() || "Untitled note",
              body: editorBody,
              updatedAt,
            }
          : note,
      ),
    );
    setEditingNoteId(null);
  };

  const toggleNoteStar = (noteId: string) => {
    const updatedAt = noteTimeStamp();
    setNotes((current) =>
      current.map((note) =>
        note.id === noteId
          ? {
              ...note,
              starred: !note.starred,
              updatedAt,
            }
          : note,
      ),
    );
  };

  const deleteNote = (noteId: string) => {
    setNotes((current) => current.filter((note) => note.id !== noteId));
    setUnlockedNoteIds((current) => current.filter((id) => id !== noteId));
    if (editingNoteId === noteId) {
      setEditingNoteId(null);
    }
    if (selectedNoteId === noteId) {
      setSelectedNoteId(null);
    }
    setNoteMenu(null);
  };

  const setNotePassword = (note: QuickNote) => {
    const passwordValue = window.prompt(
      note.passwordValue
        ? "Update note password. Leave blank to remove protection."
        : "Set a password for this note. Leave blank to cancel.",
      note.passwordValue ?? "",
    );

    if (passwordValue === null) {
      setNoteMenu(null);
      return;
    }

    const trimmedPassword = passwordValue.trim();
    const updatedAt = noteTimeStamp();

    if (!trimmedPassword) {
      setNotes((current) =>
        current.map((entry) =>
          entry.id === note.id
            ? {
                ...entry,
                locked: false,
                passwordHint: undefined,
                passwordValue: undefined,
                updatedAt,
              }
            : entry,
        ),
      );
      setUnlockedNoteIds((current) => [...new Set([...current, note.id])]);
      setNoteMenu(null);
      return;
    }

    const hint = window.prompt("Optional password hint", note.passwordHint ?? "");
    setNotes((current) =>
      current.map((entry) =>
        entry.id === note.id
          ? {
              ...entry,
              locked: true,
              passwordHint: hint?.trim() || undefined,
              passwordValue: trimmedPassword,
              updatedAt,
            }
          : entry,
      ),
    );
    setUnlockedNoteIds((current) => current.filter((id) => id !== note.id));
    setNoteMenu(null);
  };

  const exportNote = (note: QuickNote, format: NoteExportFormat) => {
    const base = (note.title || "memora-note").trim().replace(/[^\w-]+/g, "-").toLowerCase();

    if (format === "txt") {
      downloadBlob(`${base}.txt`, `${note.title}\n\n${note.body}`, "text/plain;charset=utf-8");
      return;
    }

    if (format === "md") {
      downloadBlob(`${base}.md`, `# ${note.title}\n\n${note.body}`, "text/markdown;charset=utf-8");
      return;
    }

    downloadBlob(
      `${base}.json`,
      JSON.stringify(note, null, 2),
      "application/json;charset=utf-8",
    );
  };

  const applyEditorFormat = (format: "bold" | "italic" | "bullet") => {
    const textarea = noteEditorBodyRef.current;
    if (!textarea) {
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selection = editorBody.slice(start, end) || "text";
    let nextSelection = selection;

    if (format === "bold") {
      nextSelection = `**${selection}**`;
    } else if (format === "italic") {
      nextSelection = `*${selection}*`;
    } else {
      nextSelection = `- ${selection}`;
    }

    const nextValue = `${editorBody.slice(0, start)}${nextSelection}${editorBody.slice(end)}`;
    setEditorBody(nextValue);

    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, start + nextSelection.length);
    });
  };

  const toggleWebsiteFavorite = (websiteId: string) => {
    setWebsites((current) => {
      const target = current.find((site) => site.id === websiteId);

      if (!target) {
        return current;
      }

      const nextFavorite = !target.favorite;
      const currentFavoriteCount = current.filter((site) => site.favorite).length;

      if (nextFavorite && currentFavoriteCount >= 3) {
        window.alert("You can only keep 3 favorite websites pinned at the top.");
        return current;
      }

      return current.map((site) =>
        site.id === websiteId
          ? {
              ...site,
              favorite: nextFavorite,
            }
          : site,
      );
    });
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
      description: "New saved destination ready to open inside Memora.",
      tone: "ocean",
      favorite: false,
    };

    setWebsites((current) => [nextSite, ...current]);
    setSelectedWebsiteId(nextSite.id);
    setWebsiteDraft("");
    setMode("websites");
  };

  const primarySearchValue = mode === "clipboard" ? clipboard.query : notesQuery;
  const primarySearchPlaceholder = mode === "clipboard" ? "Search clipboard" : "Search notes";

  const updatePrimarySearch = (value: string) => {
    if (mode === "clipboard") {
      clipboard.updateQuery(value);
      return;
    }

    setNotesQuery(value);
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
                <div className="panel__brand-row">
                  <span className="panel__brand-cloud" aria-hidden="true">
                    <CloudIcon />
                  </span>
                  <span className="panel__brand">Memora</span>
                </div>
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
                </div>
              </div>

              <div className="panel__nav-row">
                <div className="panel__primary-nav" role="tablist" aria-label="Memora sections">
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
                <button
                  className="panel__nav-settings icon-button"
                  type="button"
                  data-variant="settings"
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
                                <img className="item__thumbnail" src={item.imageDataUrl} alt="Clipboard preview" />
                                <div>
                                  <div>
                                    {item.width} x {item.height}
                                  </div>
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
                            Copy text, links, or images and Memora will keep the latest history in this edge panel.
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
                            Memora stays slim on the edge until you need a focused clipboard workspace.
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            ) : null}

            {mode === "notes" ? (
              <div className="panel__body panel__body--mode panel__body--notes">
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
                          ["starred", "Starred"],
                          ["locked", "Locked"],
                          ["hidden", "Hidden"],
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            className="segment__button"
                            type="button"
                            data-active={noteFilter === value}
                            onClick={() => setNoteFilter(value as NoteFilter)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="history">
                    {visibleNotes.length ? (
                      visibleNotes.map((note) => (
                        <button
                          key={note.id}
                          className="item item--note"
                          type="button"
                          data-selected={selectedNote?.id === note.id}
                          onClick={() => setSelectedNoteId(note.id)}
                          onDoubleClick={() => openNoteEditor(note)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setSelectedNoteId(note.id);
                            setNoteMenu({
                              noteId: note.id,
                              x: event.clientX,
                              y: event.clientY,
                            });
                          }}
                        >
                          <div className="item__row">
                            <div className="item__type">
                              <NoteIcon />
                              {note.title}
                            </div>
                            <div className="item__row-actions">
                              {note.starred ? <StarIcon filled /> : null}
                              <span className="item__badge">{formatNoteRelativeLabel(note.updatedAt)}</span>
                            </div>
                          </div>
                          <div className="note-flags">
                            {note.hidden ? <span className="mini-badge">Hidden</span> : null}
                            {note.locked ? <span className="mini-badge">Locked</span> : null}
                          </div>
                          <div className="item__preview">{summarizeText(note.body)}</div>
                        </button>
                      ))
                    ) : (
                      <div className="empty-state">
                        <div className="empty-state__card">
                          <div className="empty-state__title">No notes in this category</div>
                          <div className="empty-state__body">
                            Create a note, star one for quick access, or reveal hidden notes from the category row.
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </aside>

                <section className="detail-pane detail-pane--notes">
                  <div className="detail-pane__header">
                    <div>
                      <div className="detail-pane__title">{selectedNote?.title ?? "Notes"}</div>
                      <div className="list-pane__meta">
                        {selectedNote ? "Double-click or use the menu to edit" : "Create a note to get started"}
                      </div>
                    </div>

                    <div className="detail-pane__actions">
                      <button
                        className="chip-button"
                        type="button"
                        onClick={() => selectedNote && toggleNoteStar(selectedNote.id)}
                        disabled={!selectedNote}
                      >
                        <StarIcon filled={!!selectedNote?.starred} />
                      </button>
                      <button
                        className="chip-button"
                        type="button"
                        onClick={() => selectedNote && setNotePassword(selectedNote)}
                        disabled={!selectedNote}
                      >
                        <LockIcon />
                      </button>
                      <button
                        className="chip-button"
                        type="button"
                        onClick={() => selectedNote && exportNote(selectedNote, exportFormat)}
                        disabled={!selectedNote}
                      >
                        <DownloadIcon />
                      </button>
                    </div>
                  </div>

                  <div className="detail-pane__scroll">
                    {selectedNote ? (
                      selectedNoteLocked ? (
                        <div className="detail-card">
                          <div className="detail-card__meta">
                            <span>Protected note</span>
                            <span>{selectedNote.passwordHint ? `Hint: ${selectedNote.passwordHint}` : "Password required"}</span>
                          </div>
                          <div className="note-lock-card">
                            <input
                              className="note-lock-card__input"
                              type="password"
                              placeholder="Enter note password"
                              value={noteUnlockPassword}
                              onChange={(event) => setNoteUnlockPassword(event.currentTarget.value)}
                            />
                            <button
                              className="chip-button chip-button--accent"
                              type="button"
                              onClick={() => {
                                if (noteUnlockPassword === selectedNote.passwordValue) {
                                  setUnlockedNoteIds((current) => [...new Set([...current, selectedNote.id])]);
                                  setNoteUnlockPassword("");
                                }
                              }}
                            >
                              Unlock
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="detail-card">
                          <div className="detail-card__meta">
                            <span>{selectedNote.starred ? "Starred note" : "Quick note"}</span>
                            <span>{formatTimestamp(selectedNote.updatedAt)}</span>
                          </div>
                          <div className="detail-card__text">{selectedNote.body || "This note is empty."}</div>
                          <div className="note-detail-footer">
                            <select
                              className="note-export-select"
                              value={exportFormat}
                              onChange={(event) => setExportFormat(event.currentTarget.value as NoteExportFormat)}
                            >
                              <option value="md">Markdown</option>
                              <option value="txt">Text</option>
                              <option value="json">JSON</option>
                            </select>
                            <button className="chip-button" type="button" onClick={() => openNoteEditor(selectedNote)}>
                              Edit
                            </button>
                          </div>
                        </div>
                      )
                    ) : (
                      <div className="startup-state">
                        <div className="startup-state__card">
                          <div className="startup-state__title">Notes stay quick here</div>
                          <div className="startup-state__body">
                            Right-click notes for actions, double-click to edit, and star important ones to keep them at the top.
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <button className="notes-add-fab" type="button" onClick={createQuickNote}>
                    <span className="notes-add-fab__plus">+</span>
                    <span>New Note</span>
                  </button>
                </section>

                {isEditingNote ? (
                  <div className="notes-editor-shell">
                    <div className="notes-editor">
                      <div className="notes-editor__header">
                        <button className="chip-button" type="button" onClick={() => setEditingNoteId(null)}>
                          Close
                        </button>
                        <input
                          className="notes-editor__title"
                          value={editorTitle}
                          onChange={(event) => setEditorTitle(event.currentTarget.value)}
                          placeholder="Untitled note"
                        />
                        <div className="notes-editor__actions">
                          <button className="chip-button" type="button" onClick={() => applyEditorFormat("bold")}>
                            B
                          </button>
                          <button className="chip-button" type="button" onClick={() => applyEditorFormat("italic")}>
                            I
                          </button>
                          <button className="chip-button" type="button" onClick={() => applyEditorFormat("bullet")}>
                            List
                          </button>
                          <button
                            className="chip-button"
                            type="button"
                            onClick={() =>
                              exportNote(
                                {
                                  ...(notes.find((note) => note.id === editingNoteId) ?? {
                                    id: editingNoteId,
                                    hidden: false,
                                    locked: false,
                                    starred: false,
                                    updatedAt: noteTimeStamp(),
                                    createdAt: noteTimeStamp(),
                                  }),
                                  title: editorTitle.trim() || "Untitled note",
                                  body: editorBody,
                                },
                                exportFormat,
                              )
                            }
                          >
                            <DownloadIcon />
                          </button>
                          <button className="chip-button chip-button--accent" type="button" onClick={saveEditedNote}>
                            Save
                          </button>
                        </div>
                      </div>

                      <div className="notes-editor__formatting">
                        <span className="notes-editor__formatting-label">Formatting</span>
                        <div className="notes-editor__formatting-actions">
                          <button className="chip-button" type="button" onClick={() => applyEditorFormat("bold")}>
                            Bold
                          </button>
                          <button className="chip-button" type="button" onClick={() => applyEditorFormat("italic")}>
                            Italic
                          </button>
                          <button className="chip-button" type="button" onClick={() => applyEditorFormat("bullet")}>
                            Bullet
                          </button>
                        </div>
                      </div>

                      <textarea
                        ref={noteEditorBodyRef}
                        className="notes-editor__body"
                        value={editorBody}
                        onChange={(event) => setEditorBody(event.currentTarget.value)}
                        placeholder="Write your note here..."
                      />
                    </div>
                  </div>
                ) : null}

                {noteMenu ? (
                  <div className="note-menu" style={{ left: noteMenu.x, top: noteMenu.y }}>
                    <button
                      className="note-menu__option"
                      type="button"
                      onClick={() => {
                        const note = notes.find((entry) => entry.id === noteMenu.noteId);
                        if (note) {
                          openNoteEditor(note);
                        }
                      }}
                    >
                      Edit note
                    </button>
                    <button
                      className="note-menu__option"
                      type="button"
                      onClick={() => {
                        const note = notes.find((entry) => entry.id === noteMenu.noteId);
                        if (note) {
                          toggleNoteStar(note.id);
                        }
                        setNoteMenu(null);
                      }}
                    >
                      Star note
                    </button>
                    <button
                      className="note-menu__option"
                      type="button"
                      onClick={() => {
                        const note = notes.find((entry) => entry.id === noteMenu.noteId);
                        if (note) {
                          setNotePassword(note);
                        }
                      }}
                    >
                      Add password
                    </button>
                    <button
                      className="note-menu__option"
                      type="button"
                      onClick={() => {
                        const updatedAt = noteTimeStamp();
                        setNotes((current) =>
                          current.map((note) =>
                            note.id === noteMenu.noteId
                              ? {
                                  ...note,
                                  hidden: !note.hidden,
                                  updatedAt,
                                }
                              : note,
                          ),
                        );
                        setNoteMenu(null);
                      }}
                    >
                      Hide note
                    </button>
                    <button className="note-menu__option note-menu__option--danger" type="button" onClick={() => deleteNote(noteMenu.noteId)}>
                      Delete note
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {mode === "websites" ? (
              <div className="panel__body panel__body--mode panel__body--compact-mode">
                <aside className="list-pane">
                  <div className="list-pane__toolbar">
                    <div className="list-pane__toolbar-row">
                      <div className="list-pane__meta">Saved websites · up to 3 favorites</div>
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
                          <div className="item__row-actions">
                            {site.favorite ? <StarIcon filled /> : null}
                            <span className="item__badge">{getHostname(site.url)}</span>
                          </div>
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
                        <button
                          className="chip-button"
                          type="button"
                          onClick={() => toggleWebsiteFavorite(selectedWebsite.id)}
                          disabled={!selectedWebsite.favorite && favoriteWebsiteCount >= 3}
                          title={!selectedWebsite.favorite && favoriteWebsiteCount >= 3 ? "Maximum 3 favorites" : "Favorite website"}
                        >
                          <StarIcon filled={selectedWebsite.favorite} />
                        </button>
                      ) : null}
                      {selectedWebsite ? (
                        <a className="chip-button chip-button--link" href={selectedWebsite.url} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      ) : null}
                    </div>
                  </div>

                  <div className="detail-pane__scroll">
                    <div className="website-draft website-draft--browser">
                      <input
                        value={websiteDraft}
                        onChange={(event) => setWebsiteDraft(event.currentTarget.value)}
                        placeholder="Paste a website URL"
                        spellCheck={false}
                      />
                      <button className="chip-button chip-button--accent" type="button" onClick={addWebsite}>
                        <PlusIcon />
                        Add URL
                      </button>
                    </div>
                    {selectedWebsite ? (
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
                    ) : (
                      <div className="startup-state">
                        <div className="startup-state__card">
                          <div className="startup-state__title">Open a site here</div>
                          <div className="startup-state__body">
                            Add a URL above, keep it saved in the left column, and browse it inside this panel.
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
