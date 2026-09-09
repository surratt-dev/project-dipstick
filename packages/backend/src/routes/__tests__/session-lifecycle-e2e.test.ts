import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// session-lifecycle-transitions tasks.md 8.1-8.3 — full session run-through
//
// Exercises every transition this change adds, in sequence, against a
// single Fastify app registering both route modules this change touches
// (facilitator-sessions.ts and sessions.ts), the same way the production
// app registers them together. Mirrors this codebase's established
// mocked-pg-client testing convention (see facilitator-sessions.test.ts,
// sessions.test.ts, teams.test.ts) — there is no real Postgres/Redis in
// this test environment; each step's mock responses encode the state the
// PREVIOUS step committed, so the sequence reads as one coherent narrative
// rather than nine independent unit tests.
// ---------------------------------------------------------------------------

const mockDbQuery = vi.fn();
const mockDbConnect = vi.fn();
const mockEmitAuditEvent = vi.fn();
const mockPublishSessionStateChange = vi.fn();
const mockPublishVoteRevealed = vi.fn();
const mockPublishTopicHistoryUpdate = vi.fn();
const mockPublishVoteReadinessUpdate = vi.fn();

vi.mock("../../db.js", () => ({
  db: {
    query: (...args: unknown[]) => mockDbQuery(...args),
    connect: () => mockDbConnect(),
  },
}));
vi.mock("../../auth/audit-logger.js", () => ({
  emitAuditEvent: (...args: unknown[]) => mockEmitAuditEvent(...args),
}));
vi.mock("../../realtime/ws-pubsub.js", () => ({
  publishSessionStateChange: (...args: unknown[]) => mockPublishSessionStateChange(...args),
  publishVoteRevealed: (...args: unknown[]) => mockPublishVoteRevealed(...args),
  publishTopicHistoryUpdate: (...args: unknown[]) => mockPublishTopicHistoryUpdate(...args),
  publishVoteReadinessUpdate: (...args: unknown[]) => mockPublishVoteReadinessUpdate(...args),
}));
vi.mock("../../config.js", () => ({
  config: {
    DATABASE_URL: "postgres://test",
    REDIS_URL: "redis://test",
    SESSION_SECRET: "test",
    OIDC_ISSUER: "https://idp.example.com",
    OIDC_CLIENT_ID: "client-id",
    OIDC_CLIENT_SECRET: "client-secret",
    OIDC_REDIRECT_URI: "http://localhost:3000/auth/callback",
    NODE_ENV: "test",
  },
}));

import Fastify from "fastify";
import { facilitatorSessionRoutes } from "../facilitator-sessions.js";
import { sessionRoutes } from "../sessions.js";

function makeMockClient(queryResponses: Array<{ rows: unknown[]; rowCount?: number }> = []) {
  let callIndex = 0;
  const mockClientQuery = vi.fn((..._args: unknown[]) => {
    const resp = queryResponses[callIndex] ?? { rows: [] };
    callIndex++;
    return Promise.resolve(resp);
  });
  return { query: mockClientQuery, release: vi.fn() };
}

function buildApp(userId: string) {
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
  });
  app.register(facilitatorSessionRoutes);
  app.register(sessionRoutes);
  return app.ready().then(() => app);
}

describe("session-lifecycle-transitions — full session run-through (tasks.md 8.1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("8.1: lobby -> pre_session -> active -> lock-in -> reveal -> advance -> lock-in -> reveal -> advance(wrap_up) -> complete", async () => {
    const facilitatorApp = await buildApp("facilitator-1");
    const participantApp = await buildApp("participant-1");

    // -----------------------------------------------------------------
    // Step 1 — SESSION-004: lobby -> pre_session
    // -----------------------------------------------------------------
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ id: "sess-1", team_id: "team-1", facilitator_id: "facilitator-1", status: "lobby" }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      .mockResolvedValueOnce({ rows: [{ value: "2" }] }) // staleness threshold
      .mockResolvedValueOnce({ rows: [] }); // no open action items
    mockDbConnect.mockResolvedValueOnce(
      makeMockClient([
        { rows: [] }, // BEGIN
        { rows: [{ started_at: new Date("2026-09-08T10:00:00Z") }] }, // UPDATE RETURNING
        { rows: [] }, // INSERT audit_log
        { rows: [] }, // COMMIT
      ]),
    );

    const startRes = await facilitatorApp.inject({ method: "POST", url: "/api/v1/sessions/sess-1/start" });
    expect(startRes.statusCode).toBe(200);
    expect(startRes.json().status).toBe("pre_session");

    // -----------------------------------------------------------------
    // Step 2 — SESSION-005: pre_session -> active, topic-1 -> voting
    // -----------------------------------------------------------------
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1", team_id: "team-1", facilitator_id: "facilitator-1",
          status: "pre_session", is_first_session: false,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });
    mockDbConnect.mockResolvedValueOnce(
      makeMockClient([
        { rows: [] }, // BEGIN
        {
          rows: [{
            id: "st-1", topic_id: "topic-1", topic_name: "Topic A",
            topic_prompt: "Prompt A", vote_type: "finger", first_session_description: null,
          }],
        }, // SELECT first topic
        { rows: [{ voting_started_at: new Date("2026-09-08T10:05:00Z") }] }, // UPDATE sessions RETURNING
        { rows: [] }, // UPDATE session_topics
        { rows: [] }, // INSERT audit_log
        { rows: [] }, // COMMIT
      ]),
    );

    const beginVotingRes = await facilitatorApp.inject({ method: "POST", url: "/api/v1/sessions/sess-1/begin-voting" });
    expect(beginVotingRes.statusCode).toBe(200);
    expect(beginVotingRes.json().status).toBe("active");
    expect(beginVotingRes.json().currentTopic.sessionTopicId).toBe("st-1");

    // -----------------------------------------------------------------
    // Step 3 — vote lock-in on topic-1 (Group 2's race-fix check passes:
    // topic is 'voting')
    // -----------------------------------------------------------------
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ session_status: "active", team_id: "team-1", topic_status: "voting" }] })
      .mockResolvedValueOnce({ rows: [{ global_role: "engineer", membership_role: "participant" }] })
      .mockResolvedValueOnce({ rows: [{ id: "sp-1" }] });
    mockDbConnect.mockResolvedValueOnce(
      makeMockClient([
        { rows: [] }, // BEGIN
        { rows: [{ status: "voting" }] }, // SELECT ... FOR UPDATE
        { rows: [{ id: "vote-1" }] }, // INSERT votes
        { rows: [] }, // INSERT audit_log
        { rows: [] }, // COMMIT
      ]),
    );

    const lockInRes1 = await participantApp.inject({
      method: "POST",
      url: "/api/v1/sessions/sess-1/topics/st-1/lock-in",
      payload: { voteValue: 3, voteType: "finger" },
    });
    expect(lockInRes1.statusCode).toBe(201);

    // -----------------------------------------------------------------
    // Step 4 — reveal topic-1: voting -> revealed
    // -----------------------------------------------------------------
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1", team_id: "team-1", facilitator_id: "facilitator-1",
          status: "active", current_topic_id: "topic-1",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });
    mockDbConnect.mockResolvedValueOnce(
      makeMockClient([
        { rows: [] }, // BEGIN
        { rows: [{ id: "st-1", revealed_at: new Date("2026-09-08T10:10:00Z") }], rowCount: 1 }, // conditional UPDATE
        { rows: [] }, // INSERT audit_log (reveal_triggered)
        { rows: [] }, // COMMIT
      ]),
    );

    const revealRes1 = await facilitatorApp.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/sess-1/reveal",
    });
    expect(revealRes1.statusCode).toBe(200);
    expect(mockPublishVoteRevealed).toHaveBeenCalledTimes(1);

    // -----------------------------------------------------------------
    // Step 5 — SESSION-012: advance topic-1 (complete) -> topic-2 (voting),
    // session stays active
    // -----------------------------------------------------------------
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1", team_id: "team-1", facilitator_id: "facilitator-1",
          status: "active", current_topic_id: "topic-1",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });
    mockDbConnect.mockResolvedValueOnce(
      makeMockClient([
        { rows: [] }, // BEGIN
        { rows: [{ id: "st-1", topic_name: "Topic A", completed_at: new Date("2026-09-08T10:15:00Z") }], rowCount: 1 },
        {
          rows: [{
            id: "st-2", topic_id: "topic-2", topic_name: "Topic B",
            topic_prompt: "Prompt B", vote_type: "finger",
          }],
        }, // next-topic lookup
        { rows: [] }, // UPDATE session_topics SET voting
        { rows: [] }, // UPDATE sessions SET current_topic_id
        { rows: [] }, // INSERT audit_log (topic_advanced)
        { rows: [] }, // COMMIT
      ]),
    );

    const advanceRes1 = await facilitatorApp.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/sess-1/topics/advance",
    });
    expect(advanceRes1.statusCode).toBe(200);
    expect(advanceRes1.json().status).toBe("active");
    expect(advanceRes1.json().currentTopic.sessionTopicId).toBe("st-2");
    expect(mockPublishTopicHistoryUpdate).toHaveBeenCalledTimes(1);

    // -----------------------------------------------------------------
    // Step 6 — vote lock-in on topic-2
    // -----------------------------------------------------------------
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ session_status: "active", team_id: "team-1", topic_status: "voting" }] })
      .mockResolvedValueOnce({ rows: [{ global_role: "engineer", membership_role: "participant" }] })
      .mockResolvedValueOnce({ rows: [{ id: "sp-1" }] });
    mockDbConnect.mockResolvedValueOnce(
      makeMockClient([
        { rows: [] },
        { rows: [{ status: "voting" }] },
        { rows: [{ id: "vote-2" }] },
        { rows: [] },
        { rows: [] },
      ]),
    );

    const lockInRes2 = await participantApp.inject({
      method: "POST",
      url: "/api/v1/sessions/sess-1/topics/st-2/lock-in",
      payload: { voteValue: 2, voteType: "finger" },
    });
    expect(lockInRes2.statusCode).toBe(201);

    // -----------------------------------------------------------------
    // Step 7 — reveal topic-2 (the final topic): voting -> revealed
    // -----------------------------------------------------------------
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1", team_id: "team-1", facilitator_id: "facilitator-1",
          status: "active", current_topic_id: "topic-2",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });
    mockDbConnect.mockResolvedValueOnce(
      makeMockClient([
        { rows: [] },
        { rows: [{ id: "st-2", revealed_at: new Date("2026-09-08T10:20:00Z") }], rowCount: 1 },
        { rows: [] },
        { rows: [] },
      ]),
    );

    const revealRes2 = await facilitatorApp.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/sess-1/reveal",
    });
    expect(revealRes2.statusCode).toBe(200);
    expect(mockPublishVoteRevealed).toHaveBeenCalledTimes(2);

    // -----------------------------------------------------------------
    // Step 8 — SESSION-012: advance past the final topic -> wrap_up
    // -----------------------------------------------------------------
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1", team_id: "team-1", facilitator_id: "facilitator-1",
          status: "active", current_topic_id: "topic-2",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });
    mockDbConnect.mockResolvedValueOnce(
      makeMockClient([
        { rows: [] },
        { rows: [{ id: "st-2", topic_name: "Topic B", completed_at: new Date("2026-09-08T10:25:00Z") }], rowCount: 1 },
        { rows: [] }, // next-topic lookup — none
        { rows: [{ wrap_up_started_at: new Date("2026-09-08T10:25:01Z") }] }, // UPDATE sessions -> wrap_up
        { rows: [] }, // INSERT audit_log (state_changed)
        { rows: [] }, // COMMIT
      ]),
    );

    const advanceRes2 = await facilitatorApp.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/sess-1/topics/advance",
    });
    expect(advanceRes2.statusCode).toBe(200);
    expect(advanceRes2.json().status).toBe("wrap_up");
    expect(advanceRes2.json().currentTopic).toBeUndefined();
    expect(mockPublishSessionStateChange).toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({ previousStatus: "active", newStatus: "wrap_up" }),
    );
    expect(mockPublishTopicHistoryUpdate).toHaveBeenCalledTimes(2);

    // -----------------------------------------------------------------
    // Step 9 — existing SESSION-006 (wrap_up -> complete), unmodified by
    // this change — confirms no regression.
    // -----------------------------------------------------------------
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ id: "sess-1", team_id: "team-1", facilitator_id: "facilitator-1", status: "wrap_up" }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });
    mockDbConnect.mockResolvedValueOnce(
      makeMockClient([
        { rows: [] },
        { rows: [] }, // UPDATE sessions -> complete
        { rows: [] }, // INSERT audit_log
        { rows: [] }, // COMMIT
      ]),
    );

    const completeRes = await facilitatorApp.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/sess-1/complete",
    });
    expect(completeRes.statusCode).toBe(200);
    expect(completeRes.json().status).toBe("complete");

    // -----------------------------------------------------------------
    // Whole-flow assertions: exactly the expected number of each publish
    // type fired across the full run, and no unexpected ones.
    // -----------------------------------------------------------------
    expect(mockPublishVoteRevealed).toHaveBeenCalledTimes(2);
    expect(mockPublishTopicHistoryUpdate).toHaveBeenCalledTimes(2);
    expect(mockPublishVoteReadinessUpdate).toHaveBeenCalledTimes(2);
    // session_state_change: start (lobby->pre_session), begin-voting
    // (pre_session->active), advance-to-wrap_up, complete (wrap_up->complete)
    expect(mockPublishSessionStateChange).toHaveBeenCalledTimes(4);
  });
});
