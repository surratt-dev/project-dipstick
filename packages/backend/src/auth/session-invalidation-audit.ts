import type { FastifyRequest } from "fastify";
import { db } from "../db.js";
import { resolveActorGlobalRole } from "../realtime/connection-reauthorization.js";
import { emitAuditEvent } from "./audit-logger.js";
import { withTimeout, AuditWriteTimeoutError, AUDIT_WRITE_TIMEOUT_MS } from "./audit-write-timeout.js";

// ---------------------------------------------------------------------------
// http-auth-audit-log-coverage: design.md Decisions D2, D5, D7.
//
// This module is the single write path for a real `audit_log` row backing
// `auth.session_invalidated`, at all four of its HTTP-side call sites (three
// in middleware.ts's onRequest hook, one in routes/auth.ts's /auth/logout
// handler). It is a new module rather than a helper co-located in
// middleware.ts specifically so routes/auth.ts does not need to import from
// auth/middleware.ts to reach it (architect review, tasks.md 2.3).
//
// `resolveTeamIdForAudit` is deliberately never imported here: team_id is a
// literal NULL in the INSERT below, not a bound parameter fed by any lookup
// (Decision D4/D7) -- every one of these four call sites either has no
// reliable candidate (middleware.ts's onRequest hook) or an ambiguous one
// (auth.ts's logout, where a user can hold more than one active session).
// ---------------------------------------------------------------------------

// AUDIT_WRITE_TIMEOUT_MS, AuditWriteTimeoutError, and withTimeout now live in
// audit-write-timeout.ts (auth-events-audit-log-coverage, design.md Decision
// D2) -- re-exported here so existing importers of this module (including
// this file's own test coverage) are unaffected by the extraction.
export { withTimeout, AuditWriteTimeoutError, AUDIT_WRITE_TIMEOUT_MS };

type SessionInvalidatedReason =
  | "absolute_timeout"
  | "token_revoked"
  | "refresh_failure"
  | "explicit_logout";

/** Only applies to `"token_revoked"` and `"refresh_failure"` (Decision D2). */
type SessionInvalidatedFailureDetail = {
  failureType: "revoked" | "transient";
  retryCount: number;
};

async function writeAuditRow(
  userId: string,
  actorIp: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const actorGlobalRole = await resolveActorGlobalRole(userId);
  await db.query(
    `INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
     VALUES ($1, $2, $3, 'auth.session_invalidated', NULL, $4)`,
    [userId, actorGlobalRole, actorIp, JSON.stringify(metadata)],
  );
}

/**
 * Writes a durable `audit_log` row for one `auth.session_invalidated`
 * emission. Fails open: a DB error or a hang past `AUDIT_WRITE_TIMEOUT_MS`
 * never rethrows and never delays the caller beyond that single bound --
 * the triggering request's 401/logout response proceeds exactly as it would
 * have before this write existed. On any failure, emits the paired
 * `auth.audit_write_failed` detectability signal instead (Decision D5).
 *
 * `metadata`'s `failureType`/`retryCount` are included only for
 * `"token_revoked"`/`"refresh_failure"` -- omit for `"absolute_timeout"` and
 * `"explicit_logout"` (Decision D2).
 */
export async function writeSessionInvalidatedAuditRow(
  userId: string,
  authSessionId: string,
  reason: SessionInvalidatedReason,
  request: FastifyRequest,
  metadata?: SessionInvalidatedFailureDetail,
): Promise<void> {
  const log = request.log;
  const fullMetadata = { reason, authSessionId, ...(metadata ?? {}) };

  try {
    await withTimeout(
      writeAuditRow(userId, request.ip, fullMetadata),
      AUDIT_WRITE_TIMEOUT_MS,
    );
  } catch (err) {
    const failureMode = err instanceof AuditWriteTimeoutError ? "timeout" : "error";
    emitAuditEvent(log, "auth.audit_write_failed", {
      userId,
      authSessionId,
      reason,
      failureMode,
      sourceIp: request.ip,
    });
  }
}
