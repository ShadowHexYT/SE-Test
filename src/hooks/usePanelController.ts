import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import type { EdgeSide, PanelPhase, Platform, Preferences } from "../types";

const PANEL_ANIMATION_MS = 220;
const CLOSE_DELAY_MS = 260;
const MIN_PANEL_WIDTH = 680;
const MAX_PANEL_WIDTH = 960;
const POINTER_POLL_MS = 84;
const HANDLE_ZONE_HEIGHT = 220;
const TRIGGER_BUFFER = 28;
const PANEL_BUFFER = 26;

interface UsePanelControllerOptions {
  ready: boolean;
  platform: Platform;
  preferences: Preferences;
  setPreferences: React.Dispatch<React.SetStateAction<Preferences>>;
}

interface ShellGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  handleWidth: number;
  edgeSide: EdgeSide;
  maxOffsetY: number;
}

type PointerZone =
  | "outside"
  | "trigger"
  | "buffer"
  | "panel"
  | "resize"
  | "reposition";

async function readShellGeometry() {
  return invoke<ShellGeometry>("get_shell_geometry");
}

function isWithinRect(
  cursorX: number,
  cursorY: number,
  rect: { left: number; right: number; top: number; bottom: number },
) {
  return (
    cursorX >= rect.left &&
    cursorX <= rect.right &&
    cursorY >= rect.top &&
    cursorY <= rect.bottom
  );
}

function classifyPointerZone(
  cursorX: number,
  cursorY: number,
  geometry: ShellGeometry,
): PointerZone {
  const handleOnRight = geometry.edgeSide === "left";
  const handleTop = geometry.y + (geometry.height - HANDLE_ZONE_HEIGHT) / 2;
  const handleBottom = handleTop + HANDLE_ZONE_HEIGHT;
  const triggerRect = {
    left: handleOnRight
      ? geometry.x + geometry.width - geometry.handleWidth - TRIGGER_BUFFER - 8
      : geometry.x,
    right: handleOnRight
      ? geometry.x + geometry.width
      : geometry.x + geometry.handleWidth + TRIGGER_BUFFER + 8,
    top: handleTop - TRIGGER_BUFFER,
    bottom: handleBottom + TRIGGER_BUFFER,
  };
  const panelRect = {
    left: handleOnRight ? geometry.x : geometry.x + geometry.handleWidth,
    right: handleOnRight ? geometry.x + geometry.width - geometry.handleWidth : geometry.x + geometry.width,
    top: geometry.y,
    bottom: geometry.y + geometry.height,
  };
  const panelBufferRect = {
    left: geometry.x,
    right: panelRect.right + PANEL_BUFFER,
    top: panelRect.top - PANEL_BUFFER,
    bottom: panelRect.bottom + PANEL_BUFFER,
  };
  const resizeRect = {
    left: handleOnRight ? panelRect.right - 16 : panelRect.left - 16,
    right: handleOnRight ? panelRect.right + 16 : panelRect.left + 16,
    top: panelRect.top + 24,
    bottom: panelRect.bottom - 24,
  };
  const repositionRect = {
    left: panelRect.left + 16,
    right: panelRect.right - 16,
    top: panelRect.top,
    bottom: panelRect.top + 72,
  };

  if (isWithinRect(cursorX, cursorY, resizeRect)) {
    return "resize";
  }

  if (isWithinRect(cursorX, cursorY, repositionRect)) {
    return "reposition";
  }

  if (isWithinRect(cursorX, cursorY, triggerRect)) {
    return "trigger";
  }

  if (isWithinRect(cursorX, cursorY, panelRect)) {
    return "panel";
  }

  if (isWithinRect(cursorX, cursorY, panelBufferRect)) {
    return "buffer";
  }

  return "outside";
}

export function usePanelController({
  ready,
  platform,
  preferences,
  setPreferences,
}: UsePanelControllerOptions) {
  const [phase, setPhase] = useState<PanelPhase>("collapsed");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeDelayRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const syncFrameRef = useRef<number | null>(null);
  const phaseRef = useRef<PanelPhase>("collapsed");
  const revealRef = useRef(0);
  const panelWidthRef = useRef(preferences.panelWidth);
  const panelOffsetYRef = useRef(preferences.panelOffsetY);
  const dismissModeRef = useRef(preferences.dismissMode);
  const edgeSideRef = useRef<EdgeSide>(preferences.edgeSide);
  const pinnedRef = useRef(preferences.pinned);
  const pendingSyncRef = useRef<{
    panelWidth: number;
    reveal: number;
    panelOffsetY: number;
    edgeSide: EdgeSide;
  } | null>(null);
  const lastSyncedRef = useRef<{
    panelWidth: number;
    reveal: number;
    panelOffsetY: number;
    edgeSide: EdgeSide;
  } | null>(null);

  const hasMeaningfulShellDelta = (
    previous: typeof pendingSyncRef.current,
    next: NonNullable<typeof pendingSyncRef.current>,
  ) => {
    if (!previous) {
      return true;
    }

    return (
      Math.abs(previous.panelWidth - next.panelWidth) > 0.5 ||
      Math.abs(previous.reveal - next.reveal) > 0.005 ||
      Math.abs(previous.panelOffsetY - next.panelOffsetY) > 0.5 ||
      previous.edgeSide !== next.edgeSide
    );
  };

  const flushShellSync = () => {
    syncFrameRef.current = null;

    const pending = pendingSyncRef.current;
    if (!pending || !hasMeaningfulShellDelta(lastSyncedRef.current, pending)) {
      return;
    }

    lastSyncedRef.current = pending;
    void syncShell(pending.panelWidth, pending.reveal, pending.panelOffsetY);
  };

  const scheduleShellSync = (panelWidth: number, reveal: number, panelOffsetY: number) => {
    pendingSyncRef.current = {
      panelWidth,
      reveal,
      panelOffsetY,
      edgeSide: edgeSideRef.current,
    };

    if (syncFrameRef.current !== null) {
      return;
    }

    syncFrameRef.current = window.setTimeout(flushShellSync, 16);
  };

  const settingsOpenRef = useRef(false);
  const activeZoneRef = useRef<PointerZone>("outside");
  const splitContainerRef = useRef<HTMLDivElement | null>(null);

  const syncShell = async (panelWidth: number, reveal: number, panelOffsetY: number) => {
    await invoke("sync_shell_state", {
      panelWidth,
      reveal,
      panelOffsetY,
      edgeSide: edgeSideRef.current,
    });
  };

  const animateShell = async (
    panelWidth: number,
    targetReveal: number,
    panelOffsetY: number,
    durationMs = PANEL_ANIMATION_MS,
  ) => {
    await invoke("animate_shell_state", {
      panelWidth,
      targetReveal,
      panelOffsetY,
      edgeSide: edgeSideRef.current,
      durationMs,
    });
  };

  const clearCloseDelay = () => {
    if (closeDelayRef.current) {
      window.clearTimeout(closeDelayRef.current);
      closeDelayRef.current = null;
    }
  };

  const clearSettleTimer = () => {
    if (settleTimerRef.current) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  };

  const clearSyncFrame = () => {
    if (syncFrameRef.current !== null) {
      window.clearTimeout(syncFrameRef.current);
      syncFrameRef.current = null;
    }
  };

  const setPhaseState = (nextPhase: PanelPhase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  };

  const isStrictlyProtectedState = () =>
    phaseRef.current === "resizing" ||
    phaseRef.current === "repositioning" ||
    settingsOpenRef.current ||
    pinnedRef.current;

  const runAnimation = (nextPhase: PanelPhase, targetReveal: number) => {
    clearSettleTimer();
    setPhaseState(nextPhase);
    revealRef.current = targetReveal;
    void animateShell(panelWidthRef.current, targetReveal, panelOffsetYRef.current, PANEL_ANIMATION_MS);
    settleTimerRef.current = window.setTimeout(() => {
      setPhaseState(targetReveal === 0 ? "collapsed" : "expanded");
      settleTimerRef.current = null;
    }, PANEL_ANIMATION_MS + 30);
  };

  const openPanel = () => {
    clearCloseDelay();

    if (phaseRef.current === "expanded" || phaseRef.current === "opening") {
      return;
    }

    void getCurrentWindow().setFocus().catch(() => {
      console.warn("Memora could not focus its drawer window.");
    });
    runAnimation("opening", 1);
  };

  const collapsePanel = () => {
    if (
      phaseRef.current === "collapsed" ||
      phaseRef.current === "closing" ||
      isStrictlyProtectedState()
    ) {
      return;
    }

    runAnimation("closing", 0);
  };

  const requestClose = () => {
    if (pinnedRef.current || isStrictlyProtectedState()) {
      return;
    }

    if (dismissModeRef.current === "hover-off") {
      const zone = activeZoneRef.current;
      if (zone === "trigger" || zone === "panel" || zone === "buffer") {
        return;
      }
    }

    collapsePanel();
  };

  const scheduleClose = () => {
    if (
      dismissModeRef.current !== "hover-off" ||
      pinnedRef.current ||
      isStrictlyProtectedState()
    ) {
      return;
    }

    clearCloseDelay();
    closeDelayRef.current = window.setTimeout(() => {
      requestClose();
    }, CLOSE_DELAY_MS);
  };

  useEffect(() => {
    panelWidthRef.current = preferences.panelWidth;
    panelOffsetYRef.current = preferences.panelOffsetY;
    dismissModeRef.current = preferences.dismissMode;
    edgeSideRef.current = preferences.edgeSide;
    pinnedRef.current = preferences.pinned;
  }, [
    preferences.dismissMode,
    preferences.edgeSide,
    preferences.panelOffsetY,
    preferences.panelWidth,
    preferences.pinned,
  ]);

  useEffect(() => {
    settingsOpenRef.current = settingsOpen;
  }, [settingsOpen]);

  useEffect(() => {
    if (!ready) {
      return;
    }

    setPhaseState("collapsed");
    revealRef.current = 0;
    scheduleShellSync(panelWidthRef.current, 0, panelOffsetYRef.current);

    const windowHandle = getCurrentWindow();
    let unlistenFocus: (() => void) | undefined;

    void windowHandle
      .onFocusChanged(({ payload: focused }) => {
        if (!focused && dismissModeRef.current === "click-away" && !isStrictlyProtectedState()) {
          requestClose();
        }
      })
      .then((unlisten) => {
        unlistenFocus = unlisten;
      });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pinnedRef.current) {
        clearCloseDelay();
        collapsePanel();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    const interval = window.setInterval(() => {
      void (async () => {
        if (settingsOpenRef.current && revealRef.current > 0.95) {
          activeZoneRef.current = "panel";
          clearCloseDelay();
          return;
        }

        const [cursor, geometry] = await Promise.all([cursorPosition(), readShellGeometry()]);
        const zone = classifyPointerZone(cursor.x, cursor.y, geometry);
        activeZoneRef.current = zone;

        if (zone === "trigger" || zone === "buffer" || zone === "panel") {
          clearCloseDelay();
        }

        if (zone === "trigger") {
          openPanel();
          return;
        }

        if (zone === "panel" || zone === "buffer") {
          if (phaseRef.current === "expanded") {
            setPhaseState("interacting");
          }
          if (phaseRef.current === "closing") {
            openPanel();
          }
          return;
        }

        if (phaseRef.current === "interacting") {
          setPhaseState("expanded");
        }

        if (zone === "outside") {
          scheduleClose();
        }
      })().catch((error) => {
        console.error("Memora shell poll failed.", error);
      });
    }, POINTER_POLL_MS);

    return () => {
      clearCloseDelay();
      clearSettleTimer();
      clearSyncFrame();
      window.clearInterval(interval);
      unlistenFocus?.();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [platform, ready]);

  useEffect(() => {
    if (!ready || platform !== "macos") {
      return;
    }

    let unlisten: (() => void) | undefined;

    void listen("memora://edge-swipe-open", () => {
      clearCloseDelay();
      openPanel();
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      unlisten?.();
    };
  }, [platform, ready]);

  useEffect(() => {
    if (!ready) {
      return;
    }

    scheduleShellSync(panelWidthRef.current, revealRef.current, panelOffsetYRef.current);
  }, [preferences.edgeSide, preferences.panelOffsetY, preferences.panelWidth, ready]);

  const beginPanelResize = async (metaKey: boolean) => {
    if (!metaKey) {
      return;
    }

    clearCloseDelay();
    setPhaseState("resizing");

    const startWidth = panelWidthRef.current;
    const startPointerX = window.screenX + window.innerWidth;

    const onMove = (event: PointerEvent) => {
      const delta = startPointerX - event.screenX;
      const nextWidth = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, startWidth + delta));

      panelWidthRef.current = nextWidth;
      setPreferences((current) => ({
        ...current,
        panelWidth: nextWidth,
      }));
      scheduleShellSync(nextWidth, revealRef.current, panelOffsetYRef.current);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setPhaseState("expanded");
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  const beginVerticalReposition = async (metaKey: boolean, startScreenY: number) => {
    if (!metaKey) {
      return;
    }

    clearCloseDelay();
    setPhaseState("repositioning");
    const startOffsetY = panelOffsetYRef.current;
    const geometry = await readShellGeometry();
    const availableTravel = Math.max(0, geometry.maxOffsetY);

    const onMove = (event: PointerEvent) => {
      const delta = event.screenY - startScreenY;
      const nextOffset = Math.min(
        availableTravel,
        Math.max(-availableTravel, startOffsetY + delta),
      );

      panelOffsetYRef.current = nextOffset;
      setPreferences((current) => ({
        ...current,
        panelOffsetY: nextOffset,
      }));
      scheduleShellSync(panelWidthRef.current, revealRef.current, nextOffset);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setPhaseState("expanded");
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  const beginSplitResize = (startClientX: number) => {
    const container = splitContainerRef.current;

    if (!container) {
      return;
    }

    const bounds = container.getBoundingClientRect();

    const onMove = (event: PointerEvent) => {
      const ratio = (event.clientX - bounds.left) / bounds.width;
      const clampedRatio = Math.min(0.72, Math.max(0.42, ratio));

      setPreferences((current) => ({
        ...current,
        splitRatio: clampedRatio,
      }));
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    setPreferences((current) => ({
      ...current,
      splitRatio: Math.min(0.72, Math.max(0.42, (startClientX - bounds.left) / bounds.width)),
    }));

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  const listWidth = useMemo(
    () => `${Math.round(preferences.splitRatio * 100)}%`,
    [preferences.splitRatio],
  );

  return {
    beginPanelResize,
    beginSplitResize,
    beginVerticalReposition,
    isOpen: phase !== "collapsed",
    listWidth,
    openPanel,
    phase,
    requestClose,
    scheduleClose,
    setIsHandleHovered: () => {
      clearCloseDelay();
    },
    setIsPanelHovered: () => {
      clearCloseDelay();
      if (phaseRef.current === "expanded") {
        setPhaseState("interacting");
      }
    },
    setPreferences,
    setSettingsOpen: (value: boolean) => {
      settingsOpenRef.current = value;
      setSettingsOpen(value);
      if (!value) {
        scheduleClose();
      } else {
        clearCloseDelay();
      }
    },
    settingsOpen,
    splitContainerRef,
    togglePinned: () => {
      setPreferences((current) => ({
        ...current,
        pinned: !current.pinned,
      }));
      if (pinnedRef.current) {
        scheduleClose();
      }
    },
  };
}
