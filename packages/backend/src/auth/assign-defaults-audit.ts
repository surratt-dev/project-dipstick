import type { FastifyBaseLogger } from "fastify";
import { emitAuditEvent } from "./audit-logger.js";
import { writeFailOpenTopicAuditRow } from "./fail-open-topic-audit.js";

// ---------------------------------------------------------------------------
// zero-topic-team-recovery (#200) design.md D4 / D9, tasks.md 2.2(d): the two
// narrow seams POST /api/v1/teams/:teamId/topics/assign-defaults calls to
// record a refusal and a failure, and nothing else.
//
// They exist so that the PO fallback is cheap: if ratification declines the
// 403 audit (item 5) or the failure row (item 4), the body of ONE function
// here becomes log-only and the route handler does not change.
//
// Both are fail-open and never throw: the response the caller already
// decided on (403 or 500) is never changed by an audit problem.
// ---------------------------------------------------------------------------

export const ASSIGN_DEFAULTS_ENDPOINT = "POST /api/v1/teams/:teamId/topics/assign-defaults";

/**
 * One fail-open `topic.defaults_assign_denied` row plus its event for a
 * 403 NOT_AN_ADMIN. `teamId` is the id as the caller supplied it (lowercase
 * canonical; it may name no team, there is no foreign key). `correlationId`
 * is the 403 envelope's, so the row joins to the response a user reports.
 *
 * Bounded per actor (D9, auth/denial-audit-limiter.ts): beyond the bound, or
 * when the limiter's store errors, NO row and NO per-denial event are written
 * (that would recreate the flood in the logs); a log-only
 * `topic.denial_audit_suppressed` event is emitted instead, once per window
 * for the bound and on every store error. The response is the 403 either way.
 */
export async function recordDenial(params: {
  log: FastifyBaseLogger;
  actorUserId: string;
  /** null when the caller has no users row; stored as 'unknown'. */
  actorGlobalRole: string | null;
  actorIp: string;
  teamId: string;
  correlationId: string;
}): Promise<void> {
  const { log, actorUserId, actorGlobalRole, actorIp, teamId, correlationId } = params;

  // Imported on use, not at module load: the limiter pulls in the Redis
  // client, and the many unit tests that import routes/topics.ts (and so this
  // module) mock db.js and config.js but not redis.js. They never reach a
  // denial, so none of them builds a Redis client.
  // A failed import is treated like a limiter store error: the denial stays
  // a 403, never a 500.
  let admission: { allowed: true } | { allowed: false; reason: string; firstSuppressed?: boolean; count?: number };
  try {
    const { admitDenialAudit } = await import("./denial-audit-limiter.js");
    admission = await admitDenialAudit(actorUserId);
  } catch {
    admission = { allowed: false, reason: "limiter_error" };
  }
  if (!admission.allowed) {
    if (admission.reason === "limiter_error") {
      emitAuditEvent(log, "topic.denial_audit_suppressed", {
        actorUserId,
        endpoint: ASSIGN_DEFAULTS_ENDPOINT,
        reason: "limiter_error",
      });
    } else if (admission.firstSuppressed) {
      emitAuditEvent(log, "topic.denial_audit_suppressed", {
        actorUserId,
        endpoint: ASSIGN_DEFAULTS_ENDPOINT,
        reason: "limit",
        count: admission.count,
      });
    }
    return;
  }

  const written = await writeFailOpenTopicAuditRow({
    log,
    operation: "topic.defaults_assign_denied",
    endpoint: ASSIGN_DEFAULTS_ENDPOINT,
    httpStatus: 403,
    reason: "NOT_AN_ADMIN",
    actorUserId,
    actorGlobalRole,
    actorIp,
    teamId,
    extraMetadata: { correlation_id: correlationId },
  });
  emitAuditEvent(log, "topic.defaults_assign_denied", {
    actorUserId,
    actorGlobalRole: actorGlobalRole ?? "unknown",
    actorIp,
    teamId,
    endpoint: ASSIGN_DEFAULTS_ENDPOINT,
    httpStatus: 403,
    reason: "NOT_AN_ADMIN",
    correlationId,
    actorRoles: written.actorRoles,
    rowWritten: written.rowWritten,
  });
}

/**
 * One fail-open `topic.defaults_assign_failed` row plus its event for the
 * empty-template 500. Called AFTER the ROLLBACK, on a separate statement on
 * the pool, so the row survives the rollback and does not resurrect any of
 * the rolled-back work. No template id and no topic text, here or in the row.
 */
export async function recordFailure(params: {
  log: FastifyBaseLogger;
  actorUserId: string;
  actorGlobalRole: string;
  actorIp: string;
  teamId: string;
  reason: "DEFAULT_TOPICS_UNAVAILABLE";
  correlationId: string;
}): Promise<void> {
  const { log, actorUserId, actorGlobalRole, actorIp, teamId, reason, correlationId } = params;
  const written = await writeFailOpenTopicAuditRow({
    log,
    operation: "topic.defaults_assign_failed",
    endpoint: ASSIGN_DEFAULTS_ENDPOINT,
    httpStatus: 500,
    reason,
    actorUserId,
    actorGlobalRole,
    actorIp,
    teamId,
    extraMetadata: { correlation_id: correlationId },
  });
  emitAuditEvent(log, "topic.defaults_assign_failed", {
    actorUserId,
    actorGlobalRole,
    actorIp,
    teamId,
    endpoint: ASSIGN_DEFAULTS_ENDPOINT,
    httpStatus: 500,
    reason,
    correlationId,
    rowWritten: written.rowWritten,
  });
}
