import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { emitAuditEvent } from "../auth/audit-logger.js";
import type { SessionData } from "../auth/session-store.js";
import type {
  TeamMember,
  TeamMembersResponse,
  RoleChangeRequest,
  RoleChangeResponse,
} from "@dipstick/shared";

// ---------------------------------------------------------------------------
// Authorization helper
//
// Per Decision 3 in design.md: the actor is authorized to assign roles for a
// given team if and only if one of the following is true at request time —
// evaluated from the database, not from session state:
//
//   a) users.global_role = 'application_admin'
//   b) users.global_role = 'engineering_manager'
//      AND team_memberships.role = 'engineering_manager' for the specific teamId
//
// The teamId comes from the request URL path (attacker-controlled input). The
// check must be per-team, per-request, from the database. An EM on Team A
// calling PATCH /api/v1/teams/team-b-id/... MUST receive a 403.
// ---------------------------------------------------------------------------
async function checkAssignRolesAuthorization(
  actorUserId: string,
  teamId: string,
): Promise<{ authorized: boolean; actorGlobalRole: string }> {
  const result = await db.query<{
    global_role: string;
    membership_role: string | null;
  }>(
    `SELECT u.global_role,
            tm.role AS membership_role
     FROM users u
     LEFT JOIN team_memberships tm
           ON tm.user_id = u.id
          AND tm.team_id = $2
          AND tm.removed_at IS NULL
     WHERE u.id = $1`,
    [actorUserId, teamId],
  );

  if (result.rows.length === 0) {
    return { authorized: false, actorGlobalRole: "" };
  }

  const { global_role, membership_role } = result.rows[0] as {
    global_role: string;
    membership_role: string | null;
  };

  const authorized =
    global_role === "application_admin" ||
    (global_role === "engineering_manager" &&
      membership_role === "engineering_manager");

  return { authorized, actorGlobalRole: global_role };
}

export async function teamRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // GET /api/v1/teams/:teamId/members
  //
  // Returns the list of active team members with their current role labels,
  // plus a canAssignRoles flag at the response level (Decision 9). The flag
  // is evaluated from the database per request — not from session state.
  // -------------------------------------------------------------------------
  app.get<{
    Params: { teamId: string };
  }>("/api/v1/teams/:teamId/members", async (request, reply) => {
    const session = request.session as unknown as SessionData;
    const { teamId } = request.params;

    // Verify the caller is a member of this team, or an application_admin.
    const actorResult = await db.query<{
      global_role: string;
      is_member: boolean;
    }>(
      `SELECT u.global_role,
              (tm.id IS NOT NULL) AS is_member
       FROM users u
       LEFT JOIN team_memberships tm
             ON tm.user_id = u.id
            AND tm.team_id = $2
            AND tm.removed_at IS NULL
       WHERE u.id = $1`,
      [session.userId, teamId],
    );

    if (actorResult.rows.length === 0) {
      return reply.code(401).send({
        error: {
          category: "invalid_request" as const,
          message: "User not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const { global_role, is_member } = actorResult.rows[0] as {
      global_role: string;
      is_member: boolean;
    };
    if (!is_member && global_role !== "application_admin") {
      return reply.code(403).send({
        error: {
          category: "invalid_request" as const,
          message: "You are not a member of this team.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Fetch team name
    const teamResult = await db.query<{ name: string }>(
      `SELECT name FROM teams WHERE id = $1`,
      [teamId],
    );

    if (teamResult.rows.length === 0) {
      return reply.code(404).send({
        error: {
          category: "invalid_request" as const,
          message: "Team not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const teamName = (teamResult.rows[0] as { name: string }).name;

    // Fetch active members with their display names and current roles
    const membersResult = await db.query<{
      user_id: string;
      display_name: string;
      email: string;
      role: string;
    }>(
      `SELECT tm.user_id, u.display_name, u.email, tm.role
       FROM team_memberships tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = $1 AND tm.removed_at IS NULL
       ORDER BY u.display_name ASC`,
      [teamId],
    );

    // canAssignRoles: re-use the same per-team, per-request DB check (Decision 3).
    const { authorized: canAssignRoles } = await checkAssignRolesAuthorization(
      session.userId,
      teamId,
    );

    const members: TeamMember[] = membersResult.rows.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      email: row.email,
      role: row.role as "participant" | "engineering_manager",
    }));

    const response: TeamMembersResponse = {
      teamId,
      teamName,
      members,
      canAssignRoles,
    };

    return reply.send(response);
  });

  // -------------------------------------------------------------------------
  // PATCH /api/v1/teams/:teamId/members/:userId/role   (TEAM-005)
  //
  // Changes a team member's membership_role between 'participant' and
  // 'engineering_manager'. Authorized actors: Application Admins (any team)
  // and Engineering Managers with an active membership on THIS specific team
  // (Decision 3, Q1 resolution: Option A).
  //
  // Two-submission flow for zero-participant guard (Decision 5):
  //   1st PATCH: no confirmedZeroParticipant → server checks post-update
  //              participant count inside the transaction; if 0, rolls back
  //              and returns 422 { requiresConfirmation: true }.
  //   2nd PATCH: confirmedZeroParticipant: true → applies change regardless.
  //
  // Audit log: written in the same DB transaction as the UPDATE (Decision 7).
  // If the audit write fails the transaction rolls back — a role change with
  // no audit record is not a permitted failure mode.
  //
  // Redis prohibition: membership_role is NOT cached in Redis. Per Decision 4,
  // every authorization check reads directly from the database.
  // -------------------------------------------------------------------------
  app.patch<{
    Params: { teamId: string; userId: string };
    Body: RoleChangeRequest;
  }>("/api/v1/teams/:teamId/members/:userId/role", async (request, reply) => {
    const session = request.session as unknown as SessionData;
    const { teamId, userId: subjectUserId } = request.params;
    const { role: newRole, confirmedZeroParticipant = false } = request.body;

    // Validate the requested role value
    const validRoles = ["participant", "engineering_manager"];
    if (!validRoles.includes(newRole)) {
      return reply.code(400).send({
        error: {
          category: "invalid_request" as const,
          message: `Invalid role value: '${newRole}'. Valid values are: ${validRoles.join(", ")}.`,
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Authorization check: per-team, per-request, from the database.
    // NOT from session state (see Decision 3 Redis prohibition).
    const { authorized, actorGlobalRole } = await checkAssignRolesAuthorization(
      session.userId,
      teamId,
    );

    if (!authorized) {
      return reply.code(403).send({
        error: {
          category: "invalid_request" as const,
          // Q1 resolution: Option A — only Application Admins and Engineering
          // Managers for this specific team are permitted.
          message:
            "Only an Application Admin or an Engineering Manager for this team can change member roles.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Verify the subject user is an active member of this team
    const subjectCheckResult = await db.query<{
      display_name: string;
      email: string;
      current_role: string;
    }>(
      `SELECT u.display_name, u.email, tm.role AS current_role
       FROM team_memberships tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.user_id = $1 AND tm.team_id = $2 AND tm.removed_at IS NULL`,
      [subjectUserId, teamId],
    );

    if (subjectCheckResult.rows.length === 0) {
      return reply.code(404).send({
        error: {
          category: "invalid_request" as const,
          message: "User is not an active member of this team.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const {
      display_name: displayName,
      email,
      current_role: fromRole,
    } = subjectCheckResult.rows[0] as {
      display_name: string;
      email: string;
      current_role: string;
    };

    // No-op: role is already the requested value
    if (fromRole === newRole) {
      const member: TeamMember = {
        userId: subjectUserId,
        displayName,
        email,
        role: newRole,
      };
      const response: RoleChangeResponse = { member };
      return reply.send(response);
    }

    // Transaction: UPDATE + zero-participant check + audit log
    // The count check is evaluated on the POST-UPDATE state within the
    // transaction to prevent the race condition described in Decision 5.
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Acquire a team-level lock before any reads or writes within this
      // transaction. By locking every active membership row for this team,
      // a concurrent transaction that also targets this team's memberships
      // will block here until the current transaction commits or rolls back.
      // This ensures the subsequent participant count check is evaluated on
      // fully committed state, closing the race condition identified in
      // Decision 5: two concurrent admins promoting the two participants of a
      // two-person team would otherwise each read count=1, both pass the zero-
      // participant guard, and leave the team with no participants and no 422.
      // (Architect finding #1 — required before ship.)
      await client.query(
        `SELECT id FROM team_memberships WHERE team_id = $1 AND removed_at IS NULL FOR UPDATE`,
        [teamId],
      );

      // Update the role (the team-level lock above serializes all concurrent
      // role changes for this team, so the post-update count below reflects
      // fully committed state from all prior transactions)
      await client.query(
        `UPDATE team_memberships
         SET role = $1
         WHERE user_id = $2 AND team_id = $3 AND removed_at IS NULL`,
        [newRole, subjectUserId, teamId],
      );

      // Post-update participant count — evaluated inside the transaction so
      // the lock prevents a concurrent UPDATE from racing past this check
      const countResult = await client.query<{ participant_count: string }>(
        `SELECT COUNT(*)::text AS participant_count
         FROM team_memberships
         WHERE team_id = $1 AND removed_at IS NULL AND role = 'participant'`,
        [teamId],
      );

      const participantCount = parseInt(
        (countResult.rows[0] as { participant_count: string }).participant_count,
        10,
      );

      // Zero-participant guard (Decision 5):
      // If the change would leave zero Engineers and the actor has not
      // explicitly confirmed, roll back and return 422.
      if (participantCount === 0 && !confirmedZeroParticipant) {
        await client.query("ROLLBACK");
        return reply.code(422).send({ requiresConfirmation: true });
      }

      // Audit log (Decision 7): same transaction — rolls back if this fails
      await client.query(
        `INSERT INTO role_change_audit
           (actor_user_id, actor_global_role, actor_ip, subject_user_id,
            team_id, from_role, to_role)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          session.userId,
          actorGlobalRole,
          // request.ip resolves to the real client IP via trustProxy: 1
          // configured in buildApp() in app.ts.
          request.ip,
          subjectUserId,
          teamId,
          fromRole,
          newRole,
        ],
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Structured-log counterpart to the DB audit row (for operational alerting)
    emitAuditEvent(request.log, "team.role_changed", {
      actorUserId: session.userId,
      actorGlobalRole,
      actorIp: request.ip,
      subjectUserId,
      teamId,
      fromRole,
      toRole: newRole,
    });

    const member: TeamMember = {
      userId: subjectUserId,
      displayName,
      email,
      role: newRole,
    };
    const response: RoleChangeResponse = { member };
    return reply.send(response);
  });
}
