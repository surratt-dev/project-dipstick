import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, RouteOptions } from "fastify";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  Fixture,
  SENTINEL_TEAM_ID,
  seedOverBudget,
  topicWriteWindowState,
} from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";
import { snapshotTemplate, assertTemplateUnchanged } from "./helpers/template-snapshot.js";
import {
  ASSIGN_ENDPOINT,
  ASSIGN_PATH,
  activeCount,
  auditRows,
  buildLoggedApp,
  holdTemplateLockPerTest,
  resetDenialAuditBudget,
  teamTopicRows,
  templateDefaults,
  zeroTopicTeam,
} from "./helpers/assign-defaults.js";
import type { LoggedApp } from "./helpers/assign-defaults.js";

// ---------------------------------------------------------------------------
// zero-topic-team-recovery (#200) tasks.md 3.1 / 3.3 / 3.5: the one suite for
// POST /api/v1/teams/:teamId/topics/assign-defaults against real Postgres and
// Redis. Written before the route and run red first.
//
// The failure paths that need a faulty database or a throwing event emitter
// (and the empty template) are in assign-defaults-failure-paths.test.ts, since
// vi.mock is file-wide; the two-connection concurrency test is in
// assign-defaults-concurrency-integration.test.ts. The permanent lock-gate
// source test is assign-defaults-lock-gate-source.test.ts.
//
// This file compares results with the template, so each test holds the template lock.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "assign-defaults-integration.test.ts");

type Res = Awaited<ReturnType<FastifyInstance["inject"]>>;

describe.skipIf(!infraUp)("POST /api/v1/teams/:teamId/topics/assign-defaults (real Postgres, #200)", () => {
  let mods: Mods;
  let fx: Fixture;
  const apps: LoggedApp[] = [];

  holdTemplateLockPerTest();

  beforeAll(async () => {
    mods = await loadModules();
  });

  afterEach(async () => {
    for (const a of apps.splice(0)) await a.app.close();
    if (fx) await resetDenialAuditBudget(mods, ...fx.userIds);
    await fx?.cleanup();
  });

  afterAll(async () => {
    await mods?.redis.quit();
  });

  async function as(userId: string): Promise<LoggedApp> {
    const logged = await buildLoggedApp(mods, userId);
    apps.push(logged);
    return logged;
  }

  async function assign(userId: string, teamId: string, init: Record<string, unknown> = {}): Promise<Res> {
    return (await as(userId)).app.inject({ method: "POST", url: ASSIGN_PATH(teamId), ...init });
  }

  const errorOf = (res: Res) => res.json().error as { category: string; code?: string; message: string; correlationId: string };

  // -------------------------------------------------------------------------
  // Authorization (AC 2, 15)
  // -------------------------------------------------------------------------
  describe("authorization: application_admin only, read live from users", () => {
    type Setup = (teamId: string) => Promise<string>;
    const nonAdmins: Array<[string, Setup]> = [
      ["a facilitator who is not a member", async () => fx.user("facilitator")],
      [
        "a facilitator who is a member",
        async (teamId) => {
          const id = await fx.user("facilitator");
          await fx.member(teamId, id);
          return id;
        },
      ],
      [
        "an engineering manager (member)",
        async (teamId) => {
          const id = await fx.user("engineering_manager");
          await fx.member(teamId, id, "engineering_manager");
          return id;
        },
      ],
      [
        "an engineer (participant member)",
        async (teamId) => {
          const id = await fx.user("engineer");
          await fx.member(teamId, id);
          return id;
        },
      ],
      ["a senior engineer", async () => fx.user("senior_engineer")],
    ];

    it.each(nonAdmins)("%s gets 403 NOT_AN_ADMIN and nothing is written", async (_label, setup) => {
      fx = new Fixture(mods.db);
      const { teamId } = await zeroTopicTeam(fx);
      const caller = await setup(teamId);

      const res = await assign(caller, teamId);

      expect(res.statusCode).toBe(403);
      expect(errorOf(res)).toMatchObject({ category: "forbidden", code: "NOT_AN_ADMIN" });
      expect(errorOf(res).correlationId).toBeTruthy();
      expect(await teamTopicRows(mods, teamId)).toHaveLength(0);
      expect(await auditRows(mods, { teamId, operation: "topic.defaults_assigned" })).toHaveLength(0);
    });

    it("a caller with no user row is a non-admin: 403 NOT_AN_ADMIN", async () => {
      fx = new Fixture(mods.db);
      const { teamId } = await zeroTopicTeam(fx);

      const res = await assign(randomUUID(), teamId);

      expect(res.statusCode).toBe(403);
      expect(errorOf(res).code).toBe("NOT_AN_ADMIN");
    });

    it("a non-admin on a well-formed id that names no team gets 403, not 404", async () => {
      fx = new Fixture(mods.db);
      const facilitator = await fx.user("facilitator");

      const res = await assign(facilitator, randomUUID());

      expect(res.statusCode).toBe(403);
      expect(errorOf(res).code).toBe("NOT_AN_ADMIN");
    });

    it("an admin on a well-formed id that names no team gets 404 TEAM_NOT_FOUND", async () => {
      fx = new Fixture(mods.db);
      const admin = await fx.user("application_admin");

      const res = await assign(admin, randomUUID());

      expect(res.statusCode).toBe(404);
      expect(errorOf(res)).toMatchObject({ category: "not_found", code: "TEAM_NOT_FOUND" });
    });

    it("a non-canonical team id is 404 before authorization (a non-admin learns nothing either way)", async () => {
      fx = new Fixture(mods.db);
      const facilitator = await fx.user("facilitator");

      const res = await assign(facilitator, "not-a-uuid");

      expect(res.statusCode).toBe(404);
      expect(errorOf(res).code).toBe("TEAM_NOT_FOUND");
    });

    it("an admin demoted in users between login and call gets 403 (the role is read live)", async () => {
      fx = new Fixture(mods.db);
      const { teamId } = await zeroTopicTeam(fx);
      const admin = await fx.user("application_admin");
      const logged = await as(admin); // the "login": a session naming this user id
      await fx.setRoles(admin, ["facilitator"]);

      const res = await logged.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) });

      expect(res.statusCode).toBe(403);
      expect(errorOf(res).code).toBe("NOT_AN_ADMIN");
      expect(await teamTopicRows(mods, teamId)).toHaveLength(0);
    });

    it("a non-admin sending a spoofed canAssignDefaults (body, header, query) and a force option still gets 403", async () => {
      fx = new Fixture(mods.db);
      const { teamId } = await zeroTopicTeam(fx);
      const facilitator = await fx.user("facilitator");

      const res = await (await as(facilitator)).app.inject({
        method: "POST",
        url: `${ASSIGN_PATH(teamId)}?canAssignDefaults=true&force=true&asAdmin=1`,
        headers: { "x-can-assign-defaults": "true", "x-role": "application_admin" },
        payload: { canAssignDefaults: true, force: true, role: "application_admin" },
      });

      expect(res.statusCode).toBe(403);
      expect(errorOf(res).code).toBe("NOT_AN_ADMIN");
      expect(await teamTopicRows(mods, teamId)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Success (AC 1, 8, 15) and the admin-membership matrix
  // -------------------------------------------------------------------------
  describe("success", () => {
    type AdminSetup = (teamId: string) => Promise<string>;
    const admins: Array<[string, AdminSetup]> = [
      ["who is a participant of the team", async (t) => { const id = await fx.user("application_admin"); await fx.member(t, id, "participant"); return id; }],
      ["who is an engineering manager of the team", async (t) => { const id = await fx.user("application_admin"); await fx.member(t, id, "engineering_manager"); return id; }],
      ["who is a member of another team", async () => {
        const id = await fx.user("application_admin");
        const other = await fx.team(await fx.user("facilitator"));
        await fx.member(other, id);
        return id;
      }],
      ["who is on no team", async () => fx.user("application_admin")],
    ];

    it.each(admins)("an application_admin %s gets 201", async (_label, setup) => {
      fx = new Fixture(mods.db);
      const { teamId } = await zeroTopicTeam(fx);
      const admin = await setup(teamId);
      const defaults = await templateDefaults(mods);

      const res = await assign(admin, teamId);

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ topicCount: defaults.length });
    });

    it("a locked zero-topic team gets exactly the template's topics, field for field, still locked", async () => {
      fx = new Fixture(mods.db);
      const { teamId } = await zeroTopicTeam(fx);
      const admin = await fx.user("application_admin");
      const defaults = await templateDefaults(mods);

      const res = await assign(admin, teamId);

      expect(res.statusCode).toBe(201);
      const rows = await teamTopicRows(mods, teamId);
      expect(rows).toHaveLength(defaults.length);
      rows.forEach((row, i) => {
        expect(row).toMatchObject({
          name: defaults[i]!.name,
          prompt: defaults[i]!.prompt,
          vote_type: defaults[i]!.vote_type,
          first_session_description: defaults[i]!.first_session_description,
          display_order: i + 1,
          status: "active",
          is_default: true,
          team_annotation: null,
          annotation_updated_by: null,
          annotation_updated_at: null,
        });
      });
      const list = await (await as(admin)).app.inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics/all` });
      expect(list.json()).toMatchObject({ isCustomizationLocked: true, lockReason: "first_session" });
    });

    it("a team whose topics are all archived is recovered and its archive is untouched", async () => {
      fx = new Fixture(mods.db);
      const { teamId } = await zeroTopicTeam(fx, { archived: 2 });
      const admin = await fx.user("application_admin");
      const before = (await teamTopicRows(mods, teamId)).filter((r) => r.status === "archived");

      const res = await assign(admin, teamId);

      expect(res.statusCode).toBe(201);
      const after = await teamTopicRows(mods, teamId);
      expect(after.filter((r) => r.status === "archived")).toEqual(before);
      expect(after.filter((r) => r.status === "active")).toHaveLength((await templateDefaults(mods)).length);
    });

    it("an unlocked zero-topic team can also be assigned, and its lock state is unchanged", async () => {
      fx = new Fixture(mods.db);
      const { teamId } = await zeroTopicTeam(fx, { unlocked: true });
      const admin = await fx.user("application_admin");

      const res = await assign(admin, teamId);

      expect(res.statusCode).toBe(201);
      const list = await (await as(admin)).app.inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics/all` });
      expect(list.json()).toMatchObject({ isCustomizationLocked: false, lockReason: null });
    });

    it("tenancy: assigning on team A changes no other team and not the template", async () => {
      fx = new Fixture(mods.db);
      const { teamId: teamA } = await zeroTopicTeam(fx);
      const { teamId: teamB } = await zeroTopicTeam(fx);
      const owner = await fx.user("facilitator");
      const teamC = await fx.team(owner);
      const cTopic = await fx.topic(teamC, { displayOrder: 1 });
      const admin = await fx.user("application_admin");
      const snap = await snapshotTemplate(mods.db);

      const res = await assign(admin, teamA);

      expect(res.statusCode).toBe(201);
      expect(await teamTopicRows(mods, teamB)).toHaveLength(0);
      expect((await teamTopicRows(mods, teamC)).map((r) => r.id)).toEqual([cTopic]);
      await assertTemplateUnchanged(mods.db, snap);
    });

    it("ignores everything in the request: a body naming a source, a query and spurious headers change nothing", async () => {
      fx = new Fixture(mods.db);
      const { teamId: plainTeam } = await zeroTopicTeam(fx);
      const { teamId: noisyTeam } = await zeroTopicTeam(fx);
      const otherTeam = await fx.team(await fx.user("facilitator"));
      await fx.topic(otherTeam, { displayOrder: 1, name: "Not a default" });
      const admin = await fx.user("application_admin");

      const plain = await assign(admin, plainTeam);
      const noisy = await (await as(admin)).app.inject({
        method: "POST",
        url: `${ASSIGN_PATH(noisyTeam)}?templateTeamId=${otherTeam}&teamId=${otherTeam}&force=true`,
        headers: { "x-template-team-id": otherTeam, "x-force": "1" },
        payload: { templateTeamId: otherTeam, teamId: otherTeam, topics: [{ name: "Injected", prompt: "?" }] },
      });

      expect(plain.statusCode).toBe(201);
      expect(noisy.statusCode).toBe(201);
      expect(noisy.json()).toEqual(plain.json());
      const strip = (rows: Awaited<ReturnType<typeof teamTopicRows>>) =>
        rows.map(({ id: _id, ...rest }) => rest);
      expect(strip(await teamTopicRows(mods, noisyTeam))).toEqual(strip(await teamTopicRows(mods, plainTeam)));
    });

    it("the 201 carries Cache-Control: no-store and no topic text", async () => {
      fx = new Fixture(mods.db);
      const { teamId } = await zeroTopicTeam(fx);
      const admin = await fx.user("application_admin");

      const res = await assign(admin, teamId);

      expect(res.headers["cache-control"]).toBe("no-store");
      expect(Object.keys(res.json())).toEqual(["topicCount"]);
    });
  });

  // -------------------------------------------------------------------------
  // Precondition (AC 2) and the template guard
  // -------------------------------------------------------------------------
  describe("refusals", () => {
    it("a team with active topics (locked or unlocked) gets 409 TEAM_HAS_ACTIVE_TOPICS and nothing changes", async () => {
      fx = new Fixture(mods.db);
      const admin = await fx.user("application_admin");
      for (const unlocked of [false, true]) {
        const { teamId, owner } = await zeroTopicTeam(fx, { unlocked });
        const kept = await fx.topic(teamId, { displayOrder: 1 });
        void owner;

        const res = await assign(admin, teamId);

        expect(res.statusCode).toBe(409);
        expect(errorOf(res)).toMatchObject({ category: "precondition_failed", code: "TEAM_HAS_ACTIVE_TOPICS" });
        expect(res.headers["cache-control"]).toBe("no-store");
        expect((await teamTopicRows(mods, teamId)).map((r) => r.id)).toEqual([kept]);
        expect(await auditRows(mods, { teamId, operation: "topic.defaults_assigned" })).toHaveLength(0);
      }
    });

    it("a second identical call lands on the 409 and the team keeps exactly the template's topics", async () => {
      fx = new Fixture(mods.db);
      const { teamId } = await zeroTopicTeam(fx);
      const admin = await fx.user("application_admin");
      const expected = (await templateDefaults(mods)).length;

      const first = await assign(admin, teamId);
      const second = await assign(admin, teamId);

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(409);
      expect(errorOf(second).code).toBe("TEAM_HAS_ACTIVE_TOPICS");
      expect(await activeCount(mods, teamId)).toBe(expected);
      expect(await auditRows(mods, { teamId, operation: "topic.defaults_assigned" })).toHaveLength(1);
    });

    it("the template team (any spelling) is the same 404 as a missing team, with one template-denial row and no change", async () => {
      fx = new Fixture(mods.db);
      const admin = await fx.user("application_admin");
      const snap = await snapshotTemplate(mods.db);
      const missing = await assign(admin, randomUUID());

      for (const spelling of [SENTINEL_TEAM_ID, SENTINEL_TEAM_ID.toUpperCase()]) {
        const res = await assign(admin, spelling);

        expect(res.statusCode).toBe(404);
        // Identical but for the per-response correlation id.
        expect({ ...errorOf(res), correlationId: "" }).toEqual({ ...errorOf(missing), correlationId: "" });
        await assertTemplateUnchanged(mods.db, snap);
      }

      const denied = (await auditRows(mods, { actorUserId: admin, operation: "topic.write_denied_template" })).filter(
        (r) => r.metadata["attempted_operation"] === "topic.defaults_assigned",
      );
      expect(denied).toHaveLength(2);
      expect(denied[0]).toMatchObject({
        actor_global_role: "application_admin",
        team_id: SENTINEL_TEAM_ID,
        metadata: { endpoint: ASSIGN_ENDPOINT, attempted_operation: "topic.defaults_assigned" },
      });
    });
  });

  // -------------------------------------------------------------------------
  // Check order (AC 2): canonical id, authorization, limiter, team lookup
  // -------------------------------------------------------------------------
  describe("check order", () => {
    it("a non-admin on a missing team gets 403 before any limiter or lookup, even when the topic-write budget is exhausted", async () => {
      fx = new Fixture(mods.db);
      const facilitator = await fx.user("facilitator");
      const logged = await as(facilitator);
      await seedOverBudget(facilitator);
      const before = await topicWriteWindowState(facilitator);

      const res = await logged.app.inject({ method: "POST", url: ASSIGN_PATH(randomUUID()) });

      expect(res.statusCode).toBe(403);
      expect(errorOf(res).code).toBe("NOT_AN_ADMIN");
      const after = await topicWriteWindowState(facilitator);
      expect({ burst: after.burst, daily: after.daily }).toEqual({ burst: before.burst, daily: before.daily });
    });

    it("an over-budget admin gets the sibling 429 on an existing, a missing and the template team alike, before the team lookup", async () => {
      fx = new Fixture(mods.db);
      const { teamId } = await zeroTopicTeam(fx);
      const admin = await fx.user("application_admin");
      const logged = await as(admin);
      await seedOverBudget(admin);

      const results: Res[] = [];
      for (const id of [teamId, randomUUID(), SENTINEL_TEAM_ID]) {
        results.push(await logged.app.inject({ method: "POST", url: ASSIGN_PATH(id) }));
      }

      for (const res of results) {
        expect(res.statusCode).toBe(429);
        expect(errorOf(res).category).toBe("rate_limited");
        expect(res.headers["retry-after"]).toBeTruthy();
      }
      expect(new Set(results.map((r) => errorOf(r).code)).size).toBe(1);
      expect(await teamTopicRows(mods, teamId)).toHaveLength(0);
      // The limiter ran before the template lookup: no template-denial row.
      expect(
        (await auditRows(mods, { actorUserId: admin, operation: "topic.write_denied_template" })).filter(
          (r) => r.metadata["attempted_operation"] === "topic.defaults_assigned",
        ),
      ).toHaveLength(0);
    });

    it("a successful call consumes one unit of the shared topic-write budget", async () => {
      fx = new Fixture(mods.db);
      const { teamId } = await zeroTopicTeam(fx);
      const admin = await fx.user("application_admin");

      const res = await assign(admin, teamId);

      expect(res.statusCode).toBe(201);
      expect(await topicWriteWindowState(admin)).toMatchObject({ burst: 1, daily: 1 });
    });
  });

  // -------------------------------------------------------------------------
  // Audit (AC 5, 6, 9)
  // -------------------------------------------------------------------------
  describe("audit", () => {
    it("a success writes exactly one topic.defaults_assigned row: actor, role, ip, team, counts-only metadata", async () => {
      fx = new Fixture(mods.db);
      const { teamId } = await zeroTopicTeam(fx);
      const admin = await fx.user("application_admin");
      const logged = await as(admin);

      const res = await logged.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) });

      expect(res.statusCode).toBe(201);
      const rows = await auditRows(mods, { teamId, operation: "topic.defaults_assigned" });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actor_user_id: admin,
        actor_global_role: "application_admin",
        actor_ip: "127.0.0.1",
        team_id: teamId,
      });
      expect(Object.keys(rows[0]!.metadata).sort()).toEqual(["correlation_id", "topic_count"]);
      expect(rows[0]!.metadata["topic_count"]).toBe(res.json().topicCount);
      expect(typeof rows[0]!.metadata["correlation_id"]).toBe("string");
      const text = JSON.stringify(rows[0]);
      expect(text).not.toContain(SENTINEL_TEAM_ID);
      for (const d of await templateDefaults(mods)) expect(text).not.toContain(d.name);
      // The event joins to the row by correlation id, and nothing else is emitted.
      const events = logged.events("topic.defaults_assigned");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorUserId: admin,
        actorGlobalRole: "application_admin",
        teamId,
        topicCount: res.json().topicCount,
        correlationId: rows[0]!.metadata["correlation_id"],
      });
    });

    it("no topic.defaults_assigned row on a 403, 404, 409 or 429", async () => {
      fx = new Fixture(mods.db);
      const admin = await fx.user("application_admin");
      const facilitator = await fx.user("facilitator");
      const { teamId: zero } = await zeroTopicTeam(fx);
      const { teamId: full } = await zeroTopicTeam(fx);
      await fx.topic(full, { displayOrder: 1 });

      expect((await assign(facilitator, zero)).statusCode).toBe(403);
      expect((await assign(admin, randomUUID())).statusCode).toBe(404);
      expect((await assign(admin, full)).statusCode).toBe(409);
      const limited = await as(admin);
      await seedOverBudget(admin);
      expect((await limited.app.inject({ method: "POST", url: ASSIGN_PATH(zero) })).statusCode).toBe(429);

      for (const teamId of [zero, full]) {
        expect(await auditRows(mods, { teamId, operation: "topic.defaults_assigned" })).toHaveLength(0);
      }
    });

    it("no notification is emitted and no route reverses an assignment", async () => {
      fx = new Fixture(mods.db);
      const { teamId } = await zeroTopicTeam(fx);
      const admin = await fx.user("application_admin");
      const logged = await as(admin);

      await logged.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) });

      const auditEvents = logged.lines.filter((l) => l["audit"] === true).map((l) => l.event);
      expect(auditEvents).toEqual(["topic.defaults_assigned"]);

      const routes: RouteOptions[] = [];
      const probe = (await import("fastify")).default();
      probe.addHook("onRoute", (r) => routes.push(r));
      probe.decorateRequest("session", null);
      await mods.registerRoutes(probe);
      await probe.ready();
      await probe.close();
      const reversing = routes.filter(
        (r) => /assign-defaults|unassign|undo|revert/i.test(r.url) && r.url !== "/api/v1/teams/:teamId/topics/assign-defaults",
      );
      expect(reversing).toEqual([]);
      expect(
        routes.filter((r) => r.url === "/api/v1/teams/:teamId/topics/assign-defaults").flatMap((r) => [r.method].flat()),
      ).toEqual(["POST"]);
    });

    // ---- 3.3 denial rows ---------------------------------------------------
    it("a 403 NOT_AN_ADMIN writes exactly one topic.defaults_assign_denied row and emits one event", async () => {
      fx = new Fixture(mods.db);
      const { teamId } = await zeroTopicTeam(fx);
      const caller = await fx.user("facilitator");
      const logged = await as(caller);

      const res = await logged.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) });

      expect(res.statusCode).toBe(403);
      const rows = await auditRows(mods, { actorUserId: caller, operation: "topic.defaults_assign_denied" });
      expect(rows).toEqual([
        {
          operation: "topic.defaults_assign_denied",
          actor_user_id: caller,
          actor_global_role: "facilitator",
          actor_ip: "127.0.0.1",
          team_id: teamId,
          actor_roles: ["facilitator"],
          metadata: {
            endpoint: ASSIGN_ENDPOINT,
            http_status: 403,
            reason: "NOT_AN_ADMIN",
            correlation_id: errorOf(res).correlationId,
          },
        },
      ]);
      expect(logged.events("topic.defaults_assign_denied")).toHaveLength(1);
      expect(logged.events("topic.audit_write_failed")).toHaveLength(0);
      expect(JSON.stringify(rows)).not.toContain(SENTINEL_TEAM_ID);
    });

    it("a denial for a nonexistent team, and one for a caller with no users row, are still recorded", async () => {
      fx = new Fixture(mods.db);
      const caller = await fx.user("engineer");
      const ghost = randomUUID();
      const missingTeam = randomUUID();

      expect((await assign(caller, missingTeam)).statusCode).toBe(403);
      expect((await assign(ghost, missingTeam)).statusCode).toBe(403);

      const rows = await auditRows(mods, { teamId: missingTeam, operation: "topic.defaults_assign_denied" });
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.actor_user_id === ghost)).toMatchObject({ actor_global_role: "unknown", actor_roles: null });
      await mods.db.query(`DELETE FROM audit_log WHERE team_id = $1 OR actor_user_id = $2`, [missingTeam, ghost]);
    });

    it("a 401 (no session) writes no denial row", async () => {
      fx = new Fixture(mods.db);
      const { teamId } = await zeroTopicTeam(fx);
      const { buildUnauthenticatedFullApp } = await import("./helpers/real-db.js");
      const app = await buildUnauthenticatedFullApp(mods);

      const res = await app.inject({ method: "POST", url: ASSIGN_PATH(teamId) });
      await app.close();

      expect(res.statusCode).toBe(401);
      expect(await auditRows(mods, { teamId, operation: "topic.defaults_assign_denied" })).toHaveLength(0);
    });

    it("the denial is bounded per actor: the 11th in a minute is still 403 but writes no row and logs one suppression event", async () => {
      fx = new Fixture(mods.db);
      const { teamId } = await zeroTopicTeam(fx);
      const caller = await fx.user("facilitator");
      const logged = await as(caller);

      const statuses: number[] = [];
      for (let i = 0; i < 12; i += 1) {
        statuses.push((await logged.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) })).statusCode);
      }

      expect(statuses.every((s) => s === 403)).toBe(true);
      expect(await auditRows(mods, { actorUserId: caller, operation: "topic.defaults_assign_denied" })).toHaveLength(10);
      expect(logged.events("topic.defaults_assign_denied")).toHaveLength(10);
      // Once per window, not once per suppressed denial.
      const suppressed = logged.events("topic.denial_audit_suppressed");
      expect(suppressed).toHaveLength(1);
      expect(suppressed[0]).toMatchObject({ actorUserId: caller, endpoint: ASSIGN_ENDPOINT });
    });

    it("a 403 caller consumes no topic-write budget", async () => {
      fx = new Fixture(mods.db);
      const { teamId } = await zeroTopicTeam(fx);
      const caller = await fx.user("facilitator");

      await assign(caller, teamId);

      expect(await topicWriteWindowState(caller)).toMatchObject({ burst: 0, daily: 0 });
    });
  });

  // -------------------------------------------------------------------------
  // Leakage (AC 4, 15)
  // -------------------------------------------------------------------------
  describe("responses never leak", () => {
    it("no response (201, 403, 404, 409) or header contains the template team id or any template topic text", async () => {
      fx = new Fixture(mods.db);
      const admin = await fx.user("application_admin");
      const facilitator = await fx.user("facilitator");
      const { teamId } = await zeroTopicTeam(fx);
      const defaults = await templateDefaults(mods);

      const responses = [
        await assign(facilitator, teamId), // 403
        await assign(admin, randomUUID()), // 404 missing
        await assign(admin, SENTINEL_TEAM_ID), // 404 template
        await assign(admin, teamId), // 201
        await assign(admin, teamId), // 409
      ];

      expect(responses.map((r) => r.statusCode)).toEqual([403, 404, 404, 201, 409]);
      for (const res of responses) {
        const everything = `${res.body}\n${JSON.stringify(res.headers)}`;
        expect(everything).not.toContain(SENTINEL_TEAM_ID);
        for (const d of defaults) {
          expect(everything).not.toContain(d.name);
          expect(everything).not.toContain(d.prompt);
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // The lock gate is untouched (AC 9)
  // -------------------------------------------------------------------------
  describe("the customization lock is untouched by a recovery", () => {
    it("after a recovery add, archive, restore and reorder still return 409 TOPIC_CUSTOMIZATION_LOCKED; annotate as admin is 403; still first_session-locked", async () => {
      fx = new Fixture(mods.db);
      const { teamId } = await zeroTopicTeam(fx, { archived: 1 });
      const admin = await fx.user("application_admin");
      const logged = await as(admin);
      expect((await logged.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) })).statusCode).toBe(201);
      const rows = await teamTopicRows(mods, teamId);
      const active = rows.filter((r) => r.status === "active");
      const archived = rows.find((r) => r.status === "archived")!;
      const base = `/api/v1/teams/${teamId}/topics`;

      const add = await logged.app.inject({ method: "POST", url: base, payload: { name: "X", prompt: "X?", voteType: "finger" } });
      const archive = await logged.app.inject({ method: "DELETE", url: `${base}/${active[0]!.id}` });
      const restore = await logged.app.inject({ method: "POST", url: `${base}/${archived.id}/restore` });
      const reorder = await logged.app.inject({
        method: "PUT",
        url: `${base}/order`,
        payload: { orderedTopicIds: active.map((r) => r.id).reverse() },
      });
      const annotate = await logged.app.inject({
        method: "PUT",
        url: `${base}/${active[0]!.id}/annotation`,
        payload: { annotation: "x" },
      });

      for (const res of [add, archive, restore, reorder]) {
        expect(res.statusCode).toBe(409);
        expect(errorOf(res).code).toBe("TOPIC_CUSTOMIZATION_LOCKED");
      }
      expect(annotate.statusCode).toBe(403);
      const { getTopicLockState } = await import("../../auth/topic-lock-state.js");
      expect(await getTopicLockState(teamId)).toMatchObject({ isCustomizationLocked: true, lockReason: "first_session" });
    });
  });

  // -------------------------------------------------------------------------
  // Restorable-defaults listing after a recovery (AC 16), tasks.md 3.5
  // -------------------------------------------------------------------------
  describe("defaultTopicsNotActive after a recovery", () => {
    it("a zero-active team with an archived default: after assigning, GET all lists nothing restorable", async () => {
      fx = new Fixture(mods.db);
      const owner = await fx.user("facilitator");
      const teamId = await fx.team(owner);
      const defaults = await templateDefaults(mods);
      await fx.topic(teamId, { displayOrder: 1, status: "archived", name: defaults[0]!.name });
      const admin = await fx.user("application_admin");
      const logged = await as(admin);

      const before = await logged.app.inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics/all` });
      expect(before.json().defaultTopicsNotActive).toHaveLength(defaults.length);
      expect(before.json().defaultTopicsNotActive.find((d: { name: string }) => d.name === defaults[0]!.name)).toMatchObject({
        isArchived: true,
      });

      expect((await logged.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) })).statusCode).toBe(201);

      const after = await logged.app.inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics/all` });
      expect(after.statusCode).toBe(200);
      expect(after.json().defaultTopicsNotActive).toEqual([]);
    });
  });
});
