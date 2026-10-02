import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { probeInfra, requireInfraOrThrow, loadModules, buildApp, Fixture, sessionTopicRows } from "./helpers/real-db.js";
import type { Mods, Db } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// The standing full-ritual CI gate — session-topics-snapshot-at-creation
// (#175) tasks.md 8.1 and 8.2.
//
// Runs the whole ritual through the real route handlers against real
// Postgres and Redis: room open, start, begin-voting, every topic through
// reveal and advance, to wrap_up. Before #175 no route wrote session_topics,
// so every real session stopped at begin-voting; this file is the guard
// that the main path stays open.
//
// MUST NOT be marked skip or todo. Its only skip is the house infra probe
// (for ci.yml, which has no Postgres); under REQUIRE_DB (integration.yml) a
// missing database fails the file instead of skipping it.
//
// The mid-topic reconnect calls buildSessionRegistrationSnapshot directly:
// there is no real-socket-plus-real-DB harness.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "e2e-full-ritual.test.ts");

/** The snapshot columns that must never change after room open (status is excluded: the ritual advances it). */
async function frozenColumns(db: Db, sessionId: string) {
  return (await sessionTopicRows(db, sessionId)).map(({ status: _status, ...rest }) => rest);
}

async function roomOpenedAt(db: Db, sessionId: string): Promise<string | null> {
  const row = (await db.query<{ room_opened_at: Date | null }>(`SELECT room_opened_at FROM sessions WHERE id = $1`, [sessionId]))
    .rows[0]!;
  return row.room_opened_at?.toISOString() ?? null;
}

describe.skipIf(!infraUp)("e2e — the full ritual runs end to end (#175)", () => {
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

  /** Reveals and advances every remaining topic, returning the names in the order they were presented. */
  async function runAllTopics(
    facApp: FastifyInstance,
    teamId: string,
    sessionId: string,
    first: { topicName: string; topicAnnotation: string | null },
    onTopic?: (index: number, sessionTopicId: string) => Promise<void>,
  ) {
    const presented: Array<{ topicName: string; topicAnnotation: string | null }> = [
      { topicName: first.topicName, topicAnnotation: first.topicAnnotation },
    ];
    let currentSessionTopicId: string | undefined;
    for (let i = 0; ; i++) {
      const current = await mods.buildSessionRegistrationSnapshot("00000000-0000-0000-0000-000000000000", sessionId);
      currentSessionTopicId = current!.currentTopic!.sessionTopicId;
      await onTopic?.(i, currentSessionTopicId);

      const reveal = await facApp.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/${sessionId}/reveal` });
      expect(reveal.statusCode).toBe(200);

      const adv = await facApp.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/${sessionId}/topics/advance` });
      expect(adv.statusCode).toBe(200);
      const body = adv.json();
      if (body.status === "wrap_up") break;
      expect(body.status).toBe("active");
      presented.push({ topicName: body.currentTopic.topicName, topicAnnotation: body.currentTopic.topicAnnotation });
    }
    return presented;
  }

  // -------------------------------------------------------------------------
  // 8.1 — (a) existing team: draft-window edits reach the session; nothing
  // after room open changes it.
  // -------------------------------------------------------------------------
  it("(a) existing team: draft-window reorder, archive, restore, and annotate reach the session, which runs to wrap_up unchanged", async () => {
    fx = new Fixture(mods.db);
    const fac = await fx.user();
    const participant = await fx.user("engineer");
    const teamId = await fx.team(fac);
    // The full ritual cannot yet produce a completed session for this team,
    // so the customization lock is lifted with SQL.
    await fx.unlock(teamId, fac);
    await mods.db.query(`INSERT INTO team_memberships (team_id, user_id, role) VALUES ($1, $2, 'participant')`, [
      teamId,
      participant,
    ]);
    const a = await fx.topic(teamId, { displayOrder: 1, name: "Alpha" });
    const b = await fx.topic(teamId, { displayOrder: 2, name: "Bravo" });
    const c = await fx.topic(teamId, { displayOrder: 3, name: "Charlie" });
    const d = await fx.topic(teamId, { displayOrder: 4, name: "Delta", annotation: "Old delta meaning" });

    const facApp = await appFor(fac);
    const draft = await facApp.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/draft` });
    expect(draft.statusCode).toBe(201);
    const sessionId = draft.json().sessionId as string;

    // Draft window: reorder, archive, restore, annotate.
    const reorder = await facApp.inject({
      method: "PUT",
      url: `/api/v1/teams/${teamId}/topics/order`,
      payload: { orderedTopicIds: [d, a, b, c] },
    });
    expect(reorder.statusCode).toBe(200);
    expect((await facApp.inject({ method: "DELETE", url: `/api/v1/teams/${teamId}/topics/${b}?confirm=true` })).statusCode).toBe(200);
    expect(
      (await facApp.inject({ method: "POST", url: `/api/v1/teams/${teamId}/topics/${b}/restore`, payload: {} })).statusCode,
    ).toBe(200);
    for (const [id, annotation] of [
      [a, "Alpha, as we mean it"],
      [d, "Delta, as we mean it now"],
    ] as const) {
      const res = await facApp.inject({
        method: "PUT",
        url: `/api/v1/teams/${teamId}/topics/${id}/annotation`,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ annotation }),
      });
      expect(res.statusCode).toBe(200);
    }

    // Room open.
    const open = await facApp.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/${sessionId}/advance` });
    expect(open.statusCode).toBe(200);
    const atOpen = await frozenColumns(mods.db, sessionId);
    const openedAt = await roomOpenedAt(mods.db, sessionId);
    expect(openedAt).not.toBeNull();
    // Restore appended Bravo after every topic active at the time.
    expect(atOpen.map((r) => r.topic_id)).toEqual([d, a, c, b]);
    expect(atOpen.map((r) => r.display_order)).toEqual([1, 2, 3, 4]);

    await mods.db.query(`INSERT INTO session_participants (session_id, user_id) VALUES ($1, $2)`, [sessionId, participant]);

    const start = await facApp.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/start` });
    expect(start.statusCode).toBe(200);
    expect(await frozenColumns(mods.db, sessionId)).toEqual(atOpen);

    const begin = await facApp.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/begin-voting` });
    expect(begin.statusCode).toBe(200);
    expect(await frozenColumns(mods.db, sessionId)).toEqual(atOpen);

    const participantApp = await appFor(participant);
    const presented = await runAllTopics(facApp, teamId, sessionId, begin.json().currentTopic, async (index, sessionTopicId) => {
      if (index !== 1) return;
      // Mid-topic: the participant locks in, then reconnects.
      const lockIn = await participantApp.inject({
        method: "POST",
        url: `/api/v1/sessions/${sessionId}/topics/${sessionTopicId}/lock-in`,
        payload: { voteValue: 3, voteType: "finger" },
      });
      expect(lockIn.statusCode).toBe(201);
      const reconnect = await mods.buildSessionRegistrationSnapshot(participant, sessionId);
      expect(reconnect).toEqual({
        sessionId,
        sessionStatus: "active",
        currentTopic: { sessionTopicId, status: "voting" },
        hasLockedInVote: true,
      });
    });

    expect(presented).toEqual([
      { topicName: "Delta", topicAnnotation: "Delta, as we mean it now" },
      { topicName: "Alpha", topicAnnotation: "Alpha, as we mean it" },
      { topicName: "Charlie", topicAnnotation: null },
      { topicName: "Bravo", topicAnnotation: null },
    ]);

    const status = await mods.db.query<{ status: string }>(`SELECT status FROM sessions WHERE id = $1`, [sessionId]);
    expect(status.rows[0]!.status).toBe("wrap_up");
    expect(await frozenColumns(mods.db, sessionId)).toEqual(atOpen);
    expect(await roomOpenedAt(mods.db, sessionId)).toBe(openedAt);
  });

  // -------------------------------------------------------------------------
  // 8.2 — (b) new team: POST /teams opens the room directly.
  // -------------------------------------------------------------------------
  it("(b) new team: POST /teams, start, begin voting, and every default topic in canonical order to wrap_up", async () => {
    fx = new Fixture(mods.db);
    const fac = await fx.user();
    const facApp = await appFor(fac);

    const created = await facApp.inject({ method: "POST", url: "/api/v1/teams", payload: { name: `Full Ritual New Team ${fac}` } });
    expect(created.statusCode).toBe(201);
    const { teamId, sessionId } = created.json() as { teamId: string; sessionId: string };
    fx.track(teamId);

    const defaults = (
      await mods.db.query<{ name: string }>(`SELECT name FROM topics WHERE team_id = $1 ORDER BY display_order`, [teamId])
    ).rows.map((r) => r.name);
    expect(defaults.length).toBeGreaterThan(0);
    const atOpen = await frozenColumns(mods.db, sessionId);

    expect((await facApp.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/start` })).statusCode).toBe(200);
    const begin = await facApp.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/begin-voting` });
    expect(begin.statusCode).toBe(200);

    const presented = await runAllTopics(facApp, teamId, sessionId, begin.json().currentTopic);

    expect(presented.map((p) => p.topicName)).toEqual(defaults);
    const status = await mods.db.query<{ status: string }>(`SELECT status FROM sessions WHERE id = $1`, [sessionId]);
    expect(status.rows[0]!.status).toBe("wrap_up");
    expect(await frozenColumns(mods.db, sessionId)).toEqual(atOpen);
  });
});
