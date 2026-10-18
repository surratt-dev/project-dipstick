import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  buildApp,
  buildFullApp,
  buildUnauthenticatedFullApp,
  Fixture,
  sessionTopicRows,
  topicWriteWindowState,
  withTeamLockGateStaged,
} from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";
import { DEFAULT_TOPICS_TEAM_ID } from "../../sessions/default-topics.js";

// ---------------------------------------------------------------------------
// bulk-restore-default-topics (#218) tasks 4.1, 4.3-4.9 -- the real-Postgres
// cases that need a database: lock-ordered races (staged behind the production
// team lock, so the order is pinned, not hoped for), live-session states, the
// cascade/404/limiter edges, and the log-hygiene check with a seeded name.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "topics-bulk-restore-races-integration.test.ts");

describe.skipIf(!infraUp)("bulk restore-defaults: races, sessions, cascade edges (real Postgres)", () => {
  let mods: Mods;
  let fx: Fixture;
  const apps: FastifyInstance[] = [];

  beforeAll(async () => {
    mods = await loadModules();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const app of apps.splice(0)) await app.close();
    await fx?.cleanup();
  });

  afterAll(async () => {
    await mods?.redis.quit();
  });

  const url = (team: string) => `/api/v1/teams/${team}/topics/restore-defaults`;

  async function appFor(userId: string) {
    const app = await buildApp(mods, userId);
    apps.push(app);
    return app;
  }

  async function setup() {
    fx = new Fixture(mods.db);
    const actor = await fx.user("facilitator");
    const team = await fx.team(actor);
    await fx.unlock(team, actor);
    return { db: mods.db, actor, team };
  }

  async function archivedDefault(team: string, name: string, displayOrder: number, extra: { annotation?: string } = {}) {
    const id = await fx.topic(team, { name, displayOrder, status: "archived", annotation: extra.annotation ?? null });
    await mods.db.query(`UPDATE topics SET is_default = true WHERE id = $1`, [id]);
    return id;
  }

  async function draftSession(app: FastifyInstance, team: string): Promise<string> {
    const draft = await app.inject({ method: "POST", url: `/api/v1/teams/${team}/sessions/draft` });
    expect(draft.statusCode).toBe(201);
    return draft.json().sessionId as string;
  }
  const advance = (app: FastifyInstance, team: string, sessionId: string) =>
    app.inject({ method: "POST", url: `/api/v1/teams/${team}/sessions/${sessionId}/advance` });

  // ---- 4.8 races ----------------------------------------------------------

  it("bulk racing room open: the snapshot is all-or-nothing, in either lock order", async () => {
    for (const bulkFirst of [true, false]) {
      const { actor, team } = await setup();
      await fx.topic(team, { name: "Custom", displayOrder: 1 });
      const a = await archivedDefault(team, "Back A", 2);
      const b = await archivedDefault(team, "Back B", 3);
      const app = await appFor(actor);
      const sessionId = await draftSession(app, team);

      const bulk = () => app.inject({ method: "POST", url: url(team) });
      const open = () => advance(app, team, sessionId);
      const [first, second] = await withTeamLockGateStaged(mods, team, bulkFirst ? [bulk, open] : [open, bulk]);
      expect(first!.statusCode).toBe(200);
      expect(second!.statusCode).toBe(200);

      const snapshotTopics = (await sessionTopicRows(mods.db, sessionId)).map((r) => r.topic_id);
      if (bulkFirst) {
        expect(snapshotTopics).toContain(a);
        expect(snapshotTopics).toContain(b);
      } else {
        expect(snapshotTopics).not.toContain(a);
        expect(snapshotTopics).not.toContain(b);
      }
      await fx.cleanup();
    }
  });

  it("bulk racing a same-named custom Add: lock order decides, no collision, no unique violation", async () => {
    const add = (app: FastifyInstance, team: string) =>
      app.inject({
        method: "POST",
        url: `/api/v1/teams/${team}/topics`,
        payload: { name: "Delivery", prompt: "How is delivery?", voteType: "finger" },
      });

    // Add first: the default is skipped.
    {
      const { actor, team } = await setup();
      const dup = await archivedDefault(team, "Delivery", 1);
      const app = await appFor(actor);
      const [addRes, bulkRes] = await withTeamLockGateStaged(mods, team, [
        () => add(app, team),
        () => app.inject({ method: "POST", url: url(team) }),
      ]);
      expect(addRes!.statusCode).toBe(201);
      expect(bulkRes!.json()).toMatchObject({ restored: [], skipped: [{ topicId: dup, reason: "NAME_ACTIVE" }] });
      await fx.cleanup();
    }
    // Bulk first: the default is restored and the later Add still succeeds (Add has no name check).
    {
      const { actor, team } = await setup();
      const dup = await archivedDefault(team, "Delivery", 1);
      const app = await appFor(actor);
      const [bulkRes, addRes] = await withTeamLockGateStaged(mods, team, [
        () => app.inject({ method: "POST", url: url(team) }),
        () => add(app, team),
      ]);
      expect(bulkRes!.json().restored.map((r: { topicId: string }) => r.topicId)).toEqual([dup]);
      expect(addRes!.statusCode).toBe(201);
      const orders = (
        await mods.db.query<{ display_order: number }>(`SELECT display_order FROM topics WHERE team_id = $1 AND status = 'active'`, [team])
      ).rows.map((r) => r.display_order);
      expect(new Set(orders).size).toBe(orders.length);
    }
  });

  it("bulk racing a single restore of one of the same topics: reports what happened, topic active once", async () => {
    // Single first: bulk restores only the rest.
    {
      const { actor, team } = await setup();
      const x = await archivedDefault(team, "X", 1);
      const y = await archivedDefault(team, "Y", 2);
      const app = await appFor(actor);
      const [single, bulk] = await withTeamLockGateStaged(mods, team, [
        () => app.inject({ method: "POST", url: `/api/v1/teams/${team}/topics/${x}/restore` }),
        () => app.inject({ method: "POST", url: url(team) }),
      ]);
      expect(single!.statusCode).toBe(200);
      expect(bulk!.json().restored.map((r: { topicId: string }) => r.topicId)).toEqual([y]);
      await fx.cleanup();
    }
    // Bulk first: the single restore loses the race and gets 422 TOPIC_ALREADY_ACTIVE.
    {
      const { actor, team } = await setup();
      const x = await archivedDefault(team, "X", 1);
      const app = await appFor(actor);
      const [bulk, single] = await withTeamLockGateStaged(mods, team, [
        () => app.inject({ method: "POST", url: url(team) }),
        () => app.inject({ method: "POST", url: `/api/v1/teams/${team}/topics/${x}/restore` }),
      ]);
      expect(bulk!.json().restored.map((r: { topicId: string }) => r.topicId)).toEqual([x]);
      expect(single!.statusCode).toBe(422);
      expect(single!.json().error.code).toBe("TOPIC_ALREADY_ACTIVE");
      const active = await mods.db.query(`SELECT 1 FROM topics WHERE id = $1 AND status = 'active'`, [x]);
      expect(active.rows).toHaveLength(1);
    }
  });

  // ---- 4.9 live sessions ----------------------------------------------------

  it("a draft session includes the restored topics at room open", async () => {
    const { actor, team } = await setup();
    await fx.topic(team, { name: "Custom", displayOrder: 1 });
    const a = await archivedDefault(team, "Back", 2);
    const app = await appFor(actor);
    const sessionId = await draftSession(app, team);
    expect((await app.inject({ method: "POST", url: url(team) })).statusCode).toBe(200);
    expect((await advance(app, team, sessionId)).statusCode).toBe(200);
    const rows = await sessionTopicRows(mods.db, sessionId);
    expect(rows.map((r) => r.topic_id)).toContain(a);
    expect(rows.map((r) => r.display_order)).toEqual(rows.map((_, i) => i + 1));
  });

  it("lobby and in-progress sessions are unchanged by a restore; the next session's snapshot includes it", async () => {
    const { actor, team } = await setup();
    await fx.topic(team, { name: "Custom", displayOrder: 1 });
    const back = await archivedDefault(team, "Back", 2);
    const app = await appFor(actor);
    const sessionId = await draftSession(app, team);
    expect((await advance(app, team, sessionId)).statusCode).toBe(200); // lobby
    const before = await sessionTopicRows(mods.db, sessionId);

    expect((await app.inject({ method: "POST", url: url(team) })).statusCode).toBe(200);
    expect(await sessionTopicRows(mods.db, sessionId)).toEqual(before);

    // In progress: archive the restored topic's twin state is irrelevant; start and begin voting, restore again.
    await mods.db.query(`UPDATE topics SET status = 'archived', archived_at = NOW() WHERE id = $1`, [back]);
    expect((await app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/start` })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/begin-voting` })).statusCode).toBe(200);
    const inProgress = await sessionTopicRows(mods.db, sessionId);
    expect((await app.inject({ method: "POST", url: url(team) })).statusCode).toBe(200);
    expect(await sessionTopicRows(mods.db, sessionId)).toEqual(inProgress);
    expect(inProgress.map((r) => r.topic_id)).not.toContain(back);

    // Abandon the open session, then the next session's snapshot picks the topic up.
    await mods.db.query(`UPDATE sessions SET status = 'abandoned', abandoned_at = NOW(), current_topic_id = NULL WHERE id = $1`, [sessionId]);
    const nextId = await draftSession(app, team);
    expect((await advance(app, team, nextId)).statusCode).toBe(200);
    expect((await sessionTopicRows(mods.db, nextId)).map((r) => r.topic_id)).toContain(back);
  });

  // ---- 4.1 cascade and budget ----------------------------------------------

  it("401 without a session", async () => {
    const { team } = await setup();
    const app = await buildUnauthenticatedFullApp(mods);
    apps.push(app);
    expect((await app.inject({ method: "POST", url: url(team) })).statusCode).toBe(401);
    const bad = await app.inject({ method: "POST", url: "/api/v1/teams/not-a-uuid/topics/restore-defaults" });
    expect(bad.statusCode).toBe(401);
  });

  it("non-canonical team id is the same 404 for every authenticated caller class", async () => {
    fx = new Fixture(mods.db);
    const nonFac = await fx.user("senior_engineer");
    const member = await fx.user("facilitator");
    const standing = await fx.user("facilitator");
    const admin = await fx.user("application_admin");
    const team = await fx.team(standing);
    await fx.member(team, member);
    const bodies: string[] = [];
    for (const u of [nonFac, member, standing, admin]) {
      const app = await buildFullApp(mods, u);
      apps.push(app);
      const res = await app.inject({ method: "POST", url: "/api/v1/teams/not-a-uuid/topics/restore-defaults" });
      expect(res.statusCode).toBe(404);
      bodies.push(JSON.stringify((res.json() as { error: Record<string, unknown> }).error.code));
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it("role matrix: participant 403, member facilitator 403, admin admitted without membership", async () => {
    fx = new Fixture(mods.db);
    const owner = await fx.user("facilitator");
    const team = await fx.team(owner);
    await fx.unlock(team, owner);
    const participant = await fx.user("senior_engineer");
    const member = await fx.user("facilitator");
    await fx.member(team, member);
    const admin = await fx.user("application_admin");
    const code = async (u: string) => {
      const app = await buildFullApp(mods, u);
      apps.push(app);
      const res = await app.inject({ method: "POST", url: url(team) });
      return [res.statusCode, res.statusCode === 403 ? res.json().error.code : null];
    };
    expect(await code(participant)).toEqual([403, "NOT_A_FACILITATOR"]);
    expect(await code(member)).toEqual([403, "FACILITATOR_IS_TEAM_MEMBER"]);
    expect((await code(admin))[0]).toBe(200);
  });

  it("503 fails closed when the limiter's Redis call fails, and writes nothing", async () => {
    const { actor, team } = await setup();
    const a = await archivedDefault(team, "A", 1);
    vi.spyOn(mods.redis, "eval").mockImplementation((() => Promise.reject(new Error("ECONNREFUSED"))) as never);
    const app = await appFor(actor);
    const res = await app.inject({ method: "POST", url: url(team) });
    vi.restoreAllMocks();
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect((await mods.db.query(`SELECT status FROM topics WHERE id = $1`, [a])).rows[0]).toEqual({ status: "archived" });
  });

  it("429 once the budget is spent, with the same shape as the other topic-write routes", async () => {
    const { actor, team } = await setup();
    const { seedOverBudget } = await import("./helpers/real-db.js");
    const app = await appFor(actor);
    await seedOverBudget(actor);
    const bulk = await app.inject({ method: "POST", url: url(team) });
    const add = await app.inject({
      method: "POST",
      url: `/api/v1/teams/${team}/topics`,
      payload: { name: "N", prompt: "P?", voteType: "finger" },
    });
    expect(bulk.statusCode).toBe(429);
    expect(add.statusCode).toBe(429);
    expect(bulk.json().error.code).toBe(add.json().error.code);
    expect(bulk.headers["retry-after"]).toBe(add.headers["retry-after"]);
    expect(bulk.headers["cache-control"]).toBe("no-store");
  });

  it("nonexistent and template-team 404s are byte-identical to single restore's and to each other", async () => {
    fx = new Fixture(mods.db);
    const admin = await fx.user("application_admin");
    const app = await buildFullApp(mods, admin);
    apps.push(app);
    const strip = (s: string) => s.replace(/"correlationId":"[^"]*"/, '"correlationId":"X"');
    const missing = randomUUID();
    const bulkMissing = await app.inject({ method: "POST", url: url(missing) });
    const singleMissing = await app.inject({ method: "POST", url: `/api/v1/teams/${missing}/topics/${randomUUID()}/restore` });
    const template = await app.inject({ method: "POST", url: url(DEFAULT_TOPICS_TEAM_ID) });
    expect(bulkMissing.statusCode).toBe(404);
    expect(strip(bulkMissing.body)).toBe(strip(singleMissing.body));
    expect(strip(template.body)).toBe(strip(bulkMissing.body));
    for (const k of ["content-type", "cache-control"]) {
      expect(template.headers[k]).toBe(bulkMissing.headers[k]);
    }
  });

  it("a locked team is 409 even with nothing archived; and with legacy archived defaults nothing changes", async () => {
    fx = new Fixture(mods.db);
    const actor = await fx.user("facilitator");
    const empty = await fx.team(actor);
    const withLegacy = await fx.team(actor);
    const legacy = await archivedDefault(withLegacy, "Legacy", 1);
    const app = await appFor(actor);
    const r1 = await app.inject({ method: "POST", url: url(empty) });
    const r2 = await app.inject({ method: "POST", url: url(withLegacy) });
    expect([r1.statusCode, r2.statusCode]).toEqual([409, 409]);
    expect(r1.json().error.code).toBe("TOPIC_CUSTOMIZATION_LOCKED");
    expect((await mods.db.query(`SELECT status FROM topics WHERE id = $1`, [legacy])).rows[0]).toEqual({ status: "archived" });
  });

  it("a non-empty bulk of 12 consumes exactly one limiter unit, shared with single restore and Add", async () => {
    const { actor, team } = await setup();
    for (let i = 0; i < 12; i += 1) await archivedDefault(team, `Default ${i}`, i + 1);
    const extra = await archivedDefault(team, "Extra single", 99);
    await mods.db.query(`UPDATE topics SET status = 'active', display_order = 500 WHERE id = $1`, [extra]);
    await mods.db.query(`UPDATE topics SET status = 'archived' WHERE id = $1`, [extra]);
    const app = await appFor(actor);
    const base = await topicWriteWindowState(actor);
    const res = await app.inject({ method: "POST", url: url(team) });
    expect(res.statusCode).toBe(200);
    expect(res.json().restored).toHaveLength(13);
    const afterBulk = await topicWriteWindowState(actor);
    expect(afterBulk.burst - base.burst).toBe(1);
    expect(afterBulk.daily - base.daily).toBe(1);

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/teams/${team}/topics`,
      payload: { name: "Another", prompt: "P?", voteType: "finger" },
    });
    expect(added.statusCode).toBe(201);
    const empty = await app.inject({ method: "POST", url: url(team) });
    expect(empty.statusCode).toBe(200); // an empty 200 also spends one unit
    const end = await topicWriteWindowState(actor);
    expect(end.burst - base.burst).toBe(3);
  });

  // ---- 4.3 / 4.4 / 4.5 -------------------------------------------------------

  it("two same-named defaults, a renamed default, blank legacy names and case/NFC variants", async () => {
    const { actor, team } = await setup();
    await fx.topic(team, { name: "equipe", displayOrder: 1 });
    const d1 = await archivedDefault(team, "Delivery", 1);
    const d2 = await archivedDefault(team, "delivery", 2);
    const renamed = await archivedDefault(team, "Shiny new name", 3);
    const blank1 = await archivedDefault(team, "", 4);
    const blank2 = await archivedDefault(team, "  ", 5);
    const accented = await archivedDefault(team, "Équipe", 6);
    const res = await (await appFor(actor)).inject({ method: "POST", url: url(team) });
    const body = res.json() as { restored: Array<{ topicId: string }>; skipped: Array<{ topicId: string; reason: string }> };
    expect(body.restored.map((r) => r.topicId)).toEqual([d1, renamed, blank1, accented]);
    expect(body.skipped.map((s) => s.topicId)).toEqual([d2, blank2]);
    expect(body.skipped.every((s) => s.reason === "NAME_ACTIVE")).toBe(true);
  });

  it("annotations, votes and session_topics are untouched; ids are reused; no new rows", async () => {
    const { db, actor, team } = await setup();
    const id = await archivedDefault(team, "With history", 1, { annotation: "Our definition" });
    const old = await fx.session(team, actor, "complete");
    await db.query(
      `INSERT INTO session_topics (id, session_id, topic_id, display_order, topic_name, topic_prompt, vote_type, status)
       VALUES ($1, $2, $3, 1, 'With history', 'P?', 'finger', 'complete')`,
      [randomUUID(), old, id],
    );
    const countBefore = (await db.query(`SELECT count(*)::int AS n FROM topics WHERE team_id = $1`, [team])).rows[0];
    const stBefore = await sessionTopicRows(db, old);
    const res = await (await appFor(actor)).inject({ method: "POST", url: url(team) });
    expect(res.statusCode).toBe(200);
    expect(res.json().restored[0].topicId).toBe(id);
    expect((await db.query(`SELECT count(*)::int AS n FROM topics WHERE team_id = $1`, [team])).rows[0]).toEqual(countBefore);
    expect((await db.query(`SELECT team_annotation FROM topics WHERE id = $1`, [id])).rows[0]).toEqual({ team_annotation: "Our definition" });
    expect(await sessionTopicRows(db, old)).toEqual(stBefore);
  });

  it("a 50-row fixture restores in one request", async () => {
    const { actor, team } = await setup();
    for (let i = 0; i < 50; i += 1) await archivedDefault(team, `Default ${i}`, i);
    const res = await (await appFor(actor)).inject({ method: "POST", url: url(team) });
    expect(res.statusCode).toBe(200);
    expect(res.json().restored).toHaveLength(50);
    const orders = (await mods.db.query<{ display_order: number }>(`SELECT display_order FROM topics WHERE team_id = $1 AND status = 'active' ORDER BY display_order`, [team])).rows.map((r) => r.display_order);
    expect(orders).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  // ---- 4.6 / 4.7 -----------------------------------------------------------

  it("malformed JSON is a framework 4xx, changes nothing, and its body never reaches the logs", async () => {
    const { actor, team } = await setup();
    const a = await archivedDefault(team, "A", 1);
    const lines: string[] = [];
    const app = Fastify({ logger: { level: "info", stream: { write: (l: string) => void lines.push(l) } } });
    app.decorateRequest("session", null);
    app.addHook("onRequest", async (request) => {
      (request as unknown as Record<string, unknown>).session = { userId: actor };
    });
    app.register(mods.topicRoutes);
    await app.ready();
    apps.push(app);
    const res = await app.inject({
      method: "POST",
      url: url(team),
      headers: { "content-type": "application/json" },
      payload: '{"secretBodyMarker": ',
    });
    expect(res.statusCode).toBe(400);
    expect(lines.join("\n")).not.toContain("secretBodyMarker");
    expect((await mods.db.query(`SELECT status FROM topics WHERE id = $1`, [a])).rows[0]).toEqual({ status: "archived" });
  });

  it("audit row carries actor_ip and actor_global_role; topic names stay out of the row, the log events and limiter state", async () => {
    const { actor, team } = await setup();
    await archivedDefault(team, "ZzUniqueSecretName", 1);
    const lines: string[] = [];
    const app = Fastify({ logger: { level: "info", stream: { write: (l: string) => void lines.push(l) } } });
    app.decorateRequest("session", null);
    app.addHook("onRequest", async (request) => {
      (request as unknown as Record<string, unknown>).session = { userId: actor };
    });
    app.register(mods.topicRoutes);
    await app.ready();
    apps.push(app);
    const res = await app.inject({ method: "POST", url: url(team), remoteAddress: "10.1.2.3" });
    expect(res.statusCode).toBe(200);
    const row = (
      await mods.db.query<{ actor_global_role: string; ip: string; metadata: unknown }>(
        `SELECT actor_global_role, host(actor_ip) AS ip, metadata FROM audit_log WHERE team_id = $1 AND operation = 'topic.defaults_restored'`,
        [team],
      )
    ).rows[0]!;
    expect(row.actor_global_role).toBe("facilitator");
    expect(row.ip).toBe("10.1.2.3");
    expect(JSON.stringify(row.metadata)).not.toContain("ZzUniqueSecretName");
    expect(lines.join("\n")).not.toContain("ZzUniqueSecretName");
    expect(JSON.stringify(await topicWriteWindowState(actor))).not.toContain("ZzUniqueSecretName");
  });
});
