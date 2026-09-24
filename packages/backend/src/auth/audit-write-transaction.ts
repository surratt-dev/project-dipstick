import type { PoolClient } from "pg";
import { db } from "../db.js";
import { AuditWriteError } from "./errors.js";

// ---------------------------------------------------------------------------
// auth-events-audit-log-coverage: design.md Decisions D2/D3, Engineer review
// Findings 1 and 6.
//
// The single shared implementation of the "transactional group"'s
// connect/BEGIN/domain-write/audit-INSERT/COMMIT/ROLLBACK/release skeleton
// (teams.ts's establishManagerAssociation / team.manager_established is the
// precedent this generalizes), used by all four transactional call sites:
//   - auth.ts /auth/callback: resolveOrCreateAccount + auth.first_access_created
//     / auth.role_claim_mapped
//   - join-links.ts POST /api/teams/:teamId/join-links: join.link_created
//   - join-links.ts GET /api/join/:token: join.link_redeemed
//   - auth.ts executeJoinFlow: join.link_redeemed
//
// Not reproduced four times independently -- the same "third hand-copied
// timeout mechanism" instinct that ruled out a second fail-open
// implementation applies equally here.
// ---------------------------------------------------------------------------

/**
 * Deliberately shorter than the fail-open group's AUDIT_WRITE_TIMEOUT_MS
 * (500ms) -- see design.md Decision D3. `SET LOCAL statement_timeout` is
 * enforced by Postgres itself: if the audit INSERT doesn't complete in time,
 * Postgres cancels it server-side and returns an error for that statement,
 * freeing the connection's command slot so the subsequent ROLLBACK isn't
 * queued behind a still-outstanding query. A client-side timer racing the
 * INSERT (the fail-open group's mechanism) would NOT bound latency here,
 * because pg processes queries on one connection strictly in submission
 * order -- the ROLLBACK would still queue behind the abandoned INSERT.
 */
export const TRANSACTIONAL_AUDIT_STATEMENT_TIMEOUT_MS = 400;

/**
 * Runs `domainWrite` and `auditInsert` in one Postgres transaction, joining
 * the audit `INSERT` to the domain write's fate (design.md Decision D3): an
 * `audit_log` write failure rolls back the domain write too, deliberately,
 * for the significance class of events this helper is used for.
 *
 * - A failed `db.connect()` is wrapped in `AuditWriteError` and rethrown
 *   immediately -- no transaction was ever opened, so there is nothing to
 *   roll back.
 * - `domainWrite`'s own errors propagate unwrapped -- this is the pre-existing
 *   failure mode of whatever write `domainWrite` performs (e.g.
 *   resolveOrCreateAccount's UPSERT), unchanged by this change (Decision D7).
 * - Immediately before `auditInsert` runs, `SET LOCAL statement_timeout` is
 *   issued on the same client (Decision D3's fix) -- a fixed internal
 *   constant, not request-derived, so inlining it into the query string
 *   carries no injection risk despite `SET` not accepting bind parameters.
 * - Any error thrown by `auditInsert` is wrapped in `AuditWriteError` before
 *   the transaction rolls back.
 *
 * `auditInsert` closures decide internally whether to issue an INSERT at all
 * (e.g. no-op when an event's firing condition isn't met) -- this helper
 * doesn't need to know whether a given transaction produced an audit row, it
 * just commits the domain write alone in that case.
 */
export async function withAuditTransaction<T>(
  domainWrite: (client: PoolClient) => Promise<T>,
  auditInsert: (client: PoolClient, domainResult: T) => Promise<void>,
): Promise<T> {
  let client: PoolClient;
  try {
    client = await db.connect();
  } catch (connectErr) {
    // No transaction was ever opened -- nothing to roll back. This is a new
    // failure mode this change introduces (Engineer review, Finding 2/4):
    // today, none of these call sites check out a pooled client at all.
    // Wrapped as AuditWriteError for the same reason the audit INSERT itself
    // is (Decision D7) -- from an incident responder's perspective,
    // "couldn't get a DB connection to write the audit row" and "the audit
    // row write itself failed" are the same story: this application's own
    // database infrastructure, not the IdP.
    throw new AuditWriteError(connectErr);
  }
  try {
    await client.query("BEGIN");
    const domainResult = await domainWrite(client);
    try {
      // Fixed internal constant, not request-derived -- string interpolation
      // here carries no injection risk despite SET not accepting bind
      // parameters. See Decision D3 for why this exists and what it fixes.
      await client.query(
        `SET LOCAL statement_timeout = ${TRANSACTIONAL_AUDIT_STATEMENT_TIMEOUT_MS}`,
      );
      await auditInsert(client, domainResult);
    } catch (auditErr) {
      throw new AuditWriteError(auditErr);
    }
    await client.query("COMMIT");
    return domainResult;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      // connection is already lost; nothing more to do
    });
    throw err;
  } finally {
    client.release();
  }
}
