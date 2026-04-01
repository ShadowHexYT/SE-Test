import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ClipboardFilter, ClipboardItem, ClipboardSnapshot } from "../types";

interface UseClipboardHistoryOptions {
  ready: boolean;
  initialHistory: ClipboardItem[];
  maxHistory: number;
}

function buildClipboardItem(snapshot: ClipboardSnapshot): ClipboardItem {
  return {
    id: `${snapshot.signature}:${snapshot.capturedAt}`,
    signature: snapshot.signature,
    type: snapshot.type,
    text: snapshot.text,
    imageDataUrl: snapshot.imageDataUrl,
    width: snapshot.width,
    height: snapshot.height,
    createdAt: snapshot.capturedAt,
  };
}

export function useClipboardHistory({
  ready,
  initialHistory,
  maxHistory,
}: UseClipboardHistoryOptions) {
  const [history, setHistory] = useState<ClipboardItem[]>(initialHistory);
  const [selectedId, setSelectedId] = useState<string | null>(initialHistory[0]?.id ?? null);
  const [filter, setFilter] = useState<ClipboardFilter>("all");
  const [query, setQuery] = useState("");
  const [isPolling, setIsPolling] = useState(false);
  const [, startTransition] = useTransition();
  const deferredQuery = useDeferredValue(query);
  const latestSignatureRef = useRef<string | null>(initialHistory[0]?.signature ?? null);

  useEffect(() => {
    setHistory(initialHistory);
    setSelectedId(initialHistory[0]?.id ?? null);
    latestSignatureRef.current = initialHistory[0]?.signature ?? null;
  }, [initialHistory]);

  useEffect(() => {
    if (!ready) {
      return;
    }

    let active = true;

    const pollClipboard = async () => {
      try {
        const snapshot = await invoke<ClipboardSnapshot | null>("read_clipboard_snapshot");

        if (!active || !snapshot || snapshot.signature === latestSignatureRef.current) {
          return;
        }

        latestSignatureRef.current = snapshot.signature;

        setHistory((previous) => {
          const nextItem = buildClipboardItem(snapshot);
          const deduped = previous.filter((item) => item.signature !== snapshot.signature);
          return [nextItem, ...deduped].slice(0, maxHistory);
        });
        setSelectedId((current) => current ?? `${snapshot.signature}:${snapshot.capturedAt}`);
      } catch (error) {
        console.error("Clipboard polling failed.", error);
      }
    };

    setIsPolling(true);
    void pollClipboard();
    const interval = window.setInterval(() => {
      void pollClipboard();
    }, 1100);

    return () => {
      active = false;
      setIsPolling(false);
      window.clearInterval(interval);
    };
  }, [ready, maxHistory]);

  const visibleHistory = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();

    return history.filter((item) => {
      if (filter !== "all" && item.type !== filter) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      if (item.type === "text") {
        return item.text?.toLowerCase().includes(normalizedQuery) ?? false;
      }

      return `${item.width ?? ""} ${item.height ?? ""} image`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [deferredQuery, filter, history]);

  useEffect(() => {
    if (!visibleHistory.length) {
      setSelectedId(null);
      return;
    }

    if (!selectedId || !visibleHistory.some((item) => item.id === selectedId)) {
      setSelectedId(visibleHistory[0].id);
    }
  }, [selectedId, visibleHistory]);

  const selectedItem = visibleHistory.find((item) => item.id === selectedId) ?? null;

  const updateQuery = (value: string) => {
    startTransition(() => {
      setQuery(value);
    });
  };

  const recopyItem = async (item: ClipboardItem) => {
    if (item.type === "text" && item.text) {
      await invoke("copy_text_to_clipboard", { text: item.text });
      latestSignatureRef.current = item.signature;
      return;
    }

    if (item.type === "image" && item.imageDataUrl) {
      await invoke("copy_image_to_clipboard", {
        imageDataUrl: item.imageDataUrl,
      });
      latestSignatureRef.current = item.signature;
    }
  };

  const deleteItem = (itemId: string) => {
    setHistory((previous) => previous.filter((item) => item.id !== itemId));
  };

  const clearHistory = () => {
    latestSignatureRef.current = null;
    setHistory([]);
    setSelectedId(null);
  };

  return {
    clearHistory,
    deleteItem,
    filter,
    history,
    isPolling,
    query,
    recopyItem,
    selectedId,
    selectedItem,
    setFilter,
    setSelectedId,
    updateQuery,
    visibleHistory,
  };
}
