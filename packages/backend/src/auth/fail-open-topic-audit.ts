import type { FastifyBaseLogger } from "fastify";
import { db } from "../db.js";
import { emitAuditEvent, type AuditEventName } from "./audit-logger.js";
import { AUDIT_WRITE_TIMEOUT_MS, AuditWriteTimeoutError, withTimeout } from "./audit-write-timeout.js";

// ---------------------------------------------------------------------------
// zero-topic-team-recovery (#200) design.md D9 / tasks.md 2.2: the fail-open
// topic audit insert, extracted from routes/content.ts (#264), where it was
// module-private and hard-wired to TOPIC-002. TOPIC-002's non-admin denial
// row and assign-defaults' denial and empty-template failure rows now share
// this one implementation, so the SQL cast rules cannot fork.
//
// FAIL-OPEN on the response: what is audited is a refusal or a failure the
// caller already receives, not a disclosure, so a failed insert never changes
// the response. The try/catch below wraps ONLY the insert; anything else on
// the caller's path that throws is still a 500. The administrator read arm
// of TOPIC-002 stays fail-closed and is not part of this module.
// ---------------------------------------------------------------------------

/**
 * Constant SQL text, numbered placeholders only (no request data is ever
 * interpolated). Every parameter carries an explicit cast: in an
 * INSERT ... SELECT a bare parameter gets no type inference from the target
 * column (unlike VALUES) and would resolve as text, so the insert would fail
 * every time against the UUID / INET / JSONB columns. Fail-open would hide
 * that behind a stream of topic.audit_write_failed events, so the real
 * Postgres integration tests are mandatory for every caller. The caller's
 * role set is read inside the insert (LEFT JOIN users): a missing users row
 * gives actor_roles = NULL, not a failure, and there is exactly one query and
 * one timeout.
 */
export const FAIL_OPEN_TOPIC_AUDIT_INSERT_SQL = `INSERT INTO audit_log
       (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata, actor_roles)
     SELECT $1::uuid, $2::text, $3::inet, $4::text, $5::uuid, $6::jsonb, u.roles::text[]
     FROM (SELECT 1) s LEFT JOIN users u ON u.id = $1::uuid
     RETURNING actor_roles`;

/**
 * The pg SQLSTATE of a thrown value, or null. The one place the "SQLSTATE
 * only, never err.message / err.detail" rule lives (#264 D3): message and
 * detail can echo row values.
 */
export function sqlstateOf(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

export interface FailOpenTopicAuditArgs {
  log: FastifyBaseLogger;
  operation: AuditEventName;
  endpoint: string;
  /** The HTTP status the caller answers with; stored in metadata.http_status. */
  httpStatus: number;
  /** A stable reason code, stored in metadata.reason. */
  reason: string;
  actorUserId: string;
  /** null (no users row) is stored as 'unknown', the existing convention. */
  actorGlobalRole: string | null;
  actorIp: string;
  /** The requested id as validated; NOT a verified team (no foreign key). */
  teamId: string;
  /**
   * Further metadata keys, after endpoint / http_status / reason. Counts, ids
   * and correlation ids only -- never topic text or the template id.
   */
  extraMetadata?: Readonly<Record<string, unknown>>;
}

/**
 * Inserts one audit row, fail-open. Returns whether a row was written and the
 * roles the insert captured (null when the caller has no users row or the
 * insert failed). On a throw or a timeout, emits the log-only
 * topic.audit_write_failed (error level; SQLSTATE only, never err.message)
 * and swallows.
 */
export async function writeFailOpenTopicAuditRow(
  args: FailOpenTopicAuditArgs,
): Promise<{ rowWritten: boolean; actorRoles: readonly string[] | null }> {
  try {
    const result = await withTimeout(
      db.query<{ actor_roles: string[] | null }>(FAIL_OPEN_TOPIC_AUDIT_INSERT_SQL, [
        args.actorUserId,
        args.actorGlobalRole ?? "unknown",
        args.actorIp,
        args.operation,
        args.teamId,
        JSON.stringify({
          endpoint: args.endpoint,
          http_status: args.httpStatus,
          reason: args.reason,
          ...args.extraMetadata,
        }),
      ]),
      AUDIT_WRITE_TIMEOUT_MS,
    );
    return { rowWritten: true, actorRoles: result.rows[0]?.actor_roles ?? null };
  } catch (err) {
    emitAuditEvent(
      args.log,
      "topic.audit_write_failed",
      {
        actorUserId: args.actorUserId,
        teamId: args.teamId,
        endpoint: args.endpoint,
        operation: args.operation,
        stage: "audit_insert",
        reason: args.reason,
        failureMode: err instanceof AuditWriteTimeoutError ? "timeout" : "error",
        errorCode: sqlstateOf(err),
      },
      "error",
    );
    return { rowWritten: false, actorRoles: null };
  }
}
