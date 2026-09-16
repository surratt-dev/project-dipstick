import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ActionItemsReviewResponse } from "@dipstick/shared";
import { PreSessionActionItemReview } from "../PreSessionActionItemReview.js";

// ---------------------------------------------------------------------------
// PreSessionActionItemReview — pre-session-action-item-review, tasks.md
// Section 5.
// ---------------------------------------------------------------------------

type ActionItem = ActionItemsReviewResponse["actionItems"][number];

afterEach(() => cleanup());

function makeItem(overrides: Partial<ActionItem>): ActionItem {
  return {
    actionItemId: "ai-1",
    description: "Fix flaky test",
    ownerUserId: "user-1",
    ownerDisplayName: "Alice",
    status: "open",
    originatingSessionId: "session-old-1",
    originatingSessionNumber: 3,
    stalenessLevel: "none",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderReview(overrides: Partial<Parameters<typeof PreSessionActionItemReview>[0]> = {}) {
  return render(
    <PreSessionActionItemReview
      actionItems={[]}
      isFacilitator={false}
      onBeginVoting={vi.fn()}
      beginVotingPending={false}
      beginVotingError={null}
      {...overrides}
    />,
  );
}

describe("5.5: empty state", () => {
  it("shows the empty-state copy when there are no action items", () => {
    renderReview({ actionItems: [] });
    expect(screen.getByTestId("pre-session-review-empty")).toHaveTextContent("No open action items.");
    expect(screen.getByTestId("pre-session-review-empty")).toHaveTextContent(
      "Nothing carried over from a previous session.",
    );
  });

  it("renders the facilitator's advance control in the empty state when isFacilitator is true", () => {
    renderReview({ actionItems: [], isFacilitator: true });
    expect(screen.getByTestId("begin-first-topic-button")).toBeInTheDocument();
  });

  it("does not render the advance control in the empty state for a non-facilitator", () => {
    renderReview({ actionItems: [], isFacilitator: false });
    expect(screen.queryByTestId("begin-first-topic-button")).not.toBeInTheDocument();
  });
});

describe("5.2: item rendering", () => {
  it("renders description, owner display name, status label, and originating session number as 'Session #N'", () => {
    renderReview({
      actionItems: [
        makeItem({ actionItemId: "ai-1", description: "Fix flaky test", ownerDisplayName: "Alice", status: "in_progress", originatingSessionNumber: 12 }),
      ],
    });

    expect(screen.getByTestId("review-action-item-description-ai-1")).toHaveTextContent("Fix flaky test");
    expect(screen.getByTestId("review-action-item-owner-ai-1")).toHaveTextContent("Alice");
    expect(screen.getByTestId("review-action-item-status-ai-1")).toHaveTextContent("In Progress");
    expect(screen.getByTestId("review-action-item-ai-1")).toHaveTextContent("Session #12");
  });

  it("does not render originatingSessionId anywhere", () => {
    renderReview({
      actionItems: [makeItem({ actionItemId: "ai-1", originatingSessionId: "session-uuid-should-not-appear" })],
    });
    expect(screen.getByTestId("review-action-item-ai-1")).not.toHaveTextContent("session-uuid-should-not-appear");
  });
});

describe("5.4: staleness legend and badge text", () => {
  it("renders the legend, always visible", () => {
    renderReview({ actionItems: [makeItem({ stalenessLevel: "red" })] });
    const legend = screen.getByTestId("pre-session-review-legend");
    expect(legend).toBeInTheDocument();
    expect(legend).toHaveTextContent(/yellow/i);
    expect(legend).toHaveTextContent(/orange/i);
    expect(legend).toHaveTextContent(/red/i);
  });

  it("shows the per-item badge text for yellow/orange/red", () => {
    renderReview({
      actionItems: [
        makeItem({ actionItemId: "ai-y", stalenessLevel: "yellow" }),
        makeItem({ actionItemId: "ai-o", stalenessLevel: "orange" }),
        makeItem({ actionItemId: "ai-r", stalenessLevel: "red" }),
      ],
    });
    expect(screen.getByTestId("review-action-item-staleness-ai-y")).toHaveTextContent("Carried over 1 session");
    expect(screen.getByTestId("review-action-item-staleness-ai-o")).toHaveTextContent("Carried over 2 sessions");
    expect(screen.getByTestId("review-action-item-staleness-ai-r")).toHaveTextContent("Carried over 3+ sessions");
  });

  it("shows no staleness badge for a 'none' level item", () => {
    renderReview({ actionItems: [makeItem({ actionItemId: "ai-n", stalenessLevel: "none" })] });
    expect(screen.queryByTestId("review-action-item-staleness-ai-n")).not.toBeInTheDocument();
  });

  it("5.3: degrades to no indicator (not a blocked screen) for an unrecognized staleness value", () => {
    renderReview({
      actionItems: [makeItem({ actionItemId: "ai-bad", stalenessLevel: "unknown-value" as unknown as ActionItem["stalenessLevel"] })],
    });
    expect(screen.getByTestId("review-action-item-ai-bad")).toBeInTheDocument();
    expect(screen.queryByTestId("review-action-item-staleness-ai-bad")).not.toBeInTheDocument();
  });
});

describe("Summary line", () => {
  it("shows the stale-count form when at least one item is stale", () => {
    renderReview({
      actionItems: [
        makeItem({ actionItemId: "ai-1", stalenessLevel: "red" }),
        makeItem({ actionItemId: "ai-2", stalenessLevel: "none" }),
        makeItem({ actionItemId: "ai-3", stalenessLevel: "orange" }),
      ],
    });
    expect(screen.getByTestId("pre-session-review-summary")).toHaveTextContent("2 items need attention");
  });

  it("shows the neutral no-stale-items variant when open items exist but none are stale", () => {
    renderReview({
      actionItems: [
        makeItem({ actionItemId: "ai-1", stalenessLevel: "none" }),
        makeItem({ actionItemId: "ai-2", stalenessLevel: "none" }),
      ],
    });
    expect(screen.getByTestId("pre-session-review-summary")).toHaveTextContent("2 open items — none need attention");
  });

  it("singular phrasing for exactly one stale item", () => {
    renderReview({ actionItems: [makeItem({ actionItemId: "ai-1", stalenessLevel: "yellow" })] });
    expect(screen.getByTestId("pre-session-review-summary")).toHaveTextContent("1 item needs attention");
  });
});

describe("Item ordering (design.md Decision 6, tasks.md 1.2 — stale-first, reasoned default)", () => {
  it("orders red, then orange, then yellow, then none", () => {
    renderReview({
      actionItems: [
        makeItem({ actionItemId: "ai-none", stalenessLevel: "none" }),
        makeItem({ actionItemId: "ai-yellow", stalenessLevel: "yellow" }),
        makeItem({ actionItemId: "ai-red", stalenessLevel: "red" }),
        makeItem({ actionItemId: "ai-orange", stalenessLevel: "orange" }),
      ],
    });
    const list = screen.getByTestId("pre-session-review-list");
    const ids = Array.from(list.querySelectorAll("[data-testid^='review-action-item-']"))
      .filter((el) => !el.getAttribute("data-testid")!.includes("description"))
      .filter((el) => !el.getAttribute("data-testid")!.includes("owner"))
      .filter((el) => !el.getAttribute("data-testid")!.includes("status"))
      .filter((el) => !el.getAttribute("data-testid")!.includes("staleness"))
      .map((el) => el.getAttribute("data-testid"));
    expect(ids).toEqual([
      "review-action-item-ai-red",
      "review-action-item-ai-orange",
      "review-action-item-ai-yellow",
      "review-action-item-ai-none",
    ]);
  });
});

describe("Begin First Topic control (Decision 4/5 — one gate, driven by the parent's props)", () => {
  it("is disabled and shows 'Starting…' while beginVotingPending is true", () => {
    renderReview({ actionItems: [], isFacilitator: true, beginVotingPending: true });
    const button = screen.getByTestId("begin-first-topic-button");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Starting…");
  });

  it("calls onBeginVoting when clicked", () => {
    const onBeginVoting = vi.fn();
    renderReview({ actionItems: [], isFacilitator: true, onBeginVoting });
    fireEvent.click(screen.getByTestId("begin-first-topic-button"));
    expect(onBeginVoting).toHaveBeenCalledTimes(1);
  });

  it("shows the generic advance-failure fallback message when beginVotingError is set", () => {
    renderReview({ actionItems: [], isFacilitator: true, beginVotingError: "Couldn't start voting. Try again." });
    expect(screen.getByTestId("begin-first-topic-error")).toHaveTextContent("Couldn't start voting. Try again.");
  });

  it("shows no error text when beginVotingError is null", () => {
    renderReview({ actionItems: [], isFacilitator: true, beginVotingError: null });
    expect(screen.queryByTestId("begin-first-topic-error")).not.toBeInTheDocument();
  });
});

describe("No cross-team or cross-owner comparison (tasks.md 6.7)", () => {
  it("renders no ranking, aggregation, or comparison UI — only per-item facts", () => {
    renderReview({
      actionItems: [
        makeItem({ actionItemId: "ai-1", ownerDisplayName: "Alice" }),
        makeItem({ actionItemId: "ai-2", ownerDisplayName: "Bob" }),
      ],
    });
    // The only aggregate figure on screen is the summary line's plain count —
    // no per-owner breakdown, no leaderboard, no cross-item comparison text.
    expect(screen.queryByText(/rank|leaderboard|compare/i)).not.toBeInTheDocument();
  });
});
