import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { db } from "../db.js";
import { emitAuditEvent } from "../auth/audit-logger.js";
import type { SessionData } from "../auth/session-store.js";
import type { JoinLink } from "@dipstick/shared";

const DEFAULT_EXPIRY_DAYS = 7;

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

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    const result = await db.query(
      `INSERT INTO join_links (team_id, token, created_by, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, team_id, token, created_at, expires_at`,
      [teamId, token, session.userId, expiresAt.toISOString()],
    );

    const row = result.rows[0] as {
      id: string;
      team_id: string;
      token: string;
      created_at: Date;
      expires_at: Date;
    };

    emitAuditEvent(request.log, "join.link_created", {
      userId: session.userId,
      teamId,
      linkId: row.id,
      expiresAt: row.expires_at.toISOString(),
    });

    const joinLink: JoinLink = {
      id: row.id,
      teamId: row.team_id,
      token: row.token,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    };

    return reply.code(201).send(joinLink);
  });

  // GET /api/join/:token — handles both authenticated and unauthenticated flows
  app.get<{
    Params: { token: string };
  }>("/api/join/:token", async (request, reply) => {
    const { token } = request.params;
    const session = request.session as unknown as SessionData;

    // Validate token
    const linkResult = await db.query(
      `SELECT id, team_id, expires_at, revoked_at FROM join_links WHERE token = $1`,
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
    };

    if (link.revoked_at) {
      emitAuditEvent(request.log, "join.link_rejected", {
        sourceIp: request.ip,
        linkId: link.id,
        reason: "revoked",
      });
      return reply.redirect("/join-error?joinError=expired");
    }

    if (new Date(link.expires_at) < new Date()) {
      emitAuditEvent(request.log, "join.link_rejected", {
        sourceIp: request.ip,
        linkId: link.id,
        reason: "expired",
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
    const insertResult = await db.query(
      `INSERT INTO team_memberships (user_id, team_id, role)
       VALUES ($1, $2, 'participant')
       ON CONFLICT (user_id, team_id) DO NOTHING
       RETURNING id`,
      [session.userId, link.team_id],
    );

    const isAlreadyMember = insertResult.rows.length === 0;

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
