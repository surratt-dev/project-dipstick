import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  buildFullApp,
  Fixture,
  seedOverBudget,
} from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// harden-topic-write-endpoints (#184) task 5.11 — spec "Budgets do not
// interact". The topic-write budget (dipstick:ratelimit:topic-write:...) and
// TEAM-006's (dipstick:ratelimit:team-manager:...) share the sliding-window
// module but not keys: exhausting either one leaves the other untouched.
// Real Redis and Postgres, through every route the app registers.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "topic-write-rate-limit-independence-integration.test.ts");

describe.skipIf(!infraUp)("topic-write and TEAM-006 budgets are independent (#184 5.11)", () => {
  let mods: Mods;
  let fx: Fixture;
  const team006Keys: string[] = [];

  beforeAll(async () => {
    mods = await loadModules();
  });

  afterEach(async () => {
    if (team006Keys.length) await mods.redis.del(...team006Keys.splice(0));
    await fx?.cleanup();
  });

  async function setup() {
    fx = new Fixture(mods.db);
    const admin = await fx.user("application_admin");
    const em = await fx.user("engineering_manager");
    const teamId = await fx.team(admin);
    await fx.unlock(teamId, admin);
    await fx.topic(teamId, { displayOrder: 1 });
    team006Keys.push(
      `dipstick:ratelimit:team-manager:burst:${admin}`,
      `dipstick:ratelimit:team-manager:daily:${admin}`,
    );
    return { admin, em, teamId };
  }

  it("an exhausted topic-write budget does not limit TEAM-006", async () => {
    const { admin, em, teamId } = await setup();
    const app = await buildFullApp(mods, admin);
    await seedOverBudget(admin);
    try {
      const topicWrite = await app.inject({
        method: "POST",
        url: `/api/v1/teams/${teamId}/topics`,
        payload: { name: "N", prompt: "P?", voteType: "finger" },
      });
      expect(topicWrite.statusCode).toBe(429);

      const managers = await app.inject({
        method: "POST",
        url: `/api/v1/teams/${teamId}/managers`,
        payload: { engineeringManagerUserId: em },
      });
      expect(managers.statusCode).toBeLessThan(300);
    } finally {
      await app.close();
    }
  });

  it("an exhausted TEAM-006 budget does not limit topic writes", async () => {
    const { admin, em, teamId } = await setup();
    const app = await buildFullApp(mods, admin);
    // 20 TEAM-006 requests one second ago: the next one breaches its burst.
    const at = Date.now() - 1_000;
    const pipeline = mods.redis.pipeline();
    for (let i = 0; i < 20; i++) pipeline.zadd(`dipstick:ratelimit:team-manager:burst:${admin}`, at, `seed-${i}`);
    await pipeline.exec();
    try {
      const managers = await app.inject({
        method: "POST",
        url: `/api/v1/teams/${teamId}/managers`,
        payload: { engineeringManagerUserId: em },
      });
      expect(managers.statusCode).toBe(429);
      expect(managers.json().error.code).toBe("TEAM006_BURST_LIMIT_EXCEEDED");

      const topicWrite = await app.inject({
        method: "POST",
        url: `/api/v1/teams/${teamId}/topics`,
        payload: { name: "N", prompt: "P?", voteType: "finger" },
      });
      expect(topicWrite.statusCode).toBe(201);
    } finally {
      await app.close();
    }
  });
});
