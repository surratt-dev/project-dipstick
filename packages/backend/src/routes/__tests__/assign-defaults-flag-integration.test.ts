import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { probeInfra, requireInfraOrThrow, loadModules, Fixture, SENTINEL_TEAM_ID } from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";
import { snapshotTemplate, restoreTemplate } from "./helpers/template-snapshot.js";
import type { TemplateSnapshot } from "./helpers/template-snapshot.js";
import {
  ASSIGN_PATH,
  buildLoggedApp,
  holdTemplateLockPerTest,
  resetDenialAuditBudget,
  zeroTopicTeam,
} from "./helpers/assign-defaults.js";
import type { LoggedApp } from "./helpers/assign-defaults.js";

// ---------------------------------------------------------------------------
// zero-topic-team-recovery (#200) tasks.md 4.1 -- real Postgres half of the
// canAssignDefaults tests (the eight-row truth table is in content.test.ts).
// Here: the flag agrees with the endpoint's own authorization for every caller
// class (the topic-add-flag-parity.test.ts pattern; each row carries an
// explicit expected outcome so a mis-routed query cannot make both sides agree
// by denying everyone), the flag clears after an assignment, and a template
// whose active topics are all archived never gets the flag.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "assign-defaults-flag-integration.test.ts");

describe.skipIf(!infraUp)("canAssignDefaults against the real endpoint (#200 4.1)", () => {
  let mods: Mods;
  let fx: Fixture;
  let snap: TemplateSnapshot | undefined;
  const apps: LoggedApp[] = [];

  holdTemplateLockPerTest();

  beforeAll(async () => {
    mods = await loadModules();
  });

  afterEach(async () => {
    for (const a of apps.splice(0)) await a.app.close();
    if (snap) await restoreTemplate(mods.db, snap);
    snap = undefined;
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

  type Setup = (teamId: string) => Promise<string>;
  // [label, setup, expected GET status, expected flag (GET 200 only), expected POST status]
  const callers: Array<[string, Setup, 200 | 403, boolean | null, 201 | 403]> = [
    ["a facilitator who is not a member", async () => fx.user("facilitator"), 200, false, 403],
    ["a facilitator who is a member", async (t) => { const id = await fx.user("facilitator"); await fx.member(t, id); return id; }, 403, null, 403],
    ["an engineering manager (member)", async (t) => { const id = await fx.user("engineering_manager"); await fx.member(t, id, "engineering_manager"); return id; }, 403, null, 403],
    ["an engineer (participant member)", async (t) => { const id = await fx.user("engineer"); await fx.member(t, id); return id; }, 403, null, 403],
    ["a caller with no users row", async () => randomUUID(), 403, null, 403],
    ["an application_admin on no team", async () => fx.user("application_admin"), 200, true, 201],
    ["an application_admin who is a participant", async (t) => { const id = await fx.user("application_admin"); await fx.member(t, id); return id; }, 200, true, 201],
    ["an application_admin who is an engineering manager", async (t) => { const id = await fx.user("application_admin"); await fx.member(t, id, "engineering_manager"); return id; }, 200, true, 201],
  ];

  it.each(callers)("%s: flag agrees with the endpoint", async (_label, setup, expectedGet, expectedFlag, expectedPost) => {
    fx = new Fixture(mods.db);
    const { teamId } = await zeroTopicTeam(fx);
    const caller = await setup(teamId);
    const logged = await as(caller);

    const get = await logged.app.inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics/all` });
    const post = await logged.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) });

    expect(get.statusCode).toBe(expectedGet);
    expect(post.statusCode).toBe(expectedPost);
    if (get.statusCode === 200) {
      const flag = get.json().canAssignDefaults as boolean;
      expect(flag).toBe(expectedFlag);
      // The relational check: the flag is true exactly when the post is not a 403.
      expect(flag).toBe(post.statusCode !== 403);
    }
  });

  it("after a successful assignment a refetch lists the topics and canAssignDefaults is false", async () => {
    fx = new Fixture(mods.db);
    const { teamId } = await zeroTopicTeam(fx);
    const admin = await fx.user("application_admin");
    const logged = await as(admin);

    const before = await logged.app.inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics/all` });
    const post = await logged.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) });
    const after = await logged.app.inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics/all` });

    expect(before.json().canAssignDefaults).toBe(true);
    expect(post.statusCode).toBe(201);
    expect(after.json().active).toHaveLength(post.json().topicCount);
    expect(after.json().canAssignDefaults).toBe(false);
  });

  it("the template team never gets the flag, even when its active topics are all archived", async () => {
    fx = new Fixture(mods.db);
    const admin = await fx.user("application_admin");
    const logged = await as(admin);

    const intact = await logged.app.inject({ method: "GET", url: `/api/v1/teams/${SENTINEL_TEAM_ID}/topics/all` });
    expect(intact.statusCode).toBe(200);
    expect(intact.json().canAssignDefaults).toBe(false);

    snap = await snapshotTemplate(mods.db);
    await mods.db.query(
      `UPDATE topics SET status = 'archived', archived_at = now()
        WHERE team_id = $1 AND status = 'active'`,
      [SENTINEL_TEAM_ID],
    );
    const emptied = await logged.app.inject({ method: "GET", url: `/api/v1/teams/${SENTINEL_TEAM_ID}/topics/all` });

    expect(emptied.statusCode).toBe(200);
    expect(emptied.json().active).toHaveLength(0);
    expect(emptied.json().canAssignDefaults).toBe(false);
    // ... and the endpoint agrees: the template is never a target.
    expect((await logged.app.inject({ method: "POST", url: ASSIGN_PATH(SENTINEL_TEAM_ID) })).statusCode).toBe(404);
  });
});
