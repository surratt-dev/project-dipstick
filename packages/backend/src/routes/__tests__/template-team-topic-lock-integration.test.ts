import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
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
// template-team-not-usable (#214) tasks.md 6.1, real Postgres:
// topic-customization-lock "Topic read endpoints report why a team's topics
// are locked". TOPIC-001 and TOPIC-002 both carry lockReason beside
// isCustomizationLocked, from the one getTopicLockState. TOPIC-001 is not
// reachable for the template over HTTP (no member, no unexpired facilitator
// access can exist); its template case is the handler-level test in
// content.test.ts ("#214 6.1").
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "template-team-topic-lock-integration.test.ts");

describe.skipIf(!infraUp)("TOPIC-001 and TOPIC-002 report lockReason (#214 6.1)", () => {
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

  async function get(userId: string, url: string) {
    const app = await buildFullApp(mods, userId);
    apps.push(app);
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode, url).toBe(200);
    return res.json() as { isCustomizationLocked: boolean; lockReason: string | null };
  }

  it("the template via TOPIC-002: locked, canonical_defaults", async () => {
    const facilitator = await fx.user("facilitator");
    const body = await get(facilitator, `/api/v1/teams/${SENTINEL_TEAM_ID}/topics/all`);
    expect(body).toMatchObject({ isCustomizationLocked: true, lockReason: "canonical_defaults" });
  });

  it.each([
    ["with no completed session", false, { isCustomizationLocked: true, lockReason: "first_session" }],
    ["with a completed session", true, { isCustomizationLocked: false, lockReason: null }],
  ] as const)("a real team %s: the same lock fields on TOPIC-001 and TOPIC-002", async (_label, unlock, expected) => {
    const creator = await fx.user("facilitator");
    const member = await fx.user("engineer");
    const facilitator = await fx.user("facilitator");
    const teamId = await fx.team(creator);
    await fx.member(teamId, member);
    if (unlock) await fx.unlock(teamId, creator);

    const topic001 = await get(member, `/api/v1/teams/${teamId}/topics`);
    const topic002 = await get(facilitator, `/api/v1/teams/${teamId}/topics/all`);
    expect(topic001).toMatchObject(expected);
    expect(topic002).toMatchObject(expected);
  });
});
