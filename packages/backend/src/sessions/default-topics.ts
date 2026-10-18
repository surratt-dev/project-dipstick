import type { PoolClient } from "pg";

// ---------------------------------------------------------------------------
// Canonical default topics -- the sentinel __default_topics__ template team
//
// The canonical default topic set lives as is_default rows on this team
// (migrations 4/11). This module owns the one definition of that set, so the
// two consumers (the team-creation copy and the restore list in content.ts)
// cannot drift (harden-team-creation-topic-copy #215, design.md D1/D2):
//   - DEFAULT_TOPICS_TEAM_ID, the sentinel id (session-topics-snapshot-at-
//     creation design.md Decision 4);
//   - canonicalDefaultsWhere(), the SQL predicate for "canonical default";
//   - copyCanonicalDefaults(), the copy POST /api/v1/teams runs.
// Not a route; routes/ holds only Fastify route plugins.
// ---------------------------------------------------------------------------
export const DEFAULT_TOPICS_TEAM_ID = "00000000-0000-0000-0000-000000000001";

/**
 * The SQL predicate for the canonical default set: the template team's rows
 * that are defaults AND active. The template id is always a bound parameter
 * at $paramIndex.
 *
 * SAFETY: this string is interpolated into SQL. Never interpolate a value
 * into it, and never widen `alias` to `string`. The closed union is what lets
 * the compiler reject a request-derived string at the call site. "t" (the
 * team-side alias in content.ts) is deliberately excluded so the predicate
 * cannot be applied to a team's own rows.
 */
export function canonicalDefaultsWhere(alias: "dt" | "topics", paramIndex: number): string {
  if (!Number.isInteger(paramIndex) || paramIndex < 1) {
    throw new Error("canonicalDefaultsWhere: paramIndex must be an integer >= 1");
  }
  return `${alias}.team_id = $${paramIndex} AND ${alias}.is_default = true AND ${alias}.status = 'active'`;
}

/**
 * Copy the canonical defaults into a new team on the caller's transaction
 * client. Positions are renumbered 1..n in (display_order, id) order, so the
 * new team never depends on template position values (gaps, duplicates).
 * The column list stays explicit: team_annotation, annotation_updated_by and
 * annotation_updated_at are deliberately excluded so a new team never
 * inherits a definition from the template (topic-annotation Decision 9).
 *
 * Returns the ids of the rows it inserted (#200), so a caller that needs the
 * count (assign-defaults' topicCount and audit topic_count) reads exactly
 * what was written, with no second query. POST /api/v1/teams ignores the
 * return value and still relies on snapshotSessionTopics to reject an empty
 * copy. An empty template inserts nothing and returns []; deciding what that
 * means is the caller's job.
 *
 * sourceTeamId is a test seam only (bound as $2, never interpolated); the
 * route never passes it.
 */
export async function copyCanonicalDefaults(
  client: PoolClient,
  newTeamId: string,
  sourceTeamId: string = DEFAULT_TOPICS_TEAM_ID,
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO topics
       (team_id, name, prompt, vote_type, display_order, is_default, first_session_description)
     SELECT $1, name, prompt, vote_type,
            row_number() OVER (ORDER BY display_order, id), is_default, first_session_description
     FROM topics
     WHERE ${canonicalDefaultsWhere("topics", 2)}
     RETURNING id`,
    [newTeamId, sourceTeamId],
  );
  return result.rows.map((row) => row.id);
}

/**
 * Thrown by assign-defaults when the template has no active default topics
 * (the copy inserted zero rows). Deliberately a sibling of
 * NoActiveTopicsError, which formats a session id into its message: this one
 * takes no argument, and its message holds no session, team or template id,
 * so it is safe to log and cannot leak into a response.
 */
export class DefaultTopicsUnavailableError extends Error {
  constructor() {
    super("The default topic set has no active topics to copy.");
    this.name = "DefaultTopicsUnavailableError";
  }
}
