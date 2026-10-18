import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import {
  BULK_RESTORE_SINGLE_SENTENCE,
  BULK_RESTORE_TITLE,
  BULK_RESTORE_UNCHANGED_SENTENCE,
  bulkCountLine,
  bulkPlacementSentence,
  skippedLine,
} from "../pages/bulkRestoreCopy.js";

// ---------------------------------------------------------------------------
// RestoreDefaultsDialog -- bulk-restore-default-topics (#218) task 5.2.
// The confirmation for "Restore default topics". The preview comes from the
// shared planDefaultRestore, run by the page on the loaded lists; the dialog
// only renders it. Literal copy lives in pages/bulkRestoreCopy.ts.
//
// Focus: the dialog takes focus on open and traps Tab inside itself; the page
// returns focus to the control on close. The topic list is a keyboard-
// focusable region with a maximum height, names wrapped (never truncated).
// ---------------------------------------------------------------------------

export const BULK_RESTORE_TRIGGER_ID = "bulk-restore-defaults-trigger";

interface RestoreDefaultsDialogProps {
  restorable: ReadonlyArray<{ id: string; name: string }>;
  skipped: ReadonlyArray<{ id: string; name: string; reason: string }>;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function RestoreDefaultsDialog({ restorable, skipped, submitting, onConfirm, onCancel }: RestoreDefaultsDialogProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !submitting) {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab" || !rootRef.current) return;
    const items = Array.from(rootRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === rootRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-restore-dialog-title"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-testid="bulk-restore-dialog"
      style={{
        marginTop: "1rem",
        padding: "1rem",
        backgroundColor: "#e8f5e9",
        border: "1px solid #a5d6a7",
        borderRadius: "4px",
      }}
    >
      <h3 id="bulk-restore-dialog-title" style={{ marginTop: 0, fontSize: "1rem" }}>
        {BULK_RESTORE_TITLE}
      </h3>
      <p data-testid="bulk-restore-count">{bulkCountLine(restorable.length)}</p>
      <ul
        tabIndex={0}
        aria-label="Topics to be restored"
        data-testid="bulk-restore-list"
        style={{ maxHeight: "12rem", overflowY: "auto", margin: "0 0 0.75rem", paddingLeft: "1.25rem" }}
      >
        {restorable.map((topic) => (
          <li key={topic.id} style={{ overflowWrap: "anywhere" }}>
            {topic.name}
          </li>
        ))}
      </ul>
      <p data-testid="bulk-restore-placement">{bulkPlacementSentence(restorable.length)}</p>
      <p>{BULK_RESTORE_UNCHANGED_SENTENCE}</p>
      {skipped.length > 0 && (
        <div data-testid="bulk-restore-skipped">
          <p style={{ marginBottom: "0.25rem" }}>Not restored</p>
          <ul style={{ marginTop: 0, paddingLeft: "1.25rem" }}>
            {skipped.map((topic) => (
              <li key={topic.id} style={{ overflowWrap: "anywhere" }}>
                {skippedLine(topic.name, topic.reason)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p data-testid="bulk-restore-single-sentence">{BULK_RESTORE_SINGLE_SENTENCE}</p>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting}
          aria-busy={submitting}
          data-testid="bulk-restore-confirm"
        >
          {submitting ? "Restoring…" : "Restore"}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting} data-testid="bulk-restore-cancel">
          Cancel
        </button>
      </div>
    </div>
  );
}
