import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { Fixture, probeInfra, requireInfraOrThrow } from "../../routes/__tests__/helpers/real-db.js";
import { DEFAULT_TOPICS_TEAM_ID } from "../../sessions/default-topics.js";
import type { db as Db } from "../../db.js";

// ---------------------------------------------------------------------------
// template-team-not-usable (#214) tasks.md 1.3, real Postgres, `public`.
//
// Migration 23's three <table>_not_template_team CHECKs refuse a template row
// on every INSERT and on an UPDATE that moves a real team's row onto the
// template (specs/default-topic-provisioning "A fresh database validates all
// three constraints" and "A database with historical template rows still
// enforces the constraint"). Runs after CI's migrations; needs no scratch
// schema. Every probe runs in a rolled-back transaction, so a missing
// constraint can never leave a template row behind.
//
// convalidated is deliberately not asserted here: a developer database with
// leftover template rows legitimately keeps the constraints NOT VALID
// (design.md D9). The migration test asserts it in a scratch schema.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "template-team-constraint-integration.test.ts");

interface Refusal {
  code: string | undefined;
  constraint: string | undefined;
}

/** Runs `sql` in a rolled-back transaction; the error's SQLSTATE and constraint, or null on success. */
async function refusalOf(db: typeof Db, sql: string, params: unknown[]): Promise<Refusal | null> {
  const client: pg.PoolClient = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql, params);
    return null;
  } catch (err) {
    const e = err as { code?: string; constraint?: string };
    return { code: e.code, constraint: e.constraint };
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

describe.skipIf(!infraUp)("the database refuses template sessions, memberships and join links (#214 1.3)", () => {
  let db: typeof Db;
  let fixture: Fixture;
  let userId: string;
  let realTeamId: string;

  beforeAll(async () => {
    ({ db } = await import("../../db.js"));
    fixture = new Fixture(db);
    userId = await fixture.user("facilitator");
    realTeamId = await fixture.team(userId);
  });

  afterAll(async () => {
    await fixture?.cleanup();
  });

  it("a template INSERT into sessions fails with 23514 (sessions_not_template_team)", async () => {
    expect(
      await refusalOf(
        db,
        `INSERT INTO sessions (team_id, facilitator_id, status, is_first_session, session_number)
         VALUES ($1, $2, 'draft', false, 1)`,
        [DEFAULT_TOPICS_TEAM_ID, userId],
      ),
    ).toEqual({ code: "23514", constraint: "sessions_not_template_team" });
  });

  it("a template INSERT into team_memberships fails with 23514 (team_memberships_not_template_team)", async () => {
    expect(
      await refusalOf(db, `INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, 'participant')`, [
        DEFAULT_TOPICS_TEAM_ID,
        userId,
      ]),
    ).toEqual({ code: "23514", constraint: "team_memberships_not_template_team" });
  });

  it("a template INSERT into join_links fails with 23514 (join_links_not_template_team)", async () => {
    expect(
      await refusalOf(
        db,
        `INSERT INTO join_links (team_id, token, created_by, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '1 day')`,
        [DEFAULT_TOPICS_TEAM_ID, `constraint-probe-${randomUUID()}`, userId],
      ),
    ).toEqual({ code: "23514", constraint: "join_links_not_template_team" });
  });

  it("UPDATE sessions SET team_id = <template> on a real team's session fails with 23514", async () => {
    const sessionId = await fixture.session(realTeamId, userId, "complete");
    expect(
      await refusalOf(db, `UPDATE sessions SET team_id = $1 WHERE id = $2`, [DEFAULT_TOPICS_TEAM_ID, sessionId]),
    ).toEqual({ code: "23514", constraint: "sessions_not_template_team" });
    const row = await db.query<{ team_id: string }>(`SELECT team_id FROM sessions WHERE id = $1`, [sessionId]);
    expect(row.rows[0]!.team_id).toBe(realTeamId);
  });

  it("the same writes on a real team succeed (the constraint names only the template)", async () => {
    expect(
      await refusalOf(db, `INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, 'participant')`, [
        realTeamId,
        userId,
      ]),
    ).toBeNull();
    expect(
      await refusalOf(
        db,
        `INSERT INTO join_links (team_id, token, created_by, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '1 day')`,
        [realTeamId, `constraint-probe-${randomUUID()}`, userId],
      ),
    ).toBeNull();
  });
});
