import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  buildApp,
  Fixture,
  sessionTopicRows,
  activeTopicIdsInOrder,
} from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// Edit isolation after room open — session-topics-snapshot-at-creation
// (#175) tasks.md 8.3, 8.4, and 8.5.
//
// Teams adapt between sessions, never during one: once a session's room is
// open, topic edits (reorder, archive, add, restore, annotate) and even a
// direct SQL rename of a topic leave that session's snapshot untouched, and
// the next session's snapshot picks all of them up.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "session-topic-edit-isolation-integration.test.ts");

describe.skipIf(!infraUp)("session topic snapshot — edit isolation (real Postgres)", () => {
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

  async function appFor(userId: string) {
    const app = await buildApp(mods, userId);
    apps.push(app);
    return app;
  }

  async function openDraft(app: FastifyInstance, teamId: string): Promise<string> {
    const draft = await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/draft` });
    expect(draft.statusCode).toBe(201);
    const sessionId = draft.json().sessionId as string;
    const open = await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/${sessionId}/advance` });
    expect(open.statusCode).toBe(200);
    return sessionId;
  }

  /** start -> begin-voting -> (reveal, advance)* -> wrap_up, returning the presented topic names. */
  async function runToWrapUp(app: FastifyInstance, teamId: string, sessionId: string) {
    expect((await app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/start` })).statusCode).toBe(200);
    const begin = await app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/begin-voting` });
    expect(begin.statusCode).toBe(200);
    const presented = [{ name: begin.json().currentTopic.topicName as string, prompt: begin.json().currentTopic.topicPrompt as string }];
    for (;;) {
      expect((await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/${sessionId}/reveal` })).statusCode).toBe(200);
      const adv = await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/${sessionId}/topics/advance` });
      expect(adv.statusCode).toBe(200);
      if (adv.json().status === "wrap_up") break;
      presented.push({ name: adv.json().currentTopic.topicName, prompt: adv.json().currentTopic.topicPrompt });
    }
    return presented;
  }

  async function seedUnlockedTeam(names: string[]) {
    fx = new Fixture(mods.db);
    const fac = await fx.user();
    const teamId = await fx.team(fac);
    await fx.unlock(teamId, fac);
    const ids: string[] = [];
    for (const [i, name] of names.entries()) {
      ids.push(await fx.topic(teamId, { displayOrder: i + 1, name, prompt: `${name}?`, annotation: `${name} meaning` }));
    }
    return { fac, teamId, ids };
  }

  // -------------------------------------------------------------------------
  // 8.3
  // -------------------------------------------------------------------------
  it("edits after room open leave the open session's rows unchanged and reach the next session", async () => {
    const { fac, teamId, ids } = await seedUnlockedTeam(["One", "Two", "Three", "Four"]);
    const [t1, t2, t3, t4] = ids as [string, string, string, string];
    const app = await appFor(fac);
    const sessionId = await openDraft(app, teamId);
    const atOpen = await sessionTopicRows(mods.db, sessionId);
    expect(atOpen.map((r) => r.topic_id)).toEqual([t1, t2, t3, t4]);

    // Every structural edit, plus an annotation edit, while the room is open.
    const reorder = await app.inject({
      method: "PUT",
      url: `/api/v1/teams/${teamId}/topics/order`,
      payload: { orderedTopicIds: [t4, t3, t2, t1] },
    });
    expect(reorder.statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/teams/${teamId}/topics/${t2}?confirm=true` })).statusCode).toBe(200);
    const added = await app.inject({
      method: "POST",
      url: `/api/v1/teams/${teamId}/topics`,
      payload: { name: "Newcomer", prompt: "Newcomer?", voteType: "finger" },
    });
    expect(added.statusCode).toBe(201);
    expect((await app.inject({ method: "DELETE", url: `/api/v1/teams/${teamId}/topics/${t3}?confirm=true` })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics/${t3}/restore`, payload: {} })).statusCode).toBe(200);
    const annotate = await app.inject({
      method: "PUT",
      url: `/api/v1/teams/${teamId}/topics/${t1}/annotation`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ annotation: "One, redefined" }),
    });
    expect(annotate.statusCode).toBe(200);

    // Every column of the open session's rows is unchanged.
    expect(await sessionTopicRows(mods.db, sessionId)).toEqual(atOpen);

    // A direct rename of snapshotted topics does not reach the session either.
    await mods.db.query(`UPDATE topics SET name = name || ' (renamed)', prompt = 'Renamed?' WHERE id = ANY($1::uuid[])`, [[t1, t2]]);

    // The session runs on its snapshot: original names and prompts, original
    // order, and Two (archived after room open) still at position 2.
    const presented = await runToWrapUp(app, teamId, sessionId);
    expect(presented).toEqual(atOpen.map((r) => ({ name: r.topic_name, prompt: r.topic_prompt })));
    expect(presented.map((p) => p.name)).toEqual(["One", "Two", "Three", "Four"]);

    // The next session's snapshot reflects every edit.
    expect((await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/${sessionId}/complete` })).statusCode).toBe(200);
    const nextId = await openDraft(app, teamId);
    const next = await sessionTopicRows(mods.db, nextId);
    const newcomer = added.json().topicId as string;
    // Reorder gave 4,3,2,1; archiving Two left 4,3,1; Newcomer appended;
    // Three archived and restored is appended after Newcomer.
    expect(next.map((r) => r.topic_id)).toEqual([t4, t1, newcomer, t3]);
    expect(next.map((r) => r.topic_id)).toEqual(await activeTopicIdsInOrder(mods.db, teamId));
    expect(next.map((r) => r.display_order)).toEqual([1, 2, 3, 4]);
    expect(next.find((r) => r.topic_id === t1)).toMatchObject({
      topic_name: "One (renamed)",
      topic_prompt: "Renamed?",
      topic_annotation: "One, redefined",
    });
  });

  // -------------------------------------------------------------------------
  // 8.4 — FR-8.3
  // -------------------------------------------------------------------------
  it("an archived topic's past rows stay in history and trends, and it is absent from the next snapshot", async () => {
    const { fac, teamId, ids } = await seedUnlockedTeam(["Keep", "Retire"]);
    const [keep, retire] = ids as [string, string];
    const participant = await fx.user("engineer");
    await mods.db.query(`INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, 'participant')`, [teamId, participant]);
    const app = await appFor(fac);

    const sessionId = await openDraft(app, teamId);
    await mods.db.query(`INSERT INTO session_participants (session_id, user_id) VALUES ($1, $2)`, [sessionId, participant]);
    await runToWrapUp(app, teamId, sessionId);
    expect((await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/${sessionId}/complete` })).statusCode).toBe(200);

    expect((await app.inject({ method: "DELETE", url: `/api/v1/teams/${teamId}/topics/${retire}?confirm=true` })).statusCode).toBe(200);

    const participantApp = await appFor(participant);
    const trends = await participantApp.inject({ method: "GET", url: `/api/v1/teams/${teamId}/trends` });
    expect(trends.statusCode).toBe(200);
    const trendTopicIds = (trends.json().trends as Array<{ topic_id: string; session_id: string }>)
      .filter((t) => t.session_id === sessionId)
      .map((t) => t.topic_id);
    expect(trendTopicIds).toEqual(expect.arrayContaining([keep, retire]));

    const pastRows = await sessionTopicRows(mods.db, sessionId);
    expect(pastRows.map((r) => r.topic_id)).toEqual([keep, retire]);

    const history = await participantApp.inject({ method: "GET", url: `/api/v1/teams/${teamId}/sessions` });
    expect(history.statusCode).toBe(200);
    expect(history.body).toContain(retire);

    const nextId = await openDraft(app, teamId);
    expect((await sessionTopicRows(mods.db, nextId)).map((r) => r.topic_id)).toEqual([keep]);
  });

  // -------------------------------------------------------------------------
  // 8.5
  // -------------------------------------------------------------------------
  it("archiving then restoring a topic during the draft puts it in the snapshot at its appended position", async () => {
    const { fac, teamId, ids } = await seedUnlockedTeam(["A", "B", "C"]);
    const [a, b, c] = ids as [string, string, string];
    const app = await appFor(fac);
    const draft = await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/draft` });
    const sessionId = draft.json().sessionId as string;

    expect((await app.inject({ method: "DELETE", url: `/api/v1/teams/${teamId}/topics/${a}?confirm=true` })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics/${a}/restore`, payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/${sessionId}/advance` })).statusCode).toBe(200);

    const rows = await sessionTopicRows(mods.db, sessionId);
    expect(rows.map((r) => r.topic_id)).toEqual([b, c, a]);
    expect(rows.map((r) => r.display_order)).toEqual([1, 2, 3]);
  });
});
