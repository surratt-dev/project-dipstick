import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  buildApp,
  Fixture,
  sessionTopicRows,
  activeTopicIdsInOrder,
} from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// topic-003-admin-authorization (#176) — real Postgres coverage for an
// application admin adding a custom topic (BRD FR-8.2 [HARD]).
//
// tasks.md 2.1-2.3: the audit rows are read back from the real audit_log
// (F1's interim compensating control — do not weaken these assertions).
// tasks.md 2.7: an admin add while a room is open leaves that session's
// session_topics untouched and reaches the team's active configuration.
//
// House pattern: describe.skipIf(!infraUp), and requireInfraOrThrow() throws
// when infra is down and REQUIRE_DB is set.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "topic-add-admin-integration.test.ts");

const VALID_BODY = { name: "Admin Topic", prompt: "Added by an admin?", voteType: "finger" };

describe.skipIf(!infraUp)("TOPIC-003 application admin (real Postgres)", () => {
  let mods: Mods;
  let fx: Fixture;
  const apps: FastifyInstance[] = [];

  beforeAll(async () => {
    mods = await loadModules();
  });

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
    await fx?.cleanup();
  });

  async function appFor(userId: string) {
    const app = await buildApp(mods, userId);
    apps.push(app);
    return app;
  }

  async function auditRows(teamId: string, operation: string) {
    return (
      await mods.db.query<{ actor_user_id: string; actor_global_role: string; metadata: Record<string, string> }>(
        `SELECT actor_user_id, actor_global_role, metadata FROM audit_log WHERE team_id = $1 AND operation = $2`,
        [teamId, operation],
      )
    ).rows;
  }

  async function seedUnlockedTeam() {
    fx = new Fixture(mods.db);
    const fac = await fx.user("facilitator");
    const admin = await fx.user("application_admin");
    const teamId = await fx.team(fac);
    await fx.unlock(teamId, fac);
    const t1 = await fx.topic(teamId, { displayOrder: 1, name: "One" });
    const t2 = await fx.topic(teamId, { displayOrder: 2, name: "Two" });
    return { fac, admin, teamId, t1, t2 };
  }

  it.each([
    ["non-member admin (2.1)", false],
    ["member admin (2.2)", true],
  ])("%s: 201, appended last, exactly one topic.custom_added row attributed to application_admin", async (_label, member) => {
    const { admin, teamId, t1, t2 } = await seedUnlockedTeam();
    if (member) await fx.member(teamId, admin);

    const res = await (await appFor(admin)).inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics`, payload: VALID_BODY });

    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty("openSessionCreatedAt");
    const topicId = body["topicId"] as string;
    expect(await activeTopicIdsInOrder(mods.db, teamId)).toEqual([t1, t2, topicId]);

    const rows = await auditRows(teamId, "topic.custom_added");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_user_id: admin, actor_global_role: "application_admin" });
    expect(rows[0]!.metadata.topic_id).toBe(topicId);
  });

  it("2.3: admin on a locked team -> 409, a write_denied_locked row attributed to application_admin, no success row", async () => {
    fx = new Fixture(mods.db);
    const fac = await fx.user("facilitator");
    const admin = await fx.user("application_admin");
    const teamId = await fx.team(fac); // never completed a session: locked

    const res = await (await appFor(admin)).inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics`, payload: VALID_BODY });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TOPIC_CUSTOMIZATION_LOCKED");
    const denied = await auditRows(teamId, "topic.write_denied_locked");
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ actor_user_id: admin, actor_global_role: "application_admin" });
    expect(denied[0]!.metadata.attempted_operation).toBe("topic.custom_added");
    expect(await auditRows(teamId, "topic.custom_added")).toHaveLength(0);
    expect(await activeTopicIdsInOrder(mods.db, teamId)).toEqual([]);
  });

  it("2.4: admin 422 on an unlocked team writes no topic and no success row", async () => {
    const { admin, teamId, t1, t2 } = await seedUnlockedTeam();

    const res = await (await appFor(admin)).inject({
      method: "POST",
      url: `/api/v1/teams/${teamId}/topics`,
      payload: { name: "No vote type", prompt: "Missing?" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.field).toBe("voteType");
    expect(await auditRows(teamId, "topic.custom_added")).toHaveLength(0);
    expect(await activeTopicIdsInOrder(mods.db, teamId)).toEqual([t1, t2]);
  });

  it("2.7: an admin add while a room is open leaves the open session's session_topics unchanged and reaches the active configuration", async () => {
    const { fac, admin, teamId, t1, t2 } = await seedUnlockedTeam();
    const facApp = await appFor(fac);

    const draft = await facApp.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/draft` });
    expect(draft.statusCode).toBe(201);
    const sessionId = draft.json().sessionId as string;
    const open = await facApp.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/${sessionId}/advance` });
    expect(open.statusCode).toBe(200);
    const atOpen = await sessionTopicRows(mods.db, sessionId);
    expect(atOpen.map((r) => r.topic_id)).toEqual([t1, t2]);

    const adminApp = await appFor(admin);
    const added = await adminApp.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics`, payload: VALID_BODY });
    expect(added.statusCode).toBe(201);
    const newTopicId = added.json().topicId as string;

    // The open session's rows (topics, order, every column) are unchanged.
    expect(await sessionTopicRows(mods.db, sessionId)).toEqual(atOpen);

    // TOPIC-002's active list (what the next room snapshots) includes it, last.
    const list = await adminApp.inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics/all` });
    expect(list.statusCode).toBe(200);
    const active = (list.json().active as Array<{ topicId: string }>).map((t) => t.topicId);
    expect(active).toEqual([t1, t2, newTopicId]);
    expect(list.json().canAddTopics).toBe(true);
  });
});
