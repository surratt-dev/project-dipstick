import type { FastifyBaseLogger } from "fastify";
import { emitAuditEvent } from "./audit-logger.js";
import { writeFailOpenTopicAuditRow } from "./fail-open-topic-audit.js";

// ---------------------------------------------------------------------------
// admin-default-topic-maintenance (#216) design.md E2: the denial-audit seam
// for the /api/v1/admin/default-topics family.
//
// A thin, PARAMETERIZED sibling of auth/assign-defaults-audit.ts (that module
// hard-codes its endpoint label in its log events): it reuses admitDenialAudit
// for the per-actor bound and writeFailOpenTopicAuditRow for the row, and adds
// only what differs -- team_id NULL, metadata holding the method and the
// route TEMPLATE (never the raw URL, a body or an id), and a running
// suppressed count.
//
// Fail-open and never throws: the 403 the caller already decided on is never
// changed by an audit problem. Known blind spot, accepted and recorded: when
// the limiter store errors, no row and no per-denial event is written, so
// denial auditing for this family is blind during a Redis outage. One log
// event per actor per window makes that blindness itself visible.
// ---------------------------------------------------------------------------

/** The route-family label carried by this seam's log-only suppression events. */
export const ADMIN_DEFAULT_TOPICS_FAMILY = "/api/v1/admin/default-topics";

/** In-process memory of the last limiter_error event per actor (once per window). */
const lastLimiterErrorEventMs = new Map<string, number>();
const LIMITER_ERROR_WINDOW_MS = 60_000;

/** Test seam only: forget which actors already logged a limiter error. */
export function resetLimiterErrorMemory(): void {
  lastLimiterErrorEventMs.clear();
}

/** A running suppressed count is logged at counts 1, 2, 4, 8, ... so a burst is distinguishable from a trickle without recreating the flood. */
function shouldLogSuppressedCount(suppressed: number): boolean {
  return suppressed >= 1 && (suppressed & (suppressed - 1)) === 0;
}

export async function recordMaintenanceDenial(params: {
  log: FastifyBaseLogger;
  actorUserId: string;
  /** null when the caller has no users row; stored as 'unknown'. */
  actorGlobalRole: string | null;
  actorIp: string;
  /** e.g. "PATCH". */
  method: string;
  /** The route TEMPLATE, e.g. "/api/v1/admin/default-topics/:topicId". Never the raw URL. */
  routeTemplate: string;
  correlationId: string;
  nowMs?: number;
}): Promise<void> {
  const { log, actorUserId, actorGlobalRole, actorIp, method, routeTemplate, correlationId } = params;
  const nowMs = params.nowMs ?? Date.now();
  const endpoint = `${method} ${routeTemplate}`;

  // Imported on use for the same reason as assign-defaults-audit: the limiter
  // pulls in the Redis client, and unit tests that import a route module do
  // not build one unless a denial actually happens. A failed import is treated
  // like a limiter store error.
  let admission: { allowed: true } | { allowed: false; reason: string; count?: number };
  try {
    const { admitDenialAudit, DENIAL_AUDIT_LIMIT } = await import("./denial-audit-limiter.js");
    const result = await admitDenialAudit(actorUserId);
    admission =
      result.allowed || result.reason !== "limit"
        ? result
        : { allowed: false, reason: "limit", count: result.count - DENIAL_AUDIT_LIMIT.limit };
  } catch {
    admission = { allowed: false, reason: "limiter_error" };
  }

  if (!admission.allowed) {
    if (admission.reason === "limiter_error") {
      const last = lastLimiterErrorEventMs.get(actorUserId);
      if (last === undefined || nowMs - last >= LIMITER_ERROR_WINDOW_MS) {
        lastLimiterErrorEventMs.set(actorUserId, nowMs);
        emitAuditEvent(log, "topic.denial_audit_suppressed", {
          actorUserId,
          family: ADMIN_DEFAULT_TOPICS_FAMILY,
          reason: "limiter_error",
        });
      }
    } else if (admission.count !== undefined && shouldLogSuppressedCount(admission.count)) {
      emitAuditEvent(log, "topic.denial_audit_suppressed", {
        actorUserId,
        family: ADMIN_DEFAULT_TOPICS_FAMILY,
        reason: "limit",
        suppressedCount: admission.count,
      });
    }
    return;
  }

  const written = await writeFailOpenTopicAuditRow({
    log,
    operation: "topic.default_maintenance_denied",
    endpoint,
    httpStatus: 403,
    reason: "DEFAULT_MAINTENANCE_ADMIN_ONLY",
    actorUserId,
    actorGlobalRole,
    actorIp,
    teamId: null,
    extraMetadata: { correlation_id: correlationId },
  });
  emitAuditEvent(log, "topic.default_maintenance_denied", {
    actorUserId,
    actorGlobalRole: actorGlobalRole ?? "unknown",
    actorIp,
    endpoint,
    httpStatus: 403,
    reason: "DEFAULT_MAINTENANCE_ADMIN_ONLY",
    correlationId,
    actorRoles: written.actorRoles,
    rowWritten: written.rowWritten,
  });
}
