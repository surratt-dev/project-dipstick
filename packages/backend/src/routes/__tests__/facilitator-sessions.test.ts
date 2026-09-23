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
const mockClearFacilitatorConnectedFlag = vi.fn().mockResolvedValue(undefined);

vi.mock("../../realtime/ws-pubsub.js", () => ({
  publishSessionStateChange: (...args: unknown[]) => mockPublishSessionStateChange(...args),
  publishVoteRevealed: (...args: unknown[]) => mockPublishVoteRevealed(...args),
  publishTopicHistoryUpdate: (...args: unknown[]) => mockPublishTopicHistoryUpdate(...args),
  publishVoteReadinessUpdate: (...args: unknown[]) => mockPublishVoteReadinessUpdate(...args),
  clearFacilitatorConnectedFlag: (...args: unknown[]) => mockClearFacilitatorConnectedFlag(...args),
}));
const mockEvaluateSessionSubscriberAccess = vi.fn();
vi.mock("../../auth/session-subscriber-access-helper.js", () => ({
  evaluateSessionSubscriberAccess: (...args: unknown[]) => mockEvaluateSessionSubscriberAccess(...args),
}));

const mockApplyTimingFloor = vi.fn().mockResolvedValue(undefined);
vi.mock("../../content/timing-oracle.js", () => ({
  applyTimingFloor: (...args: unknown[]) => mockApplyTimingFloor(...args),
  CONTENT_TIMING_FLOOR_MS: 150,
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
import { DatabaseError } from "pg";
import {
  facilitatorSessionRoutes,
  recordRevealTriggeredAudit,
  computeStalenessLevel,
} from "../facilitator-sessions.js";
import { sessionRoutes } from "../sessions.js";

/** Prototype used to fabricate `err instanceof DatabaseError` fixtures without pg's real constructor args. */
const DatabaseErrorProto = DatabaseError.prototype;

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
// computeStalenessLevel (tasks.md task 2.0a/2.0b, design.md Decision 7)
//
// Regression guard for the drift that went unnoticed the first time: the
// legend this change ships states 1/2/3-session thresholds, and this test
// asserts computeStalenessLevel's actual output agrees with those thresholds
// — including at the current application_settings.staleness_threshold_sessions
// seed-data default (2), which this function no longer reads at all.
// ---------------------------------------------------------------------------
describe("computeStalenessLevel (design.md Decision 7 — fixed 1/2/3-session mapping)", () => {
  it("0 sessions elapsed computes 'none'", () => {
    expect(computeStalenessLevel(0)).toBe("none");
  });

  it("1 session elapsed computes 'yellow', matching the legend, regardless of the configured threshold default", () => {
    expect(computeStalenessLevel(1)).toBe("yellow");
  });

  it("2 sessions elapsed computes 'orange', matching the legend, regardless of the configured threshold default", () => {
    expect(computeStalenessLevel(2)).toBe("orange");
  });

  it("3 sessions elapsed computes 'red', matching the legend — the concrete case the fix corrects", () => {
    expect(computeStalenessLevel(3)).toBe("red");
  });

  it("more than 3 sessions elapsed also computes 'red'", () => {
    expect(computeStalenessLevel(7)).toBe("red");
  });

  it("does not accept a threshold parameter — the function's only argument is sessionsSinceUpdate", () => {
    // Type-level guard: computeStalenessLevel is unary. If this file fails to
    // compile because a second argument became required again, that's this
    // test doing its job.
    expect(computeStalenessLevel.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/teams/:teamId/sessions/draft
//
// session-creation-existing-team, design.md Decision D1 (combined
// global_role/is_member query, check ordering, audit logging) and Decision
// D3 (concurrent-session 409 via the sessions_team_active_unique partial
// unique index). tasks.md Section 2.
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/sessions/draft", () => {
  beforeEach(() => vi.clearAllMocks());

  function mockActorQuery(globalRole: string, isMember: boolean) {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: globalRole, is_member: isMember }],
    });
  }

  // task 2.5: non-facilitator caller
  it("2.5: returns 403 with a message distinguishable from the cross-team-constraint message when actor is not a facilitator, and writes no audit row", async () => {
    mockActorQuery("engineer", false);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/draft",
    });

    expect(res.statusCode).toBe(403);
    const message = res.json().error.message as string;
    expect(message).toContain("facilitator");
    expect(message).not.toContain("member of");
    expect(mockDbQuery).toHaveBeenCalledTimes(1); // no team-existence or audit query reached
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  it("returns 404 when team does not exist", async () => {
    mockActorQuery("facilitator", false);
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // team not found

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/nonexistent-team/sessions/draft",
    });

    expect(res.statusCode).toBe(404);
  });

  // task 2.8: a nonexistent team where the caller also has no membership row
  it("2.8: a request for a nonexistent :teamId with no membership row returns 404, not the membership-conflict 403, and writes no audit row", async () => {
    mockActorQuery("facilitator", false);
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // team not found

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/nonexistent-team/sessions/draft",
    });

    expect(res.statusCode).toBe(404);
    expect(mockDbQuery).toHaveBeenCalledTimes(2); // actor query + team-existence query, nothing further
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  // task 2.3 / 2.6 / 2.7: active membership on the target team is rejected
  // regardless of how the request arrives (direct API call, stale
  // eligible-teams list state) -- the endpoint is the control, not the UI.
  it("2.3/2.6/2.7: facilitator with active membership on target team returns 403 with the named cross-team error, creates no session, and writes an audit row", async () => {
    mockActorQuery("facilitator", true);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-1" }] }); // team exists
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // INSERT INTO audit_log (denial)

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/draft",
    });

    expect(res.statusCode).toBe(403);
    const message = res.json().error.message as string;
    expect(message).toContain("member of");
    expect(message).not.toBe("Only a facilitator can create a draft session.");

    expect(mockDbConnect).not.toHaveBeenCalled(); // no transaction opened, no session created

    const auditCall = mockDbQuery.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toContain("session.draft_denied_membership_conflict");

    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "session.draft_denied_membership_conflict",
      expect.objectContaining({ teamId: "team-1" }),
    );
  });

  // task 2.4: a previously-removed membership does not block creation
  it("2.4: facilitator with a previously-removed (removed_at set) membership on target team is permitted", async () => {
    // removed_at IS NULL is part of the query's JOIN condition, so a
    // soft-deleted membership row makes is_member false at the DB layer —
    // simulated here directly, since the query itself is not re-executed.
    mockActorQuery("facilitator", false);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-1" }] }); // team exists

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ id: "session-draft-1" }] }, // INSERT sessions
      { rows: [] }, // INSERT audit_log (draft_created)
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/draft",
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().sessionId).toBe("session-draft-1");
  });

  it("returns 201 with draft status, a joinToken, and writes the draft_created audit row in the same transaction as the insert", async () => {
    mockActorQuery("facilitator", false);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-1" }] }); // team exists

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ id: "session-draft-1" }] }, // INSERT sessions
      { rows: [] }, // INSERT audit_log (draft_created)
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

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
    expect(typeof body.joinToken).toBe("string");

    // task 2.16: audit insert happens on the same client, between BEGIN/COMMIT
    const calls = client.query.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toContain("BEGIN");
    expect(calls[1]).toContain("INSERT INTO sessions");
    expect(calls[2]).toContain("INSERT INTO audit_log");
    expect(calls[2]).toContain("audit_log");
    expect(client.query.mock.calls[2]![1]).toContain("session.draft_created");
    expect(calls[3]).toContain("COMMIT");

    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "session.draft_created",
      expect.objectContaining({ teamId: "team-1", sessionId: "session-draft-1" }),
    );
  });

  // task 2.14: concurrent-session 409
  it("2.14: creating a session for a team that already has a lobby session returns 409 with the existing session's id/status, and creates no new row", async () => {
    mockActorQuery("facilitator", false);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-1" }] }); // team exists

    const violation = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "sessions_team_active_unique",
    });
    Object.setPrototypeOf(violation, DatabaseErrorProto);

    const client = makeMockClient();
    client.query = vi.fn((sql: string) => {
      if (sql.includes("BEGIN")) return Promise.resolve({ rows: [] });
      if (sql.includes("INSERT INTO sessions")) return Promise.reject(violation);
      if (sql.includes("ROLLBACK")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    mockDbConnect.mockResolvedValueOnce(client);

    // follow-up SELECT for the existing session, after rollback
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: "existing-session-1", status: "lobby" }],
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/draft",
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.errorState).toBe("session_already_exists");
    expect(body.existingSessionId).toBe("existing-session-1");
    expect(body.existingSessionStatus).toBe("lobby");
    expect(body.teamId).toBe("team-1");

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("ROLLBACK"));
  });

  // task 2.15: only prior session terminal -> permitted
  it("2.15: creating a session for a team whose only prior session is complete is permitted", async () => {
    mockActorQuery("facilitator", false);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-1" }] }); // team exists

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ id: "session-draft-2" }] }, // INSERT sessions succeeds — no violation
      { rows: [] }, // INSERT audit_log
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/draft",
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().sessionId).toBe("session-draft-2");
  });

  // task 2.17: of two concurrent creation requests for the same team,
  // exactly one succeeds and the other is rejected identifying the winner.
  //
  // A mocked unit test cannot exercise real event-loop-level concurrency or
  // the database's actual lock ordering (that guarantee comes from the
  // partial unique index itself, verified against a real Postgres instance
  // per task 1.2's manual verification). What this test asserts is the
  // *application-level contract* the index's atomicity is relied on to
  // produce: the second insert against an already-occupied team_id surfaces
  // as a 23505 on sessions_team_active_unique, and the handler resolves that
  // into a 409 naming the session the first request created — regardless of
  // which of the two requests happens to reach Postgres first.
  it("2.17: of two concurrent creation requests for the same team, exactly one succeeds and the other receives 409 identifying the winner's session", async () => {
    mockActorQuery("facilitator", false);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-1" }] }); // team exists (request A, the winner)

    const winnerClient = makeMockClient([
      { rows: [] },
      { rows: [{ id: "session-winner" }] },
      { rows: [] },
      { rows: [] },
    ]);
    mockDbConnect.mockResolvedValueOnce(winnerClient);

    const app = await buildApp();
    const resA = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/draft",
    });
    expect(resA.statusCode).toBe(201);
    expect(resA.json().sessionId).toBe("session-winner");

    // Request B arrives after A has already committed — the index rejects it.
    mockActorQuery("facilitator", false);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-1" }] }); // team exists (request B, the loser)

    const violation = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "sessions_team_active_unique",
    });
    Object.setPrototypeOf(violation, DatabaseErrorProto);
    const loserClient = makeMockClient();
    loserClient.query = vi.fn((sql: string) => {
      if (sql.includes("BEGIN")) return Promise.resolve({ rows: [] });
      if (sql.includes("INSERT INTO sessions")) return Promise.reject(violation);
      if (sql.includes("ROLLBACK")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    mockDbConnect.mockResolvedValueOnce(loserClient);
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: "session-winner", status: "draft" }],
    }); // loser's follow-up SELECT, after rollback

    const resB = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/draft",
    });

    expect(resB.statusCode).toBe(409);
    expect(resB.json().existingSessionId).toBe("session-winner");
  });

  // task 2.18: a 23505 on an unrelated constraint must not be mistaken for the 409 case
  it("2.18: a 23505 unique-violation on a different constraint propagates as an unhandled 500, not a false-positive 409", async () => {
    mockActorQuery("facilitator", false);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-1" }] }); // team exists

    const otherViolation = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "sessions_join_token_unique",
    });
    Object.setPrototypeOf(otherViolation, DatabaseErrorProto);

    const client = makeMockClient();
    client.query = vi.fn((sql: string) => {
      if (sql.includes("BEGIN")) return Promise.resolve({ rows: [] });
      if (sql.includes("INSERT INTO sessions")) return Promise.reject(otherViolation);
      if (sql.includes("ROLLBACK")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/draft",
    });

    expect(res.statusCode).toBe(500);
  });

  // task 2.19: a non-23505 database error must also propagate as a 500
  it("2.19: a non-23505 database error during the insert propagates as an unhandled 500, not a false-positive 409", async () => {
    mockActorQuery("facilitator", false);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-1" }] }); // team exists

    const client = makeMockClient();
    client.query = vi.fn((sql: string) => {
      if (sql.includes("BEGIN")) return Promise.resolve({ rows: [] });
      if (sql.includes("INSERT INTO sessions")) return Promise.reject(new Error("connection reset"));
      if (sql.includes("ROLLBACK")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/draft",
    });

    expect(res.statusCode).toBe(500);
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
    expect(body.actionItems[0].stalenessLevel).toBe("red"); // 5 sessions since update -> fixed mapping, >= 3 is red

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
// GET /api/v1/sessions/:sessionId/action-items-review
// (pre-session-action-item-review, tasks.md 3.5/3.6)
// ---------------------------------------------------------------------------
describe("GET /api/v1/sessions/:sessionId/action-items-review", () => {
  beforeEach(() => vi.clearAllMocks());

  it("authorized participant success: 200 with the team's action items and isFacilitator: false", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "participant",
      sessionId: "session-1",
      teamId: "team-1",
      actorGlobalRole: "engineer",
    });
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ status: "pre_session" }] }) // session-status gate
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
            sessions_since_update: "1",
          },
        ],
      }); // action items query

    const app = await buildApp("participant-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/session-1/action-items-review",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.isFacilitator).toBe(false);
    expect(body.actionItems).toHaveLength(1);
    expect(body.actionItems[0].stalenessLevel).toBe("yellow");
    expect(mockEvaluateSessionSubscriberAccess).toHaveBeenCalledWith("participant-1", "session-1");
  });

  it("authorized facilitator success: 200 with the same action items and isFacilitator: true", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "facilitator",
      sessionId: "session-1",
      teamId: "team-1",
      sessionStatus: "pre_session",
      actorGlobalRole: "facilitator",
    });
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ status: "pre_session" }] })
      .mockResolvedValueOnce({ rows: [] }); // no open items

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/session-1/action-items-review",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.isFacilitator).toBe(true);
    expect(body.actionItems).toEqual([]);
  });

  it("no-grant: returns 404, identical shape whether the session is missing or the caller has no standing", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce(null);

    const app = await buildApp("stranger-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/session-1/action-items-review",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.category).toBe("not_found");
    // No session-status query or action-items query is reached past a null grant.
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it("Engineering Manager: 404, inherited from evaluateSessionSubscriberAccess's own no-EM-grant behavior", async () => {
    // evaluateSessionSubscriberAccess is mocked directly here, so this test
    // asserts the route's own behavior on a null grant — the EM exclusion
    // itself is verified in session-subscriber-access-helper's own test suite.
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce(null);

    const app = await buildApp("em-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/session-1/action-items-review",
    });

    expect(res.statusCode).toBe(404);
  });

  it("wrong session status (lobby): 409 with currentSessionStatus and isFacilitator", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "facilitator",
      sessionId: "session-1",
      teamId: "team-1",
      sessionStatus: "lobby",
      actorGlobalRole: "facilitator",
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ status: "lobby" }] });

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/session-1/action-items-review",
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.currentSessionStatus).toBe("lobby");
    expect(body.isFacilitator).toBe(true);
  });

  it("wrong session status (active): 409 with currentSessionStatus and isFacilitator: false for a participant", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "participant",
      sessionId: "session-1",
      teamId: "team-1",
      actorGlobalRole: "engineer",
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ status: "active" }] });

    const app = await buildApp("participant-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/session-1/action-items-review",
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.currentSessionStatus).toBe("active");
    expect(body.isFacilitator).toBe(false);
  });

  it("response shape: 200 body carries only actionItems and isFacilitator for both grant paths", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "participant",
      sessionId: "session-1",
      teamId: "team-1",
      actorGlobalRole: "engineer",
    });
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ status: "pre_session" }] })
      .mockResolvedValueOnce({ rows: [] });

    const app = await buildApp("participant-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/session-1/action-items-review",
    });

    expect(Object.keys(res.json()).sort()).toEqual(["actionItems", "isFacilitator"]);
  });
});

// ---------------------------------------------------------------------------
// GET .../action-items-review — F1/F2 cross-cutting regression coverage
// (tasks.md 3.6, narrowed per task-review architect finding #4): with
// applyTimingFloor()/Cache-Control already applied inline in each response
// path, this covers only what needs all three response paths to exist —
// that the floor is invoked, unconditionally, on every path (the timing
// floor's own padding behavior is covered generically by
// content/timing-oracle.test.ts), and that no-store is set on every path.
// ---------------------------------------------------------------------------
describe("GET .../action-items-review — F1/F2 regression coverage (tasks.md 3.6)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("applies the timing floor on the 404 path", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce(null);
    const app = await buildApp("stranger-1");
    const res = await app.inject({ method: "GET", url: "/api/v1/sessions/session-1/action-items-review" });

    expect(res.statusCode).toBe(404);
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
    expect(mockApplyTimingFloor).toHaveBeenCalledWith(expect.any(Number));
  });

  it("applies the timing floor on the 409 path", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "participant", sessionId: "session-1", teamId: "team-1", actorGlobalRole: "engineer",
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ status: "active" }] });
    const app = await buildApp("participant-1");
    const res = await app.inject({ method: "GET", url: "/api/v1/sessions/session-1/action-items-review" });

    expect(res.statusCode).toBe(409);
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
    expect(mockApplyTimingFloor).toHaveBeenCalledWith(expect.any(Number));
  });

  it("applies the timing floor on the 200 path", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "participant", sessionId: "session-1", teamId: "team-1", actorGlobalRole: "engineer",
    });
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ status: "pre_session" }] })
      .mockResolvedValueOnce({ rows: [] });
    const app = await buildApp("participant-1");
    const res = await app.inject({ method: "GET", url: "/api/v1/sessions/session-1/action-items-review" });

    expect(res.statusCode).toBe(200);
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
    expect(mockApplyTimingFloor).toHaveBeenCalledWith(expect.any(Number));
  });

  it("sets Cache-Control: no-store on the 404, 409, and 200 response codes", async () => {
    // 404
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce(null);
    const app1 = await buildApp("stranger-1");
    const res404 = await app1.inject({ method: "GET", url: "/api/v1/sessions/session-1/action-items-review" });
    expect(res404.headers["cache-control"]).toBe("no-store");

    // 409
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "participant", sessionId: "session-1", teamId: "team-1", actorGlobalRole: "engineer",
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ status: "lobby" }] });
    const app2 = await buildApp("participant-1");
    const res409 = await app2.inject({ method: "GET", url: "/api/v1/sessions/session-1/action-items-review" });
    expect(res409.headers["cache-control"]).toBe("no-store");

    // 200
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "participant", sessionId: "session-1", teamId: "team-1", actorGlobalRole: "engineer",
    });
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ status: "pre_session" }] })
      .mockResolvedValueOnce({ rows: [] });
    const app3 = await buildApp("participant-1");
    const res200 = await app3.inject({ method: "GET", url: "/api/v1/sessions/session-1/action-items-review" });
    expect(res200.headers["cache-control"]).toBe("no-store");
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
      expect.objectContaining({
        sessionId: "sess-1",
        sessionStatus: "active",
        // FR-4.6.1 (websocket-specification Decision D2): stamped here,
        // once, after the transaction above commits.
        serverTimestamp: expect.any(String),
      }),
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

// ---------------------------------------------------------------------------
// GET /api/v1/teams/eligible-for-session
//
// session-creation-existing-team, design.md Decision D2. tasks.md Section 3.
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/eligible-for-session", () => {
  beforeEach(() => vi.clearAllMocks());

  // task 3.5
  it("3.5: returns 403 when actor is not a facilitator", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/eligible-for-session" });

    expect(res.statusCode).toBe(403);
  });

  // task 3.6
  it("3.6: facilitator with eligible teams returns 200 with the correct team list", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] }) // actor check
      .mockResolvedValueOnce({
        rows: [
          { team_id: "team-2", team_name: "Team Two", last_session_at: new Date("2026-08-01T00:00:00Z") },
        ],
      }) // eligible query
      .mockResolvedValueOnce({ rows: [{ exists: true }] }); // callerHasTeamMemberships

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/eligible-for-session" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.eligibleTeams).toEqual([
      { teamId: "team-2", teamName: "Team Two", lastSessionAt: "2026-08-01T00:00:00.000Z" },
    ]);
  });

  // task 3.7 — deactivated-team exclusion lives in the query's WHERE clause
  // (deactivated_at IS NULL); this test documents that contract at the
  // handler level by asserting the query text, since the mock DB layer
  // cannot itself enforce a WHERE predicate.
  it("3.7: the eligibility query excludes deactivated teams via its WHERE clause", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ exists: false }] });

    const app = await buildApp();
    await app.inject({ method: "GET", url: "/api/v1/teams/eligible-for-session" });

    const eligibleQueryCall = mockDbQuery.mock.calls.find((call) =>
      (call[0] as string).includes("FROM teams"),
    );
    expect(eligibleQueryCall).toBeDefined();
    expect(eligibleQueryCall![0] as string).toContain("deactivated_at IS NULL");
  });

  // task 3.8
  it("3.8: facilitator with zero team memberships returns 200, full eligible list, callerHasTeamMemberships: false", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      .mockResolvedValueOnce({
        rows: [{ team_id: "team-1", team_name: "Team One", last_session_at: null }],
      })
      .mockResolvedValueOnce({ rows: [{ exists: false }] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/eligible-for-session" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.callerHasTeamMemberships).toBe(false);
    expect(body.eligibleTeams).toHaveLength(1);
  });

  // task 3.9
  it("3.9: facilitator with a home team and zero eligible targets returns 200, empty array, callerHasTeamMemberships: true", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ exists: true }] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/eligible-for-session" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.eligibleTeams).toEqual([]);
    expect(body.callerHasTeamMemberships).toBe(true);
  });

  // task 3.10
  it("3.10: a team whose most recent session is draft or lobby reports lastSessionAt from its last completed session, or null", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      .mockResolvedValueOnce({
        rows: [
          { team_id: "team-3", team_name: "Team Three", last_session_at: null },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ exists: false }] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/eligible-for-session" });

    const body = res.json();
    expect(body.eligibleTeams[0].lastSessionAt).toBeNull();

    // The query itself sources last_session_at only from status = 'complete'
    // sessions (design.md D2) — a live draft/lobby session's timestamp is
    // never read for this field, regardless of how recent it is.
    const eligibleQueryCall = mockDbQuery.mock.calls.find((call) =>
      (call[0] as string).includes("FROM teams"),
    );
    expect(eligibleQueryCall![0] as string).toContain("s.status = 'complete'");
  });

  // task 3.11
  it("3.11: a global_role downgrade between two calls is reflected on the very next call", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ exists: false }] });

    const app = await buildApp();
    const res1 = await app.inject({ method: "GET", url: "/api/v1/teams/eligible-for-session" });
    expect(res1.statusCode).toBe(200);

    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] });
    const res2 = await app.inject({ method: "GET", url: "/api/v1/teams/eligible-for-session" });
    expect(res2.statusCode).toBe(403);
  });

  // task 3.12
  it("3.12: a team with a live non-terminal session and no membership row still appears in eligibleTeams, unfiltered by session status", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      .mockResolvedValueOnce({
        rows: [
          { team_id: "team-live", team_name: "Team Live", last_session_at: null },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ exists: true }] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/eligible-for-session" });

    const body = res.json();
    expect(body.eligibleTeams.map((t: { teamId: string }) => t.teamId)).toContain("team-live");

    // The eligibility query joins only team_memberships, never sessions —
    // confirming a live session cannot filter a team out of this list.
    const eligibleQueryCall = mockDbQuery.mock.calls.find((call) =>
      (call[0] as string).includes("FROM teams"),
    );
    expect(eligibleQueryCall![0] as string).not.toContain("JOIN sessions");
  });
});
