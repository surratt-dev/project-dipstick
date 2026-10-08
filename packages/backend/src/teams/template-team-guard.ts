import type { FastifyBaseLogger } from "fastify";
import { db } from "../db.js";
import { emitAuditEvent } from "../auth/audit-logger.js";
import { withTimeout, AuditWriteTimeoutError, AUDIT_WRITE_TIMEOUT_MS } from "../auth/audit-write-timeout.js";
import { DEFAULT_TOPICS_TEAM_ID } from "../sessions/default-topics.js";

// ---------------------------------------------------------------------------
// Template-team guard — template-team-not-usable (#214), design.md D2/D2a.
//
// The __default_topics__ template team (DEFAULT_TOPICS_TEAM_ID) holds the
// canonical default topics and is not a team. It is never the subject of a
// session, a membership or a join link (specs/default-topic-provisioning).
// Each guarded route calls isTemplateTeam at the point design.md D3 names and
// then sends ITS OWN missing-team (or missing-session, or unknown-token)
// response, after writeTemplateAccessDenial. Never a preHandler: that would
// run before authorization and turn a 401/403 into the template answer.
//
// The database backstop (migration 23's <table>_not_template_team CHECKs)
// lives in template-constraint-violation.ts, deliberately separate (D1).
//
// Reads no configuration and no environment variable, on purpose: nothing
// can enable the template as a subject (default-topic-provisioning "No
// configuration enables the template team"). A source-inspection test
// (teams/__tests__/template-team-guard-source.test.ts) keeps it that way.
// #188's checkWritableTeam (routes/topics.ts) is separate and unchanged.
// ---------------------------------------------------------------------------

const TEMPLATE_HEX = DEFAULT_TOPICS_TEAM_ID.replace(/-/g, "").toLowerCase();

/**
 * True when `id` names the template team in any spelling Postgres's `uuid`
 * input would read as DEFAULT_TOPICS_TEAM_ID: canonical, upper case, no
 * hyphens, other hyphen groupings, one enclosing `{...}` pair (D2). It
 * compares the value, not the string, because several guarded routes pass
 * the raw path value to SQL. It also accepts a few strings Postgres would
 * reject; those are still only spellings of the template, so erring that way
 * is safe. It never matches a real team. Non-strings are never the template.
 */
export function isTemplateTeam(id: unknown): boolean {
  if (typeof id !== "string") return false;
  let value = id;
  if (value.startsWith("{") && value.endsWith("}")) value = value.slice(1, -1);
  return value.replace(/-/g, "").toLowerCase() === TEMPLATE_HEX;
}

export type TemplateDenialSurface = "session" | "membership" | "join_link";

const OPERATION = "team.template_access_denied";

// D2a: at most one durable row per (actor, endpoint) per minute. Any
// authenticated user reaches the guard on the session sub-routes and on
// join-link creation, with no rate limit in front, while the missing-session
// path they mimic writes nothing. The existing sliding-window limiter is not
// reused: its importers are allow-listed, and a 429 would break parity.
export const TEMPLATE_DENIAL_DEDUPE_WINDOW_MS = 60_000;

/** The D2a Redis key. Exported so tests can clear it before each request. */
export function templateDenialDedupeKey(actorUserId: string, endpoint: string): string {
  // The repo's "dipstick:" Redis namespace (security implementation review F3).
  return `dipstick:template-denial:${actorUserId}:${endpoint}`;
}

/**
 * Claims the (actor, endpoint) slot for the current window. True when this
 * refusal should write its row: the slot was free, or Redis errored (a Redis
 * failure is not attacker-controlled, and the insert is still time-bounded).
 */
/**
 * Releases a claimed slot whose row was NOT written (security implementation
 * review F1), so a failed or timed-out insert does not suppress the next
 * refusal's row for the rest of the window. Best effort: never throws, and is
 * not awaited by the caller's response path beyond this call.
 */
async function releaseDedupeSlot(actorUserId: string, endpoint: string): Promise<void> {
  try {
    const { redis } = await import("../redis.js");
    await redis.del(templateDenialDedupeKey(actorUserId, endpoint));
  } catch {
    // A slot that cannot be released expires with the window.
  }
}

async function claimDedupeSlot(actorUserId: string, endpoint: string): Promise<boolean> {
  try {
    // Imported on first use, not at module load: every route plugin imports
    // this module, and route unit tests (which mock db.js but not redis.js)
    // would otherwise each open an ioredis client against their fake
    // REDIS_URL. Only a template refusal with an actor reaches this line.
    const { redis } = await import("../redis.js");
    const result = await redis.set(
      templateDenialDedupeKey(actorUserId, endpoint),
      "1",
      "PX",
      TEMPLATE_DENIAL_DEDUPE_WINDOW_MS,
      "NX",
    );
    return result === "OK";
  } catch {
    return true;
  }
}

/**
 * Records one template refusal (D2). Fail-open: it never throws and never
 * changes the response.
 *
 * Takes primitives, not a request, because executeJoinFlow (auth.ts) has no
 * request object. Always emits the `team.template_access_denied` structured
 * event. Writes an `audit_log` row with `metadata = { endpoint, surface }`
 * only, except: no row for a null actor (a logged-out redemption; the columns
 * are NOT NULL and there is no actor, so the event is the record), and no row
 * when the D2a bound has already written one for this actor and endpoint in
 * the last minute (the event then carries `audit_row_suppressed: true`).
 *
 * When `actorGlobalRole` is not supplied, it is read from `users` (never a
 * placeholder). The role lookup, the Redis claim and the insert are bounded
 * together by AUDIT_WRITE_TIMEOUT_MS. The slot is claimed before the insert
 * (so concurrent refusals cannot both write) and released again if the
 * insert fails or times out, so a lost row never suppresses the next one. Any failure is logged with
 * `audit_write_failed: true` and the database error's code and message only.
 */
export async function writeTemplateAccessDenial(params: {
  actorUserId: string | null;
  actorGlobalRole?: string;
  actorIp: string;
  log: FastifyBaseLogger;
  endpoint: string;
  surface: TemplateDenialSurface;
  correlationId?: string;
}): Promise<void> {
  const { actorUserId, actorIp, log, endpoint, surface, correlationId } = params;
  let actorGlobalRole = params.actorGlobalRole;
  let auditRowWritten = false;
  let auditRowSuppressed = false;
  let slotClaimed = false;

  if (actorUserId !== null) {
    try {
      await withTimeout(
        (async () => {
          if (actorGlobalRole === undefined) {
            const roleResult = await db.query<{ global_role: string }>(
              `SELECT global_role FROM users WHERE id = $1`,
              [actorUserId],
            );
            const role = roleResult.rows[0]?.global_role;
            if (!role) throw new Error("actor has no users row");
            actorGlobalRole = role;
          }
          if (!(await claimDedupeSlot(actorUserId, endpoint))) {
            auditRowSuppressed = true;
            return;
          }
          slotClaimed = true;
          await db.query(
            `INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [actorUserId, actorGlobalRole, actorIp, OPERATION, DEFAULT_TOPICS_TEAM_ID, JSON.stringify({ endpoint, surface })],
          );
          auditRowWritten = true;
        })(),
        AUDIT_WRITE_TIMEOUT_MS,
      );
    } catch (err) {
      // Code and message only: never the raw error object, its detail or its
      // parameters. Every bound value is already in the event below.
      const dbError = err as { code?: unknown; message?: unknown };
      log.error(
        {
          audit_write_failed: true,
          operation: OPERATION,
          correlationId,
          failureMode: err instanceof AuditWriteTimeoutError ? "timeout" : "error",
          dbErrorCode: dbError.code,
          dbErrorMessage: dbError.message,
        },
        `${OPERATION} audit insert failed`,
      );
      if (slotClaimed && !auditRowWritten) void releaseDedupeSlot(actorUserId, endpoint);
    }
  }

  emitAuditEvent(log, OPERATION, {
    actorUserId,
    ...(actorGlobalRole !== undefined ? { actorGlobalRole } : {}),
    actorIp,
    teamId: DEFAULT_TOPICS_TEAM_ID,
    endpoint,
    surface,
    ...(correlationId !== undefined ? { correlationId } : {}),
    auditRowWritten,
    ...(auditRowSuppressed ? { audit_row_suppressed: true } : {}),
  });
}
