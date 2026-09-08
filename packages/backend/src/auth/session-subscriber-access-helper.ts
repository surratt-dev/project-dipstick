import { db } from "../db.js";
import type { SessionSubscriberGrant, SessionStatus } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// sessionSubscriberAccessHelper — evaluateSessionSubscriberAccess(userId, sessionId)
//
// websocket-delivery-time-authorization: design.md Decision D3, tasks.md
// Group 2.
//
// A thin sibling to evaluateTeamAccess (team-content-access-helper.ts),
// scoped to a single session rather than a team, for the three
// session-scoped WebSocket content-access events: vote_readiness_update,
// session_state_change, vote_revealed. This is NOT a parallel/independent
// authorization implementation — it queries the same tables
// (sessions, team_memberships, session_participants) with the same indexes
// evaluateTeamAccess already relies on (sessions(facilitator_id, team_id,
// status), team_memberships(user_id, team_id)), and returns a grant-shaped
// result the WebSocket handlers branch on the same way HTTP handlers branch
// on evaluateTeamAccess's return value.
//
// Authorization paths (evaluated in priority order):
//
//   Path 3 — Active Session Facilitator:
//     sessions.facilitator_id = userId AND sessions.id = sessionId
//     AND sessions.status IN ('lobby', 'pre_session', 'active', 'wrap_up')
//     Returns { path: 'facilitator', sessionId, teamId, sessionStatus, actorGlobalRole }
//
//     Narrower per-event filtering (e.g. vote_readiness_update's requirement
//     that status be IN ('pre_session', 'active') specifically) is applied
//     by the calling WebSocket handler on top of this grant's sessionStatus
//     field — it is not a second query. See Group 4's per-event handlers.
//
//   Path 1 — Active Session Participant:
//     A session_participants row exists for (sessionId, userId) AND the
//     user's team_memberships row for this session's team has
//     removed_at IS NULL. A participant whose team membership was removed
//     loses this grant on the very next check, even mid-connection.
//     Returns { path: 'participant', sessionId, teamId, actorGlobalRole }
//
// Cache prohibition (Decision 6, inherited): this function executes a live
// database read on every call. It MUST NOT be called with a cached result,
// and its return value MUST NOT be cached by the caller across pushes.
//
// Null return: returns null (NOT false, NOT a boolean) when neither path
// matches — including when the session does not exist, or the user does
// not exist.
//
// No admin path: unlike evaluateTeamAccess, this helper has no 'admin'
// grant. Application Admins have no legitimate claim to session-scoped
// live-event delivery, and Engineering Managers are not session
// participants (they do not vote) — an EM's team-level 'member' grant from
// evaluateTeamAccess does not translate into a session-subscriber grant here.
// ---------------------------------------------------------------------------

const LIVE_FACILITATOR_STATUSES: SessionStatus[] = ["lobby", "pre_session", "active", "wrap_up"];

export async function evaluateSessionSubscriberAccess(
  userId: string,
  sessionId: string,
): Promise<SessionSubscriberGrant | null> {
  // -------------------------------------------------------------------------
  // Single query, live database read (Decision 6 — no cache):
  //
  // Joins the session row, the requesting user's global_role, whether they
  // have a session_participants row for this exact session, and whether
  // their team membership for this session's team is still active — all in
  // one round-trip, so the authorization decision is made on a consistent
  // snapshot (no TOCTOU gap between separate reads).
  // -------------------------------------------------------------------------
  const result = await db.query<{
    session_id: string;
    team_id: string;
    facilitator_id: string;
    session_status: string;
    global_role: string;
    participant_row_id: string | null;
    membership_role: string | null;
    membership_removed_at: Date | null;
    membership_exists: boolean;
  }>(
    `SELECT
       s.id AS session_id,
       s.team_id,
       s.facilitator_id,
       s.status AS session_status,
       u.global_role,
       sp.id AS participant_row_id,
       tm.role AS membership_role,
       tm.removed_at AS membership_removed_at,
       (tm.user_id IS NOT NULL) AS membership_exists
     FROM sessions s
     JOIN users u ON u.id = $1
     LEFT JOIN session_participants sp ON sp.session_id = s.id AND sp.user_id = $1
     LEFT JOIN team_memberships tm ON tm.user_id = $1 AND tm.team_id = s.team_id
     WHERE s.id = $2`,
    [userId, sessionId],
  );

  if (result.rows.length === 0) {
    // Session does not exist, or the user does not exist. No access.
    return null;
  }

  const row = result.rows[0] as {
    session_id: string;
    team_id: string;
    facilitator_id: string;
    session_status: string;
    global_role: string;
    participant_row_id: string | null;
    membership_role: string | null;
    membership_removed_at: Date | null;
    membership_exists: boolean;
  };

  // ---------------------------------------------------------------------------
  // Path 3: Active Session Facilitator
  // ---------------------------------------------------------------------------
  if (
    row.facilitator_id === userId &&
    LIVE_FACILITATOR_STATUSES.includes(row.session_status as SessionStatus)
  ) {
    return {
      path: "facilitator",
      sessionId: row.session_id,
      teamId: row.team_id,
      sessionStatus: row.session_status as SessionStatus,
      actorGlobalRole: row.global_role,
    };
  }

  // ---------------------------------------------------------------------------
  // Path 1: Active Session Participant
  //
  // Requires BOTH a session_participants row for this exact session AND an
  // active (removed_at IS NULL) team_memberships row for the session's team.
  // A participant removed from the team loses this grant immediately on the
  // next call — this is the delivery-time revocation property tasks 5.2/5.3
  // verify against the actual Redis pub/sub hop.
  //
  // EM-promotion exclusion (base spec, inherited unmodified by this change —
  // "Role change from participant to engineering_manager revokes live
  // session event access"): a session_participants row is NOT deleted when
  // a user's role changes to engineering_manager mid-session (votes already
  // locked in before the promotion are preserved — see sessions.ts's lock-in
  // handler comment), so the row's mere existence is not sufficient. Reject
  // if EITHER users.global_role OR team_memberships.role is
  // 'engineering_manager' at the moment of THIS check — mirroring the exact
  // same dual check sessions.ts's participant-registration and lock-in
  // handlers already perform. Without this, a participant promoted to EM
  // while connected would keep receiving session_state_change /
  // vote_readiness_update indefinitely, which the delivery-time model exists
  // specifically to prevent.
  // ---------------------------------------------------------------------------
  if (
    row.participant_row_id !== null &&
    row.membership_exists &&
    row.membership_removed_at === null &&
    row.global_role !== "engineering_manager" &&
    row.membership_role !== "engineering_manager"
  ) {
    return {
      path: "participant",
      sessionId: row.session_id,
      teamId: row.team_id,
      actorGlobalRole: row.global_role,
    };
  }

  // No path matched — caller has no access to this session's live events.
  return null;
}
