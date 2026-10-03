// limiter-under-test
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  Fixture,
  seedTopicWriteWindows,
  topicWriteWindowState,
} from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// harden-topic-write-endpoints (#184) task 5.10 — the limiter fails closed.
//
// The `// limiter-under-test` marker above opts this file out of the 5.4a
// limiter-mock guard: it exercises the REAL limiter, forcing the shared Redis
// client's eval to throw or to hang. Real Postgres shows that nothing is
// written. On all five routes, for both failure modes:
//   503 TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE, Retry-After 30, no-store, within
//   floor + 500 ms + 250 ms; topic rows unchanged; no audit_log row;
//   topic.write_rate_limit_check_failed emitted.
// Unchanged windows are asserted ONLY for the throw case: a timed-out command
// may still run later (Decision 4 / security C3).
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "topic-write-rate-limit-redis-failure-integration.test.ts");

const FLOOR_MS = 150;
const BOUND_MS = FLOOR_MS + 500 + 250;

describe.skipIf(!infraUp)("topic-write limiter fails closed when Redis fails (#184 5.10)", () => {
  let mods: Mods;
  let fx: Fixture;

  beforeAll(async () => {
    mods = await loadModules();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fx?.cleanup();
  });

  async function loggedApp(userId: string): Promise<{ app: FastifyInstance; events: () => Array<Record<string, unknown>> }> {
    const lines: string[] = [];
    const app = Fastify({ logger: { level: "info", stream: { write: (l: string) => void lines.push(l) } } });
    app.decorateRequest("session", null);
    app.addHook("onRequest", async (request) => {
      (request as unknown as Record<string, unknown>).session = { userId };
    });
    app.register(mods.topicRoutes);
    await app.ready();
    return {
      app,
      events: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((e) => typeof e["event"] === "string"),
    };
  }

  async function topicRows(teamId: string) {
    return (
      await mods.db.query(
        `SELECT id, name, status, display_order, team_annotation FROM topics WHERE team_id = $1 ORDER BY id`,
        [teamId],
      )
    ).rows;
  }

  for (const mode of ["throws", "hangs"] as const) {
    it(`Redis ${mode}: every topic-write route answers 503 in time and writes nothing`, async () => {
      fx = new Fixture(mods.db);
      const fac = await fx.user();
      const teamId = await fx.team(fac);
      await fx.unlock(teamId, fac);
      const t1 = await fx.topic(teamId, { displayOrder: 1 });
      const t2 = await fx.topic(teamId, { displayOrder: 2 });
      const t3 = await fx.topic(teamId, { displayOrder: 50, status: "archived" });
      await seedTopicWriteWindows(fac, { burst: [Date.now() - 1_000], daily: [Date.now() - 1_000] });

      const requests = [
        { label: "add", method: "POST", url: `/api/v1/teams/${teamId}/topics`, payload: { name: "N", prompt: "P?", voteType: "finger" } },
        { label: "archive", method: "DELETE", url: `/api/v1/teams/${teamId}/topics/${t1}?confirm=true`, payload: undefined },
        { label: "restore", method: "POST", url: `/api/v1/teams/${teamId}/topics/${t3}/restore`, payload: {} },
        { label: "reorder", method: "PUT", url: `/api/v1/teams/${teamId}/topics/order`, payload: { orderedTopicIds: [t2, t1] } },
        { label: "annotation", method: "PUT", url: `/api/v1/teams/${teamId}/topics/${t1}/annotation`, payload: { annotation: "x" } },
      ] as const;

      const { redis } = await import("../../redis.js");
      vi.spyOn(redis, "eval").mockImplementation((() =>
        mode === "throws" ? Promise.reject(new Error("ECONNREFUSED")) : new Promise(() => undefined)) as never);

      const topicsBefore = await topicRows(teamId);
      const { app, events } = await loggedApp(fac);
      try {
        for (const r of requests) {
          const started = Date.now();
          const res = await app.inject({ method: r.method, url: r.url, ...(r.payload === undefined ? {} : { payload: r.payload }) });
          const elapsed = Date.now() - started;
          expect(res.statusCode, r.label).toBe(503);
          expect(res.headers["retry-after"], r.label).toBe("30");
          expect(res.headers["cache-control"], r.label).toBe("no-store");
          expect(res.json().error, r.label).toMatchObject({
            category: "service_unavailable",
            code: "TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE",
            message:
              "Topic changes are temporarily unavailable. This change wasn't saved; changes you made earlier are kept. Please try again shortly.",
          });
          expect(elapsed, r.label).toBeGreaterThanOrEqual(FLOOR_MS - 5);
          expect(elapsed, r.label).toBeLessThan(BOUND_MS);
        }
      } finally {
        await app.close();
        vi.restoreAllMocks();
      }

      expect(await topicRows(teamId)).toEqual(topicsBefore);
      const audit = await mods.db.query(`SELECT operation FROM audit_log WHERE actor_user_id = $1`, [fac]);
      expect(audit.rows).toEqual([]);
      const failed = events().filter((e) => e["event"] === "topic.write_rate_limit_check_failed");
      expect(failed).toHaveLength(requests.length);
      for (const e of failed) expect(e).toMatchObject({ teamId, failureMode: mode === "throws" ? "error" : "timeout" });

      if (mode === "throws") {
        const state = await topicWriteWindowState(fac);
        expect([state.burst, state.daily]).toEqual([1, 1]);
      }
    });
  }
});
