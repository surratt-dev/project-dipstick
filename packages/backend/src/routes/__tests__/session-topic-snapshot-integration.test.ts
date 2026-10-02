import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { probeInfra, requireInfraOrThrow, loadModules, Fixture, sessionTopicRows, withTeamLockGate, buildApp } from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// Real Postgres coverage for the session topic snapshot helper and the
// canonical team lock (session-topics-snapshot-at-creation tasks.md 2.2,
// 2.3's malformed-id test, and 2.4's lock-gate self-test). Mock-level
// counterparts: src/sessions/__tests__/session-topic-snapshot.test.ts.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "session-topic-snapshot-integration.test.ts");

describe.skipIf(!infraUp)("snapshotSessionTopics / lockTeamTopics — real Postgres", () => {
  let mods: Mods;
  let fx: Fixture;

  beforeAll(async () => {
    mods = await loadModules();
  });

  afterEach(async () => {
    await fx?.cleanup();
  });

  /** Runs the helper the way a caller must: lock first, then snapshot, one transaction. */
  async function snapshotInTx(teamId: string, sessionId: string) {
    const client = await mods.db.connect();
    try {
      await client.query("BEGIN");
      await mods.snapshot.lockTeamTopics(client, teamId);
      const result = await mods.snapshot.snapshotSessionTopics(client, sessionId);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async function seedTeam(orders: number[], extra: Array<{ displayOrder: number; status: "archived" }> = []) {
    fx = new Fixture(mods.db);
    const fac = await fx.user();
    const teamId = await fx.team(fac);
    const topicIds: string[] = [];
    for (const order of orders) topicIds.push(await fx.topic(teamId, { displayOrder: order }));
    for (const e of extra) await fx.topic(teamId, { displayOrder: e.displayOrder, status: e.status });
    const sessionId = await fx.session(teamId, fac, "lobby");
    return { fac, teamId, sessionId, topicIds };
  }

  it("renumbers gaps {1,3,4} to {1,2,3}", async () => {
    const { teamId, sessionId, topicIds } = await seedTeam([1, 3, 4]);
    const { topicIds: snapshotted } = await snapshotInTx(teamId, sessionId);
    const rows = await sessionTopicRows(mods.db, sessionId);
    expect(rows.map((r) => r.display_order)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.topic_id)).toEqual(topicIds);
    expect(snapshotted).toEqual(topicIds);
    expect(rows.every((r) => r.status === "waiting")).toBe(true);
  });

  it("renumbers {2,3} to {1,2}", async () => {
    const { teamId, sessionId } = await seedTeam([2, 3]);
    await snapshotInTx(teamId, sessionId);
    expect((await sessionTopicRows(mods.db, sessionId)).map((r) => r.display_order)).toEqual([1, 2]);
  });

  it("excludes archived topics and includes custom topics; copies name, prompt, vote type, and annotation", async () => {
    fx = new Fixture(mods.db);
    const fac = await fx.user();
    const teamId = await fx.team(fac);
    const a = await fx.topic(teamId, { displayOrder: 1, name: "Alpha", prompt: "Alpha?", annotation: "Our alpha" });
    await fx.topic(teamId, { displayOrder: 2, status: "archived", name: "Archived" });
    // A custom topic is any non-default topic (Fixture.topic writes is_default = false).
    const c = await fx.topic(teamId, { displayOrder: 3, name: "Custom", voteType: "roman" });
    const sessionId = await fx.session(teamId, fac, "lobby");

    await snapshotInTx(teamId, sessionId);

    const rows = await sessionTopicRows(mods.db, sessionId);
    expect(rows.map((r) => r.topic_id)).toEqual([a, c]);
    expect(rows[0]).toMatchObject({ topic_name: "Alpha", topic_prompt: "Alpha?", topic_annotation: "Our alpha", vote_type: "finger" });
    expect(rows[1]).toMatchObject({ topic_name: "Custom", topic_annotation: null, vote_type: "roman", display_order: 2 });
  });

  it("throws NoActiveTopicsError and inserts nothing when the team has zero active topics", async () => {
    const { teamId, sessionId } = await seedTeam([], [{ displayOrder: 1, status: "archived" }]);
    await expect(snapshotInTx(teamId, sessionId)).rejects.toBeInstanceOf(mods.snapshot.NoActiveTopicsError);
    expect(await sessionTopicRows(mods.db, sessionId)).toHaveLength(0);
  });

  it("never gives team A's session team B's active topics", async () => {
    fx = new Fixture(mods.db);
    const fac = await fx.user();
    const teamA = await fx.team(fac);
    const teamB = await fx.team(fac);
    const aTopic = await fx.topic(teamA, { displayOrder: 1 });
    await fx.topic(teamB, { displayOrder: 1 });
    await fx.topic(teamB, { displayOrder: 2 });
    const sessionA = await fx.session(teamA, fac, "lobby");

    // Even a caller that locks the wrong team cannot redirect the source team.
    await snapshotInTx(teamB, sessionA);
    expect((await sessionTopicRows(mods.db, sessionA)).map((r) => r.topic_id)).toEqual([aTopic]);
  });

  it("an upper-case and a lower-case team id take the same lock", async () => {
    const { teamId } = await seedTeam([1]);
    const holder = await mods.db.connect();
    const other = await mods.db.connect();
    try {
      await holder.query("BEGIN");
      await mods.snapshot.lockTeamTopics(holder, teamId.toUpperCase());
      await other.query("BEGIN");
      // The lower-case key is the same lock, so a non-blocking try fails.
      const tried = await other.query<{ ok: boolean }>(
        `SELECT pg_try_advisory_xact_lock(${mods.snapshot.TEAM_TOPICS_LOCK_KEY_SQL}) AS ok`,
        [teamId.toLowerCase()],
      );
      expect(tried.rows[0]!.ok).toBe(false);
    } finally {
      await holder.query("ROLLBACK");
      await other.query("ROLLBACK");
      holder.release();
      other.release();
    }
  });

  // -------------------------------------------------------------------------
  // tasks.md 2.3, and implementation review M1/MF1 — a malformed, non-UUID
  // id is rejected at the route boundary (before the authorization query and
  // the lock, whose ::uuid casts would otherwise raise 22P02) and never
  // surfaces as a 500.
  // -------------------------------------------------------------------------
  it("rejects a non-UUID teamId or sessionId on every route that queries it, without a 500", async () => {
    fx = new Fixture(mods.db);
    const fac = await fx.user();
    const app = await buildApp(mods, fac);
    const topicId = "11111111-1111-4111-8111-111111111111";
    const teamId = await fx.team(fac);
    const bad = "not-a-uuid";
    const teamRoutes = await Promise.all([
      app.inject({ method: "POST", url: `/api/v1/teams/${bad}/topics`, payload: { name: "X", prompt: "Y?", voteType: "finger" } }),
      app.inject({ method: "DELETE", url: `/api/v1/teams/${bad}/topics/${topicId}?confirm=true` }),
      app.inject({ method: "POST", url: `/api/v1/teams/${bad}/topics/${topicId}/restore`, payload: {} }),
      app.inject({ method: "PUT", url: `/api/v1/teams/${bad}/topics/order`, payload: { orderedTopicIds: [topicId] } }),
      app.inject({ method: "PUT", url: `/api/v1/teams/${bad}/topics/${topicId}/annotation`, payload: { annotation: "x" } }),
      app.inject({ method: "GET", url: `/api/v1/teams/${bad}/topics/all` }),
    ]);
    for (const res of teamRoutes) {
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("TEAM_NOT_FOUND");
    }
    const draft = await app.inject({ method: "POST", url: `/api/v1/teams/${bad}/sessions/draft` });
    expect(draft.statusCode).toBe(404);
    expect(draft.json().error.category).toBe("not_found");
    const advance = await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/${bad}/advance` });
    expect(advance.statusCode).toBe(404);
    expect(advance.json().error.message).toBe("Session not found.");
    expect(advance.body).not.toMatch(/invalid input syntax|uuid/i);
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Implementation review M1/MF1 — Postgres accepts other spellings of a
  // UUID and resolves them to the same team. None of them may get a
  // facilitator who is a MEMBER of the team past the member denial: each is
  // answered 404 at the route boundary, and nothing is written.
  // -------------------------------------------------------------------------
  function altSpellings(id: string): Record<string, string> {
    return {
      hyphenless: id.replace(/-/g, ""),
      braced: `{${id}}`,
      regrouped: `${id.slice(0, 8)}-${id.slice(9, 13)}${id.slice(14, 18)}-${id.slice(19, 23)}${id.slice(24, 28)}-${id.slice(28)}`,
    };
  }

  it("a member facilitator's canonical team id is denied on POST /draft and GET /topics/all (control)", async () => {
    fx = new Fixture(mods.db);
    const owner = await fx.user();
    const memberFac = await fx.user();
    const teamId = await fx.team(owner);
    await fx.member(teamId, memberFac);
    const app = await buildApp(mods, memberFac);
    const draft = await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/draft` });
    expect(draft.statusCode).toBe(403);
    const all = await app.inject({ method: "GET", url: `/api/v1/teams/${teamId}/topics/all` });
    expect(all.statusCode).toBe(403);
    await app.close();
  });

  it.each(["hyphenless", "braced", "regrouped"])(
    "a member facilitator using the %s spelling of their own team id gets past no member denial",
    async (form) => {
      fx = new Fixture(mods.db);
      const owner = await fx.user();
      const memberFac = await fx.user();
      const teamId = await fx.team(owner);
      await fx.member(teamId, memberFac);
      await fx.unlock(teamId, owner);
      const topicId = await fx.topic(teamId, { displayOrder: 1 });
      const archivedId = await fx.topic(teamId, { displayOrder: 2, status: "archived" });
      const spelled = altSpellings(teamId)[form]!;
      // Sanity: Postgres really does resolve this spelling to the team.
      const resolves = await mods.db.query(`SELECT 1 FROM teams WHERE id = $1`, [spelled]);
      expect(resolves.rowCount).toBe(1);

      const app = await buildApp(mods, memberFac);
      const sessionsBefore = await mods.db.query(`SELECT count(*)::int AS n FROM sessions WHERE team_id = $1`, [teamId]);
      const topicsBefore = await mods.db.query(
        `SELECT id, status, display_order, team_annotation FROM topics WHERE team_id = $1 ORDER BY id`,
        [teamId],
      );

      const responses = [
        await app.inject({ method: "POST", url: `/api/v1/teams/${spelled}/sessions/draft` }),
        await app.inject({ method: "GET", url: `/api/v1/teams/${spelled}/topics/all` }),
        await app.inject({ method: "POST", url: `/api/v1/teams/${spelled}/topics`, payload: { name: "X", prompt: "Y?", voteType: "finger" } }),
        await app.inject({ method: "DELETE", url: `/api/v1/teams/${spelled}/topics/${topicId}?confirm=true` }),
        await app.inject({ method: "POST", url: `/api/v1/teams/${spelled}/topics/${archivedId}/restore`, payload: {} }),
        await app.inject({ method: "PUT", url: `/api/v1/teams/${spelled}/topics/order`, payload: { orderedTopicIds: [archivedId, topicId] } }),
        await app.inject({ method: "PUT", url: `/api/v1/teams/${spelled}/topics/${topicId}/annotation`, payload: { annotation: "x" } }),
      ];
      for (const res of responses) {
        expect([403, 404]).toContain(res.statusCode);
        expect(res.body).not.toContain(teamId);
      }
      // GET /topics/all returned no team content.
      expect(responses[1]!.json().teamName).toBeUndefined();

      const sessionsAfter = await mods.db.query(`SELECT count(*)::int AS n FROM sessions WHERE team_id = $1`, [teamId]);
      expect(sessionsAfter.rows[0].n).toBe(sessionsBefore.rows[0].n);
      const topicsAfter = await mods.db.query(
        `SELECT id, status, display_order, team_annotation FROM topics WHERE team_id = $1 ORDER BY id`,
        [teamId],
      );
      expect(topicsAfter.rows).toEqual(topicsBefore.rows);
      const audit = await mods.db.query(
        `SELECT operation FROM audit_log WHERE actor_user_id = $1 AND operation <> 'session.draft_denied_membership_conflict'`,
        [memberFac],
      );
      expect(audit.rows).toEqual([]);
      await app.close();
    },
  );

  // -------------------------------------------------------------------------
  // tasks.md 2.4 — the lock-gate helper's self-test: with nothing queued on
  // the lock, it fails on timeout rather than passing.
  // -------------------------------------------------------------------------
  it("withTeamLockGate fails on timeout when no backend waits on the lock", async () => {
    const { teamId } = await seedTeam([1]);
    await expect(
      withTeamLockGate(mods, teamId, () => [Promise.resolve("never queued")], { timeoutMs: 200 }),
    ).rejects.toThrow(/timed out/);
  });

  it("withTeamLockGate releases once two backends are queued on the production key", async () => {
    const { teamId } = await seedTeam([1]);
    const waitOnLock = async () => {
      const c = await mods.db.connect();
      try {
        await c.query("BEGIN");
        await mods.snapshot.lockTeamTopics(c, teamId);
        await c.query("COMMIT");
        return "acquired";
      } finally {
        c.release();
      }
    };
    await expect(withTeamLockGate(mods, teamId, () => [waitOnLock(), waitOnLock()])).resolves.toEqual([
      "acquired",
      "acquired",
    ]);
  });
});
