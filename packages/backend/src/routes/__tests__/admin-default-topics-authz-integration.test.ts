import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildUnauthenticatedFullApp,
  probeInfra,
  requireInfraOrThrow,
  seedOverBudget,
  topicWriteWindowState,
  SENTINEL_TEAM_ID,
} from "./helpers/real-db.js";
import {
  buildLoggedFullApp,
  createActors,
  useMaintenanceTemplate,
  type LogLine,
} from "./helpers/maintenance-test-hygiene.js";
import { DENIAL_AUDIT_LIMIT, denialAuditKey } from "../../auth/denial-audit-limiter.js";
import { TOPIC_WRITE_LIMITS } from "../topic-write-rate-limit.js";
import { MAINTENANCE_AUDIT_OPERATIONS } from "../../sessions/default-topic-maintenance.js";

// ---------------------------------------------------------------------------
// admin-default-topic-maintenance (#216) tasks.md 5.1 (denial audit at route
// level), 5.2 (authorization on all seven routes) and 5.4 (rate limit), against
// real Postgres and Redis. The timing floor is read from the REAL timing
// module, not the `{ CONTENT_TIMING_FLOOR_MS: 150 }` mock several unit tests use.
// ---------------------------------------------------------------------------

// The 150 ms timing floor is mocked away here so the ~100 requests below stay fast; its real
// behaviour (against the real CONTENT_TIMING_FLOOR_MS) is asserted in
// admin-default-topics-timing-integration.test.ts.
vi.mock("../../content/timing-oracle.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  applyTimingFloor: async () => undefined,
}));

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "admin-default-topics-authz-integration.test.ts");

const BASE = "/api/v1/admin/default-topics";
const SOME_ID = "11111111-1111-4111-8111-111111111111";

interface RouteCase {
  label: string;
  method: "GET" | "POST" | "PUT" | "PATCH";
  url: string;
  payload?: unknown;
}
const SEVEN: RouteCase[] = [
  { label: "list", method: "GET", url: BASE },
  { label: "history", method: "GET", url: `${BASE}/history` },
  { label: "add", method: "POST", url: BASE, payload: { name: "X" } },
  { label: "reorder", method: "PUT", url: `${BASE}/order`, payload: { order: [] } },
  { label: "edit", method: "PATCH", url: `${BASE}/${SOME_ID}`, payload: { name: "X" } },
  { label: "archive", method: "POST", url: `${BASE}/${SOME_ID}/archive` },
  { label: "restore", method: "POST", url: `${BASE}/${SOME_ID}/restore` },
];
const WRITES = SEVEN.filter((r) => r.method !== "GET");

describe.skipIf(!infraUp)("admin default-topics authorization and rate limit (real Postgres + Redis, #216)", () => {
  const h = useMaintenanceTemplate();
  let actors: Awaited<ReturnType<typeof createActors>>;
  const denialActors: string[] = [];

  beforeAll(async () => {
    actors = await createActors(h.fx);
  });
  afterAll(async () => {
    for (const id of [...denialActors, actors?.nonMemberFacilitator, actors?.memberFacilitator, actors?.engineeringManager, actors?.seniorEngineer]) {
      if (id) await h.mods.redis.del(denialAuditKey(id));
    }
  });

  const send = async (app: FastifyInstance, c: RouteCase, extra: Record<string, unknown> = {}) =>
    app.inject({ method: c.method, url: c.url, ...(c.payload !== undefined ? { payload: c.payload as object } : {}), ...extra });
  const denialRows = async (userId: string) =>
    (
      await h.mods.db.query<{ team_id: string | null; metadata: Record<string, unknown> }>(
        `SELECT team_id, metadata FROM audit_log WHERE actor_user_id = $1 AND operation = 'topic.default_maintenance_denied'`,
        [userId],
      )
    ).rows;

  it("an unauthenticated caller gets 401 on every one of the seven routes", async () => {
    const app = await buildUnauthenticatedFullApp(h.mods);
    try {
      for (const c of SEVEN) {
        const res = await send(app, c);
        expect(res.statusCode, c.label).toBe(401);
      }
    } finally {
      await app.close();
    }
  });

  describe.each([
    ["a non-member facilitator", () => actors.nonMemberFacilitator],
    ["a facilitator who is a member of a team", () => actors.memberFacilitator],
    ["an engineering manager", () => actors.engineeringManager],
    ["a senior engineer", () => actors.seniorEngineer],
  ])("%s", (_label, who) => {
    it("gets 403 DEFAULT_MAINTENANCE_ADMIN_ONLY, category forbidden, on every one of the seven routes, with the template unchanged", async () => {
      const userId = who();
      const app = await h.appFor(userId);
      for (const c of SEVEN) {
        const res = await send(app, c);
        expect(res.statusCode, c.label).toBe(403);
        const err = res.json().error;
        expect(err).toMatchObject({ category: "forbidden", code: "DEFAULT_MAINTENANCE_ADMIN_ONLY" });
        expect(err.code).not.toBe("NOT_AN_ADMIN");
        expect(err.code).not.toBe("NOT_A_FACILITATOR");
      }
      const rows = await denialRows(userId);
      expect(rows).toHaveLength(SEVEN.length);
      for (const r of rows) {
        expect(r.team_id).toBeNull();
        // Method plus the route TEMPLATE, never the raw URL or an id.
        expect(r.metadata["endpoint"]).toMatch(/^(GET|POST|PUT|PATCH) \/api\/v1\/admin\/default-topics/);
        expect(JSON.stringify(r.metadata)).not.toContain(SOME_ID);
        expect(r.metadata["reason"]).toBe("DEFAULT_MAINTENANCE_ADMIN_ONLY");
      }
      expect(rows.map((r) => r.metadata["endpoint"]).sort()).toEqual(
        [
          `GET ${BASE}`,
          `GET ${BASE}/history`,
          `POST ${BASE}`,
          `PUT ${BASE}/order`,
          `PATCH ${BASE}/:topicId`,
          `POST ${BASE}/:topicId/archive`,
          `POST ${BASE}/:topicId/restore`,
        ].sort(),
      );
    });
  });

  describe("the role check runs before the body is parsed (security review M1)", () => {
    const BODIES: Array<[string, Record<string, unknown>]> = [
      ["a 20 KiB body", { headers: { "content-type": "application/json" }, payload: JSON.stringify({ name: "x".repeat(20 * 1024) }) }],
      ["malformed JSON", { headers: { "content-type": "application/json" }, payload: "{bad json" }],
      ["a form-encoded body", { headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "name=x" }],
      ["an application/xml body", { headers: { "content-type": "application/xml" }, payload: "<a/>" }],
      ["a text/plain body", { headers: { "content-type": "text/plain" }, payload: "hello" }],
    ];

    it.each(BODIES)("a non-admin sending %s gets the envelope 403, the denial row and no state change", async (_label, req) => {
      const userId = await h.fx.user("facilitator");
      denialActors.push(userId);
      const app = await h.appFor(userId);
      const before = (await h.mods.db.query(`SELECT count(*)::int AS n FROM topics WHERE team_id = $1`, [SENTINEL_TEAM_ID])).rows[0].n;
      for (const [method, url] of [["POST", BASE], ["PUT", `${BASE}/order`], ["PATCH", `${BASE}/${SOME_ID}`]] as const) {
        const res = await app.inject({ method, url, ...req });
        expect(res.statusCode, `${method} ${url}`).toBe(403);
        expect(res.json().error).toMatchObject({ category: "forbidden", code: "DEFAULT_MAINTENANCE_ADMIN_ONLY" });
        expect(res.headers["cache-control"]).toBe("no-store");
      }
      expect(await denialRows(userId)).toHaveLength(3);
      expect((await h.mods.db.query(`SELECT count(*)::int AS n FROM topics WHERE team_id = $1`, [SENTINEL_TEAM_ID])).rows[0].n).toBe(before);
    });

    it.each([
      ["a 20 KiB body", { headers: { "content-type": "application/json" }, payload: JSON.stringify({ name: "x".repeat(20 * 1024) }) }, 413, "BODY_TOO_LARGE"],
      ["malformed JSON", { headers: { "content-type": "application/json" }, payload: "{bad json" }, 400, "INVALID_JSON_BODY"],
      ["a form-encoded body", { headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "name=x" }, 415, "UNSUPPORTED_MEDIA_TYPE"],
      ["an application/xml body", { headers: { "content-type": "application/xml" }, payload: "<a/>" }, 415, "UNSUPPORTED_MEDIA_TYPE"],
    ])("an admin sending %s gets an envelope error (no parser text)", async (_label, req, status, code) => {
      const app = await h.appFor(actors.admin);
      const res = await app.inject({ method: "POST", url: BASE, ...(req as object) });
      expect(res.statusCode).toBe(status);
      expect(res.json().error).toMatchObject({ code, correlationId: expect.any(String) });
      expect(res.body).not.toMatch(/FST_|Unexpected token|JSON at position/);
    });

    it("an admin's archive and restore accept an empty body with a JSON content type", async () => {
      const app = await h.appFor(actors.admin);
      const id = (await app.inject({ method: "GET", url: BASE })).json().defaults[0].id as string;
      const headers = { "content-type": "application/json" };
      expect((await app.inject({ method: "POST", url: `${BASE}/${id}/archive`, headers })).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: `${BASE}/${id}/restore`, headers })).statusCode).toBe(200);
    });

    it("a role-read database failure is the generic envelope 500 with no error text", async () => {
      const { db } = await import("../../db.js");
      const app = await h.appFor(actors.admin);
      const original = db.query.bind(db) as (...a: unknown[]) => unknown;
      const spy = vi.spyOn(db, "query").mockImplementation(((...args: unknown[]) => {
        const text = String(typeof args[0] === "string" ? args[0] : (args[0] as { text: string }).text);
        if (text.includes("SELECT global_role")) return Promise.reject(new Error("connection refused to secret-host"));
        return original(...args);
      }) as never);
      try {
        const res = await app.inject({ method: "GET", url: BASE });
        expect(res.statusCode).toBe(500);
        expect(res.json().error).toMatchObject({ category: "internal_error", code: "DEFAULT_MAINTENANCE_FAILED" });
        expect(res.body).not.toContain("secret-host");
      } finally {
        spy.mockRestore();
      }
    });
  });

  it("an administrator who is on no team and one who is a member of a team are both admitted", async () => {
    for (const userId of [actors.admin, actors.adminOnTeam]) {
      const app = await h.appFor(userId);
      const res = await app.inject({ method: "GET", url: BASE });
      expect(res.statusCode).toBe(200);
      expect(res.json().defaults.length).toBeGreaterThan(0);
    }
  });

  it("the role is read live: an administrator demoted after login gets 403 on the next request", async () => {
    const userId = await h.fx.user("application_admin");
    const app = await h.appFor(userId);
    expect((await app.inject({ method: "GET", url: BASE })).statusCode).toBe(200);
    await h.fx.setRoles(userId, ["facilitator"]);
    expect((await app.inject({ method: "GET", url: BASE })).statusCode).toBe(403);
    await h.fx.setRoles(userId, ["application_admin"]);
    expect((await app.inject({ method: "GET", url: BASE })).statusCode).toBe(200);
  });

  it("a caller with no users row is a non-admin: 403", async () => {
    const app = await h.appFor(randomUUID());
    const res = await app.inject({ method: "GET", url: BASE });
    expect(res.statusCode).toBe(403);
  });

  it("the 403 precedes validation, the rate limit and the lookup: an invalid body and a non-canonical id still get 403, and no budget is spent", async () => {
    const userId = actors.nonMemberFacilitator;
    const app = await h.appFor(userId);
    const bad: RouteCase[] = [
      { label: "bad add", method: "POST", url: BASE, payload: { name: "<b>", prompt: 5 } },
      { label: "bad reorder", method: "PUT", url: `${BASE}/order`, payload: { order: "nope" } },
      { label: "bad id", method: "PATCH", url: `${BASE}/not-a-uuid`, payload: { name: 5 } },
      { label: "bad id archive", method: "POST", url: `${BASE}/not-a-uuid/archive` },
    ];
    for (const c of bad) expect((await send(app, c)).statusCode, c.label).toBe(403);
    const state = await topicWriteWindowState(userId);
    expect(state.burst).toBe(0);
    expect(state.daily).toBe(0);
    // Even an over-budget non-admin is told 403, not 429.
    await seedOverBudget(userId);
    const res = await send(app, bad[0]!);
    expect(res.statusCode).toBe(403);
  });

  it("an over-budget non-admin gets 403 (not 429) on a write route", async () => {
    const userId = await h.fx.user("facilitator");
    const app = await h.appFor(userId);
    await seedOverBudget(userId);
    expect((await send(app, WRITES[0]!)).statusCode).toBe(403);
  });

  it("the denial audit is bounded per actor: the 11th denial in a window is still 403, writes no row and logs one suppression event", async () => {
    const userId = await h.fx.user("facilitator");
    denialActors.push(userId);
    const lines: LogLine[] = [];
    const app = await buildLoggedFullApp(h.mods, userId, lines);
    try {
      const limit = DENIAL_AUDIT_LIMIT.limit; // read from the constant (10 today)
      for (let i = 0; i < limit + 1; i++) {
        const res = await app.inject({ method: "GET", url: BASE });
        expect(res.statusCode).toBe(403);
      }
      expect(await denialRows(userId)).toHaveLength(limit);
      const suppressed = lines.filter((l) => l.event === "topic.denial_audit_suppressed");
      expect(suppressed).toHaveLength(1);
      expect(suppressed[0]).toMatchObject({ family: "/api/v1/admin/default-topics", reason: "limit", suppressedCount: 1, actorUserId: userId });
      // More denials: still 403, still no new rows; the running count is logged at 2, 4, ...
      for (let i = 0; i < 3; i++) expect((await app.inject({ method: "GET", url: BASE })).statusCode).toBe(403);
      expect(await denialRows(userId)).toHaveLength(limit);
      const after = lines.filter((l) => l.event === "topic.denial_audit_suppressed").map((l) => l["suppressedCount"]);
      expect(after).toEqual([1, 2, 4]);
    } finally {
      await app.close();
    }
  });

  it("the denial row carries the actor and no topic text, and the denial event is emitted", async () => {
    const userId = await h.fx.user("facilitator");
    denialActors.push(userId);
    const lines: LogLine[] = [];
    const app = await buildLoggedFullApp(h.mods, userId, lines);
    try {
      const res = await app.inject({ method: "POST", url: BASE, payload: { name: "Sneaky Name", prompt: "Sneaky Prompt?" } });
      expect(res.statusCode).toBe(403);
      const row = (
        await h.mods.db.query(
          `SELECT actor_user_id, actor_global_role, host(actor_ip) AS ip, team_id, metadata FROM audit_log
            WHERE actor_user_id = $1 AND operation = 'topic.default_maintenance_denied'`,
          [userId],
        )
      ).rows[0];
      expect(row).toMatchObject({ actor_user_id: userId, actor_global_role: "facilitator", team_id: null });
      expect(row.metadata).toMatchObject({ endpoint: `POST ${BASE}`, http_status: 403 });
      expect(JSON.stringify(row.metadata)).not.toContain("Sneaky");
      expect(lines.filter((l) => l.event === "topic.default_maintenance_denied")).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("the denial row does not match the five maintenance operations", async () => {
    const userId = await h.fx.user("facilitator");
    denialActors.push(userId);
    const app = await h.appFor(userId);
    await app.inject({ method: "GET", url: BASE });
    const matched = await h.mods.db.query(
      `SELECT 1 FROM audit_log WHERE actor_user_id = $1 AND operation = ANY($2::text[])`,
      [userId, [...MAINTENANCE_AUDIT_OPERATIONS]],
    );
    expect(matched.rowCount).toBe(0);
    expect(await denialRows(userId)).toHaveLength(1);
  });

  it("fail-open: when the denial audit write fails the response is still the 403", async () => {
    const userId = await h.fx.user("facilitator");
    denialActors.push(userId);
    const app = await h.appFor(userId);
    const { vi } = await import("vitest");
    const { db } = await import("../../db.js");
    const original = db.query.bind(db) as (...a: unknown[]) => unknown;
    const spy = vi.spyOn(db, "query").mockImplementation(((...args: unknown[]) => {
      const text = String(typeof args[0] === "string" ? args[0] : (args[0] as { text: string }).text);
      if (text.includes("INSERT INTO audit_log")) return Promise.reject(new Error("audit store down"));
      return original(...args);
    }) as never);
    try {
      const res = await app.inject({ method: "GET", url: BASE });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("DEFAULT_MAINTENANCE_ADMIN_ONLY");
    } finally {
      spy.mockRestore();
    }
    expect(await denialRows(userId)).toHaveLength(0);
  });

  it("a denial when the limiter store errors is still the 403, writes no row and logs one event per actor per window", async () => {
    const userId = await h.fx.user("facilitator");
    denialActors.push(userId);
    const lines: LogLine[] = [];
    const app = await buildLoggedFullApp(h.mods, userId, lines);
    const { vi } = await import("vitest");
    const sliding = await import("../../auth/sliding-window-limiter.js");
    const spy = vi.spyOn(sliding, "recordAndCountSlidingWindow").mockRejectedValue(new Error("redis down"));
    try {
      for (let i = 0; i < 3; i++) expect((await app.inject({ method: "GET", url: BASE })).statusCode).toBe(403);
    } finally {
      spy.mockRestore();
      await app.close();
    }
    expect(await denialRows(userId)).toHaveLength(0);
    const events = lines.filter((l) => l.event === "topic.denial_audit_suppressed");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ reason: "limiter_error", family: "/api/v1/admin/default-topics" });
  });

  describe("input boundaries", () => {
    it("a non-canonical :topicId is 404 DEFAULT_TOPIC_NOT_FOUND without a query; a real team's topic id is the same 404", async () => {
      const app = await h.appFor(actors.admin);
      for (const c of [
        { method: "PATCH", url: `${BASE}/not-a-uuid`, payload: { name: "X" } },
        { method: "POST", url: `${BASE}/not-a-uuid/archive` },
        { method: "POST", url: `${BASE}/not-a-uuid/restore` },
      ] as const) {
        const res = await app.inject(c);
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe("DEFAULT_TOPIC_NOT_FOUND");
      }
      const teamTopic = await h.fx.topic(actors.team, { displayOrder: 1, name: "Team Only Topic" });
      const unknown = await app.inject({ method: "PATCH", url: `${BASE}/${randomUUID()}`, payload: { name: "X" } });
      const real = await app.inject({ method: "PATCH", url: `${BASE}/${teamTopic}`, payload: { name: "X" } });
      for (const res of [unknown, real]) {
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe("DEFAULT_TOPIC_NOT_FOUND");
      }
      expect({ ...real.json().error, correlationId: "x" }).toEqual({ ...unknown.json().error, correlationId: "x" });
      for (const url of [`${BASE}/${teamTopic}/archive`, `${BASE}/${teamTopic}/restore`]) {
        expect((await app.inject({ method: "POST", url })).statusCode).toBe(404);
      }
      // The team's topic is untouched.
      const row = (await h.mods.db.query(`SELECT name, status FROM topics WHERE id = $1`, [teamTopic])).rows[0];
      expect(row).toMatchObject({ name: "Team Only Topic", status: "active" });
    });

    it("the sentinel id carried in a body or query is not accepted as input and changes nothing outside the template", async () => {
      const app = await h.appFor(actors.admin);
      const res = await app.inject({
        method: "GET",
        url: `${BASE}?teamId=${actors.team}&team_id=${SENTINEL_TEAM_ID}`,
      });
      expect(res.statusCode).toBe(200);
      const add = await app.inject({
        method: "POST",
        url: `${BASE}?teamId=${actors.team}`,
        payload: { name: "Team Id Ignored", prompt: "Prompt?", firstSessionDescription: "About.", voteType: "finger", teamId: actors.team, team_id: actors.team },
      });
      expect(add.statusCode).toBe(201);
      const row = (await h.mods.db.query(`SELECT team_id FROM topics WHERE id = $1`, [add.json().changedTopicId])).rows[0];
      expect(row.team_id).toBe(SENTINEL_TEAM_ID);
      expect((await h.mods.db.query(`SELECT 1 FROM topics WHERE team_id = $1 AND name = 'Team Id Ignored'`, [actors.team])).rowCount).toBe(0);
    });
  });

  // ---- 5.4 rate limit --------------------------------------------------------
  describe("5.4 shared topic-write budget", () => {
    it("TOPIC_WRITE_LIMITS is unchanged", () => {
      expect(TOPIC_WRITE_LIMITS).toEqual({
        burst: { limit: 120, windowMs: 10 * 60 * 1000 },
        daily: { limit: 400, windowMs: 24 * 60 * 60 * 1000 },
      });
    });

    it("an administrator over the shared budget gets the same 429 body shape and Retry-After on every write route, and GETs are unlimited", async () => {
      const userId = await h.fx.user("application_admin");
      const app = await h.appFor(userId);
      await seedOverBudget(userId);
      const bodies: Array<Record<string, unknown>> = [];
      for (const c of WRITES) {
        const res = await send(app, c);
        expect(res.statusCode, c.label).toBe(429);
        expect(res.headers["retry-after"], c.label).toBeDefined();
        const err = res.json().error;
        expect(err.category).toBe("rate_limited");
        expect(err.code).toMatch(/^TOPIC_WRITE_(BURST|DAILY)_LIMIT_EXCEEDED$/);
        bodies.push({ code: err.code, message: err.message });
      }
      expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
      for (const c of SEVEN.filter((r) => r.method === "GET")) {
        expect((await send(app, c)).statusCode, c.label).toBe(200);
      }
      // The breach row carries the sentinel as its team (and stays unverified).
      const breach = await h.mods.db.query(
        `SELECT team_id, metadata FROM audit_log WHERE actor_user_id = $1 AND operation = 'topic.write_rate_limited'`,
        [userId],
      );
      expect(breach.rows.length).toBeGreaterThan(0);
      expect(breach.rows[0].team_id).toBe(SENTINEL_TEAM_ID);
      expect(breach.rows[0].metadata.team_verified).toBe(false);
    });

    it("each admitted write consumes one unit, including a later 422, and a 429 consumes none", async () => {
      const userId = await h.fx.user("application_admin");
      const app = await h.appFor(userId);
      expect((await topicWriteWindowState(userId)).burst).toBe(0);
      expect((await app.inject({ method: "POST", url: BASE, payload: {} })).statusCode).toBe(422);
      expect((await topicWriteWindowState(userId)).burst).toBe(1);
      expect((await app.inject({ method: "GET", url: BASE })).statusCode).toBe(200);
      expect((await topicWriteWindowState(userId)).burst).toBe(1);
      await seedOverBudget(userId);
      const before = await topicWriteWindowState(userId);
      expect((await app.inject({ method: "POST", url: BASE, payload: {} })).statusCode).toBe(429);
      expect((await topicWriteWindowState(userId)).burst).toBe(before.burst);
    });

    it("an unavailable limiter store fails closed with 503 and changes nothing", async () => {
      const userId = await h.fx.user("application_admin");
      const app = await h.appFor(userId);
      const { vi } = await import("vitest");
      const before = (await h.mods.db.query(`SELECT count(*)::int AS n FROM topics WHERE team_id = $1`, [SENTINEL_TEAM_ID])).rows[0].n;
      const spy = vi.spyOn(h.mods.redis, "eval").mockImplementation((() => Promise.reject(new Error("redis down"))) as never);
      try {
        const res = await app.inject({
          method: "POST",
          url: BASE,
          payload: { name: "Redis Down", prompt: "P?", firstSessionDescription: "D.", voteType: "finger" },
        });
        expect(res.statusCode).toBe(503);
        expect(res.json().error.code).toBe("TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE");
        expect(res.headers["retry-after"]).toBeDefined();
      } finally {
        spy.mockRestore();
      }
      expect((await h.mods.db.query(`SELECT count(*)::int AS n FROM topics WHERE team_id = $1`, [SENTINEL_TEAM_ID])).rows[0].n).toBe(before);
    });
  });
});
