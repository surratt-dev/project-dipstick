import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  buildApp,
  Fixture,
  sessionTopicRows,
  activeTopicIdsInOrder,
  withTeamLockGate,
} from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// Real Postgres coverage for room open — session-topics-snapshot-at-creation
// (#175) tasks.md 3.1 (integration half), 3.5, 3.6, 4.4, and 5.3.
//
// Zero active topics is not reachable through the API (TOPIC_LAST_ACTIVE and
// the customization lock prevent it), so it is seeded with SQL. Concurrency
// uses withTeamLockGate, which holds the production team lock until both
// requests are queued on it. Never empties the shared default-topic
// template: the POST /teams empty-template 500 is covered at mock level.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "room-open-integration.test.ts");

const NO_TOPICS_MESSAGE =
  "This team has no active topics. Add or restore a topic on Topic Management before opening the room.";

describe.skipIf(!infraUp)("room open — real Postgres", () => {
  let mods: Mods;
  let fx: Fixture;

  beforeAll(async () => {
    mods = await loadModules();
  });

  afterEach(async () => {
    await fx?.cleanup();
  });

  async function sessionRow(sessionId: string) {
    return (
      await mods.db.query<{ status: string; room_opened_at: Date | null; created_at: Date }>(
        `SELECT status, room_opened_at, created_at FROM sessions WHERE id = $1`,
        [sessionId],
      )
    ).rows[0]!;
  }

  async function openAuditRows(sessionId: string) {
    return (
      await mods.db.query<{ metadata: Record<string, unknown> }>(
        `SELECT metadata FROM audit_log
          WHERE operation = 'session.state_changed'
            AND metadata->>'session_id' = $1 AND metadata->>'new_status' = 'lobby'`,
        [sessionId],
      )
    ).rows;
  }

  async function advance(userId: string, teamId: string, sessionId: string) {
    const app = await buildApp(mods, userId);
    try {
      return await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/${sessionId}/advance` });
    } finally {
      await app.close();
    }
  }

  /** An unlocked team (one completed session) with active topics at the given orders, plus a draft. */
  async function seedDraft(
    orders: number[],
    opts: { unlocked?: boolean; draftCreatedAt?: string; archivedOnly?: boolean } = {},
  ) {
    fx = new Fixture(mods.db);
    const fac = await fx.user();
    const teamId = await fx.team(fac);
    if (opts.unlocked !== false) await fx.unlock(teamId, fac);
    const topicIds: string[] = [];
    for (const order of orders) {
      topicIds.push(
        await fx.topic(teamId, {
          displayOrder: order,
          name: `Name ${order} ${teamId.slice(-4)}`,
          prompt: `Prompt ${order} ${teamId.slice(-4)}?`,
          annotation: `Annotation ${order} ${teamId.slice(-4)}`,
        }),
      );
    }
    if (opts.archivedOnly) await fx.topic(teamId, { displayOrder: 1, status: "archived" });
    const draftId = await fx.session(teamId, fac, "draft", { createdAt: opts.draftCreatedAt });
    return { fac, teamId, draftId, topicIds };
  }

  // -------------------------------------------------------------------------
  // 3.5
  // -------------------------------------------------------------------------
  it("a newly created draft has room_opened_at NULL and zero session_topics rows", async () => {
    fx = new Fixture(mods.db);
    const fac = await fx.user();
    const teamId = await fx.team(fac);
    await fx.topic(teamId, { displayOrder: 1 });
    const app = await buildApp(mods, fac);
    const res = await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/draft` });
    await app.close();
    expect(res.statusCode).toBe(201);
    const draftId = res.json().sessionId as string;

    expect(await sessionRow(draftId)).toMatchObject({ status: "draft", room_opened_at: null });
    expect(await sessionTopicRows(mods.db, draftId)).toHaveLength(0);
  });

  it("a successful open writes status, room_opened_at, N rows, and one audit row with ordered ids and no topic text", async () => {
    const { fac, teamId, draftId } = await seedDraft([4, 1, 7]);
    const expectedOrder = await activeTopicIdsInOrder(mods.db, teamId);

    const res = await advance(fac, teamId, draftId);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sessionId: draftId, teamId, status: "lobby" });
    const row = await sessionRow(draftId);
    expect(row.status).toBe("lobby");
    expect(row.room_opened_at).toBeInstanceOf(Date);

    const rows = await sessionTopicRows(mods.db, draftId);
    expect(rows.map((r) => r.topic_id)).toEqual(expectedOrder);
    expect(rows.map((r) => r.display_order)).toEqual([1, 2, 3]);

    const audits = await openAuditRows(draftId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({ topic_count: 3, topic_ids: expectedOrder });
    const metadataText = JSON.stringify(audits[0]!.metadata);
    for (const r of rows) {
      expect(metadataText).not.toContain(r.topic_name);
      expect(metadataText).not.toContain(r.topic_prompt);
      expect(metadataText).not.toContain(r.topic_annotation!);
    }
  });

  it("zero active topics gives 409 NO_ACTIVE_TOPICS; the session stays draft with no rows and no audit row", async () => {
    const { fac, teamId, draftId } = await seedDraft([], { archivedOnly: true });

    const res = await advance(fac, teamId, draftId);

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({
      category: "precondition_failed",
      code: "NO_ACTIVE_TOPICS",
      message: NO_TOPICS_MESSAGE,
    });
    expect(await sessionRow(draftId)).toMatchObject({ status: "draft", room_opened_at: null });
    expect(await sessionTopicRows(mods.db, draftId)).toHaveLength(0);
    expect(await openAuditRows(draftId)).toHaveLength(0);
  });

  it("a forced snapshot failure rolls back: the draft is untouched and the 500 echoes no database text", async () => {
    const { fac, teamId, draftId, topicIds } = await seedDraft([1, 2]);
    // Data drift: a pre-existing row makes the snapshot hit UNIQUE (session_id, topic_id).
    await mods.db.query(
      `INSERT INTO session_topics (session_id, topic_id, display_order, topic_name, topic_prompt, vote_type)
       VALUES ($1, $2, 99, 'drift', 'drift?', 'finger')`,
      [draftId, topicIds[0]],
    );

    const res = await advance(fac, teamId, draftId);

    expect(res.statusCode).toBe(500);
    expect(res.json().error.category).toBe("internal_error");
    expect(res.body).not.toMatch(/duplicate|constraint|session_topics/i);
    expect(await sessionRow(draftId)).toMatchObject({ status: "draft", room_opened_at: null });
    expect((await sessionTopicRows(mods.db, draftId)).map((r) => r.topic_name)).toEqual(["drift"]);
    expect(await openAuditRows(draftId)).toHaveLength(0);
  });

  it("a non-draft session whose team has zero active topics gets 422, not 409", async () => {
    fx = new Fixture(mods.db);
    const fac = await fx.user();
    const teamId = await fx.team(fac);
    await fx.topic(teamId, { displayOrder: 1, status: "archived" });
    const lobbyId = await fx.session(teamId, fac, "lobby");

    const res = await advance(fac, teamId, lobbyId);

    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toBe("Session cannot be advanced from status 'lobby'.");
    expect(await sessionTopicRows(mods.db, lobbyId)).toHaveLength(0);
  });

  it("a non-creator on a zero-topic team gets 403, not 409", async () => {
    const { teamId, draftId } = await seedDraft([], { archivedOnly: true });
    const stranger = await fx.user();

    const res = await advance(stranger, teamId, draftId);

    expect(res.statusCode).toBe(403);
    expect(await sessionRow(draftId)).toMatchObject({ status: "draft" });
    expect(await openAuditRows(draftId)).toHaveLength(0);
  });

  it("one active topic is enough: one row at display_order 1", async () => {
    const { fac, teamId, draftId, topicIds } = await seedDraft([5]);

    const res = await advance(fac, teamId, draftId);

    expect(res.statusCode).toBe(200);
    const rows = await sessionTopicRows(mods.db, draftId);
    expect(rows.map((r) => [r.topic_id, r.display_order])).toEqual([[topicIds[0], 1]]);
  });

  it("a concurrent double /advance gives one success and one 422, no 5xx, one set of rows, one audit row", async () => {
    const { fac, teamId, draftId } = await seedDraft([1, 2, 3]);

    const results = await withTeamLockGate(mods, teamId, () => [
      advance(fac, teamId, draftId),
      advance(fac, teamId, draftId),
    ]);

    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 422]);
    const loser = results.find((r) => r.statusCode === 422)!;
    expect(loser.json().error.message).toBe("Session cannot be advanced from status 'lobby'.");
    expect(await sessionTopicRows(mods.db, draftId)).toHaveLength(3);
    expect(await openAuditRows(draftId)).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // 3.1 — live facilitator role
  // -------------------------------------------------------------------------
  it("a creator whose facilitator role was revoked gets 403; nothing is written but the denial audit row", async () => {
    const { fac, teamId, draftId } = await seedDraft([1, 2]);
    await mods.db.query(`UPDATE users SET global_role = 'engineer' WHERE id = $1`, [fac]);

    const res = await advance(fac, teamId, draftId);

    expect(res.statusCode).toBe(403);
    expect(res.json().error.category).toBe("forbidden");
    expect(await sessionRow(draftId)).toMatchObject({ status: "draft", room_opened_at: null });
    expect(await sessionTopicRows(mods.db, draftId)).toHaveLength(0);
    expect(await openAuditRows(draftId)).toHaveLength(0);
    const denials = await mods.db.query(
      `SELECT actor_global_role, team_id, metadata FROM audit_log
        WHERE operation = 'session.advance_denied_role' AND actor_user_id = $1`,
      [fac],
    );
    expect(denials.rows).toEqual([
      { actor_global_role: "engineer", team_id: teamId, metadata: { session_id: draftId } },
    ]);
  });

  // -------------------------------------------------------------------------
  // 3.6 — reorder racing room open
  // -------------------------------------------------------------------------
  it("a concurrent reorder and room open give either the full before order or the full after order, dense 1..N", async () => {
    const { fac, teamId, draftId } = await seedDraft([1, 2, 3, 4]);
    const before = await activeTopicIdsInOrder(mods.db, teamId);
    const after = [...before].reverse();
    const reorderer = await fx.user();

    const reorder = async () => {
      const app = await buildApp(mods, reorderer);
      try {
        return await app.inject({
          method: "PUT",
          url: `/api/v1/teams/${teamId}/topics/order`,
          payload: { orderedTopicIds: after },
        });
      } finally {
        await app.close();
      }
    };

    const [reorderRes, openRes] = await withTeamLockGate(mods, teamId, () => [reorder(), advance(fac, teamId, draftId)]);

    expect(reorderRes!.statusCode).toBe(200);
    expect(openRes!.statusCode).toBe(200);
    const rows = await sessionTopicRows(mods.db, draftId);
    expect(rows.map((r) => r.display_order)).toEqual([1, 2, 3, 4]);
    const snapshotted = rows.map((r) => r.topic_id);
    expect([JSON.stringify(before), JSON.stringify(after)]).toContain(JSON.stringify(snapshotted));
  });

  // -------------------------------------------------------------------------
  // 4.4 — POST /teams and the locked-team draft path
  // -------------------------------------------------------------------------
  it("POST /teams: the new team's lobby session has its copied defaults in canonical order, 1..N, with room_opened_at set", async () => {
    fx = new Fixture(mods.db);
    const fac = await fx.user();
    const app = await buildApp(mods, fac);
    const res = await app.inject({ method: "POST", url: "/api/v1/teams", payload: { name: `Room Open New Team ${fac}` } });
    await app.close();
    expect(res.statusCode).toBe(201);
    const { teamId, sessionId } = res.json() as { teamId: string; sessionId: string };
    fx.track(teamId);

    const copied = await mods.db.query<{ id: string; name: string; display_order: number }>(
      `SELECT id, name, display_order FROM topics WHERE team_id = $1 ORDER BY display_order`,
      [teamId],
    );
    expect(copied.rows.length).toBeGreaterThan(0);
    const rows = await sessionTopicRows(mods.db, sessionId);
    expect(rows.map((r) => r.topic_id)).toEqual(copied.rows.map((r) => r.id));
    expect(rows.map((r) => r.topic_name)).toEqual(copied.rows.map((r) => r.name));
    expect(rows.map((r) => r.display_order)).toEqual(copied.rows.map((_, i) => i + 1));
    expect(await sessionRow(sessionId)).toMatchObject({ status: "lobby" });
    expect((await sessionRow(sessionId)).room_opened_at).toBeInstanceOf(Date);

    const audit = await mods.db.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM audit_log WHERE operation = 'team.created_with_session' AND team_id = $1`,
      [teamId],
    );
    expect(audit.rows[0]!.metadata).toMatchObject({ topic_count: rows.length, topic_ids: rows.map((r) => r.topic_id) });
  });

  it("a team still under the customization lock that advances a draft gets its defaults in canonical order, 1..N", async () => {
    fx = new Fixture(mods.db);
    const fac = await fx.user();
    const teamId = await fx.team(fac);
    // The same copy POST /teams performs, without its lobby session.
    await mods.db.query(
      `INSERT INTO topics (team_id, name, prompt, vote_type, display_order, is_default, first_session_description)
       SELECT $1, name, prompt, vote_type, display_order, is_default, first_session_description
       FROM topics WHERE team_id = '00000000-0000-0000-0000-000000000001' AND is_default = true`,
      [teamId],
    );
    const app = await buildApp(mods, fac);
    const draft = await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/draft` });
    await app.close();
    expect(draft.statusCode).toBe(201);
    const draftId = draft.json().sessionId as string;

    const res = await advance(fac, teamId, draftId);

    expect(res.statusCode).toBe(200);
    const rows = await sessionTopicRows(mods.db, draftId);
    expect(rows.map((r) => r.topic_id)).toEqual(await activeTopicIdsInOrder(mods.db, teamId));
    expect(rows.map((r) => r.display_order)).toEqual(rows.map((_, i) => i + 1));
  });

  it("every lobby session created through either route has rows, including one at display_order 1", async () => {
    // Route 1: /advance.
    const { fac, teamId, draftId } = await seedDraft([3, 8]);
    expect((await advance(fac, teamId, draftId)).statusCode).toBe(200);
    // Route 2: POST /teams.
    const app = await buildApp(mods, fac);
    const created = await app.inject({ method: "POST", url: "/api/v1/teams", payload: { name: `Every Lobby ${fac}` } });
    await app.close();
    expect(created.statusCode).toBe(201);
    fx.track(created.json().teamId as string);

    const lobbySessions = await mods.db.query<{ id: string; has_first: boolean; n: number }>(
      `SELECT s.id,
              EXISTS (SELECT 1 FROM session_topics st WHERE st.session_id = s.id AND st.display_order = 1) AS has_first,
              (SELECT count(*)::int FROM session_topics st WHERE st.session_id = s.id) AS n
         FROM sessions s
        WHERE s.team_id = ANY($1::uuid[]) AND s.status = 'lobby'`,
      [fx.teamIds],
    );
    expect(lobbySessions.rows).toHaveLength(2);
    for (const row of lobbySessions.rows) {
      expect(row.n).toBeGreaterThan(0);
      expect(row.has_first).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // 5.1 / 5.3 — facilitator state count and the reorder hint
  // -------------------------------------------------------------------------
  it("draft facilitator state reports activeTopicCount as a number; a lobby state omits it", async () => {
    const { fac, teamId, draftId } = await seedDraft([1, 2, 3]);
    await fx.topic(teamId, { displayOrder: 9, status: "archived" });
    const app = await buildApp(mods, fac);
    try {
      const draftState = await app.inject({
        method: "GET",
        url: `/api/v1/teams/${teamId}/sessions/${draftId}/facilitator-state`,
      });
      expect(draftState.json().activeTopicCount).toBe(3);

      expect((await advance(fac, teamId, draftId)).statusCode).toBe(200);
      const lobbyState = await app.inject({
        method: "GET",
        url: `/api/v1/teams/${teamId}/sessions/${draftId}/facilitator-state`,
      });
      expect(lobbyState.json()).not.toHaveProperty("activeTopicCount");
    } finally {
      await app.close();
    }
  });

  async function reorderAs(userId: string, teamId: string) {
    const order = await activeTopicIdsInOrder(mods.db, teamId);
    const app = await buildApp(mods, userId);
    try {
      return await app.inject({
        method: "PUT",
        url: `/api/v1/teams/${teamId}/topics/order`,
        payload: { orderedTopicIds: [...order].reverse() },
      });
    } finally {
      await app.close();
    }
  }

  it("openSessionCreatedAt is the room-open time for a draft advanced on a later day", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { fac, teamId, draftId } = await seedDraft([1, 2], { draftCreatedAt: yesterday });
    expect((await advance(fac, teamId, draftId)).statusCode).toBe(200);
    const opened = await sessionRow(draftId);

    const res = await reorderAs(fac, teamId);

    expect(res.statusCode).toBe(200);
    expect(res.json().openSessionCreatedAt).toBe(opened.room_opened_at!.toISOString());
    expect(res.json().openSessionCreatedAt).not.toBe(opened.created_at.toISOString());
  });

  it("openSessionCreatedAt falls back to created_at when room_opened_at is NULL", async () => {
    fx = new Fixture(mods.db);
    const fac = await fx.user();
    const teamId = await fx.team(fac);
    await fx.unlock(teamId, fac);
    await fx.topic(teamId, { displayOrder: 1 });
    await fx.topic(teamId, { displayOrder: 2 });
    const lobbyId = await fx.session(teamId, fac, "lobby", { createdAt: "2026-09-29T10:00:00.000Z" });

    const res = await reorderAs(fac, teamId);

    expect(res.statusCode).toBe(200);
    expect(res.json().openSessionCreatedAt).toBe((await sessionRow(lobbyId)).created_at.toISOString());
  });

  it("a draft-only team gets null, and an application admin always gets null", async () => {
    const { fac, teamId, draftId } = await seedDraft([1, 2]);
    expect((await reorderAs(fac, teamId)).json().openSessionCreatedAt).toBeNull();

    expect((await advance(fac, teamId, draftId)).statusCode).toBe(200);
    const admin = await fx.user("application_admin");
    const adminRes = await reorderAs(admin, teamId);
    expect(adminRes.statusCode).toBe(200);
    expect(adminRes.json().openSessionCreatedAt).toBeNull();
  });
});
