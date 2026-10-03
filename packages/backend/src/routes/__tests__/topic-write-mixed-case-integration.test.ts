import { describe, it, expect, beforeAll, afterEach } from "vitest";
import Fastify from "fastify";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  buildApp,
  Fixture,
  sessionTopicRows,
  activeTopicIdsInOrder,
  withTeamLockGateStaged,
} from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// harden-topic-write-endpoints (#184) — mixed-case teamId on topic writes,
// real Postgres.
//
//   3.3 A successful write on an UPPERCASE path stores a lowercase team_id in
//       its audit row, logs a lowercase teamId, and never echoes the
//       uppercase spelling in the response (Decision 9; guards task 3.1).
//   3.6 Two concurrent archives on a lowercase and an UPPERCASE path cannot
//       remove a team's last active topic (L1, end to end).
//   3.7 Add, restore and reorder on an UPPERCASE path wait on the
//       lowercase-keyed team lock.
//   3.8 Room open (through its existing route) and an UPPERCASE-path reorder
//       serialize on the team lock in both directions.
//
// 3.6-3.8 prove L1 as already landed (lockTeamTopics hashes $1::uuid::text);
// they are independent of 3.1. Every actor is a fresh randomUUID() user
// (Fixture), so no test shares a topic-write budget with another.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "topic-write-mixed-case-integration.test.ts");

describe.skipIf(!infraUp)("topic writes on mixed-case teamId paths — real Postgres (#184)", () => {
  let mods: Mods;
  let fx: Fixture;

  beforeAll(async () => {
    mods = await loadModules();
  });

  afterEach(async () => {
    await fx?.cleanup();
  });

  /** An unlocked team with active topics at orders 1..activeCount, plus optional archived ones. */
  async function seedTeam(activeCount: number, archivedCount = 0) {
    fx = new Fixture(mods.db);
    const fac = await fx.user();
    const teamId = await fx.team(fac);
    await fx.unlock(teamId, fac);
    const active: string[] = [];
    for (let i = 1; i <= activeCount; i++) active.push(await fx.topic(teamId, { displayOrder: i }));
    const archived: string[] = [];
    for (let i = 0; i < archivedCount; i++) {
      archived.push(await fx.topic(teamId, { displayOrder: 100 + i, status: "archived" }));
    }
    return { fac, teamId, upper: teamId.toUpperCase(), active, archived };
  }

  async function inject(userId: string, method: "POST" | "PUT" | "DELETE", url: string, payload?: object) {
    const app = await buildApp(mods, userId);
    try {
      return await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
    } finally {
      await app.close();
    }
  }

  // -------------------------------------------------------------------------
  // 3.3
  // -------------------------------------------------------------------------
  it("3.3: every successful write on an UPPERCASE path audits, logs and responds with the lowercase teamId", async () => {
    const { fac, teamId, upper, active, archived } = await seedTeam(3, 1);

    const lines: string[] = [];
    const app = Fastify({ logger: { level: "info", stream: { write: (line: string) => void lines.push(line) } } });
    app.decorateRequest("session", null);
    app.addHook("onRequest", async (request) => {
      (request as unknown as Record<string, unknown>).session = { userId: fac };
    });
    app.register(mods.topicRoutes);
    await app.ready();

    const writes = [
      { method: "POST", url: `/api/v1/teams/${upper}/topics`, payload: { name: "Mixed", prompt: "Case?", voteType: "finger" }, status: 201 },
      { method: "PUT", url: `/api/v1/teams/${upper}/topics/${active[0]}/annotation`, payload: { annotation: "Ours" }, status: 200 },
      { method: "PUT", url: `/api/v1/teams/${upper}/topics/order`, payload: null, status: 200 },
      { method: "DELETE", url: `/api/v1/teams/${upper}/topics/${active[1]}?confirm=true`, payload: undefined, status: 200 },
      { method: "POST", url: `/api/v1/teams/${upper}/topics/${archived[0]}/restore`, payload: {}, status: 200 },
    ] as const;

    try {
      for (const w of writes) {
        let payload: object | undefined = w.payload ?? undefined;
        if (w.payload === null) {
          payload = { orderedTopicIds: [...(await activeTopicIdsInOrder(mods.db, teamId))].reverse() };
        }
        const res = await app.inject({ method: w.method, url: w.url, ...(payload === undefined ? {} : { payload }) });
        expect(res.statusCode, `${w.method} ${w.url}`).toBe(w.status);
        // No topic-write response carries a teamId field; the uppercase
        // spelling must not be echoed anywhere in the body.
        expect(res.payload).not.toContain(upper);
      }
    } finally {
      await app.close();
    }

    const audit = await mods.db.query<{ operation: string; team_id: string; metadata: unknown }>(
      `SELECT operation, team_id::text AS team_id, metadata FROM audit_log
        WHERE actor_user_id = $1 AND operation LIKE 'topic.%' ORDER BY id`,
      [fac],
    );
    expect(audit.rows.map((r) => r.operation).sort()).toEqual(
      ["topic.annotation_updated", "topic.archived", "topic.custom_added", "topic.reordered", "topic.restored"].sort(),
    );
    for (const row of audit.rows) {
      expect(row.team_id).toBe(teamId);
      expect(JSON.stringify(row.metadata)).not.toContain(upper);
    }

    const events = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((e) => typeof e["event"] === "string" && (e["event"] as string).startsWith("topic."));
    expect(events.map((e) => e["event"]).sort()).toEqual(audit.rows.map((r) => r.operation).sort());
    for (const e of events) expect(e["teamId"]).toBe(teamId);
    // Fastify's own request log carries the raw URL; every line the handlers
    // emit (audit events and anything else they log) must not.
    const handlerLines = lines.filter((l) => {
      const msg = (JSON.parse(l) as { msg?: string }).msg;
      return msg !== "incoming request" && msg !== "request completed";
    });
    expect(handlerLines.length).toBeGreaterThan(0);
    expect(handlerLines.join("\n")).not.toContain(upper);
  });

  // -------------------------------------------------------------------------
  // 3.6
  // -------------------------------------------------------------------------
  it("3.6: concurrent archives on a lowercase and an UPPERCASE path never remove the last active topic", async () => {
    const { fac, teamId, upper, active } = await seedTeam(2);

    const results = await withTeamLockGateStaged(mods, teamId, [
      () => inject(fac, "DELETE", `/api/v1/teams/${teamId}/topics/${active[0]}?confirm=true`),
      () => inject(fac, "DELETE", `/api/v1/teams/${upper}/topics/${active[1]}?confirm=true`),
    ]);

    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.statusCode === 409)!;
    expect(loser.json().error.code).toBe("TOPIC_LAST_ACTIVE");
    expect(await activeTopicIdsInOrder(mods.db, teamId)).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // 3.7
  // -------------------------------------------------------------------------
  it("3.7: an add on an UPPERCASE path waits on the lowercase-keyed team lock", async () => {
    const { fac, teamId, upper } = await seedTeam(2);
    const [res] = await withTeamLockGateStaged(mods, teamId, [
      () => inject(fac, "POST", `/api/v1/teams/${upper}/topics`, { name: "Waits", prompt: "Lock?", voteType: "finger" }),
    ]);
    expect(res!.statusCode).toBe(201);
  });

  it("3.7: a restore on an UPPERCASE path waits on the lowercase-keyed team lock", async () => {
    const { fac, teamId, upper, archived } = await seedTeam(2, 1);
    const [res] = await withTeamLockGateStaged(mods, teamId, [
      () => inject(fac, "POST", `/api/v1/teams/${upper}/topics/${archived[0]}/restore`, {}),
    ]);
    expect(res!.statusCode).toBe(200);
  });

  it("3.7: a reorder on an UPPERCASE path waits on the lowercase-keyed team lock", async () => {
    const { fac, teamId, upper, active } = await seedTeam(3);
    const [res] = await withTeamLockGateStaged(mods, teamId, [
      () => inject(fac, "PUT", `/api/v1/teams/${upper}/topics/order`, { orderedTopicIds: [...active].reverse() }),
    ]);
    expect(res!.statusCode).toBe(200);
    expect(await activeTopicIdsInOrder(mods.db, teamId)).toEqual([...active].reverse());
  });

  // -------------------------------------------------------------------------
  // 3.8
  // -------------------------------------------------------------------------
  async function seedDraft() {
    const seeded = await seedTeam(3);
    const draftId = await fx.session(seeded.teamId, seeded.fac, "draft");
    return { ...seeded, draftId };
  }

  function openRoom(fac: string, teamId: string, draftId: string) {
    return inject(fac, "POST", `/api/v1/teams/${teamId}/sessions/${draftId}/advance`);
  }

  it("3.8: room open first, then an UPPERCASE-path reorder -- the reorder waits, the snapshot keeps the old order", async () => {
    const { fac, teamId, upper, active, draftId } = await seedDraft();
    const reversed = [...active].reverse();

    const [open, reorder] = await withTeamLockGateStaged(mods, teamId, [
      () => openRoom(fac, teamId, draftId),
      () => inject(fac, "PUT", `/api/v1/teams/${upper}/topics/order`, { orderedTopicIds: reversed }),
    ]);

    expect(open!.statusCode).toBe(200);
    expect(reorder!.statusCode).toBe(200);
    expect((await sessionTopicRows(mods.db, draftId)).map((r) => r.topic_id)).toEqual(active);
    expect(await activeTopicIdsInOrder(mods.db, teamId)).toEqual(reversed);
  });

  it("3.8: an UPPERCASE-path reorder first, then room open -- room open waits, the snapshot has the new order", async () => {
    const { fac, teamId, upper, active, draftId } = await seedDraft();
    const reversed = [...active].reverse();

    const [reorder, open] = await withTeamLockGateStaged(mods, teamId, [
      () => inject(fac, "PUT", `/api/v1/teams/${upper}/topics/order`, { orderedTopicIds: reversed }),
      () => openRoom(fac, teamId, draftId),
    ]);

    expect(reorder!.statusCode).toBe(200);
    expect(open!.statusCode).toBe(200);
    expect((await sessionTopicRows(mods.db, draftId)).map((r) => r.topic_id)).toEqual(reversed);
  });
});
