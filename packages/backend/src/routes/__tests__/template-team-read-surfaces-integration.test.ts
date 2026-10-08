import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { FastifyInstance, RouteOptions } from "fastify";
import { probeInfra, requireInfraOrThrow, loadModules, buildFullApp, Fixture } from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// template-team-not-usable (#214) tasks.md 8.1-8.4, real Postgres
// (design.md D7: read surfaces are closed by membership gating plus
// migration 23's facilitator-access clamp, verified with one test per gate,
// never by a per-surface template filter).
//
// After migration 23 the template has no active membership (and can never
// get one), so every surface gated on an ACTIVE membership is closed for it.
// These tests show the gates ignore a soft-removed (removed_at set)
// membership, which is exactly the state the migration leaves template
// memberships in. A real team stands in for the template because the
// constraint refuses template memberships on CI.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "template-team-read-surfaces-integration.test.ts");

describe.skipIf(!infraUp)("read surfaces ignore removed memberships (#214 8.1-8.4)", () => {
  let mods: Mods;
  let fx: Fixture;
  const apps: FastifyInstance[] = [];
  const actionItemIds: string[] = [];

  beforeAll(async () => {
    mods = await loadModules();
    fx = new Fixture(mods.db);
  });

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
    if (actionItemIds.length > 0) {
      await mods.db.query(`DELETE FROM action_item_history WHERE action_item_id = ANY($1::uuid[])`, [actionItemIds]).catch(() => undefined);
      await mods.db.query(`DELETE FROM action_items WHERE id = ANY($1::uuid[])`, [actionItemIds.splice(0)]);
    }
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

  async function removeMembership(teamId: string, userId: string): Promise<void> {
    await mods.db.query(`UPDATE team_memberships SET removed_at = NOW() WHERE team_id = $1 AND user_id = $2`, [
      teamId,
      userId,
    ]);
  }

  it("8.1: EM views admit an active EM membership and deny a soft-removed one, on every EM route", async () => {
    const creator = await fx.user("facilitator");
    const em = await fx.user("engineering_manager");
    const teamId = await fx.team(creator);
    await mods.db.query(`INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, 'engineering_manager')`, [
      teamId,
      em,
    ]);
    await fx.session(teamId, creator, "complete");
    const app = await appFor(em);
    const urls = [
      `/api/v1/teams/${teamId}/em/sessions`,
      `/api/v1/teams/${teamId}/em/trends`,
      `/api/v1/teams/${teamId}/em/action-items`,
    ];

    for (const url of urls) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, `active EM: ${url}`).toBe(200);
    }

    await removeMembership(teamId, em);
    for (const url of urls) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, `removed EM: ${url}`).toBe(403);
    }
    // The per-item EM routes share the same gate, ahead of any lookup.
    for (const url of [
      `/api/v1/teams/${teamId}/em/sessions/${randomUUID()}`,
      `/api/v1/teams/${teamId}/em/trends/${randomUUID()}`,
      `/api/v1/teams/${teamId}/em/action-items/${randomUUID()}`,
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, `removed EM: ${url}`).toBe(403);
    }
  });

  // 8.2 finding (recorded in tasks.md, to be filed as a separate issue): the
  // action-item routes also admit the item's OWNER and anyone who EVER
  // facilitated a session for the team, independent of membership. The
  // membership half of the gate (evaluateTeamAccess) ignores a removed
  // membership, which is what this test shows; the owner/ever-facilitated
  // relationships are out of this change's scope.
  it("8.2: action-item routes admit an active (non-owner) member and deny a soft-removed one", async () => {
    const creator = await fx.user("facilitator");
    const member = await fx.user("engineer");
    const owner = await fx.user("engineer");
    const teamId = await fx.team(creator);
    await fx.member(teamId, member);
    await fx.member(teamId, owner);
    const sessionId = await fx.session(teamId, creator, "complete");
    const itemId = randomUUID();
    actionItemIds.push(itemId);
    await mods.db.query(
      `INSERT INTO action_items (id, team_id, session_id, owner_id, description, status)
       VALUES ($1, $2, $3, $4, 'Read-surface test action item', 'open')`,
      [itemId, teamId, sessionId, owner],
    );
    const app = await appFor(member);
    const patchStatus = () =>
      app.inject({ method: "PATCH", url: `/api/v1/action-items/${itemId}/status`, payload: { status: "in_progress" } });
    const patchOwner = () =>
      app.inject({ method: "PATCH", url: `/api/v1/action-items/${itemId}/owner`, payload: { ownerId: member } });

    // Active member: past the relationship gate (whatever the write rule
    // then says, it is not the not-found answer).
    expect((await patchStatus()).statusCode).not.toBe(404);

    await removeMembership(teamId, member);
    const before = await mods.db.query(`SELECT status, owner_id FROM action_items WHERE id = $1`, [itemId]);
    expect((await patchStatus()).statusCode).toBe(404);
    expect((await patchOwner()).statusCode).toBe(404);
    const after = await mods.db.query(`SELECT status, owner_id FROM action_items WHERE id = $1`, [itemId]);
    expect(after.rows).toEqual(before.rows);
  });

  it("8.3/8.4: no cross-team admin session or trend view exists, and every team-addressed GET outside the structural prefix is a known, gated route", async () => {
    const routes: RouteOptions[] = [];
    const actor = await fx.user("application_admin");
    const app = await buildFullApp(mods, actor, (route) => routes.push(route));
    apps.push(app);
    const gets = routes
      .filter((r) => (Array.isArray(r.method) ? r.method : [r.method]).includes("GET"))
      .map((r) => r.url);

    // 8.3: no admin-wide (non-team-addressed) session or trend listing.
    expect(gets.filter((url) => /^\/api(\/v\d+)?\/(admin|sessions|trends)(\/|$)/.test(url) && !url.includes(":sessionId"))).toEqual(
      [],
    );

    // 8.4: the team-addressed GETs outside /teams/:teamId/(sessions|members|
    // managers|join-links), each with the gate that closes it for the
    // template (see tasks.md implementation notes for the table).
    const STRUCTURAL = /^\/api(\/v\d+)?\/teams\/:[^/]+\/(sessions|members|managers|join-links)(\/|$)/;
    const outside = gets.filter((url) => /^\/api(\/v\d+)?\/teams\/:teamId(\/|$)/.test(url) && !STRUCTURAL.test(url)).sort();
    expect(outside).toEqual(
      [
        "/api/v1/teams/:teamId",
        "/api/v1/teams/:teamId/action-items",
        "/api/v1/teams/:teamId/em/action-items",
        "/api/v1/teams/:teamId/em/action-items/:actionItemId",
        "/api/v1/teams/:teamId/em/sessions",
        "/api/v1/teams/:teamId/em/sessions/:sessionId",
        "/api/v1/teams/:teamId/em/trends",
        "/api/v1/teams/:teamId/em/trends/:topicId",
        "/api/v1/teams/:teamId/topics",
        "/api/v1/teams/:teamId/topics/all",
        "/api/v1/teams/:teamId/trends",
      ].sort(),
    );
  });
});
