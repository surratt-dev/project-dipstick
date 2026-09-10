import type { WebSocket } from "ws";
import { ABSOLUTE_LIFETIME_MS } from "../auth/middleware.js";

// ---------------------------------------------------------------------------
// Per-pod local connection registry
//
// websocket-delivery-time-authorization: design.md Decision D2 ("Local
// registry lifecycle"), Decision D8 (compensating SEC-25/26 control),
// tasks.md Group 3.
//
// This registry lives entirely in-process, per pod. It is NOT shared across
// pods — that is exactly what the Redis pub/sub channel (ws-pubsub.ts) is
// for. A pod's registry answers one question only: "which of MY locally-held
// sockets are candidates for this sessionId/teamId?" The authorization
// decision for each candidate is made separately, by the caller, at delivery
// time (design.md Decision D3) — this registry does not perform
// authorization itself.
//
// Keyed by sessionId for the three session-scoped events
// (vote_readiness_update, session_state_change, vote_revealed) and by
// teamId for the team-scoped event (topic_history_update). A single socket
// is registered under exactly one scope (session or team), matching this
// change's WebSocket route split (see websocket-route.ts).
// ---------------------------------------------------------------------------

export interface RegisteredConnection {
  readonly socket: WebSocket;
  readonly userId: string;
  /**
   * Captured from request.session.sessionCreatedAt at registration time
   * (Decision D8's compensating control). Epoch milliseconds.
   */
  readonly sessionCreatedAt: number;
  /**
   * Captured from request.session.sessionId at registration time
   * (websocket-connection-reauthorization design.md Decision D3). Named
   * `fastifySessionId`, not a plain `sessionId`, to avoid collision with
   * this object's domain-level session concept (the Zoom/Health-Check
   * session used as the ConnectionRegistry map key) — `conn.sessionId` next
   * to that was a standing misread risk. Lets the WS-side silent-refresh
   * monitor re-fetch current SessionData from the Redis-backed session
   * store by Fastify session id, independent of any live HTTP request.
   */
  readonly fastifySessionId: string;
  /** Handle for the scheduled 90-minute force-close (task 3.6); cleared on deregistration. */
  forceCloseTimer?: ReturnType<typeof setTimeout>;
  /**
   * Handle for the SEC-25/SEC-27 periodic re-authorization sweep
   * (websocket-connection-reauthorization design.md Decision D2); cleared
   * on deregistration.
   */
  reauthSweepTimer?: ReturnType<typeof setInterval>;
  /**
   * Handle for the SEC-26 silent-refresh timer (websocket-connection-
   * reauthorization design.md Decision D3). A SINGLE handle reused across
   * three sequential phases — wait-for-expiry, grace-period (Decision D4),
   * and back to a fresh wait-for-expiry after a successful post-grace
   * reconnect registers. Safe only because each phase's setTimeout is
   * scheduled exclusively from inside the *previous* phase's own fire
   * callback, never while a prior timer for the same connection is still
   * pending — a future change scheduling a new phase from anywhere else
   * would leak the old handle (Engineer Finding 7).
   */
  tokenRefreshTimer?: ReturnType<typeof setTimeout>;
}

type Scope = "session" | "team";

/**
 * Returns true if the connection's absolute lifetime (Decision D8) has been
 * exceeded — the same 90-minute bound authMiddleware already enforces for
 * HTTP requests, reused here because a WebSocket connection has no
 * subsequent HTTP request for that hook to run against.
 */
export function isPastAbsoluteLifetime(conn: Pick<RegisteredConnection, "sessionCreatedAt">): boolean {
  return Date.now() - conn.sessionCreatedAt > ABSOLUTE_LIFETIME_MS;
}

export class ConnectionRegistry {
  private readonly byScope: Record<Scope, Map<string, Set<RegisteredConnection>>> = {
    session: new Map(),
    team: new Map(),
  };

  register(scope: Scope, id: string, conn: RegisteredConnection): void {
    const map = this.byScope[scope];
    let set = map.get(id);
    if (!set) {
      set = new Set();
      map.set(id, set);
    }
    set.add(conn);
  }

  deregister(scope: Scope, id: string, conn: RegisteredConnection): void {
    if (conn.forceCloseTimer) {
      clearTimeout(conn.forceCloseTimer);
      delete conn.forceCloseTimer;
    }
    if (conn.reauthSweepTimer) {
      clearInterval(conn.reauthSweepTimer);
      delete conn.reauthSweepTimer;
    }
    if (conn.tokenRefreshTimer) {
      clearTimeout(conn.tokenRefreshTimer);
      delete conn.tokenRefreshTimer;
    }
    const map = this.byScope[scope];
    const set = map.get(id);
    if (!set) return;
    set.delete(conn);
    if (set.size === 0) {
      map.delete(id);
    }
  }

  /** Local candidate connections for a given sessionId/teamId, on this pod only. */
  candidates(scope: Scope, id: string): RegisteredConnection[] {
    const set = this.byScope[scope].get(id);
    return set ? Array.from(set) : [];
  }

  /** Exposed for tests / diagnostics only. */
  size(scope: Scope): number {
    let total = 0;
    for (const set of this.byScope[scope].values()) {
      total += set.size;
    }
    return total;
  }
}

/**
 * Single per-pod registry instance, analogous to the single `redis` client
 * singleton — every WebSocket route registration and every pub/sub message
 * handler in this process shares the same registry.
 */
export const connectionRegistry = new ConnectionRegistry();

// ---------------------------------------------------------------------------
// Safe send + deregistration (Decision D2's local-registry-lifecycle bullet;
// task 3.5's verification requirement)
//
// Verified empirically (see __tests__/ws-send-readystate.test.ts) against
// the pinned `ws@8.21.x` version (satisfies @fastify/websocket's ^8.16.0):
// ws's `.send()` does NOT throw synchronously when called on a CLOSED
// socket in the no-callback call shape this codebase would otherwise use —
// it silently no-ops. In the callback call shape, it also does not throw
// synchronously; the failure surfaces only via the callback's Error
// argument. This is exactly the non-uniform behavior design.md Decision D2
// named as a possibility to verify rather than assume, and it means a
// try/catch around a bare `.send()` call would NEVER observe a closed
// socket and would never deregister it.
//
// Consequently, `readyState` IS the deregistration trigger this function
// relies on — checked BEFORE every `.send()` call, not after a caught
// exception. The try/catch below is kept only as defensive insurance
// against other synchronous throw conditions `.send()` may have (e.g. a
// serialization error), not as the mechanism this file's correctness
// depends on.
// ---------------------------------------------------------------------------

const OPEN_READY_STATE = 1; // WebSocket.OPEN

/**
 * Attempt to deliver `data` to a single registered connection. Returns
 * true if the send was attempted against an OPEN socket (does not guarantee
 * the remote peer received it — only that this process didn't observe an
 * immediate failure). Returns false — and deregisters the connection from
 * the given scope/id — if the socket was already closed/closing, or if
 * `.send()` threw.
 *
 * This is called once per candidate connection, individually, immediately
 * before the send (design.md Decision D3) — never batched, never cached.
 */
export function safeSend(
  registry: ConnectionRegistry,
  scope: Scope,
  id: string,
  conn: RegisteredConnection,
  data: string,
): boolean {
  if (conn.socket.readyState !== OPEN_READY_STATE) {
    registry.deregister(scope, id, conn);
    return false;
  }

  try {
    conn.socket.send(data);
    return true;
  } catch {
    // A .send() that throws because the socket already closed is treated as
    // an implicit deregistration (design.md Decision D2) — logged by the
    // caller, not raised as an authorization failure.
    registry.deregister(scope, id, conn);
    return false;
  }
}
