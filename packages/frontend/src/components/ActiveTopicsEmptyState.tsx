import type { ReactNode } from "react";
import type { ActiveEmptyStateVariant } from "../pages/addCustomTopic.js";

// ---------------------------------------------------------------------------
// ActiveTopicsEmptyState — topic-add-form-and-empty-state, design.md
// Decisions 7 and 10; topic-003-admin-authorization design.md D4. A small,
// honest state for an empty active list. The message and the "Show archived"
// action are driven by activeEmptyStateVariant(locked, archivedCount):
//
//   locked                  -> neutral copy (H1), no actions
//   unlocked_with_archived  -> Show archived topics (n)
//   unlocked_none_archived  -> no archived action
//
// The add action is gated by the required `addAllowed` prop, not by the
// variant: "Add custom topic" renders only when addAllowed is true and the
// variant is not locked. The page passes the same addAllowed it uses for the
// heading trigger, so a missing or false canAddTopics fails closed here too.
//
// The locked copy names a human group, not an application role, support
// channel, or control (H1; recovery path tracked in #200).
// No illustration: the state is rare and should be small.
// ---------------------------------------------------------------------------

export const EMPTY_STATE_ADD_BUTTON_ID = "empty-state-add-topic";

interface ActiveTopicsEmptyStateProps {
  variant: ActiveEmptyStateVariant;
  // Whether the caller may add a topic here (the page's addAllowed). Required,
  // so a forgotten call site is a type error rather than a visible button.
  addAllowed: boolean;
  archivedCount: number;
  onShowArchived: () => void;
  onAddTopic: () => void;
  // The open add form, which takes the place of the actions below the
  // message (spec: the message stays shown above it).
  form?: ReactNode;
}

export function ActiveTopicsEmptyState({
  variant,
  addAllowed,
  archivedCount,
  onShowArchived,
  onAddTopic,
  form,
}: ActiveTopicsEmptyStateProps) {
  const message =
    variant === "locked"
      ? "This team has no active topics, so its sessions can't run. Topics can't be assigned from this screen. Ask the people who run this application for your organization to restore this team's default topics."
      : "This team has no active topics.";
  const showArchivedAction = variant === "unlocked_with_archived";
  const addAction = addAllowed && variant !== "locked";

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
