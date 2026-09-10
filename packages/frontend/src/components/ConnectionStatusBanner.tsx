import {
  useConnectionHealth,
  assertExhaustiveConnectionHealthState,
} from "../realtime/connectionHealth.js";

// ---------------------------------------------------------------------------
// ConnectionStatusBanner — participant-facing rendered treatment
//
// websocket-staleness-signal: design.md Decisions D6, D8. Calls
// useConnectionHealth directly — no wrapper, no per-surface
// re-implementation (Decision D6; verified by task 4.12's cross-surface
// import check once the grid-marker treatment also exists). Renders one
// fixed string per state, with no prop or code path that varies wording by
// cause *within* a state — this is the property task 3.2's
// rendered-output-identity test exists to check. `"connected"` renders
// nothing.
//
// COPY IS NOT FINAL. Both strings below are placeholders pending Priya
// Nair's sign-off against actual layout (design.md Decision D11,
// tasks.md task 6.1) — see the gate language in tasks.md Group 6. Do not
// treat this wording as implementation-ready.
// ---------------------------------------------------------------------------

const UNKNOWN_RECONNECTING_TEXT = "Your view may be out of date. Refresh to continue.";
const REAUTH_REQUIRED_TEXT = "Your session needs to be renewed. Please log in again.";

export interface ConnectionStatusBannerProps {
  connect: () => WebSocket;
}

export function ConnectionStatusBanner({ connect }: ConnectionStatusBannerProps) {
  const { state } = useConnectionHealth(connect);

  switch (state) {
    case "connected":
      return null;
    case "unknown-reconnecting":
      return <div role="status">{UNKNOWN_RECONNECTING_TEXT}</div>;
    case "reauth-required":
      return <div role="status">{REAUTH_REQUIRED_TEXT}</div>;
    default: {
      const _exhaustive: never = state;
      return assertExhaustiveConnectionHealthState(_exhaustive);
    }
  }
}
