import { useParams } from "react-router-dom";
import { useConnectionHealth } from "../realtime/connectionHealth.js";
import { ConnectionStatusBanner } from "../components/ConnectionStatusBanner.js";
import { FacilitatorReconnectIndicator } from "../components/FacilitatorReconnectIndicator.js";

// ---------------------------------------------------------------------------
// SessionConnectionHost — minimal participant-side host surface
//
// websocket-staleness-signal: design.md Decision D9. The smallest surface
// that mounts ConnectionStatusBanner against a real session WebSocket
// connection — not a feature-complete live-session page. Building the full
// live-session voting UI (topic display, vote casting, reveal countdown,
// results rendering) is explicitly out of scope (design.md Non-Goals); the
// rest of the live-session frontend is tracked separately and is not
// blocked by this change, nor does this change block on it.
//
// session-timeout-continuity (design.md Decision 6): useConnectionHealth is
// now called HERE, not inside ConnectionStatusBanner — the resulting
// `{ state, socket }` is passed down to ConnectionStatusBanner as props, and
// `socket` is also handed to the new FacilitatorReconnectIndicator (design.md
// Decision 5) so it can attach its own `message` listener to the SAME live
// socket rather than opening a second WebSocket connection per participant.
// ---------------------------------------------------------------------------

export function buildSessionWebSocketUrl(sessionId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/sessions/${sessionId}`;
}

export function SessionConnectionHost() {
  const { sessionId } = useParams<{ sessionId: string }>();
  if (!sessionId) return null;

  // A fresh closure on every render is intentional here — it is the exact
  // naive call-site shape Decision D1d's ref-capture is built to tolerate.
  const connect = () => new WebSocket(buildSessionWebSocketUrl(sessionId));
  const { state, socket } = useConnectionHealth(connect);

  return (
    <div data-testid="session-connection-host" style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <ConnectionStatusBanner state={state} socket={socket} />
      <FacilitatorReconnectIndicator socket={socket} />
    </div>
  );
}
