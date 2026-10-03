import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  Fixture,
  resetTopicWriteBudget,
  seedTopicWriteWindows,
  seedOverBudget,
  topicWriteWindowState,
} from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";
import type * as RateLimitModule from "../topic-write-rate-limit.js";

// ---------------------------------------------------------------------------
// harden-topic-write-endpoints (#184) task 5.8 — threshold and counting
// semantics, real Redis (and real Postgres for the route-level half).
//
// Counting is tested against the limiter decision itself
// (checkTopicWriteBudget) with an injected nowMs: no HTTP, no timing floor,
// no fake timers racing applyTimingFloor's setTimeout (Decision 13). Route
// tests pre-seed the actor's ZSETs and send a couple of requests each.
// Every actor is a fresh randomUUID().
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "topic-write-rate-limit-thresholds-integration.test.ts");

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const T0 = 1_800_000_000_000;

describe.skipIf(!infraUp)("topic-write limiter — counting at the limiter (#184 5.8)", () => {
  let rl: typeof RateLimitModule;
  const actors: string[] = [];

  function actor(): string {
    const id = randomUUID();
    actors.push(id);
    return id;
  }

  beforeAll(async () => {
    rl = await import("../topic-write-rate-limit.js");
  });

  afterEach(async () => {
    await resetTopicWriteBudget(...actors.splice(0));
  });

  /** n admitted requests for `userId`, spaced `stepMs` apart from `start`. */
  async function admitN(userId: string, n: number, start: number, stepMs: number) {
    for (let i = 0; i < n; i++) {
      const d = await rl.checkTopicWriteBudget(userId, start + i * stepMs);
      expect(d.admitted, `request ${i + 1} of ${n}`).toBe(true);
    }
  }

  it("the thresholds are the spec's and sit above the ritual floor", () => {
    expect(rl.TOPIC_WRITE_LIMITS.burst).toEqual({ limit: 120, windowMs: 10 * MIN });
    expect(rl.TOPIC_WRITE_LIMITS.daily).toEqual({ limit: 400, windowMs: 24 * HOUR });
    expect(rl.TOPIC_WRITE_LIMITS.burst.limit).toBeGreaterThanOrEqual(100);
    expect(rl.TOPIC_WRITE_LIMITS.daily.limit).toBeGreaterThanOrEqual(200);
  });

  it("120 pass and the 121st is rejected with the burst code", async () => {
    const a = actor();
    await admitN(a, 120, T0, 1_000);
    const d = await rl.checkTopicWriteBudget(a, T0 + 120_000);
    expect(d.admitted).toBe(false);
    if (d.admitted) return;
    expect(d.breach).toMatchObject({ limit: "burst", code: "TOPIC_WRITE_BURST_LIMIT_EXCEEDED", observedCount: 120 });
    // Oldest entry (T0) leaves at T0 + 10 min: 480 s from T0 + 120 s.
    expect(d.breach.retryAfterSeconds).toBe(480);
  });

  it("one actor's budget does not touch another's", async () => {
    const a = actor();
    const b = actor();
    await admitN(a, 120, T0, 100);
    expect((await rl.checkTopicWriteBudget(a, T0 + 20_000)).admitted).toBe(false);
    expect((await rl.checkTopicWriteBudget(b, T0 + 20_000)).admitted).toBe(true);
  });

  it("the 90-request two-team baseline restore in one sitting is never rejected", async () => {
    // Per team: 11 archives with confirmation (pre-flight + confirm = 22
    // requests), 11 restores and 12 annotations = 45; two teams = 90, all
    // within 10 minutes. Every one is counted; none is rejected.
    const a = actor();
    await admitN(a, 90, T0, Math.floor((10 * MIN) / 90) - 1);
  });

  it("the 78-request tailoring-plus-pre-session fixture is never rejected", async () => {
    // 63 tailoring (11 pre-flights, 11 confirms, 11 restores, 5 adds,
    // 17 annotations, 3 reorders, 5 adds rejected 422) + 15 pre-session
    // (5 annotations, 1 definition clear, 4 pre-flights + 4 confirms,
    // 4 restores, 1 reorder). Every one is counted; none is rejected.
    const a = actor();
    await admitN(a, 63 + 15, T0, Math.floor((10 * MIN) / 78) - 1);
  });

  it("daily: 400 spread over more than 40 minutes pass, the 401st gets the daily code", async () => {
    const a = actor();
    await admitN(a, 400, T0, 7_000); // 46.7 min; burst never reaches 120
    const d = await rl.checkTopicWriteBudget(a, T0 + 400 * 7_000);
    expect(d.admitted).toBe(false);
    if (d.admitted) return;
    expect(d.breach).toMatchObject({ limit: "daily", code: "TOPIC_WRITE_DAILY_LIMIT_EXCEEDED", observedCount: 400 });
    expect(d.breach.message).toBe(
      "You've reached today's limit for topic changes. Changes so far are saved. You can continue tomorrow.",
    );
  });

  it("C2 daily-dominant: 280 two hours ago + 120 now gives the daily code and Retry-After > 600", async () => {
    const a = actor();
    const now = T0;
    const old = Array.from({ length: 280 }, () => now - 2 * HOUR);
    const recent = Array.from({ length: 120 }, (_, i) => now - 5 * MIN + i * 1_000);
    await seedTopicWriteWindows(a, { burst: recent, daily: [...old, ...recent] });

    const d = await rl.checkTopicWriteBudget(a, now);
    expect(d.admitted).toBe(false);
    if (d.admitted) return;
    expect(d.breach.code).toBe("TOPIC_WRITE_DAILY_LIMIT_EXCEEDED");
    expect(d.breach.retryAfterSeconds).toBe(22 * 60 * 60);
    expect(d.breach.retryAfterSeconds).toBeGreaterThan(600);
  });

  it("C2 burst-dominant: 280 at 23 h 59 min ago + 120 in the last minute gives the burst code with the burst wait", async () => {
    const a = actor();
    const now = T0;
    const old = Array.from({ length: 280 }, () => now - (23 * HOUR + 59 * MIN));
    const recent = Array.from({ length: 120 }, (_, i) => now - MIN + i * 400);
    await seedTopicWriteWindows(a, { burst: recent, daily: [...old, ...recent] });

    const d = await rl.checkTopicWriteBudget(a, now);
    expect(d.admitted).toBe(false);
    if (d.admitted) return;
    expect(d.result).toMatchObject({ burstCount: 120, dailyCount: 400 });
    expect(d.breach.code).toBe("TOPIC_WRITE_BURST_LIMIT_EXCEEDED");
    // Burst wait: oldest recent entry (now - 60 s) leaves at now + 9 min.
    expect(d.breach.retryAfterSeconds).toBe(9 * 60);
  });

  it("a tie between the two waits goes to daily", async () => {
    const a = actor();
    const now = T0;
    // Both windows' oldest entries leave at the same instant (now + 300 s).
    const daily = [...Array.from({ length: 280 }, () => now - 24 * HOUR + 5 * MIN), ...Array.from({ length: 120 }, () => now - 5 * MIN)];
    await seedTopicWriteWindows(a, { burst: Array.from({ length: 120 }, () => now - 5 * MIN), daily });
    const d = await rl.checkTopicWriteBudget(a, now);
    expect(d.admitted).toBe(false);
    if (d.admitted) return;
    expect(d.breach).toMatchObject({ code: "TOPIC_WRITE_DAILY_LIMIT_EXCEEDED", retryAfterSeconds: 300 });
  });

  it("50 over-budget requests open exactly one breach episode (one audit row's worth)", async () => {
    const a = actor();
    await seedTopicWriteWindows(a, { burst: Array.from({ length: 120 }, () => T0 - 1_000) });
    const decisions = [];
    for (let i = 0; i < 50; i++) decisions.push(await rl.checkTopicWriteBudget(a, T0 + i));
    expect(decisions.every((d) => !d.admitted)).toBe(true);
    const opened = decisions.filter((d) => !d.admitted && d.breach.newEpisodeWindows.length > 0);
    expect(opened).toHaveLength(1);
    const last = decisions[49]!;
    expect(!last.admitted && last.breach.suppressedCount).toBe(49);
  });
});

// ---------------------------------------------------------------------------
// Route level: pre-seeded windows, a couple of requests per case.
// ---------------------------------------------------------------------------
describe.skipIf(!infraUp)("topic-write limiter — route level (#184 5.8)", () => {
  let mods: Mods;
  let fx: Fixture;

  beforeAll(async () => {
    mods = await loadModules();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fx?.cleanup();
  });

  /** topicRoutes + contentRoutes with a captured pino stream. Does not touch the budget. */
  async function loggedApp(userId: string): Promise<{ app: FastifyInstance; events: () => Array<Record<string, unknown>> }> {
    const lines: string[] = [];
    const app = Fastify({ logger: { level: "info", stream: { write: (l: string) => void lines.push(l) } } });
    app.decorateRequest("session", null);
    app.addHook("onRequest", async (request) => {
      (request as unknown as Record<string, unknown>).session = { userId };
    });
    app.register(mods.topicRoutes);
    app.register(mods.contentRoutes);
    await app.ready();
    return {
      app,
      events: () =>
        lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((e) => typeof e["event"] === "string"),
    };
  }

  async function seedTeam(opts: { locked?: boolean } = {}) {
    fx = new Fixture(mods.db);
    const fac = await fx.user();
    const teamId = await fx.team(fac);
    if (!opts.locked) await fx.unlock(teamId, fac);
    const t1 = await fx.topic(teamId, { displayOrder: 1 });
    const t2 = await fx.topic(teamId, { displayOrder: 2 });
    return { fac, teamId, t1, t2 };
  }

  async function rateLimitedRows(userId: string) {
    return (
      await mods.db.query<{
        team_id: string;
        actor_global_role: string;
        actor_ip: string | null;
        metadata: Record<string, unknown>;
      }>(
        `SELECT team_id::text AS team_id, actor_global_role, host(actor_ip) AS actor_ip, metadata
           FROM audit_log WHERE actor_user_id = $1 AND operation = 'topic.write_rate_limited' ORDER BY id`,
        [userId],
      )
    ).rows;
  }

  const addBody = { name: "Limited", prompt: "Wait?", voteType: "finger" };

  it("the budget is shared across routes and teams: 119 seeded + an add on team X; then an annotation on team Y is 429", async () => {
    const { fac, teamId } = await seedTeam();
    const teamY = await fx.team(fac);
    await fx.unlock(teamY, fac);
    const topicY = await fx.topic(teamY, { displayOrder: 1 });
    await seedTopicWriteWindows(fac, { burst: Array.from({ length: 119 }, () => Date.now() - 1_000) });
    const { app } = await loggedApp(fac);
    try {
      const add = await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics`, payload: addBody });
      expect(add.statusCode).toBe(201);
      const annotate = await app.inject({
        method: "PUT",
        url: `/api/v1/teams/${teamY}/topics/${topicY}/annotation`,
        payload: { annotation: "x" },
      });
      expect(annotate.statusCode).toBe(429);
      expect(annotate.json().error.code).toBe("TOPIC_WRITE_BURST_LIMIT_EXCEEDED");
    } finally {
      await app.close();
    }
  });

  it("the breach audit row: one per episode, before the response, full shape, lowercase team_id from an UPPERCASE path", async () => {
    const { fac, teamId } = await seedTeam();
    await seedOverBudget(fac);
    const { app, events } = await loggedApp(fac);
    try {
      const res = await app.inject({ method: "POST", url: `/api/v1/teams/${teamId.toUpperCase()}/topics`, payload: addBody });
      expect(res.statusCode).toBe(429);
      // The row exists as soon as the response does: it was written first.
      const rows = await rateLimitedRows(fac);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ team_id: teamId, actor_global_role: "facilitator" });
      expect(rows[0]!.actor_ip).toBeTruthy();
      expect(rows[0]!.metadata).toEqual({
        limit: "burst",
        windows: ["burst"],
        observedCount: 120,
        endpoint: "POST /api/v1/teams/:teamId/topics",
        team_verified: false,
      });
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(Number(res.headers["retry-after"])).toBeGreaterThanOrEqual(1);
      expect(res.json().error).toMatchObject({
        category: "rate_limited",
        code: "TOPIC_WRITE_BURST_LIMIT_EXCEEDED",
        message:
          "You've made a lot of topic changes in a short time. Changes so far are saved. Please wait a few minutes and try again.",
      });
      const exceeded = events().filter((e) => e["event"] === "topic.write_rate_limit_exceeded");
      expect(exceeded).toHaveLength(1);
      expect(exceeded[0]).toMatchObject({ teamId, episodeStarted: true, suppressedCount: 0 });
    } finally {
      await app.close();
    }
  });

  it("every 429 emits topic.write_rate_limit_exceeded; suppressedCount grows within the episode; still one row", async () => {
    const { fac, teamId } = await seedTeam();
    await seedOverBudget(fac);
    const { app, events } = await loggedApp(fac);
    try {
      for (let i = 0; i < 3; i++) {
        expect((await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics`, payload: addBody })).statusCode).toBe(429);
      }
    } finally {
      await app.close();
    }
    const exceeded = events().filter((e) => e["event"] === "topic.write_rate_limit_exceeded");
    expect(exceeded.map((e) => e["suppressedCount"])).toEqual([0, 1, 2]);
    expect(await rateLimitedRows(fac)).toHaveLength(1);
  });

  it("a second episode, after the window had room and a request was admitted, writes a second row", async () => {
    const { fac, teamId } = await seedTeam();
    const now = Date.now();
    await seedTopicWriteWindows(fac, { burst: Array.from({ length: 120 }, () => now - 1_000), daily: [] });
    const { app } = await loggedApp(fac);
    try {
      expect((await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics`, payload: addBody })).statusCode).toBe(429);
      // The window gets room: its oldest entry leaves.
      const { redis } = await import("../../redis.js");
      const { topicWriteRateLimitKeys } = await import("../topic-write-rate-limit.js");
      await redis.zpopmin(topicWriteRateLimitKeys(fac).burst, 1);
      expect((await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics`, payload: addBody })).statusCode).toBe(201);
      expect((await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics`, payload: addBody })).statusCode).toBe(429);
    } finally {
      await app.close();
    }
    expect(await rateLimitedRows(fac)).toHaveLength(2);
  });

  for (const mode of ["throws", "hangs"] as const) {
    it(`an audit write that ${mode} still answers the 429 in time and emits auth.audit_write_failed`, async () => {
      const { fac, teamId } = await seedTeam();
      await seedOverBudget(fac);
      const original = mods.db.query.bind(mods.db) as (...args: unknown[]) => Promise<unknown>;
      vi.spyOn(mods.db, "query").mockImplementation(((...args: unknown[]) => {
        const params = args[1] as unknown[] | undefined;
        if (String(args[0]).includes("INSERT INTO audit_log") && params?.[3] === "topic.write_rate_limited") {
          return mode === "throws" ? Promise.reject(new Error("audit insert failed")) : new Promise(() => undefined);
        }
        return original(...args);
      }) as never);

      const { app, events } = await loggedApp(fac);
      try {
        const started = Date.now();
        const res = await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics`, payload: addBody });
        const elapsed = Date.now() - started;
        expect(res.statusCode).toBe(429);
        expect(res.json().error.code).toBe("TOPIC_WRITE_BURST_LIMIT_EXCEEDED");
        expect(elapsed).toBeLessThan(150 + 500 + 250);
        const failed = events().filter((e) => e["event"] === "auth.audit_write_failed");
        expect(failed).toHaveLength(1);
        expect(failed[0]).toMatchObject({ failureMode: mode === "throws" ? "error" : "timeout", reason: "topic.write_rate_limited" });
      } finally {
        await app.close();
      }
    });
  }

  it("a 422, a 404 TOPIC_NOT_FOUND, a 409 lock and an archive pre-flight each add exactly one entry to both windows", async () => {
    const { fac, teamId, t1 } = await seedTeam();
    const locked = await fx.team(fac);
    // An open action item on t1 makes the unconfirmed archive call a
    // pre-flight that answers requiresConfirmation.
    const sessionId = await fx.session(teamId, fac, "complete");
    const sessionTopicId = randomUUID();
    await mods.db.query(
      `INSERT INTO session_topics (id, session_id, topic_id, display_order, topic_name, topic_prompt, vote_type, status)
       VALUES ($1, $2, $3, 1, 'Topic A', 'Prompt A?', 'finger', 'complete')`,
      [sessionTopicId, sessionId, t1],
    );
    await mods.db.query(
      `INSERT INTO action_items (id, team_id, session_id, session_topic_id, owner_id, description, status)
       VALUES ($1, $2, $3, $4, $5, 'Follow up', 'open')`,
      [randomUUID(), teamId, sessionId, sessionTopicId, fac],
    );
    const { app } = await loggedApp(fac);
    const cases: Array<[string, () => Promise<LightMyRequestResponse>, number]> = [
      ["422", () => app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics`, payload: { name: "" } }), 422],
      ["404 topic", () => app.inject({ method: "DELETE", url: `/api/v1/teams/${teamId}/topics/${randomUUID()}?confirm=true` }), 404],
      ["409 lock", () => app.inject({ method: "POST", url: `/api/v1/teams/${locked}/topics`, payload: addBody }), 409],
    ];
    try {
      for (const [label, send, status] of cases) {
        const before = await topicWriteWindowState(fac);
        const res = await send();
        expect(res.statusCode, label).toBe(status);
        const after = await topicWriteWindowState(fac);
        expect([after.burst - before.burst, after.daily - before.daily], label).toEqual([1, 1]);
      }
      const before = await topicWriteWindowState(fac);
      const preflight = await app.inject({ method: "DELETE", url: `/api/v1/teams/${teamId}/topics/${t1}` });
      expect(preflight.statusCode).toBe(200);
      expect(preflight.json()).toMatchObject({ requiresConfirmation: true });
      const after = await topicWriteWindowState(fac);
      expect([after.burst - before.burst, after.daily - before.daily]).toEqual([1, 1]);
    } finally {
      await app.close();
      await mods.db.query(`DELETE FROM action_items WHERE team_id = $1`, [teamId]);
    }
  });

  it("no lockout: once the window clears the next write reaches the cascade, and GET /topics/all works over budget", async () => {
    const { fac, teamId } = await seedTeam();
    await seedOverBudget(fac);
    const { app } = await loggedApp(fac);
    try {
      expect((await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics`, payload: addBody })).statusCode).toBe(429);
      // Reads are never limited, even over budget.
      expect((await app.inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics/all` })).statusCode).toBe(200);
      // The window clears (every entry ages out).
      await resetTopicWriteBudget(fac);
      expect((await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics`, payload: addBody })).statusCode).toBe(201);
    } finally {
      await app.close();
    }
  });
});
