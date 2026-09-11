import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockDbQuery = vi.fn();
const mockDbConnect = vi.fn();
const mockEmitAuditEvent = vi.fn();
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
import { sessionRoutes } from "../sessions.js";

/** Returns a mock transaction client that records calls, matching teams.test.ts's pattern. */
function makeMockClient(queryResponses: Array<{ rows: unknown[] }> = []) {
  let callIndex = 0;
  const mockClientQuery = vi.fn((..._args: unknown[]) => {
    const resp = queryResponses[callIndex] ?? { rows: [] };
    callIndex++;
    return Promise.resolve(resp);
  });
  return {
    query: mockClientQuery,
    release: vi.fn(),
  };
}

function buildApp(sessionData: Record<string, unknown> = {}) {
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = {
      userId: "user-1",
      ...sessionData,
    };
  });
  app.register(sessionRoutes);
  return app.ready().then(() => app);
}

// ---------------------------------------------------------------------------
// POST /api/v1/sessions/:sessionId/participants
// ---------------------------------------------------------------------------
describe("POST /api/v1/sessions/:sessionId/participants", () => {
  beforeEach(() => vi.clearAllMocks());

  // Task 3.3 — global_role=engineer + membership_role=engineering_manager → rejected
  it("3.3: rejects a user with global_role=engineer and membership_role=engineering_manager", async () => {
    // 1) session fetch — active
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ id: "s1", team_id: "team-1", status: "active" }],
      })
      // 2) role check — global engineer, but team membership EM
      .mockResolvedValueOnce({
        rows: [
          { global_role: "engineer", membership_role: "engineering_manager" },
        ],
      });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/s1/participants",
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toContain("Engineering Managers");
  });

  // Task 3.6 — membership_role=participant + global_role=engineer → allowed
  it("3.6: permits a user with global_role=engineer and membership_role=participant", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ id: "s1", team_id: "team-1", status: "active" }],
      })
      .mockResolvedValueOnce({
        rows: [{ global_role: "engineer", membership_role: "participant" }],
      })
      .mockResolvedValueOnce({ rows: [{ id: "sp-1" }] }); // INSERT participant

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/s1/participants",
    });

    expect(res.statusCode).toBe(201);
  });

  it("rejects a user with global_role=engineering_manager (existing check still works)", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ id: "s1", team_id: "team-1", status: "active" }],
      })
      .mockResolvedValueOnce({
        rows: [
          { global_role: "engineering_manager", membership_role: "participant" },
        ],
      });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/s1/participants",
    });

    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/sessions/:sessionId/topics/:sessionTopicId/lock-in
//
// Task 3.4 — mid-session lock-in rejected after role change to EM
// Task 3.5 — vote locked before role change is preserved (not deleted)
// Task 3.7 — per-operation DB read, not connection-time cached value
// ---------------------------------------------------------------------------
describe("POST /api/v1/sessions/:sessionId/topics/:sessionTopicId/lock-in", () => {
  beforeEach(() => vi.clearAllMocks());

  // Task 3.4 — lock-in rejected when membership_role changed to EM after session start
  it("3.4: rejects a lock-in when membership_role was changed to engineering_manager mid-session", async () => {
    // The DB now shows engineering_manager even though at session-join time
    // the user may have been a participant. This simulates a mid-session role change.
    // The per-operation DB read picks up the new value.
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            session_status: "active",
            team_id: "team-1",
            topic_status: "voting",
          },
        ],
      })
      // Role check: membership_role is now engineering_manager (changed after join)
      .mockResolvedValueOnce({
        rows: [
          { global_role: "engineer", membership_role: "engineering_manager" },
        ],
      });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/s1/topics/st1/lock-in",
      payload: { voteValue: 3, voteType: "finger" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toContain("Engineering Managers");
  });

  // Task 3.5 — vote locked before role change is preserved (not deleted)
  // The lock-in endpoint does NOT delete existing votes when a user's role
  // changes. Votes already in the votes table are counted at reveal.
  it("3.5: a successful lock-in inserts a vote row; subsequent role promotion does not delete it", async () => {
    // First lock-in — user is participant
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            session_status: "active",
            team_id: "team-1",
            topic_status: "voting",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ global_role: "engineer", membership_role: "participant" }],
      })
      .mockResolvedValueOnce({ rows: [{ id: "sp-1" }] }); // participant check

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ status: "voting" }] }, // SELECT ... FOR UPDATE (Decision D5 race lock)
      { rows: [{ id: "vote-1" }] }, // INSERT votes
      { rows: [] }, // INSERT audit_log (session.vote_submitted)
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp();
    const lockInRes = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/s1/topics/st1/lock-in",
      payload: { voteValue: 3, voteType: "finger" },
    });
    expect(lockInRes.statusCode).toBe(201);
    expect(lockInRes.json().voteId).toBe("vote-1");

    // Now the user's role has been changed to engineering_manager.
    // The vote row (vote-1) is still in the database — no DELETE was issued.
    // This is the key point of Task 3.5: the lock-in endpoint does not
    // retroactively delete votes; they remain to be counted at reveal.
    //
    // Verify by checking that no DELETE query was issued for the votes table
    // (across both the plain pool and the transaction client)
    const allCalls = [...mockDbQuery.mock.calls, ...client.query.mock.calls];
    const deleteCallExists = allCalls.some((call) => {
      const sql = (call[0] as string).toLowerCase();
      return sql.includes("delete") && sql.includes("vote");
    });
    expect(deleteCallExists).toBe(false);

    // Audit trail (SEC-13/SEC-14): exactly one session.vote_submitted row,
    // with the vote value/type excluded from metadata (SEC-16/SEC-22).
    const auditInsertCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditInsertCall).toBeDefined();
    const auditParams = auditInsertCall![1] as unknown[];
    expect(auditParams).toContain("session.vote_submitted");
    const metadataArg = auditParams.find(
      (p) => typeof p === "string" && p.includes("session_topic_id"),
    ) as string;
    expect(metadataArg).not.toMatch(/vote_value|voteValue|vote_type|voteType/);

    // Publish-after-commit: the readiness update must be published only
    // after the transaction commits.
    expect(mockPublishVoteReadinessUpdate).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ sessionId: "s1", sessionTopicId: "st1", voterId: "user-1" }),
    );
  });

  // Task 3.7 — per-operation DB read, not connection-time value
  it("3.7: reads membership_role from DB on each lock-in request (not from cached value)", async () => {
    // Two sequential lock-in requests with DIFFERENT DB-returned roles simulate
    // the per-operation read pattern. The first call returns participant (ok);
    // the second call returns engineering_manager (rejected). A cached value
    // from the first call would incorrectly permit the second.
    const app = await buildApp();

    // First lock-in — participant
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            session_status: "active",
            team_id: "team-1",
            topic_status: "voting",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ global_role: "engineer", membership_role: "participant" }],
      })
      .mockResolvedValueOnce({ rows: [{ id: "sp-1" }] });

    mockDbConnect.mockResolvedValueOnce(
      makeMockClient([
        { rows: [] }, // BEGIN
        { rows: [{ status: "voting" }] }, // SELECT ... FOR UPDATE (Decision D5 race lock)
        { rows: [{ id: "vote-1" }] }, // INSERT votes
        { rows: [] }, // INSERT audit_log
        { rows: [] }, // COMMIT
      ]),
    );

    const firstRes = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/s1/topics/st1/lock-in",
      payload: { voteValue: 3, voteType: "finger" },
    });
    expect(firstRes.statusCode).toBe(201);

    // Second lock-in — role has changed to EM in the DB
    // If the role were cached from the first call, this would incorrectly succeed.
    // With a per-operation read, it reads 'engineering_manager' and rejects.
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            session_status: "active",
            team_id: "team-1",
            topic_status: "voting",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { global_role: "engineer", membership_role: "engineering_manager" },
        ],
      });

    const secondRes = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/s1/topics/st1/lock-in",
      payload: { voteValue: 2, voteType: "finger" },
    });
    expect(secondRes.statusCode).toBe(403);
  });

  // Task 7.7 — resubmission (ON CONFLICT ... DO UPDATE) produces exactly one
  // audit_log row per lock-in call, matching the one row it updates — not
  // once per WebSocket recipient of the resulting vote_readiness_update.
  it("7.7: a resubmission (vote already exists) still produces exactly one session.vote_submitted audit row per call", async () => {
    const app = await buildApp();
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ session_status: "active", team_id: "team-1", topic_status: "voting" }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "engineer", membership_role: "participant" }] })
      .mockResolvedValueOnce({ rows: [{ id: "sp-1" }] });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ status: "voting" }] }, // SELECT ... FOR UPDATE (Decision D5 race lock)
      { rows: [{ id: "vote-1" }] }, // INSERT ... ON CONFLICT DO UPDATE (resubmission updates the same row)
      { rows: [] }, // INSERT audit_log
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/s1/topics/st1/lock-in",
      payload: { voteValue: 8, voteType: "finger" },
    });

    expect(res.statusCode).toBe(201);
    const auditInserts = client.query.mock.calls.filter((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditInserts).toHaveLength(1);
  });

  // tasks.md 2.3 (session-lifecycle-transitions design.md Decision D5):
  // the topic was 'voting' at the pre-transaction check but had already been
  // revealed by the time the lock-in's own transaction reached the row lock
  // — the race window the pre-existing topic_status !== 'voting' check
  // (sessions.ts:213-221) cannot see.
  it("2.3: rejects lock-in with 422 when session_topics.status is 'revealed' at the in-transaction row lock", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ session_status: "active", team_id: "team-1", topic_status: "voting" }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "engineer", membership_role: "participant" }] })
      .mockResolvedValueOnce({ rows: [{ id: "sp-1" }] });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ status: "revealed" }] }, // SELECT ... FOR UPDATE — reveal won the race
      { rows: [] }, // ROLLBACK
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/s1/topics/st1/lock-in",
      payload: { voteValue: 3, voteType: "finger" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.category).toBe("invalid_request");
    expect(res.json().error.message).toContain("closed");

    // No vote was inserted, and the transaction never committed.
    const insertVoteCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO votes"),
    );
    expect(insertVoteCall).toBeUndefined();
    const commitCall = client.query.mock.calls.find((call) => call[0] === "COMMIT");
    expect(commitCall).toBeUndefined();
    const rollbackCall = client.query.mock.calls.find((call) => call[0] === "ROLLBACK");
    expect(rollbackCall).toBeDefined();
    expect(mockPublishVoteReadinessUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/sessions/:sessionId/reveal-latency
//
// FR-4.6.1 client obligation (websocket-specification Decision D2, tasks.md
// tasks 2.4/2.5/2.8).
// ---------------------------------------------------------------------------
describe("POST /api/v1/sessions/:sessionId/reveal-latency", () => {
  beforeEach(() => vi.clearAllMocks());

  const participantGrantRow = {
    rows: [{
      session_id: "s1", team_id: "team-1", facilitator_id: "someone-else", session_status: "active",
      global_role: "engineer", participant_row_id: "p1", membership_role: "participant",
      membership_removed_at: null, membership_exists: true,
    }],
  };

  it("task 2.5: an authorized session subscriber's report is accepted and emitted via the existing audit-logger structured-log surface", async () => {
    mockDbQuery.mockResolvedValueOnce(participantGrantRow); // evaluateSessionSubscriberAccess

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/s1/reveal-latency",
      payload: { serverTimestamp: "2026-01-01T00:00:00.000Z", observedLatencyMs: 842 },
    });

    expect(res.statusCode).toBe(202);
    expect(mockEmitAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "session.reveal_latency_observed",
      expect.objectContaining({
        sessionId: "s1",
        serverTimestamp: "2026-01-01T00:00:00.000Z",
        observedLatencyMs: 842,
      }),
    );
  });

  // task 2.8: this is the check that a caller with no legitimate claim on
  // this session's vote_revealed delivery cannot inject arbitrary latency
  // metrics into the monitoring surface for a session they cannot observe.
  it("task 2.8: rejects a caller with no session-subscriber grant (403) and never emits the metric", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // evaluateSessionSubscriberAccess: no session/user row

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/s1/reveal-latency",
      payload: { serverTimestamp: "2026-01-01T00:00:00.000Z", observedLatencyMs: 842 },
    });

    expect(res.statusCode).toBe(403);
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a malformed report (non-numeric observedLatencyMs) with 422 and never emits the metric", async () => {
    mockDbQuery.mockResolvedValueOnce(participantGrantRow);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/s1/reveal-latency",
      payload: { serverTimestamp: "2026-01-01T00:00:00.000Z", observedLatencyMs: "not-a-number" },
    });

    expect(res.statusCode).toBe(422);
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });
});
