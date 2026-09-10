import {
  useConnectionHealth,
  assertExhaustiveConnectionHealthState,
} from "../realtime/connectionHealth.js";

// ---------------------------------------------------------------------------
// FacilitatorReadinessGrid — the grid-marker treatment
//
// websocket-staleness-signal: design.md Decision D7. Calls
// useConnectionHealth directly for the facilitator's OWN connection — no
// wrapper, no per-surface re-implementation (Decision D6; verified by task
// 4.12's cross-surface import check). This is a minimal readiness grid, not
// the feature-complete facilitator grid (design.md Non-Goals) — it exists
// to make the marker's mechanism, bound, and cause-blindness testable
// end-to-end, per Decision D9.
//
// The marker's signal source is the facilitator's own connection health,
// not an independently-tracked per-participant staleness flag: when it is
// "unknown-reconnecting", every row shows the marker simultaneously,
// clearing from every row simultaneously the instant it returns to
// "connected" (Decision D4's silent recovery, applied here too). The marker
// composes with, and never suppresses, a row's existing baseline treatment
// — including `disconnected-voted`'s "ready" rendering (OR-1.3).
//
// Scoped to "unknown-reconnecting" only: when the facilitator's own
// connection is "reauth-required", no marker variant renders on any row —
// the facilitator's client instead renders the same top-level
// reauth-required treatment any client would, superseding the grid
// entirely (a facilitator who needs to log back in cannot usefully view a
// live grid regardless of markers).
//
// STYLING IS A PLACEHOLDER (design.md Decision D10, tasks.md task 4.7).
// The final visual register — dimmed/hollow vs. disconnected-adjacent — is
// gated on a mock and Priya Nair's sign-off (tasks.md task 6.2) and is not
// implemented here. The marker below introduces no color or icon language
// at all, satisfying the "no new color/icon language beyond `disconnected`"
// bound (task 4.3) trivially until that sign-off lands.
// ---------------------------------------------------------------------------

export type ParticipantRowState =
  | "connected-not-locked-in"
  | "connected-locked-in"
  | "disconnected-voted"
  | "disconnected-no-vote";

export interface ParticipantRow {
  participantId: string;
  rowState: ParticipantRowState;
}

/** OR-1.3: `disconnected-voted` renders "ready" despite disconnection — unchanged by this design. */
const ROW_STATE_LABEL: Record<ParticipantRowState, string> = {
  "connected-not-locked-in": "Connected",
  "connected-locked-in": "Ready",
  "disconnected-voted": "Ready",
  "disconnected-no-vote": "Disconnected",
};

/** Placeholder copy (Priya Nair's sketch), non-final pending Decision D11's copy sign-off (task 6.1). */
export const STALE_MARKER_TOOLTIP_TEXT = "Last known state may not be current.";

const REAUTH_REQUIRED_TEXT = "Your session needs to be renewed. Please log in again.";

export interface FacilitatorReadinessGridProps {
  connect: () => WebSocket;
  rows: ParticipantRow[];
}

export function FacilitatorReadinessGrid({ connect, rows }: FacilitatorReadinessGridProps) {
  const { state } = useConnectionHealth(connect);

  switch (state) {
    case "connected":
      return <GridRows rows={rows} showMarker={false} />;
    case "unknown-reconnecting":
      return <GridRows rows={rows} showMarker={true} />;
    case "reauth-required":
      return <div role="status">{REAUTH_REQUIRED_TEXT}</div>;
    default: {
      const _exhaustive: never = state;
      return assertExhaustiveConnectionHealthState(_exhaustive);
    }
  }
}

function GridRows({ rows, showMarker }: { rows: ParticipantRow[]; showMarker: boolean }) {
  return (
    <ul>
      {rows.map((row) => (
        <li key={row.participantId} data-testid={`row-${row.participantId}`}>
          <span data-testid={`row-label-${row.participantId}`}>{ROW_STATE_LABEL[row.rowState]}</span>
          {showMarker && (
            <span
              data-testid={`stale-marker-${row.participantId}`}
              title={STALE_MARKER_TOOLTIP_TEXT}
              aria-label={STALE_MARKER_TOOLTIP_TEXT}
            >
              {"○"}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
