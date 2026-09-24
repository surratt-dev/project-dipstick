import type { FastifyBaseLogger } from "fastify";
import { db } from "../db.js";
import { emitAuditEvent, type AuditEventName } from "./audit-logger.js";
import { withTimeout, AuditWriteTimeoutError, AUDIT_WRITE_TIMEOUT_MS } from "./audit-write-timeout.js";

// ---------------------------------------------------------------------------
// auth-events-audit-log-coverage: design.md Decision D2.
//
// The fail-open, bounded-timeout write path for the events that have no
// Postgres write anywhere else in their call path to join
// (`auth.success`, `auth.session_created`, `auth.idp_logout_failed`) --
// generalizes session-invalidation-audit.ts's shape (which stays as its own
// module, unchanged, since `auth.session_invalidated` is not in this
// change's scope) into a multi-event write function rather than a third
// hand-copied timeout implementation.
// ---------------------------------------------------------------------------

/**
 * Writes a durable `audit_log` row for one fail-open-group event emission.
 * Fails open: a DB error or a hang past `AUDIT_WRITE_TIMEOUT_MS` never
 * rethrows and never delays the caller beyond that single bound -- the
 * triggering request's response proceeds exactly as it would have before
 * this write existed. On any failure, emits the paired
 * `auth.audit_write_failed` detectability signal instead.
 *
 * `actorGlobalRole` and `teamId` are required, not resolved or defaulted
 * internally -- every caller passes both explicitly. Two of this group's
 * three events (`auth.success`, `auth.session_created`) already have the
 * actor's global_role in scope without a lookup (skipping
 * resolveActorGlobalRole's SELECT entirely for those two); only
 * `auth.idp_logout_failed` needs the lookup, performed by its caller before
 * calling this function. `teamId` is always `null` for every call site in
 * this group -- none of these five has a team concept.
 */
export async function writeFailOpenAuditRow(params: {
  operation: AuditEventName;
  userId: string;
  actorGlobalRole: string;
  actorIp: string;
  teamId: string | null;
  metadata: Record<string, unknown>;
  log: FastifyBaseLogger;
  failureAuditFields: Record<string, unknown>;
}): Promise<void> {
  const { operation, userId, actorGlobalRole, actorIp, teamId, metadata, log, failureAuditFields } =
    params;

  try {
    await withTimeout(
      db.query(
        `INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, actorGlobalRole, actorIp, operation, teamId, JSON.stringify(metadata)],
      ),
      AUDIT_WRITE_TIMEOUT_MS,
    );
  } catch (err) {
    const failureMode = err instanceof AuditWriteTimeoutError ? "timeout" : "error";
    emitAuditEvent(log, "auth.audit_write_failed", {
      ...failureAuditFields,
      failureMode,
      sourceIp: actorIp,
    });
  }
}
