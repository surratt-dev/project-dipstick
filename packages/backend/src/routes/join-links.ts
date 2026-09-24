import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { emitAuditEvent } from "../auth/audit-logger.js";
import { withAuditTransaction } from "../auth/audit-write-transaction.js";
import { createJoinLink, JOIN_LINK_ACTIVE_SQL } from "../auth/join-link-creation.js";
import type { SessionData } from "../auth/session-store.js";

export async function joinLinkRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/teams/:teamId/join-links
  app.post<{
    Params: { teamId: string };
  }>("/api/teams/:teamId/join-links", async (request, reply) => {
    const session = request.session as unknown as SessionData;
    const { teamId } = request.params;

    // Verify caller is a facilitator for this team
    // (engineering_manager role or facilitator global role)
    const memberResult = await db.query(
      `SELECT tm.role FROM team_memberships tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.user_id = $1 AND tm.team_id = $2 AND tm.removed_at IS NULL`,
      [session.userId, teamId],
    );

    if (memberResult.rows.length === 0) {
      return reply.code(403).send({
        error: {
          category: "invalid_request" as const,
          message: "You are not a member of this team.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Check user's global role for facilitator permissions
    const userResult = await db.query(
      `SELECT global_role FROM users WHERE id = $1`,
      [session.userId],
    );

    const userRole = (userResult.rows[0] as { global_role: string })
      ?.global_role;
    const memberRole = (memberResult.rows[0] as { role: string })?.role;

    // Allow facilitators, engineering managers, and application admins
    const canCreate =
      userRole === "facilitator" ||
      userRole === "engineering_manager" ||
      userRole === "application_admin" ||
      memberRole === "engineering_manager";

    if (!canCreate) {
      return reply.code(403).send({
        error: {
          category: "invalid_request" as const,
          message: "You do not have permission to create join links for this team.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // join-link-redemption-wiring, design.md Decision 2: the full creation
    // sequence (token/expiry generation, the join_links
    // INSERT-plus-audit-transaction, and the post-commit emitAuditEvent
    // call) is shared with get-or-create's "no active row" branch
    // (facilitator-sessions.ts) via this one function, rather than a
    // second, independently-written implementation. actor_global_role comes
    // from the already-resolved userRole check above (no additional
    // lookup); memberRole is a team-scoped role, not a global one, and is
    // not conflated here.
    const joinLink = await createJoinLink({
      teamId,
      createdByUserId: session.userId,
      actorGlobalRole: userRole,
      actorIp: request.ip,
      logger: request.log,
    });

    return reply.code(201).send(joinLink);
  });

  // GET /api/join/:token — handles both authenticated and unauthenticated flows
  app.get<{
    Params: { token: string };
  }>("/api/join/:token", async (request, reply) => {
    const { token } = request.params;
    const session = request.session as unknown as SessionData;

    // Validate token. join-link-redemption-wiring, design.md Decision 2's
    // addendum: is_active is computed from the same JOIN_LINK_ACTIVE_SQL
    // constant get-or-create's SELECT uses (facilitator-sessions.ts) --
    // one shared definition of "active," not two independently-maintained
    // copies. The revoked_at / expires_at columns are still selected
    // separately so the rejection branch below can report *which* reason
    // applies -- only the pass/fail gate itself is unified.
    const linkResult = await db.query(
      `SELECT id, team_id, expires_at, revoked_at, (${JOIN_LINK_ACTIVE_SQL}) AS is_active
       FROM join_links WHERE token = $1`,
      [token],
    );

    if (linkResult.rows.length === 0) {
      emitAuditEvent(request.log, "join.link_rejected", {
        sourceIp: request.ip,
        linkId: null,
        reason: "not_found",
      });
      // Both the direct join path and the through-auth path converge on
      // /join-error?joinError=... so users see the same error page regardless
      // of which code path their browser followed.
      return reply.redirect("/join-error?joinError=invalid");
    }

    const link = linkResult.rows[0] as {
      id: string;
      team_id: string;
      expires_at: Date;
      revoked_at: Date | null;
      is_active: boolean;
    };

    if (!link.is_active) {
      const reason = link.revoked_at ? "revoked" : "expired";
      emitAuditEvent(request.log, "join.link_rejected", {
        sourceIp: request.ip,
        linkId: link.id,
        reason,
      });
      return reply.redirect("/join-error?joinError=expired");
    }

    // Unauthenticated flow: redirect to login with join token context
    if (!session?.userId) {
      return reply.redirect(`/auth/login?joinToken=${token}`);
    }

    // Authenticated flow: join team.
    // "participant" is the membership_role enum value corresponding to what the
    // use case calls "Engineer." The membership_role enum is distinct from the
    // global user_role enum on the users table (which has values like "engineer",
    // "facilitator", "engineering_manager"). Do NOT change this value to
    // 'engineer' — that value does not exist in membership_role and would cause
    // a database constraint error.
    //
    // auth-events-audit-log-coverage, design.md Decision D5: no global_role
    // value is in scope anywhere in this handler otherwise (only
    // session.userId is read). This SELECT runs on the plain pool, BEFORE
    // withAuditTransaction's db.connect()/BEGIN opens below -- it's a read
    // with no correctness dependency on the pending team_memberships INSERT,
    // so there's no reason to hold it on a connection a subsequent rollback
    // would tear down before the value was ever used.
    const actorRoleResult = await db.query(
      `SELECT global_role FROM users WHERE id = $1`,
      [session.userId],
    );
    const actorGlobalRole = (actorRoleResult.rows[0] as { global_role: string } | undefined)
      ?.global_role;

    // The team_memberships INSERT and its conditional join.link_redeemed
    // audit_log row run in one transaction (Decision D2/D5) -- a failed
    // audit INSERT rolls back the membership row too (Decision D3). When
    // ON CONFLICT suppresses the insert (isAlreadyMember), the auditInsert
    // closure no-ops and the transaction still commits, matching the
    // existing structured-log gating exactly.
    const insertResult = await withAuditTransaction(
      (client) =>
        client.query(
          `INSERT INTO team_memberships (user_id, team_id, role)
           VALUES ($1, $2, 'participant')
           ON CONFLICT (user_id, team_id) DO NOTHING
           RETURNING id`,
          [session.userId, link.team_id],
        ),
      async (client, membershipResult) => {
        if (membershipResult.rows.length === 0) {
          return;
        }
        await client.query(
          `INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
           VALUES ($1, $2, $3, 'join.link_redeemed', $4, $5)`,
          [session.userId, actorGlobalRole, request.ip, link.team_id, JSON.stringify({ linkId: link.id })],
        );
      },
    );

    const isAlreadyMember = insertResult.rows.length === 0;

    // Engineer review Finding 3: fires only after withAuditTransaction above
    // has already committed successfully, and only when a row was actually
    // inserted — not at the former source position immediately after the
    // INSERT resolved.
    if (!isAlreadyMember) {
      emitAuditEvent(request.log, "join.link_redeemed", {
        sourceIp: request.ip,
        userId: session.userId,
        teamId: link.team_id,
        linkId: link.id,
      });
    }

    // Check for active in-progress session
    const sessionResult = await db.query(
      `SELECT id FROM sessions WHERE team_id = $1 AND status = 'active' LIMIT 1`,
      [link.team_id],
    );

    if (sessionResult.rows.length > 0) {
      const activeSession = sessionResult.rows[0] as { id: string };
      const alreadyParam = isAlreadyMember ? "?alreadyMember=true" : "";
      return reply.redirect(
        `/session/${activeSession.id}${alreadyParam}`,
      );
    }

    const alreadyParam = isAlreadyMember ? "?alreadyMember=true" : "";
    return reply.redirect(`/team/${link.team_id}${alreadyParam}`);
  });
}
