import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { FastifyInstance, HTTPMethods, LightMyRequestResponse } from "fastify";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  buildFullApp,
  buildUnauthenticatedFullApp,
  Fixture,
  SENTINEL_TEAM_ID,
} from "./helpers/real-db.js";
import type { Mods, Db } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// template-team-not-usable (#214) tasks.md 3.2-3.4, real Postgres: the
// session routes under /api/v1/teams/:teamId/sessions answer the
// __default_topics__ template exactly as they answer a team that does not
// exist (specs/session-creation).
//
// Never fx.track(SENTINEL_TEAM_ID). Every actor is a fresh fixture user, so
// the D2a dedupe key (actor + endpoint) is never already claimed, and every
// audit assertion is scoped by that actor and the database clock.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "template-team-session-routes-integration.test.ts");

async function dbNow(db: Db): Promise<Date> {
  return (await db.query<{ now: Date }>(`SELECT clock_timestamp() AS now`)).rows[0]!.now;
}

interface DenialRow {
  actor_global_role: string;
  team_id: string;
  metadata: Record<string, unknown>;
}

async function denialRows(db: Db, actorUserId: string, since: Date): Promise<DenialRow[]> {
  return (
    await db.query<DenialRow>(
      `SELECT actor_global_role, team_id, metadata FROM audit_log
        WHERE operation = 'team.template_access_denied' AND actor_user_id = $1 AND "timestamp" >= $2`,
      [actorUserId, since],
    )
  ).rows;
}

async function auditOperations(db: Db, actorUserId: string, since: Date): Promise<string[]> {
  return (
    await db.query<{ operation: string }>(
      `SELECT operation FROM audit_log WHERE actor_user_id = $1 AND "timestamp" >= $2 ORDER BY "timestamp"`,
      [actorUserId, since],
    )
  ).rows.map((r) => r.operation);
}

/** Template rows in the three tables migration 23 constrains. */
async function templateRowCounts(db: Db): Promise<{ sessions: number; memberships: number; links: number }> {
  const res = await db.query<{ sessions: number; memberships: number; links: number }>(
    `SELECT (SELECT count(*)::int FROM sessions WHERE team_id = $1) AS sessions,
            (SELECT count(*)::int FROM team_memberships WHERE team_id = $1) AS memberships,
            (SELECT count(*)::int FROM join_links WHERE team_id = $1) AS links`,
    [SENTINEL_TEAM_ID],
  );
  return res.rows[0]!;
}

/** Status and body, without correlationId, and with any echoed teamId replaced. */
function comparable(res: LightMyRequestResponse) {
  const body = res.json() as Record<string, unknown>;
  const copy: Record<string, unknown> = { ...body };
  if (copy["error"] && typeof copy["error"] === "object") {
    const error = { ...(copy["error"] as Record<string, unknown>) };
    delete error["correlationId"];
    copy["error"] = error;
  }
  if ("teamId" in copy) copy["teamId"] = "<teamId>";
  return { status: res.statusCode, body: copy };
}

interface SubRoute {
  method: HTTPMethods;
  endpoint: string;
  url: (teamId: string, sessionId: string) => string;
  status: number;
}

const SUB_ROUTES: SubRoute[] = [
  {
    method: "POST",
    endpoint: "POST /api/v1/teams/:teamId/sessions/:sessionId/advance",
    url: (t, s) => `/api/v1/teams/${t}/sessions/${s}/advance`,
    status: 404,
  },
  {
    // reveal answers a session it cannot find for the team with its
    // non-recoverable 409, so that is the template's parity response too.
    method: "POST",
    endpoint: "POST /api/v1/teams/:teamId/sessions/:sessionId/reveal",
    url: (t, s) => `/api/v1/teams/${t}/sessions/${s}/reveal`,
    status: 409,
  },
  {
    method: "POST",
    endpoint: "POST /api/v1/teams/:teamId/sessions/:sessionId/complete",
    url: (t, s) => `/api/v1/teams/${t}/sessions/${s}/complete`,
    status: 404,
  },
  {
    method: "POST",
    endpoint: "POST /api/v1/teams/:teamId/sessions/:sessionId/topics/advance",
    url: (t, s) => `/api/v1/teams/${t}/sessions/${s}/topics/advance`,
    status: 404,
  },
  {
    method: "GET",
    endpoint: "GET /api/v1/teams/:teamId/sessions/:sessionId/facilitator-state",
    url: (t, s) => `/api/v1/teams/${t}/sessions/${s}/facilitator-state`,
    status: 404,
  },
];

describe.skipIf(!infraUp)("session routes answer the template team as a missing team (#214)", () => {
  let mods: Mods;
  let fx: Fixture;
  const apps: FastifyInstance[] = [];

  beforeAll(async () => {
    mods = await loadModules();
    fx = new Fixture(mods.db);
  });

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
    await fx.cleanup();
  });

  afterAll(async () => {
    await mods?.redis.quit();
  });

  async function appFor(userId: string): Promise<FastifyInstance> {
    const app = await buildFullApp(mods, userId);
    apps.push(app);
    return app;
  }

  // -------------------------------------------------------------------------
  // 3.2 — POST /api/v1/teams/:teamId/sessions/draft
  // -------------------------------------------------------------------------
  describe("3.2 draft", () => {
    const draft = (app: FastifyInstance, teamId: string) =>
      app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/draft`, payload: {} });

    it("a facilitator with no memberships gets the missing-team response; no session, no join link, one audit row, no cross-team row", async () => {
      const { db } = mods;
      const facilitator = await fx.user("facilitator");
      const app = await appFor(facilitator);
      const before = await templateRowCounts(db);
      const since = await dbNow(db);

      const template = await draft(app, SENTINEL_TEAM_ID);
      const missing = await draft(app, randomUUID());

      expect(template.statusCode).toBe(404);
      expect(template.json().error.code).toBe("TEAM_NOT_FOUND");
      expect(template.json()).not.toHaveProperty("joinToken");
      expect(comparable(template)).toEqual(comparable(missing));
      expect(await templateRowCounts(db)).toEqual(before);

      const rows = await denialRows(db, facilitator, since);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        actor_global_role: "facilitator",
        team_id: SENTINEL_TEAM_ID,
        metadata: { endpoint: "POST /api/v1/teams/:teamId/sessions/draft", surface: "session" },
      });
      // The denial row only: no session.draft_denied_membership_conflict, no
      // session.draft_created, nothing for the missing team.
      expect(await auditOperations(db, facilitator, since)).toEqual(["team.template_access_denied"]);
    });

    it("a non-facilitator still gets the existing 403 and no audit row", async () => {
      const { db } = mods;
      const engineer = await fx.user("engineer");
      const since = await dbNow(db);
      const res = await draft(await appFor(engineer), SENTINEL_TEAM_ID);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.message).toBe("Only a facilitator can create a draft session.");
      expect(await denialRows(db, engineer, since)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3.3 — the session sub-routes, guarded before the session lookup
  // -------------------------------------------------------------------------
  describe("3.3 session sub-routes", () => {
    it.each(SUB_ROUTES.map((r) => [r.endpoint, r] as const))(
      "%s: the missing-session response, one audit row, no new template row",
      async (_label, route) => {
        const { db } = mods;
        const facilitator = await fx.user("facilitator");
        const app = await appFor(facilitator);
        const before = await templateRowCounts(db);
        const since = await dbNow(db);
        const sessionId = randomUUID();

        const template = await app.inject({ method: route.method, url: route.url(SENTINEL_TEAM_ID, sessionId) });
        const missing = await app.inject({ method: route.method, url: route.url(randomUUID(), sessionId) });

        expect(template.statusCode).toBe(route.status);
        if (route.status === 404) expect(template.json().error.message).toBe("Session not found.");
        expect(comparable(template)).toEqual(comparable(missing));
        expect(await templateRowCounts(db)).toEqual(before);

        const rows = await denialRows(db, facilitator, since);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.metadata).toEqual({ endpoint: route.endpoint, surface: "session" });
        expect(rows[0]!.actor_global_role).toBe("facilitator");
      },
    );

    it("facilitator-state creates no join_links row for the template", async () => {
      const { db } = mods;
      const facilitator = await fx.user("facilitator");
      const before = await templateRowCounts(db);
      const res = await (await appFor(facilitator)).inject({
        method: "GET",
        url: `/api/v1/teams/${SENTINEL_TEAM_ID}/sessions/${randomUUID()}/facilitator-state`,
      });
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain("joinToken");
      expect((await templateRowCounts(db)).links).toBe(before.links);
    });

    it("complete leaves the template's lock state unchanged", async () => {
      const { db } = mods;
      const { hasCompletedFirstSession } = await import("../../auth/topic-lock-helper.js");
      const facilitator = await fx.user("facilitator");
      const lockedBefore = await hasCompletedFirstSession(SENTINEL_TEAM_ID);
      const res = await (await appFor(facilitator)).inject({
        method: "POST",
        url: `/api/v1/teams/${SENTINEL_TEAM_ID}/sessions/${randomUUID()}/complete`,
      });
      expect(res.statusCode).toBe(404);
      expect(await hasCompletedFirstSession(SENTINEL_TEAM_ID)).toBe(lockedBefore);
      const completed = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM sessions WHERE team_id = $1 AND status = 'complete' AND completed_at > NOW() - INTERVAL '1 minute'`,
        [SENTINEL_TEAM_ID],
      );
      expect(completed.rows[0]!.n).toBe(0);
    });

    it("a participant (global role engineer) on advance gets the same 404, and the row records the real role", async () => {
      const { db } = mods;
      const engineer = await fx.user("engineer");
      const app = await appFor(engineer);
      const before = await templateRowCounts(db);
      const since = await dbNow(db);
      const sessionId = randomUUID();

      const template = await app.inject({
        method: "POST",
        url: `/api/v1/teams/${SENTINEL_TEAM_ID}/sessions/${sessionId}/advance`,
      });
      const missing = await app.inject({ method: "POST", url: `/api/v1/teams/${randomUUID()}/sessions/${sessionId}/advance` });

      expect(template.statusCode).toBe(404);
      expect(comparable(template)).toEqual(comparable(missing));
      const rows = await denialRows(db, engineer, since);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor_global_role: "engineer",
        metadata: { endpoint: "POST /api/v1/teams/:teamId/sessions/:sessionId/advance", surface: "session" },
      });
      expect(await templateRowCounts(db)).toEqual(before);
    });

    it("an unauthenticated caller gets 401 on every sub-route and on draft, with no audit row", async () => {
      const app = await buildUnauthenticatedFullApp(mods);
      apps.push(app);
      const requests = [
        ...SUB_ROUTES.map((r) => ({ method: r.method, url: r.url(SENTINEL_TEAM_ID, randomUUID()) })),
        { method: "POST" as HTTPMethods, url: `/api/v1/teams/${SENTINEL_TEAM_ID}/sessions/draft` },
      ];
      for (const req of requests) {
        const res = await app.inject(req);
        expect(res.statusCode, req.url).toBe(401);
        // The auth middleware's own 401: no handler ran, so the guard (and
        // its writer) never did either. With no actor there is no row to
        // scope a database assertion by; the writer's null-actor behaviour
        // is unit-tested in teams/__tests__/template-team-guard.test.ts.
        expect(res.json().error.message, req.url).toBe("Please sign in to continue.");
      }
    });
  });

  // -------------------------------------------------------------------------
  // 3.4 — session-history reads: no route-level guard, evaluateTeamAccess
  // -------------------------------------------------------------------------
  describe("3.4 session-history reads", () => {
    const reads = (teamId: string) => [
      `/api/v1/teams/${teamId}/sessions`,
      `/api/v1/teams/${teamId}/sessions/${randomUUID()}`,
    ];

    it.each(["facilitator", "application_admin"] as const)(
      "a %s gets the same response for the template as for a team that does not exist, and no data",
      async (role) => {
        const { db } = mods;
        const actor = await fx.user(role);
        const app = await appFor(actor);
        const since = await dbNow(db);
        const missingTeam = randomUUID();
        for (const [templateUrl, missingUrl] of reads(SENTINEL_TEAM_ID).map((u, i) => [u, reads(missingTeam)[i]!])) {
          const template = await app.inject({ method: "GET", url: templateUrl });
          const missing = await app.inject({ method: "GET", url: missingUrl });
          expect(template.statusCode, templateUrl).toBe(403);
          expect(comparable(template), templateUrl).toEqual(comparable(missing));
          expect(template.body).not.toContain('"sessions"');
        }
        // No route-level guard on these reads, so no template denial row.
        expect(await denialRows(db, actor, since)).toHaveLength(0);
      },
    );

    it("a real team's expired facilitator grant gets the missing-team answer on both reads (composes with migration 23's clamp)", async () => {
      const { db } = mods;
      const creator = await fx.user("facilitator");
      const facilitator = await fx.user("facilitator");
      const teamId = await fx.team(creator);
      const sessionId = await fx.session(teamId, facilitator, "complete");
      const app = await appFor(facilitator);

      // Inside the grace window the facilitator is admitted ...
      const open = await app.inject({ method: "GET", url: `/api/v1/teams/${teamId}/sessions/${sessionId}` });
      expect(open.statusCode).toBe(200);

      // ... and once facilitator_access_expires_at has passed (what the
      // migration does to every completed template session) they are not.
      await db.query(`UPDATE sessions SET facilitator_access_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [
        sessionId,
      ]);
      const missingTeam = randomUUID();
      for (const [url, missingUrl] of [
        [`/api/v1/teams/${teamId}/sessions`, `/api/v1/teams/${missingTeam}/sessions`],
        [`/api/v1/teams/${teamId}/sessions/${sessionId}`, `/api/v1/teams/${missingTeam}/sessions/${sessionId}`],
      ] as const) {
        const expired = await app.inject({ method: "GET", url });
        const missing = await app.inject({ method: "GET", url: missingUrl });
        expect(expired.statusCode, url).toBe(403);
        expect(comparable(expired), url).toEqual(comparable(missing));
      }
    });
  });
});
