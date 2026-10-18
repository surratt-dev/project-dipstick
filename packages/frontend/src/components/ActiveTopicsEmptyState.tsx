import type { ReactNode } from "react";
import type { ActiveEmptyStateVariant } from "../pages/addCustomTopic.js";
import { BULK_RESTORE_ASSIGN_COPY, BULK_RESTORE_TITLE } from "../pages/bulkRestoreCopy.js";
import { BULK_RESTORE_TRIGGER_ID } from "./RestoreDefaultsDialog.js";

// ---------------------------------------------------------------------------
// ActiveTopicsEmptyState — topic-add-form-and-empty-state, design.md
// Decisions 7 and 10; topic-003-admin-authorization design.md D4;
// zero-topic-team-recovery (#200) design.md D7. A small, honest state for an
// empty active list. The message and the actions are driven by
// activeEmptyStateVariant(locked, archivedCount, canAssignDefaults):
//
//   locked                  -> ask an application administrator, no actions
//   locked_assign           -> "Assign default topics" (the admin variant),
//                              no sentence telling the viewer to ask an admin
//   unlocked_with_archived  -> Show archived topics (n)
//   unlocked_restorable     -> "Restore default topics" is primary (first in
//                              DOM, listed first), "Assign default topics"
//                              secondary for an admin, with copy about fresh
//                              copies (bulk-restore-default-topics #218)
//   unlocked_none_archived  -> no archived action
//
// The add action is gated by the required `addAllowed` prop, not by the
// variant: "Add custom topic" renders only when addAllowed is true and the
// variant is not locked. The Assign button is gated by the variant AND the
// required `canAssign` prop (the page passes `canAssignDefaults === true`),
// so a missing flag fails closed twice over.
//
// Presentational only: the in-flight state, the outcome messages and the
// focus move live in TopicManagementPage, because this component unmounts on
// the refetch that follows a successful assignment and would lose the
// success line. `canAssign`, `assigning`, `assignBlockedReason` and
// `onAssign` are REQUIRED so a forgotten call site is a type error.
//
// The locked copy names "an application administrator", the one sanctioned
// loosening of the "do not name an application role" rule (#200 D7); no
// other variant names a role, a support channel or a control that does not
// exist. No illustration: the state is rare and should be small.
// ---------------------------------------------------------------------------

export const EMPTY_STATE_ADD_BUTTON_ID = "empty-state-add-topic";
export const EMPTY_STATE_ASSIGN_BUTTON_ID = "empty-state-assign-defaults";

export const LOCKED_ASK_ADMIN_COPY =
  "This team has no active topics, so its sessions can't run. Ask an application administrator to assign the default topics, then refresh this page.";
export const LOCKED_ASSIGN_COPY =
  "This team has no active topics, so its sessions can't run. Assign the default topics to restore the standard set.";

interface ActiveTopicsEmptyStateProps {
  variant: ActiveEmptyStateVariant;
  // Whether the caller may add a topic here (the page's addAllowed). Required,
  // so a forgotten call site is a type error rather than a visible button.
  addAllowed: boolean;
  archivedCount: number;
  onShowArchived: () => void;
  onAddTopic: () => void;
  // #200: show the "Assign default topics" button (only meaningful for the
  // locked_assign variant; the page passes canAssignDefaults === true).
  canAssign: boolean;
  // A request is in flight: the button is disabled and says so.
  assigning: boolean;
  // Why Assign is unavailable right now (the same busy states that block
  // Add), or null.
  assignBlockedReason: string | null;
  onAssign: () => void;
  // The open add form, which takes the place of the actions below the
  // message (spec: the message stays shown above it).
  form?: ReactNode;
  // #218: the bulk "Restore default topics" action (unlocked_restorable only).
  onBulkRestore?: () => void;
  // Why bulk restore is disabled right now, or null when it is enabled.
  bulkRestoreDisabledReason?: string | null;
}

export function ActiveTopicsEmptyState({
  variant,
  addAllowed,
  archivedCount,
  onShowArchived,
  onAddTopic,
  canAssign,
  assigning,
  assignBlockedReason,
  onAssign,
  form,
  onBulkRestore,
  bulkRestoreDisabledReason = null,
}: ActiveTopicsEmptyStateProps) {
  const message =
    variant === "locked"
      ? LOCKED_ASK_ADMIN_COPY
      : variant === "locked_assign"
        ? LOCKED_ASSIGN_COPY
        : "This team has no active topics.";
  const lockedVariant = variant === "locked" || variant === "locked_assign";
  const bulkRestoreAction = variant === "unlocked_restorable" && onBulkRestore !== undefined;
  const assignAction = canAssign && (variant === "locked_assign" || variant === "unlocked_restorable");
  const assignDisabled = assigning || assignBlockedReason !== null;
  const showArchivedAction = variant === "unlocked_with_archived" || variant === "unlocked_restorable";
  const addAction = addAllowed && !lockedVariant;

  return (
    <div data-testid="active-topics-empty">
      <p data-testid="active-topics-empty-message">{message}</p>
      {form ??
        ((showArchivedAction || addAction || assignAction || bulkRestoreAction) && (
          <div data-testid="active-topics-empty-actions" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {bulkRestoreAction && (
              <>
                <button
                  type="button"
                  id={BULK_RESTORE_TRIGGER_ID}
                  className="primary"
                  onClick={onBulkRestore}
                  disabled={bulkRestoreDisabledReason !== null}
                  aria-describedby={bulkRestoreDisabledReason !== null ? "empty-state-bulk-restore-reason" : undefined}
                  data-testid="empty-state-bulk-restore"
                  style={{ fontWeight: 600 }}
                >
                  {BULK_RESTORE_TITLE}
                </button>
                {bulkRestoreDisabledReason !== null && (
                  <span id="empty-state-bulk-restore-reason" data-testid="empty-state-bulk-restore-reason" style={{ color: "#616161" }}>
                    {bulkRestoreDisabledReason}
                  </span>
                )}
              </>
            )}
            {showArchivedAction && (
              <button type="button" onClick={onShowArchived} data-testid="empty-state-show-archived">
                Show archived topics ({archivedCount})
              </button>
            )}
            {assignAction && (
              <>
                <button
                  type="button"
                  id={EMPTY_STATE_ASSIGN_BUTTON_ID}
                  onClick={onAssign}
                  disabled={assignDisabled}
                  aria-busy={assigning}
                  aria-describedby={assignBlockedReason !== null && !assigning ? "empty-state-assign-reason" : undefined}
                  data-testid={EMPTY_STATE_ASSIGN_BUTTON_ID}
                >
                  {assigning ? "Assigning default topics…" : "Assign default topics"}
                </button>
                {variant === "unlocked_restorable" && (
                  <span data-testid="empty-state-assign-copy" style={{ color: "#616161" }}>
                    {BULK_RESTORE_ASSIGN_COPY}
                  </span>
                )}
                {assignBlockedReason !== null && !assigning && (
                  <span id="empty-state-assign-reason" data-testid="empty-state-assign-reason" style={{ color: "#616161" }}>
                    {assignBlockedReason}
                  </span>
                )}
              </>
            )}
            {addAction && (
              <button
                type="button"
                id={EMPTY_STATE_ADD_BUTTON_ID}
                onClick={onAddTopic}
                data-testid={EMPTY_STATE_ADD_BUTTON_ID}
              >
                Add custom topic
              </button>
            )}
          </div>
        ))}
    </div>
  );
}
