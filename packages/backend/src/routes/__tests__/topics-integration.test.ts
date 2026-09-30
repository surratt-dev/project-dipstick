import { describe, it, expect, beforeAll } from "vitest";
import pg from "pg";
import Fastify from "fastify";

// ---------------------------------------------------------------------------
// Real Postgres coverage for topic-customization-lock-and-add-custom-topic
// (tasks.md Task 7.2): the end-to-end flow across two real endpoints
// (content.ts's GET /topics and topics.ts's POST /topics) and the shared
// lock-check helper they both call.
//
// Follows action-items-integration.test.ts / default-topic-provisioning-
// integration.test.ts's established pattern exactly (self-skip when
// Postgres is unreachable, env var fallbacks matching .env.example, dynamic
// post-fallback imports). No db.js/config.js mocking anywhere in this file.
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
    `[topics-integration.test.ts] SKIPPED — Postgres (${DATABASE_URL.replace(/:[^:@]+@/, ":****@")}) not reachable. ` +
      "Run `docker compose up` (repo root) and re-run this file.",
  );
}

async function loadModules() {
  const { db } = await import("../../db.js");
  const { contentRoutes } = await import("../content.js");
  const { topicRoutes } = await import("../topics.js");
  return { db, contentRoutes, topicRoutes };
}

describe.skipIf(!dbUp)("topic-customization-lock-and-add-custom-topic — real Postgres end-to-end (tasks.md Task 7.2)", () => {
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
    app.register(mods.contentRoutes);
    app.register(mods.topicRoutes);
    return app.ready().then((a) => a);
  }

  it("7.2: create a team -> isCustomizationLocked: true and 409 on add-topic -> complete a session -> isCustomizationLocked: false and a successful add-topic", async () => {
    const { db } = mods;
    const facilitatorUserId = "b0000000-0000-0000-0000-000000000f01";
    const teamId = "b0000000-0000-0000-0000-000000000fa1";
    const sessionId = "b0000000-0000-0000-0000-000000000fb1";
    let createdTopicId: string | undefined;

    try {
      await db.query(
        `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
         VALUES ($1, $2, 'test-issuer', 'Topic Lock Integration Facilitator', $3, 'facilitator')`,
        [facilitatorUserId, `sub-${facilitatorUserId}`, `${facilitatorUserId}@example.com`],
      );
      await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
        teamId,
        "Topic Lock Integration Team",
        facilitatorUserId,
      ]);
      // A single non-complete session -- the team has never had a session
      // reach status = 'complete', so it starts locked.
      await db.query(
        `INSERT INTO sessions (id, team_id, facilitator_id, status, is_first_session, session_number)
         VALUES ($1, $2, $3, 'lobby', true, 1)`,
        [sessionId, teamId, facilitatorUserId],
      );

      const app = await buildApp(facilitatorUserId);

      // ---- Locked state ----
      const getLockedRes = await app.inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics` });
      expect(getLockedRes.statusCode).toBe(200);
      expect(getLockedRes.json().isCustomizationLocked).toBe(true);

      const postLockedRes = await app.inject({
        method: "POST",
        url: `/api/v1/teams/${teamId}/topics`,
        payload: { name: "Locked Test Topic", prompt: "Should be rejected while locked?", voteType: "finger" },
      });
      expect(postLockedRes.statusCode).toBe(409);
      expect(postLockedRes.json().error.code).toBe("TOPIC_CUSTOMIZATION_LOCKED");

      // No topic was created by the rejected request.
      const topicsAfterDenial = await db.query(`SELECT id FROM topics WHERE team_id = $1 AND name = $2`, [
        teamId,
        "Locked Test Topic",
      ]);
      expect(topicsAfterDenial.rows).toHaveLength(0);

      // A denial audit row was written.
      const denialAudit = await db.query(
        `SELECT id FROM audit_log WHERE team_id = $1 AND operation = 'topic.write_denied_locked'`,
        [teamId],
      );
      expect(denialAudit.rows.length).toBeGreaterThan(0);

      // ---- Complete the team's first session ----
      // facilitator_access_expires_at mirrors the real completion endpoint
      // (facilitator-sessions.ts POST .../complete, Task 8.8) -- without it,
      // the facilitator's own evaluateTeamAccess grant for GET /topics would
      // lapse the instant the session completes, which is not what this
      // test is exercising.
      await db.query(
        `UPDATE sessions
         SET status = 'complete', completed_at = NOW(), facilitator_access_expires_at = NOW() + INTERVAL '30 minutes'
         WHERE id = $1`,
        [sessionId],
      );

      // ---- Unlocked state ----
      const getUnlockedRes = await app.inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics` });
      expect(getUnlockedRes.statusCode).toBe(200);
      expect(getUnlockedRes.json().isCustomizationLocked).toBe(false);

      const postUnlockedRes = await app.inject({
        method: "POST",
        url: `/api/v1/teams/${teamId}/topics`,
        payload: { name: "Unlocked Test Topic", prompt: "Should succeed once unlocked?", voteType: "roman" },
      });
      expect(postUnlockedRes.statusCode).toBe(201);
      const body = postUnlockedRes.json() as { topicId: string; isDefault: boolean };
      expect(body.isDefault).toBe(false);
      createdTopicId = body.topicId;

      // The real row exists, active, non-default.
      const insertedTopic = await db.query<{ status: string; is_default: boolean; team_id: string }>(
        `SELECT status, is_default, team_id FROM topics WHERE id = $1`,
        [createdTopicId],
      );
      expect(insertedTopic.rows[0]).toMatchObject({ status: "active", is_default: false, team_id: teamId });

      // A success audit row was written, referencing this topic.
      const successAudit = await db.query<{ metadata: { topic_id: string } }>(
        `SELECT metadata FROM audit_log WHERE team_id = $1 AND operation = 'topic.custom_added'`,
        [teamId],
      );
      expect(successAudit.rows.length).toBeGreaterThan(0);
      expect(successAudit.rows.some((r) => r.metadata.topic_id === createdTopicId)).toBe(true);
    } finally {
      if (createdTopicId) {
        await db.query(`DELETE FROM topics WHERE id = $1`, [createdTopicId]);
      }
      await db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM sessions WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [facilitatorUserId]);
    }
  });

  // -------------------------------------------------------------------------
  // Task 5.7 (real-concurrency variant): design.md Decision 10's corrected
  // mitigation (pg_advisory_xact_lock, taken before the MAX(display_order)
  // read) exercised against a REAL Postgres instance with two genuinely
  // concurrent connections -- not two sequential calls against a mocked
  // single-threaded db.query. This is the test that would have failed
  // (23505 on topics_team_order, surfaced as an unhandled 500) against the
  // design's original, rejected `ORDER BY display_order DESC LIMIT 1 FOR
  // UPDATE` mitigation.
  // -------------------------------------------------------------------------
  it("5.7 (real Postgres): two genuinely concurrent Add Custom Topic requests against the same unlocked team both succeed with distinct displayOrder, no unhandled 500", async () => {
    const { db } = mods;
    const facilitatorUserId = "b0000000-0000-0000-0000-000000000f02";
    const teamId = "b0000000-0000-0000-0000-000000000fa2";
    const sessionId = "b0000000-0000-0000-0000-000000000fb2";
    const existingTopicId = "b0000000-0000-0000-0000-000000000fc2";

    try {
      await db.query(
        `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
         VALUES ($1, $2, 'test-issuer', 'Concurrency Integration Facilitator', $3, 'facilitator')`,
        [facilitatorUserId, `sub-${facilitatorUserId}`, `${facilitatorUserId}@example.com`],
      );
      await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
        teamId,
        "Concurrency Integration Team",
        facilitatorUserId,
      ]);
      // Unlocked from the start: one already-complete session.
      await db.query(
        `INSERT INTO sessions
           (id, team_id, facilitator_id, status, is_first_session, session_number, completed_at, facilitator_access_expires_at)
         VALUES ($1, $2, $3, 'complete', true, 1, NOW(), NOW() + INTERVAL '30 minutes')`,
        [sessionId, teamId, facilitatorUserId],
      );
      // One pre-existing active topic at display_order 0, so the race is
      // over "who gets display_order 1" -- not the zero-active-topics edge
      // case (design.md Decision 10's residual-gap note).
      await db.query(
        `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status, is_default)
         VALUES ($1, $2, 'Existing Topic', 'Existing prompt?', 'finger', 0, 'active', false)`,
        [existingTopicId, teamId],
      );

      const app = await buildApp(facilitatorUserId);

      const [resA, resB] = await Promise.all([
        app.inject({
          method: "POST",
          url: `/api/v1/teams/${teamId}/topics`,
          payload: { name: "Concurrent Topic A", prompt: "Concurrent prompt A?", voteType: "finger" },
        }),
        app.inject({
          method: "POST",
          url: `/api/v1/teams/${teamId}/topics`,
          payload: { name: "Concurrent Topic B", prompt: "Concurrent prompt B?", voteType: "finger" },
        }),
      ]);

      expect(resA.statusCode).toBe(201);
      expect(resB.statusCode).toBe(201);

      const displayOrders = [resA.json().displayOrder, resB.json().displayOrder].sort();
      expect(displayOrders).toEqual([1, 2]);

      const activeTopics = await db.query(
        `SELECT display_order FROM topics WHERE team_id = $1 AND status = 'active' ORDER BY display_order`,
        [teamId],
      );
      expect(activeTopics.rows.map((r) => (r as { display_order: number }).display_order)).toEqual([0, 1, 2]);
    } finally {
      await db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM topics WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM sessions WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [facilitatorUserId]);
    }
  });
});
