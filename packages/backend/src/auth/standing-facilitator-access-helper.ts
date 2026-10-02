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
//   - The topic-write endpoints in topics.ts (TOPIC-003..007), via
//     checkStandingFacilitatorOrAdminAuthorization below or the
//     facilitator-only checkStandingFacilitatorAuthorization (TOPIC-007),
//     reusing the query verbatim rather than writing another independent
//     copy of it.
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

// ---------------------------------------------------------------------------
// checkStandingFacilitatorOrAdminAuthorization(userId, teamId)
//
// remove-topic, design.md Decision 1 (engineer-review correction, Finding
// 1, BLOCKING).
//
// A second, decision-only policy wrapper around evaluateStandingFacilitatorAccess,
// for endpoints that must also admit application_admin (FR-8.2 [HARD]):
// TOPIC-002 (content.ts) and TOPIC-003/004/005/006 (topics.ts, each through
// its own per-endpoint wrapper; TOPIC-003 joined in #176). Contrast
// checkStandingFacilitatorAuthorization (topics.ts), which is
// facilitator-only and is used by TOPIC-007 alone (FR-8.7).
//
// Deliberately placed here rather than in topics.ts or content.ts: it has
// callers in two different route files (topics.ts and content.ts), and no
// route file in this codebase imports from
// another route file. Putting it in either would create an implicit
// dependency between two features meant to be independently reviewable.
//
// Deliberately decision-only, unlike checkStandingFacilitatorAuthorization's
// reply-writing shape: TOPIC-002 (a read) and TOPIC-004 (a destructive
// write) need different rejection wording, and no single message serves
// both correctly. This function takes no FastifyReply, writes no response,
// and does NOT call applyTimingFloor -- each caller is responsible for both
// of those itself, immediately before sending its own 403, on every branch
// this function can return `authorized: false` for.
// ---------------------------------------------------------------------------
export type StandingFacilitatorOrAdminDecision =
  | { authorized: true; actorGlobalRole: string }
  | { authorized: false; reason: "NOT_A_FACILITATOR" | "FACILITATOR_IS_TEAM_MEMBER" };

export async function checkStandingFacilitatorOrAdminAuthorization(
  userId: string,
  teamId: string,
): Promise<StandingFacilitatorOrAdminDecision> {
  const grant = await evaluateStandingFacilitatorAccess(userId, teamId);

  // No user row for the caller at all -- treated the same as "not a
  // facilitator", matching checkStandingFacilitatorAuthorization's existing
  // convention (no separate 401 branch for a nonexistent user row here; the
  // authenticated session middleware already guarantees one exists for any
  // normal request that reaches a caller of this function).
  if (grant === null) {
    return { authorized: false, reason: "NOT_A_FACILITATOR" };
  }

  if (grant.globalRole === "application_admin") {
    return { authorized: true, actorGlobalRole: grant.globalRole };
  }

  if (grant.globalRole !== "facilitator") {
    return { authorized: false, reason: "NOT_A_FACILITATOR" };
  }

  if (grant.isMember) {
    return { authorized: false, reason: "FACILITATOR_IS_TEAM_MEMBER" };
  }

  return { authorized: true, actorGlobalRole: grant.globalRole };
}
