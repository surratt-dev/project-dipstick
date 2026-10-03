import { expect } from "vitest";
import type { PoolClient } from "pg";
import { SENTINEL_TEAM_ID, type Db } from "./real-db.js";

// ---------------------------------------------------------------------------
// Template-team snapshot helper — reject-template-team-topic-writes (#188),
// design.md D4/D5, tasks.md 3.2.
//
// Used by the tests that send requests which COULD change the
// __default_topics__ template's topics rows if the template guard regressed
// (the structural route test and the team-creation regression). Each takes a
// snapshot first, asserts the template is unchanged after its requests, and
// restores the snapshot in a finally.
//
// Parallel files: default-topic-provisioning-integration.test.ts atomically
// swaps the template's is_default rows for a fixture set. restoreTemplate
// therefore deletes only non-default rows that are not in the snapshot (the
// only rows a topic-write regression can add, since TOPIC-003 inserts
// is_default = false), and only updates rows by snapshot id, so it never
// removes another file's fixture rows.
//
// Every function also accepts a checked-out client, so a caller can work
// inside its own uncommitted transaction (the helper's self-test does, and
// rolls back, so parallel files never snapshot its mutation -- architect
// implementation review B1).
// ---------------------------------------------------------------------------

/** The pool, or a client already inside the caller's transaction. */
type Queryable = Db | PoolClient;

export interface TemplateTopicRow {
  id: string;
  name: string;
  prompt: string;
  vote_type: string;
  display_order: number;
  status: string;
  is_default: boolean;
  archived_at: Date | null;
  archived_by: string | null;
  team_annotation: string | null;
  annotation_updated_by: string | null;
  annotation_updated_at: Date | null;
}

export type TemplateSnapshot = Map<string, TemplateTopicRow>;

async function templateRows(db: Queryable): Promise<TemplateTopicRow[]> {
  return (
    await db.query<TemplateTopicRow>(
      `SELECT id, name, prompt, vote_type, display_order, status, is_default,
              archived_at, archived_by, team_annotation, annotation_updated_by, annotation_updated_at
         FROM topics WHERE team_id = $1 ORDER BY id`,
      [SENTINEL_TEAM_ID],
    )
  ).rows;
}

/** Every template topics row, in every status, keyed by id. */
export async function snapshotTemplate(db: Queryable): Promise<TemplateSnapshot> {
  return new Map((await templateRows(db)).map((row) => [row.id, row]));
}

/** Same ids, no extra rows, same values. */
export async function assertTemplateUnchanged(db: Queryable, snap: TemplateSnapshot): Promise<void> {
  const rows = await templateRows(db);
  expect(rows.map((row) => row.id).sort()).toEqual([...snap.keys()].sort());
  for (const row of rows) {
    expect(row).toEqual(snap.get(row.id));
  }
}

/**
 * In one transaction: delete non-default template rows not in the snapshot,
 * reset status/archive/annotation fields, and restore display_order with the
 * negate-then-set two-step TOPIC-006 uses (a direct update can trip
 * topics_team_active_order mid-statement).
 *
 * Fields NOT restored: name, prompt, vote_type, is_default,
 * first_session_description, restored_*, created_at/updated_at. No
 * team-scoped topic-write endpoint changes the first five today, and
 * assertTemplateUnchanged would still catch it if one did. A future endpoint
 * that edits them (for example a rename-topic route) must extend this restore.
 *
 * With `client`, the statements run inside the caller's open transaction
 * (no BEGIN/COMMIT here); otherwise a pool client and its own transaction.
 */
export async function restoreTemplate(db: Db, snap: TemplateSnapshot, client?: PoolClient): Promise<void> {
  if (client) {
    await restoreStatements(client, snap);
    return;
  }
  const own = await db.connect();
  try {
    await own.query("BEGIN");
    await restoreStatements(own, snap);
    await own.query("COMMIT");
  } catch (err) {
    await own.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    own.release();
  }
}

async function restoreStatements(client: PoolClient, snap: TemplateSnapshot): Promise<void> {
  const ids = [...snap.keys()];
  await client.query(
    `DELETE FROM topics WHERE team_id = $1 AND is_default = false AND NOT (id = ANY($2::uuid[]))`,
    [SENTINEL_TEAM_ID, ids],
  );
  await client.query(
    `UPDATE topics SET display_order = -display_order - 1 WHERE team_id = $1 AND id = ANY($2::uuid[])`,
    [SENTINEL_TEAM_ID, ids],
  );
  for (const row of snap.values()) {
    await client.query(
      `UPDATE topics
          SET display_order = $3, status = $4::topic_status, archived_at = $5, archived_by = $6,
              team_annotation = $7, annotation_updated_by = $8, annotation_updated_at = $9
        WHERE team_id = $1 AND id = $2`,
      [
        SENTINEL_TEAM_ID,
        row.id,
        row.display_order,
        row.status,
        row.archived_at,
        row.archived_by,
        row.team_annotation,
        row.annotation_updated_by,
        row.annotation_updated_at,
      ],
    );
  }
}
