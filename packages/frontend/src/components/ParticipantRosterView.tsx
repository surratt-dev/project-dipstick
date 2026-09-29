import type { RosterEntry } from "../realtime/participantRoster.js";

// ---------------------------------------------------------------------------
// ParticipantRosterView — participant-readiness-roster, tasks.md 3.4/3.5.
//
// Presentation only: no fetching, no WebSocket handling (owned by
// useParticipantRoster, shared with SessionLobbyPage/DraftSessionHost).
//
// Per spec.md ("Each roster entry shows the participant's name with no
// additional per-row status label for the present state" /
// "no quorum, expected-attendee-count, or facilitator-removal affordance"):
//   - name per row, nothing else, for a connected participant
//   - the disconnected marker is the ONLY per-row indicator this view
//     renders -- it does not distinguish cause (network drop, reauth, or
//     anything else), matching connectionHealth.ts's disclosure-blind
//     convention
//   - no "Present" label, no count, no quorum framing, no removal control
//   - an explicit empty-state prompt when zero participants have joined,
//     with the join link displayed alongside it (spec.md's first-line
//     scenario, not an edge case -- every session starts in this state)
//
// Disconnected-marker visual treatment (color/size/placement) is a
// first-pass default, explicitly not final -- design.md D6/tasks.md 3.5
// routes it through Priya Nair's usability review before it locks in.
// ---------------------------------------------------------------------------

export interface ParticipantRosterViewProps {
  participants: RosterEntry[];
  /**
   * Optional: `DraftSessionHost` always has this available and passes it.
   * `SessionLobbyPage` has no existing mechanism to fetch a session's join
   * token today (out of this change's scope to build) -- when omitted, the
   * empty-state prompt still renders, just without the join-link line.
   */
  joinUrl?: string;
}

export function ParticipantRosterView({ participants, joinUrl }: ParticipantRosterViewProps) {
  return (
    <div data-testid="participant-roster" style={{ marginTop: "1.5rem" }}>
      <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Participants</h3>

      {participants.length === 0 ? (
        <div data-testid="participant-roster-empty">
          <p>No one has joined yet.</p>
          {joinUrl && (
            <p data-testid="participant-roster-empty-join-link" style={{ color: "#757575" }}>
              {joinUrl}
            </p>
          )}
        </div>
      ) : (
        <ul data-testid="participant-roster-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {participants.map((participant) => (
            <li
              key={participant.userId}
              data-testid="participant-roster-row"
              style={{ padding: "0.25rem 0", display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              <span>{participant.displayName}</span>
              {participant.disconnected && (
                <span
                  data-testid="participant-roster-disconnected-marker"
                  aria-label="Disconnected"
                  title="Disconnected"
                  style={{ color: "#9e9e9e", fontSize: "0.75rem" }}
                >
                  ○ disconnected
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
