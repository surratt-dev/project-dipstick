import {
  type ConnectionHealthState,
  assertExhaustiveConnectionHealthState,
} from "../realtime/connectionHealth.js";
import { ReauthRequiredTreatment } from "./ReauthRequiredTreatment.js";

// ---------------------------------------------------------------------------
// ConnectionStatusBanner — participant-facing rendered treatment
//
// websocket-staleness-signal: design.md Decisions D6, D8. Renders one fixed
// string per state, with no prop or code path that varies wording by cause
// *within* a state — this is the property task 3.2's rendered-output-identity
// test exists to check. `"connected"` renders nothing.
//
// session-timeout-continuity (design.md Decision 6): this component no
// longer calls useConnectionHealth itself — `state`/`socket` are lifted up
// to SessionConnectionHost.tsx and passed down as props, so the new
// facilitator-reconnect indicator (a sibling consumer, not a fork) can share
// the same live socket instead of opening a second WebSocket connection.
// FacilitatorReadinessGrid.tsx is unaffected by this refactor — it still
// calls useConnectionHealth directly for the facilitator's own connection,
// since the facilitator-reconnect indicator is participant-facing only.
//
// COPY IS NOT FINAL. `unknown-reconnecting`'s copy sign-off is already
// closed (per the pilot-readiness gate status notes in
// specs/websocket-staleness-signal/spec.md). `reauth-required`'s copy is
// still pending Priya Nair's sign-off (reauth-required-client-prompt
// design.md Decision D4, tasks.md task 3.1) — see ReauthRequiredTreatment.tsx,
// which owns that copy now (Decision D9).
// ---------------------------------------------------------------------------

const UNKNOWN_RECONNECTING_TEXT = "Your view may be out of date. Refresh to continue.";

export interface ConnectionStatusBannerProps {
  state: ConnectionHealthState;
  socket: WebSocket | null;
}

export function ConnectionStatusBanner({ state }: ConnectionStatusBannerProps) {
  switch (state) {
    case "connected":
      return null;
    case "unknown-reconnecting":
      return <div role="status">{UNKNOWN_RECONNECTING_TEXT}</div>;
    case "reauth-required":
      return (
        <ReauthRequiredTreatment
          role="participant"
          returnTo={window.location.pathname + window.location.search}
        />
      );
    default: {
      const _exhaustive: never = state;
      return assertExhaustiveConnectionHealthState(_exhaustive);
    }
  }
}
