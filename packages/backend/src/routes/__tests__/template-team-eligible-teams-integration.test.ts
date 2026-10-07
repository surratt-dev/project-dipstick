import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import type { EligibleTeamsResponse } from "@dipstick/shared";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  buildFullApp,
  Fixture,
  SENTINEL_TEAM_ID,
} from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// template-team-not-usable (#214) tasks.md 3.1, real Postgres:
// GET /api/v1/teams/eligible-for-session never lists the __default_topics__
// template team (session-creation "The template team is never listed",
// "Facilitator with zero home-team memberships still receives eligible
// teams"; default-topic-provisioning FR-1.7 "absent from the picker although
// it has no completed session").
//
// Other files create and delete teams in parallel, so "every other
// non-deactivated team appears" is asserted for this file's own teams and as
// "every listed team is a real, non-deactivated team", never as an exact set.
// The fresh-install case (the template is the only team) cannot be set up in
// a shared database; it is covered at the handler level in
// facilitator-sessions.test.ts ("#214 3.1").
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "template-team-eligible-teams-integration.test.ts");

describe.skipIf(!infraUp)("eligible-for-session excludes the template team (#214 3.1)", () => {
  let mods: Mods;
  let fx: Fixture;
  const apps: FastifyInstance[] = [];

  beforeAll(async () => {
    mods = await loadModules();
    fx = new Fixture(mods.db);
  });

  afterAll(async () => {
    for (const app of apps) await app.close();
    await fx?.cleanup();
    await mods?.redis.quit();
  });

  async function eligibleFor(userId: string): Promise<EligibleTeamsResponse> {
    const app = await buildFullApp(mods, userId);
    apps.push(app);
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/eligible-for-session" });
    expect(res.statusCode).toBe(200);
    return res.json() as EligibleTeamsResponse;
  }

  it("a facilitator with zero memberships gets every real team but never the template, by id or by name", async () => {
    const creator = await fx.user("facilitator");
    const facilitator = await fx.user("facilitator");
    const teamA = await fx.team(creator);
    const teamB = await fx.team(creator);

    const body = await eligibleFor(facilitator);

    const ids = body.eligibleTeams.map((t) => t.teamId);
    expect(ids).toContain(teamA);
    expect(ids).toContain(teamB);
    expect(ids).not.toContain(SENTINEL_TEAM_ID);
    expect(body.eligibleTeams.map((t) => t.teamName)).not.toContain("__default_topics__");
    expect(body.callerHasTeamMemberships).toBe(false);

    // Every listed team is a real, non-deactivated team.
    const real = await mods.db.query<{ id: string }>(
      `SELECT id FROM teams WHERE id = ANY($1::uuid[]) AND deactivated_at IS NULL AND id <> $2`,
      [ids, SENTINEL_TEAM_ID],
    );
    expect(real.rowCount).toBe(ids.length);
  });

  it("the template is absent although it has no completed session (FR-1.7 does not apply to it)", async () => {
    const facilitator = await fx.user("facilitator");
    // On CI the template has no session at all (sessions_not_template_team),
    // so FR-1.7 alone would list it. A developer database may keep frozen
    // history; the exclusion does not depend on it either way.
    const team = await mods.db.query<{ deactivated_at: Date | null }>(`SELECT deactivated_at FROM teams WHERE id = $1`, [
      SENTINEL_TEAM_ID,
    ]);
    expect(team.rows[0]!.deactivated_at).toBeNull();

    const body = await eligibleFor(facilitator);
    expect(body.eligibleTeams.map((t) => t.teamId)).not.toContain(SENTINEL_TEAM_ID);
  });

  it("a facilitator who belongs to every real team except one still sees that team, and never the template", async () => {
    const creator = await fx.user("facilitator");
    const facilitator = await fx.user("facilitator");
    const home = await fx.team(creator);
    const other = await fx.team(creator);
    await fx.member(home, facilitator);

    const body = await eligibleFor(facilitator);
    const ids = body.eligibleTeams.map((t) => t.teamId);
    expect(ids).toContain(other);
    expect(ids).not.toContain(home);
    expect(ids).not.toContain(SENTINEL_TEAM_ID);
    expect(body.callerHasTeamMemberships).toBe(true);
  });
});
