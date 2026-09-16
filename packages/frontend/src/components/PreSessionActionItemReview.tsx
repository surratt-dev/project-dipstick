import type { ActionItemsReviewResponse } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// PreSessionActionItemReview — pre-session-action-item-review, tasks.md
// Section 5.
//
// Read-only presentation of the team's open/in-progress action items during
// a session's pre_session phase. Fetching, WebSocket subscription, and
// session-status branching live in SessionLobbyPage (tasks.md Section 4) —
// this component only renders the data it is given.
//
// Copy (empty state, staleness tiers, summary line) is the drafted,
// reviewed-quality text from copy.md (tasks.md 1.1). Rachel Okonkwo's actual
// sign-off on the staleness-tier/empty-state copy is still outstanding — see
// copy.md's "Outstanding sign-off" section — this is not a placeholder, but
// it is not yet a confirmed-final string either.
//
// Ordering is stale-first (design.md Decision 6, tasks.md 1.2) — a reasoned
// default recorded pending real stakeholder confirmation, not a settled
// requirement. Isolated to sortForReview() below so it is cheap to flip back
// to chronological (the order fetchPreSessionActionItems already returns)
// if confirmation lands the other way.
// ---------------------------------------------------------------------------

type ActionItem = ActionItemsReviewResponse["actionItems"][number];
type KnownStalenessLevel = "yellow" | "orange" | "red";

const STALENESS_SORT_RANK: Record<string, number> = {
  red: 0,
  orange: 1,
  yellow: 2,
  none: 3,
};

const STALENESS_COLORS: Record<KnownStalenessLevel, string> = {
  yellow: "#f9a825",
  orange: "#ef6c00",
  red: "#c62828",
};

// copy.md — per-item staleness badge/label text.
const STALENESS_LABELS: Record<KnownStalenessLevel, string> = {
  yellow: "Carried over 1 session",
  orange: "Carried over 2 sessions",
  red: "Carried over 3+ sessions",
};

const STATUS_LABELS: Record<ActionItem["status"], string> = {
  open: "Open",
  in_progress: "In Progress",
};

/**
 * Defensive against any value that isn't one of the three colored tiers —
 * including a stalenessLevel this frontend doesn't recognize at all. Per
 * spec.md's "a single item's staleness cannot be computed" requirement: that
 * item degrades to no indicator, the rest of the screen renders normally.
 */
function knownStalenessLevel(level: string): KnownStalenessLevel | null {
  return level === "yellow" || level === "orange" || level === "red" ? level : null;
}

function sortForReview(items: ActionItem[]): ActionItem[] {
  return [...items].sort((a, b) => {
    const rankA = STALENESS_SORT_RANK[a.stalenessLevel] ?? STALENESS_SORT_RANK["none"]!;
    const rankB = STALENESS_SORT_RANK[b.stalenessLevel] ?? STALENESS_SORT_RANK["none"]!;
    return rankA - rankB;
  });
}

function ActionItemRow({ item }: { item: ActionItem }) {
  const staleness = knownStalenessLevel(item.stalenessLevel);

  return (
    <li
      data-testid={`review-action-item-${item.actionItemId}`}
      style={{
        listStyle: "none",
        border: "1px solid #e0e0e0",
        borderRadius: "6px",
        padding: "0.75rem 1rem",
        marginBottom: "0.5rem",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span data-testid={`review-action-item-description-${item.actionItemId}`} style={{ fontWeight: 500 }}>
          {item.description}
        </span>
        <span data-testid={`review-action-item-status-${item.actionItemId}`} style={{ fontSize: "0.75rem", color: "#616161" }}>
          {STATUS_LABELS[item.status] ?? item.status}
        </span>
      </div>
      <div style={{ marginTop: "0.375rem", fontSize: "0.875rem", color: "#616161" }}>
        <span data-testid={`review-action-item-owner-${item.actionItemId}`}>Owner: {item.ownerDisplayName}</span>
        <span style={{ marginLeft: "1rem" }}>
          Session #{item.originatingSessionNumber}
        </span>
        {staleness && (
          <span
            data-testid={`review-action-item-staleness-${item.actionItemId}`}
            style={{
              marginLeft: "1rem",
              fontWeight: 600,
              color: STALENESS_COLORS[staleness],
            }}
          >
            {STALENESS_LABELS[staleness]}
          </span>
        )}
      </div>
    </li>
  );
}

export interface PreSessionActionItemReviewProps {
  actionItems: ActionItem[];
  isFacilitator: boolean;
  onBeginVoting: () => void;
  beginVotingPending: boolean;
  /** Generic, pre-drafted fallback message — see SessionLobbyPage's handling of begin-voting's pre-existing bare-500 rough edge (SESSION-005, out of scope for this change to fix). */
  beginVotingError: string | null;
}

export function PreSessionActionItemReview({
  actionItems,
  isFacilitator,
  onBeginVoting,
  beginVotingPending,
  beginVotingError,
}: PreSessionActionItemReviewProps) {
  const beginFirstTopicButton = isFacilitator ? (
    <div style={{ marginTop: "1.5rem" }}>
      <button
        type="button"
        data-testid="begin-first-topic-button"
        onClick={onBeginVoting}
        disabled={beginVotingPending}
      >
        {beginVotingPending ? "Starting…" : "Begin First Topic"}
      </button>
      {beginVotingError && (
        <p role="alert" data-testid="begin-first-topic-error" style={{ color: "#c62828", marginTop: "0.5rem" }}>
          {beginVotingError}
        </p>
      )}
    </div>
  ) : null;

  if (actionItems.length === 0) {
    return (
      <div data-testid="pre-session-review-empty">
        {/* copy.md — empty state, identical for all participants */}
        <p style={{ fontWeight: 600 }}>No open action items.</p>
        <p style={{ color: "#616161" }}>Nothing carried over from a previous session.</p>
        {beginFirstTopicButton}
      </div>
    );
  }

  const staleCount = actionItems.filter((item) => knownStalenessLevel(item.stalenessLevel) !== null).length;
  const summaryText =
    staleCount > 0
      ? staleCount === 1
        ? "1 item needs attention"
        : `${staleCount} items need attention`
      : `${actionItems.length} open item${actionItems.length === 1 ? "" : "s"} — none need attention`;

  return (
    <div data-testid="pre-session-review">
      {/* copy.md — summary line, always shown, position stays predictable */}
      <p data-testid="pre-session-review-summary" style={{ fontWeight: 600 }}>
        {summaryText}
      </p>

      {/* copy.md — always-visible staleness legend, never behind a hover/click */}
      <div
        data-testid="pre-session-review-legend"
        style={{ fontSize: "0.875rem", color: "#616161", marginBottom: "1rem" }}
      >
        <strong>What the colors mean: </strong>
        Yellow — carried over 1 session. Orange — carried over 2 sessions. Red — carried
        over 3 or more sessions. No color — updated in the most recently completed session.
      </div>

      <ul style={{ padding: 0, margin: 0 }} data-testid="pre-session-review-list">
        {sortForReview(actionItems).map((item) => (
          <ActionItemRow key={item.actionItemId} item={item} />
        ))}
      </ul>

      {beginFirstTopicButton}
    </div>
  );
}
