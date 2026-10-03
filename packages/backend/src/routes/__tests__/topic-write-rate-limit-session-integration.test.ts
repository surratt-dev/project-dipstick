import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  probeInfra,
  requireInfraOrThrow,
  loadModules,
  buildApp,
  Fixture,
  seedTopicWriteWindows,
  topicWriteWindowState,
} from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// harden-topic-write-endpoints (#184) task 5.7, behavioural half — spec "An
// exhausted budget does not block a session". A facilitator whose topic-write
// windows are pre-seeded (ZADD, not HTTP loops) to 100% of BOTH limits can
// still open the room and advance the session: room open takes the same
// per-team topic lock as topic writes, but never the limiter. Kept together
// with the import-graph allow-list in topic-write-rate-limit-structural.test.ts
// (Decision 8; neither replaces the other).
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "topic-write-rate-limit-session-integration.test.ts");

describe.skipIf(!infraUp)("an exhausted topic-write budget never blocks a session (#184 5.7)", () => {
  let mods: Mods;
  let fx: Fixture;

  beforeAll(async () => {
    mods = await loadModules();
  });

  afterEach(async () => {
    await fx?.cleanup();
  });

  it("room open, start and begin-voting all succeed with both windows at 100%", async () => {
    fx = new Fixture(mods.db);
    const fac = await fx.user();
    const participant = await fx.user("engineer");
    const teamId = await fx.team(fac);
    await fx.member(teamId, participant);
    await fx.unlock(teamId, fac);
    const topic = await fx.topic(teamId, { displayOrder: 1 });
    const draftId = await fx.session(teamId, fac, "draft");

    const app = await buildApp(mods, fac);
    const at = Date.now() - 1_000;
    await seedTopicWriteWindows(fac, {
      burst: Array.from({ length: 120 }, () => at),
      daily: Array.from({ length: 400 }, () => at),
    });

    try {
      // The budget really is exhausted: a topic write is limited.
      const write = await app.inject({
        method: "PUT",
        url: `/api/v1/teams/${teamId}/topics/${topic}/annotation`,
        payload: { annotation: "x" },
      });
      expect(write.statusCode).toBe(429);

      const open = await app.inject({ method: "POST", url: `/api/v1/teams/${teamId}/sessions/${draftId}/advance` });
      expect(open.statusCode).toBe(200);
      await mods.db.query(`INSERT INTO session_participants (session_id, user_id) VALUES ($1, $2)`, [draftId, participant]);
      const start = await app.inject({ method: "POST", url: `/api/v1/sessions/${draftId}/start` });
      expect(start.statusCode).toBe(200);
      const begin = await app.inject({ method: "POST", url: `/api/v1/sessions/${draftId}/begin-voting` });
      expect(begin.statusCode).toBe(200);
    } finally {
      await app.close();
    }

    // Session runtime consumed nothing: still exactly at the limits.
    const state = await topicWriteWindowState(fac);
    expect([state.burst, state.daily]).toEqual([120, 400]);
  });
});
