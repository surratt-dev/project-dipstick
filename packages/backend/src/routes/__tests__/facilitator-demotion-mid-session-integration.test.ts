import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { probeInfra, requireInfraOrThrow, loadModules, buildApp, Fixture } from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// configurable-oidc-role-map (#243), task 2.3 — security deferred decision 2.
//
// With a configurable role map, a group or OIDC_ROLE_MAP change plus a
// re-sign-in can strip a facilitator's users.global_role while their session
// is live. This file PINS the observed behaviour of each facilitator-only
// session action after that demotion; it does not change any handler. Any
// action that still succeeds is recorded in security-review.md
// "Implementation findings" and folded into the live-session demotion
// follow-up (proposal follow-ups 1/10) rather than changed here.
//
// Each case: a facilitator drives a fresh session to the state the action
// needs, the facilitator's global_role is set to 'engineer' (the demotion a
// re-sign-in would write), then the facilitator calls the action.
// ---------------------------------------------------------------------------

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "facilitator-demotion-mid-session-integration.test.ts");

describe.skipIf(!infraUp)("mid-session facilitator demotion (real Postgres, task 2.3)", () => {
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

  async function seed(topicCount = 2) {
    fx = new Fixture(mods.db);
    const fac = await fx.user("facilitator");
    const voter = await fx.user("engineer");
    const teamId = await fx.team(fac);
    await fx.member(teamId, voter);
    for (let i = 1; i <= topicCount; i++) await fx.topic(teamId, { displayOrder: i });
    const sessionId = await fx.session(teamId, fac, "draft");
    const facApp = await buildApp(mods, fac);
    apps.push(facApp);
    const voterApp = await buildApp(mods, voter);
    apps.push(voterApp);
    return { fac, voter, teamId, sessionId, facApp, voterApp };
  }

  type Ctx = Awaited<ReturnType<typeof seed>>;

  const post = (app: FastifyInstance, url: string) => app.inject({ method: "POST", url });

  async function toLobby(c: Ctx) {
    expect((await post(c.facApp, `/api/v1/teams/${c.teamId}/sessions/${c.sessionId}/advance`)).statusCode).toBe(200);
  }
  async function toPreSession(c: Ctx) {
    await toLobby(c);
    expect((await post(c.voterApp, `/api/v1/sessions/${c.sessionId}/participants`)).statusCode).toBe(201);
    expect((await post(c.facApp, `/api/v1/sessions/${c.sessionId}/start`)).statusCode).toBe(200);
  }
  async function toVoting(c: Ctx) {
    await toPreSession(c);
    const res = await post(c.facApp, `/api/v1/sessions/${c.sessionId}/begin-voting`);
    expect(res.statusCode).toBe(200);
    const sessionTopicId = res.json().currentTopic.sessionTopicId as string;
    const vote = await c.voterApp.inject({
      method: "POST",
      url: `/api/v1/sessions/${c.sessionId}/topics/${sessionTopicId}/lock-in`,
      payload: { voteValue: 3, voteType: "finger" },
    });
    expect(vote.statusCode).toBe(201);
  }
  async function toRevealed(c: Ctx) {
    await toVoting(c);
    expect((await post(c.facApp, `/api/v1/teams/${c.teamId}/sessions/${c.sessionId}/reveal`)).statusCode).toBe(200);
  }

  async function demote(userId: string) {
    await mods.db.query(`UPDATE users SET global_role = 'engineer' WHERE id = $1`, [userId]);
  }

  async function sessionStatus(sessionId: string) {
    return (await mods.db.query<{ status: string }>(`SELECT status FROM sessions WHERE id = $1`, [sessionId])).rows[0]!.status;
  }

  // Observed results are pinned below. "refused" = the live global_role is
  // re-read and the action is denied; "succeeds" = the handler gates on
  // sessions.facilitator_id only, so the demoted facilitator can still act.
  it("advance (draft -> lobby) is refused after demotion (live role re-check)", async () => {
    const c = await seed();
    await demote(c.fac);
    const res = await post(c.facApp, `/api/v1/teams/${c.teamId}/sessions/${c.sessionId}/advance`);
    expect(res.statusCode).toBe(403);
    expect(await sessionStatus(c.sessionId)).toBe("draft");
  });

  it("start (lobby -> pre_session): observed result pinned", async () => {
    const c = await seed();
    await toLobby(c);
    expect((await post(c.voterApp, `/api/v1/sessions/${c.sessionId}/participants`)).statusCode).toBe(201);
    await demote(c.fac);
    const res = await post(c.facApp, `/api/v1/sessions/${c.sessionId}/start`);
    expect({ status: res.statusCode, session: await sessionStatus(c.sessionId) }).toEqual(OBSERVED.start);
  });

  it("begin-voting (pre_session -> active): observed result pinned", async () => {
    const c = await seed();
    await toPreSession(c);
    await demote(c.fac);
    const res = await post(c.facApp, `/api/v1/sessions/${c.sessionId}/begin-voting`);
    expect({ status: res.statusCode, session: await sessionStatus(c.sessionId) }).toEqual(OBSERVED.beginVoting);
  });

  it("reveal: observed result pinned", async () => {
    const c = await seed();
    await toVoting(c);
    await demote(c.fac);
    const res = await post(c.facApp, `/api/v1/teams/${c.teamId}/sessions/${c.sessionId}/reveal`);
    expect({ status: res.statusCode, session: await sessionStatus(c.sessionId) }).toEqual(OBSERVED.reveal);
  });

  it("topics/advance: observed result pinned", async () => {
    const c = await seed();
    await toRevealed(c);
    await demote(c.fac);
    const res = await post(c.facApp, `/api/v1/teams/${c.teamId}/sessions/${c.sessionId}/topics/advance`);
    expect({ status: res.statusCode, session: await sessionStatus(c.sessionId) }).toEqual(OBSERVED.topicsAdvance);
  });

  it("complete (wrap_up -> complete): observed result pinned", async () => {
    // One topic, so advancing past its reveal reaches wrap_up.
    const c = await seed(1);
    await toRevealed(c);
    expect((await post(c.facApp, `/api/v1/teams/${c.teamId}/sessions/${c.sessionId}/topics/advance`)).statusCode).toBe(200);
    expect(await sessionStatus(c.sessionId)).toBe("wrap_up");
    await demote(c.fac);
    const res = await post(c.facApp, `/api/v1/teams/${c.teamId}/sessions/${c.sessionId}/complete`);
    expect({ status: res.statusCode, session: await sessionStatus(c.sessionId) }).toEqual(OBSERVED.complete);
  });

  it("facilitator-state (read): observed result pinned", async () => {
    const c = await seed();
    await toVoting(c);
    await demote(c.fac);
    const res = await c.facApp.inject({
      method: "GET",
      url: `/api/v1/teams/${c.teamId}/sessions/${c.sessionId}/facilitator-state`,
    });
    expect(res.statusCode).toBe(OBSERVED.facilitatorState);
  });

  it("participants-roster (read, facilitator grant): observed result pinned", async () => {
    const c = await seed();
    await toPreSession(c);
    await demote(c.fac);
    const res = await c.facApp.inject({ method: "GET", url: `/api/v1/sessions/${c.sessionId}/participants-roster` });
    expect(res.statusCode).toBe(OBSERVED.roster);
  });
});

// Observed at commit c00b496 + this change (2026-10-05, local docker compose
// Postgres/Redis). Every live-session action after "advance" gates on
// sessions.facilitator_id (and reads global_role only for the audit row), so
// a demoted facilitator can still run the session they started. Recorded in
// security-review.md "Implementation findings" and follow-up FU-1/FU-10; NOT
// changed by #243. If a later change adds a live role re-check to any of
// these, update the pinned value here deliberately.
const OBSERVED = {
  start: { status: 200, session: "pre_session" },
  beginVoting: { status: 200, session: "active" },
  reveal: { status: 200, session: "active" },
  topicsAdvance: { status: 200, session: "active" },
  complete: { status: 200, session: "complete" },
  facilitatorState: 200,
  roster: 200,
};
