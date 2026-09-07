import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be defined before importing the module under test
// ---------------------------------------------------------------------------
const mockDbQuery = vi.fn();
const mockEmitAuditEvent = vi.fn();

vi.mock("../../db.js", () => ({
  db: {
    query: (...args: unknown[]) => mockDbQuery(...args),
  },
}));
vi.mock("../../auth/audit-logger.js", () => ({
  emitAuditEvent: (...args: unknown[]) => mockEmitAuditEvent(...args),
}));

// Mock timing oracle to skip floor delay in tests (Fix F2: em-views now uses applyTimingFloor)
vi.mock("../../content/timing-oracle.js", () => ({
  applyTimingFloor: vi.fn().mockResolvedValue(undefined),
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
import { emViewRoutes } from "../em-views.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
function buildApp(sessionData: Record<string, unknown> = {}) {
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = {
      userId: "em-user-1",
      ...sessionData,
    };
  });
  app.register(emViewRoutes);
  return app.ready().then(() => app);
}

/** Mock DB response for dual-auth check returning an authorized EM */
function makeEmAuthRow() {
  return {
    rows: [{ global_role: "engineering_manager", membership_role: "engineering_manager" }],
  };
}

/** Mock DB response for an unauthorized actor (not an EM globally) */
function makeNonEmAuthRow() {
  return {
    rows: [{ global_role: "engineer", membership_role: null }],
  };
}

/** Mock DB response for an EM without a team association */
function makeEmNoAssociationRow() {
  return {
    rows: [{ global_role: "engineering_manager", membership_role: null }],
  };
}

// ---------------------------------------------------------------------------
// Dual-authorization check (tasks 5.1, 5.10)
// Tests that BOTH checks are required independently
// ---------------------------------------------------------------------------
describe("EM view dual-authorization enforcement", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 when actor is not engineering_manager globally (SESSION-007)", async () => {
    // evaluateTeamAccess makes two queries when membership is null:
    //   Q1: user+membership (no membership_role) → triggers
    //   Q2: facilitator session check (returns empty) → no grant
    mockDbQuery.mockResolvedValueOnce(makeNonEmAuthRow());
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // facilitator session check

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/sessions" });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.category).toBe("forbidden");
    // Auth failure must not produce an audit record (task 5.13)
    expect(mockDbQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_log"),
      expect.anything(),
    );
  });

  it("returns 403 when actor has global EM role but no team association (SESSION-007)", async () => {
    // evaluateTeamAccess: global_role='engineering_manager' but membership_role=null
    // → proceeds to facilitator check → no facilitator session → null grant
    mockDbQuery.mockResolvedValueOnce(makeEmNoAssociationRow());
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // facilitator session check

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/sessions" });

    expect(res.statusCode).toBe(403);
    // No audit record on 403 (task 5.13)
    expect(mockDbQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_log"),
      expect.anything(),
    );
  });

  it("task 5.10: EM with no association to Team B is rejected when requesting Team B's history", async () => {
    // EM is associated with team-A but NOT team-B
    // evaluateTeamAccess for team-B: membership_role = null → facilitator check → empty
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineering_manager", membership_role: null }],
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // facilitator session check

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-B/em/sessions" });

    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// SESSION-007: GET /api/v1/teams/:teamId/em/sessions
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/:teamId/em/sessions (SESSION-007)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with aggregate session history for authorized EM", async () => {
    // Advisory fix 6: evaluateTeamAccess replaces checkEmAuthorization.
    // Advisory fix 7: audit INSERT moved BEFORE the sessions data fetch.
    // No teamExists check (evaluateTeamAccess makes it implicit).
    //
    // Call 1: evaluateTeamAccess Q1 (same query as before)
    mockDbQuery.mockResolvedValueOnce(makeEmAuthRow());
    // Call 2: audit_log INSERT (now BEFORE sessions list)
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    // Call 3: sessions list
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        {
          session_id: "sess-1",
          completed_at: new Date("2025-01-15T10:00:00Z"),
          session_number: 1,
          facilitator_name: "Alice",
          participant_count: "4",
        },
      ],
    });
    // Call 4: topics for sess-1
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        {
          topic_id: "topic-1",
          topic_name: "Delivery Confidence",
          vote_value: 3,
          vote_count: "2",
          has_outlier: false,
          flagged_for_discussion: false,
        },
        {
          topic_id: "topic-1",
          topic_name: "Delivery Confidence",
          vote_value: 5,
          vote_count: "2",
          has_outlier: true,
          flagged_for_discussion: false,
        },
      ],
    });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/sessions" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.teamId).toBe("team-1");
    expect(body.sessions).toHaveLength(1);

    const sess = body.sessions[0];
    expect(sess.sessionId).toBe("sess-1");
    expect(sess.facilitatorName).toBe("Alice");
    expect(sess.participantCount).toBe(4);
    expect(sess.topics).toHaveLength(1);

    const topic = sess.topics[0];
    expect(topic.topicId).toBe("topic-1");
    expect(topic.voteDistribution).toHaveLength(2);
  });

  it("response body contains NO vote-attributing fields (task 5.3, vote attribution boundary)", async () => {
    mockDbQuery.mockResolvedValueOnce(makeEmAuthRow()); // evaluateTeamAccess
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // audit INSERT (before data)
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        session_id: "sess-1", completed_at: new Date("2025-01-15T10:00:00Z"),
        session_number: 1, facilitator_name: "Alice", participant_count: "3",
      }],
    });
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        topic_id: "t-1", topic_name: "Quality", vote_value: 4, vote_count: "3",
        has_outlier: false, flagged_for_discussion: false,
      }],
    });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/sessions" });

    expect(res.statusCode).toBe(200);
    const bodyStr = res.body;

    // The response must NOT contain any voter-identifying fields at any nesting level
    expect(bodyStr).not.toContain('"voter_id"');
    expect(bodyStr).not.toContain('"voterId"');
    // voter_id must never appear on a vote distribution entry
    const body = JSON.parse(bodyStr);
    const bucket = body.sessions[0].topics[0].voteDistribution[0];
    expect(bucket).not.toHaveProperty("userId");
    expect(bucket).not.toHaveProperty("voter_id");
    expect(bucket).not.toHaveProperty("displayName");
    // Only aggregate fields are present
    expect(bucket).toHaveProperty("voteValue");
    expect(bucket).toHaveProperty("count");
    expect(bucket).toHaveProperty("containsOutlier");
  });

  it("produces an audit_log record when returning data (task 5.13)", async () => {
    // Advisory fix 7: audit INSERT is now the SECOND DB call (before data fetch)
    mockDbQuery.mockResolvedValueOnce(makeEmAuthRow()); // evaluateTeamAccess
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // audit INSERT
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // no sessions

    const app = await buildApp();
    await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/sessions" });

    const calls = mockDbQuery.mock.calls;
    const auditCall = calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO audit_log"),
    );
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toEqual(
      expect.arrayContaining(["em-user-1", "engineering_manager", "em.session_history_accessed", "team-1"]),
    );
  });

  it("does NOT produce an audit record when 403 is returned (task 5.13)", async () => {
    // evaluateTeamAccess: no membership → second query for facilitator check
    mockDbQuery.mockResolvedValueOnce(makeNonEmAuthRow());
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // facilitator session check

    const app = await buildApp();
    await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/sessions" });

    const auditCall = mockDbQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO audit_log"),
    );
    expect(auditCall).toBeUndefined();
  });

  it("includes full historical sessions — no date boundary on association date (task 5.4)", async () => {
    // No date filter in the SQL query — all completed sessions are returned
    // Call sequence: evaluateTeamAccess, audit INSERT, sessions list
    mockDbQuery.mockResolvedValueOnce(makeEmAuthRow());
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // audit INSERT
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // no sessions

    const app = await buildApp();
    await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/sessions" });

    // Verify the sessions query does NOT include a date filter tied to association
    const sessionsQueryCall = mockDbQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("FROM sessions") && c[0].includes("status = 'complete'"),
    );
    expect(sessionsQueryCall).toBeDefined();
    // The SQL must not contain WHERE clauses filtering by manager association date
    expect(sessionsQueryCall![0]).not.toContain("manager_associated_at");
    expect(sessionsQueryCall![0]).not.toContain("association_date");
  });
});

// ---------------------------------------------------------------------------
// SESSION-008: GET /api/v1/teams/:teamId/em/sessions/:sessionId
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/:teamId/em/sessions/:sessionId (SESSION-008)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with single session aggregate data for authorized EM", async () => {
    // Advisory fix 7: audit INSERT is now AFTER session meta check but BEFORE
    // participant count and topics queries.
    mockDbQuery.mockResolvedValueOnce(makeEmAuthRow()); // evaluateTeamAccess
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        session_id: "sess-1", completed_at: new Date("2025-02-01T09:00:00Z"),
        session_number: 2, facilitator_name: "Bob", team_id: "team-1", status: "complete",
      }],
    }); // session meta check
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // audit INSERT (before aggregate data)
    mockDbQuery.mockResolvedValueOnce({ rows: [{ participant_count: "5" }] }); // participant count
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // topics

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/sessions/sess-1" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sessionId).toBe("sess-1");
    expect(body.participantCount).toBe(5);
  });

  it("returns 404 when session is not found", async () => {
    mockDbQuery.mockResolvedValueOnce(makeEmAuthRow());
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // session not found

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/sessions/nonexistent" });

    expect(res.statusCode).toBe(404);
  });

  it("returns 403 when session belongs to a different team (task 5.8 — cross-team guard)", async () => {
    mockDbQuery.mockResolvedValueOnce(makeEmAuthRow());
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        session_id: "sess-1", completed_at: new Date(), session_number: 1,
        facilitator_name: "Carol", team_id: "team-other", status: "complete",
      }],
    });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/sessions/sess-1" });

    expect(res.statusCode).toBe(403);
  });

  it("returns 403 when session is not complete — EM cannot access live session data (task 5.8)", async () => {
    mockDbQuery.mockResolvedValueOnce(makeEmAuthRow());
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        session_id: "sess-live", completed_at: null, session_number: 3,
        facilitator_name: "Dave", team_id: "team-1", status: "in_progress",
      }],
    });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/sessions/sess-live" });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.message).toContain("live session");
  });

  it("response body contains NO vote-attributing fields", async () => {
    mockDbQuery.mockResolvedValueOnce(makeEmAuthRow()); // evaluateTeamAccess
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        session_id: "sess-1", completed_at: new Date("2025-02-01T09:00:00Z"),
        session_number: 2, facilitator_name: "Bob", team_id: "team-1", status: "complete",
      }],
    }); // session meta
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // audit INSERT (before aggregate data)
    mockDbQuery.mockResolvedValueOnce({ rows: [{ participant_count: "3" }] }); // participant count
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        topic_id: "t-1", topic_name: "Process", vote_value: 2, vote_count: "3",
        has_outlier: false, flagged_for_discussion: true,
      }],
    }); // topics

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/sessions/sess-1" });

    expect(res.statusCode).toBe(200);
    const bodyStr = res.body;
    expect(bodyStr).not.toContain('"voter_id"');
    expect(bodyStr).not.toContain('"voterId"');
    const body = JSON.parse(bodyStr);
    const bucket = body.topics[0].voteDistribution[0];
    expect(bucket).not.toHaveProperty("userId");
    expect(bucket).not.toHaveProperty("voter_id");
  });
});

// ---------------------------------------------------------------------------
// TREND-001: GET /api/v1/teams/:teamId/em/trends
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/:teamId/em/trends (TREND-001)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with trend data for authorized EM", async () => {
    // Advisory fix 7: audit INSERT now BEFORE trend data fetch
    mockDbQuery.mockResolvedValueOnce(makeEmAuthRow()); // evaluateTeamAccess
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // audit INSERT (before data)
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        {
          topic_id: "t-1", topic_name: "Quality",
          session_id: "sess-1", session_date: new Date("2025-01-01"), session_number: 1,
          avg_vote: "4.0", vote_values: "3,4,5", participant_count: "3",
        },
        {
          topic_id: "t-1", topic_name: "Quality",
          session_id: "sess-2", session_date: new Date("2025-02-01"), session_number: 2,
          avg_vote: "4.5", vote_values: "4,5", participant_count: "2",
        },
      ],
    }); // trend data

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/trends" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.teamId).toBe("team-1");
    expect(body.topics).toHaveLength(1);
    expect(body.topics[0].topicId).toBe("t-1");
    expect(body.topics[0].sessions).toHaveLength(2);
    expect(body.topics[0].overallAverage).toBeCloseTo(4.25);
    expect(body.dateRangeStart).toBeTruthy();
    expect(body.dateRangeEnd).toBeTruthy();
  });

  it("writes a SINGLE audit_log entry for bulk read (task 5.12) — not one per session", async () => {
    // Advisory fix 7: audit INSERT is now BEFORE the data fetch (second DB call).
    // The audit metadata is simplified to {} since counts/date ranges aren't
    // available before the data is read. The key invariant — exactly one audit
    // entry per request — is preserved.
    mockDbQuery.mockResolvedValueOnce(makeEmAuthRow()); // evaluateTeamAccess
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // audit INSERT (before data)
    // 3 sessions across 2 topics — still must produce exactly 1 audit_log INSERT
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        { topic_id: "t-1", topic_name: "Q", session_id: "s1", session_date: new Date("2025-01-01"), session_number: 1, avg_vote: "3", vote_values: "3", participant_count: "1" },
        { topic_id: "t-1", topic_name: "Q", session_id: "s2", session_date: new Date("2025-02-01"), session_number: 2, avg_vote: "4", vote_values: "4", participant_count: "1" },
        { topic_id: "t-2", topic_name: "P", session_id: "s3", session_date: new Date("2025-03-01"), session_number: 3, avg_vote: "5", vote_values: "5", participant_count: "1" },
      ],
    }); // trend data

    const app = await buildApp();
    await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/trends" });

    const auditInsertCalls = mockDbQuery.mock.calls.filter(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO audit_log"),
    );
    // Exactly one audit_log INSERT for all sessions returned (key invariant)
    expect(auditInsertCalls).toHaveLength(1);

    // Audit entry must include the operation and team
    const auditParams = auditInsertCalls[0]![1] as unknown[];
    expect(auditParams).toContain("em.trend_data_accessed");
    expect(auditParams).toContain("team-1");
  });

  it("trend response contains NO vote-attributing fields", async () => {
    // Advisory fix 7: audit INSERT before data
    mockDbQuery.mockResolvedValueOnce(makeEmAuthRow()); // evaluateTeamAccess
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // audit INSERT
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        topic_id: "t-1", topic_name: "Q", session_id: "s1",
        session_date: new Date(), session_number: 1,
        avg_vote: "3.5", vote_values: "3,4", participant_count: "2",
      }],
    }); // trend data

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/trends" });

    expect(res.statusCode).toBe(200);
    const bodyStr = res.body;
    expect(bodyStr).not.toContain('"voter_id"');
    expect(bodyStr).not.toContain('"userId"');
    // The session data points contain only aggregate stats
    const body = JSON.parse(bodyStr);
    const dp = body.topics[0].sessions[0];
    expect(dp).not.toHaveProperty("voter_id");
    expect(dp).not.toHaveProperty("userId");
    expect(dp).toHaveProperty("average");
    expect(dp).toHaveProperty("median");
    expect(dp).toHaveProperty("participantCount");
  });

  it("returns 403 for unauthorized actor", async () => {
    // evaluateTeamAccess: no membership → facilitator check
    mockDbQuery.mockResolvedValueOnce(makeNonEmAuthRow());
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // facilitator session check

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/trends" });

    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// TREND-002: GET /api/v1/teams/:teamId/em/trends/:topicId
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/:teamId/em/trends/:topicId (TREND-002)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with single topic trend data", async () => {
    mockDbQuery.mockResolvedValueOnce(makeEmAuthRow());
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        topic_name: "Clarity",
        session_id: "sess-1", session_date: new Date("2025-01-20"), session_number: 1,
        avg_vote: "3.5", vote_values: "3,4", participant_count: "2",
      }],
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // audit insert

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/trends/topic-clarity" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.topics).toHaveLength(1);
    expect(body.topics[0].topicId).toBe("topic-clarity");
    expect(body.topics[0].topicName).toBe("Clarity");
  });

  it("returns 404 when topic is not found for this team", async () => {
    mockDbQuery.mockResolvedValueOnce(makeEmAuthRow());
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // topic not found

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/trends/nonexistent-topic" });

    expect(res.statusCode).toBe(404);
  });

  it("writes single audit_log entry with topic_id in metadata (task 5.12)", async () => {
    mockDbQuery.mockResolvedValueOnce(makeEmAuthRow());
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        topic_name: "Flow",
        session_id: "s1", session_date: new Date("2025-01-01"), session_number: 1,
        avg_vote: "4", vote_values: "4", participant_count: "1",
      }],
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/trends/t-flow" });

    const auditCall = mockDbQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO audit_log"),
    );
    expect(auditCall).toBeDefined();
    const metadata = JSON.parse(auditCall![1][5] as string);
    expect(metadata.topic_id).toBe("t-flow");
  });
});

// ---------------------------------------------------------------------------
// ACTION-004: GET /api/v1/teams/:teamId/em/action-items
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/:teamId/em/action-items (ACTION-004)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with action items list including ownerDisplayName (Q8/Decision 13)", async () => {
    // Advisory fix 7: audit INSERT before action items fetch
    mockDbQuery.mockResolvedValueOnce(makeEmAuthRow()); // evaluateTeamAccess
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // audit INSERT (before data)
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "ai-1", team_id: "team-1", session_id: "sess-1",
        description: "Improve code review process",
        status: "open", resolution_note: null,
        created_at: new Date("2025-01-15"), updated_at: new Date("2025-01-15"),
        owner_display_name: "Alice",
      }],
    }); // action items

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/action-items" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.teamId).toBe("team-1");
    expect(body.actionItems).toHaveLength(1);
    // ownerDisplayName IS visible per Q8 resolution and Decision 13
    expect(body.actionItems[0].ownerDisplayName).toBe("Alice");
    expect(body.actionItems[0].description).toBe("Improve code review process");
    expect(body.actionItems[0].status).toBe("open");
  });

  it("response body contains NO voter identity fields (vote attribution boundary)", async () => {
    // Advisory fix 7: audit INSERT before data
    mockDbQuery.mockResolvedValueOnce(makeEmAuthRow()); // evaluateTeamAccess
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // audit INSERT
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "ai-1", team_id: "team-1", session_id: "sess-1",
        description: "Track delivery timeline", status: "in_progress", resolution_note: null,
        created_at: new Date(), updated_at: new Date(),
        owner_display_name: "Bob",
      }],
    }); // action items

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/action-items" });

    expect(res.statusCode).toBe(200);
    const bodyStr = res.body;
    // No voter identity fields
    expect(bodyStr).not.toContain('"voter_id"');
    expect(bodyStr).not.toContain('"voterId"');
    // No owner_id — only display name
    expect(bodyStr).not.toContain('"ownerId"');
    expect(bodyStr).not.toContain('"owner_id"');
  });

  it("returns 403 for non-EM actor", async () => {
    // evaluateTeamAccess: no membership → facilitator check
    mockDbQuery.mockResolvedValueOnce(makeNonEmAuthRow());
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // facilitator session check

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/action-items" });

    expect(res.statusCode).toBe(403);
  });

  it("produces audit_log record when returning data (task 5.13)", async () => {
    // Advisory fix 7: audit INSERT is the SECOND DB call (before data fetch)
    mockDbQuery.mockResolvedValueOnce(makeEmAuthRow()); // evaluateTeamAccess
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // audit INSERT
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // no action items

    const app = await buildApp();
    await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/action-items" });

    const auditCall = mockDbQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO audit_log"),
    );
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toContain("em.action_items_accessed");
  });
});

// ---------------------------------------------------------------------------
// ACTION-005: GET /api/v1/teams/:teamId/em/action-items/:actionItemId
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/:teamId/em/action-items/:actionItemId (ACTION-005)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with single action item including ownerDisplayName", async () => {
    mockDbQuery.mockResolvedValueOnce(makeEmAuthRow());
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "ai-1", team_id: "team-1", session_id: "sess-1",
        description: "Reduce sprint overflow",
        status: "resolved", resolution_note: "Capacity adjusted in planning",
        created_at: new Date("2025-01-01"), updated_at: new Date("2025-01-20"),
        owner_display_name: "Carol",
      }],
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // audit insert

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/action-items/ai-1" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.actionItems).toHaveLength(1);
    expect(body.actionItems[0].id).toBe("ai-1");
    expect(body.actionItems[0].ownerDisplayName).toBe("Carol");
    expect(body.actionItems[0].status).toBe("resolved");
    expect(body.actionItems[0].resolutionNote).toBe("Capacity adjusted in planning");
  });

  it("returns 404 when action item is not found", async () => {
    mockDbQuery.mockResolvedValueOnce(makeEmAuthRow());
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // not found

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/action-items/nonexistent" });

    expect(res.statusCode).toBe(404);
  });

  it("returns 403 for non-EM actor", async () => {
    // evaluateTeamAccess: no membership → facilitator check
    mockDbQuery.mockResolvedValueOnce(makeNonEmAuthRow());
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // facilitator session check

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/action-items/ai-1" });

    expect(res.statusCode).toBe(403);
  });

  it("produces audit_log record with action_item_id in metadata (task 5.13)", async () => {
    mockDbQuery.mockResolvedValueOnce(makeEmAuthRow());
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "ai-1", team_id: "team-1", session_id: "sess-1",
        description: "Fix CI pipeline", status: "open", resolution_note: null,
        created_at: new Date(), updated_at: new Date(),
        owner_display_name: "Dave",
      }],
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/action-items/ai-1" });

    const auditCall = mockDbQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO audit_log"),
    );
    expect(auditCall).toBeDefined();
    const metadata = JSON.parse(auditCall![1][5] as string);
    expect(metadata.action_item_id).toBe("ai-1");
  });
});

// ---------------------------------------------------------------------------
// Write-rejection for EM (task 5.7):
// EM users cannot write to action items or topic configurations.
// These tests confirm that the application correctly rejects write attempts
// from EM-facing paths. The handlers are GET-only — Fastify will return 404
// for unregistered method+path combinations, which naturally rejects POST/PUT/DELETE
// on /em/* paths (no handler = no access).
// ---------------------------------------------------------------------------
describe("EM write-rejection (task 5.7)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POST to em/action-items path returns 404 (no write handler registered)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/em/action-items",
      payload: { description: "New item" },
    });
    // No route registered for POST — 404 is the rejection
    expect(res.statusCode).toBe(404);
  });

  it("DELETE to em/sessions path returns 404 (no write handler registered)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/teams/team-1/em/sessions/sess-1",
    });
    expect(res.statusCode).toBe(404);
  });
});
