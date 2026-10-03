import { describe, it, expect, beforeAll } from "vitest";
import Fastify from "fastify";
import { probeInfra, requireInfraOrThrow, resetTopicWriteBudget } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// Real Postgres coverage for re-add-removed-topic (TOPIC-005 restore,
// TOPIC-002 provenance extension) — exercises the real SQL a mocked unit
// test cannot: the advisory-lock-held transaction's append-position race
// closure, and the LEFT JOIN users for restoredBy provenance.
//
// Follows remove-topic-integration.test.ts's established pattern exactly
// (self-skip when Postgres is unreachable, env var fallbacks, dynamic
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


// harden-topic-write-endpoints (#184) 5.4a/5.4b: topic writes now go through
// the Redis-backed topic-write rate limiter, so this file needs Redis as well
// as Postgres. It probes both through the shared harness (which also makes it
// a "real-Redis" file for the limiter-mock structural guard).
const dbUp = await probeInfra();
requireInfraOrThrow(dbUp, "restore-topic-integration.test.ts");

async function loadModules() {
  const { db } = await import("../../db.js");
  const { contentRoutes } = await import("../content.js");
  const { topicRoutes } = await import("../topics.js");
  return { db, contentRoutes, topicRoutes };
}

describe.skipIf(!dbUp)("restore-topic — real Postgres end-to-end", () => {
  let mods: Awaited<ReturnType<typeof loadModules>>;

  beforeAll(async () => {
    mods = await loadModules();
  });

  async function buildApp(userId: string) {
    // #184 5.4b: this file uses fixed actor ids, so start every app with the
    // actor's topic-write budget cleared; reruns never inherit one.
    await resetTopicWriteBudget(userId);
    const app = Fastify();
    app.decorateRequest("session", null);
    app.addHook("onRequest", async (request) => {
      (request as unknown as Record<string, unknown>).session = { userId };
    });
    app.register(mods.contentRoutes);
    app.register(mods.topicRoutes);
    return app.ready().then((a) => a);
  }

  it("restores an archived topic, appending it at max(active display_order) + 1, sets provenance, and TOPIC-002 surfaces restoredBy", async () => {
    const { db } = mods;
    const facilitatorUserId = "d0000000-0000-0000-0000-000000000f01";
    const teamId = "d0000000-0000-0000-0000-000000000fa1";
    const sessionId = "d0000000-0000-0000-0000-000000000fb1";
    const topicAId = "d0000000-0000-0000-0000-000000000fc1"; // archived
    const topicBId = "d0000000-0000-0000-0000-000000000fc2"; // active

    try {
      await db.query(
        `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
         VALUES ($1, $2, 'test-issuer', 'Restore Topic Integration Facilitator', $3, 'facilitator')`,
        [facilitatorUserId, `sub-${facilitatorUserId}`, `${facilitatorUserId}@example.com`],
      );
      await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
        teamId,
        "Restore Topic Integration Team",
        facilitatorUserId,
      ]);
      await db.query(
        `INSERT INTO sessions
           (id, team_id, facilitator_id, status, is_first_session, session_number, completed_at, facilitator_access_expires_at)
         VALUES ($1, $2, $3, 'complete', true, 1, NOW(), NOW() + INTERVAL '30 minutes')`,
        [sessionId, teamId, facilitatorUserId],
      );
      await db.query(
        `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status, is_default, archived_at, archived_by)
         VALUES ($1, $2, 'Topic A', 'Prompt A?', 'finger', 0, 'archived', false, NOW() - INTERVAL '1 day', $3),
                ($4, $2, 'Topic B', 'Prompt B?', 'finger', 0, 'active', false, NULL, NULL)`,
        [topicAId, teamId, facilitatorUserId, topicBId],
      );

      const app = await buildApp(facilitatorUserId);

      const restoreRes = await app.inject({
        method: "POST",
        url: `/api/v1/teams/${teamId}/topics/${topicAId}/restore`,
      });

      expect(restoreRes.statusCode).toBe(200);
      const body = restoreRes.json() as {
        topicId: string;
        status: string;
        displayOrder: number;
        restoredAt: string;
      };
      expect(body.status).toBe("active");
      expect(body.topicId).toBe(topicAId);
      expect(body.displayOrder).toBe(1); // max(active) is Topic B at 0, so appended at 1

      const topicRow = await db.query<{
        status: string;
        display_order: number;
        archived_at: Date;
        archived_by: string;
        restored_at: Date;
        restored_by: string;
      }>(
        `SELECT status, display_order, archived_at, archived_by, restored_at, restored_by FROM topics WHERE id = $1`,
        [topicAId],
      );
      expect(topicRow.rows[0]?.status).toBe("active");
      expect(topicRow.rows[0]?.display_order).toBe(1);
      // archived_at/archived_by preserved, not cleared (design.md Decision 4).
      expect(topicRow.rows[0]?.archived_at).not.toBeNull();
      expect(topicRow.rows[0]?.archived_by).toBe(facilitatorUserId);
      expect(topicRow.rows[0]?.restored_at).not.toBeNull();
      expect(topicRow.rows[0]?.restored_by).toBe(facilitatorUserId);

      const auditRow = await db.query<{ metadata: { topic_id: string } }>(
        `SELECT metadata FROM audit_log WHERE team_id = $1 AND operation = 'topic.restored'`,
        [teamId],
      );
      expect(auditRow.rows).toHaveLength(1);
      expect(auditRow.rows[0]?.metadata).toMatchObject({ topic_id: topicAId });

      // TOPIC-002's real JOIN against users for restoredBy — re-archive the
      // topic so it appears back in the archived[] list, carrying the
      // preserved restoredAt/restoredBy from the restore above.
      await db.query(`UPDATE topics SET status = 'archived', archived_at = NOW() WHERE id = $1`, [topicAId]);

      const getAllRes = await app.inject({
        method: "GET",
        url: `/api/v1/teams/${teamId}/topics/all`,
      });
      expect(getAllRes.statusCode).toBe(200);
      const getAllBody = getAllRes.json() as {
        archived: Array<{
          topicId: string;
          restoredAt: string | null;
          restoredBy: { userId: string; displayName: string } | null;
        }>;
      };
      const archivedEntry = getAllBody.archived.find((t) => t.topicId === topicAId);
      expect(archivedEntry?.restoredAt).not.toBeNull();
      expect(archivedEntry?.restoredBy).toEqual({
        userId: facilitatorUserId,
        displayName: "Restore Topic Integration Facilitator",
      });
    } finally {
      await db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM topics WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM sessions WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [facilitatorUserId]);
    }
  });

  it("a never-restored archived topic reports restoredAt/restoredBy as null via TOPIC-002", async () => {
    const { db } = mods;
    const facilitatorUserId = "d0000000-0000-0000-0000-000000000f02";
    const teamId = "d0000000-0000-0000-0000-000000000fa2";
    const sessionId = "d0000000-0000-0000-0000-000000000fb2";
    const topicAId = "d0000000-0000-0000-0000-000000000fc3";

    try {
      await db.query(
        `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
         VALUES ($1, $2, 'test-issuer', 'Never Restored Facilitator', $3, 'facilitator')`,
        [facilitatorUserId, `sub-${facilitatorUserId}`, `${facilitatorUserId}@example.com`],
      );
      await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
        teamId,
        "Never Restored Team",
        facilitatorUserId,
      ]);
      await db.query(
        `INSERT INTO sessions
           (id, team_id, facilitator_id, status, is_first_session, session_number, completed_at, facilitator_access_expires_at)
         VALUES ($1, $2, $3, 'complete', true, 1, NOW(), NOW() + INTERVAL '30 minutes')`,
        [sessionId, teamId, facilitatorUserId],
      );
      await db.query(
        `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status, is_default, archived_at, archived_by)
         VALUES ($1, $2, 'Topic A', 'Prompt A?', 'finger', 0, 'archived', false, NOW(), $3)`,
        [topicAId, teamId, facilitatorUserId],
      );

      const app = await buildApp(facilitatorUserId);
      const getAllRes = await app.inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics/all` });
      const body = getAllRes.json() as {
        archived: Array<{ topicId: string; restoredAt: string | null; restoredBy: unknown }>;
      };
      const entry = body.archived.find((t) => t.topicId === topicAId);
      expect(entry?.restoredAt).toBeNull();
      expect(entry?.restoredBy).toBeNull();
    } finally {
      await db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM topics WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM sessions WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [facilitatorUserId]);
    }
  });

  it("restoring a topic leaves its existing votes and session_topics records unchanged", async () => {
    const { db } = mods;
    const facilitatorUserId = "d0000000-0000-0000-0000-000000000f03";
    const teamId = "d0000000-0000-0000-0000-000000000fa3";
    const sessionId = "d0000000-0000-0000-0000-000000000fb3";
    const topicAId = "d0000000-0000-0000-0000-000000000fc4";
    const topicBId = "d0000000-0000-0000-0000-000000000fc5";
    const sessionTopicId = "d0000000-0000-0000-0000-000000000fd3";
    const voteId = "d0000000-0000-0000-0000-000000000fe3";

    try {
      await db.query(
        `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
         VALUES ($1, $2, 'test-issuer', 'Votes Unaffected Facilitator', $3, 'facilitator')`,
        [facilitatorUserId, `sub-${facilitatorUserId}`, `${facilitatorUserId}@example.com`],
      );
      await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
        teamId,
        "Votes Unaffected Team",
        facilitatorUserId,
      ]);
      await db.query(
        `INSERT INTO sessions
           (id, team_id, facilitator_id, status, is_first_session, session_number, completed_at, facilitator_access_expires_at)
         VALUES ($1, $2, $3, 'complete', true, 1, NOW(), NOW() + INTERVAL '30 minutes')`,
        [sessionId, teamId, facilitatorUserId],
      );
      await db.query(
        `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status, is_default, archived_at, archived_by)
         VALUES ($1, $2, 'Topic A', 'Prompt A?', 'finger', 0, 'archived', false, NOW(), $3),
                ($4, $2, 'Topic B', 'Prompt B?', 'finger', 0, 'active', false, NULL, NULL)`,
        [topicAId, teamId, facilitatorUserId, topicBId],
      );
      await db.query(
        `INSERT INTO session_topics (id, session_id, topic_id, display_order, topic_name, topic_prompt, vote_type, status)
         VALUES ($1, $2, $3, 1, 'Topic A', 'Prompt A?', 'finger', 'complete')`,
        [sessionTopicId, sessionId, topicAId],
      );
      await db.query(
        `INSERT INTO votes (id, session_id, session_topic_id, voter_id, vote_value, vote_type, revealed_at)
         VALUES ($1, $2, $3, $4, 3, 'finger', NOW())`,
        [voteId, sessionId, sessionTopicId, facilitatorUserId],
      );

      const app = await buildApp(facilitatorUserId);
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/teams/${teamId}/topics/${topicAId}/restore`,
      });
      expect(res.statusCode).toBe(200);

      const sessionTopicRow = await db.query(`SELECT id FROM session_topics WHERE id = $1`, [sessionTopicId]);
      expect(sessionTopicRow.rows).toHaveLength(1);
      const voteRow = await db.query(`SELECT id, vote_value FROM votes WHERE id = $1`, [voteId]);
      expect(voteRow.rows).toHaveLength(1);
      expect((voteRow.rows[0] as { vote_value: number }).vote_value).toBe(3);
    } finally {
      await db.query(`DELETE FROM votes WHERE session_id = $1`, [sessionId]);
      await db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM session_topics WHERE session_id = $1`, [sessionId]);
      await db.query(`DELETE FROM topics WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM sessions WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [facilitatorUserId]);
    }
  });

  it("(real Postgres) two concurrent restores against different archived topics of the same team never compute the same position", async () => {
    const { db } = mods;
    const facilitatorUserId = "d0000000-0000-0000-0000-000000000f04";
    const teamId = "d0000000-0000-0000-0000-000000000fa4";
    const sessionId = "d0000000-0000-0000-0000-000000000fb4";
    const topicAId = "d0000000-0000-0000-0000-000000000fc6";
    const topicBId = "d0000000-0000-0000-0000-000000000fc7";
    const topicCId = "d0000000-0000-0000-0000-000000000fc8"; // stays active

    try {
      await db.query(
        `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
         VALUES ($1, $2, 'test-issuer', 'Restore Concurrency Facilitator', $3, 'facilitator')`,
        [facilitatorUserId, `sub-${facilitatorUserId}`, `${facilitatorUserId}@example.com`],
      );
      await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
        teamId,
        "Restore Concurrency Team",
        facilitatorUserId,
      ]);
      await db.query(
        `INSERT INTO sessions
           (id, team_id, facilitator_id, status, is_first_session, session_number, completed_at, facilitator_access_expires_at)
         VALUES ($1, $2, $3, 'complete', true, 1, NOW(), NOW() + INTERVAL '30 minutes')`,
        [sessionId, teamId, facilitatorUserId],
      );
      await db.query(
        `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status, is_default, archived_at, archived_by)
         VALUES ($1, $2, 'Topic A', 'Prompt A?', 'finger', 0, 'archived', false, NOW(), $4),
                ($3, $2, 'Topic B', 'Prompt B?', 'finger', 1, 'archived', false, NOW(), $4),
                ($5, $2, 'Topic C', 'Prompt C?', 'finger', 0, 'active', false, NULL, NULL)`,
        [topicAId, teamId, topicBId, facilitatorUserId, topicCId],
      );

      const app = await buildApp(facilitatorUserId);

      const [resA, resB] = await Promise.all([
        app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics/${topicAId}/restore` }),
        app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics/${topicBId}/restore` }),
      ]);

      expect(resA.statusCode).toBe(200);
      expect(resB.statusCode).toBe(200);
      const displayOrderA = (resA.json() as { displayOrder: number }).displayOrder;
      const displayOrderB = (resB.json() as { displayOrder: number }).displayOrder;
      expect(displayOrderA).not.toBe(displayOrderB);

      const activeTopics = await db.query(
        `SELECT display_order FROM topics WHERE team_id = $1 AND status = 'active'`,
        [teamId],
      );
      const displayOrders = activeTopics.rows.map((r) => (r as { display_order: number }).display_order);
      expect(new Set(displayOrders).size).toBe(displayOrders.length); // no collision
    } finally {
      await db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM topics WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM sessions WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [facilitatorUserId]);
    }
  });

  it("(real Postgres) a concurrent restore and a concurrent custom-topic addition never compute the same position", async () => {
    const { db } = mods;
    const facilitatorUserId = "d0000000-0000-0000-0000-000000000f05";
    const teamId = "d0000000-0000-0000-0000-000000000fa5";
    const sessionId = "d0000000-0000-0000-0000-000000000fb5";
    const topicAId = "d0000000-0000-0000-0000-000000000fc9"; // archived, will restore

    try {
      await db.query(
        `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
         VALUES ($1, $2, 'test-issuer', 'Restore-Add Concurrency Facilitator', $3, 'facilitator')`,
        [facilitatorUserId, `sub-${facilitatorUserId}`, `${facilitatorUserId}@example.com`],
      );
      await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
        teamId,
        "Restore-Add Concurrency Team",
        facilitatorUserId,
      ]);
      await db.query(
        `INSERT INTO sessions
           (id, team_id, facilitator_id, status, is_first_session, session_number, completed_at, facilitator_access_expires_at)
         VALUES ($1, $2, $3, 'complete', true, 1, NOW(), NOW() + INTERVAL '30 minutes')`,
        [sessionId, teamId, facilitatorUserId],
      );
      await db.query(
        `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status, is_default, archived_at, archived_by)
         VALUES ($1, $2, 'Topic A', 'Prompt A?', 'finger', 0, 'archived', false, NOW(), $3)`,
        [topicAId, teamId, facilitatorUserId],
      );

      const app = await buildApp(facilitatorUserId);

      const [restoreRes, addRes] = await Promise.all([
        app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics/${topicAId}/restore` }),
        app.inject({
          method: "POST",
          url: `/api/v1/teams/${teamId}/topics`,
          payload: { name: "New Topic", prompt: "New prompt?", voteType: "finger" },
        }),
      ]);

      expect(restoreRes.statusCode).toBe(200);
      expect(addRes.statusCode).toBe(201);
      const restoreDisplayOrder = (restoreRes.json() as { displayOrder: number }).displayOrder;
      const addDisplayOrder = (addRes.json() as { displayOrder: number }).displayOrder;
      expect(restoreDisplayOrder).not.toBe(addDisplayOrder);
    } finally {
      await db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM topics WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM sessions WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [facilitatorUserId]);
    }
  });

  it("(real Postgres) two concurrent restores against the same archived topic never both succeed", async () => {
    const { db } = mods;
    const facilitatorUserId = "d0000000-0000-0000-0000-000000000f06";
    const teamId = "d0000000-0000-0000-0000-000000000fa6";
    const sessionId = "d0000000-0000-0000-0000-000000000fb6";
    const topicAId = "d0000000-0000-0000-0000-000000000fca";

    try {
      await db.query(
        `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
         VALUES ($1, $2, 'test-issuer', 'Same-Topic Restore Concurrency Facilitator', $3, 'facilitator')`,
        [facilitatorUserId, `sub-${facilitatorUserId}`, `${facilitatorUserId}@example.com`],
      );
      await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
        teamId,
        "Same-Topic Restore Concurrency Team",
        facilitatorUserId,
      ]);
      await db.query(
        `INSERT INTO sessions
           (id, team_id, facilitator_id, status, is_first_session, session_number, completed_at, facilitator_access_expires_at)
         VALUES ($1, $2, $3, 'complete', true, 1, NOW(), NOW() + INTERVAL '30 minutes')`,
        [sessionId, teamId, facilitatorUserId],
      );
      await db.query(
        `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status, is_default, archived_at, archived_by)
         VALUES ($1, $2, 'Topic A', 'Prompt A?', 'finger', 0, 'archived', false, NOW(), $3)`,
        [topicAId, teamId, facilitatorUserId],
      );

      const app = await buildApp(facilitatorUserId);

      const [resA, resB] = await Promise.all([
        app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics/${topicAId}/restore` }),
        app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics/${topicAId}/restore` }),
      ]);

      const statuses = [resA.statusCode, resB.statusCode].sort();
      expect(statuses).toEqual([200, 422]);
      const rejected = resA.statusCode === 422 ? resA : resB;
      expect(rejected.json().error.code).toBe("TOPIC_ALREADY_ACTIVE");

      const auditRows = await db.query(
        `SELECT id FROM audit_log WHERE team_id = $1 AND operation = 'topic.restored'`,
        [teamId],
      );
      expect(auditRows.rows).toHaveLength(1);
    } finally {
      await db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM topics WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM sessions WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [facilitatorUserId]);
    }
  });

  it("an application_admin can restore a topic for a team they are an active member of", async () => {
    const { db } = mods;
    const adminUserId = "d0000000-0000-0000-0000-000000000f07";
    const teamId = "d0000000-0000-0000-0000-000000000fa7";
    const sessionId = "d0000000-0000-0000-0000-000000000fb7";
    const topicAId = "d0000000-0000-0000-0000-000000000fcb";
    const membershipId = "d0000000-0000-0000-0000-000000000ff7";

    try {
      await db.query(
        `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
         VALUES ($1, $2, 'test-issuer', 'Restore Admin Integration User', $3, 'application_admin')`,
        [adminUserId, `sub-${adminUserId}`, `${adminUserId}@example.com`],
      );
      await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
        teamId,
        "Restore Admin Integration Team",
        adminUserId,
      ]);
      await db.query(
        `INSERT INTO team_memberships (id, team_id, user_id, role) VALUES ($1, $2, $3, 'participant')`,
        [membershipId, teamId, adminUserId],
      );
      await db.query(
        `INSERT INTO sessions
           (id, team_id, facilitator_id, status, is_first_session, session_number, completed_at, facilitator_access_expires_at)
         VALUES ($1, $2, $3, 'complete', true, 1, NOW(), NOW() + INTERVAL '30 minutes')`,
        [sessionId, teamId, adminUserId],
      );
      await db.query(
        `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status, is_default, archived_at, archived_by)
         VALUES ($1, $2, 'Topic A', 'Prompt A?', 'finger', 0, 'archived', false, NOW(), $3)`,
        [topicAId, teamId, adminUserId],
      );

      const app = await buildApp(adminUserId);

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/teams/${teamId}/topics/${topicAId}/restore`,
      });

      expect(res.statusCode).toBe(200);
      expect((res.json() as { status: string }).status).toBe("active");
    } finally {
      await db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM topics WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM sessions WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM team_memberships WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [adminUserId]);
    }
  });
});
