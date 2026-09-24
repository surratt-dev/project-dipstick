import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// useCopyToClipboard — join-link-display-copy design.md Decision D1/D2/D4.
//
// The app's first clipboard-write pattern. Feature-detects
// navigator.clipboard.writeText at call time (never document.execCommand
// ('copy'), which can report success without the application being able to
// verify it -- design.md D2). A rejected write is treated identically to
// the API being unavailable: one "unavailable" status, never a separate
// error state, so the UI cannot accidentally show a false-positive
// confirmation on a copy that didn't verifiably happen.
//
// Adapts MemberManagement.tsx's inline auto-clearing banner convention but
// fixes two bugs that pattern has today (design.md D4, design-review-
// engineer.md Finding 2): the pending timer is held in a ref and cleared
// before starting a new one (stacking guard, Finding 2b), and cleared again
// on unmount so no setState runs after the consumer unmounts (Finding 2a).
// ---------------------------------------------------------------------------

export type CopyStatus = "idle" | "copied" | "unavailable";

const CONFIRMATION_CLEAR_MS = 8000;

export interface UseCopyToClipboardResult {
  copy(text: string): Promise<void>;
  status: CopyStatus;
}

export function useCopyToClipboard(): UseCopyToClipboardResult {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current !== null) {
        clearTimeout(clearTimerRef.current);
      }
    };
  }, []);

  const copy = useCallback(async (text: string) => {
    if (clearTimerRef.current !== null) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }

    if (typeof navigator.clipboard?.writeText !== "function") {
      setStatus("unavailable");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
      clearTimerRef.current = setTimeout(() => {
        clearTimerRef.current = null;
        setStatus("idle");
      }, CONFIRMATION_CLEAR_MS);
    } catch {
      setStatus("unavailable");
    }
  }, []);

  return { copy, status };
}
