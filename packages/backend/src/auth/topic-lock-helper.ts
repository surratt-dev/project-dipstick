import { db } from "../db.js";

// ---------------------------------------------------------------------------
// topicLockHelper — hasCompletedFirstSession(teamId)
//
// topic-customization-lock-and-add-custom-topic (#49/#50), design.md
// Decision 1.
//
// The single, reusable function that determines whether a team's topic
// configuration is customizable ("unlocked"). A team is unlocked if and
// only if it has at least one session with status = 'complete'.
//
// This is a live, uncached SELECT on every call -- no caching layer, at any
// level, for any duration. This mirrors team-content-access-helper.ts's
// evaluateTeamAccess: the read-side isCustomizationLocked flag
// (content.ts's GET /api/v1/teams/:teamId/topics) and the write-side lock
// gate (topics.ts's POST /api/v1/teams/:teamId/topics) both call this same
// function -- no handler is permitted to inline its own COUNT(*)/EXISTS
// query against sessions.status = 'complete'. Two independently written
// queries computing the same derived fact is exactly how drift happens
// (design.md Decision 1's "Why").
//
// No row-level locking is applied (design.md Decision 6) -- a plain read is
// sufficient because the only race this could lose is a false negative (a
// request evaluated microseconds before a session completes is rejected as
// locked, even though the team unlocks microseconds later), never a false
// positive that could let an edit through against a genuinely-still-locked
// team.
// ---------------------------------------------------------------------------
export async function hasCompletedFirstSession(teamId: string): Promise<boolean> {
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM sessions WHERE team_id = $1 AND status = 'complete'`,
    [teamId],
  );

  const count = parseInt((result.rows[0] as { count: string }).count, 10);
  return count > 0;
}
