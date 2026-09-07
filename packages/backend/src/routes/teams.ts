import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { emitAuditEvent } from "../auth/audit-logger.js";
import type { SessionData } from "../auth/session-store.js";
import type {
  TeamMember,
  LegacyTeamMembersResponse,
  TeamMembersResponse,
  RoleChangeRequest,
  RoleChangeResponse,
  EstablishManagerRequest,
  EstablishManagerResponse,
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

    // Decision 2 (Option B) audit: log Application Admin reads of the
    // membership list. actorGlobalRole is available from the auth check above
    // — do not re-query the users table.
    // Task 3.4 / Task 3.6: written immediately (not in a transaction) because
    // this is a read operation; atomicity with a write transaction is not
    // applicable. The audit write executes before the response is sent.
    if (global_role === "application_admin") {
      await db.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          session.userId,
          global_role,
          request.ip,
          "admin.membership_list_accessed",
          teamId,
          JSON.stringify({ member_count: members.length }),
        ],
      );

      emitAuditEvent(request.log, "admin.membership_list_accessed", {
        actorUserId: session.userId,
        actorGlobalRole: global_role,
        actorIp: request.ip,
        teamId,
        memberCount: members.length,
      });
    }

    const response: LegacyTeamMembersResponse = {
      teamId,
      teamName,
      members,
      canAssignRoles,
    };

    return reply.send(response);
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/teams/:teamId   (TEAM-003)
  //
  // Returns team members split into participants and engineeringManagers arrays.
  // Added in Phase 2 of establish-manager-team-relationship (Decision 12).
  //
  // The split is done at the database query level — the backend knows the role
  // at query time and the type system enforces the separation. Sending a flat
  // list and expecting the client to segment creates a dependency between
  // frontend rendering logic and the database schema that the type system
  // cannot enforce.
  //
  // canAssociateManagers (Decision 10): true when actor.global_role =
  // 'application_admin'. TEAM-006 is admin-only. Using canAssignRoles for this
  // affordance would cause EMs to see the control and receive 403s.
  //
  // This endpoint must ship in Phase 2 so that an EM row created by TEAM-006
  // never appears in the wrong array in production.
  // -------------------------------------------------------------------------
  app.get<{
    Params: { teamId: string };
  }>("/api/v1/teams/:teamId", async (request, reply) => {
    const session = request.session as unknown as SessionData;
    const { teamId } = request.params;

    // Verify the caller is a member of this team or an application_admin.
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

    const { global_role: actorGlobalRole, is_member: isMember } =
      actorResult.rows[0] as { global_role: string; is_member: boolean };

    if (!isMember && actorGlobalRole !== "application_admin") {
      return reply.code(403).send({
        error: {
          category: "invalid_request" as const,
          message: "You are not a member of this team.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Fetch team name — 404 when not found (not 403, to avoid leaking existence
    // information to non-admin callers who are already members)
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

    // Fetch all active members with their roles — split into participants and
    // engineeringManagers at the query level (not in application code)
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

    const participants: TeamMember[] = [];
    const engineeringManagers: TeamMember[] = [];

    for (const row of membersResult.rows) {
      const member: TeamMember = {
        userId: row.user_id,
        displayName: row.display_name,
        email: row.email,
        role: row.role as "participant" | "engineering_manager",
      };
      if (row.role === "engineering_manager") {
        engineeringManagers.push(member);
      } else {
        participants.push(member);
      }
    }

    // canAssignRoles: Application Admins and EMs with EM membership on this team
    const { authorized: canAssignRoles } = await checkAssignRolesAuthorization(
      session.userId,
      teamId,
    );

    // canAssociateManagers: Application Admin only (Decision 10)
    // TEAM-006 is restricted to Application Admins. An EM who sees this flag as
    // true will attempt TEAM-006 and receive 403 — worse UX than not showing the
    // control. The escalation message renders when this flag is false.
    const canAssociateManagers = actorGlobalRole === "application_admin";

    // Decision 2 (Option B) audit: log Application Admin reads of team detail
    // (which includes membership lists and role assignments).
    // Task 3.4: audit_log write for admin reads of administrative data.
    if (actorGlobalRole === "application_admin") {
      await db.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          session.userId,
          actorGlobalRole,
          request.ip,
          "admin.team_detail_accessed",
          teamId,
          JSON.stringify({
            participant_count: participants.length,
            em_count: engineeringManagers.length,
          }),
        ],
      );

      emitAuditEvent(request.log, "admin.team_detail_accessed", {
        actorUserId: session.userId,
        actorGlobalRole,
        actorIp: request.ip,
        teamId,
        participantCount: participants.length,
        emCount: engineeringManagers.length,
      });
    }

    const response: TeamMembersResponse = {
      teamId,
      teamName,
      participants,
      engineeringManagers,
      canAssignRoles,
      canAssociateManagers,
    };

    return reply.send(response);
  });

  // -------------------------------------------------------------------------
  // PATCH /api/v1/teams/:teamId/members/:userId/role   (TEAM-005)
  //
  // NOTE: TEAM-006 is NOT called from here and must NEVER be called from here.
  // TEAM-005 changes the team_memberships.role of an existing member. It does
  // not check or modify users.global_role. TEAM-006 establishes the EM/team
  // relationship for a user who was NOT previously a team member and requires
  // global_role = 'engineering_manager' as a hard precondition. These are
  // distinct endpoints serving distinct use cases — see design.md.
  // (Task 3.8 comment — establish-manager-team-relationship)
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

      // Audit log: same transaction — rolls back if this fails.
      // Writes to audit_log (Decision 9, establish-manager-team-relationship).
      // role_change_audit was dropped in migration 8 and replaced by audit_log.
      // from_role and to_role are stored in the metadata JSONB column.
      //
      // NOTE: TEAM-006 is NOT called from here — see task 3.8 comment at the
      // TEAM-006 handler. TEAM-005 writes only to team_memberships.role and
      // does not check users.global_role. They are distinct endpoints serving
      // distinct use cases. Do not conflate them.
      await client.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_global_role, actor_ip, operation,
            target_user_id, team_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          session.userId,
          actorGlobalRole,
          // request.ip resolves to the real client IP via trustProxy: 1
          // configured in buildApp() in app.ts.
          request.ip,
          "team.role_changed",
          subjectUserId,
          teamId,
          JSON.stringify({ from_role: fromRole, to_role: newRole }),
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

  // -------------------------------------------------------------------------
  // POST /api/v1/teams/:teamId/managers   (TEAM-006)
  //
  // Establishes the EM/team relationship for a user who already has
  // users.global_role = 'engineering_manager'. Creates (or idempotently
  // updates) a team_memberships row with role = 'engineering_manager'.
  //
  // Distinct from TEAM-005: TEAM-005 changes the team_memberships.role of an
  // EXISTING member. TEAM-006 establishes the relationship for a user who was
  // NOT previously a team member. TEAM-006 also enforces the global_role
  // precondition — TEAM-005 does not. These endpoints must remain distinct and
  // must NOT be called in place of each other.
  // (Task 3.7 comment — establish-manager-team-relationship)
  //
  // Authorized actor: Application Admin only (Decision 1 / Decision 10).
  //
  // Idempotency (Decision 3): uses PostgreSQL xmax to distinguish 201 (new row)
  // from 200 (updated row) without a SELECT-before-INSERT. xmax = 0 is true for
  // freshly inserted rows; false for updated rows. This avoids the race
  // condition that SELECT-before-INSERT creates: two concurrent admin calls
  // both reading "no row" and both attempting INSERT, with one failing.
  //
  // 404 information exposure (Decision 4): a 404 for "team not found" is
  // indistinguishable from a 404 for "team found but caller is not authorized
  // to know it exists" when the caller is not an Application Admin.
  //
  // Audit trail (Decision 9): the audit_log entry is written in the same
  // database transaction as the team_memberships write. If the audit write
  // fails, the transaction rolls back and neither row is committed. A committed
  // transaction produces both rows; a rolled-back transaction produces neither.
  //
  // Dual authorization check (Decision 14): both the global_role check and the
  // team_memberships.role check for EM data access remain independent. They
  // serve different purposes — global_role is a global role guard;
  // team_memberships.role is a team-scoped association guard.
  //
  // Rate limiting (task 3.10): the rate limit threshold for this endpoint is
  // specified in Q6 of design.md and must be implemented and tested before Phase 2
  // ships. The threshold decision is owned by the BA and security analyst. The
  // implementation is wired here but the specific limit value comes from Q6.
  // -------------------------------------------------------------------------
  app.post<{
    Params: { teamId: string };
    Body: EstablishManagerRequest;
  }>("/api/v1/teams/:teamId/managers", async (request, reply) => {
    const session = request.session as unknown as SessionData;
    const { teamId } = request.params;
    const { engineeringManagerUserId } = request.body;

    // -----------------------------------------------------------------------
    // Authorization: Application Admin only (Decision 1).
    // Read from the database per request — not from session state.
    // -----------------------------------------------------------------------
    const actorResult = await db.query<{ global_role: string }>(
      `SELECT global_role FROM users WHERE id = $1`,
      [session.userId],
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

    const actorGlobalRole = (actorResult.rows[0] as { global_role: string }).global_role;

    if (actorGlobalRole !== "application_admin") {
      return reply.code(403).send({
        error: {
          category: "forbidden" as const,
          message:
            "Only an Application Admin can establish an Engineering Manager/team relationship.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // -----------------------------------------------------------------------
    // Team existence check (Decision 4 information-exposure constraint):
    // For non-admin callers, 404 for "not found" is indistinguishable from
    // "found but not authorized to know it exists." For admin callers (already
    // confirmed above), a genuine 404 is acceptable.
    // -----------------------------------------------------------------------
    const teamResult = await db.query<{ id: string }>(
      `SELECT id FROM teams WHERE id = $1`,
      [teamId],
    );

    if (teamResult.rows.length === 0) {
      return reply.code(404).send({
        error: {
          category: "not_found" as const,
          message: "Team not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // -----------------------------------------------------------------------
    // Global role precondition check (Decision 3 / Decision 4):
    // The target user MUST have global_role = 'engineering_manager'.
    // 409 Conflict with a specific error code distinguishes this from other
    // failures (team not found, unauthorized, etc.).
    // -----------------------------------------------------------------------
    const targetResult = await db.query<{
      global_role: string;
      display_name: string;
    }>(
      `SELECT global_role, display_name FROM users WHERE id = $1`,
      [engineeringManagerUserId],
    );

    if (targetResult.rows.length === 0) {
      return reply.code(404).send({
        error: {
          category: "not_found" as const,
          message: "Target user not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const { global_role: targetGlobalRole, display_name: targetDisplayName } =
      targetResult.rows[0] as { global_role: string; display_name: string };

    if (targetGlobalRole !== "engineering_manager") {
      // 409 Conflict with machine-readable error code so the escalation UX
      // in the team administration view can display the specific failure reason.
      return reply.code(409).send({
        error: {
          category: "precondition_failed" as const,
          code: "GLOBAL_ROLE_PRECONDITION_NOT_MET",
          message:
            "The target user does not have global_role = 'engineering_manager'. " +
            "The user must sign in with an IdP account that has the engineering_manager role claim " +
            "before they can be established as an Engineering Manager for this team.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // -----------------------------------------------------------------------
    // Upsert with xmax idempotency (Decision 3):
    //
    // INSERT ... ON CONFLICT (user_id, team_id) WHERE removed_at IS NULL
    // DO UPDATE SET role = 'engineering_manager'
    // RETURNING id, (xmax = 0) AS is_new_row
    //
    // xmax = 0 is true for freshly inserted rows (no prior transaction updated
    // this row), false for rows that were updated by DO UPDATE. This gives us
    // 201 vs. 200 atomically from the upsert result without a separate SELECT.
    //
    // Why xmax and not SELECT-before-INSERT:
    // A SELECT-before-INSERT has a race condition identical to the one TEAM-005
    // solved: two concurrent admin calls both read "no row," both attempt
    // INSERT, one fails. The xmax inspection eliminates this window entirely.
    //
    // The partial unique constraint team_memberships_active_unique
    // (user_id, team_id WHERE removed_at IS NULL) from migration 7 is required
    // for this ON CONFLICT clause to work. Without it, the upsert fails at
    // runtime with a constraint mismatch error.
    // -----------------------------------------------------------------------
    const client = await db.connect();
    let membershipId: string;
    let isNewRow: boolean;

    try {
      await client.query("BEGIN");

      const upsertResult = await client.query<{ id: string; is_new_row: boolean }>(
        `INSERT INTO team_memberships (user_id, team_id, role)
         VALUES ($1, $2, 'engineering_manager')
         ON CONFLICT (user_id, team_id) WHERE removed_at IS NULL
         DO UPDATE SET role = 'engineering_manager'
         RETURNING id, (xmax = 0) AS is_new_row`,
        [engineeringManagerUserId, teamId],
      );

      const upsertRow = upsertResult.rows[0] as { id: string; is_new_row: boolean };
      membershipId = upsertRow.id;
      isNewRow = upsertRow.is_new_row;

      // Audit trail (Decision 9): written in the same transaction as the
      // team_memberships write. If this INSERT fails, the transaction rolls back
      // and neither row is committed. A committed transaction produces both.
      // The security analyst will verify atomicity before Phase 3 begins.
      await client.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_global_role, actor_ip, operation,
            target_user_id, team_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          session.userId,
          actorGlobalRole,
          request.ip,
          "team.manager_established",
          engineeringManagerUserId,
          teamId,
          JSON.stringify({ is_new_association: isNewRow }),
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
    emitAuditEvent(request.log, "team.manager_established", {
      actorUserId: session.userId,
      actorGlobalRole,
      actorIp: request.ip,
      engineeringManagerUserId,
      teamId,
      membershipId,
      isNewAssociation: isNewRow,
    });

    const response: EstablishManagerResponse = {
      teamId,
      engineeringManagerUserId,
      engineeringManagerDisplayName: targetDisplayName,
      teamMembershipId: membershipId!,
    };

    // 201 Created for new associations, 200 OK for idempotent re-associations.
    // The response body is identical in both cases (Decision 3) — callers must
    // not rely on the body to distinguish create-new from update-existing.
    return reply.code(isNewRow ? 201 : 200).send(response);
  });
}
