import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  Fixture,
  sessionTopicRows,
  withTeamLockGate,
  withTeamLockGateStaged,
} from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";
import {
  ASSIGN_PATH,
  activeCount,
  buildLoggedApp,
  holdTemplateLockPerTest,
  resetDenialAuditBudget,
  teamTopicRows,
  templateDefaults,
  zeroTopicTeam,
} from "./helpers/assign-defaults.js";
import type { LoggedApp } from "./helpers/assign-defaults.js";

// ---------------------------------------------------------------------------
// zero-topic-team-recovery (#200) tasks.md 3.4 -- REQUIRE_DB=1 real Postgres.
// Genuine concurrency, not Promise.all of two short requests: the production
// team-topics advisory lock is held by a gate connection until the requests
// are queued on it (helpers/real-db.ts withTeamLockGate), so the overlap is
// guaranteed and a timeout fails the test instead of passing without overlap.
//
// Proves design.md D3: the zero-active precondition is read as a NEW statement
// after the lock, at the default READ COMMITTED isolation, and the lock is
// transaction-scoped, so exactly one of two simultaneous calls wins, a room
// open waiting behind the assignment snapshots the assigned rows, and the lock
// is free afterwards. Compares with the template, so each test holds the template lock.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "assign-defaults-concurrency-integration.test.ts");

describe.skipIf(!infraUp)("assign-defaults concurrency (real Postgres, #200)", () => {
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

  async function lockIsFree(teamId: string): Promise<boolean> {
    const probe = await mods.db.connect();
    try {
      await probe.query("BEGIN");
      const { rows } = await probe.query<{ ok: boolean }>(`SELECT pg_try_advisory_xact_lock(hashtext($1::uuid::text)) AS ok`, [teamId]);
      return rows[0]!.ok;
    } finally {
      await probe.query("ROLLBACK").catch(() => undefined);
      probe.release();
    }
  }

  it("two simultaneous calls on a zero-active team: exactly one 201 and one 409, the template's topic count, no duplicate display_order, lock free", async () => {
    fx = new Fixture(mods.db);
    const { teamId } = await zeroTopicTeam(fx);
    const adminA = await fx.user("application_admin");
    const adminB = await fx.user("application_admin");
    const appA = await as(adminA);
    const appB = await as(adminB);
    const expected = (await templateDefaults(mods)).length;

    const results = await withTeamLockGate(mods, teamId, () => [
      appA.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) }),
      appB.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) }),
    ]);

    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const loser = results.find((r) => r.statusCode === 409)!;
    expect(loser.json().error.code).toBe("TEAM_HAS_ACTIVE_TOPICS");
    expect(await activeCount(mods, teamId)).toBe(expected);
    const orders = (await teamTopicRows(mods, teamId)).map((r) => r.display_order);
    expect(orders).toEqual(Array.from({ length: expected }, (_, i) => i + 1));
    expect(new Set(orders).size).toBe(orders.length);
    expect(await lockIsFree(teamId)).toBe(true);
    // Exactly one success row, from the winner.
    const rows = await mods.db.query(`SELECT 1 FROM audit_log WHERE team_id = $1 AND operation = 'topic.defaults_assigned'`, [teamId]);
    expect(rows.rowCount).toBe(1);
  });

  it("the same admin double-clicking lands on one 201 and one 409 too", async () => {
    fx = new Fixture(mods.db);
    const { teamId } = await zeroTopicTeam(fx);
    const admin = await fx.user("application_admin");
    const logged = await as(admin);

    const results = await withTeamLockGate(mods, teamId, () => [
      logged.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) }),
      logged.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) }),
    ]);

    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await activeCount(mods, teamId)).toBe((await templateDefaults(mods)).length);
  });

  it("the precondition runs at the default READ COMMITTED isolation (nothing overrides it)", async () => {
    const client = await mods.db.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ transaction_isolation: string }>(`SHOW transaction_isolation`);
      await client.query("ROLLBACK");
      expect(rows[0]!.transaction_isolation).toBe("read committed");
    } finally {
      client.release();
    }
  });

  it("an /advance blocked behind the assignment's lock then snapshots the newly assigned rows", async () => {
    fx = new Fixture(mods.db);
    const { teamId, owner } = await zeroTopicTeam(fx);
    const draftId = await fx.session(teamId, owner, "draft");
    const admin = await fx.user("application_admin");
    const adminApp = await as(admin);
    const facApp = await as(owner);

    // Staged: the assignment queues on the lock first, the room open second, so
    // the open runs only after the assignment has committed.
    const [assign, advance] = await withTeamLockGateStaged(mods, teamId, [
      () => adminApp.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) }),
      () => facApp.app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/${draftId}/advance` }),
    ]);

    expect(assign!.statusCode).toBe(201);
    expect(advance!.statusCode).toBe(200);
    const assigned = await teamTopicRows(mods, teamId);
    const snapshot = await sessionTopicRows(mods.db, draftId);
    expect(snapshot.map((r) => r.topic_id)).toEqual(assigned.map((r) => r.id));
    expect(snapshot).toHaveLength((await templateDefaults(mods)).length);
  });

  it("an /advance that wins the lock first is refused NO_ACTIVE_TOPICS and the assignment then succeeds", async () => {
    fx = new Fixture(mods.db);
    const { teamId, owner } = await zeroTopicTeam(fx);
    const draftId = await fx.session(teamId, owner, "draft");
    const admin = await fx.user("application_admin");
    const adminApp = await as(admin);
    const facApp = await as(owner);

    const [advance, assign] = await withTeamLockGateStaged(mods, teamId, [
      () => facApp.app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/${draftId}/advance` }),
      () => adminApp.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) }),
    ]);

    expect(advance!.statusCode).toBe(409);
    expect(advance!.json().error.code).toBe("NO_ACTIVE_TOPICS");
    expect(assign!.statusCode).toBe(201);
    expect(await sessionTopicRows(mods.db, draftId)).toHaveLength(0);
    expect(await lockIsFree(teamId)).toBe(true);
  });

  it("the recovered topics equal a freshly created team's, field for field", async () => {
    fx = new Fixture(mods.db);
    const { teamId } = await zeroTopicTeam(fx);
    const admin = await fx.user("application_admin");
    const creator = await fx.user("facilitator");

    const recovered = await (await as(admin)).app.inject({ method: "POST", url: ASSIGN_PATH(teamId) });
    const created = await (await as(creator)).app.inject({
      method: "POST",
      url: "/api/v1/teams",
      payload: { name: `Fresh ${teamId}` },
    });

    expect(recovered.statusCode).toBe(201);
    expect(created.statusCode).toBe(201);
    const freshTeamId = created.json().teamId as string;
    fx.track(freshTeamId);
    const shape = (rows: Awaited<ReturnType<typeof teamTopicRows>>) =>
      rows.map(({ id: _id, ...rest }) => rest);
    expect(shape(await teamTopicRows(mods, teamId))).toEqual(shape(await teamTopicRows(mods, freshTeamId)));
  });
});
