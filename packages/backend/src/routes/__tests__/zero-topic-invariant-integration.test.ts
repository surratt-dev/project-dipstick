import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  buildFullApp,
  Fixture,
  activeTopicIdsInOrder,
} from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// zero-topic-team-recovery (#200) tasks.md 2.1 -- real Postgres.
//
// The premise of the assign-defaults carve-out (design.md D9, "Regression
// guard"): a healthy team cannot be driven to zero active topics through the
// API, so the only zero-topic teams are legacy or drifted data and the
// carve-out stays narrow. Two existing guards hold that line -- the
// customization lock (a locked team's structural writes are all 409) and
// TOPIC_LAST_ACTIVE (the last active topic cannot be archived). This test
// runs every structural write an administrator has against a team with one
// active topic and asserts the active count never reaches zero. If it ever
// finds a path, the design is invalid and goes back to design review: do
// not "fix" the test.
//
// Written and run BEFORE the assign-defaults route exists; it does not touch
// that route.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "zero-topic-invariant-integration.test.ts");

describe.skipIf(!infraUp)("no admin API sequence reaches zero active topics (#200 2.1)", () => {
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

  afterAll(async () => {
    await mods?.redis.quit();
  });

  async function appFor(userId: string): Promise<FastifyInstance> {
    const app = await buildFullApp(mods, userId);
    apps.push(app);
    return app;
  }

  it("a locked team with one active topic: every structural write is refused and the count stays 1", async () => {
    fx = new Fixture(mods.db);
    const admin = await fx.user("application_admin");
    const owner = await fx.user("facilitator");
    const teamId = await fx.team(owner);
    const onlyActive = await fx.topic(teamId, { displayOrder: 1 });
    const archived = await fx.topic(teamId, { displayOrder: 2, status: "archived" });
    const app = await appFor(admin);
    const base = `/api/v1/teams/${teamId}/topics`;

    const attempts = [
      { method: "DELETE" as const, url: `${base}/${onlyActive}` },
      { method: "PUT" as const, url: `${base}/order`, payload: { orderedTopicIds: [onlyActive] } },
      { method: "POST" as const, url: `${base}/${archived}/restore` },
      {
        method: "POST" as const,
        url: base,
        payload: { name: "Extra", prompt: "Extra?", voteType: "finger" },
      },
      { method: "PUT" as const, url: `${base}/${onlyActive}/annotation`, payload: { annotation: "x" } },
    ];

    for (const attempt of attempts) {
      const res = await app.inject(attempt);
      // 409 TOPIC_CUSTOMIZATION_LOCKED for the four lock-gated writes; 403
      // for annotate (facilitator-only, FR-8.7). Never a 2xx.
      expect([403, 409], `${attempt.method} ${attempt.url}`).toContain(res.statusCode);
      expect(await activeTopicIdsInOrder(mods.db, teamId), `${attempt.method} ${attempt.url}`).toEqual([onlyActive]);
    }
  });

  it("an unlocked team: archiving down to one topic is allowed, archiving the last one is TOPIC_LAST_ACTIVE", async () => {
    fx = new Fixture(mods.db);
    const admin = await fx.user("application_admin");
    const owner = await fx.user("facilitator");
    const teamId = await fx.team(owner);
    await fx.unlock(teamId, owner);
    const first = await fx.topic(teamId, { displayOrder: 1 });
    const second = await fx.topic(teamId, { displayOrder: 2 });
    const app = await appFor(admin);

    const archiveFirst = await app.inject({ method: "DELETE", url: `/api/v1/teams/${teamId}/topics/${first}` });
    expect(archiveFirst.statusCode).toBe(200);
    expect(await activeTopicIdsInOrder(mods.db, teamId)).toEqual([second]);

    const archiveLast = await app.inject({ method: "DELETE", url: `/api/v1/teams/${teamId}/topics/${second}` });
    expect(archiveLast.statusCode).toBe(409);
    expect(archiveLast.json().error.code).toBe("TOPIC_LAST_ACTIVE");
    expect(await activeTopicIdsInOrder(mods.db, teamId)).toEqual([second]);
  });
});
