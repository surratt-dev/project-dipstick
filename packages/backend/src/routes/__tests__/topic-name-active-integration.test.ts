import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { TOPIC_NAME_PARITY_PAIRS } from "@dipstick/shared";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  buildApp,
  Fixture,
  topicWriteWindowState,
  withTeamLockGateStaged,
} from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";
import type * as TimingOracle from "../../content/timing-oracle.js";

// ---------------------------------------------------------------------------
// enforce-active-name-duplicate-rule (#299) -- real Postgres + Redis.
// Add and single restore reject a name that duplicates an ACTIVE topic of the
// team (409 TOPIC_NAME_ACTIVE) inside the per-team advisory lock; bulk restore
// keeps skip-and-report. Covers tasks 4.1, 4.1a, 4.2, 4.3, 4.4, 4.6, 4.7.
// The timing floor is spied (call-through), asserted as "called", not timed.
// ---------------------------------------------------------------------------

const floorSpy = vi.hoisted(() => vi.fn());
vi.mock("../../content/timing-oracle.js", async (importOriginal) => {
  const real = await importOriginal<typeof TimingOracle>();
  return {
    ...real,
    applyTimingFloor: (...args: Parameters<typeof real.applyTimingFloor>) => {
      floorSpy();
      return real.applyTimingFloor(...args);
    },
  };
});

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "topic-name-active-integration.test.ts");

describe.skipIf(!infraUp)("TOPIC_NAME_ACTIVE: Add, single restore, bulk restore (real Postgres)", () => {
  let mods: Mods;
  let fx: Fixture;
  const apps: FastifyInstance[] = [];

  beforeAll(async () => {
    mods = await loadModules();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    floorSpy.mockClear();
    for (const app of apps.splice(0)) await app.close();
    await fx?.cleanup();
  });
  afterAll(async () => {
    await mods?.redis.quit();
  });

  async function appFor(userId: string) {
    const app = await buildApp(mods, userId);
    apps.push(app);
    return app;
  }
  async function setup(role = "facilitator") {
    fx = fx ?? new Fixture(mods.db);
    const actor = await fx.user(role);
    const owner = role === "facilitator" ? actor : await fx.user("facilitator");
    const team = await fx.team(owner);
    await fx.unlock(team, owner);
    return { actor, team };
  }
  async function archivedDefault(team: string, name: string, displayOrder: number) {
    const id = await fx.topic(team, { name, displayOrder, status: "archived" });
    await mods.db.query(`UPDATE topics SET is_default = true WHERE id = $1`, [id]);
    return id;
  }

  const addUrl = (team: string) => `/api/v1/teams/${team}/topics`;
  const restoreUrl = (team: string, id: string) => `/api/v1/teams/${team}/topics/${id}/restore`;
  const bulkUrl = (team: string) => `/api/v1/teams/${team}/topics/restore-defaults`;
  const body = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    prompt: "A prompt?",
    voteType: "finger",
    ...extra,
  });
  const rows = async (team: string) =>
    (await mods.db.query<{ id: string; name: string; status: string; display_order: number; restored_at: Date | null; restored_by: string | null }>(
      `SELECT id, name, status, display_order, restored_at, restored_by FROM topics WHERE team_id = $1 ORDER BY display_order, id`,
      [team],
    )).rows;
  const auditCount = async (team: string, op: string) =>
    (await mods.db.query(`SELECT 1 FROM audit_log WHERE team_id = $1 AND operation = $2`, [team, op])).rows.length;

  // ---- 4.1 parity ----------------------------------------------------------
  describe("4.1 parity table through all three doors", () => {
    for (const { existing, candidate, duplicate } of TOPIC_NAME_PARITY_PAIRS) {
      it(`${JSON.stringify(existing)} / ${JSON.stringify(candidate)} -> ${duplicate ? "duplicate" : "distinct"}`, async () => {
        const { actor, team } = await setup();
        const app = await appFor(actor);
        await fx.topic(team, { name: existing, displayOrder: 1 });

        // Add (an empty candidate is 422 before the rule runs).
        const add = await app.inject({ method: "POST", url: addUrl(team), payload: body(candidate) });
        if (candidate.trim() === "") expect(add.statusCode).toBe(422);
        else if (duplicate) expect(add.json().error?.code).toBe("TOPIC_NAME_ACTIVE");
        else expect(add.statusCode).toBe(201);

        // Single restore, on its own team so the Add above cannot interfere.
        const rs = await setup();
        const appR = await appFor(rs.actor);
        await fx.topic(rs.team, { name: existing, displayOrder: 1 });
        const t = await fx.topic(rs.team, { name: candidate, displayOrder: 50, status: "archived" });
        const restore = await appR.inject({ method: "POST", url: restoreUrl(rs.team, t), payload: {} });
        if (duplicate) {
          expect(restore.statusCode).toBe(409);
          expect(restore.json().error.code).toBe("TOPIC_NAME_ACTIVE");
        } else {
          expect(restore.statusCode).toBe(200);
        }

        // Bulk restore, on a fresh team so earlier writes do not interfere.
        const second = await setup();
        const app2 = await appFor(second.actor);
        await fx.topic(second.team, { name: existing, displayOrder: 1 });
        const d = await archivedDefault(second.team, candidate, 50);
        const bulk = await app2.inject({ method: "POST", url: bulkUrl(second.team) });
        expect(bulk.statusCode).toBe(200);
        if (duplicate) {
          expect(bulk.json().skipped).toEqual([{ topicId: d, name: candidate, reason: "NAME_ACTIVE" }]);
        } else {
          expect(bulk.json().restored.map((r: { topicId: string }) => r.topicId)).toEqual([d]);
        }
      });
    }
  });

  // ---- 4.1a bulk regression --------------------------------------------------
  it("4.1a bulk collision is still 200 with reason NAME_ACTIVE (never TOPIC_NAME_ACTIVE) and the topic stays archived", async () => {
    const { actor, team } = await setup();
    await fx.topic(team, { name: "Code Quality", displayOrder: 1 });
    const d = await archivedDefault(team, " code quality ", 2);
    const res = await (await appFor(actor)).inject({ method: "POST", url: bulkUrl(team) });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json()).sort()).toEqual(["restored", "skipped"]);
    expect(res.json().skipped).toEqual([{ topicId: d, name: " code quality ", reason: "NAME_ACTIVE" }]);
    expect(res.body).not.toContain("TOPIC_NAME_ACTIVE");
    expect((await rows(team)).find((r) => r.id === d)?.status).toBe("archived");
  });

  // ---- 4.2 Add ---------------------------------------------------------------
  describe("4.2 Add", () => {
    it("409 body, no row, no display_order gap, no audit row, budget spent, floor called, name not echoed", async () => {
      const { actor, team } = await setup();
      const active = await fx.topic(team, { name: "Safety", displayOrder: 1 });
      const app = await appFor(actor);
      const before = await topicWriteWindowState(actor);
      floorSpy.mockClear();

      const res = await app.inject({ method: "POST", url: addUrl(team), payload: body("  sAfEtY  ") });
      expect(res.statusCode).toBe(409);
      expect(res.headers["cache-control"]).toBe("no-store");
      const err = res.json().error;
      expect(Object.keys(err).sort()).toEqual(
        ["category", "code", "conflictingName", "conflictingTopicId", "correlationId", "message"].sort(),
      );
      expect(err).toMatchObject({ category: "precondition_failed", code: "TOPIC_NAME_ACTIVE", conflictingName: "Safety", conflictingTopicId: active });
      expect(res.body).not.toContain("sAfEtY");
      expect(floorSpy).toHaveBeenCalled();
      expect(await rows(team)).toHaveLength(1);
      expect(await auditCount(team, "topic.custom_added")).toBe(0);
      const after = await topicWriteWindowState(actor);
      expect(after.burst - before.burst).toBe(1);

      const ok = await app.inject({ method: "POST", url: addUrl(team), payload: body("Other") });
      expect(ok.statusCode).toBe(201);
      expect(ok.json().displayOrder).toBe(2); // 1 + 1: the rejection consumed nothing
    });

    it("archived-only and prompt-only matches are accepted", async () => {
      const { actor, team } = await setup();
      await fx.topic(team, { name: "Old", displayOrder: 1, status: "archived" });
      await fx.topic(team, { name: "Live", prompt: "Same prompt?", displayOrder: 2 });
      const app = await appFor(actor);
      expect((await app.inject({ method: "POST", url: addUrl(team), payload: body("old") })).statusCode).toBe(201);
      expect(
        (await app.inject({ method: "POST", url: addUrl(team), payload: { ...body("Different"), prompt: "Same prompt?" } })).statusCode,
      ).toBe(201);
    });

    it("whitespace-only name is 422, not 409", async () => {
      const { actor, team } = await setup();
      await fx.topic(team, { name: "", displayOrder: 1 });
      const res = await (await appFor(actor)).inject({ method: "POST", url: addUrl(team), payload: body("   ") });
      expect(res.statusCode).toBe(422);
    });

    it("application_admin and force:true get the same 409", async () => {
      const { actor: admin, team } = await setup("application_admin");
      await fx.topic(team, { name: "Safety", displayOrder: 1 });
      const app = await appFor(admin);
      for (const extra of [{}, { force: true }]) {
        const res = await app.inject({ method: "POST", url: addUrl(team), payload: body("safety", extra) });
        expect(res.statusCode).toBe(409);
        expect(res.json().error.code).toBe("TOPIC_NAME_ACTIVE");
      }
      expect(await rows(team)).toHaveLength(1);
    });

    it("a locked team returns the lock 409 with no conflicting fields", async () => {
      fx = fx ?? new Fixture(mods.db);
      const actor = await fx.user("facilitator");
      const team = await fx.team(await fx.user("facilitator")); // no completed session: locked
      await fx.topic(team, { name: "Safety", displayOrder: 1 });
      const res = await (await appFor(actor)).inject({ method: "POST", url: addUrl(team), payload: body("safety") });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("TOPIC_CUSTOMIZATION_LOCKED");
      expect(res.json().error.conflictingName).toBeUndefined();
      expect(res.json().error.conflictingTopicId).toBeUndefined();
    });

    it("limiter unavailable answers 503, never 409", async () => {
      const { actor, team } = await setup();
      await fx.topic(team, { name: "Safety", displayOrder: 1 });
      const app = await appFor(actor);
      vi.spyOn(mods.redis, "eval").mockImplementation((() => Promise.reject(new Error("ECONNREFUSED"))) as never);
      const res = await app.inject({ method: "POST", url: addUrl(team), payload: body("safety") });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE");
    });
  });

  // ---- 4.3 single restore ----------------------------------------------------
  describe("4.3 single restore", () => {
    it("409 leaves the topic archived and consumes no display_order; floor called; budget spent", async () => {
      const { actor, team } = await setup();
      const active = await fx.topic(team, { name: "pairing", displayOrder: 1 });
      const arch = await fx.topic(team, { name: "Pairing", displayOrder: 9, status: "archived" });
      const app = await appFor(actor);
      const before = await topicWriteWindowState(actor);
      floorSpy.mockClear();

      const res = await app.inject({ method: "POST", url: restoreUrl(team, arch), payload: {} });
      expect(res.statusCode).toBe(409);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(Object.keys(res.json().error).sort()).toEqual(
        ["category", "code", "conflictingName", "conflictingTopicId", "correlationId", "message"].sort(),
      );
      expect(res.json().error).toMatchObject({ code: "TOPIC_NAME_ACTIVE", conflictingName: "pairing", conflictingTopicId: active });
      expect(floorSpy).toHaveBeenCalled();
      const row = (await rows(team)).find((r) => r.id === arch)!;
      expect(row).toMatchObject({ status: "archived", display_order: 9, restored_at: null, restored_by: null });
      expect(await auditCount(team, "topic.restored")).toBe(0);
      expect((await topicWriteWindowState(actor)).burst - before.burst).toBe(1);
    });

    it("swap: archive the active topic, then the same restore succeeds and takes the next position", async () => {
      const { actor, team } = await setup();
      const active = await fx.topic(team, { name: "pairing", displayOrder: 1 });
      const arch = await fx.topic(team, { name: "Pairing", displayOrder: 9, status: "archived" });
      await fx.topic(team, { name: "Other", displayOrder: 2 });
      const app = await appFor(actor);
      expect((await app.inject({ method: "POST", url: restoreUrl(team, arch), payload: {} })).statusCode).toBe(409);
      expect((await app.inject({ method: "DELETE", url: `${addUrl(team)}/${active}?confirm=true` })).statusCode).toBe(200);
      const ok = await app.inject({ method: "POST", url: restoreUrl(team, arch), payload: {} });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().displayOrder).toBe(3);
    });

    it("an archived sibling of the same name is not a conflict; two same-named archived restored in turn -> second rejected", async () => {
      const { actor, team } = await setup();
      await fx.topic(team, { name: "Base", displayOrder: 1 });
      const a = await fx.topic(team, { name: "Dup", displayOrder: 5, status: "archived" });
      const b = await fx.topic(team, { name: "dup", displayOrder: 6, status: "archived" });
      const app = await appFor(actor);
      expect((await app.inject({ method: "POST", url: restoreUrl(team, a), payload: {} })).statusCode).toBe(200);
      const second = await app.inject({ method: "POST", url: restoreUrl(team, b), payload: {} });
      expect(second.statusCode).toBe(409);
      expect(second.json().error.conflictingTopicId).toBe(a);
    });

    it("legacy blank name vs blank: 409 with conflictingName an empty string-ish stored value", async () => {
      const { actor, team } = await setup();
      await fx.topic(team, { name: "", displayOrder: 1 });
      const arch = await fx.topic(team, { name: "  ", displayOrder: 5, status: "archived" });
      const res = await (await appFor(actor)).inject({ method: "POST", url: restoreUrl(team, arch), payload: {} });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.conflictingName).toBe("");
    });

    it("an already-active topic answers 422 even when a legacy duplicate shares its name", async () => {
      const { actor, team } = await setup();
      await fx.topic(team, { name: "Same", displayOrder: 1 });
      const dup = await fx.topic(team, { name: "same", displayOrder: 2 });
      const res = await (await appFor(actor)).inject({ method: "POST", url: restoreUrl(team, dup), payload: {} });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe("TOPIC_ALREADY_ACTIVE");
    });

    it("admin and force:true get the same 409", async () => {
      const { actor: admin, team } = await setup("application_admin");
      await fx.topic(team, { name: "Pairing", displayOrder: 1 });
      const arch = await fx.topic(team, { name: "pairing", displayOrder: 5, status: "archived" });
      const res = await (await appFor(admin)).inject({ method: "POST", url: restoreUrl(team, arch), payload: { force: true } });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("TOPIC_NAME_ACTIVE");
    });

    it("a locked team returns the lock 409; limiter unavailable returns 503", async () => {
      fx = fx ?? new Fixture(mods.db);
      const actor = await fx.user("facilitator");
      const team = await fx.team(await fx.user("facilitator"));
      await fx.topic(team, { name: "Pairing", displayOrder: 1 });
      const arch = await fx.topic(team, { name: "pairing", displayOrder: 5, status: "archived" });
      const app = await appFor(actor);
      const locked = await app.inject({ method: "POST", url: restoreUrl(team, arch), payload: {} });
      expect(locked.json().error.code).toBe("TOPIC_CUSTOMIZATION_LOCKED");
      expect(locked.json().error.conflictingName).toBeUndefined();

      await fx.unlock(team, actor);
      vi.spyOn(mods.redis, "eval").mockImplementation((() => Promise.reject(new Error("ECONNREFUSED"))) as never);
      const res = await app.inject({ method: "POST", url: restoreUrl(team, arch), payload: {} });
      expect(res.statusCode).toBe(503);
    });
  });

  // ---- 4.4 concurrency -------------------------------------------------------
  describe("4.4 concurrency (existing staged-lock harness): exactly one success, never two active", () => {
    const activeCount = async (team: string, name: string) =>
      (await rows(team)).filter((r) => r.status === "active" && r.name.trim().toLowerCase() === name).length;

    it("Add / Add", async () => {
      const { actor, team } = await setup();
      const app = await appFor(actor);
      const [a, b] = await withTeamLockGateStaged(mods, team, [
        () => app.inject({ method: "POST", url: addUrl(team), payload: body("Safety") }),
        () => app.inject({ method: "POST", url: addUrl(team), payload: body("safety ") }),
      ]);
      expect([a!.statusCode, b!.statusCode].sort()).toEqual([201, 409]);
      expect(b!.json().error.code).toBe("TOPIC_NAME_ACTIVE");
      expect(await activeCount(team, "safety")).toBe(1);
    });

    it("Add / restore, in both lock orders", async () => {
      for (const addFirst of [true, false]) {
        const { actor, team } = await setup();
        const arch = await fx.topic(team, { name: "Safety", displayOrder: 5, status: "archived" });
        const app = await appFor(actor);
        const add = () => app.inject({ method: "POST", url: addUrl(team), payload: body("safety") });
        const restore = () => app.inject({ method: "POST", url: restoreUrl(team, arch), payload: {} });
        const [first, second] = await withTeamLockGateStaged(mods, team, addFirst ? [add, restore] : [restore, add]);
        expect(first!.statusCode).toBe(addFirst ? 201 : 200);
        expect(second!.statusCode).toBe(409);
        expect(second!.json().error.code).toBe("TOPIC_NAME_ACTIVE");
        expect(await activeCount(team, "safety")).toBe(1);
      }
    });

    it("restore / restore of two same-named archived topics", async () => {
      const { actor, team } = await setup();
      const a = await fx.topic(team, { name: "Safety", displayOrder: 5, status: "archived" });
      const b = await fx.topic(team, { name: "safety", displayOrder: 6, status: "archived" });
      const app = await appFor(actor);
      const [r1, r2] = await withTeamLockGateStaged(mods, team, [
        () => app.inject({ method: "POST", url: restoreUrl(team, a), payload: {} }),
        () => app.inject({ method: "POST", url: restoreUrl(team, b), payload: {} }),
      ]);
      expect([r1!.statusCode, r2!.statusCode]).toEqual([200, 409]);
      expect(await activeCount(team, "safety")).toBe(1);
    });

    it("restore / restore of the SAME topic: one 200, one 422, never 409", async () => {
      const { actor, team } = await setup();
      const a = await fx.topic(team, { name: "Safety", displayOrder: 5, status: "archived" });
      const app = await appFor(actor);
      const [r1, r2] = await withTeamLockGateStaged(mods, team, [
        () => app.inject({ method: "POST", url: restoreUrl(team, a), payload: {} }),
        () => app.inject({ method: "POST", url: restoreUrl(team, a), payload: {} }),
      ]);
      expect([r1!.statusCode, r2!.statusCode]).toEqual([200, 422]);
      expect(r2!.json().error.code).toBe("TOPIC_ALREADY_ACTIVE");
    });

    it("Remove vs restore: the lock serializes them; never two active of that name", async () => {
      const { actor, team } = await setup();
      const active = await fx.topic(team, { name: "Safety", displayOrder: 1 });
      await fx.topic(team, { name: "Other", displayOrder: 2 }); // Remove refuses the last active topic
      const arch = await fx.topic(team, { name: "safety", displayOrder: 5, status: "archived" });
      const app = await appFor(actor);
      const [rm, restore] = await withTeamLockGateStaged(mods, team, [
        () => app.inject({ method: "DELETE", url: `${addUrl(team)}/${active}?confirm=true` }),
        () => app.inject({ method: "POST", url: restoreUrl(team, arch), payload: {} }),
      ]);
      expect(rm!.statusCode).toBe(200);
      expect(restore!.statusCode).toBe(200);
      expect(await activeCount(team, "safety")).toBe(1);
    });
  });

  // ---- 4.6 legacy duplicates -------------------------------------------------
  it("4.6 existing duplicate active topics can still be listed, reordered and archived", async () => {
    const { actor, team } = await setup();
    const a = await fx.topic(team, { name: "Dup", displayOrder: 1 });
    const b = await fx.topic(team, { name: "dup", displayOrder: 2 });
    await fx.topic(team, { name: "Keep", displayOrder: 3 });
    const app = await appFor(actor);

    const list = await app.inject({ method: "GET", url: `${addUrl(team)}/all` });
    expect(list.statusCode).toBe(200);
    expect(list.json().active.map((t: { topicId: string }) => t.topicId)).toEqual(expect.arrayContaining([a, b]));

    const all = (await rows(team)).filter((r) => r.status === "active").map((r) => r.id);
    const reorder = await app.inject({ method: "PUT", url: `${addUrl(team)}/order`, payload: { orderedTopicIds: [all[2], all[1], all[0]] } });
    expect(reorder.statusCode).toBe(200);

    expect((await app.inject({ method: "DELETE", url: `${addUrl(team)}/${a}?confirm=true` })).statusCode).toBe(200);
    expect((await rows(team)).find((r) => r.id === a)?.status).toBe("archived");
  });

  // ---- 4.7 hygiene -----------------------------------------------------------
  it("4.7 neither name appears in any log line, in either rejection response beyond conflictingName, or in audit_log", async () => {
    const { actor, team } = await setup();
    const STORED = "ZQXSTORED-7731";
    await fx.topic(team, { name: STORED, displayOrder: 1 });
    const arch = await fx.topic(team, { name: "zqxstored-7731", displayOrder: 5, status: "archived" });

    const lines: string[] = [];
    const logged = Fastify({ logger: { level: "trace", stream: { write: (l: string) => void lines.push(l) } } });
    logged.decorateRequest("session", null);
    logged.addHook("onRequest", async (request) => {
      (request as unknown as Record<string, unknown>).session = { userId: actor };
    });
    logged.register(mods.topicRoutes);
    await logged.ready();
    apps.push(logged);

    const add = await logged.inject({ method: "POST", url: addUrl(team), payload: body("  zqxstored-7731 ") });
    expect(add.statusCode).toBe(409);
    const live = await logged.inject({ method: "POST", url: addUrl(team), payload: body("Unrelated") });
    expect(live.statusCode).toBe(201); // proves the logger and route are live
    const restore = await logged.inject({ method: "POST", url: restoreUrl(team, arch), payload: {} });
    expect(restore.statusCode).toBe(409);

    // The conflicting stored name is the one deliberate response field.
    expect(add.body).toContain(STORED);
    expect(add.body).not.toContain("zqxstored-7731");
    expect(lines.length).toBeGreaterThan(0);
    const log = lines.join("\n").toLowerCase();
    expect(log).not.toContain("zqxstored-7731");
    const audit = await mods.db.query(`SELECT metadata::text AS m, operation FROM audit_log WHERE team_id = $1`, [team]);
    expect(audit.rows.some((r) => String(r.m).toLowerCase().includes("zqxstored-7731"))).toBe(false);
    expect(audit.rows.filter((r) => r.operation === "topic.restored")).toHaveLength(0);
  });
});
