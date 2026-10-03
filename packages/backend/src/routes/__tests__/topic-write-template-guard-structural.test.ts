import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance, HTTPMethods, RouteOptions } from "fastify";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  buildFullApp,
  Fixture,
  SENTINEL_TEAM_ID,
} from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";
import { snapshotTemplate, assertTemplateUnchanged, restoreTemplate } from "./helpers/template-snapshot.js";

// ---------------------------------------------------------------------------
// Structural template-guard test — reject-template-team-topic-writes (#188),
// design.md D4, tasks.md 3.3.
//
// Enumerates EVERY registered route (onRoute hook over the same
// registerRoutes() buildApp() uses -- never a hand-written list) and sends
// each team-scoped topic-write route one request against the
// __default_topics__ template team. Each must answer 404 TEAM_NOT_FOUND AND
// write exactly one topic.write_denied_template row: the audit row is the
// only evidence specific to the guard (a 404 alone could be a topic lookup).
//
// Safe in either lock state, and fails in either state when the guard is
// missing: a locked template answers 409, an unlocked one 404
// TOPIC_NOT_FOUND or 422. The template is snapshotted, asserted unchanged
// after every request, and restored in a finally (security review S3), in
// case a future route skips both the guard and the lock and accepts {}.
//
// REQUIRE_DB: this file is the only mechanism that enforces the guard on
// future routes, so it must fail, not skip, in the integration.yml lane.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "topic-write-template-guard-structural.test.ts");

const TEAM_TOPICS_PREFIX = /^\/api\/v1\/teams\/:[^/]+\/topics(\/|$)/;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE", "ALL", "*"]);
const OTHER_PARAM_VALUE = "ffffffff-ffff-4fff-bfff-ffffffffffff";

// Routes that write the topics table OUTSIDE the /api/v1/teams/:teamId/topics
// prefix. The author of any such route adds it here, as "METHOD /url", in the
// same PR (code review enforces this). Its first path parameter must be the
// team id. There is deliberately no exemption list.
const EXTRA_IN_SCOPE_ROUTES: readonly string[] = [];

const KNOWN_ROUTES = [
  "POST /api/v1/teams/:teamId/topics",
  "DELETE /api/v1/teams/:teamId/topics/:topicId",
  "POST /api/v1/teams/:teamId/topics/:topicId/restore",
  "PUT /api/v1/teams/:teamId/topics/order",
  "PUT /api/v1/teams/:teamId/topics/:topicId/annotation",
];

function methodsOf(route: RouteOptions): string[] {
  return (Array.isArray(route.method) ? route.method : [route.method]).map((m) => String(m).toUpperCase());
}

/** "METHOD /url" for each write method of every in-scope route. */
function inScope(routes: RouteOptions[]): string[] {
  const selected = new Set<string>();
  for (const route of routes) {
    const methods = methodsOf(route);
    if (TEAM_TOPICS_PREFIX.test(route.url)) {
      for (const method of methods) {
        if (!WRITE_METHODS.has(method)) continue;
        // A wildcard route is exercised as a POST.
        selected.add(`${method === "ALL" || method === "*" ? "POST" : method} ${route.url}`);
      }
    }
    for (const method of methods) {
      if (EXTRA_IN_SCOPE_ROUTES.includes(`${method} ${route.url}`)) selected.add(`${method} ${route.url}`);
    }
  }
  return [...selected].sort();
}

/** First path parameter = the template team, every other one = OTHER_PARAM_VALUE. */
function templateUrl(url: string): string {
  let first = true;
  return url.replace(/:[^/]+/g, () => {
    const value = first ? SENTINEL_TEAM_ID : OTHER_PARAM_VALUE;
    first = false;
    return value;
  });
}

describe.skipIf(!infraUp)("structural: every team-scoped topic-write route rejects the template team (#188)", () => {
  let mods: Mods;
  let fx: Fixture;
  let app: FastifyInstance;
  let facilitatorId: string;
  const routes: RouteOptions[] = [];

  beforeAll(async () => {
    mods = await loadModules();
    fx = new Fixture(mods.db);
    facilitatorId = await fx.user("facilitator");
    app = await buildFullApp(mods, facilitatorId, (route) => routes.push(route));
  });

  afterAll(async () => {
    await app?.close();
    await fx?.cleanup();
    await mods?.redis.quit();
  });

  it("selects the known topic-write routes from the registered route table", () => {
    const selected = inScope(routes);
    expect(selected.length).toBeGreaterThan(0);
    for (const known of KNOWN_ROUTES) {
      expect(selected).toContain(known);
    }
  });

  it("each selected route answers 404 TEAM_NOT_FOUND with exactly one template-denial row, and the template is unchanged", async () => {
    const { db } = mods;
    const selected = inScope(routes);
    const snap = await snapshotTemplate(db);
    try {
      for (const key of selected) {
        const [method, url] = key.split(" ") as [HTTPMethods, string];
        const start = (await db.query<{ now: Date }>(`SELECT clock_timestamp() AS now`)).rows[0]!.now;

        const res = await app.inject({ method, url: templateUrl(url), payload: {} });

        expect(res.statusCode, key).toBe(404);
        expect(res.json().error?.code, key).toBe("TEAM_NOT_FOUND");
        const audit = await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM audit_log
            WHERE operation = 'topic.write_denied_template'
              AND actor_user_id = $1 AND "timestamp" >= $2 AND metadata->>'endpoint' = $3`,
          [facilitatorId, start, key],
        );
        expect(audit.rows[0]!.n, key).toBe(1);
        await assertTemplateUnchanged(db, snap);
      }
    } finally {
      await restoreTemplate(db, snap);
    }
  });
});
