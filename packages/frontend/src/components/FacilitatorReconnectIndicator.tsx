import { useFacilitatorConnectionStatus } from "../realtime/facilitatorConnectionStatus.js";

// ---------------------------------------------------------------------------
// FacilitatorReconnectIndicator — facilitator-reconnect-indicator (session-
// timeout-continuity design.md Decision 5's "Client-side" paragraph).
//
// A quiet, one-line, role="status" (never role="alert" — this is
// informational, not actionable by the participant) indicator, styled in a
// restrained register distinct from BOTH unknown-reconnecting's and
// reauth-required's — the participant cannot do anything about the
// facilitator's connection, so this must never look actionable. No click
// handler, no auto-notify side effect. Renders nothing while the
// facilitator is reported connected, or before any signal has been received
// at all.
//
// KNOWN LIMITATION (design.md Decision 5, tasks.md task 4.15): this
// indicator has no duration cutoff. A facilitator gone for 30 seconds and a
// facilitator gone permanently (role removed, access revoked, employment
// ended) produce the identical payload shape and the identical rendered
// indicator — participants can only distinguish "blip" from "permanent" by
// how long it persists, which this component does nothing to bound. This is
// a real, out-of-scope product gap (resolving it needs a duration cutoff or
// a facilitator-reassignment flow, neither of which exists yet) — tracked as
// a follow-up — GitHub issue #145 — rather than left to surface as a
// support ticket later.
// ---------------------------------------------------------------------------

const FACILITATOR_RECONNECTING_TEXT = "Facilitator reconnecting…";

const FACILITATOR_RECONNECT_INDICATOR_STYLE = {
  color: "GrayText",
  fontStyle: "italic",
} as const;

export interface FacilitatorReconnectIndicatorProps {
  socket: WebSocket | null;
}

export function FacilitatorReconnectIndicator({ socket }: FacilitatorReconnectIndicatorProps) {
  const facilitatorConnected = useFacilitatorConnectionStatus(socket);

  if (facilitatorConnected) return null;

  return <div role="status" style={FACILITATOR_RECONNECT_INDICATOR_STYLE}>{FACILITATOR_RECONNECTING_TEXT}</div>;
}
