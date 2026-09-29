import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ParticipantRosterView } from "../ParticipantRosterView.js";
import type { RosterEntry } from "../../realtime/participantRoster.js";

// ---------------------------------------------------------------------------
// ParticipantRosterView — participant-readiness-roster, tasks.md 3.4/3.6.
// ---------------------------------------------------------------------------

const JOIN_URL = "https://app.example.com/api/join/tok123";

describe("ParticipantRosterView", () => {
  // spec.md's first-line scenario -- every session starts in this state,
  // not an edge case.
  it("shows the empty-state prompt and the join link when the roster has zero participants", () => {
    render(<ParticipantRosterView participants={[]} joinUrl={JOIN_URL} />);

    expect(screen.getByTestId("participant-roster-empty")).toHaveTextContent(/no one has joined yet/i);
    expect(screen.getByTestId("participant-roster-empty-join-link")).toHaveTextContent(JOIN_URL);
    expect(screen.queryByTestId("participant-roster-list")).not.toBeInTheDocument();
  });

  it("renders one row per participant, by name, with no additional status label when connected", () => {
    const participants: RosterEntry[] = [
      { userId: "u1", displayName: "Alice", disconnected: false },
      { userId: "u2", displayName: "Bob", disconnected: false },
    ];
    render(<ParticipantRosterView participants={participants} joinUrl={JOIN_URL} />);

    const rows = screen.getAllByTestId("participant-roster-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Alice");
    expect(rows[1]).toHaveTextContent("Bob");
    expect(screen.queryByText(/present/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("participant-roster-disconnected-marker")).not.toBeInTheDocument();
  });

  it("shows the disconnected marker as the only per-row indicator for a disconnected participant", () => {
    const participants: RosterEntry[] = [{ userId: "u1", displayName: "Alice", disconnected: true }];
    render(<ParticipantRosterView participants={participants} joinUrl={JOIN_URL} />);

    expect(screen.getByTestId("participant-roster-disconnected-marker")).toBeInTheDocument();
  });

  it("shows no quorum/count affordance and no removal control", () => {
    const participants: RosterEntry[] = [
      { userId: "u1", displayName: "Alice", disconnected: false },
      { userId: "u2", displayName: "Bob", disconnected: true },
    ];
    render(<ParticipantRosterView participants={participants} joinUrl={JOIN_URL} />);

    expect(screen.queryByText(/\d+ of \d+/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  });
});
