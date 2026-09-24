import { describe, it, expect, beforeAll, afterEach } from "vitest";
import pg from "pg";
import Fastify from "fastify";

// ---------------------------------------------------------------------------
// Real Postgres coverage for default-topic-provisioning (inline-team-creation,
// tasks.md 4.3/4.4/4.5). Follows action-items-integration.test.ts's
// established pattern exactly (self-skip when Postgres is unreachable, env
// var fallbacks matching .env.example, dynamic post-fallback imports). No
// db.js/config.js mocking anywhere in this file -- POST /api/v1/teams's real
// transaction, including its hardcoded read of the sentinel
// __default_topics__ team's topics rows, runs for real here.
//
// Three tests, three different claims (design.md D7):
//   4.3 -- the COPY MECHANISM is correct, against a controlled 12-topic
//     fixture, independent of whatever is actually seeded.
//   4.4 -- the mechanism is running against CORRECT DATA: queries the
//     actually-seeded sentinel rows and asserts the twelve AC-verbatim
//     topics. This is the real merge-gate test for the
//     fix-default-topic-seed-data prerequisite (proposal.md, tasks.md 1.1) --
//     it is EXPECTED TO FAIL against today's stale six-topic seed
//     (4_seed_data.sql) until that prerequisite change lands. Do not weaken
//     this test to make it pass early; a red result here is the intended
//     signal that the prerequisite has not merged yet.
//   4.5 -- the copy is a real, independent row, not a reference.
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] ??= "postgresql://dipstick:dipstick@localhost:5433/dipstick";
process.env["REDIS_URL"] ??= "redis://localhost:6380";
process.env["SESSION_SECRET"] ??= "integration-test-session-secret-32-chars-min";
process.env["OIDC_ISSUER"] ??= "http://localhost:4011";
process.env["OIDC_CLIENT_ID"] ??= "dipstick-local";
process.env["OIDC_CLIENT_SECRET"] ??= "dipstick-local-secret";
process.env["OIDC_REDIRECT_URI"] ??= "http://localhost:3000/auth/callback";
process.env["NODE_ENV"] ??= "test";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const PROBE_TIMEOUT_MS = 750;
const SENTINEL_TEAM_ID = "00000000-0000-0000-0000-000000000001";

async function isPostgresReachable(): Promise<boolean> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: PROBE_TIMEOUT_MS });
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

const dbUp = await isPostgresReachable();

if (!dbUp) {
  console.warn(
    `[default-topic-provisioning-integration.test.ts] SKIPPED — Postgres (${DATABASE_URL.replace(/:[^:@]+@/, ":****@")}) not reachable. ` +
      "Run `docker compose up` (repo root) and re-run this file.",
  );
}

async function loadModules() {
  const { db } = await import("../../db.js");
  const { facilitatorSessionRoutes } = await import("../facilitator-sessions.js");
  return { db, facilitatorSessionRoutes };
}

interface TopicRow {
  id: string;
  team_id: string;
  name: string;
  prompt: string;
  vote_type: string;
  display_order: number;
  is_default: boolean;
  first_session_description: string | null;
}

describe.skipIf(!dbUp)("default-topic-provisioning — real Postgres coverage (tasks.md 4.3/4.4/4.5)", () => {
  let mods: Awaited<ReturnType<typeof loadModules>>;

  beforeAll(async () => {
    mods = await loadModules();
  });

  function buildApp(userId: string) {
    const app = Fastify();
    app.decorateRequest("session", null);
    app.addHook("onRequest", async (request) => {
      (request as unknown as Record<string, unknown>).session = { userId };
    });
    app.register(mods.facilitatorSessionRoutes);
    return app.ready().then((a) => a);
  }

  async function makeFacilitator(db: typeof mods.db, userId: string): Promise<void> {
    await db.query(
      `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
       VALUES ($1, $2, 'test-issuer', 'Integration Test Facilitator', $3, 'facilitator')`,
      [userId, `sub-${userId}`, `${userId}@example.com`],
    );
  }

  async function cleanupTeam(db: typeof mods.db, teamId: string | undefined, userId: string): Promise<void> {
    if (teamId) {
      await db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM sessions WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM topics WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
    }
    await db.query(`DELETE FROM audit_log WHERE actor_user_id = $1`, [userId]);
    await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
  }

  // -------------------------------------------------------------------------
  // 4.3 -- copy-mechanism correctness against a controlled 12-topic fixture,
  // independent of whatever is actually seeded for the sentinel team.
  // -------------------------------------------------------------------------
  it("4.3: the copy mechanism preserves every field (name, prompt, vote_type, display_order, is_default, first_session_description) unmodified, for a controlled 12-topic fixture", async () => {
    const { db } = mods;
    const userId = "a0000000-0000-0000-0000-00000000c001";

    // Swap the sentinel team's is_default rows for a controlled fixture,
    // capturing the originals for restoration -- this test asserts the copy
    // MECHANISM is correct given known input, independent of whatever
    // content is actually seeded (see 4.4 for the real-data claim).
    const originalRows = (
      await db.query<TopicRow>(
        `SELECT id, team_id, name, prompt, vote_type, display_order, is_default, first_session_description
         FROM topics WHERE team_id = $1 AND is_default = true`,
        [SENTINEL_TEAM_ID],
      )
    ).rows;

    const fixture = Array.from({ length: 12 }, (_, i) => ({
      name: `Fixture Topic ${i + 1}`,
      prompt: `Fixture prompt for topic ${i + 1}?`,
      vote_type: i === 11 ? "modified_roman" : i % 4 === 0 ? "roman" : "finger",
      display_order: i + 1,
      is_default: true,
      first_session_description: i % 3 === 0 ? null : `Fixture first-session description ${i + 1}.`,
    }));

    let newTeamId: string | undefined;
    try {
      await db.query(`DELETE FROM topics WHERE team_id = $1 AND is_default = true`, [SENTINEL_TEAM_ID]);
      for (const t of fixture) {
        await db.query(
          `INSERT INTO topics (team_id, name, prompt, vote_type, display_order, is_default, first_session_description)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [SENTINEL_TEAM_ID, t.name, t.prompt, t.vote_type, t.display_order, t.is_default, t.first_session_description],
        );
      }

      await makeFacilitator(db, userId);
      const app = await buildApp(userId);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/teams",
        payload: { name: `Fixture Integration Team ${userId.slice(-6)}` },
      });

      expect(res.statusCode).toBe(201);
      newTeamId = res.json().teamId as string;

      const copiedRows = (
        await db.query<TopicRow>(
          `SELECT id, team_id, name, prompt, vote_type, display_order, is_default, first_session_description
           FROM topics WHERE team_id = $1 ORDER BY display_order`,
          [newTeamId],
        )
      ).rows;

      expect(copiedRows).toHaveLength(12);
      copiedRows.forEach((row, i) => {
        const expected = fixture[i]!;
        expect(row.name).toBe(expected.name);
        expect(row.prompt).toBe(expected.prompt);
        expect(row.vote_type).toBe(expected.vote_type);
        expect(row.display_order).toBe(expected.display_order);
        expect(row.is_default).toBe(true);
        expect(row.first_session_description).toBe(expected.first_session_description);
        expect(row.team_id).toBe(newTeamId);
        // A real, independent row -- its own generated id, not the source's.
        expect(row.id).not.toBe(originalRows[i]?.id);
      });
    } finally {
      await cleanupTeam(db, newTeamId, userId);

      // Restore the sentinel team's original rows.
      await db.query(`DELETE FROM topics WHERE team_id = $1 AND is_default = true`, [SENTINEL_TEAM_ID]);
      for (const r of originalRows) {
        await db.query(
          `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, is_default, first_session_description)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [r.id, r.team_id, r.name, r.prompt, r.vote_type, r.display_order, r.is_default, r.first_session_description],
        );
      }
    }
  });

  // -------------------------------------------------------------------------
  // 4.4 -- REAL-DATA integration test: the actual prerequisite merge gate
  // (design.md D7, proposal.md). Queries the actually-seeded sentinel-team
  // topics rows, no fixture substitution. Twelve AC-verbatim topics
  // (requirements/use cases/08 - Topic Management - Use Cases.md).
  //
  // fix-default-topic-seed-data (#161, PR #162) has merged: migration 11
  // replaces the stale six-topic seed with these twelve. This test passes
  // against real seeded data now, not just a fixture -- do not weaken this
  // assertion, it's still the thing that would catch a future regression in
  // the seed data (tasks.md 1.1/4.4).
  // -------------------------------------------------------------------------
  it("4.4 (real-data merge-gate, verified post fix-default-topic-seed-data): the actually-seeded sentinel topics are the twelve AC-verbatim topics, in canonical order", async () => {
    const { db } = mods;

    const CANONICAL_TOPICS: Array<{ prompt: string; voteType: string }> = [
      { prompt: "How easy is it to add features to production code?", voteType: "finger" },
      { prompt: "How easy is it to reason about production code?", voteType: "finger" },
      { prompt: "How would you rate the code under active development?", voteType: "finger" },
      { prompt: "How would you rate the code for the entirety of the project?", voteType: "finger" },
      { prompt: "Is the test suite effective?", voteType: "finger" },
      { prompt: "Is the test suite consistent?", voteType: "roman" },
      { prompt: "How would you rate the tests under active development?", voteType: "finger" },
      { prompt: "How would you rate the tests for the entirety of the project?", voteType: "finger" },
      { prompt: "Confidence in the pipeline", voteType: "finger" },
      { prompt: "Are you comfortable with the technology stack?", voteType: "roman" },
      { prompt: "How effective is pairing?", voteType: "finger" },
      { prompt: "Overall, is this project trending up, steady, or down?", voteType: "modified_roman" },
    ];

    const seededRows = (
      await db.query<{ name: string; prompt: string; vote_type: string; display_order: number; first_session_description: string | null }>(
        `SELECT name, prompt, vote_type, display_order, first_session_description
         FROM topics
         WHERE team_id = $1 AND is_default = true
         ORDER BY display_order`,
        [SENTINEL_TEAM_ID],
      )
    ).rows;

    expect(seededRows).toHaveLength(CANONICAL_TOPICS.length);
    seededRows.forEach((row, i) => {
      expect(row.prompt).toBe(CANONICAL_TOPICS[i]!.prompt);
      expect(row.vote_type).toBe(CANONICAL_TOPICS[i]!.voteType);
      expect(row.display_order).toBe(i + 1);
    });
  });

  // -------------------------------------------------------------------------
  // 4.5 -- the copy is a real, independent row, not a reference (design.md
  // D5). Two directions of independence.
  // -------------------------------------------------------------------------
  describe("4.5: copied topics are independent rows, not references to the sentinel source", () => {
    let userId: string;
    let teamId: string | undefined;

    afterEach(async () => {
      const { db } = mods;
      await cleanupTeam(db, teamId, userId);
      teamId = undefined;
    });

    it("(a) mutating/deleting a team's copied topic does not affect the sentinel team's source rows", async () => {
      const { db } = mods;
      userId = "a0000000-0000-0000-0000-00000000c002";

      const beforeSentinel = (
        await db.query<{ id: string; name: string }>(
          `SELECT id, name FROM topics WHERE team_id = $1 AND is_default = true ORDER BY display_order`,
          [SENTINEL_TEAM_ID],
        )
      ).rows;

      await makeFacilitator(db, userId);
      const app = await buildApp(userId);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/teams",
        payload: { name: `Independence Team A ${userId.slice(-6)}` },
      });
      expect(res.statusCode).toBe(201);
      teamId = res.json().teamId as string;

      const copiedFirst = (
        await db.query<{ id: string }>(
          `SELECT id FROM topics WHERE team_id = $1 ORDER BY display_order LIMIT 1`,
          [teamId],
        )
      ).rows[0] as { id: string };

      // Mutate, then delete, one of the new team's copied topics.
      await db.query(`UPDATE topics SET name = 'Mutated' WHERE id = $1`, [copiedFirst.id]);
      await db.query(`DELETE FROM topics WHERE id = $1`, [copiedFirst.id]);

      const afterSentinel = (
        await db.query<{ id: string; name: string }>(
          `SELECT id, name FROM topics WHERE team_id = $1 AND is_default = true ORDER BY display_order`,
          [SENTINEL_TEAM_ID],
        )
      ).rows;

      expect(afterSentinel).toEqual(beforeSentinel);
    });

    it("(b) a later change to a sentinel source row does not retroactively affect an already-created team's copy", async () => {
      const { db } = mods;
      userId = "a0000000-0000-0000-0000-00000000c003";

      await makeFacilitator(db, userId);
      const app = await buildApp(userId);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/teams",
        payload: { name: `Independence Team B ${userId.slice(-6)}` },
      });
      expect(res.statusCode).toBe(201);
      teamId = res.json().teamId as string;

      const copiedFirst = (
        await db.query<{ id: string; name: string }>(
          `SELECT id, name FROM topics WHERE team_id = $1 ORDER BY display_order LIMIT 1`,
          [teamId],
        )
      ).rows[0] as { id: string; name: string };
      const originalName = copiedFirst.name;

      const sentinelFirst = (
        await db.query<{ id: string; name: string }>(
          `SELECT id, name FROM topics WHERE team_id = $1 AND is_default = true ORDER BY display_order LIMIT 1`,
          [SENTINEL_TEAM_ID],
        )
      ).rows[0] as { id: string; name: string };

      try {
        await db.query(`UPDATE topics SET name = 'Retroactively Changed Default' WHERE id = $1`, [sentinelFirst.id]);

        const copiedFirstAfter = (
          await db.query<{ name: string }>(`SELECT name FROM topics WHERE id = $1`, [copiedFirst.id])
        ).rows[0] as { name: string };

        expect(copiedFirstAfter.name).toBe(originalName);
      } finally {
        await db.query(`UPDATE topics SET name = $2 WHERE id = $1`, [sentinelFirst.id, sentinelFirst.name]);
      }
    });
  });
});
