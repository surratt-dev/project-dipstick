import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { probeInfra, requireInfraOrThrow, loadModules, buildFullApp, Fixture, SENTINEL_TEAM_ID } from "./helpers/real-db.js";
import { holdTemplateLockPerTest } from "./helpers/assign-defaults.js";
import type { Mods } from "./helpers/real-db.js";
import { snapshotTemplate } from "./helpers/template-snapshot.js";

// ---------------------------------------------------------------------------
// zero-topic-team-recovery (#200) tasks.md 2.6 / design.md D3a -- real
// Postgres. GET /api/v1/teams/:teamId/topics/all must list a canonical
// default under defaultTopicsNotActive only when the team has NO active topic
// of that name. The old join produced one row per matching team topic, so a
// team holding an archived "X" and an active "X" listed X as restorable
// (restore has no name-collision check, so acting on that listing creates two
// active topics of one name). The fix is one row per default, preferring an
// active match.
//
// Direct fixtures, no assign-defaults endpoint needed. Reads the template, so
// each test holds the template lock (no other file may be swapping or
// archiving template rows meanwhile). The end-to-end assertion through the
// endpoint is in assign-defaults-integration.test.ts (3.5).
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "default-topics-not-active-integration.test.ts");

describe.skipIf(!infraUp)("defaultTopicsNotActive lists only genuinely absent defaults (#200 2.6)", () => {
  let mods: Mods;
  let fx: Fixture;
  let defaultNames: string[];
  const apps: FastifyInstance[] = [];

  holdTemplateLockPerTest();

  beforeAll(async () => {
    mods = await loadModules();
  });

  beforeEach(async () => {
    const snap = await snapshotTemplate(mods.db);
    defaultNames = [...snap.values()]
      .filter((r) => r.is_default && r.status === "active")
      .sort((a, b) => a.display_order - b.display_order || a.id.localeCompare(b.id))
      .map((r) => r.name);
    expect(defaultNames.length).toBeGreaterThanOrEqual(2);
  });

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
    await fx?.cleanup();
  });

  afterAll(async () => {
    await mods?.redis.quit();
  });

  async function notActive(teamId: string, callerId: string) {
    const app = await buildFullApp(mods, callerId);
    apps.push(app);
    const res = await app.inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics/all` });
    expect(res.statusCode).toBe(200);
    return res.json().defaultTopicsNotActive as Array<{ topicId: string; name: string; isArchived: boolean }>;
  }

  it("an active and an archived topic sharing a default's name: that default is not listed; absent defaults are", async () => {
    fx = new Fixture(mods.db);
    const admin = await fx.user("application_admin");
    const owner = await fx.user("facilitator");
    const teamId = await fx.team(owner);
    const shared = defaultNames[0]!;
    await fx.topic(teamId, { name: shared, displayOrder: 1 });
    await fx.topic(teamId, { name: shared, displayOrder: 2, status: "archived" });

    const listed = await notActive(teamId, admin);

    expect(listed.map((d) => d.name)).toEqual(defaultNames.slice(1));
    expect(listed.every((d) => d.isArchived === false)).toBe(true);
  });

  it("the order of the rows does not matter: an archived topic created after the active one is still ignored", async () => {
    fx = new Fixture(mods.db);
    const admin = await fx.user("application_admin");
    const owner = await fx.user("facilitator");
    const teamId = await fx.team(owner);
    const shared = defaultNames[1]!;
    await fx.topic(teamId, { name: shared, displayOrder: 1, status: "archived" });
    await fx.topic(teamId, { name: shared, displayOrder: 1 });

    const listed = await notActive(teamId, admin);

    expect(listed.map((d) => d.name)).not.toContain(shared);
    expect(listed).toHaveLength(defaultNames.length - 1);
  });

  it("a team with only an archived match still reports that default as archived, once", async () => {
    fx = new Fixture(mods.db);
    const admin = await fx.user("application_admin");
    const owner = await fx.user("facilitator");
    const teamId = await fx.team(owner);
    const shared = defaultNames[0]!;
    // #311: matching is by link, so the archived copies are linked to the template default.
    const templateId = (
      await mods.db.query<{ id: string }>(
        `SELECT id FROM topics WHERE team_id = $1 AND is_default = true AND status = 'active' AND name = $2`,
        [SENTINEL_TEAM_ID, shared],
      )
    ).rows[0]!.id;
    const archivedIds = [
      await fx.topic(teamId, { name: shared, displayOrder: 1, status: "archived", templateTopicId: templateId }),
      await fx.topic(teamId, { name: shared, displayOrder: 2, status: "archived", templateTopicId: templateId }),
    ];

    const listed = await notActive(teamId, admin);

    const rowsForShared = listed.filter((d) => d.name === shared);
    expect(rowsForShared).toHaveLength(1);
    expect(rowsForShared[0]).toMatchObject({ isArchived: true });
    // Either archived copy is a valid restore target; the id must be one of them.
    expect(archivedIds).toContain(rowsForShared[0]!.topicId);
    expect(listed).toHaveLength(defaultNames.length);
  });
});
