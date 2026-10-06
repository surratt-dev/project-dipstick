import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { probeInfra, requireInfraOrThrow, loadModules, buildApp, Fixture } from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";
import { resolveGlobalRole, type MappableRole } from "../../auth/role-map.js";

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
    const resolution = resolveGlobalRole(["Eng-Managers", "Dipstick-Admins"], MAP);
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
