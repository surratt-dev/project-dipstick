import type { PoolClient } from "pg";

// ---------------------------------------------------------------------------
// Session topic snapshot — session-topics-snapshot-at-creation (#175)
//
// The single place session_topics rows are written. A session's topic list
// is snapshotted at ROOM OPEN: the moment its status first becomes 'lobby'
// (POST /advance from draft, or POST /api/v1/teams directly into lobby), and
// at no other time (session-topic-lifecycle spec). Both route callers use
// this module; neither duplicates the statement.
// ---------------------------------------------------------------------------

type QueryClient = Pick<PoolClient, "query">;

/**
 * The canonical per-team advisory-lock key expression (design.md Decision
 * 2a). The ::uuid cast canonicalises the key: Postgres accepts an upper-case
 * UUID in `WHERE id = $1`, but hashtext('ABC…') and hashtext('abc…') are
 * different locks. Every structural topic write (add, archive, restore,
 * reorder) and room open take this one key. Exported so the real-DB test
 * helper that gates concurrency on the lock reuses it rather than retyping it.
 */
export const TEAM_TOPICS_LOCK_KEY_SQL = "hashtext($1::uuid::text)";

export const LOCK_TEAM_TOPICS_SQL = `SELECT pg_advisory_xact_lock(${TEAM_TOPICS_LOCK_KEY_SQL})`;

/**
 * Takes the team's transaction-scoped topic lock. Callers validate the team
 * id (existence or session-row match) before calling, so the ::uuid cast
 * never raises 22P02 on user input.
 */
export async function lockTeamTopics(client: QueryClient, teamId: string): Promise<void> {
  await client.query(LOCK_TEAM_TOPICS_SQL, [teamId]);
}

/** Thrown when the snapshot would insert zero rows (no active topics). */
export class NoActiveTopicsError extends Error {
  constructor(sessionId: string) {
    super(`Session ${sessionId} has no active topics to snapshot.`);
    this.name = "NoActiveTopicsError";
  }
}

const SNAPSHOT_SQL = `
  INSERT INTO session_topics
    (session_id, topic_id, display_order, topic_name, topic_prompt, vote_type, topic_annotation, status)
  SELECT s.id, t.id,
         row_number() OVER (ORDER BY t.display_order, t.id),
         t.name, t.prompt, t.vote_type, t.team_annotation, 'waiting'
  FROM sessions s
  JOIN topics t ON t.team_id = s.team_id AND t.status = 'active'
  WHERE s.id = $1
  RETURNING topic_id, display_order`;

/**
 * Writes the session's session_topics snapshot from its team's active
 * topics, renumbered 1..N in (display_order, id) order, and returns the
 * snapshotted topics.id values in snapshot order (design.md Decision 2).
 *
 * Contract:
 * - Takes a session id ONLY. The source team is the session row's team_id,
 *   joined inside the statement, so no caller can copy one team's topic
 *   names, prompts, or annotations into another team's session.
 * - The caller MUST already hold lockTeamTopics for the session's team,
 *   taken in an EARLIER statement of the same transaction. Under READ
 *   COMMITTED the INSERT ... SELECT takes its snapshot when the statement
 *   starts, so a structural topic write that committed while the caller
 *   waited on the lock is visible to it.
 * - The insert MUST stay a single statement. Annotation edits (TOPIC-007)
 *   do not take the team lock; per-row consistency with them comes from the
 *   single statement-level MVCC snapshot. Splitting this into a count plus
 *   an insert, or several inserts, breaks that guarantee.
 * - Zero inserted rows throws NoActiveTopicsError. Any other error (for
 *   example a 23505 from constraint drift) propagates unchanged; callers
 *   roll back and rethrow, and never format a database error into a
 *   response.
 */
export async function snapshotSessionTopics(
  client: QueryClient,
  sessionId: string,
): Promise<{ topicIds: string[] }> {
  const result = await client.query<{ topic_id: string; display_order: number }>(SNAPSHOT_SQL, [sessionId]);

  if (result.rows.length === 0) {
    throw new NoActiveTopicsError(sessionId);
  }

  // RETURNING order is not guaranteed; display_order is.
  const topicIds = [...result.rows]
    .sort((a, b) => Number(a.display_order) - Number(b.display_order))
    .map((row) => row.topic_id);

  return { topicIds };
}
