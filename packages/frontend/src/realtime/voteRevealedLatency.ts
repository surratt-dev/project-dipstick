import type { WsClientMessage } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// voteRevealedLatency — FR-4.6.1 client obligation
//
// websocket-specification: design.md Decision D2, tasks.md tasks 2.4/2.5.
// On receiving a vote_revealed message, compute
// observed_latency = received_at - serverTimestamp, log it, and report it to
// the backend's existing structured-log surface (POST
// /api/v1/sessions/:sessionId/reveal-latency, wired to emitAuditEvent's
// "session.reveal_latency_observed" — see sessions.ts). No new monitoring
// infrastructure is introduced.
//
// Decision D1e (connectionHealth.ts): useConnectionHealth attaches its own
// listener via addEventListener, never `.onmessage =`, specifically so a
// consumer can attach an independent listener to the same returned socket.
// This module is that consumer — attachVoteRevealedLatencyLogger takes the
// live WebSocket useConnectionHealth returns and layers this behavior on top
// of it, rather than opening a second connection or forking
// useConnectionHealth's own message handling.
// ---------------------------------------------------------------------------

function isVoteRevealedMessage(
  message: WsClientMessage,
): message is Extract<WsClientMessage, { eventType: "vote_revealed" }> {
  return message.eventType === "vote_revealed";
}

/** Pure function, unit-testable independent of any socket/DOM plumbing. */
export function computeObservedLatencyMs(serverTimestamp: string, receivedAtMs: number): number {
  return receivedAtMs - Date.parse(serverTimestamp);
}

/**
 * Best-effort report to the backend's existing structured-log surface. Never
 * throws — a failed report must not disrupt the participant's session.
 */
function reportObservedLatency(sessionId: string, serverTimestamp: string, observedLatencyMs: number): void {
  fetch(`/api/v1/sessions/${sessionId}/reveal-latency`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverTimestamp, observedLatencyMs }),
  }).catch(() => {
    // Best-effort: a lost latency metric is not worth surfacing to the
    // participant or retrying against a live session's request budget.
  });
}

/**
 * Attaches a message listener to `socket` that computes and logs
 * observed_latency for every vote_revealed message received, and reports it
 * to system monitoring via the existing structured-log surface (task 2.5).
 * Returns a cleanup function that removes the listener.
 */
export function attachVoteRevealedLatencyLogger(socket: WebSocket, sessionId: string): () => void {
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
    if (!isVoteRevealedMessage(message)) return;

    const observedLatencyMs = computeObservedLatencyMs(message.serverTimestamp, Date.now());
    // eslint-disable-next-line no-console
    console.info("[reveal-latency] observed_latency_ms", observedLatencyMs, {
      sessionId,
      serverTimestamp: message.serverTimestamp,
    });
    reportObservedLatency(sessionId, message.serverTimestamp, observedLatencyMs);
  }

  socket.addEventListener("message", onMessage);
  return () => socket.removeEventListener("message", onMessage);
}
