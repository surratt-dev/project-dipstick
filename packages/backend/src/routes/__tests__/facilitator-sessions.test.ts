import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockDbQuery = vi.fn();
const mockDbConnect = vi.fn();
const mockEmitAuditEvent = vi.fn();
const mockPublishSessionStateChange = vi.fn();
const mockPublishVoteRevealed = vi.fn();
const mockPublishTopicHistoryUpdate = vi.fn();

vi.mock("../../db.js", () => ({
  db: {
    query: (...args: unknown[]) => mockDbQuery(...args),
    connect: () => mockDbConnect(),
  },
}));
vi.mock("../../auth/audit-logger.js", () => ({
  emitAuditEvent: (...args: unknown[]) => mockEmitAuditEvent(...args),
}));
const mockPublishVoteReadinessUpdate = vi.fn();

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
import type { FastifyBaseLogger } from "fastify";
import { facilitatorSessionRoutes, recordRevealTriggeredAudit } from "../facilitator-sessions.js";
import { sessionRoutes } from "../sessions.js";

/** Returns a mock transaction client that records calls, matching teams.test.ts's pattern. */
function makeMockClient(queryResponses: Array<{ rows: unknown[]; rowCount?: number }> = []) {
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

function buildApp(userId = "facilitator-1") {
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
  });
  app.register(facilitatorSessionRoutes);
  return app.ready().then(() => app);
}

function buildSessionsApp(userId = "participant-1") {
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
  });
  app.register(sessionRoutes);
  return app.ready().then(() => app);
}

// ---------------------------------------------------------------------------
// POST /api/v1/teams/:teamId/sessions/draft (Task 8.1, 8.2)
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/sessions/draft", () => {
  beforeEach(() => vi.clearAllMocks());

  // Task 8.2: Only facilitators can create draft sessions
  it("returns 403 when actor is not a facilitator", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/draft",
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toContain("facilitator");
  });

  it("returns 201 with draft status when facilitator creates a draft session", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] }) // actor check
      .mockResolvedValueOnce({ rows: [{ id: "team-1" }] }) // team exists
      .mockResolvedValueOnce({ rows: [{ id: "session-draft-1" }] }); // INSERT

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/draft",
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("draft");
    expect(body.sessionId).toBe("session-draft-1");
    expect(body.teamId).toBe("team-1");
  });

  it("returns 404 when team does not exist", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      .mockResolvedValueOnce({ rows: [] }); // team not found

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/nonexistent-team/sessions/draft",
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/teams/:teamId/sessions/:sessionId/advance (Task 8.3)
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/sessions/:sessionId/advance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("transitions draft to lobby successfully", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "session-1",
          team_id: "team-1",
          facilitator_id: "facilitator-1",
          status: "draft",
        }],
      }) // session lookup
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] }); // actor global_role lookup

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // UPDATE sessions
      { rows: [] }, // INSERT audit_log (session.state_changed)
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/session-1/advance",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("lobby");

    const auditInsertCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditInsertCall).toBeDefined();
    expect(auditInsertCall![1]).toContain("session.state_changed");

    // Publish-after-commit: published only after the transaction committed.
    expect(mockPublishSessionStateChange).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ previousStatus: "draft", newStatus: "lobby" }),
    );
  });

  it("returns 422 when session is not in draft status", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "session-1",
        team_id: "team-1",
        facilitator_id: "facilitator-1",
        status: "active",
      }],
    });

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/session-1/advance",
    });

    expect(res.statusCode).toBe(422);
  });

  it("returns 403 when actor is not the session facilitator", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "session-1",
        team_id: "team-1",
        facilitator_id: "other-facilitator",
        status: "draft",
      }],
    });

    const app = await buildApp("facilitator-1"); // different user
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/session-1/advance",
    });

    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/sessions/:sessionId/start (SESSION-004, tasks.md 1.8)
// ---------------------------------------------------------------------------
describe("POST /api/v1/sessions/:sessionId/start", () => {
  beforeEach(() => vi.clearAllMocks());

  it("transitions lobby to pre_session and returns action items oldest first", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ id: "session-1", team_id: "team-1", facilitator_id: "facilitator-1", status: "lobby" }],
      }) // session lookup
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] }) // actor global_role
      .mockResolvedValueOnce({ rows: [{ value: "2" }] }) // staleness threshold
      .mockResolvedValueOnce({
        rows: [
          {
            action_item_id: "ai-1",
            description: "Fix flaky test",
            owner_user_id: "user-1",
            owner_display_name: "Alice",
            status: "open",
            originating_session_id: "session-old-1",
            originating_session_number: 3,
            created_at: new Date("2026-01-01T00:00:00Z"),
            updated_at: new Date("2026-01-01T00:00:00Z"),
            sessions_since_update: "5",
          },
        ],
      }); // action items query

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ started_at: new Date("2026-09-08T00:00:00Z") }] }, // UPDATE sessions RETURNING started_at
      { rows: [] }, // INSERT audit_log
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/session-1/start",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("pre_session");
    expect(body.sessionId).toBe("session-1");
    expect(body.hasOpenItems).toBe(true);
    expect(body.actionItems).toHaveLength(1);
    expect(body.actionItems[0].stalenessLevel).toBe("orange"); // 5 sessions since update, threshold 2 -> >= 2x, < 3x

    const auditInsertCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditInsertCall![1]).toContain("session.state_changed");

    expect(mockPublishSessionStateChange).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ previousStatus: "lobby", newStatus: "pre_session" }),
    );
  });

  it("returns hasOpenItems: false and an empty array as a pass-through, not a screen to dismiss", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ id: "session-1", team_id: "team-1", facilitator_id: "facilitator-1", status: "lobby" }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      .mockResolvedValueOnce({ rows: [{ value: "2" }] })
      .mockResolvedValueOnce({ rows: [] }); // no open action items

    const client = makeMockClient([
      { rows: [] },
      { rows: [{ started_at: new Date("2026-09-08T00:00:00Z") }] },
      { rows: [] },
      { rows: [] },
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/sessions/session-1/start" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hasOpenItems).toBe(false);
    expect(body.actionItems).toEqual([]);
  });

  it("returns 403 when actor is not the session facilitator", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: "session-1", team_id: "team-1", facilitator_id: "other-facilitator", status: "lobby" }],
    });

    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/sessions/session-1/start" });

    expect(res.statusCode).toBe(403);
  });

  it("returns 409 when session is not in lobby status", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: "session-1", team_id: "team-1", facilitator_id: "facilitator-1", status: "active" }],
    });

    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/sessions/session-1/start" });

    expect(res.statusCode).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/sessions/:sessionId/begin-voting (SESSION-005, tasks.md 1.8)
// ---------------------------------------------------------------------------
describe("POST /api/v1/sessions/:sessionId/begin-voting", () => {
  beforeEach(() => vi.clearAllMocks());

  it("transitions pre_session to active, sets the first topic voting, and current_topic_id to topics.id", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "session-1", team_id: "team-1", facilitator_id: "facilitator-1",
          status: "pre_session", is_first_session: false,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      {
        rows: [{
          id: "session-topic-1", // session_topics.id
          topic_id: "topic-catalog-1", // topics.id
          topic_name: "Production Code",
          topic_prompt: "How easy is it to add new features?",
          vote_type: "finger",
          first_session_description: null,
        }],
      }, // SELECT first topic
      { rows: [{ voting_started_at: new Date("2026-09-08T00:00:00Z") }] }, // UPDATE sessions RETURNING
      { rows: [] }, // UPDATE session_topics
      { rows: [] }, // INSERT audit_log
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/sessions/session-1/begin-voting" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("active");
    expect(body.currentTopic.sessionTopicId).toBe("session-topic-1"); // firstSessionTopicId, never firstTopicId

    // Regression test for the id-space defect: sessions.current_topic_id must
    // receive firstTopicId (topics.id = "topic-catalog-1"), NOT
    // firstSessionTopicId (session_topics.id = "session-topic-1").
    const updateSessionsCall = client.query.mock.calls[2]!;
    expect((updateSessionsCall[0] as string).toLowerCase()).toContain("update sessions");
    expect(updateSessionsCall[1]).toEqual(["session-1", "topic-catalog-1"]);

    // The session_topics UPDATE's WHERE id = ... must receive
    // firstSessionTopicId ("session-topic-1"), NOT firstTopicId.
    const updateTopicCall = client.query.mock.calls[3]!;
    expect((updateTopicCall[0] as string).toLowerCase()).toContain("update session_topics");
    expect(updateTopicCall[1]).toEqual(["session-topic-1"]);

    const auditInsertCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditInsertCall![1]).toContain("session.state_changed");

    expect(mockPublishSessionStateChange).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ previousStatus: "pre_session", newStatus: "active" }),
    );
  });

  it("populates firstSessionDescription only when sessions.is_first_session is true", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "session-1", team_id: "team-1", facilitator_id: "facilitator-1",
          status: "pre_session", is_first_session: true,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });

    const client = makeMockClient([
      { rows: [] },
      {
        rows: [{
          id: "session-topic-1", topic_id: "topic-catalog-1",
          topic_name: "Production Code", topic_prompt: "prompt",
          vote_type: "finger", first_session_description: "Welcome! Here's how voting works.",
        }],
      },
      { rows: [{ voting_started_at: new Date("2026-09-08T00:00:00Z") }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/sessions/session-1/begin-voting" });

    expect(res.json().currentTopic.firstSessionDescription).toBe("Welcome! Here's how voting works.");
  });

  it("returns 403 when actor is not the session facilitator", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "session-1", team_id: "team-1", facilitator_id: "other-facilitator",
        status: "pre_session", is_first_session: false,
      }],
    });

    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/sessions/session-1/begin-voting" });

    expect(res.statusCode).toBe(403);
  });

  it("returns 409 when session is not in pre_session status", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "session-1", team_id: "team-1", facilitator_id: "facilitator-1",
        status: "lobby", is_first_session: false,
      }],
    });

    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/sessions/session-1/begin-voting" });

    expect(res.statusCode).toBe(409);
  });

  it("rolls back and commits neither table's write when the second UPDATE fails (dual-table atomicity)", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "session-1", team_id: "team-1", facilitator_id: "facilitator-1",
          status: "pre_session", is_first_session: false,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });

    let callIndex = 0;
    const responses: Array<{ rows: unknown[] } | Error> = [
      { rows: [] }, // BEGIN
      {
        rows: [{
          id: "session-topic-1", topic_id: "topic-catalog-1",
          topic_name: "Production Code", topic_prompt: "prompt",
          vote_type: "finger", first_session_description: null,
        }],
      }, // SELECT first topic
      { rows: [{ voting_started_at: new Date("2026-09-08T00:00:00Z") }] }, // UPDATE sessions succeeds
      new Error("simulated failure before session_topics UPDATE commits"), // UPDATE session_topics fails
    ];
    const mockClientQuery = vi.fn((..._args: unknown[]) => {
      const resp = responses[callIndex] ?? { rows: [] };
      callIndex++;
      if (resp instanceof Error) return Promise.reject(resp);
      return Promise.resolve(resp);
    });
    const client = { query: mockClientQuery, release: vi.fn() };
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/sessions/session-1/begin-voting" });

    // The handler rethrows after ROLLBACK — Fastify surfaces this as a 500,
    // not a partial success.
    expect(res.statusCode).toBe(500);
    const rollbackCall = client.query.mock.calls.find((call) => call[0] === "ROLLBACK");
    expect(rollbackCall).toBeDefined();
    const commitCall = client.query.mock.calls.find((call) => call[0] === "COMMIT");
    expect(commitCall).toBeUndefined();
    // Neither the reveal-write style publish nor a partial response ever ran.
    expect(mockPublishSessionStateChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/teams/:teamId/sessions/:sessionId/complete (Task 8.8)
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/sessions/:sessionId/complete", () => {
  beforeEach(() => vi.clearAllMocks());

  // Task 8.8: Session completion sets facilitator_access_expires_at in same transaction
  it("transitions wrap_up to complete and sets facilitator_access_expires_at", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "session-1",
          team_id: "team-1",
          facilitator_id: "facilitator-1",
          status: "wrap_up",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] }); // actor global_role lookup

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // UPDATE sessions with facilitator_access_expires_at
      { rows: [] }, // INSERT audit_log (session.state_changed)
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/session-1/complete",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("complete");

    // Verify the UPDATE SQL sets facilitator_access_expires_at (Task 8.8)
    const updateCall = client.query.mock.calls[1]!;
    const updateSql = (updateCall[0] as string).toLowerCase();
    expect(updateSql).toContain("facilitator_access_expires_at");
    expect(updateSql).toContain("interval '30 minutes'");
    expect(updateSql).toContain("'complete'");

    const auditInsertCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditInsertCall![1]).toContain("session.state_changed");

    expect(mockPublishSessionStateChange).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ previousStatus: "wrap_up", newStatus: "complete" }),
    );
  });

  // Task 8.11: facilitator_access_expires_at cannot be set by client input
  it("the complete endpoint does not accept facilitator_access_expires_at in request body", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "session-1",
          team_id: "team-1",
          facilitator_id: "facilitator-1",
          status: "wrap_up",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // UPDATE
      { rows: [] }, // INSERT audit_log
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    // Attempt to supply facilitator_access_expires_at in the request body
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/session-1/complete",
      payload: { facilitatorAccessExpiresAt: "9999-12-31T00:00:00Z" }, // should be ignored
    });

    // The request succeeds (200) but the server ignores the client-supplied value
    expect(res.statusCode).toBe(200);

    // Verify the UPDATE SQL does NOT use any parameter for expires_at from client input
    const updateCall = client.query.mock.calls[1]!;
    const updateValues = updateCall[1] as unknown[];
    // The only parameter should be the session ID — expires_at is computed server-side
    expect(updateValues).toHaveLength(1);
    expect(updateValues[0]).toBe("session-1");
  });

  it("returns 422 when session is not in wrap_up status", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "session-1",
        team_id: "team-1",
        facilitator_id: "facilitator-1",
        status: "active", // not wrap_up
      }],
    });

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/session-1/complete",
    });

    expect(res.statusCode).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/teams/:teamId/sessions/:sessionId/reveal — the reveal write
// (session-lifecycle-transitions design.md Decision D2/D3, tasks.md 3.8-3.13)
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/sessions/:sessionId/reveal — reveal write", () => {
  beforeEach(() => vi.clearAllMocks());

  // tasks.md 3.8
  it("3.8: successful reveal transitions the topic to revealed, writes one audit row, publishes one event", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1", team_id: "team-1", facilitator_id: "facilitator-1",
          status: "active", current_topic_id: "topic-1",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ id: "session-topic-1", revealed_at: new Date("2026-09-08T00:00:00Z") }], rowCount: 1 }, // conditional UPDATE
      { rows: [] }, // INSERT audit_log (recordRevealTriggeredAudit)
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/sess-1/reveal",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().revealed).toBe(true);

    const updateCall = client.query.mock.calls[1]!;
    expect((updateCall[0] as string).toLowerCase()).toContain("update session_topics");
    expect((updateCall[0] as string).toLowerCase()).toContain("status = 'revealed'");
    expect(updateCall[1]).toEqual(["sess-1", "topic-1"]);

    const auditInsertCalls = client.query.mock.calls.filter((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditInsertCalls).toHaveLength(1);
    expect(auditInsertCalls[0]![1]).toContain("session.reveal_triggered");

    expect(mockPublishVoteRevealed).toHaveBeenCalledTimes(1);
    expect(mockPublishVoteRevealed).toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({ sessionId: "sess-1", sessionStatus: "active" }),
    );
  });

  // tasks.md 3.9
  it("3.9: a second reveal on an already-revealed topic returns 409/already_revealed, no extra audit row or publish", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1", team_id: "team-1", facilitator_id: "facilitator-1",
          status: "active", current_topic_id: "topic-1",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      // follow-up read (Decision D2) to populate the already_revealed response
      .mockResolvedValueOnce({
        rows: [{ id: "session-topic-1", revealed_at: new Date("2026-09-08T00:00:00Z") }],
      });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [], rowCount: 0 }, // conditional UPDATE — already revealed, zero rows affected
      { rows: [] }, // ROLLBACK
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/sess-1/reveal",
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.errorState).toBe("already_revealed");
    expect(body.sessionTopicId).toBe("session-topic-1");
    expect(body.revealedAt).toBe("2026-09-08T00:00:00.000Z");

    const auditInsertCalls = client.query.mock.calls.filter((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditInsertCalls).toHaveLength(0);
    expect(mockPublishVoteRevealed).not.toHaveBeenCalled();

    const commitCall = client.query.mock.calls.find((call) => call[0] === "COMMIT");
    expect(commitCall).toBeUndefined();
    const rollbackCall = client.query.mock.calls.find((call) => call[0] === "ROLLBACK");
    expect(rollbackCall).toBeDefined();
  });

  // tasks.md 3.10 — this codebase's established concurrency-test convention
  // (see teams.test.ts's zero-participant race test) simulates the DB-level
  // row lock at the mock-response level, since the test suite mocks the pg
  // client rather than running against a real Postgres: the first reveal's
  // conditional UPDATE affects one row (it wins the lock); the second
  // reveal's conditional UPDATE — modeling the request that had to wait for
  // the first transaction's lock and then re-evaluates against the
  // now-committed 'revealed' row — affects zero rows. Requests are issued
  // sequentially (not via Promise.all) so each one's DB calls consume the
  // mock queue in a known order — Promise.all against a single shared mock
  // queue would interleave the two requests' calls nondeterministically,
  // which is a property of the test double, not of the real row lock this
  // test is asserting.
  it("3.10: of two concurrent reveal requests for the same topic, exactly one commits and exactly one event publishes", async () => {
    mockDbQuery
      // First request
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1", team_id: "team-1", facilitator_id: "facilitator-1",
          status: "active", current_topic_id: "topic-1",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      // Second request
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1", team_id: "team-1", facilitator_id: "facilitator-1",
          status: "active", current_topic_id: "topic-1",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      // Second request's follow-up read after losing the race
      .mockResolvedValueOnce({
        rows: [{ id: "session-topic-1", revealed_at: new Date("2026-09-08T00:00:00Z") }],
      });

    const winnerClient = makeMockClient([
      { rows: [] },
      { rows: [{ id: "session-topic-1", revealed_at: new Date("2026-09-08T00:00:00Z") }], rowCount: 1 },
      { rows: [] },
      { rows: [] },
    ]);
    const loserClient = makeMockClient([
      { rows: [] },
      { rows: [], rowCount: 0 },
      { rows: [] },
    ]);
    mockDbConnect.mockResolvedValueOnce(winnerClient).mockResolvedValueOnce(loserClient);

    const app = await buildApp("facilitator-1");
    const res1 = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/sessions/sess-1/reveal" });
    const res2 = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/sessions/sess-1/reveal" });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(409);
    expect(res2.json().errorState).toBe("already_revealed");
    expect(mockPublishVoteRevealed).toHaveBeenCalledTimes(1);
  });

  // tasks.md 3.11 (design.md Decision D5's required test, distinct from 3.10):
  // a lock-in request and a live reveal request racing for the same topic.
  // Models the "reveal commits first" branch — the reveal's transaction
  // commits, and the subsequent lock-in's row lock (sessions.ts) observes
  // the now-'revealed' status and is rejected. The complementary branch (the
  // vote commits and is included in the reveal) is the ordinary
  // lock-in-then-reveal happy path already covered by 3.8 and sessions.test.ts.
  it("3.11: a reveal that commits first causes a concurrently-racing lock-in to be rejected, never inserting a post-reveal vote", async () => {
    // Reveal request
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1", team_id: "team-1", facilitator_id: "facilitator-1",
          status: "active", current_topic_id: "topic-1",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });

    const revealClient = makeMockClient([
      { rows: [] },
      { rows: [{ id: "session-topic-1", revealed_at: new Date("2026-09-08T00:00:00Z") }], rowCount: 1 },
      { rows: [] },
      { rows: [] },
    ]);
    mockDbConnect.mockResolvedValueOnce(revealClient);

    const facilitatorApp = await buildApp("facilitator-1");
    const revealRes = await facilitatorApp.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/sess-1/reveal",
    });
    expect(revealRes.statusCode).toBe(200);

    // Lock-in request for the same topic, arriving after the reveal committed.
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ session_status: "active", team_id: "team-1", topic_status: "voting" }],
      }) // pre-transaction check still sees 'voting' (the race window)
      .mockResolvedValueOnce({ rows: [{ global_role: "engineer", membership_role: "participant" }] })
      .mockResolvedValueOnce({ rows: [{ id: "sp-1" }] });

    const lockInClient = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ status: "revealed" }] }, // SELECT ... FOR UPDATE — sees the reveal's committed state
      { rows: [] }, // ROLLBACK
    ]);
    mockDbConnect.mockResolvedValueOnce(lockInClient);

    const participantApp = await buildSessionsApp("participant-1");
    const lockInRes = await participantApp.inject({
      method: "POST",
      url: "/api/v1/sessions/sess-1/topics/session-topic-1/lock-in",
      payload: { voteValue: 3, voteType: "finger" },
    });

    expect(lockInRes.statusCode).toBe(422);
    const insertVoteCall = lockInClient.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO votes"),
    );
    expect(insertVoteCall).toBeUndefined();
    expect(mockPublishVoteReadinessUpdate).not.toHaveBeenCalled();
  });

  // tasks.md 3.13 (design.md Decision D3's ordering requirement)
  it("3.13: a non-facilitator's reveal against an already-revealed topic returns the generic 403, never already_revealed", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "sess-1", team_id: "team-1", facilitator_id: "other-facilitator",
        status: "active", current_topic_id: "topic-1",
      }],
    });

    const app = await buildApp("facilitator-1"); // not the session's facilitator
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/sess-1/reveal",
    });

    // Session is live (active), so this is the recoverable 503 auth-failure
    // path — never the already_revealed 409 shape, which the handler never
    // even attempts to compute without first passing authorization.
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.errorState).toBe("reveal_failure");
    expect(body.errorState).not.toBe("already_revealed");
    expect(mockDbConnect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/teams/:teamId/sessions/:sessionId/topics/advance (SESSION-012,
// tasks.md 4.11-4.14)
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/sessions/:sessionId/topics/advance", () => {
  beforeEach(() => vi.clearAllMocks());

  // tasks.md 4.11
  it("4.11: advances to the next topic, updates current_topic_id to topics.id, keeps session active, publishes one topic_history_update", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1", team_id: "team-1", facilitator_id: "facilitator-1",
          status: "active", current_topic_id: "topic-1",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      {
        rows: [{ id: "session-topic-1", topic_name: "Production Code", completed_at: new Date("2026-09-08T00:00:00Z") }],
        rowCount: 1,
      }, // conditional UPDATE (complete current topic)
      {
        rows: [{
          id: "session-topic-2", topic_id: "topic-2",
          topic_name: "Deployment Process", topic_prompt: "How easy is it to deploy?",
          vote_type: "finger",
        }],
      }, // next-topic lookup
      { rows: [] }, // UPDATE session_topics SET status = 'voting'
      { rows: [] }, // UPDATE sessions SET current_topic_id
      { rows: [] }, // INSERT audit_log (session.topic_advanced)
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/sess-1/topics/advance",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("active");
    expect(body.completedTopic.sessionTopicId).toBe("session-topic-1");
    expect(body.currentTopic.sessionTopicId).toBe("session-topic-2");

    // Regression test for the id-space defect: sessions.current_topic_id
    // must receive the next topic's topics.id ("topic-2"), never its
    // session_topics.id ("session-topic-2").
    const updateSessionsCall = client.query.mock.calls[4]!;
    expect((updateSessionsCall[0] as string).toLowerCase()).toContain("update sessions");
    expect(updateSessionsCall[1]).toEqual(["sess-1", "topic-2"]);

    const updateTopicCall = client.query.mock.calls[3]!;
    expect((updateTopicCall[0] as string).toLowerCase()).toContain("update session_topics");
    expect(updateTopicCall[1]).toEqual(["session-topic-2"]);

    const auditInsertCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditInsertCall![1]).toContain("session.topic_advanced");

    // Security review finding: the DB audit_log row alone is not enough —
    // every other state-transition endpoint in this file also emits the
    // structured-log counterpart (emitAuditEvent) for operational alerting.
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "session.topic_advanced",
      expect.objectContaining({
        sessionId: "sess-1",
        teamId: "team-1",
        completedSessionTopicId: "session-topic-1",
        newSessionTopicId: "session-topic-2",
      }),
    );

    expect(mockPublishTopicHistoryUpdate).toHaveBeenCalledTimes(1);
    expect(mockPublishTopicHistoryUpdate).toHaveBeenCalledWith(
      "team-1",
      expect.objectContaining({ teamId: "team-1", updateType: "topic_advanced", sessionId: "sess-1", topicId: "topic-2" }),
    );
    expect(mockPublishSessionStateChange).not.toHaveBeenCalled();
  });

  // tasks.md 4.12(1)
  it("4.12: a facilitator of a different session's team is rejected with 403 (team-id cross-check)", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "sess-1", team_id: "team-1", facilitator_id: "facilitator-1",
        status: "active", current_topic_id: "topic-1",
      }],
    });

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-2/sessions/sess-1/topics/advance", // wrong team
    });

    expect(res.statusCode).toBe(403);
    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  // tasks.md 4.12(2) — mirrors task 3.13's ordering test
  it("4.12: a non-facilitator's advance against a not-yet-revealed topic returns the generic 403, never advance_blocked", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "sess-1", team_id: "team-1", facilitator_id: "other-facilitator",
        status: "active", current_topic_id: "topic-1",
      }],
    });

    const app = await buildApp("facilitator-1"); // not the session's facilitator
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/sess-1/topics/advance",
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.errorState).not.toBe("advance_blocked");
    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  // tasks.md 4.13
  it("4.13: advancing past the final topic transitions to wrap_up, sets wrap_up_started_at, clears current_topic_id, publishes both events", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1", team_id: "team-1", facilitator_id: "facilitator-1",
          status: "active", current_topic_id: "topic-final",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      {
        rows: [{ id: "session-topic-final", topic_name: "Final Topic", completed_at: new Date("2026-09-08T00:00:00Z") }],
        rowCount: 1,
      }, // conditional UPDATE
      { rows: [] }, // next-topic lookup — none found
      { rows: [{ wrap_up_started_at: new Date("2026-09-08T00:05:00Z") }] }, // UPDATE sessions -> wrap_up RETURNING
      { rows: [] }, // INSERT audit_log (session.state_changed)
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/sess-1/topics/advance",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("wrap_up");
    expect(body.wrapUpStartedAt).toBe("2026-09-08T00:05:00.000Z");
    expect(body.currentTopic).toBeUndefined();
    expect(body.completedTopic.sessionTopicId).toBe("session-topic-final");

    const updateSessionsCall = client.query.mock.calls[3]!;
    expect((updateSessionsCall[0] as string).toLowerCase()).toContain("wrap_up");
    expect((updateSessionsCall[0] as string).toLowerCase()).toContain("current_topic_id = null");

    const auditInsertCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditInsertCall![1]).toContain("session.state_changed");
    expect(auditInsertCall![1] as unknown[]).toEqual(
      expect.arrayContaining([expect.stringContaining("completed_session_topic_id")]),
    );

    // Security review finding: the wrap-up-entry branch also needs the
    // structured-log counterpart, matching every other endpoint in this
    // file that writes a session.state_changed audit_log row.
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "session.state_changed",
      expect.objectContaining({
        sessionId: "sess-1",
        teamId: "team-1",
        priorStatus: "active",
        newStatus: "wrap_up",
        completedSessionTopicId: "session-topic-final",
      }),
    );

    expect(mockPublishSessionStateChange).toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({ previousStatus: "active", newStatus: "wrap_up" }),
    );
    expect(mockPublishTopicHistoryUpdate).toHaveBeenCalledWith(
      "team-1",
      expect.objectContaining({ teamId: "team-1", updateType: "topic_advanced", sessionId: "sess-1", topicId: "topic-final" }),
    );
  });

  // tasks.md 4.14
  it("4.14: advancing before the current topic is revealed returns 409/advance_blocked, modifies no state", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1", team_id: "team-1", facilitator_id: "facilitator-1",
          status: "active", current_topic_id: "topic-1",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      // follow-up read to populate the blocked response
      .mockResolvedValueOnce({ rows: [{ id: "session-topic-1" }] });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [], rowCount: 0 }, // conditional UPDATE — current topic is still 'voting', not 'revealed'
      { rows: [] }, // ROLLBACK
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/sess-1/topics/advance",
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.errorState).toBe("advance_blocked");
    expect(body.requiresReveal).toBe(true);
    expect(body.sessionTopicId).toBe("session-topic-1");

    const commitCall = client.query.mock.calls.find((call) => call[0] === "COMMIT");
    expect(commitCall).toBeUndefined();
    expect(mockPublishTopicHistoryUpdate).not.toHaveBeenCalled();
    expect(mockPublishSessionStateChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// recordRevealTriggeredAudit — SEC-13/SEC-14 audit write for the reveal
// action (task 7.2). BLOCKED on GitHub issue #26 for real wiring into the
// reveal handler's own transaction (no such transaction exists yet, because
// the reveal endpoint does not commit a state transition today). This
// function is verified in isolation, against a stubbed commit point, per
// the Blocking Dependency section's testability guidance.
// ---------------------------------------------------------------------------
describe("recordRevealTriggeredAudit (task 7.2 — BLOCKED on #26 for production wiring)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes exactly one audit_log row with operation session.reveal_triggered and the session identifier in metadata", async () => {
    const client = makeMockClient([{ rows: [] }]);
    const logger = { info: vi.fn() } as unknown as FastifyBaseLogger;

    await recordRevealTriggeredAudit(client, logger, {
      actorUserId: "facilitator-1",
      actorGlobalRole: "facilitator",
      actorIp: "127.0.0.1",
      teamId: "team-1",
      sessionId: "session-1",
    });

    expect(client.query).toHaveBeenCalledTimes(1);
    const [sql, params] = client.query.mock.calls[0]!;
    expect(sql as string).toContain("INSERT INTO audit_log");
    expect(params).toContain("session.reveal_triggered");
    const metadataArg = (params as unknown[]).find(
      (p) => typeof p === "string" && p.includes("session_id"),
    ) as string;
    expect(JSON.parse(metadataArg)).toEqual({ session_id: "session-1" });
  });

  it("also emits the structured-log counterpart via emitAuditEvent", async () => {
    const client = makeMockClient([{ rows: [] }]);
    const logger = { info: vi.fn() } as unknown as FastifyBaseLogger;

    await recordRevealTriggeredAudit(client, logger, {
      actorUserId: "facilitator-1",
      actorGlobalRole: "facilitator",
      actorIp: "127.0.0.1",
      teamId: "team-1",
      sessionId: "session-1",
    });

    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      logger,
      "session.reveal_triggered",
      expect.objectContaining({ sessionId: "session-1", teamId: "team-1" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Draft session expiry behavior (Task 8.5, 8.6, 8.7)
//
// These behaviors are enforced by the authorization helper (evaluateTeamAccess)
// at read time, not by this route. The SQL check in the helper uses:
//   status = 'draft' AND created_at + INTERVAL '24 hours' > NOW()
//
// Verification here: the authorization helper test suite covers these cases
// (team-content-access-helper.test.ts: "draft session within 24 hours",
// "draft session older than 24 hours").
//
// Task 8.5: Facilitator with draft session within 24h can access historical data
// → Verified by team-content-access-helper.test.ts: "draft session within 24 hours"
//   and content.test.ts: "returns 200 for facilitator with no-store header"
//
// Task 8.6: Facilitator with expired draft session receives 403
// → Verified by team-content-access-helper.test.ts: "draft session older than 24 hours"
//
// Task 8.7: Deleting draft session ends facilitator's access
// → Covered by the SQL check failing when no qualifying session row exists.
// ---------------------------------------------------------------------------
describe("Draft session expiry (Task 8.5, 8.6, 8.7) — documented reference", () => {
  it("expiry enforcement is documented: lazy expiry via SQL check in authorization helper", () => {
    // The authorization helper (team-content-access-helper.ts) enforces draft
    // session expiry via the SQL condition:
    //   status = 'draft' AND created_at + INTERVAL '24 hours' > NOW()
    //
    // This is Decision 3 from design.md — no background task required.
    // Tests for the specific boundary conditions are in:
    //   __tests__/team-content-access-helper.test.ts
    expect(true).toBe(true); // documentation-only test
  });
});

// ---------------------------------------------------------------------------
// Grace window behavior (Task 8.9, 8.10)
//
// Verified by authorization helper tests:
//   "within the grace window" → facilitator grant (200 on content endpoints)
//   "grace window expired" → null grant (403 on content endpoints)
// ---------------------------------------------------------------------------
describe("Grace window behavior (Task 8.9, 8.10) — documented reference", () => {
  it("grace window enforcement is documented: lazy expiry via SQL check in authorization helper", () => {
    // The authorization helper enforces the grace window via:
    //   status = 'complete' AND facilitator_access_expires_at > NOW()
    //
    // Tests for boundary conditions are in:
    //   __tests__/team-content-access-helper.test.ts
    // Task 8.9: Facilitator within grace window can READ (gets facilitator grant)
    // Task 8.10: Facilitator outside grace window receives 403 (null grant)
    expect(true).toBe(true); // documentation-only test
  });
});
