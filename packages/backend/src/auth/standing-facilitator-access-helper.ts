import { db } from "../db.js";

// ---------------------------------------------------------------------------
// standingFacilitatorAccessHelper — evaluateStandingFacilitatorAccess(userId, teamId)
//
// topic-customization-lock-and-add-custom-topic, design.md Decision 3 / Decision 9's
// engineer-review (M2) addendum.
//
// The standing, org-wide facilitator model (Philosophy 1) is used by two
// endpoints that need the identical `global_role` + "is this user an active
// member of this specific team" fact, read live in one round trip:
//
//   - POST /api/v1/teams/:teamId/sessions/draft (facilitator-sessions.ts,
//     session-creation-existing-team design.md Decision D1) -- the original
//     home of this exact query.
//   - POST /api/v1/teams/:teamId/topics (topics.ts, TOPIC-003) -- this
//     change's write endpoint, reusing the query verbatim rather than
//     writing a third independent copy of it (design.md Decision 9's
//     citation of the drift risk Decision 1 already states for the lock
//     check).
//
// Returns null when no user row exists for userId (caller does not exist).
// Otherwise returns the resolved global_role and whether the caller holds
// an active (removed_at IS NULL) team_memberships row for teamId.
//
// This is a live, uncached database read on every call -- no caching layer,
// matching every other authorization helper in this codebase
// (team-content-access-helper.ts, session-subscriber-access-helper.ts).
// ---------------------------------------------------------------------------
export async function evaluateStandingFacilitatorAccess(
  userId: string,
  teamId: string,
): Promise<{ globalRole: string; isMember: boolean } | null> {
  const result = await db.query<{ global_role: string; is_member: boolean }>(
    `SELECT u.global_role,
            (tm.id IS NOT NULL) AS is_member
     FROM users u
     LEFT JOIN team_memberships tm
           ON tm.user_id = u.id
          AND tm.team_id = $2
          AND tm.removed_at IS NULL
     WHERE u.id = $1`,
    [userId, teamId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const { global_role, is_member } = result.rows[0] as {
    global_role: string;
    is_member: boolean;
  };

  return { globalRole: global_role, isMember: is_member };
}
