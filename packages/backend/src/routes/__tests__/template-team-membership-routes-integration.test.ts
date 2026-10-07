import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  buildFullApp,
  Fixture,
  SENTINEL_TEAM_ID,
} from "./helpers/real-db.js";
import type { Mods, Db } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// template-team-not-usable (#214) tasks.md 4.1-4.3, real Postgres: TEAM-006
// (managers), the members listing, TEAM-005 (member role) and join-link
// creation answer the __default_topics__ template team as they answer a team
// that does not exist, write one team.template_access_denied row when the
// caller passed the route's earlier checks, and create no template row
// (specs/manager-team-association, role-assignment, join-link).
//
// Never fx.track(SENTINEL_TEAM_ID). Every actor is a fresh fixture user, so
// the D2a dedupe key is never already claimed.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "template-team-membership-routes-integration.test.ts");

async function dbNow(db: Db): Promise<Date> {
  return (await db.query<{ now: Date }>(`SELECT clock_timestamp() AS now`)).rows[0]!.now;
}

async function auditRows(db: Db, actorUserId: string, since: Date) {
  return (
    await db.query<{ operation: string; actor_global_role: string; team_id: string | null; metadata: unknown }>(
      `SELECT operation, actor_global_role, team_id, metadata FROM audit_log
        WHERE actor_user_id = $1 AND "timestamp" >= $2 ORDER BY "timestamp", id`,
      [actorUserId, since],
    )
  ).rows;
}

async function templateRowCounts(db: Db) {
  return (
    await db.query<{ memberships: number; links: number }>(
      `SELECT (SELECT count(*)::int FROM team_memberships WHERE team_id = $1) AS memberships,
              (SELECT count(*)::int FROM join_links WHERE team_id = $1) AS links`,
      [SENTINEL_TEAM_ID],
    )
  ).rows[0]!;
}

function comparable(res: LightMyRequestResponse) {
  const body = res.json() as { error: Record<string, unknown> };
  const error = { ...body.error };
  delete error["correlationId"];
  return { status: res.statusCode, body: { ...body, error } };
}

describe.skipIf(!infraUp)("membership and join-link routes answer the template team as a missing team (#214)", () => {
  let mods: Mods;
  let fx: Fixture;
  const apps: FastifyInstance[] = [];
  const redisKeys: string[] = [];

  beforeAll(async () => {
    mods = await loadModules();
    fx = new Fixture(mods.db);
  });

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
    await fx.cleanup();
    if (redisKeys.length > 0) await mods.redis.del(...redisKeys.splice(0));
  });

  afterAll(async () => {
    await mods?.redis.quit();
  });

  async function appFor(userId: string): Promise<FastifyInstance> {
    const app = await buildFullApp(mods, userId);
    apps.push(app);
    return app;
  }

  async function admin(): Promise<string> {
    const id = await fx.user("application_admin");
    redisKeys.push(`dipstick:ratelimit:team-manager:burst:${id}`, `dipstick:ratelimit:team-manager:daily:${id}`);
    return id;
  }

  // -------------------------------------------------------------------------
  // 4.1 — TEAM-006 POST /api/v1/teams/:teamId/managers
  // -------------------------------------------------------------------------
  describe("4.1 TEAM-006", () => {
    const managers = (app: FastifyInstance, teamId: string, emId: string) =>
      app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/managers`, payload: { engineeringManagerUserId: emId } });

    it("an administrator cannot make anyone an EM of the template: the missing-team response, no membership, one denial row", async () => {
      const { db } = mods;
      const adminId = await admin();
      const em = await fx.user("engineering_manager");
      const app = await appFor(adminId);
      const before = await templateRowCounts(db);
      const since = await dbNow(db);

      const template = await managers(app, SENTINEL_TEAM_ID, em);
      const missing = await managers(app, randomUUID(), em);

      expect(template.statusCode).toBe(404);
      expect(template.json().error.code).toBe("TEAM_NOT_FOUND");
      expect(comparable(template)).toEqual(comparable(missing));
      expect(await templateRowCounts(db)).toEqual(before);
      const rows = await auditRows(db, adminId, since);
      expect(rows.map((r) => r.operation)).not.toContain("team.manager_established");
      expect(rows.filter((r) => r.operation === "team.template_access_denied")).toEqual([
        {
          operation: "team.template_access_denied",
          actor_global_role: "application_admin",
          team_id: SENTINEL_TEAM_ID,
          metadata: { endpoint: "POST /api/v1/teams/:teamId/managers", surface: "membership" },
        },
      ]);
    });

    it("a non-administrator still gets the existing 403 and no denial row", async () => {
      const { db } = mods;
      const facilitator = await fx.user("facilitator");
      const em = await fx.user("engineering_manager");
      const since = await dbNow(db);
      const res = await managers(await appFor(facilitator), SENTINEL_TEAM_ID, em);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.message).toBe(
        "Only an Application Admin can establish an Engineering Manager/team relationship.",
      );
      expect(await auditRows(db, facilitator, since)).toEqual([]);
    });

    it("the rate limiter still applies: an exhausted administrator gets the rate-limit response, as for any team", async () => {
      const { db } = mods;
      const adminId = await admin();
      const em = await fx.user("engineering_manager");
      const app = await appFor(adminId);
      const at = Date.now() - 1_000;
      const pipeline = mods.redis.pipeline();
      for (let i = 0; i < 20; i++) pipeline.zadd(`dipstick:ratelimit:team-manager:burst:${adminId}`, at, `seed-${i}`);
      await pipeline.exec();
      const since = await dbNow(db);

      const res = await managers(app, SENTINEL_TEAM_ID, em);
      expect(res.statusCode).toBe(429);
      expect(res.json().error.code).toBe("TEAM006_BURST_LIMIT_EXCEEDED");
      const ops = (await auditRows(db, adminId, since)).map((r) => r.operation);
      expect(ops).not.toContain("team.template_access_denied");
    });
  });

  // -------------------------------------------------------------------------
  // 4.2 — GET …/members and TEAM-005 PATCH …/members/:userId/role
  // -------------------------------------------------------------------------
  describe("4.2 members listing and TEAM-005", () => {
    const listMembers = (app: FastifyInstance, teamId: string) =>
      app.inject({ method: "GET", url: `/api/v1/teams/${teamId}/members` });
    const changeRole = (app: FastifyInstance, teamId: string, userId: string) =>
      app.inject({
        method: "PATCH",
        url: `/api/v1/teams/${teamId}/members/${userId}/role`,
        payload: { role: "participant" },
      });

    it("an administrator changing a role on the template gets the missing-team 404, no membership change, one denial row", async () => {
      const { db } = mods;
      const adminId = await admin();
      const subject = await fx.user("engineer");
      const app = await appFor(adminId);
      const before = await templateRowCounts(db);
      const since = await dbNow(db);

      const template = await changeRole(app, SENTINEL_TEAM_ID, subject);
      const missing = await changeRole(app, randomUUID(), subject);

      expect(template.statusCode).toBe(404);
      expect(template.json().error.message).toBe("User is not an active member of this team.");
      expect(comparable(template)).toEqual(comparable(missing));
      expect(await templateRowCounts(db)).toEqual(before);
      expect(await auditRows(db, adminId, since)).toEqual([
        {
          operation: "team.template_access_denied",
          actor_global_role: "application_admin",
          team_id: SENTINEL_TEAM_ID,
          metadata: { endpoint: "PATCH /api/v1/teams/:teamId/members/:userId/role", surface: "membership" },
        },
      ]);
    });

    it("a non-administrator with no membership changing a role on the template gets the existing 403, no denial row", async () => {
      const { db } = mods;
      const em = await fx.user("engineering_manager");
      const subject = await fx.user("engineer");
      const app = await appFor(em);
      const since = await dbNow(db);

      const template = await changeRole(app, SENTINEL_TEAM_ID, subject);
      const missing = await changeRole(app, randomUUID(), subject);
      expect(template.statusCode).toBe(403);
      expect(comparable(template)).toEqual(comparable(missing));
      expect(await auditRows(db, em, since)).toEqual([]);
    });

    it("an administrator listing template members gets the missing-team response and one denial row", async () => {
      const { db } = mods;
      const adminId = await admin();
      const app = await appFor(adminId);
      const since = await dbNow(db);

      const template = await listMembers(app, SENTINEL_TEAM_ID);
      const missing = await listMembers(app, randomUUID());

      expect(template.statusCode).toBe(404);
      expect(comparable(template)).toEqual(comparable(missing));
      // Not admin.membership_list_accessed: no list was served.
      expect(await auditRows(db, adminId, since)).toEqual([
        {
          operation: "team.template_access_denied",
          actor_global_role: "application_admin",
          team_id: SENTINEL_TEAM_ID,
          metadata: { endpoint: "GET /api/v1/teams/:teamId/members", surface: "membership" },
        },
      ]);
    });

    it("a non-administrator listing template members gets the existing 403 and no denial row", async () => {
      const { db } = mods;
      const facilitator = await fx.user("facilitator");
      const since = await dbNow(db);
      const res = await listMembers(await appFor(facilitator), SENTINEL_TEAM_ID);
      expect(res.statusCode).toBe(403);
      expect(res.json().error.message).toBe("You are not a member of this team.");
      expect(await auditRows(db, facilitator, since)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // 4.3 — POST /api/teams/:teamId/join-links
  // -------------------------------------------------------------------------
  describe("4.3 join-link creation", () => {
    it.each(["facilitator", "engineer", "application_admin"] as const)(
      "a %s gets the missing-team 403, no join_links row, and one denial row with surface join_link",
      async (role) => {
        const { db } = mods;
        const actor = role === "application_admin" ? await admin() : await fx.user(role);
        const app = await appFor(actor);
        const before = await templateRowCounts(db);
        const since = await dbNow(db);

        const template = await app.inject({ method: "POST", url: `/api/teams/${SENTINEL_TEAM_ID}/join-links` });
        const missing = await app.inject({ method: "POST", url: `/api/teams/${randomUUID()}/join-links` });

        expect(template.statusCode).toBe(403);
        expect(template.json().error.message).toBe("You are not a member of this team.");
        expect(comparable(template)).toEqual(comparable(missing));
        expect(await templateRowCounts(db)).toEqual(before);
        expect(await auditRows(db, actor, since)).toEqual([
          {
            operation: "team.template_access_denied",
            actor_global_role: role,
            team_id: SENTINEL_TEAM_ID,
            metadata: { endpoint: "POST /api/teams/:teamId/join-links", surface: "join_link" },
          },
        ]);
      },
    );
  });
});
