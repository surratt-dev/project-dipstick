import { describe, it, expect, beforeAll } from "vitest";
import Fastify from "fastify";
import { probeInfra, requireInfraOrThrow, resetTopicWriteBudget } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// Real Postgres coverage for remove-topic (TOPIC-004 archive, TOPIC-002
// corrected read) — exercises the real SQL a mocked unit test cannot:
// the advisory-lock-held transaction, the JOIN across session_topics for
// open action items, and the LEFT JOIN users for archivedBy provenance.
//
// Follows topics-integration.test.ts's established pattern exactly
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
requireInfraOrThrow(dbUp, "remove-topic-integration.test.ts");

async function loadModules() {
  const { db } = await import("../../db.js");
  const { contentRoutes } = await import("../content.js");
  const { topicRoutes } = await import("../topics.js");
  return { db, contentRoutes, topicRoutes };
}

describe.skipIf(!dbUp)("remove-topic — real Postgres end-to-end", () => {
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

  it("archives a topic with no open action items, sets provenance, and TOPIC-002 surfaces it back with archivedBy", async () => {
    const { db } = mods;
    const facilitatorUserId = "c0000000-0000-0000-0000-000000000f01";
    const teamId = "c0000000-0000-0000-0000-000000000fa1";
    const sessionId = "c0000000-0000-0000-0000-000000000fb1";
    const topicAId = "c0000000-0000-0000-0000-000000000fc1";
    const topicBId = "c0000000-0000-0000-0000-000000000fc2";

    try {
      await db.query(
        `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
         VALUES ($1, $2, 'test-issuer', 'Remove Topic Integration Facilitator', $3, 'facilitator')`,
        [facilitatorUserId, `sub-${facilitatorUserId}`, `${facilitatorUserId}@example.com`],
      );
      await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
        teamId,
        "Remove Topic Integration Team",
        facilitatorUserId,
      ]);
      await db.query(
        `INSERT INTO sessions
           (id, team_id, facilitator_id, status, is_first_session, session_number, completed_at, facilitator_access_expires_at)
         VALUES ($1, $2, $3, 'complete', true, 1, NOW(), NOW() + INTERVAL '30 minutes')`,
        [sessionId, teamId, facilitatorUserId],
      );
      await db.query(
        `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status, is_default)
         VALUES ($1, $2, 'Topic A', 'Prompt A?', 'finger', 0, 'active', false),
                ($3, $2, 'Topic B', 'Prompt B?', 'finger', 1, 'active', false)`,
        [topicAId, teamId, topicBId],
      );

      const app = await buildApp(facilitatorUserId);

      const deleteRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/teams/${teamId}/topics/${topicAId}`,
      });

      expect(deleteRes.statusCode).toBe(200);
      const body = deleteRes.json() as { topicId: string; status: string; archivedAt: string };
      expect(body.status).toBe("archived");
      expect(body.topicId).toBe(topicAId);

      const topicRow = await db.query<{ status: string; archived_by: string; archived_at: Date }>(
        `SELECT status, archived_by, archived_at FROM topics WHERE id = $1`,
        [topicAId],
      );
      expect(topicRow.rows[0]?.status).toBe("archived");
      expect(topicRow.rows[0]?.archived_by).toBe(facilitatorUserId);
      expect(topicRow.rows[0]?.archived_at).not.toBeNull();

      const auditRow = await db.query<{ metadata: { topic_id: string; openActionItemCount: number } }>(
        `SELECT metadata FROM audit_log WHERE team_id = $1 AND operation = 'topic.archived'`,
        [teamId],
      );
      expect(auditRow.rows).toHaveLength(1);
      expect(auditRow.rows[0]?.metadata).toMatchObject({ topic_id: topicAId, openActionItemCount: 0 });

      // TOPIC-002's real JOIN against users for archivedBy.
      const getAllRes = await app.inject({
        method: "GET",
        url: `/api/v1/teams/${teamId}/topics/all`,
      });
      expect(getAllRes.statusCode).toBe(200);
      const getAllBody = getAllRes.json() as {
        teamName: string;
        active: Array<{ topicId: string }>;
        archived: Array<{ topicId: string; archivedBy: { userId: string; displayName: string } | null }>;
      };
      expect(getAllBody.teamName).toBe("Remove Topic Integration Team");
      expect(getAllBody.active.map((t) => t.topicId)).toEqual([topicBId]);
      const archivedEntry = getAllBody.archived.find((t) => t.topicId === topicAId);
      expect(archivedEntry?.archivedBy).toEqual({
        userId: facilitatorUserId,
        displayName: "Remove Topic Integration Facilitator",
      });
    } finally {
      await db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM topics WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM sessions WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [facilitatorUserId]);
    }
  });

  it("requires confirmation for a topic with a real open action item (joined through session_topics), then archives on confirm=true", async () => {
    const { db } = mods;
    const facilitatorUserId = "c0000000-0000-0000-0000-000000000f02";
    const teamId = "c0000000-0000-0000-0000-000000000fa2";
    const sessionId = "c0000000-0000-0000-0000-000000000fb2";
    const topicAId = "c0000000-0000-0000-0000-000000000fc3";
    const topicBId = "c0000000-0000-0000-0000-000000000fc4";
    const sessionTopicId = "c0000000-0000-0000-0000-000000000fd2";
    const actionItemId = "c0000000-0000-0000-0000-000000000fe2";

    try {
      await db.query(
        `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
         VALUES ($1, $2, 'test-issuer', 'Open Items Integration Facilitator', $3, 'facilitator')`,
        [facilitatorUserId, `sub-${facilitatorUserId}`, `${facilitatorUserId}@example.com`],
      );
      await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
        teamId,
        "Open Items Integration Team",
        facilitatorUserId,
      ]);
      await db.query(
        `INSERT INTO sessions
           (id, team_id, facilitator_id, status, is_first_session, session_number, completed_at, facilitator_access_expires_at)
         VALUES ($1, $2, $3, 'complete', true, 1, NOW(), NOW() + INTERVAL '30 minutes')`,
        [sessionId, teamId, facilitatorUserId],
      );
      await db.query(
        `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status, is_default)
         VALUES ($1, $2, 'Topic A', 'Prompt A?', 'finger', 0, 'active', false),
                ($3, $2, 'Topic B', 'Prompt B?', 'finger', 1, 'active', false)`,
        [topicAId, teamId, topicBId],
      );
      await db.query(
        `INSERT INTO session_topics (id, session_id, topic_id, display_order, topic_name, topic_prompt, vote_type, status)
         VALUES ($1, $2, $3, 1, 'Topic A', 'Prompt A?', 'finger', 'complete')`,
        [sessionTopicId, sessionId, topicAId],
      );
      await db.query(
        `INSERT INTO action_items (id, team_id, session_id, session_topic_id, owner_id, description, status)
         VALUES ($1, $2, $3, $4, $5, 'Follow up on the flaky test', 'open')`,
        [actionItemId, teamId, sessionId, sessionTopicId, facilitatorUserId],
      );

      const app = await buildApp(facilitatorUserId);

      const firstRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/teams/${teamId}/topics/${topicAId}`,
      });

      expect(firstRes.statusCode).toBe(200);
      const firstBody = firstRes.json() as {
        requiresConfirmation: boolean;
        openActionItemCount: number;
        openActionItems: Array<{ actionItemId: string; description: string }>;
      };
      expect(firstBody.requiresConfirmation).toBe(true);
      expect(firstBody.openActionItemCount).toBe(1);
      expect(firstBody.openActionItems).toEqual([
        { actionItemId, description: "Follow up on the flaky test" },
      ]);

      const stillActive = await db.query<{ status: string }>(`SELECT status FROM topics WHERE id = $1`, [
        topicAId,
      ]);
      expect(stillActive.rows[0]?.status).toBe("active");

      const confirmedRes = await app.inject({
        method: "DELETE",
        url: `/api/v1/teams/${teamId}/topics/${topicAId}?confirm=true`,
      });
      expect(confirmedRes.statusCode).toBe(200);
      expect((confirmedRes.json() as { status: string }).status).toBe("archived");

      const auditRow = await db.query<{ metadata: { openActionItemCount: number } }>(
        `SELECT metadata FROM audit_log WHERE team_id = $1 AND operation = 'topic.archived'`,
        [teamId],
      );
      expect(auditRow.rows[0]?.metadata.openActionItemCount).toBe(1);
    } finally {
      await db.query(`DELETE FROM action_items WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM session_topics WHERE session_id = $1`, [sessionId]);
      await db.query(`DELETE FROM topics WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM sessions WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [facilitatorUserId]);
    }
  });

  it("blocks archiving a team's sole remaining active topic with a real 409 TOPIC_LAST_ACTIVE", async () => {
    const { db } = mods;
    const facilitatorUserId = "c0000000-0000-0000-0000-000000000f03";
    const teamId = "c0000000-0000-0000-0000-000000000fa3";
    const sessionId = "c0000000-0000-0000-0000-000000000fb3";
    const topicAId = "c0000000-0000-0000-0000-000000000fc5";

    try {
      await db.query(
        `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
         VALUES ($1, $2, 'test-issuer', 'Last Active Integration Facilitator', $3, 'facilitator')`,
        [facilitatorUserId, `sub-${facilitatorUserId}`, `${facilitatorUserId}@example.com`],
      );
      await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
        teamId,
        "Last Active Integration Team",
        facilitatorUserId,
      ]);
      await db.query(
        `INSERT INTO sessions
           (id, team_id, facilitator_id, status, is_first_session, session_number, completed_at, facilitator_access_expires_at)
         VALUES ($1, $2, $3, 'complete', true, 1, NOW(), NOW() + INTERVAL '30 minutes')`,
        [sessionId, teamId, facilitatorUserId],
      );
      await db.query(
        `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status, is_default)
         VALUES ($1, $2, 'Only Topic', 'Only prompt?', 'finger', 0, 'active', false)`,
        [topicAId, teamId],
      );

      const app = await buildApp(facilitatorUserId);

      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/teams/${teamId}/topics/${topicAId}`,
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("TOPIC_LAST_ACTIVE");

      const stillActive = await db.query<{ status: string }>(`SELECT status FROM topics WHERE id = $1`, [
        topicAId,
      ]);
      expect(stillActive.rows[0]?.status).toBe("active");
    } finally {
      await db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM topics WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM sessions WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [facilitatorUserId]);
    }
  });

  it("(real Postgres) two genuinely concurrent archive requests against a team's exactly two active topics never both succeed", async () => {
    const { db } = mods;
    const facilitatorUserId = "c0000000-0000-0000-0000-000000000f04";
    const teamId = "c0000000-0000-0000-0000-000000000fa4";
    const sessionId = "c0000000-0000-0000-0000-000000000fb4";
    const topicAId = "c0000000-0000-0000-0000-000000000fc6";
    const topicBId = "c0000000-0000-0000-0000-000000000fc7";

    try {
      await db.query(
        `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
         VALUES ($1, $2, 'test-issuer', 'Concurrency Integration Facilitator', $3, 'facilitator')`,
        [facilitatorUserId, `sub-${facilitatorUserId}`, `${facilitatorUserId}@example.com`],
      );
      await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
        teamId,
        "Archive Concurrency Integration Team",
        facilitatorUserId,
      ]);
      await db.query(
        `INSERT INTO sessions
           (id, team_id, facilitator_id, status, is_first_session, session_number, completed_at, facilitator_access_expires_at)
         VALUES ($1, $2, $3, 'complete', true, 1, NOW(), NOW() + INTERVAL '30 minutes')`,
        [sessionId, teamId, facilitatorUserId],
      );
      await db.query(
        `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status, is_default)
         VALUES ($1, $2, 'Topic A', 'Prompt A?', 'finger', 0, 'active', false),
                ($3, $2, 'Topic B', 'Prompt B?', 'finger', 1, 'active', false)`,
        [topicAId, teamId, topicBId],
      );

      const app = await buildApp(facilitatorUserId);

      const [resA, resB] = await Promise.all([
        app.inject({ method: "DELETE", url: `/api/v1/teams/${teamId}/topics/${topicAId}` }),
        app.inject({ method: "DELETE", url: `/api/v1/teams/${teamId}/topics/${topicBId}` }),
      ]);

      const statuses = [resA.statusCode, resB.statusCode].sort();
      expect(statuses).toEqual([200, 409]);

      const activeTopics = await db.query(
        `SELECT id FROM topics WHERE team_id = $1 AND status = 'active'`,
        [teamId],
      );
      expect(activeTopics.rows).toHaveLength(1);
    } finally {
      await db.query(`DELETE FROM audit_log WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM topics WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM sessions WHERE team_id = $1`, [teamId]);
      await db.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [facilitatorUserId]);
    }
  });

  it("an application_admin can archive a topic for a team they are an active member of", async () => {
    const { db } = mods;
    const adminUserId = "c0000000-0000-0000-0000-000000000f05";
    const teamId = "c0000000-0000-0000-0000-000000000fa5";
    const sessionId = "c0000000-0000-0000-0000-000000000fb5";
    const topicAId = "c0000000-0000-0000-0000-000000000fc8";
    const topicBId = "c0000000-0000-0000-0000-000000000fc9";
    const membershipId = "c0000000-0000-0000-0000-000000000ff5";

    try {
      await db.query(
        `INSERT INTO users (id, oidc_subject, oidc_issuer, display_name, email, global_role)
         VALUES ($1, $2, 'test-issuer', 'Admin Integration User', $3, 'application_admin')`,
        [adminUserId, `sub-${adminUserId}`, `${adminUserId}@example.com`],
      );
      await db.query(`INSERT INTO teams (id, name, created_by_user_id) VALUES ($1, $2, $3)`, [
        teamId,
        "Admin Integration Team",
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
        `INSERT INTO topics (id, team_id, name, prompt, vote_type, display_order, status, is_default)
         VALUES ($1, $2, 'Topic A', 'Prompt A?', 'finger', 0, 'active', false),
                ($3, $2, 'Topic B', 'Prompt B?', 'finger', 1, 'active', false)`,
        [topicAId, teamId, topicBId],
      );

      const app = await buildApp(adminUserId);

      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/teams/${teamId}/topics/${topicAId}`,
      });

      expect(res.statusCode).toBe(200);
      expect((res.json() as { status: string }).status).toBe("archived");
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
