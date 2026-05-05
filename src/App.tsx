import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppShell } from "./components/AppShell";
import { useClipboardHistory } from "./hooks/useClipboardHistory";
import { usePanelController } from "./hooks/usePanelController";
import { getPlatformMeta } from "./lib/platform";
import {
  DEFAULT_PREFERENCES,
  type AppBootstrap,
  type ClipboardItem,
  type Preferences,
  type QuickNote,
  type SavedWebsite,
  type ThemeMode,
} from "./types";
import "./App.css";

const EMPTY_HISTORY: ClipboardItem[] = [];

function App() {
  const [ready, setReady] = useState(false);
  const [platform, setPlatform] = useState<AppBootstrap["platform"]>("macos");
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [initialHistory, setInitialHistory] = useState<ClipboardItem[]>(EMPTY_HISTORY);
  const [notes, setNotes] = useState<QuickNote[]>([]);
  const [websites, setWebsites] = useState<SavedWebsite[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [systemTheme, setSystemTheme] = useState<Exclude<ThemeMode, "system">>("light");

  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      try {
        const payload = await invoke<AppBootstrap>("load_app_state");

        if (!isMounted) {
          return;
        }

        setPlatform(payload.platform);
        setPreferences({
          ...DEFAULT_PREFERENCES,
          ...payload.preferences,
        });
        setInitialHistory(payload.history);
        setNotes(payload.notes);
        setWebsites(payload.websites);
        setReady(true);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setLoadError("Glint could not load its saved state.");
        setReady(true);
        console.error(error);
      }
    }

    void bootstrap();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = (matches: boolean) => {
      setSystemTheme(matches ? "dark" : "light");
    };

    applyTheme(mediaQuery.matches);
    const onChange = (event: MediaQueryListEvent) => {
      applyTheme(event.matches);
    };

    mediaQuery.addEventListener("change", onChange);

    return () => {
      mediaQuery.removeEventListener("change", onChange);
    };
  }, []);

  const clipboard = useClipboardHistory({
    ready,
    initialHistory,
    maxHistory: preferences.maxHistory,
  });

  const panel = usePanelController({
    ready,
    platform,
    preferences,
    setPreferences,
  });

  useEffect(() => {
    if (!ready) {
      return;
    }

    void invoke("save_app_state", {
      payload: {
        preferences,
        history: clipboard.history,
        notes,
        websites,
      },
    }).catch((error) => {
      console.error("Failed to persist Glint state.", error);
    });
  }, [ready, preferences, clipboard.history, notes, websites]);

  const platformMeta = getPlatformMeta(platform);
  const resolvedTheme = preferences.themeMode === "system" ? systemTheme : preferences.themeMode;

  return (
    <AppShell
      clipboard={clipboard}
      loadError={loadError}
      panel={panel}
      platformMeta={platformMeta}
      preferences={preferences}
      resolvedTheme={resolvedTheme}
      notes={notes}
      setPreferences={setPreferences}
      setNotes={setNotes}
      setWebsites={setWebsites}
      websites={websites}
    />
  );
}

export default App;
