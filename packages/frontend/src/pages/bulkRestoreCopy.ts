// ---------------------------------------------------------------------------
// bulk-restore-default-topics (#218): the literal copy fixed by the
// topic-management-screen spec, and the single-Restore visibility predicate
// (task 5.1: it was inline JSX logic, so it is named here and pinned by
// tests; the bulk control reuses it).
//
// None of this copy may contain "reset", "canonical", "trend" or "history
// lost", or claim that original wording returns (spec "No forbidden claims").
// ---------------------------------------------------------------------------

/**
 * Whether the screen offers restore controls at all. The screen is only
 * reachable by a caller TOPIC-002 admits (standing facilitator or admin), so
 * the only per-view condition is that the team is not the read-only canonical
 * default topics (#214).
 */
export function canShowRestoreControls(isCanonicalDefaults: boolean): boolean {
  return !isCanonicalDefaults;
}

export const BULK_RESTORE_TITLE = "Restore default topics";
export const BULK_RESTORE_DISABLED_REASON = "Save or discard your edit first.";
export const BULK_RESTORE_SINGLE_SENTENCE = "To bring back only some topics, restore them one at a time from the archived list.";
export const BULK_RESTORE_UNCHANGED_SENTENCE = "Your custom topics, the current order, and annotations are not changed.";
export const BULK_RESTORE_NOTHING = "Nothing to restore.";
export const BULK_RESTORE_ASSIGN_COPY =
  "Assign default topics creates new copies of the default topics; it does not bring back the originals or their history.";
export const BULK_RESTORE_FAILED = "The default topics couldn't be restored. Try again.";
export const BULK_RESTORE_LOCKED = "Topics cannot be customized until this team's first session is completed.";
export const BULK_RESTORE_NOT_FOUND = "Team not found.";
export const BULK_RESTORE_FORBIDDEN = "You can no longer restore topics for this team.";

export const bulkCountLine = (n: number) => `${n} ${n === 1 ? "topic" : "topics"} will be added`;
export const bulkPlacementSentence = (n: number) =>
  n === 1 ? "It will be added to the end of your list." : "They will be added to the end of your list, in the order shown.";
export const skippedLine = (name: string, reason: string) =>
  reason === "NAME_ACTIVE" ? `${name}: an active topic with this name already exists` : `${name}: not restored`;

export const bulkResultLine = (actual: number, previewed: number) =>
  actual !== previewed
    ? `Restored ${actual} of ${previewed} topics. The list changed after you opened this dialog.`
    : actual === 1
      ? "Restored 1 topic. It is at the end of your list."
      : `Restored ${actual} topics. They are at the end of your list.`;
