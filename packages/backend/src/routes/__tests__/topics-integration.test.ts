import { describe, it, expect, beforeAll, afterEach } from "vitest";
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

// ---------------------------------------------------------------------------
// reorder-topics, tasks.md group 1: migration 18 replaces the
// topics_team_order UNIQUE (team_id, display_order, status) constraint with
// a partial unique index on active rows only (design.md Decision 1,
// specs/remove-topic/spec.md "Display-order uniqueness applies only among a
// team's active topics").
// ---------------------------------------------------------------------------

/** Deterministic, valid UUID for a fixture: prefix block + 12-hex suffix. */
function fixtureId(prefix: string, n: number): string {
  return `${prefix}-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
}

describe.skipIf(!dbUp)("reorder-topics group 1 — active-only display_order uniqueness (migration 18)", () => {
  let mods: Awaited<ReturnType<typeof loadModules>>;

  beforeAll(async () => {
    mods = await loadModules();
  });

  const PREFIX = "c1000000";
  const facilitatorUserId = fixtureId(PREFIX, 0xf01);
  const teamId = fixtureId(PREFIX, 0xfa1);
  const sessionId = fixtureId(PREFIX, 0xfb1);

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

  /** An unlocked team with active topics at display_order 1..count. */
  async function seedUnlockedTeam(count: number): Promise<string[]> {
    const { db } = mods;
    await db.query(
      `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
       VALUES ($1, $2, 'test-issuer', 'Migration 18 Facilitator', $3, 'facilitator')`,
      [facilitatorUserId, `sub-${facilitatorUserId}`, `${facilitatorUserId}@example.com`],
    );
    await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
      teamId,
      "Migration 18 Integration Team",
      facilitatorUserId,
    ]);
    await db.query(
      `INSERT INTO sessions
         (id, team_id, facilitator_id, status, is_first_session, session_number, completed_at, facilitator_access_expires_at)
       VALUES ($1, $2, $3, 'complete', true, 1, NOW(), NOW() + INTERVAL '30 minutes')`,
      [sessionId, teamId, facilitatorUserId],
    );
    const ids: string[] = [];
    for (let i = 1; i <= count; i++) {
      const id = fixtureId(PREFIX, 0x100 + i);
      ids.push(id);
      await db.query(
        `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status, is_default)
         VALUES ($1, $2, $3, 'Prompt?', 'finger', $4, 'active', false)`,
        [id, teamId, `Topic ${i}`, i],
      );
    }
    return ids;
  }

  async function cleanup() {
    const { db } = mods;
    await db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
    await db.query(`DELETE FROM topics WHERE team_id = $1`, [teamId]);
    await db.query(`DELETE FROM sessions WHERE team_id = $1`, [teamId]);
    await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
    await db.query(`DELETE FROM users WHERE id = $1`, [facilitatorUserId]);
  }

  it("1.1: the archive, add, archive sequence no longer fails (archived rows no longer collide on display_order)", async () => {
    try {
      const ids = await seedUnlockedTeam(11);
      const app = await buildApp(facilitatorUserId);

      const archive11 = await app.inject({
        method: "DELETE",
        url: `/api/v1/teams/${teamId}/topics/${ids[10]}?confirm=true`,
      });
      expect(archive11.statusCode).toBe(200);

      const add = await app.inject({
        method: "POST",
        url: `/api/v1/teams/${teamId}/topics`,
        payload: { name: "Custom Eleven", prompt: "Takes position eleven?", voteType: "finger" },
      });
      expect(add.statusCode).toBe(201);
      expect(add.json().displayOrder).toBe(11);

      const archiveCustom = await app.inject({
        method: "DELETE",
        url: `/api/v1/teams/${teamId}/topics/${add.json().topicId}?confirm=true`,
      });
      expect(archiveCustom.statusCode).toBe(200);
    } finally {
      await cleanup();
    }
  });

  it("1.4: archiving a topic whose position an archived topic already holds succeeds", async () => {
    const { db } = mods;
    try {
      const ids = await seedUnlockedTeam(3);
      // An archived row already sitting at display_order 2.
      await db.query(
        `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status, is_default, archived_at)
         VALUES ($1, $2, 'Old Archived', 'Old?', 'finger', 2, 'archived', false, NOW())`,
        [fixtureId(PREFIX, 0x200), teamId],
      );
      const app = await buildApp(facilitatorUserId);

      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/teams/${teamId}/topics/${ids[1]}?confirm=true`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("archived");
    } finally {
      await cleanup();
    }
  });

  it("1.4: two active topics on the same team still cannot share a position (23505)", async () => {
    const { db } = mods;
    try {
      const ids = await seedUnlockedTeam(2);

      await expect(
        db.query(
          `INSERT INTO topics (team_id, name, prompt, vote_type, display_order, status, is_default)
           VALUES ($1, 'Duplicate Position', 'Dup?', 'finger', 1, 'active', false)`,
          [teamId],
        ),
      ).rejects.toMatchObject({ code: "23505" });

      await expect(
        db.query(`UPDATE topics SET display_order = 1 WHERE id = $1`, [ids[1]]),
      ).rejects.toMatchObject({ code: "23505" });
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// reorder-topics, tasks.md group 5: PUT /api/v1/teams/:teamId/topics/order
// (TOPIC-006) against real Postgres -- the partial unique index, the
// two-phase renumber, the advisory lock, audit rows, and session_topics
// isolation all need the real database.
// ---------------------------------------------------------------------------
describe.skipIf(!dbUp)("reorder-topics group 5 — PUT /topics/order real Postgres", () => {
  let mods: Awaited<ReturnType<typeof loadModules>>;

  beforeAll(async () => {
    mods = await loadModules();
  });

  const PREFIX = "c5000000";
  const facilitatorId = fixtureId(PREFIX, 0xf01);
  const facilitator2Id = fixtureId(PREFIX, 0xf02);
  const adminId = fixtureId(PREFIX, 0xad1);
  const teamId = fixtureId(PREFIX, 0xfa1);
  const otherTeamId = fixtureId(PREFIX, 0xfa2);
  const completedSessionId = fixtureId(PREFIX, 0xfb1);
  const openSessionId = fixtureId(PREFIX, 0xfb2);
  const SENTINEL_TEAM_ID = "00000000-0000-0000-0000-000000000001";
  const orderUrl = (id = teamId) => `/api/v1/teams/${id}/topics/order`;

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

  async function insertUser(id: string, role: string) {
    await mods.db.query(
      `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
       VALUES ($1, $2, 'test-issuer', 'Reorder Integration User', $3, $4)`,
      [id, `sub-${id}`, `${id}@example.com`, role],
    );
  }

  async function insertTopic(id: string, team: string, name: string, order: number, status = "active") {
    await mods.db.query(
      `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status, is_default, archived_at)
       VALUES ($1, $2, $3, 'Prompt?', 'finger', $4, $5::topic_status, false, CASE WHEN $5::text = 'archived' THEN NOW() END)`,
      [id, team, name, order, status],
    );
  }

  /** Unlocked team (one completed session) with active topics at the given display_order values. */
  async function seed(orders: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]): Promise<string[]> {
    const { db } = mods;
    await insertUser(facilitatorId, "facilitator");
    await insertUser(facilitator2Id, "facilitator");
    await insertUser(adminId, "application_admin");
    await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3), ($4, $5, $3)`, [
      teamId,
      "Reorder Integration Team",
      facilitatorId,
      otherTeamId,
      "Reorder Integration Other Team",
    ]);
    await db.query(
      `INSERT INTO sessions
         (id, team_id, facilitator_id, status, is_first_session, session_number, completed_at, facilitator_access_expires_at)
       VALUES ($1, $2, $3, 'complete', true, 1, NOW(), NOW() + INTERVAL '30 minutes')`,
      [completedSessionId, teamId, facilitatorId],
    );
    const ids: string[] = [];
    for (const [index, order] of orders.entries()) {
      const id = fixtureId(PREFIX, 0x100 + index + 1);
      ids.push(id);
      await insertTopic(id, teamId, `Topic ${index + 1}`, order);
    }
    return ids;
  }

  async function activeOrder(team = teamId): Promise<Array<{ id: string; display_order: number }>> {
    const res = await mods.db.query<{ id: string; display_order: number }>(
      `SELECT id, display_order FROM topics WHERE team_id = $1 AND status = 'active' ORDER BY display_order`,
      [team],
    );
    return res.rows;
  }

  async function allTopicRows(team = teamId) {
    const res = await mods.db.query(`SELECT * FROM topics WHERE team_id = $1 ORDER BY id`, [team]);
    return res.rows;
  }

  async function reorderAuditRows() {
    const res = await mods.db.query<{ metadata: { previous_order: string[]; new_order: string[] } }>(
      `SELECT metadata FROM audit_log WHERE team_id = $1 AND operation = 'topic.reordered' ORDER BY "timestamp", id`,
      [teamId],
    );
    return res.rows;
  }

  async function putOrder(userId: string, orderedTopicIds: string[], team = teamId) {
    const app = await buildApp(userId);
    return app.inject({ method: "PUT", url: orderUrl(team), payload: { orderedTopicIds } });
  }

  afterEach(async () => {
    const { db } = mods;
    await db.query(`DROP TRIGGER IF EXISTS reorder_test_fail_phase2 ON topics`);
    await db.query(`DROP FUNCTION IF EXISTS reorder_test_fail_phase2()`);
    await db.query(`DELETE FROM audit_log WHERE team_id = ANY($1::uuid[]) OR actor_user_id = ANY($2::uuid[])`, [
      [teamId, otherTeamId, SENTINEL_TEAM_ID],
      [facilitatorId, facilitator2Id, adminId],
    ]);
    await db.query(`DELETE FROM sessions WHERE team_id = ANY($1::uuid[])`, [[teamId, otherTeamId]]);
    await db.query(`DELETE FROM topics WHERE team_id = ANY($1::uuid[])`, [[teamId, otherTeamId]]);
    await db.query(`DELETE FROM team_memberships WHERE team_id = ANY($1::uuid[])`, [[teamId, otherTeamId]]);
    await db.query(`DELETE FROM teams WHERE id = ANY($1::uuid[])`, [[teamId, otherTeamId]]);
    await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[facilitatorId, facilitator2Id, adminId]]);
  });

  // ---- 5.1 success ----
  it("5.1: persists a dense 1..N order in the submitted order, and both GET endpoints return it", async () => {
    const ids = await seed();
    const submitted = [...ids].reverse();

    const res = await putOrder(facilitatorId, submitted);

    expect(res.statusCode).toBe(200);
    expect(res.json().topics.map((t: { topicId: string }) => t.topicId)).toEqual(submitted);
    expect(res.json().topics.map((t: { displayOrder: number }) => t.displayOrder)).toEqual(
      submitted.map((_, i) => i + 1),
    );
    expect(await activeOrder()).toEqual(submitted.map((id, i) => ({ id, display_order: i + 1 })));

    const app = await buildApp(facilitatorId);
    const all = await app.inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics/all` });
    expect(all.statusCode).toBe(200);
    expect(all.json().active.map((t: { topicId: string }) => t.topicId)).toEqual(submitted);
    const list = await app.inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics` });
    expect(list.statusCode).toBe(200);
    expect(list.json().topics.map((t: { id: string }) => t.id)).toEqual(submitted);
  });

  it("5.1: closes gaps 1,2,4,7 to 1..4", async () => {
    const ids = await seed([1, 2, 4, 7]);
    const submitted = [ids[1]!, ids[3]!, ids[0]!, ids[2]!];

    const res = await putOrder(facilitatorId, submitted);

    expect(res.statusCode).toBe(200);
    expect(await activeOrder()).toEqual(submitted.map((id, i) => ({ id, display_order: i + 1 })));
  });

  it("5.1: an application_admin succeeds, including one who is a member of the team", async () => {
    const ids = await seed([1, 2, 3]);
    await mods.db.query(`INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, 'participant')`, [
      teamId,
      adminId,
    ]);

    const res = await putOrder(adminId, [ids[2]!, ids[0]!, ids[1]!]);

    expect(res.statusCode).toBe(200);
    expect(res.json().openSessionCreatedAt).toBeNull();
  });

  it("5.1: archived rows are not modified by a reorder", async () => {
    const ids = await seed([1, 2, 3]);
    await insertTopic(fixtureId(PREFIX, 0x300), teamId, "Archived A", 2, "archived");
    await insertTopic(fixtureId(PREFIX, 0x301), teamId, "Archived B", 2, "archived");
    const archivedBefore = await mods.db.query(`SELECT * FROM topics WHERE team_id = $1 AND status = 'archived' ORDER BY id`, [teamId]);

    const res = await putOrder(facilitatorId, [ids[2]!, ids[1]!, ids[0]!]);

    expect(res.statusCode).toBe(200);
    const archivedAfter = await mods.db.query(`SELECT * FROM topics WHERE team_id = $1 AND status = 'archived' ORDER BY id`, [teamId]);
    expect(archivedAfter.rows).toEqual(archivedBefore.rows);
  });

  // ---- 5.2 canonicalisation and body-shape success cases ----
  it("5.2: an all-uppercase list is accepted and stored, returned, and audited in lowercase", async () => {
    const ids = await seed([1, 2, 3]);
    const submitted = [ids[2]!, ids[0]!, ids[1]!];

    const res = await putOrder(facilitatorId, submitted.map((id) => id.toUpperCase()));

    expect(res.statusCode).toBe(200);
    expect(res.json().topics.map((t: { topicId: string }) => t.topicId)).toEqual(submitted);
    const [row] = await reorderAuditRows();
    expect(row!.metadata.new_order).toEqual(submitted);
    expect(row!.metadata.previous_order).toEqual(ids);
  });

  it("5.2: an extra top-level key is ignored (200, not 422)", async () => {
    const ids = await seed([1, 2]);
    const app = await buildApp(facilitatorId);

    const res = await app.inject({
      method: "PUT",
      url: orderUrl(),
      payload: { orderedTopicIds: [ids[1], ids[0]], extra: 1 },
    });

    expect(res.statusCode).toBe(200);
  });

  it("5.2: 200 valid-looking UUIDs that are not the team's set pass validation and return 409 TOPIC_ORDER_STALE", async () => {
    await seed([1, 2, 3]);
    const foreign = Array.from({ length: 200 }, (_, i) => fixtureId("dddddddd", i + 1));

    const res = await putOrder(facilitatorId, foreign);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TOPIC_ORDER_STALE");
  });

  // ---- 5.3 no-op ----
  it("5.3: submitting the current order returns the same shape, modifies no row, and writes no audit row", async () => {
    const ids = await seed([1, 2, 3]);
    const before = await allTopicRows();

    const res = await putOrder(facilitatorId, ids);

    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json()).sort()).toEqual(["openSessionCreatedAt", "topics"]);
    expect(res.json().topics.map((t: { topicId: string }) => t.topicId)).toEqual(ids);
    expect(await allTopicRows()).toEqual(before);
    expect(await reorderAuditRows()).toHaveLength(0);
  });

  // ---- 5.4 atomicity ----
  it("5.4: swapping positions 2 and 3 succeeds", async () => {
    const ids = await seed([1, 2, 3, 4]);

    const res = await putOrder(facilitatorId, [ids[0]!, ids[2]!, ids[1]!, ids[3]!]);

    expect(res.statusCode).toBe(200);
    expect(await activeOrder()).toEqual([
      { id: ids[0], display_order: 1 },
      { id: ids[2], display_order: 2 },
      { id: ids[1], display_order: 3 },
      { id: ids[3], display_order: 4 },
    ]);
  });

  it("5.4: reversing an 11-topic list succeeds", async () => {
    const ids = await seed();
    const reversed = [...ids].reverse();

    const res = await putOrder(facilitatorId, reversed);

    expect(res.statusCode).toBe(200);
    expect(await activeOrder()).toEqual(reversed.map((id, i) => ({ id, display_order: i + 1 })));
  });

  it("5.4: a failure after the first write rolls back every display_order to its prior value", async () => {
    const { db } = mods;
    const ids = await seed([1, 2, 4, 7]);
    const before = await allTopicRows();
    // A test-database trigger (not a production hook) that fails the phase-2
    // flip for this fixture team only.
    await db.query(`
      CREATE FUNCTION reorder_test_fail_phase2() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'reorder_test_fail_phase2';
      END $$ LANGUAGE plpgsql`);
    await db.query(`
      CREATE TRIGGER reorder_test_fail_phase2 BEFORE UPDATE ON topics
      FOR EACH ROW WHEN (OLD.display_order < 0 AND NEW.display_order > 0 AND NEW.team_id = '${teamId}')
      EXECUTE FUNCTION reorder_test_fail_phase2()`);

    const res = await putOrder(facilitatorId, [ids[3]!, ids[2]!, ids[1]!, ids[0]!]);

    expect(res.statusCode).toBe(500);
    expect(await allTopicRows()).toEqual(before);
    expect(await reorderAuditRows()).toHaveLength(0);
  });

  // ---- 5.6 stale ----
  it("5.6: missing, archived, other-team, and unknown IDs all return an identical 409 and change nothing", async () => {
    const ids = await seed([1, 2, 3]);
    const archivedId = fixtureId(PREFIX, 0x300);
    const foreignId = fixtureId(PREFIX, 0x400);
    await insertTopic(archivedId, teamId, "Archived", 9, "archived");
    await insertTopic(foreignId, otherTeamId, "Foreign", 1);
    const before = await allTopicRows();

    const variants = [
      [ids[0]!, ids[1]!],
      [...ids, archivedId],
      [...ids, foreignId],
      [...ids, fixtureId("eeeeeeee", 1)],
    ];
    const errors: Array<{ code: string; message: string; category: string }> = [];
    for (const variant of variants) {
      const res = await putOrder(facilitatorId, variant);
      expect(res.statusCode).toBe(409);
      const { code, message, category } = res.json().error;
      errors.push({ code, message, category });
      expect(await allTopicRows()).toEqual(before);
    }
    expect(errors.every((e) => e.code === "TOPIC_ORDER_STALE")).toBe(true);
    expect(new Set(errors.map((e) => JSON.stringify(e))).size).toBe(1);
    expect(await reorderAuditRows()).toHaveLength(0);
    const denials = await mods.db.query(
      `SELECT id FROM audit_log WHERE team_id = $1 AND operation = 'topic.write_denied_locked'`,
      [teamId],
    );
    expect(denials.rows).toHaveLength(0);
  });

  it("5.6: a custom topic added between load and save makes the save stale, and the added topic keeps its position", async () => {
    const ids = await seed([1, 2, 3]);
    const app = await buildApp(facilitatorId);
    const loaded = await app.inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics/all` });
    const loadedIds = loaded.json().active.map((t: { topicId: string }) => t.topicId) as string[];
    expect(loadedIds).toEqual(ids);

    const add = await app.inject({
      method: "POST",
      url: `/api/v1/teams/${teamId}/topics`,
      payload: { name: "Concurrent Add", prompt: "Added mid-edit?", voteType: "finger" },
    });
    expect(add.statusCode).toBe(201);

    const res = await putOrder(facilitatorId, [...loadedIds].reverse());

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TOPIC_ORDER_STALE");
    const addedRow = (await activeOrder()).find((row) => row.id === add.json().topicId);
    expect(addedRow?.display_order).toBe(add.json().displayOrder);
  });

  it("5.6: a reorder on the __default_topics__ template team is answered 404 TEAM_NOT_FOUND with a template-denial audit row (#188)", async () => {
    await seed([1, 2]);
    // Database clock, so the timestamp scope is not affected by host/container skew.
    const start = (await mods.db.query<{ now: Date }>(`SELECT clock_timestamp() AS now`)).rows[0]!.now;

    const res = await putOrder(facilitatorId, [fixtureId("ffffffff", 1)], SENTINEL_TEAM_ID);

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TEAM_NOT_FOUND");
    const rows = await mods.db.query<{ operation: string }>(
      `SELECT operation FROM audit_log
        WHERE team_id = $1 AND actor_user_id = $2 AND timestamp >= $3
          AND operation IN ('topic.reordered', 'topic.write_denied_locked', 'topic.write_denied_template')`,
      [SENTINEL_TEAM_ID, facilitatorId, start],
    );
    expect(rows.rows.map((row) => row.operation)).toEqual(["topic.write_denied_template"]);
  });

  // ---- 5.7 last-writer-wins ----
  it("5.7: two reorders of the same set both succeed and the later commit wins; audit rows chain", async () => {
    const ids = await seed([1, 2, 3]);
    const orderA = [ids[1]!, ids[0]!, ids[2]!];
    const orderB = [ids[2]!, ids[1]!, ids[0]!];

    const resA = await putOrder(facilitatorId, orderA);
    const resB = await putOrder(facilitator2Id, orderB);

    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);
    expect((await activeOrder()).map((row) => row.id)).toEqual(orderB);
    const rows = await reorderAuditRows();
    expect(rows).toHaveLength(2);
    expect(rows[1]!.metadata.previous_order).toEqual(rows[0]!.metadata.new_order);
  });

  // ---- 5.8 openSessionCreatedAt ----
  async function insertOpenSession(status: string) {
    const res = await mods.db.query<{ created_at: Date }>(
      `INSERT INTO sessions (id, team_id, facilitator_id, status, is_first_session, session_number, abandoned_at)
       VALUES ($1, $2, $3, $4::session_status, false, 2, CASE WHEN $4::text = 'abandoned' THEN NOW() END)
       RETURNING created_at`,
      [openSessionId, teamId, facilitatorId, status],
    );
    return res.rows[0]!.created_at;
  }

  it.each(["lobby", "pre_session", "active", "wrap_up"])(
    "5.8: a facilitator receives the %s session's created_at",
    async (status) => {
      const ids = await seed([1, 2]);
      const createdAt = await insertOpenSession(status);

      const res = await putOrder(facilitatorId, [ids[1]!, ids[0]!]);

      expect(res.statusCode).toBe(200);
      expect(res.json().openSessionCreatedAt).toBe(createdAt.toISOString());
    },
  );

  it.each(["draft", "abandoned"])("5.8: openSessionCreatedAt is null when the only other session is %s", async (status) => {
    const ids = await seed([1, 2]);
    await insertOpenSession(status);

    const res = await putOrder(facilitatorId, [ids[1]!, ids[0]!]);

    expect(res.statusCode).toBe(200);
    expect(res.json().openSessionCreatedAt).toBeNull();
  });

  it("5.8: an application_admin receives null despite a lobby session, for a changed save and a no-op", async () => {
    const ids = await seed([1, 2]);
    await insertOpenSession("lobby");

    const changed = await putOrder(adminId, [ids[1]!, ids[0]!]);
    const noOp = await putOrder(adminId, [ids[1]!, ids[0]!]);

    expect(changed.statusCode).toBe(200);
    expect(changed.json().openSessionCreatedAt).toBeNull();
    expect(noOp.statusCode).toBe(200);
    expect(noOp.json().openSessionCreatedAt).toBeNull();
    expect(await reorderAuditRows()).toHaveLength(1);
  });

  // ---- 5.9 session isolation ----
  it("5.9: an open and a completed session's session_topics rows are byte-identical before and after", async () => {
    const { db } = mods;
    const ids = await seed([1, 2, 3]);
    await insertOpenSession("lobby");
    for (const [sessionId, offset] of [
      [openSessionId, 0],
      [completedSessionId, 10],
    ] as const) {
      for (const [index, topicId] of ids.entries()) {
        await db.query(
          `INSERT INTO session_topics (id, session_id, topic_id, display_order, topic_name, topic_prompt, vote_type)
           VALUES ($1, $2, $3, $4, $5, 'Prompt?', 'finger')`,
          [fixtureId(PREFIX, 0x500 + offset + index), sessionId, topicId, index + 1, `Topic ${index + 1}`],
        );
      }
    }
    const snapshot = async () =>
      (await db.query(`SELECT * FROM session_topics WHERE session_id = ANY($1::uuid[]) ORDER BY id`, [
        [openSessionId, completedSessionId],
      ])).rows;
    const before = await snapshot();
    expect(before).toHaveLength(6);

    const res = await putOrder(facilitatorId, [ids[2]!, ids[0]!, ids[1]!]);

    expect(res.statusCode).toBe(200);
    expect(await snapshot()).toEqual(before);
  });

  // ---- 5.10 audit ----
  it("5.10: a changed order writes exactly one topic.reordered row with before/after IDs and no names", async () => {
    const ids = await seed([1, 2, 3]);
    const submitted = [ids[2]!, ids[0]!, ids[1]!];

    await putOrder(facilitatorId, submitted);

    const res = await mods.db.query<{ actor_user_id: string; actor_global_role: string; metadata: unknown }>(
      `SELECT actor_user_id, actor_global_role, metadata FROM audit_log WHERE team_id = $1 AND operation = 'topic.reordered'`,
      [teamId],
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ actor_user_id: facilitatorId, actor_global_role: "facilitator" });
    expect(res.rows[0]!.metadata).toEqual({ previous_order: ids, new_order: submitted });
    expect(JSON.stringify(res.rows[0]!.metadata)).not.toContain("Topic");
  });
});
