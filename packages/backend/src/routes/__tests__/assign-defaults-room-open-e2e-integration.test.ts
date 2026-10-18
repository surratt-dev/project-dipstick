import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { probeInfra, requireInfraOrThrow, loadModules, Fixture, sessionTopicRows } from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";
import {
  ASSIGN_PATH,
  buildLoggedApp,
  holdTemplateLockPerTest,
  resetDenialAuditBudget,
  teamTopicRows,
  templateDefaults,
  zeroTopicTeam,
} from "./helpers/assign-defaults.js";
import type { LoggedApp } from "./helpers/assign-defaults.js";

// ---------------------------------------------------------------------------
// zero-topic-team-recovery (#200) tasks.md 5.2 -- the end-to-end sequence the
// whole change exists for, against real Postgres: a facilitator drafts a
// session for a locked zero-topic team, is refused at room open with the
// ask-an-administrator message, an administrator assigns the defaults, and the
// SAME session id then opens. Compares with the template, so each test holds
// the template lock.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "assign-defaults-room-open-e2e-integration.test.ts");

const LOCKED_MESSAGE =
  "This team has no active topics, so the room can't open yet. Ask an application administrator to assign the default topics, then try again. Your session is saved.";
const UNLOCKED_MESSAGE =
  "This team has no active topics. Add or restore a topic on Topic Management before opening the room.";

describe.skipIf(!infraUp)("blocked room open, recovery, retry (real Postgres, #200 5.2)", () => {
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

  async function sessionRows(teamId: string) {
    return (await mods.db.query<{ id: string; status: string }>(`SELECT id, status FROM sessions WHERE team_id = $1`, [teamId])).rows;
  }

  it("draft -> refused (locked message) -> admin assigns -> the same session id opens, snapshotting the assigned topics", async () => {
    fx = new Fixture(mods.db);
    const { teamId, owner } = await zeroTopicTeam(fx);
    const admin = await fx.user("application_admin");
    const facilitator = await as(owner);
    const adminApp = await as(admin);

    const draft = await facilitator.app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/draft` });
    expect(draft.statusCode).toBe(201);
    const sessionId = draft.json().sessionId as string;
    const advanceUrl = `/api/v1/teams/${teamId}/sessions/${sessionId}/advance`;

    const refused = await facilitator.app.inject({ method: "POST", url: advanceUrl });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({ code: "NO_ACTIVE_TOPICS", message: LOCKED_MESSAGE });
    expect(await sessionRows(teamId)).toEqual([{ id: sessionId, status: "draft" }]);
    expect(await sessionTopicRows(mods.db, sessionId)).toHaveLength(0);
    expect(
      (await mods.db.query(`SELECT 1 FROM audit_log WHERE operation = 'session.state_changed' AND metadata->>'session_id' = $1`, [sessionId])).rowCount,
    ).toBe(0);

    // A participant cannot join the draft meanwhile.
    const participant = await fx.user("engineer");
    const joined = await (await as(participant)).app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/participants` });
    expect(joined.statusCode).toBe(422);

    const assigned = await adminApp.app.inject({ method: "POST", url: ASSIGN_PATH(teamId) });
    expect(assigned.statusCode).toBe(201);

    const opened = await facilitator.app.inject({ method: "POST", url: advanceUrl });
    expect(opened.statusCode).toBe(200);
    expect(opened.json()).toEqual({ sessionId, teamId, status: "lobby" });
    // No new session row: the same draft opened, with no step but clicking Open room again.
    expect(await sessionRows(teamId)).toEqual([{ id: sessionId, status: "lobby" }]);
    const snapshot = await sessionTopicRows(mods.db, sessionId);
    const assignedTopics = await teamTopicRows(mods, teamId);
    expect(snapshot.map((r) => r.topic_id)).toEqual(assignedTopics.map((r) => r.id));
    expect(snapshot.map((r) => r.topic_name)).toEqual((await templateDefaults(mods)).map((d) => d.name));
  });

  it("an unlocked zero-topic team keeps the original message", async () => {
    fx = new Fixture(mods.db);
    const { teamId, owner } = await zeroTopicTeam(fx, { unlocked: true });
    const facilitator = await as(owner);
    const sessionId = await fx.session(teamId, owner, "draft");

    const refused = await facilitator.app.inject({
      method: "POST",
      url: `/api/v1/teams/${teamId}/sessions/${sessionId}/advance`,
    });

    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({ code: "NO_ACTIVE_TOPICS", message: UNLOCKED_MESSAGE });
  });

  it("an application admin never reaches the branch: /advance answers 403 (live role must be facilitator), not the 409", async () => {
    fx = new Fixture(mods.db);
    const { teamId, owner } = await zeroTopicTeam(fx);
    const sessionId = await fx.session(teamId, owner, "draft");
    // The draft's creator, since demoted/promoted to admin: authorization comes first.
    await fx.setRoles(owner, ["application_admin"]);
    const asAdmin = await as(owner);

    const res = await asAdmin.app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/${sessionId}/advance` });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).not.toBe("NO_ACTIVE_TOPICS");
  });

  it("authorization is checked before status, and status before the topic count", async () => {
    fx = new Fixture(mods.db);
    const { teamId, owner } = await zeroTopicTeam(fx);
    const draftId = await fx.session(teamId, owner, "draft");
    const stranger = await fx.user("facilitator");

    const notCreator = await (await as(stranger)).app.inject({
      method: "POST",
      url: `/api/v1/teams/${teamId}/sessions/${draftId}/advance`,
    });
    expect(notCreator.statusCode).toBe(403);

    await mods.db.query(`UPDATE sessions SET status = 'lobby' WHERE id = $1`, [draftId]);
    const notDraft = await (await as(owner)).app.inject({
      method: "POST",
      url: `/api/v1/teams/${teamId}/sessions/${draftId}/advance`,
    });
    expect(notDraft.statusCode).toBe(422);
  });
});
