import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActiveTopicsEmptyState } from "../ActiveTopicsEmptyState.js";
import type { ActiveEmptyStateVariant } from "../../pages/addCustomTopic.js";

// zero-topic-team-recovery (#200) tasks.md 6.3: the presentational empty
// state. The variant matrix itself is tested on activeEmptyStateVariant; here
// the component's own gates: Assign needs BOTH the locked_assign variant and
// canAssign, and shows its blocked / in-flight state.

function renderState(overrides: Partial<React.ComponentProps<typeof ActiveTopicsEmptyState>> = {}) {
  const props = {
    variant: "locked_assign" as ActiveEmptyStateVariant,
    addAllowed: true,
    archivedCount: 2,
    onShowArchived: vi.fn(),
    onAddTopic: vi.fn(),
    canAssign: true,
    assigning: false,
    assignBlockedReason: null as string | null,
    onAssign: vi.fn(),
    ...overrides,
  };
  render(<ActiveTopicsEmptyState {...props} />);
  return props;
}

describe("ActiveTopicsEmptyState Assign default topics (#200)", () => {
  it("renders the button for locked_assign + canAssign and calls onAssign once per click", () => {
    const props = renderState();
    fireEvent.click(screen.getByRole("button", { name: "Assign default topics" }));
    expect(props.onAssign).toHaveBeenCalledTimes(1);
  });

  it.each<[ActiveEmptyStateVariant, boolean]>([
    ["locked", true], // canAssign alone is not enough: the variant must agree
    ["locked_assign", false], // nor the variant alone
    ["unlocked_with_archived", true],
    ["unlocked_none_archived", true],
  ])("variant %s with canAssign=%s renders no Assign button", (variant, canAssign) => {
    renderState({ variant, canAssign });
    expect(screen.queryByRole("button", { name: /assign default topics/i })).not.toBeInTheDocument();
  });

  it("locked_assign never offers Add custom topic or Show archived, even when addAllowed", () => {
    renderState({ addAllowed: true });
    expect(screen.queryByRole("button", { name: "Add custom topic" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show archived topics/ })).not.toBeInTheDocument();
  });

  it("while assigning the button is disabled, aria-busy, and says so", () => {
    renderState({ assigning: true });
    const button = screen.getByRole("button", { name: "Assigning default topics…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("when blocked (the same busy states as Add) the button is disabled and the reason is shown and described", () => {
    const props = renderState({ assignBlockedReason: "Save or cancel your definition changes first." });
    const button = screen.getByRole("button", { name: "Assign default topics" });
    expect(button).toBeDisabled();
    expect(screen.getByText("Save or cancel your definition changes first.")).toBeInTheDocument();
    expect(button).toHaveAccessibleDescription("Save or cancel your definition changes first.");
    fireEvent.click(button);
    expect(props.onAssign).not.toHaveBeenCalled();
  });
});
