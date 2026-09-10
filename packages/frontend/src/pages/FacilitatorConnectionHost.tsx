import { useParams } from "react-router-dom";
import {
  FacilitatorReadinessGrid,
  type ParticipantRow,
} from "../components/FacilitatorReadinessGrid.js";
import { buildSessionWebSocketUrl } from "./SessionConnectionHost.js";

// ---------------------------------------------------------------------------
// FacilitatorConnectionHost — minimal facilitator-side host surface
//
// websocket-staleness-signal: design.md Decision D9. The smallest surface
// that mounts FacilitatorReadinessGrid against a real session WebSocket
// connection and a stub participant-row list — not a feature-complete
// readiness grid. Building the full live-session voting UI is explicitly
// out of scope (design.md Non-Goals).
//
// KNOWN DEFERRED GAP (implementation-review-architect.md item 2): the route
// this mounts under (/session/:sessionId/facilitator, App.tsx) has no
// client-side facilitator-role check — see the comment on that route for
// the full rationale. Harmless today because this component only ever
// renders STUB_ROWS below; must be revisited before real per-participant
// data is wired in here.
// ---------------------------------------------------------------------------

const STUB_ROWS: ParticipantRow[] = [
  { participantId: "stub-connected-not-locked-in", rowState: "connected-not-locked-in" },
  { participantId: "stub-connected-locked-in", rowState: "connected-locked-in" },
  { participantId: "stub-disconnected-voted", rowState: "disconnected-voted" },
  { participantId: "stub-disconnected-no-vote", rowState: "disconnected-no-vote" },
];

export function FacilitatorConnectionHost() {
  const { sessionId } = useParams<{ sessionId: string }>();
  if (!sessionId) return null;

  // A fresh closure on every render is intentional here — see
  // SessionConnectionHost's identical comment re: Decision D1d.
  const connect = () => new WebSocket(buildSessionWebSocketUrl(sessionId));

  return (
    <div
      data-testid="facilitator-connection-host"
      style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}
    >
      <FacilitatorReadinessGrid connect={connect} rows={STUB_ROWS} />
    </div>
  );
}
