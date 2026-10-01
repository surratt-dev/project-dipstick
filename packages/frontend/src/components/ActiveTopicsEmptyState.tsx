import type { ReactNode } from "react";
import type { ActiveEmptyStateVariant } from "../pages/addCustomTopic.js";

// ---------------------------------------------------------------------------
// ActiveTopicsEmptyState — topic-add-form-and-empty-state, design.md
// Decisions 7 and 10. A small, honest state for an empty active list, driven
// only by activeEmptyStateVariant(locked, archivedCount, canAddTopics):
//
//   1 locked                         -> neutral copy (H1), no actions
//   2 unlocked, archived, can add    -> Show archived topics (n) + Add custom topic
//   3 unlocked, archived, can't add  -> Show archived topics (n)
//   4 unlocked, none, can add        -> Add custom topic
//   5 unlocked, none, can't add      -> "can't be added from this account yet", no actions
//
// Rows 3 and 5 exist only because canAddTopics is temporarily false for
// application administrators (#176). Remove them in the #176 fix.
//
// Row 1's copy names a human group, not an application role, support
// channel, or control (H1; handoffs/zero-topic-team-recovery-path.md).
// No illustration: the state is rare and should be small.
// ---------------------------------------------------------------------------

export const EMPTY_STATE_ADD_BUTTON_ID = "empty-state-add-topic";

interface ActiveTopicsEmptyStateProps {
  variant: ActiveEmptyStateVariant;
  archivedCount: number;
  onShowArchived: () => void;
  onAddTopic: () => void;
  // The open add form, which takes the place of the actions below the
  // message (spec: the message stays shown above it).
  form?: ReactNode;
}

export function ActiveTopicsEmptyState({
  variant,
  archivedCount,
  onShowArchived,
  onAddTopic,
  form,
}: ActiveTopicsEmptyStateProps) {
  const message =
    variant === 1
      ? "This team has no active topics, so its sessions can't run. Topics can't be assigned from this screen. Ask the people who run this application for your organization to restore this team's default topics."
      : variant === 5
        ? "This team has no active topics. Topics can't be added from this account yet."
        : "This team has no active topics.";
  const showArchivedAction = variant === 2 || variant === 3;
  const addAction = variant === 2 || variant === 4;

  return (
    <div data-testid="active-topics-empty">
      <p data-testid="active-topics-empty-message">{message}</p>
      {form ??
        ((showArchivedAction || addAction) && (
          <div data-testid="active-topics-empty-actions" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {showArchivedAction && (
              <button type="button" onClick={onShowArchived} data-testid="empty-state-show-archived">
                Show archived topics ({archivedCount})
              </button>
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
