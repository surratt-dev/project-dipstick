import type { FastifyBaseLogger } from "fastify";
import { randomBytes } from "node:crypto";
import { emitAuditEvent } from "./audit-logger.js";
import { withAuditTransaction } from "./audit-write-transaction.js";
import type { JoinLink } from "@dipstick/shared";

const DEFAULT_EXPIRY_DAYS = 7;

// join-link-redemption-wiring, design.md Decision 2's addendum: the single
// shared definition of "active" for a join_links row, consumed by
// facilitator-sessions.ts's get-or-create SELECT and join-links.ts's
// GET /api/join/:token redemption check -- not two independently-maintained
// copies of this condition.
export const JOIN_LINK_ACTIVE_SQL = "revoked_at IS NULL AND expires_at > NOW()";

/**
 * The full join_links creation sequence -- token/expiry generation, the
 * join_links INSERT-plus-audit-transaction (join.link_created), and the
 * post-commit emitAuditEvent call -- extracted from join-links.ts so that
 * `POST /api/teams/:teamId/join-links` and get-or-create's "no active row"
 * branch (facilitator-sessions.ts) share one implementation rather than two
 * independently-written copies of the audit-write guarantees this depends on
 * (join-link-redemption-wiring, design.md Decision 2).
 */
export async function createJoinLink(params: {
  teamId: string;
  createdByUserId: string;
  actorGlobalRole: string;
  actorIp: string;
  logger: FastifyBaseLogger;
}): Promise<JoinLink> {
  const { teamId, createdByUserId, actorGlobalRole, actorIp, logger } = params;

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  );

  const result = await withAuditTransaction(
    (client) =>
      client.query(
        `INSERT INTO join_links (team_id, token, created_by, expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING id, team_id, token, created_at, expires_at`,
        [teamId, token, createdByUserId, expiresAt.toISOString()],
      ),
    async (client, insertResult) => {
      const insertedRow = insertResult.rows[0] as { id: string; expires_at: Date };
      await client.query(
        `INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
         VALUES ($1, $2, $3, 'join.link_created', $4, $5)`,
        [
          createdByUserId,
          actorGlobalRole,
          actorIp,
          teamId,
          JSON.stringify({
            linkId: insertedRow.id,
            expiresAt: insertedRow.expires_at.toISOString(),
          }),
        ],
      );
    },
  );

  const row = result.rows[0] as {
    id: string;
    team_id: string;
    token: string;
    created_at: Date;
    expires_at: Date;
  };

  // Fires only after the transaction above has already committed
  // successfully, matching the emitAuditEvent-after-commit contract this
  // sequence had at its original call site.
  emitAuditEvent(logger, "join.link_created", {
    userId: createdByUserId,
    teamId,
    linkId: row.id,
    expiresAt: row.expires_at.toISOString(),
  });

  return {
    id: row.id,
    teamId: row.team_id,
    token: row.token,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}
