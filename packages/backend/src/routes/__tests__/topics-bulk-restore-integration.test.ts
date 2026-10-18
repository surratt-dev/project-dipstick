import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  buildApp,
  Fixture,
  sessionTopicRows,
} from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// bulk-restore-default-topics (#218) -- real Postgres: ordering and
// equivalence with sequential single restores, duplicate rule, scope,
// concurrency, live sessions, cross-team isolation, audit row.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "topics-bulk-restore-integration.test.ts");

describe.skipIf(!infraUp)("POST .../topics/restore-defaults (real Postgres)", () => {
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

  async function setup() {
    const { db } = mods;
    fx = new Fixture(db);
    const actor = await fx.user("facilitator");
    const team = await fx.team(actor);
    await fx.unlock(team, actor);
    return { db, actor, team };
  }

  async function archivedDefault(team: string, name: string, displayOrder: number) {
    const { db } = mods;
    const id = await fx.topic(team, { name, displayOrder, status: "archived" });
    await db.query(`UPDATE topics SET is_default = true WHERE id = $1`, [id]);
    return id;
  }

  const url = (team: string) => `/api/v1/teams/${team}/topics/restore-defaults`;

  it("restores prior order 4,2,5 after the active max, keeps customs, writes one audit row", async () => {
    const { db, actor, team } = await setup();
    await fx.topic(team, { name: "Custom", displayOrder: 3 });
    const a = await archivedDefault(team, "A", 4);
    const b = await archivedDefault(team, "B", 2);
    const c = await archivedDefault(team, "C", 5);
    const custom = await fx.topic(team, { name: "Archived custom", displayOrder: 1, status: "archived" });

    const res = await (await appFor(actor)).inject({ method: "POST", url: url(team) });
    expect(res.statusCode).toBe(200);
    expect(res.json().restored).toEqual([
      { topicId: b, name: "B", displayOrder: 4 },
      { topicId: a, name: "A", displayOrder: 5 },
      { topicId: c, name: "C", displayOrder: 6 },
    ]);
    const rows = await db.query<{ id: string; status: string; restored_by: string | null }>(
      `SELECT id, status, restored_by FROM topics WHERE id = ANY($1)`,
      [[a, b, c, custom]],
    );
    const byId = new Map(rows.rows.map((r) => [r.id, r]));
    expect(byId.get(custom)?.status).toBe("archived");
    for (const id of [a, b, c]) {
      expect(byId.get(id)?.status).toBe("active");
      expect(byId.get(id)?.restored_by).toBe(actor);
    }
    const audit = await db.query(`SELECT metadata, actor_ip FROM audit_log WHERE team_id = $1 AND operation LIKE 'topic.%restored'`, [team]);
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0])).not.toContain('"name"');
  });

  it("matches sequential single restores for stale, tied and negative archived positions", async () => {
    const { db, actor, team } = await setup();
    const ids = [
      await archivedDefault(team, "A", -2),
      await archivedDefault(team, "B", 7),
      await archivedDefault(team, "C", 7),
      await archivedDefault(team, "D", -2),
    ];
    const res = await (await appFor(actor)).inject({ method: "POST", url: url(team) });
    expect(res.statusCode).toBe(200);
    const bulkOrder = res.json().restored.map((r: { topicId: string; displayOrder: number }) => [r.topicId, r.displayOrder]);
    expect(bulkOrder.map((p: [string, number]) => p[1])).toEqual([1, 2, 3, 4]);

    // Reset and replay through single restore in the batch order.
    await db.query(`UPDATE topics SET status = 'archived', display_order = CASE name WHEN 'A' THEN -2 WHEN 'D' THEN -2 ELSE 7 END WHERE id = ANY($1)`, [ids]);
    const app = await appFor(actor);
    for (const [id] of bulkOrder as Array<[string, number]>) {
      const r = await app.inject({ method: "POST", url: `/api/v1/teams/${team}/topics/${id}/restore` });
      expect(r.statusCode).toBe(200);
    }
    const single = await db.query<{ id: string; display_order: number }>(
      `SELECT id, display_order FROM topics WHERE id = ANY($1) ORDER BY display_order`,
      [ids],
    );
    expect(single.rows.map((r) => [r.id, r.display_order])).toEqual(bulkOrder);
  });

  it("appends after an all-negative active list the way single restore does (no clamp at 0)", async () => {
    const { actor, team } = await setup();
    await fx.topic(team, { name: "Legacy A", displayOrder: -5 });
    await fx.topic(team, { name: "Legacy B", displayOrder: -3 });
    const a = await archivedDefault(team, "A", 1);
    const b = await archivedDefault(team, "B", 2);
    const res = await (await appFor(actor)).inject({ method: "POST", url: url(team) });
    expect(res.statusCode).toBe(200);
    expect(res.json().restored).toEqual([
      { topicId: a, name: "A", displayOrder: -2 },
      { topicId: b, name: "B", displayOrder: -1 },
    ]);
  });

  it("skips a name-matched default and leaves it archived; single restore now rejects it too (#299)", async () => {
    const { db, actor, team } = await setup();
    await fx.topic(team, { name: "code quality ", displayOrder: 1 });
    const dup = await archivedDefault(team, "Code Quality", 1);
    const res = await (await appFor(actor)).inject({ method: "POST", url: url(team) });
    expect(res.json()).toEqual({
      restored: [],
      skipped: [{ topicId: dup, name: "Code Quality", reason: "NAME_ACTIVE" }],
    });
    expect((await db.query(`SELECT status FROM topics WHERE id = $1`, [dup])).rows[0]).toEqual({ status: "archived" });
    expect((await db.query(`SELECT 1 FROM audit_log WHERE team_id = $1 AND operation = 'topic.defaults_restored'`, [team])).rows).toHaveLength(0);

    const single = await (await appFor(actor)).inject({ method: "POST", url: `/api/v1/teams/${team}/topics/${dup}/restore` });
    // #299: single restore enforces the same active-name rule as bulk.
    expect(single.statusCode).toBe(409);
    expect(single.json().error.code).toBe("TOPIC_NAME_ACTIVE");
    expect((await db.query(`SELECT status FROM topics WHERE id = $1`, [dup])).rows[0]).toEqual({ status: "archived" });
  });

  it("two concurrent bulk requests partition the set and write one audit row", async () => {
    const { db, actor, team } = await setup();
    const ids = [await archivedDefault(team, "A", 1), await archivedDefault(team, "B", 2), await archivedDefault(team, "C", 3)];
    const app = await appFor(actor);
    const [r1, r2] = await Promise.all([
      app.inject({ method: "POST", url: url(team) }),
      app.inject({ method: "POST", url: url(team) }),
    ]);
    expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);
    const a = r1.json().restored.map((r: { topicId: string }) => r.topicId);
    const b = r2.json().restored.map((r: { topicId: string }) => r.topicId);
    expect([...a, ...b].sort()).toEqual([...ids].sort());
    expect(a.filter((x: string) => b.includes(x))).toEqual([]);
    expect((await db.query(`SELECT 1 FROM audit_log WHERE team_id = $1 AND operation = 'topic.defaults_restored'`, [team])).rows).toHaveLength(1);
    const orders = (await db.query<{ display_order: number }>(`SELECT display_order FROM topics WHERE team_id = $1 AND status = 'active'`, [team])).rows.map((r) => r.display_order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("does not change a session whose room is open, and the next snapshot includes the restored topics", async () => {
    const { db, actor, team } = await setup();
    await fx.topic(team, { name: "Custom", displayOrder: 1 });
    const restoredId = await archivedDefault(team, "Back", 2);
    const app = await appFor(actor);
    const draft = await app.inject({ method: "POST", url: `/api/v1/teams/${team}/sessions/draft` });
    expect(draft.statusCode).toBe(201);
    const sessionId = draft.json().sessionId as string;
    expect((await app.inject({ method: "POST", url: `/api/v1/teams/${team}/sessions/${sessionId}/advance` })).statusCode).toBe(200);
    const before = await sessionTopicRows(db, sessionId);

    const res = await app.inject({ method: "POST", url: url(team) });
    expect(res.statusCode).toBe(200);
    expect(await sessionTopicRows(db, sessionId)).toEqual(before);
    expect(before.map((r) => r.topic_id)).not.toContain(restoredId);
  });

  it("leaves another team's archived defaults untouched", async () => {
    const { db, actor, team } = await setup();
    const other = await fx.team(actor);
    await fx.unlock(other, actor);
    const mine = await archivedDefault(team, "Mine", 1);
    const theirs = await archivedDefault(other, "Theirs", 1);
    const res = await (await appFor(actor)).inject({ method: "POST", url: url(team) });
    expect(res.json().restored.map((r: { topicId: string }) => r.topicId)).toEqual([mine]);
    expect((await db.query(`SELECT status FROM topics WHERE id = $1`, [theirs])).rows[0]).toEqual({ status: "archived" });
  });

  it("answers 409 for a locked team and 200 empty after everything is restored", async () => {
    const { actor, team } = await setup();
    await archivedDefault(team, "A", 1);
    const app = await appFor(actor);
    expect((await app.inject({ method: "POST", url: url(team) })).statusCode).toBe(200);
    const again = await app.inject({ method: "POST", url: url(team) });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ restored: [], skipped: [] });

    const lockedTeam = await fx.team(actor);
    const locked = await app.inject({ method: "POST", url: url(lockedTeam) });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error.code).toBe("TOPIC_CUSTOMIZATION_LOCKED");
  });
});
