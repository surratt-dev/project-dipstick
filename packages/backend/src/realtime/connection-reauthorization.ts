import { db } from "../db.js";
import { evaluateSessionSubscriberAccess } from "../auth/session-subscriber-access-helper.js";
import { evaluateTeamAccess } from "../auth/team-content-access-helper.js";
import { emitAuditEvent } from "../auth/audit-logger.js";
import { STALE_SIGNAL_CLOSE_CODE } from "./staleness-signal.js";
import type { ConnectionRegistry, RegisteredConnection } from "./connection-registry.js";
import type { FastifyBaseLogger } from "fastify";

// ---------------------------------------------------------------------------
// SEC-25/SEC-27 — Periodic per-connection re-authorization sweep
//
// websocket-connection-reauthorization: design.md Decision D2, tasks.md
// Group 2.
//
// A sibling to websocket-routes.ts's scheduleForceClose: one timer per
// connection, cleared on deregister, no new authorization logic. Reuses
// evaluateSessionSubscriberAccess/evaluateTeamAccess verbatim — the exact
// same functions delivery-time authorization already calls — so there is
// no third implementation of "is this user still authorized."
//
// Not configurable (design.md Decision D9a): REAUTHORIZATION_INTERVAL_MS is
// a module-local constant, never read from environment or an admin setting.
// ---------------------------------------------------------------------------

export const REAUTHORIZATION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

type Scope = "session" | "team";

/**
 * Resolves the team id an audit_log row's `team_id` column should carry for
 * this scope: the team id directly for a team-scoped connection, or the
 * owning session's team id for a session-scoped one (design.md Decision D2).
 *
 * Exported for reuse by connection-token-refresh.ts's own audit writes
 * (Decisions D3b/D9) — one implementation of this lookup, not a third.
 */
export async function resolveTeamIdForAudit(scope: Scope, id: string): Promise<string | null> {
  if (scope === "team") {
    return id;
  }
  const result = await db.query<{ team_id: string }>(
    `SELECT team_id FROM sessions WHERE id = $1`,
    [id],
  );
  return (result.rows[0] as { team_id: string } | undefined)?.team_id ?? null;
}

/** Exported for reuse by connection-token-refresh.ts's own audit writes. */
export async function resolveActorGlobalRole(userId: string): Promise<string> {
  const result = await db.query<{ global_role: string }>(
    `SELECT global_role FROM users WHERE id = $1`,
    [userId],
  );
  return (result.rows[0] as { global_role: string } | undefined)?.global_role ?? "unknown";
}

/**
 * Runs one sweep check for a single connection: session-scoped connections
 * are re-evaluated via evaluateSessionSubscriberAccess; team-scoped
 * connections via evaluateTeamAccess, additionally rejecting an admin-path
 * grant — matching topic_history_update's existing delivery-time rule
 * (design.md Decision D2). Returns true if the connection is still
 * authorized (left untouched); false if it was closed and deregistered.
 */
async function runSweepCheck(
  conn: RegisteredConnection,
  scope: Scope,
  id: string,
  registry: ConnectionRegistry,
  log: FastifyBaseLogger,
): Promise<boolean> {
  let authorized: boolean;

  if (scope === "session") {
    const grant = await evaluateSessionSubscriberAccess(conn.userId, id);
    authorized = grant !== null;
  } else {
    const grant = await evaluateTeamAccess(conn.userId, id);
    authorized = grant !== null && grant.path !== "admin";
  }

  if (authorized) {
    return true;
  }

  // Added in this revision (Security Analyst Finding 3, design.md Decision
  // D2): a SEC-25 revocation close is a genuine, security-relevant event —
  // written as a real audit_log row, not only the emitAuditEvent structured
  // log this design's first draft relied on alone.
  const actorGlobalRole = await resolveActorGlobalRole(conn.userId);
  const teamId = await resolveTeamIdForAudit(scope, id);

  await db.query(
    `INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
     VALUES ($1, $2, NULL, 'session.access_revoked_live', $3, $4)`,
    [conn.userId, actorGlobalRole, teamId, JSON.stringify({ scope, scopeId: id })],
  );

  emitAuditEvent(log, "session.access_revoked_live", {
    actorUserId: conn.userId,
    actorGlobalRole,
    scope,
    scopeId: id,
    teamId,
  });

  registry.deregister(scope, id, conn);
  if (conn.socket.readyState === conn.socket.OPEN) {
    conn.socket.close(STALE_SIGNAL_CLOSE_CODE);
  }

  return false;
}

/**
 * Starts the periodic re-authorization sweep for a single connection. The
 * handle is stored on conn.reauthSweepTimer and cleared by
 * ConnectionRegistry.deregister() — callers never clear it directly.
 */
export function scheduleReauthorizationSweep(
  conn: RegisteredConnection,
  scope: Scope,
  id: string,
  registry: ConnectionRegistry,
  log: FastifyBaseLogger,
): void {
  conn.reauthSweepTimer = setInterval(() => {
    void runSweepCheck(conn, scope, id, registry, log);
  }, REAUTHORIZATION_INTERVAL_MS);
}
