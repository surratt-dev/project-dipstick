import type { FastifyBaseLogger } from "fastify";
import { db } from "../db.js";
import { emitAuditEvent } from "./audit-logger.js";
import type { TeamAccessGrant, SessionStatus } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// teamContentAccessHelper — evaluateTeamAccess(userId, teamId)
//
// Implements Design Decisions 2, 3, 4, 6, and 8 from design.md:
//   enforce-access-control-on-team-content
//
// Returns a typed TeamAccessGrant (discriminated union) or null.
// NEVER returns a boolean. The grant carries the resolved role and
// actorGlobalRole so callers need not re-query the users table for audit logs.
//
// Authorization paths (evaluated in priority order):
//
//   Path 0 — Application Admin:
//     users.global_role = 'application_admin'
//     Returns { path: 'admin', actorGlobalRole: 'application_admin' }
//     NOTE: The endpoint handler must decide whether admin access is permitted.
//           Content endpoints (session history, trends, etc.) MUST return 403
//           for admin grants. Administrative data endpoints (membership lists,
//           role assignments, EM associations) MAY proceed.
//
//   Path 1 — Team Member (participant):
//     team_memberships row with removed_at IS NULL for (userId, teamId) and
//     role = 'participant'.
//     Returns { path: 'member', role: 'participant', teamId, actorGlobalRole }
//
//   Path 2 — Engineering Manager (dual-check, restrict-team-005-em-promotion
//   Decision A, honoring Decision 14 from the archived
//   establish-manager-team-relationship change):
//     users.global_role = 'engineering_manager' AND
//     team_memberships.role = 'engineering_manager' for this team, BOTH read
//     live in the same query. This is the ONLY path that can return
//     { path: 'member', role: 'engineering_manager', ... } — membership_role
//     alone is never sufficient. A membership row with role =
//     'engineering_manager' whose global_role does NOT match degrades to the
//     mismatched-state handling below; it does not fall through to Path 1's
//     participant grant either, since the membership row is not actually a
//     participant row.
//
//   Path 3 — Active Session Facilitator:
//     The full SQL condition from Decision 3 / design.md:
//       sessions.facilitator_id = userId
//       AND sessions.team_id = teamId
//       AND (
//         sessions.status IN ('lobby', 'pre_session', 'active', 'wrap_up')
//         OR (status = 'draft' AND created_at + INTERVAL '24 hours' > NOW())
//         OR (status = 'complete' AND facilitator_access_expires_at > NOW())
//       )
//
// Cache prohibition (Decision 6):
//   This function executes live database reads on every call.
//   It MUST NOT be called with a cached result. The caller must not cache
//   the return value across requests. No ORM-level query cache is used
//   (node-postgres does not cache queries by default).
//
// Null return (Decision 8):
//   Returns null (NOT false or a boolean) when no path matches and the caller
//   is not an Application Admin.
// ---------------------------------------------------------------------------

export async function evaluateTeamAccess(
  userId: string,
  teamId: string,
  logger: FastifyBaseLogger,
): Promise<TeamAccessGrant | null> {
  // -------------------------------------------------------------------------
  // Single query: fetch the user's global_role AND their active membership
  // role for the requested team in one round-trip. This is the same dual-read
  // pattern used by session-participation and assign-role endpoints.
  //
  // We read both columns together so the authorization decision is made on a
  // consistent snapshot — no TOCTOU gap between the global_role check and the
  // membership_role check.
  //
  // No ORM-level query cache is used. node-postgres (pg) does not cache
  // queries. This is a live database read on every invocation.
  // -------------------------------------------------------------------------
  const userResult = await db.query<{
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
    [userId, teamId],
  );

  if (userResult.rows.length === 0) {
    // User does not exist. No access.
    return null;
  }

  const { global_role, membership_role } = userResult.rows[0] as {
    global_role: string;
    membership_role: string | null;
  };

  // ---------------------------------------------------------------------------
  // Path 0: Application Admin
  //
  // Decision 8 / Decision 2 (Option B): The helper returns { path: 'admin' }
  // for all Application Admin callers regardless of which endpoint is calling.
  // The calling endpoint handler enforces scope restrictions:
  //   - Session content endpoints: MUST return 403 for admin grants.
  //   - Administrative data endpoints: MAY proceed with admin grants.
  // ---------------------------------------------------------------------------
  if (global_role === "application_admin") {
    return {
      path: "admin",
      actorGlobalRole: "application_admin",
    };
  }

  // ---------------------------------------------------------------------------
  // Path 1: Team Member (participant)
  //
  // Decision 8: If the user has an active membership row for this team with
  // role = 'participant', they are authorized as a participant.
  // ---------------------------------------------------------------------------
  if (membership_role === "participant") {
    return {
      path: "member",
      role: "participant",
      teamId,
      actorGlobalRole: global_role,
    };
  }

  // ---------------------------------------------------------------------------
  // Path 2: Engineering Manager (dual-check)
  //
  // restrict-team-005-em-promotion Decision A: this is now the ONLY path that
  // can grant role: 'engineering_manager'. Both users.global_role and
  // team_memberships.role must equal 'engineering_manager' for this team,
  // read live in the same query above — mirroring
  // checkAssignRolesAuthorization's AND-logic (teams.ts) for the structurally
  // identical question ("can this actor act as an EM on this team").
  //
  // Decision E (mismatched-state handling): a membership row with role =
  // 'engineering_manager' whose global_role does NOT also equal
  // 'engineering_manager' is a data-integrity anomaly (global_role comes from
  // the IdP claim, not the membership row, so the two can drift). This
  // degrades gracefully to role: 'participant' rather than a hard 403 or
  // null — the user is a legitimate team member, just not correctly an EM,
  // and denying them the team's baseline content entirely over a column they
  // don't control is an availability cost with no matching security benefit.
  // This is not "failing open": the fail-safe direction is away from the
  // elevated grant, not toward denying the baseline access the membership
  // row already establishes. No synchronous audit_log row is written here —
  // this function runs on essentially every content request (Decision 6, no
  // caching), so a user parked in this anomalous state would otherwise
  // generate a DB write per page view. A structured log event alone is
  // sufficient for detection; this mirrors how team.manager_association_rate_approaching
  // is log-only while rate_limit_exceeded gets a DB row (audit-logger.ts).
  // ---------------------------------------------------------------------------
  if (membership_role === "engineering_manager") {
    if (global_role === "engineering_manager") {
      return {
        path: "member",
        role: "engineering_manager",
        teamId,
        actorGlobalRole: global_role,
      };
    }

    emitAuditEvent(logger, "team.access_grant_mismatch", {
      userId,
      teamId,
      globalRole: global_role,
      membershipRole: membership_role,
    });

    return {
      path: "member",
      role: "participant",
      teamId,
      actorGlobalRole: global_role,
    };
  }

  // ---------------------------------------------------------------------------
  // Path 3: Active Session Facilitator
  //
  // Decision 3: the full SQL condition checks four sub-cases:
  //   a) Active statuses: lobby, pre_session, active, wrap_up
  //   b) Draft session within 24 hours (lazy expiry at read time)
  //   c) Completed session within grace window (facilitator_access_expires_at)
  //
  // The check uses sessions.status = 'complete' (no trailing 'd') — verified
  // against existing codebase (design note: SQL uses 'complete' per em-views.ts).
  //
  // Decision 6 (no cache): This is a live database read. The facilitator_id
  // and status checks are not cached.
  // ---------------------------------------------------------------------------
  const facilitatorResult = await db.query<{
    session_id: string;
    session_status: string;
  }>(
    `SELECT s.id AS session_id,
            s.status AS session_status
     FROM sessions s
     WHERE s.facilitator_id = $1
       AND s.team_id = $2
       AND (
         s.status IN ('lobby', 'pre_session', 'active', 'wrap_up')
         OR (
           s.status = 'draft'
           AND s.created_at + INTERVAL '24 hours' > NOW()
         )
         OR (
           s.status = 'complete'
           AND s.facilitator_access_expires_at > NOW()
         )
       )
     LIMIT 1`,
    [userId, teamId],
  );

  if (facilitatorResult.rows.length > 0) {
    const { session_id, session_status } = facilitatorResult.rows[0] as {
      session_id: string;
      session_status: string;
    };

    return {
      path: "facilitator",
      sessionId: session_id,
      teamId,
      sessionStatus: session_status as SessionStatus,
      actorGlobalRole: global_role,
    };
  }

  // No path matched — caller has no access to this team's content.
  // Return null (not false, not a boolean).
  return null;
}
