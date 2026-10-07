import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { probeInfra, requireInfraOrThrow, loadModules, buildApp, buildFullApp, Fixture } from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";
import { resolveRoleSet, type MappableRole } from "../../auth/role-map.js";

// ---------------------------------------------------------------------------
// configurable-oidc-role-map (#243), task 3.5 — security finding S1 end to
// end at the resolver and gate level, against real Postgres.
//
// A person in both the manager and admin IdP groups resolves to
// application_admin (fixed precedence, binding user decision). Before D11
// that let them register, vote and receive live events in a team they joined
// by link. This file proves the resolver outcome and that the D11 gates
// (E1 registration, E3 subscriber grant, E4 roster) refuse such a user with
// an active participant membership.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "admin-session-exclusion-integration.test.ts");

const MAP: ReadonlyMap<string, MappableRole> = new Map<string, MappableRole>([
  ["Eng-Managers", "engineering_manager"],
  ["Dipstick-Admins", "application_admin"],
  ["Retro-Facilitators", "facilitator"],
]);

describe.skipIf(!infraUp)("S1: manager + admin resolves to application_admin and is excluded from sessions (real Postgres)", () => {
  let mods: Mods;
  let fx: Fixture;
  const apps: FastifyInstance[] = [];

  beforeAll(async () => {
    mods = await loadModules();
  });

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
    await fx?.cleanup();
  });

  it("resolves to application_admin, discards engineering_manager, and is refused at registration, subscriber grant and roster", async () => {
    const resolution = resolveRoleSet(["Eng-Managers", "Dipstick-Admins"], MAP);
    expect(resolution.role).toBe("application_admin");
    expect(resolution.discardedRoles).toEqual(["engineering_manager"]);

    fx = new Fixture(mods.db);
    const fac = await fx.user("facilitator");
    const admin = await fx.user(resolution.role);
    const teamId = await fx.team(fac);
    await fx.member(teamId, admin); // active `participant` membership, as a join link would create
    await fx.topic(teamId, { displayOrder: 1 });
    const sessionId = await fx.session(teamId, fac, "draft");

    const facApp = await buildApp(mods, fac);
    apps.push(facApp);
    const adminApp = await buildApp(mods, admin);
    apps.push(adminApp);
    expect((await facApp.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/${sessionId}/advance` })).statusCode).toBe(200);

    // E1: participant registration refused, audited with the admin role.
    const reg = await adminApp.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/participants` });
    expect(reg.statusCode).toBe(403);
    expect(reg.json().error.category).toBe("invalid_request");
    const participants = await mods.db.query(`SELECT 1 FROM session_participants WHERE session_id = $1 AND user_id = $2`, [sessionId, admin]);
    expect(participants.rows).toHaveLength(0);
    const audit = await mods.db.query<{ actor_global_role: string }>(
      `SELECT actor_global_role FROM audit_log
        WHERE actor_user_id = $1 AND operation = 'session.participant_registration_rejected'`,
      [admin],
    );
    expect(audit.rows).toEqual([{ actor_global_role: "application_admin" }]);

    // E3/E4: even with a session_participants row (e.g. one created before
    // the user became an admin), no subscriber grant and not on the roster.
    await mods.db.query(`INSERT INTO session_participants (session_id, user_id) VALUES ($1, $2)`, [sessionId, admin]);
    const { evaluateSessionSubscriberAccess } = await import("../../auth/session-subscriber-access-helper.js");
    expect(await evaluateSessionSubscriberAccess(admin, sessionId)).toBeNull();

    const roster = await facApp.inject({ method: "GET", url: `/api/v1/sessions/${sessionId}/participants-roster` });
    expect(roster.statusCode).toBe(200);
    expect((roster.json().participants as Array<{ userId: string }>).map((p) => p.userId)).not.toContain(admin);
  });
});

// ---------------------------------------------------------------------------
// store-idp-role-set (#245) task 8.2: storing the full role set changes no
// authorization outcome. Users are created with the set their claim maps to
// (Fixture.user(roles), global_role = roles[0]); every check still reads
// global_role.
// ---------------------------------------------------------------------------
describe.skipIf(!infraUp)("store-idp-role-set: multi-role users keep today's outcomes (real Postgres)", () => {
  let mods: Mods;
  let fx: Fixture;
  const apps: FastifyInstance[] = [];
  const redisKeys: string[] = [];

  beforeAll(async () => {
    mods = await loadModules();
  });

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
    if (redisKeys.length) await mods.redis.del(...redisKeys.splice(0));
    await fx?.cleanup();
  });

  async function auditCount(userId: string): Promise<number> {
    const res = await mods.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE actor_user_id = $1`, [userId]);
    return res.rows[0]!.n;
  }

  it("a user whose claim maps to admin + facilitator is refused draft creation (403 forbidden), with no audit row", async () => {
    const roles = resolveRoleSet(["Retro-Facilitators", "Dipstick-Admins"], MAP).roles;
    expect(roles).toEqual(["application_admin", "facilitator"]);

    fx = new Fixture(mods.db);
    const user = await fx.user(roles);
    const teamId = await fx.team(user);
    await fx.topic(teamId, { displayOrder: 1 });
    const app = await buildApp(mods, user);
    apps.push(app);

    const before = await auditCount(user);
    const res = await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/draft` });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.category).toBe("forbidden");
    expect(res.json().error.message).toBe("Only a facilitator can create a draft session.");
    expect(await auditCount(user)).toBe(before);
    const sessions = await mods.db.query(`SELECT 1 FROM sessions WHERE team_id = $1`, [teamId]);
    expect(sessions.rows).toHaveLength(0);
  });

  it("a user whose claim maps to admin + manager is refused participant registration, audited with actor_roles NULL", async () => {
    const roles = resolveRoleSet(["Eng-Managers", "Dipstick-Admins"], MAP).roles;
    expect(roles).toEqual(["application_admin", "engineering_manager"]);

    fx = new Fixture(mods.db);
    const fac = await fx.user("facilitator");
    const user = await fx.user(roles);
    const teamId = await fx.team(fac);
    await fx.member(teamId, user);
    await fx.topic(teamId, { displayOrder: 1 });
    const sessionId = await fx.session(teamId, fac, "draft");
    const facApp = await buildApp(mods, fac);
    apps.push(facApp);
    const userApp = await buildApp(mods, user);
    apps.push(userApp);
    expect((await facApp.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/${sessionId}/advance` })).statusCode).toBe(200);

    const reg = await userApp.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/participants` });
    expect(reg.statusCode).toBe(403);
    expect(reg.json().error.category).toBe("invalid_request");
    expect(reg.json().error.message).toBe("You are not eligible to participate as a voter in this session.");
    const audit = await mods.db.query<{ actor_global_role: string; actor_roles: string[] | null }>(
      `SELECT actor_global_role, actor_roles FROM audit_log
        WHERE actor_user_id = $1 AND operation = 'session.participant_registration_rejected'`,
      [user],
    );
    expect(audit.rows).toEqual([{ actor_global_role: "application_admin", actor_roles: null }]);
  });

  it("TEAM-006: a target user stored as {application_admin, engineering_manager} still gets 409 GLOBAL_ROLE_PRECONDITION_NOT_MET", async () => {
    fx = new Fixture(mods.db);
    const admin = await fx.user("application_admin");
    const target = await fx.user(["application_admin", "engineering_manager"]);
    const teamId = await fx.team(admin);
    redisKeys.push(`dipstick:ratelimit:team-manager:burst:${admin}`, `dipstick:ratelimit:team-manager:daily:${admin}`);
    const app = await buildFullApp(mods, admin);
    apps.push(app);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/teams/${teamId}/managers`,
      payload: { engineeringManagerUserId: target },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.category).toBe("precondition_failed");
    expect(res.json().error.code).toBe("GLOBAL_ROLE_PRECONDITION_NOT_MET");
    const memberships = await mods.db.query(`SELECT 1 FROM team_memberships WHERE team_id = $1 AND user_id = $2`, [teamId, target]);
    expect(memberships.rows).toHaveLength(0);
  });
});
