import type { ParticipantRow } from "../FacilitatorReadinessGrid.js";

// ---------------------------------------------------------------------------
// Test-local four-state row fixture (tasks.md task 4.0a).
//
// Independent of task 5.2's host-level stub participant-row list, which
// exercises the real dev-server/E2E path (design.md Decision D9) rather
// than unit-testing the marker component — this fixture serves tasks 4.2,
// 4.2a, 4.4-4.6, and 4.10 only.
// ---------------------------------------------------------------------------

export function buildFourStateRowFixture(): ParticipantRow[] {
  return [
    { participantId: "p-connected-not-locked-in", rowState: "connected-not-locked-in" },
    { participantId: "p-connected-locked-in", rowState: "connected-locked-in" },
    { participantId: "p-disconnected-voted", rowState: "disconnected-voted" },
    { participantId: "p-disconnected-no-vote", rowState: "disconnected-no-vote" },
  ];
}
