import { describe, it, expect } from "vitest";
import { voteComposeUiWiresVoteDraft } from "./voteComposeWiring.js";

// ---------------------------------------------------------------------------
// reauth-required-client-prompt tasks.md task 1.1 (design.md Decision D5).
//
// Build-enforced, not a recorded human grep, per Tomás Ferreira's security
// review: this is the single fact task 3.1's vote-loss sentence depends on.
// If this test ever fails, a vote-compose UI has started importing
// voteDraft.ts's persist/restore hooks — follow tasks.md tasks 1.2 and 3.6
// to update the reauth-required banner copy and this test's expectation
// together, not independently.
// ---------------------------------------------------------------------------

describe("voteDraft wiring gate (tasks.md task 1.1, design.md Decision D5)", () => {
  it("no vote-compose UI component in the current codebase imports voteDraft.ts's persist/restore hooks", () => {
    expect(voteComposeUiWiresVoteDraft()).toBe(false);
  });
});
