import { db } from "../db.js";
import type { TeamAccessGrant } from "@dipstick/shared";

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
//   Path 1 — Team Member:
//     team_memberships row with removed_at IS NULL for (userId, teamId)
//     Returns { path: 'member', role, teamId, actorGlobalRole }
//
//   Path 2 — Engineering Manager (dual-check, session-participation spec):
//     users.global_role = 'engineering_manager' AND
//     team_memberships.role = 'engineering_manager' for this team
//     This is Path 1 with the EM dual-check enforced — it produces the same
//     grant shape { path: 'member', role: 'engineering_manager', ... }
//     The dual-check is a superset of Path 1 and is handled automatically:
//     when the membership row has role = 'engineering_manager', the returned
//     grant carries that role. The effective authorization is the membership
//     row, not the global_role alone.
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
  // Path 1 & 2: Team Member (participant or EM)
  //
  // Decision 8: If the user has an active membership row for this team,
  // they are authorized as a team member. The role on the membership row
  // determines the response shape (aggregate-only for EM, aggregate+own-vote
  // for participant).
  //
  // Decision (session-participation dual-check): The EM path is NOT a separate
  // code branch. If users.global_role = 'engineering_manager' AND
  // team_memberships.role = 'engineering_manager', the membership row is found
  // and the grant carries role: 'engineering_manager'. The dual-check is
  // enforced by the serializer: an EM never sees voter_id in their response.
  //
  // A user with global_role = 'engineer' but membership_role = 'engineering_manager'
  // receives the EM content profile (aggregate only) per the proposal's acceptance
  // criterion — the membership role governs, not the global role.
  // ---------------------------------------------------------------------------
  if (membership_role !== null) {
    return {
      path: "member",
      role: membership_role as "participant" | "engineering_manager",
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
      sessionStatus: session_status as import("@dipstick/shared").SessionStatus,
      actorGlobalRole: global_role,
    };
  }

  // No path matched — caller has no access to this team's content.
  // Return null (not false, not a boolean).
  return null;
}
