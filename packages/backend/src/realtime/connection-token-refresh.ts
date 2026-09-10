import type { FastifyBaseLogger } from "fastify";
import { REAUTH_GRACE_EXPIRED_CLOSE_CODE } from "@dipstick/shared";
import { redis } from "../redis.js";
import { db } from "../db.js";
import {
  refreshSessionTokens,
  TOKEN_REFRESH_THRESHOLD_S,
} from "../auth/middleware.js";
import { conditionallyUpdateSession, getSessionDataById } from "../auth/session-store.js";
import { emitAuditEvent } from "../auth/audit-logger.js";
import { safeSend, type ConnectionRegistry, type RegisteredConnection } from "./connection-registry.js";
import { resolveActorGlobalRole, resolveTeamIdForAudit } from "./connection-reauthorization.js";

// ---------------------------------------------------------------------------
// SEC-26 — Silent token refresh + grace-period hygiene bound
//
// websocket-connection-reauthorization: design.md Decisions D3, D3a, D3b,
// D3c, D4, D9. tasks.md Groups 3, 4, and the marker-consumption/audit half
// of Group 5 (5.1) — implemented together per those groups' own
// coordination notes, since they share this one file and a single
// registration-time call site.
//
// REBUILT DESIGN (not the original): grace-period recovery is NEVER an
// in-place resume of the original connection. auth.ts's /auth/callback
// calls request.session.regenerate() on every login, and this app's
// re-authentication is a full top-level page navigation that tears down
// any open WebSocket before the identity provider is even reached — there
// is no "same connection" to recover. The grace timer below is a pure
// server-side hygiene bound; recovery is always the client's next, fresh
// connection, correlated via a short-lived Redis marker for diagnostic-
// trail purposes only (Decision D4).
// ---------------------------------------------------------------------------

/**
 * New, distinct close code (design.md Decision D5) — never reused by
 * connection-reauthorization.ts or staleness-signal.ts.
 *
 * Relocated to @dipstick/shared (websocket-staleness-signal design.md
 * Decision D1b) so the frontend can import it without depending on
 * @dipstick/backend. Imported above and re-exported here, under its
 * original name, so every existing backend import site (`from
 * "./connection-token-refresh.js"`) keeps working unchanged.
 */
export { REAUTH_GRACE_EXPIRED_CLOSE_CODE };

// Not configurable (design.md Decision D9a).
const GRACE_PERIOD_MS = 30 * 1000;

type Scope = "session" | "team";

const GRACE_MARKER_PREFIX = "dipstick:reauth-grace:";

/**
 * Decision D3b: WS-triggered SEC-26 revocation/exhausted-retry events get
 * explicit audit_log coverage, not only the emitAuditEvent structured-log
 * call refreshSessionTokens already makes. Never includes token values
 * (SEC-16/SEC-22).
 */
async function recordRefreshFailureAudit(
  conn: RegisteredConnection,
  scope: Scope,
  id: string,
  failureType: "revoked" | "transient_failure" | "session_destroyed_concurrently",
  log: FastifyBaseLogger,
): Promise<void> {
  const [actorGlobalRole, teamId] = await Promise.all([
    resolveActorGlobalRole(conn.userId),
    resolveTeamIdForAudit(scope, id),
  ]);

  await writeAuditLogRow(conn.userId, actorGlobalRole, teamId, "session.token_refresh_failed_live", {
    scope,
    scopeId: id,
    failureType,
  });

  emitAuditEvent(log, "session.token_refresh_failed_live", {
    actorUserId: conn.userId,
    actorGlobalRole,
    scope,
    scopeId: id,
    teamId,
    failureType,
  });
}

/**
 * Decision D9: the reconnect-diagnostic audit write, performed at the exact
 * point Decision D4's grace-period correlation marker is consumed
 * (websocket-routes.ts's registration handler, task 4.4) — implemented here
 * because that is also where the marker itself is written/read from.
 */
export async function recordConnectionRecoveredAudit(
  userId: string,
  scope: Scope,
  id: string,
  log: FastifyBaseLogger,
): Promise<void> {
  const [actorGlobalRole, teamId] = await Promise.all([
    resolveActorGlobalRole(userId),
    resolveTeamIdForAudit(scope, id),
  ]);

  await writeAuditLogRow(userId, actorGlobalRole, teamId, "session.connection_recovered", {
    scope,
    scopeId: id,
  });

  emitAuditEvent(log, "session.connection_recovered", {
    actorUserId: userId,
    actorGlobalRole,
    scope,
    scopeId: id,
    teamId,
  });
}

// Small shared insert helper — both audit operations above use the identical
// field shape (actor_user_id, actor_global_role, actor_ip: NULL — no live
// HTTP request to source an IP from these background/registration-time call
// sites — operation, team_id, metadata).
async function writeAuditLogRow(
  actorUserId: string,
  actorGlobalRole: string,
  teamId: string | null,
  operation: "session.token_refresh_failed_live" | "session.connection_recovered",
  metadata: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
     VALUES ($1, $2, NULL, $3, $4, $5)`,
    [actorUserId, actorGlobalRole, operation, teamId, JSON.stringify(metadata)],
  );
}

/**
 * Decision D4: starts the grace period. Writes the correlation marker
 * BEFORE sending reauth_required, so an unusually fast client reconnect can
 * never race past the marker's existence. Starts the hygiene-bound timer,
 * which unconditionally closes the connection on expiry with no re-read of
 * any session state — recovery, if it happens, is carried entirely by the
 * client's next connection (see websocket-routes.ts's registration
 * handler), never by this connection resuming.
 */
async function startGracePeriod(
  conn: RegisteredConnection,
  scope: Scope,
  id: string,
  registry: ConnectionRegistry,
): Promise<void> {
  await redis.setex(
    GRACE_MARKER_PREFIX + conn.userId,
    Math.ceil(GRACE_PERIOD_MS / 1000),
    JSON.stringify({ startedAt: new Date().toISOString() }),
  );

  // Decision D5: a disclosed signal, sent from THIS module only — never the
  // same function connection-reauthorization.ts uses for
  // STALE_SIGNAL_CLOSE_CODE. Uses safeSend (not a bare .send()) so a socket
  // that already closed is deregistered here rather than left dangling.
  safeSend(registry, scope, id, conn, JSON.stringify({ eventType: "reauth_required" }));

  conn.tokenRefreshTimer = setTimeout(() => {
    registry.deregister(scope, id, conn);
    if (conn.socket.readyState === conn.socket.OPEN) {
      conn.socket.close(REAUTH_GRACE_EXPIRED_CLOSE_CODE);
    }
  }, GRACE_PERIOD_MS);
}

function scheduleNextCheck(
  conn: RegisteredConnection,
  scope: Scope,
  id: string,
  registry: ConnectionRegistry,
  log: FastifyBaseLogger,
  tokenExpiresAt: number,
): void {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const delayMs = Math.max((tokenExpiresAt - TOKEN_REFRESH_THRESHOLD_S - nowSeconds) * 1000, 0);
  conn.tokenRefreshTimer = setTimeout(() => {
    void runRefreshCheck(conn, scope, id, registry, log);
  }, delayMs);
}

async function runRefreshCheck(
  conn: RegisteredConnection,
  scope: Scope,
  id: string,
  registry: ConnectionRegistry,
  log: FastifyBaseLogger,
): Promise<void> {
  const session = await getSessionDataById(conn.fastifySessionId);
  if (!session) {
    await recordRefreshFailureAudit(conn, scope, id, "session_destroyed_concurrently", log);
    await startGracePeriod(conn, scope, id, registry);
    return;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (session.tokenExpiresAt - nowSeconds >= TOKEN_REFRESH_THRESHOLD_S) {
    // Already healthy — an HTTP request refreshed it independently since
    // this timer was scheduled. Reschedule against the current
    // tokenExpiresAt, skipping a redundant OIDC round-trip. This re-check
    // is also the adopted mitigation for Decision D3c's refresh-token-
    // rotation race: it catches the common case before this timer ever
    // presents an already-consumed refresh token to the IdP.
    scheduleNextCheck(conn, scope, id, registry, log, session.tokenExpiresAt);
    return;
  }

  const result = await refreshSessionTokens(session, conn.fastifySessionId, log, "websocket");

  switch (result.status) {
    case "refreshed": {
      // Decision D3a: conditional write only — never the generic
      // unconditional set(). A false return means the session was
      // destroyed elsewhere between our read and this write; treat that
      // identically to "revoked", never retry, never fall back.
      const wrote = await conditionallyUpdateSession(conn.fastifySessionId, result.session);
      if (!wrote) {
        await recordRefreshFailureAudit(conn, scope, id, "session_destroyed_concurrently", log);
        await startGracePeriod(conn, scope, id, registry);
        return;
      }
      scheduleNextCheck(conn, scope, id, registry, log, result.session.tokenExpiresAt);
      return;
    }
    case "revoked":
      await recordRefreshFailureAudit(conn, scope, id, "revoked", log);
      await startGracePeriod(conn, scope, id, registry);
      return;
    case "transient_failure":
      await recordRefreshFailureAudit(conn, scope, id, "transient_failure", log);
      await startGracePeriod(conn, scope, id, registry);
      return;
    case "no_refresh_token":
      // Matches the HTTP path's existing behavior: not a failure, proceed
      // on the existing token, reschedule at the same cadence.
      scheduleNextCheck(conn, scope, id, registry, log, session.tokenExpiresAt);
      return;
  }
}

/**
 * Starts the SEC-26 silent-refresh monitor for a single connection, at
 * registration time. The handle lives on conn.tokenRefreshTimer, reused
 * across the wait-for-expiry and grace-period phases (see the invariant
 * documented on that field in connection-registry.ts) and cleared by
 * ConnectionRegistry.deregister().
 */
export function scheduleTokenRefreshMonitor(
  conn: RegisteredConnection,
  scope: Scope,
  id: string,
  registry: ConnectionRegistry,
  log: FastifyBaseLogger,
): void {
  void (async () => {
    const session = await getSessionDataById(conn.fastifySessionId);
    if (!session) return;
    scheduleNextCheck(conn, scope, id, registry, log, session.tokenExpiresAt);
  })();
}

/**
 * Decision D4/D9: called at WS registration time (websocket-routes.ts) to
 * check for and atomically consume a live grace-period correlation marker
 * for the connecting user. A single Redis DEL both checks existence and
 * deletes in one atomic step — no separate GET-then-DEL race window.
 */
export async function consumeGraceRecoveryMarker(userId: string): Promise<boolean> {
  const deletedCount = await redis.del(GRACE_MARKER_PREFIX + userId);
  return deletedCount > 0;
}
