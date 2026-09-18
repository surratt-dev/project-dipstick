import {
  useConnectionHealth,
  assertExhaustiveConnectionHealthState,
} from "../realtime/connectionHealth.js";
import { ReauthRequiredTreatment } from "./ReauthRequiredTreatment.js";

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
// COPY IS NOT FINAL. `unknown-reconnecting`'s copy sign-off is already
// closed (per the pilot-readiness gate status notes in
// specs/websocket-staleness-signal/spec.md). `reauth-required`'s copy is
// still pending Priya Nair's sign-off (reauth-required-client-prompt
// design.md Decision D4, tasks.md task 3.1) — see ReauthRequiredTreatment.tsx,
// which owns that copy now (Decision D9).
// ---------------------------------------------------------------------------

const UNKNOWN_RECONNECTING_TEXT = "Your view may be out of date. Refresh to continue.";

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
      return <ReauthRequiredTreatment />;
    default: {
      const _exhaustive: never = state;
      return assertExhaustiveConnectionHealthState(_exhaustive);
    }
  }
}
