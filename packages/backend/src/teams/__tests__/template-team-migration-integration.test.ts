import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { probeInfra, requireInfraOrThrow } from "../../routes/__tests__/helpers/real-db.js";
import { DEFAULT_TOPICS_TEAM_ID } from "../../sessions/default-topics.js";
import { FACILITATOR_GRANT_SQL } from "../../auth/team-content-access-helper.js";
import { LIVE_FACILITATOR_STATUSES } from "../../auth/session-subscriber-access-helper.js";
import type { db as Db } from "../../db.js";

// ---------------------------------------------------------------------------
// template-team-not-usable (#214) tasks.md 1.4 and 1.5, real Postgres:
// migration 23 against scratch copies of sessions, team_memberships,
// join_links, votes and audit_log.
//
// The integration lane has already migrated `public`, and its validated
// constraints refuse the history this test needs, so (as in
// auth/__tests__/users-roles-schema-integration.test.ts) the Up section is
// sliced out of the file and run with `search_path` pointing at a scratch
// schema first. The scratch tables are LIKE copies of public's (no foreign
// keys) minus the _not_template_team CHECKs, i.e. the pre-23 shape.
//
// design-review B1, option (a): the facilitator-access scenario is asserted
// at the data level. The app's pool cannot see the scratch schema, so the
// exact production path-3 predicate (FACILITATOR_GRANT_SQL) is run against it
// instead, plus the rows evaluateSessionSubscriberAccess admits on
// (LIVE_FACILITATOR_STATUSES, removed_at IS NULL). convalidated is asserted
// only here (design.md D9).
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "template-team-migration-integration.test.ts");

const MIGRATION_23 = fileURLToPath(
  new URL("../../../migrations/23_template_team_not_a_subject.sql", import.meta.url),
);
const TEMPLATE = DEFAULT_TOPICS_TEAM_ID;
const TABLES = ["sessions", "team_memberships", "join_links"] as const;

async function sections(): Promise<{ up: string; down: string }> {
  const sql = await readFile(MIGRATION_23, "utf8");
  const upIndex = sql.indexOf("-- Up Migration");
  const downIndex = sql.indexOf("-- Down Migration");
  expect(upIndex).toBeGreaterThanOrEqual(0);
  expect(downIndex).toBeGreaterThan(upIndex);
  return { up: sql.slice(upIndex, downIndex), down: sql.slice(downIndex) };
}

function scratchName(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

type Runner = Pick<pg.PoolClient, "query">;

/** Pre-23 copies of the tables migration 23 touches or writes. */
async function createScratchTables(runner: Runner, schema: string): Promise<void> {
  await runner.query(`CREATE SCHEMA ${schema}`);
  for (const table of [...TABLES, "votes", "audit_log"]) {
    await runner.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
  }
  for (const table of TABLES) {
    await runner.query(`ALTER TABLE ${schema}.${table} DROP CONSTRAINT IF EXISTS ${table}_not_template_team`);
  }
}

/** The SQLSTATE a statement fails with, or null when it succeeds (savepoint-wrapped). */
async function sqlState(client: pg.PoolClient, sql: string, params: unknown[] = []): Promise<string | null> {
  await client.query("SAVEPOINT probe");
  try {
    await client.query(sql, params);
    await client.query("RELEASE SAVEPOINT probe");
    return null;
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT probe");
    return (err as { code?: string }).code ?? "unknown";
  }
}

async function convalidated(runner: Runner, schema: string): Promise<Record<string, boolean>> {
  const res = await runner.query<{ relname: string; convalidated: boolean }>(
    `SELECT c.relname, con.convalidated
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND con.conname LIKE '%\\_not\\_template\\_team'`,
    [schema],
  );
  return Object.fromEntries(res.rows.map((r) => [r.relname, r.convalidated]));
}

/** The three template-refusing writes plus the move of a real-team session onto the template. */
const INSERT_TEMPLATE = {
  sessions: `INSERT INTO sessions (team_id, facilitator_id, status, is_first_session, session_number)
             VALUES ($1, $2, 'draft', false, 1)`,
  team_memberships: `INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, 'participant')`,
  join_links: `INSERT INTO join_links (team_id, token, created_by, expires_at)
               VALUES ($1, 'mig23-' || gen_random_uuid(), $2, NOW() + INTERVAL '1 day')`,
} as const;

async function pidOf(client: pg.PoolClient): Promise<number> {
  return (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
}

async function waitUntilWaitingOnLock(observer: typeof Db, pid: number, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await observer.query(`SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted`, [pid]);
    if ((res.rowCount ?? 0) > 0) return;
    if (Date.now() > deadline) throw new Error(`backend ${pid} never waited on a lock`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe.skipIf(!infraUp)("migration 23: template cleanup and constraints (real Postgres, #214 1.4/1.5)", () => {
  let db: typeof Db;

  beforeAll(async () => {
    ({ db } = await import("../../db.js"));
  });

  // -------------------------------------------------------------------------
  // 1.4 — history: open rows closed, terminal history kept, audited
  // -------------------------------------------------------------------------
  it("closes open template rows, keeps terminal history, clamps facilitator access, audits prior values, and enforces the NOT VALID constraints", async () => {
    const { up, down } = await sections();
    const schema = scratchName("mig23");
    const client = await db.connect();

    const facilitator = randomUUID();
    const member = randomUUID();
    const realTeam = randomUUID();
    const linkId = randomUUID();
    const membershipId = randomUUID();
    const lobbyId = randomUUID();
    const completeId = randomUUID();
    const realSessionId = randomUUID();
    const voteId = randomUUID();

    try {
      await client.query("BEGIN");
      await createScratchTables(client, schema);
      await client.query(`SET LOCAL search_path TO ${schema}, public`);

      // Seed (pre-23 shape, so template rows are accepted).
      await client.query(
        `INSERT INTO join_links (id, team_id, token, created_by, expires_at) VALUES ($1, $2, 'mig23-open', $3, NOW() + INTERVAL '7 days')`,
        [linkId, TEMPLATE, facilitator],
      );
      await client.query(`INSERT INTO team_memberships (id, team_id, user_id, role) VALUES ($1, $2, $3, 'participant')`, [
        membershipId,
        TEMPLATE,
        member,
      ]);
      await client.query(
        `INSERT INTO sessions (id, team_id, facilitator_id, status, is_first_session, session_number)
         VALUES ($1, $2, $3, 'lobby', false, 2)`,
        [lobbyId, TEMPLATE, facilitator],
      );
      await client.query(
        `INSERT INTO sessions (id, team_id, facilitator_id, status, is_first_session, session_number,
                               completed_at, facilitator_access_expires_at)
         VALUES ($1, $2, $3, 'complete', true, 1, NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 day')`,
        [completeId, TEMPLATE, facilitator],
      );
      await client.query(
        `INSERT INTO votes (id, session_id, session_topic_id, voter_id, vote_value, vote_type, revealed_at)
         VALUES ($1, $2, $3, $4, 3, 'finger', NOW() - INTERVAL '2 hours')`,
        [voteId, completeId, randomUUID(), member],
      );
      await client.query(
        `INSERT INTO sessions (id, team_id, facilitator_id, status, is_first_session, session_number)
         VALUES ($1, $2, $3, 'complete', true, 1)`,
        [realSessionId, realTeam, facilitator],
      );

      const completeBefore = (await client.query(`SELECT * FROM sessions WHERE id = $1`, [completeId])).rows[0];
      const votesBefore = (await client.query(`SELECT * FROM votes ORDER BY id`)).rows;
      const linkBefore = (await client.query(`SELECT * FROM join_links WHERE id = $1`, [linkId])).rows[0];

      // Path-3 grant exists before the migration (the hole this closes).
      expect((await client.query(FACILITATOR_GRANT_SQL, [facilitator, TEMPLATE])).rowCount).toBe(1);

      await client.query(up);
      const migratedAt = (await client.query<{ now: Date }>(`SELECT clock_timestamp() AS now`)).rows[0]!.now;

      // "Open template rows are closed and terminal history is kept"
      const link = (await client.query(`SELECT * FROM join_links WHERE id = $1`, [linkId])).rows[0];
      expect(link.revoked_at).not.toBeNull();
      expect({ ...link, revoked_at: null }).toEqual({ ...linkBefore, revoked_at: null });
      const membership = (await client.query(`SELECT removed_at FROM team_memberships WHERE id = $1`, [membershipId]))
        .rows[0];
      expect(membership.removed_at).not.toBeNull();
      const lobby = (await client.query(`SELECT status, abandoned_at FROM sessions WHERE id = $1`, [lobbyId])).rows[0];
      expect(lobby.status).toBe("abandoned");
      expect(lobby.abandoned_at).not.toBeNull();

      // "A recently completed template session no longer grants its facilitator
      // access" -- at the data level.
      const complete = (await client.query(`SELECT * FROM sessions WHERE id = $1`, [completeId])).rows[0];
      expect(complete.facilitator_access_expires_at.getTime()).toBeLessThanOrEqual(migratedAt.getTime());
      expect({ ...complete, facilitator_access_expires_at: null }).toEqual({
        ...completeBefore,
        facilitator_access_expires_at: null,
      });
      expect((await client.query(`SELECT * FROM votes ORDER BY id`)).rows).toEqual(votesBefore);
      expect((await client.query(FACILITATOR_GRANT_SQL, [facilitator, TEMPLATE])).rowCount).toBe(0);
      const live = await client.query(`SELECT 1 FROM sessions WHERE team_id = $1 AND status = ANY($2::session_status[])`, [
        TEMPLATE,
        [...LIVE_FACILITATOR_STATUSES],
      ]);
      expect(live.rowCount).toBe(0);
      const active = await client.query(`SELECT 1 FROM team_memberships WHERE team_id = $1 AND removed_at IS NULL`, [
        TEMPLATE,
      ]);
      expect(active.rowCount).toBe(0);
      // The real team's session is untouched.
      const real = (await client.query(`SELECT status, team_id FROM sessions WHERE id = $1`, [realSessionId])).rows[0];
      expect(real).toEqual({ status: "complete", team_id: realTeam });

      // "The cleanup is recorded with prior values": one row per changed table.
      const audit = await client.query<{
        actor_user_id: string;
        actor_global_role: string;
        actor_ip: string | null;
        team_id: string;
        metadata: { table: string; migration: string; rows: Array<Record<string, unknown>> };
      }>(
        `SELECT actor_user_id, actor_global_role, actor_ip, team_id, metadata FROM audit_log
          WHERE operation = 'team.template_cleanup' ORDER BY metadata->>'table'`,
      );
      expect(audit.rows.map((r) => r.metadata.table)).toEqual(["join_links", "sessions", "team_memberships"]);
      for (const row of audit.rows) {
        expect(row).toMatchObject({
          actor_user_id: TEMPLATE, // the seeded system user shares the template's id
          actor_global_role: "system",
          actor_ip: null,
          team_id: TEMPLATE,
        });
        expect(row.metadata.migration).toBe("23_template_team_not_a_subject");
      }
      const byTable = Object.fromEntries(audit.rows.map((r) => [r.metadata.table, r.metadata.rows]));
      expect(byTable["join_links"]).toEqual([{ id: linkId, revoked_at: null }]);
      expect(byTable["team_memberships"]).toEqual([
        { id: membershipId, user_id: member, role: "participant", removed_at: null },
      ]);
      const sessionRows = [...byTable["sessions"]!].sort((a, b) => String(a["status"]).localeCompare(String(b["status"])));
      expect(sessionRows).toHaveLength(2);
      expect(sessionRows[0]).toMatchObject({ id: completeId, status: "complete" });
      expect(new Date(String(sessionRows[0]!["facilitator_access_expires_at"])).getTime()).toBe(
        (completeBefore.facilitator_access_expires_at as Date).getTime(),
      );
      expect(sessionRows[1]).toEqual({ id: lobbyId, status: "lobby", facilitator_access_expires_at: null });

      // History remains, so every constraint stays NOT VALID but enforced.
      expect(await convalidated(client, schema)).toEqual({
        sessions: false,
        team_memberships: false,
        join_links: false,
      });
      expect(await sqlState(client, INSERT_TEMPLATE.sessions, [TEMPLATE, facilitator])).toBe("23514");
      expect(await sqlState(client, INSERT_TEMPLATE.team_memberships, [TEMPLATE, randomUUID()])).toBe("23514");
      expect(await sqlState(client, INSERT_TEMPLATE.join_links, [TEMPLATE, facilitator])).toBe("23514");
      expect(await sqlState(client, `UPDATE sessions SET team_id = $1 WHERE id = $2`, [TEMPLATE, realSessionId])).toBe(
        "23514",
      );
      // A frozen template row cannot be re-opened either (design.md D4, A1).
      expect(await sqlState(client, `UPDATE sessions SET status = 'lobby' WHERE id = $1`, [lobbyId])).toBe("23514");

      // Down drops exactly the constraints; the cleanup stays.
      await client.query(down);
      expect(await convalidated(client, schema)).toEqual({});
      expect((await client.query(`SELECT status FROM sessions WHERE id = $1`, [lobbyId])).rows[0].status).toBe(
        "abandoned",
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("validates every constraint when no template row exists (fresh database)", async () => {
    const { up } = await sections();
    const schema = scratchName("mig23v");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await createScratchTables(client, schema);
      await client.query(`SET LOCAL search_path TO ${schema}, public`);
      await client.query(up);
      expect(await convalidated(client, schema)).toEqual({
        sessions: true,
        team_memberships: true,
        join_links: true,
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  // -------------------------------------------------------------------------
  // 1.4 — the lock: a concurrent template INSERT waits, then is refused.
  // Needs a committed scratch schema that a second connection can see.
  // -------------------------------------------------------------------------
  it(
    "a concurrent template INSERT waits on the migration's lock and is then refused with 23514",
    async () => {
      const { up } = await sections();
      const schema = scratchName("mig23l");
      const migrator = await db.connect();
      const writer = await db.connect();
      try {
        await createScratchTables(db, schema);

        await migrator.query("BEGIN");
        await migrator.query(`SET LOCAL search_path TO ${schema}, public`);
        await migrator.query(up); // holds ACCESS EXCLUSIVE on the three tables until COMMIT

        const writerPid = await pidOf(writer);
        const insert = writer
          .query(
            `INSERT INTO ${schema}.sessions (team_id, facilitator_id, status, is_first_session, session_number)
             VALUES ($1, $2, 'draft', false, 1)`,
            [TEMPLATE, randomUUID()],
          )
          .then(
            () => null,
            (err: { code?: string }) => err.code ?? "unknown",
          );
        await waitUntilWaitingOnLock(db, writerPid);

        await migrator.query("COMMIT");
        expect(await insert).toBe("23514");
        const rows = await db.query(`SELECT 1 FROM ${schema}.sessions WHERE team_id = $1`, [TEMPLATE]);
        expect(rows.rowCount).toBe(0);
      } finally {
        await migrator.query("ROLLBACK").catch(() => undefined);
        migrator.release();
        writer.release();
        await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      }
    },
    30_000,
  );

  // -------------------------------------------------------------------------
  // 1.5 — no template rows: the migration changes nothing and audits nothing
  // -------------------------------------------------------------------------
  it("is a no-op without template rows: no row changes and no team.template_cleanup row", async () => {
    const { up } = await sections();
    const schema = scratchName("mig23n");
    const client = await db.connect();
    const realTeam = randomUUID();
    const user = randomUUID();
    try {
      await client.query("BEGIN");
      await createScratchTables(client, schema);
      await client.query(`SET LOCAL search_path TO ${schema}, public`);
      await client.query(
        `INSERT INTO join_links (team_id, token, created_by, expires_at) VALUES ($1, 'mig23-real', $2, NOW() + INTERVAL '7 days')`,
        [realTeam, user],
      );
      await client.query(`INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, 'participant')`, [
        realTeam,
        user,
      ]);
      await client.query(
        `INSERT INTO sessions (team_id, facilitator_id, status, is_first_session, session_number)
         VALUES ($1, $2, 'lobby', false, 2)`,
        [realTeam, user],
      );
      await client.query(
        `INSERT INTO sessions (team_id, facilitator_id, status, is_first_session, session_number,
                               completed_at, facilitator_access_expires_at)
         VALUES ($1, $2, 'complete', true, 1, NOW(), NOW() + INTERVAL '30 minutes')`,
        [realTeam, user],
      );

      async function snapshot() {
        const out: Record<string, unknown[]> = {};
        for (const table of TABLES) {
          out[table] = (await client.query(`SELECT *, xmin::text AS row_version FROM ${table} ORDER BY id`)).rows;
        }
        return out;
      }
      const before = await snapshot();

      await client.query(up);

      // xmin is unchanged too, so no row was even rewritten with equal values.
      expect(await snapshot()).toEqual(before);
      const audit = await client.query(`SELECT 1 FROM audit_log WHERE operation = 'team.template_cleanup'`);
      expect(audit.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
