import { useEffect, useState } from "react";
import type { WsClientMessage } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// useFacilitatorConnectionStatus — facilitator-reconnect-indicator (session-
// timeout-continuity design.md Decision 5's "Client-side" paragraph, and
// Decision 6, which is what gives this module a socket to listen on).
//
// A small, single-purpose sibling to connectionHealth.ts's state machine —
// NOT a fork or extension of it (design.md Decision 5: "It does not touch
// connectionHealth.ts's own state machine, since it is not reporting on
// *this client's* connection"). connectionHealth.ts's own switch/state model
// is left completely untouched by this module.
//
// Subscribes to the facilitator_connection_status event on the SAME live
// socket connectionHealth.ts's useConnectionHealth hook already owns
// (lifted to SessionConnectionHost by Decision 6), via addEventListener —
// composing with, never replacing, any other listener already attached to
// that socket (the same discipline useConnectionHealth's own message
// listener follows).
//
// Exposes exactly one bit: whether the facilitator is currently reported
// connected. Defaults to true (no indicator shown) until a message is
// actually received, and resets to true whenever the socket instance itself
// changes — this participant's own knowledge of the facilitator's
// connection is only as fresh as what arrives on their current connection,
// so a stale "disconnected" reading should not survive this participant's
// own reconnect.
// ---------------------------------------------------------------------------

export function useFacilitatorConnectionStatus(socket: WebSocket | null): boolean {
  const [facilitatorConnected, setFacilitatorConnected] = useState(true);

  useEffect(() => {
    setFacilitatorConnected(true);
    if (!socket) return;

    function onMessage(event: MessageEvent): void {
      let parsed: unknown;
      try {
        parsed = typeof event.data === "string" ? JSON.parse(event.data) : null;
      } catch {
        return;
      }
      if (parsed === null || typeof parsed !== "object" || !("eventType" in parsed)) {
        return;
      }

      const message = parsed as WsClientMessage;
      if (message.eventType === "facilitator_connection_status") {
        setFacilitatorConnected(message.payload.connected);
      }
    }

    socket.addEventListener("message", onMessage);
    return () => {
      socket.removeEventListener("message", onMessage);
    };
  }, [socket]);

  return facilitatorConnected;
}
