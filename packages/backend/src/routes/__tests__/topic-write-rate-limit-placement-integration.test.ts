import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, RouteOptions } from "fastify";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  buildApp,
  buildFullApp,
  Fixture,
  SENTINEL_TEAM_ID,
  seedOverBudget,
  topicWriteWindowState,
} from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// harden-topic-write-endpoints (#184) — where the topic-write limiter sits in
// each handler's cascade, proven behaviourally against real Redis and
// Postgres (not with a regex over handler source).
//
//   5.6 Every topic-write route registered on the app (enumerated with
//       onRoute: method POST/PUT/DELETE under /api/v1/teams/:teamId/topics,
//       so a sixth write route is covered automatically and GETs are
//       excluded on purpose): an over-budget 403-bound caller gets 403 with
//       the windows unchanged (the limiter runs AFTER authz), and an
//       over-budget authorized actor on a non-existent team gets 429 with
//       zero `teams` queries (it runs BEFORE team existence).
//   5.9 Enumeration resistance: the 429 is identical for an existing, a
//       non-existent and the template team; 403 still wins over 429; a
//       non-canonical teamId is still 404; 429s don't extend the window;
//       over budget the 429 precedes the lock, body and topic checks, and no
//       denied_template / denied_locked row is written.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "topic-write-rate-limit-placement-integration.test.ts");

const TOPIC_WRITE_PREFIX = "/api/v1/teams/:teamId/topics";
const WRITE_METHODS = new Set(["POST", "PUT", "DELETE"]);

interface WriteRoute {
  method: "POST" | "PUT" | "DELETE";
  url: string;
}

function payloadFor(route: WriteRoute, topicId: string): object | undefined {
  if (route.method === "DELETE") return undefined;
  if (route.url.endsWith("/annotation")) return { annotation: "x" };
  if (route.url.endsWith("/order")) return { orderedTopicIds: [topicId] };
  if (route.url.endsWith("/restore")) return {};
  return { name: "Over budget", prompt: "Wait?", voteType: "finger" };
}

function injectWrite(app: FastifyInstance, route: WriteRoute, url: string, payload: object | undefined) {
  return payload === undefined
    ? app.inject({ method: route.method, url })
    : app.inject({ method: route.method, url, payload });
}

function concreteUrl(route: WriteRoute, teamId: string, topicId: string): string {
  return route.url.replace(":teamId", teamId).replace(":topicId", topicId) + (route.method === "DELETE" ? "?confirm=true" : "");
}

describe.skipIf(!infraUp)("topic-write limiter placement — behavioural (#184 5.6)", () => {
  let mods: Mods;
  let fx: Fixture;

  beforeAll(async () => {
    mods = await loadModules();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fx?.cleanup();
  });

  it("every topic-write route: 403-bound caller gets 403 with windows unchanged; authorized actor gets 429 with no teams query", async () => {
    fx = new Fixture(mods.db);
    const engineer = await fx.user("engineer");
    const facilitator = await fx.user("facilitator");

    const routes: WriteRoute[] = [];
    const collect = (route: RouteOptions) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) {
        if (WRITE_METHODS.has(method) && route.url.startsWith(TOPIC_WRITE_PREFIX)) {
          routes.push({ method: method as WriteRoute["method"], url: route.url });
        }
      }
    };
    const engineerApp = await buildFullApp(mods, engineer, collect);
    const facilitatorApp = await buildFullApp(mods, facilitator);

    expect(routes.map((r) => `${r.method} ${r.url}`).sort()).toEqual(
      expect.arrayContaining([
        "DELETE /api/v1/teams/:teamId/topics/:topicId",
        "POST /api/v1/teams/:teamId/topics",
        "POST /api/v1/teams/:teamId/topics/:topicId/restore",
        "PUT /api/v1/teams/:teamId/topics/:topicId/annotation",
        "PUT /api/v1/teams/:teamId/topics/order",
      ]),
    );

    await seedOverBudget(engineer);
    await seedOverBudget(facilitator);
    const engineerBefore = await topicWriteWindowState(engineer);

    try {
      for (const route of routes) {
        const label = `${route.method} ${route.url}`;
        const missingTeam = randomUUID();
        const topicId = randomUUID();

        // (a) after authz: 403, and the 403-bound caller's windows are untouched.
        const denied = await injectWrite(engineerApp, route, concreteUrl(route, missingTeam, topicId), payloadFor(route, topicId));
        expect(denied.statusCode, label).toBe(403);
        const engineerAfter = await topicWriteWindowState(engineer);
        expect([engineerAfter.burst, engineerAfter.daily], label).toEqual([engineerBefore.burst, engineerBefore.daily]);

        // (b) before team existence: 429 with zero queries against teams.
        const spy = vi.spyOn(mods.db, "query");
        const limited = await injectWrite(facilitatorApp, route, concreteUrl(route, missingTeam, topicId), payloadFor(route, topicId));
        const teamsQueries = spy.mock.calls.filter((c) => /\bFROM\s+teams\b/i.test(String(c[0])));
        spy.mockRestore();
        expect(limited.statusCode, label).toBe(429);
        expect(teamsQueries, label).toHaveLength(0);
      }
    } finally {
      await engineerApp.close();
      await facilitatorApp.close();
    }
  });
});

describe.skipIf(!infraUp)("topic-write limiter — enumeration resistance (#184 5.9)", () => {
  let mods: Mods;
  let fx: Fixture;

  beforeAll(async () => {
    mods = await loadModules();
  });

  afterEach(async () => {
    await fx?.cleanup();
  });

  const ROUTES = [
    { label: "TOPIC-003 add", method: "POST", url: (t: string) => `/api/v1/teams/${t}/topics`, payload: { name: "X", prompt: "Y?", voteType: "finger" } as object | undefined, adminAllowed: true },
    { label: "TOPIC-004 archive", method: "DELETE", url: (t: string, p: string) => `/api/v1/teams/${t}/topics/${p}?confirm=true`, payload: undefined, adminAllowed: true },
    { label: "TOPIC-005 restore", method: "POST", url: (t: string, p: string) => `/api/v1/teams/${t}/topics/${p}/restore`, payload: {}, adminAllowed: true },
    { label: "TOPIC-006 reorder", method: "PUT", url: (t: string) => `/api/v1/teams/${t}/topics/order`, payload: { orderedTopicIds: [] }, adminAllowed: true },
    { label: "TOPIC-007 annotation", method: "PUT", url: (t: string, p: string) => `/api/v1/teams/${t}/topics/${p}/annotation`, payload: { annotation: "x" }, adminAllowed: false },
  ] as const;

  type Route = (typeof ROUTES)[number];

  function send(app: Awaited<ReturnType<typeof buildApp>>, route: Route, teamId: string, topicId: string, payload?: object) {
    const body = payload ?? route.payload;
    return app.inject({
      method: route.method,
      url: route.url(teamId, topicId),
      ...(body === undefined ? {} : { payload: body }),
    });
  }

  async function denialRows(userId: string) {
    return (
      await mods.db.query<{ operation: string }>(
        `SELECT operation FROM audit_log
          WHERE actor_user_id = $1 AND operation IN ('topic.write_denied_template', 'topic.write_denied_locked')`,
        [userId],
      )
    ).rows;
  }

  for (const role of ["facilitator", "application_admin"] as const) {
    it(`${role}: an identical 429 for an existing, a non-existent and the template team, and no denial rows`, async () => {
      fx = new Fixture(mods.db);
      const actor = await fx.user(role);
      const owner = await fx.user();
      const existing = await fx.team(owner);
      await fx.unlock(existing, owner);
      const topic = await fx.topic(existing, { displayOrder: 1 });
      const app = await buildApp(mods, actor);
      await seedOverBudget(actor);
      try {
        for (const route of ROUTES.filter((r) => role === "facilitator" || r.adminAllowed)) {
          const responses = [];
          for (const team of [existing, randomUUID(), SENTINEL_TEAM_ID]) {
            responses.push(await send(app, route, team, topic, route.label.includes("reorder") ? { orderedTopicIds: [topic] } : undefined));
          }
          const shapes = responses.map((r) => {
            const { category, code, message } = r.json().error as Record<string, unknown>;
            return { status: r.statusCode, cacheControl: r.headers["cache-control"], category, code, message };
          });
          expect(shapes[0], route.label).toMatchObject({ status: 429, cacheControl: "no-store", category: "rate_limited" });
          expect(shapes[1], route.label).toEqual(shapes[0]);
          expect(shapes[2], route.label).toEqual(shapes[0]);
        }
      } finally {
        await app.close();
      }
      expect(await denialRows(actor)).toEqual([]);
    });
  }

  it("an over-budget application_admin on TOPIC-007 still gets 403, not 429", async () => {
    fx = new Fixture(mods.db);
    const admin = await fx.user("application_admin");
    const team = await fx.team(admin);
    const topic = await fx.topic(team, { displayOrder: 1 });
    const app = await buildApp(mods, admin);
    await seedOverBudget(admin);
    try {
      const res = await send(app, ROUTES[4], team, topic);
      expect(res.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("a 403-bound caller never gets 429 and consumes no budget", async () => {
    fx = new Fixture(mods.db);
    const facilitator = await fx.user("facilitator");
    const team = await fx.team(facilitator);
    await fx.member(team, facilitator); // a member facilitator fails authz (FACILITATOR_IS_TEAM_MEMBER)
    const topic = await fx.topic(team, { displayOrder: 1 });
    const app = await buildApp(mods, facilitator);
    try {
      // Under budget: nothing is counted.
      for (const route of ROUTES) expect((await send(app, route, team, topic)).statusCode, route.label).toBe(403);
      const fresh = await topicWriteWindowState(facilitator);
      expect([fresh.burst, fresh.daily]).toEqual([0, 0]);
      // Over budget: still 403, and the windows do not move.
      await seedOverBudget(facilitator);
      const before = await topicWriteWindowState(facilitator);
      for (const route of ROUTES) expect((await send(app, route, team, topic)).statusCode, route.label).toBe(403);
      const after = await topicWriteWindowState(facilitator);
      expect([after.burst, after.daily]).toEqual([before.burst, before.daily]);
    } finally {
      await app.close();
    }
  });

  it("a non-canonical teamId over budget is still 404 TEAM_NOT_FOUND, with the windows unchanged", async () => {
    fx = new Fixture(mods.db);
    const facilitator = await fx.user();
    const app = await buildApp(mods, facilitator);
    await seedOverBudget(facilitator);
    const before = await topicWriteWindowState(facilitator);
    try {
      for (const route of ROUTES) {
        const res = await send(app, route, "not-a-uuid", randomUUID());
        expect(res.statusCode, route.label).toBe(404);
        expect(res.json().error.code, route.label).toBe("TEAM_NOT_FOUND");
      }
    } finally {
      await app.close();
    }
    const after = await topicWriteWindowState(facilitator);
    expect([after.burst, after.daily]).toEqual([before.burst, before.daily]);
  });

  it("429s do not extend the window: no entries added and the window TTLs are not refreshed", async () => {
    fx = new Fixture(mods.db);
    const facilitator = await fx.user();
    const team = await fx.team(facilitator);
    const app = await buildApp(mods, facilitator);
    await seedOverBudget(facilitator);
    const { redis } = await import("../../redis.js");
    const { topicWriteRateLimitKeys } = await import("../topic-write-rate-limit.js");
    const keys = topicWriteRateLimitKeys(facilitator);
    await redis.pexpire(keys.burst, 60_000);
    await redis.pexpire(keys.daily, 60_000);
    try {
      for (let i = 0; i < 5; i++) expect((await send(app, ROUTES[0], team, randomUUID())).statusCode).toBe(429);
    } finally {
      await app.close();
    }
    const after = await topicWriteWindowState(facilitator);
    expect([after.burst, after.daily]).toEqual([120, 120]);
    expect(after.burstTtl).toBeLessThanOrEqual(60_000);
    expect(after.dailyTtl).toBeLessThanOrEqual(60_000);
  });

  it("over budget, the 429 comes before the lock, the body and the topic checks, and writes no denial row", async () => {
    fx = new Fixture(mods.db);
    const facilitator = await fx.user();
    const unlocked = await fx.team(facilitator);
    await fx.unlock(unlocked, facilitator);
    const locked = await fx.team(facilitator);
    const app = await buildApp(mods, facilitator);
    await seedOverBudget(facilitator);
    try {
      // Locked team (would be 409 + topic.write_denied_locked).
      for (const route of ROUTES) expect((await send(app, route, locked, randomUUID())).statusCode, `${route.label} locked`).toBe(429);
      // Invalid bodies (would be 422).
      expect((await send(app, ROUTES[0], unlocked, randomUUID(), { name: "" })).statusCode).toBe(429);
      expect((await send(app, ROUTES[3], unlocked, randomUUID(), { orderedTopicIds: "nope" })).statusCode).toBe(429);
      expect((await send(app, ROUTES[4], unlocked, randomUUID(), { annotation: 42 })).statusCode).toBe(429);
      // Malformed and non-existent topicId on archive and restore (would be 404).
      for (const route of [ROUTES[1], ROUTES[2]]) {
        expect((await send(app, route, unlocked, "not-a-uuid")).statusCode, `${route.label} malformed`).toBe(429);
        expect((await send(app, route, unlocked, randomUUID())).statusCode, `${route.label} missing`).toBe(429);
      }
    } finally {
      await app.close();
    }
    expect(await denialRows(facilitator)).toEqual([]);
  });
});
