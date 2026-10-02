import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { probeInfra, requireInfraOrThrow, loadModules, buildApp, Fixture } from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// R5 — the registration snapshot's id-space, against real Postgres
// (session-topics-snapshot-at-creation tasks.md 6.3, design.md Decision 8).
//
// The mock-level tests (realtime/__tests__/session-registration-snapshot.
// test.ts) mock db.query, which is exactly why the topics.id-vs-
// session_topics.id join bug shipped. This file seeds a session through the
// real snapshot (room open), runs real begin-voting, inserts a vote, and
// calls buildSessionRegistrationSnapshot directly.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "registration-snapshot-integration.test.ts");

describe.skipIf(!infraUp)("buildSessionRegistrationSnapshot — real Postgres (R5)", () => {
  let mods: Mods;
  let fx: Fixture;

  beforeAll(async () => {
    mods = await loadModules();
  });

  afterEach(async () => {
    await fx?.cleanup();
  });

  it("resolves the current topic by topics.id and reports the voter's lock-in against the begin-voting sessionTopicId", async () => {
    fx = new Fixture(mods.db);
    const fac = await fx.user();
    const voter = await fx.user("engineer");
    const bystander = await fx.user("engineer");
    const teamId = await fx.team(fac);
    await fx.topic(teamId, { displayOrder: 1 });
    await fx.topic(teamId, { displayOrder: 2 });
    const sessionId = await fx.session(teamId, fac, "draft");

    const app = await buildApp(mods, fac);
    try {
      expect((await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/${sessionId}/advance` })).statusCode).toBe(200);

      // Lobby: no current topic yet.
      expect(await mods.buildSessionRegistrationSnapshot(voter, sessionId)).toEqual({
        sessionId,
        sessionStatus: "lobby",
        currentTopic: null,
        hasLockedInVote: false,
      });

      expect((await app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/start` })).statusCode).toBe(200);
      const beginVoting = await app.inject({ method: "POST", url: `/api/v1/sessions/${sessionId}/begin-voting` });
      expect(beginVoting.statusCode).toBe(200);
      const sessionTopicId = beginVoting.json().currentTopic.sessionTopicId as string;

      await mods.db.query(
        `INSERT INTO votes (session_id, session_topic_id, voter_id, vote_value, vote_type, revealed_at)
         VALUES ($1, $2, $3, 3, 'finger', NOW())`,
        [sessionId, sessionTopicId, voter],
      );

      const lockedIn = await mods.buildSessionRegistrationSnapshot(voter, sessionId);
      expect(lockedIn).toEqual({
        sessionId,
        sessionStatus: "active",
        currentTopic: { sessionTopicId, status: "voting" },
        hasLockedInVote: true,
      });

      const notLockedIn = await mods.buildSessionRegistrationSnapshot(bystander, sessionId);
      expect(notLockedIn?.currentTopic).toEqual({ sessionTopicId, status: "voting" });
      expect(notLockedIn?.hasLockedInVote).toBe(false);
    } finally {
      await app.close();
    }
  });
});
