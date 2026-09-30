import { db } from "../db.js";

// A minimal query surface shared by pg.Pool (db) and a pg.PoolClient
// (a connected transaction client) — lets this helper run either as a plain
// standalone read (the default, against the pool) or inside a caller's own
// transaction (by passing that transaction's connected client), without
// depending on the pg package's own types here.
interface Queryable {
  query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

// ---------------------------------------------------------------------------
// openActionItemsHelper — getOpenActionItemsForTopic(topicId, executor?)
//
// remove-topic, design.md Decision 5.
//
// "Does this topic have open action items" means joining across every
// session the topic has ever appeared in, not just the most recent one:
// action_items.session_topic_id is a nullable FK to session_topics, itself
// keyed by topic_id. This is new work, co-located here following
// topic-lock-helper.ts's pattern (one exported function, one file, no
// caching layer) rather than inlined into TOPIC-004's handler.
//
// Documented as intended for reuse by TOPIC-005/006/007 (out of scope for
// this change) — any future endpoint that needs to warn about a topic's open
// action items should call this function rather than writing a second copy
// of the query.
//
// TOPIC-004 (topics.ts) calls this twice inside its own advisory-lock-held
// transaction (once per Task 5.1's unconfirmed path, once per Task 5.2's
// confirm=true re-derivation) — the optional `executor` parameter lets both
// calls run on that transaction's connected client, so a confirm=true
// re-derivation genuinely reads the current, in-transaction state rather
// than a separate, out-of-transaction snapshot. It defaults to the plain
// pool (db) for any caller with no transaction of its own — a live, uncached
// SELECT on every call, matching every other authorization/state helper in
// this codebase.
// ---------------------------------------------------------------------------
export async function getOpenActionItemsForTopic(
  topicId: string,
  executor: Queryable = db,
): Promise<Array<{ actionItemId: string; description: string }>> {
  const result = await executor.query<{ id: string; description: string }>(
    `SELECT ai.id, ai.description
     FROM action_items ai
     JOIN session_topics st ON st.id = ai.session_topic_id
     WHERE st.topic_id = $1 AND ai.status = 'open'
     ORDER BY ai.created_at ASC`,
    [topicId],
  );

  return result.rows.map((row) => ({ actionItemId: row.id, description: row.description }));
}
