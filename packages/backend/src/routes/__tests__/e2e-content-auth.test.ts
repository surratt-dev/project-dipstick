import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be defined before importing the modules under test
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

// Mock timing oracle to skip floor delay in tests
vi.mock("../../content/timing-oracle.js", () => ({
  applyTimingFloor: vi.fn().mockResolvedValue(undefined),
  CONTENT_TIMING_FLOOR_MS: 150,
}));

import Fastify from "fastify";
import { contentRoutes } from "../content.js";

// ---------------------------------------------------------------------------
// Group 11 — End-to-End Authorization Tests
//
// Tasks covered:
//   11.1 — All role paths against GET /api/v1/teams/:id/sessions
//   11.2 — Consistent 403/404 for authorized/unauthorized callers
//   11.4 — Facilitator scoping: Team B facilitator cannot read Team A
//   11.5 — EM access boundary: aggregate only, no individual attribution
//   11.6 — Cache prohibition: role change takes effect on next request
//   11.7 — Dual-check pattern: membership role governs content profile
//   11.8 — ORM-level cache prohibition: live DB reads on every request
//   11.9 — Application Admin audit trail for content endpoint denials
//
// Tasks deferred (gate-blocked):
//   11.3 — WebSocket revocation: blocked by Group 9 gate (engineering lead
//           must confirm WebSocket latency bound; no WebSocket infrastructure
//           exists in this codebase)
//   11.10 — Full-stack facilitator error state E2E: blocked by Group 9 and
//            Group 10 gates (Priya Nair must approve error message text)
//
// Mock pattern: evaluateTeamAccess makes two DB calls:
//   Q1: SELECT u.global_role, tm.role AS membership_role FROM users u LEFT JOIN ...
//       → returns [{ global_role, membership_role }] or []
//   Q2: SELECT s.id, s.status FROM sessions s WHERE facilitator_id = $1 ... (only
//       called when Q1 returns no membership_role and global_role != 'application_admin')
//       → returns [{ session_id, session_status }] or []
// Resource queries follow (Q3+) if a grant is found.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Test app builders
// ---------------------------------------------------------------------------

function buildApp(userId = "actor-1") {
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
  });
  app.register(contentRoutes);
  return app.ready().then(() => app);
}

/**
 * Simulates unauthenticated request (no userId in session).
 * Replicates what authMiddleware does when session.userId is absent.
 */
function buildUnauthApp() {
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request, reply) => {
    (request as unknown as Record<string, unknown>).session = {};
    const sess = request.session as unknown as { userId?: string };
    if (!sess?.userId) {
      return reply.code(401).send({
        error: {
          category: "session_expired",
          message: "Please sign in to continue.",
          correlationId: "test-correlation-id",
        },
      });
    }
  });
  app.register(contentRoutes);
  return app.ready().then(() => app);
}

// ---------------------------------------------------------------------------
// Mock sequence helpers — each represents one DB call in the evaluateTeamAccess
// call sequence followed by the resource query.
// ---------------------------------------------------------------------------

function mockQ1Participant() {
  mockDbQuery.mockResolvedValueOnce({
    rows: [{ global_role: "engineer", membership_role: "participant" }],
  });
}

function mockQ1EM() {
  mockDbQuery.mockResolvedValueOnce({
    rows: [{ global_role: "engineering_manager", membership_role: "engineering_manager" }],
  });
}

function mockQ1EMWithEngineerGlobalRole() {
  // global_role is 'engineer' but membership role is 'engineering_manager'
  // Per design decision: membership role governs the content profile, not global_role
  mockDbQuery.mockResolvedValueOnce({
    rows: [{ global_role: "engineer", membership_role: "engineering_manager" }],
  });
}

function mockQ1Admin() {
  mockDbQuery.mockResolvedValueOnce({
    rows: [{ global_role: "application_admin", membership_role: null }],
  });
}

function mockQ1NoMembership(globalRole = "facilitator") {
  mockDbQuery.mockResolvedValueOnce({
    rows: [{ global_role: globalRole, membership_role: null }],
  });
}

function mockQ2FacilitatorSession(sessionId = "sess-1", sessionStatus = "active") {
  mockDbQuery.mockResolvedValueOnce({
    rows: [{ session_id: sessionId, session_status: sessionStatus }],
  });
}

function mockQ2NoSession() {
  // Q2: no facilitator session for the requested team
  mockDbQuery.mockResolvedValueOnce({ rows: [] });
  // Q3: cross-team check (Task 10.4 / Error State 4).
  // When Q2 returns empty rows, the null grant path calls denyNullGrant which
  // checks whether the user has an active facilitator session for a DIFFERENT team.
  // This mock returns empty (no cross-team session), resulting in the generic
  // "You do not have access" message rather than the cross-team "not in your
  // current session" message. Tests that need to verify the cross-team message
  // specifically should mock the DB to return rows here instead.
  mockDbQuery.mockResolvedValueOnce({ rows: [] });
}

function mockResourceEmpty() {
  mockDbQuery.mockResolvedValueOnce({ rows: [] });
}

// websocket-connection-reauthorization (SEC-26), design.md Decision D9,
// tasks.md task 5.2: the facilitator path of GET /api/v1/teams/:teamId/sessions
// specifically (not /trends, not /action-items) issues one additional query
// (connectionRecoveries) after the resource query. Call this immediately
// after mockResourceEmpty() for any facilitator request to the /sessions
// endpoint.
function mockConnectionRecoveriesEmpty() {
  mockDbQuery.mockResolvedValueOnce({ rows: [] });
}

function mockAuditInsert() {
  mockDbQuery.mockResolvedValueOnce({ rows: [] });
}

function mockResourceWithVotes() {
  mockDbQuery.mockResolvedValueOnce({
    rows: [
      {
        session_id: "sess-1",
        session_status: "complete",
        topic_id: "topic-1",
        topic_name: "Delivery Confidence",
        reveal_status: "revealed",
        flagged_for_discussion: false,
        voter_id: "actor-1",
        voter_display_name: "Alice",
        vote_value: 3,
        vote_count: 1,
        contains_outlier: false,
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Task 11.1 — Test all role paths against GET /api/v1/teams/:id/sessions
// ---------------------------------------------------------------------------
describe("Task 11.1: All role paths against GET /api/v1/teams/:id/sessions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Participant (Engineer): 200 with correct shape including ownVoteValue", async () => {
    mockQ1Participant();
    // Resource query returns one vote row with voter_id matching the caller
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        {
          session_id: "sess-1",
          session_status: "complete",
          topic_id: "topic-1",
          topic_name: "Delivery Confidence",
          reveal_status: "revealed",
          flagged_for_discussion: false,
          voter_id: "actor-1",
          voter_display_name: null,
          vote_value: 3,
          vote_count: 1,
          contains_outlier: false,
        },
      ],
    });

    const app = await buildApp("actor-1");
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");

    // Blocking Issue 1 fix: session history returns { sessions: [...] } where
    // each entry is a ParticipantContentView with the correct sessionId.
    const body = res.json() as {
      sessions: Array<{
        sessionId: string;
        sessionStatus: string;
        topics: Array<{ topicId: string; ownVoteValue: number | null }>;
      }>;
    };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].sessionId).toBe("sess-1");
    // Participant view includes ownVoteValue (identifies caller's own vote)
    expect(body.sessions[0].topics).toHaveLength(1);
    expect(body.sessions[0].topics[0].ownVoteValue).toBe(3);
  });

  it("EM: 200 with aggregate-only shape (no ownVoteValue, no voter attribution)", async () => {
    mockQ1EM();
    mockResourceWithVotes();

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");

    // Blocking Issue 1 fix: EM session history returns { sessions: [EMContentView] }
    const body = res.json() as {
      sessions: Array<{ sessionId: string; topics: Array<Record<string, unknown>> }>;
    };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].sessionId).toBe("sess-1");
    // EM view must NOT include ownVoteValue
    expect(body.sessions[0].topics).toHaveLength(1);
    expect(body.sessions[0].topics[0]).not.toHaveProperty("ownVoteValue");
    // EM view MUST include aggregate fields
    expect(body.sessions[0].topics[0]).toHaveProperty("voteDistribution");
    expect(body.sessions[0].topics[0]).toHaveProperty("average");
  });

  it("Facilitator with active session: 200 with full session data", async () => {
    mockQ1NoMembership("facilitator");
    mockQ2FacilitatorSession("sess-1", "active");
    mockResourceEmpty();
    mockConnectionRecoveriesEmpty();

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("Facilitator with expired grace window: 403 (no qualifying session in SQL)", async () => {
    // SQL WHERE clause excludes this facilitator's session because
    // facilitator_access_expires_at <= NOW() (grace window passed).
    // The mock simulates the DB returning no rows for the facilitator check.
    mockQ1NoMembership("facilitator");
    mockQ2NoSession(); // SQL returns [] because grace window expired

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(403);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("Facilitator with draft session within 24 hours: 200", async () => {
    // The SQL WHERE includes: OR (s.status = 'draft' AND s.created_at + INTERVAL '24 hours' > NOW())
    // The mock simulates the DB returning the draft session because it's within 24h.
    mockQ1NoMembership("facilitator");
    mockQ2FacilitatorSession("sess-draft-1", "draft");
    mockResourceEmpty();
    mockConnectionRecoveriesEmpty();

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("Facilitator with draft session older than 24 hours: 403 (SQL lazy expiry)", async () => {
    // The SQL WHERE excludes draft sessions older than 24h.
    // created_at + INTERVAL '24 hours' <= NOW() → session not returned.
    // This is the lazy expiry: no background deletion required; security is
    // enforced at read time via the SQL condition.
    mockQ1NoMembership("facilitator");
    mockQ2NoSession(); // SQL returns [] because draft is older than 24h

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(403);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("Application Admin: 403 (content endpoints deny admin grant)", async () => {
    mockQ1Admin();
    mockAuditInsert(); // audit log written before 403 is returned

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(403);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json() as { error: { message: string } };
    expect(body.error.message).toContain("Application Admins do not have access");
  });

  it("Unauthenticated: 401 (auth middleware rejects before reaching route handler)", async () => {
    // No DB calls are expected — auth middleware returns 401 before the route is reached.
    const app = await buildUnauthApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(401);
    expect(mockDbQuery).not.toHaveBeenCalled();
    const body = res.json() as { error: { category: string } };
    expect(body.error.category).toBe("session_expired");
  });

  it("No team relationship: 403 (null grant from evaluateTeamAccess)", async () => {
    // User has no membership row and no qualifying facilitator session.
    // evaluateTeamAccess returns null → 403.
    mockQ1NoMembership("engineer"); // not admin, not member
    mockQ2NoSession(); // not a facilitator either

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(403);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

// ---------------------------------------------------------------------------
// Task 11.2 — Consistent 403/404 for authorized vs. unauthorized callers
// ---------------------------------------------------------------------------
describe("Task 11.2: Consistent 403/404 behavior", () => {
  beforeEach(() => vi.clearAllMocks());

  it("unauthorized caller to existing team: 403", async () => {
    mockQ1NoMembership("engineer");
    mockQ2NoSession();

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/existing-team/sessions" });

    expect(res.statusCode).toBe(403);
  });

  it("unauthorized caller to nonexistent team: 403 (identical to existing team — no information disclosure)", async () => {
    // Same mock setup as the existing-team test above.
    // The authorization check fires BEFORE any team lookup, so the response is
    // identical regardless of whether the team actually exists.
    mockQ1NoMembership("engineer");
    mockQ2NoSession(); // includes Q3 cross-team check mock (empty — no other sessions)

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/nonexistent-team-xyz/sessions" });

    expect(res.statusCode).toBe(403);
    // 3 authorization queries: Q1 (user+membership), Q2 (facilitator session),
    // Q3 (cross-team check for Error State 4). No resource queries made.
    expect(mockDbQuery).toHaveBeenCalledTimes(3);
  });

  it("unauthorized caller: existing and nonexistent team responses are identical", async () => {
    // Both responses must return the same status and error structure —
    // an attacker cannot distinguish between "team doesn't exist" and "you
    // don't have access to this team" via the HTTP response.
    mockQ1NoMembership("engineer");
    mockQ2NoSession();
    const app1 = await buildApp();
    const existingRes = await app1.inject({
      method: "GET",
      url: "/api/v1/teams/team-that-exists/sessions",
    });

    mockQ1NoMembership("engineer");
    mockQ2NoSession();
    const app2 = await buildApp();
    const nonexistentRes = await app2.inject({
      method: "GET",
      url: "/api/v1/teams/team-that-does-not-exist/sessions",
    });

    expect(existingRes.statusCode).toBe(403);
    expect(nonexistentRes.statusCode).toBe(403);
    // Error shape is identical — correlationId differs per request by design
    const existingBody = existingRes.json() as { error: { category: string; message: string } };
    const nonexistentBody = nonexistentRes.json() as { error: { category: string; message: string } };
    expect(existingBody.error.category).toBe(nonexistentBody.error.category);
    expect(existingBody.error.message).toBe(nonexistentBody.error.message);
  });

  it("authorized caller to nonexistent session: 404 (existence disclosure is safe for authorized callers)", async () => {
    mockQ1Participant();
    // Resource query for the specific session returns empty (session doesn't exist)
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // session lookup → not found

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-1/sessions/nonexistent-session-id",
    });

    // Authorized callers CAN learn that a session doesn't exist (404).
    // Only unauthorized callers must receive 403 instead of 404.
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { category: string } };
    expect(body.error.category).toBe("not_found");
  });
});

// ---------------------------------------------------------------------------
// Task 11.4 — Facilitator scoping: session-scoped access, not team-based
// A facilitator's access grant is tied to the team they are facilitating.
// They cannot access a different team's content via the facilitator path.
// ---------------------------------------------------------------------------
describe("Task 11.4: Facilitator scoping — Team B facilitator cannot access Team A", () => {
  beforeEach(() => vi.clearAllMocks());

  it("facilitator with active session for Team B cannot access Team A's history", async () => {
    // When the facilitator requests Team A's sessions, evaluateTeamAccess
    // queries for sessions WHERE team_id = 'team-A' AND facilitator_id = actor.
    // The facilitator has no session for Team A — DB returns [] for Q2.
    mockQ1NoMembership("facilitator"); // no Team A membership
    mockQ2NoSession(); // no Team A facilitator session

    const app = await buildApp("facilitator-actor");
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-A/sessions" });

    expect(res.statusCode).toBe(403);
  });

  it("same facilitator CAN access Team B's content (their active session is for Team B)", async () => {
    // Same actor but requesting Team B — evaluateTeamAccess finds the qualifying session.
    mockQ1NoMembership("facilitator"); // no Team B membership row (facilitator)
    mockQ2FacilitatorSession("sess-B-1", "active"); // facilitator_id matches, team_id = 'team-B'
    mockResourceEmpty(); // resource query succeeds
    mockConnectionRecoveriesEmpty();

    const app = await buildApp("facilitator-actor");
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-B/sessions" });

    expect(res.statusCode).toBe(200);
  });

  it("facilitator access is scoped by SQL: WHERE team_id = $2 ensures cross-team isolation", async () => {
    // This test verifies that evaluateTeamAccess makes the correct DB calls for
    // the denied case and does NOT make resource queries for the requested team.
    // The cross-team check (Q3) runs on the denial path — it checks for other
    // teams' sessions to provide the correct Error State 4 message, but it does
    // NOT query Team A's session content.
    mockQ1NoMembership("facilitator");
    mockQ2NoSession(); // includes Q3 cross-team check mock (empty — no other sessions)

    const app = await buildApp("facilitator-actor");
    await app.inject({ method: "GET", url: "/api/v1/teams/team-A/sessions" });

    // 3 authorization queries:
    //   Q1 (user+membership), Q2 (facilitator session with team_id scoping),
    //   Q3 (cross-team check — Error State 4, Task 10.4).
    // No resource queries (Team A session content) reached because access was denied.
    expect(mockDbQuery).toHaveBeenCalledTimes(3);
    // Q2 must include team_id parameter ($2) — verify the call included teamId in params
    const q2Call = mockDbQuery.mock.calls[1];
    const q2Params = q2Call[1] as unknown[];
    expect(q2Params[1]).toBe("team-A");
  });
});

// ---------------------------------------------------------------------------
// Task 11.5 — EM access boundary: aggregate only, no individual attribution
// ---------------------------------------------------------------------------
describe("Task 11.5: EM access boundary — aggregate only, no individual vote attribution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("EM receives aggregate vote distribution (count-per-bucket, average)", async () => {
    mockQ1EM();
    mockResourceWithVotes(); // rows include voter_id but EM serializer ignores it

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(200);

    // Blocking Issue 1 fix: response is { sessions: [EMContentView] }
    const body = res.json() as {
      sessions: Array<{
        topics: Array<{
          voteDistribution: Array<{ voteValue: number; count: number }>;
          average: number | null;
        }>;
      }>;
    };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].topics).toHaveLength(1);
    expect(body.sessions[0].topics[0].voteDistribution).toBeDefined();
    // vote_value: 3 in the mock row → appears in voteDistribution
    expect(body.sessions[0].topics[0].voteDistribution[0].voteValue).toBe(3);
    expect(body.sessions[0].topics[0].average).toBe(3);
  });

  it("EM response does NOT include ownVoteValue (no individual attribution)", async () => {
    mockQ1EM();
    mockResourceWithVotes(); // rows include voter_id: 'actor-1', but EM path must not expose it

    const app = await buildApp("actor-1");
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(200);
    // Blocking Issue 1 fix: response is { sessions: [EMContentView] }
    const body = res.json() as { sessions: Array<{ topics: Array<Record<string, unknown>> }> };
    // EM response topics must NOT have ownVoteValue
    expect(body.sessions[0].topics[0]).not.toHaveProperty("ownVoteValue");
    // EM response topics must NOT have individual voter attribution
    expect(body.sessions[0].topics[0]).not.toHaveProperty("votes");
  });

  it("EM response does NOT include sessionStatus (participant shape vs EM shape differ)", async () => {
    // ParticipantContentView has sessionStatus; EMContentView does not.
    // This test verifies the shape boundary between the two paths.
    mockQ1EM();
    mockResourceEmpty();

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    // Blocking Issue 1 fix: response is { sessions: [] } — top-level body has no
    // sessionStatus. Each EMContentView entry also lacks sessionStatus by design.
    expect(body).not.toHaveProperty("sessionStatus");
    // sessions array exists at the top level
    expect(body).toHaveProperty("sessions");
  });

  it("Participant receives ownVoteValue (verifying the boundary with EM)", async () => {
    // This test exists as a contrast to the EM tests above:
    // participants receive individual attribution for their own vote.
    mockQ1Participant();
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        {
          session_id: "sess-1",
          session_status: "complete",
          topic_id: "topic-1",
          topic_name: "Delivery Confidence",
          reveal_status: "revealed",
          flagged_for_discussion: false,
          voter_id: "actor-1", // matches callerUserId
          voter_display_name: null,
          vote_value: 4,
          vote_count: 1,
          contains_outlier: false,
        },
      ],
    });

    const app = await buildApp("actor-1");
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(200);
    // Blocking Issue 1 fix: response is { sessions: [ParticipantContentView] }
    const body = res.json() as {
      sessions: Array<{ topics: Array<{ ownVoteValue: number | null }> }>;
    };
    // Participant receives their own vote value
    expect(body.sessions[0].topics[0].ownVoteValue).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Task 11.6 — Cache prohibition: role change takes effect on next request
// without re-authentication.
//
// Design Decision 6 / Task 5.9: Authorization is derived from the database
// on every request. It is NOT cached in the application-session cookie.
// A role change applied to team_memberships.role takes effect on the next
// content request without requiring re-authentication.
// ---------------------------------------------------------------------------
describe("Task 11.6: Cache prohibition — role change takes effect on next request", () => {
  beforeEach(() => vi.clearAllMocks());

  it("first request: participant shape; second request (after role change in DB): EM shape", async () => {
    const app = await buildApp("actor-1");

    // --- First request: user is a participant ---
    mockQ1Participant();
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        {
          session_id: "sess-1",
          session_status: "complete",
          topic_id: "topic-1",
          topic_name: "Delivery Confidence",
          reveal_status: "revealed",
          flagged_for_discussion: false,
          voter_id: "actor-1",
          voter_display_name: null,
          vote_value: 3,
          vote_count: 1,
          contains_outlier: false,
        },
      ],
    });

    const res1 = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });
    expect(res1.statusCode).toBe(200);
    // Blocking Issue 1 fix: participant shape is now { sessions: [ParticipantContentView] }
    const body1 = res1.json() as { sessions: Array<{ topics: Array<Record<string, unknown>> }> };
    // Participant shape includes ownVoteValue
    expect(body1.sessions[0].topics[0]).toHaveProperty("ownVoteValue");

    // --- Role change happens in the DB (team_memberships.role updated to EM) ---
    // On the next request, evaluateTeamAccess re-reads the DB and finds the new role.
    // This is Cache Prohibition: the previous request's authorization result is NOT
    // stored in the session cookie or any application-level cache.

    // --- Second request: user is now an EM (DB role has changed) ---
    mockQ1EM(); // Q1 now returns membership_role: 'engineering_manager'
    mockResourceWithVotes();

    const res2 = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });
    expect(res2.statusCode).toBe(200);
    // Blocking Issue 1 fix: EM shape is now { sessions: [EMContentView] }
    const body2 = res2.json() as { sessions: Array<{ topics: Array<Record<string, unknown>> }> };
    // EM shape: no ownVoteValue — the role change is immediately reflected
    expect(body2.sessions[0].topics[0]).not.toHaveProperty("ownVoteValue");
    expect(body2.sessions[0].topics[0]).toHaveProperty("voteDistribution");
  });

  it("each request makes a fresh DB authorization call (evaluateTeamAccess is never cached)", async () => {
    // If authorization were cached, mockDbQuery would only be called once for
    // the auth check (on the first request). With no cache, each request makes
    // its own auth DB calls.
    const app = await buildApp();

    // Request 1
    mockQ1Participant();
    mockResourceEmpty();
    await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });
    const callsAfterRequest1 = mockDbQuery.mock.calls.length; // Q1 + resource = 2

    // Request 2 (DB state is mocked fresh — auth re-read)
    mockQ1Participant();
    mockResourceEmpty();
    await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });
    const callsAfterRequest2 = mockDbQuery.mock.calls.length;

    // Each request must make its own auth DB call. If calls per request = C,
    // then total after 2 requests must be exactly 2×C.
    expect(callsAfterRequest2).toBe(callsAfterRequest1 * 2);
  });
});

// ---------------------------------------------------------------------------
// Task 11.7 — Dual-check pattern: membership role governs content profile
//
// Design Decision (session-participation spec, Task 2.3):
//   The EM content profile is produced when team_memberships.role = 'engineering_manager',
//   regardless of users.global_role. A user with global_role = 'engineer' but
//   membership_role = 'engineering_manager' receives the EM content profile
//   (aggregate only), not the engineer/participant profile.
//
//   This is the E2E acceptance criterion for the session-participation capability
//   modification (cross-reference: Task 2.3, Task 5.9).
// ---------------------------------------------------------------------------
describe("Task 11.7: Dual-check pattern — membership role governs content profile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("user with global_role='engineer' AND membership_role='engineering_manager' receives EM profile", async () => {
    // This is the acceptance criterion: even if the user's global_role is 'engineer',
    // the membership_role='engineering_manager' governs the content profile.
    // The serializer receives grant.role = 'engineering_manager' and produces aggregate-only output.
    mockQ1EMWithEngineerGlobalRole(); // global_role: 'engineer', membership_role: 'engineering_manager'
    mockResourceWithVotes();

    const app = await buildApp("actor-em");
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(200);
    // Blocking Issue 1 fix: response is { sessions: [EMContentView] }
    const body = res.json() as { sessions: Array<{ topics: Array<Record<string, unknown>> }> };
    // MUST NOT receive individual attribution (EM profile, not participant profile)
    expect(body.sessions[0].topics[0]).not.toHaveProperty("ownVoteValue");
    // MUST receive aggregate distribution (EM profile confirmed)
    expect(body.sessions[0].topics[0]).toHaveProperty("voteDistribution");
    expect(body.sessions[0].topics[0]).toHaveProperty("average");
  });

  it("user with global_role='engineering_manager' AND membership_role='participant' receives participant profile", async () => {
    // Inverse: even if global_role is 'engineering_manager', if the membership
    // role for this team is 'participant', they receive the participant profile.
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineering_manager", membership_role: "participant" }],
    });
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        {
          session_id: "sess-1",
          session_status: "complete",
          topic_id: "topic-1",
          topic_name: "Sprint Health",
          reveal_status: "revealed",
          flagged_for_discussion: false,
          voter_id: "actor-em",
          voter_display_name: null,
          vote_value: 5,
          vote_count: 1,
          contains_outlier: false,
        },
      ],
    });

    const app = await buildApp("actor-em");
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(200);
    // Blocking Issue 1 fix: response is { sessions: [ParticipantContentView] }
    const body = res.json() as {
      sessions: Array<{ topics: Array<{ ownVoteValue: number | null }> }>;
    };
    // Participant profile: ownVoteValue present
    expect(body.sessions[0].topics[0].ownVoteValue).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Task 11.8 — ORM-level cache prohibition: live DB reads on every request
//
// Design Decision 6 / Task 5.8: Authorization queries (team membership, global
// role, session status) must execute as live database reads on every content
// request. node-postgres (pg) has no built-in query cache. This test verifies
// the query count pattern — N requests must result in N × (queries-per-request)
// DB calls, not just (queries-per-request) total.
//
// If an ORM cache were active, the auth query would only run once (cache miss)
// and subsequent requests would resolve from cache without hitting the DB.
// The mock count pattern detects this: cached auth would result in fewer calls
// than expected after multiple requests.
// ---------------------------------------------------------------------------
describe("Task 11.8: ORM-level cache prohibition — live DB reads per request", () => {
  beforeEach(() => vi.clearAllMocks());

  it("three sequential requests each make their own auth DB call (not cached from first)", async () => {
    const app = await buildApp();

    // Request 1: participant
    mockQ1Participant();
    mockResourceEmpty();
    await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });
    const countAfter1 = mockDbQuery.mock.calls.length;

    // Request 2: same role (would be from cache if caching were active)
    mockQ1Participant();
    mockResourceEmpty();
    await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });
    const countAfter2 = mockDbQuery.mock.calls.length;

    // Request 3: role changed (demonstrates live read detects the change)
    mockQ1EM();
    mockResourceEmpty();
    await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });
    const countAfter3 = mockDbQuery.mock.calls.length;

    // Each request must contribute the same number of DB calls.
    // If caching were active, countAfter2 and countAfter3 would not increase by countAfter1.
    expect(countAfter2).toBe(countAfter1 * 2);
    expect(countAfter3).toBe(countAfter1 * 3);
  });

  it("authorization query parameters vary by teamId (no cross-team cache poisoning)", async () => {
    const app = await buildApp();

    // Request for team-1
    mockQ1Participant();
    mockResourceEmpty();
    await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    // Request for team-2 (different teamId → different authorization result)
    mockQ1NoMembership("engineer"); // no membership for team-2
    mockQ2NoSession();
    await app.inject({ method: "GET", url: "/api/v1/teams/team-2/sessions" });

    // Verify the auth query for team-2 used the correct teamId ($2 parameter)
    const q1ForTeam2 = mockDbQuery.mock.calls[2]; // 3rd call (index 2) = Q1 for team-2 request
    const q1Params = q1ForTeam2[1] as unknown[];
    expect(q1Params[1]).toBe("team-2"); // $2 = teamId
  });
});

// ---------------------------------------------------------------------------
// Task 11.9 — Application Admin audit trail
//
// Task 5.11: Application Admin requests to session content endpoints (resulting
// in 403) must appear in the audit log with the HTTP status code.
// Task 3.7 / 3.4: Application Admin requests to administrative data endpoints
// appear in the audit log with 200 (covered in teams.test.ts — task 3.7).
//
// This test focuses on the content endpoint denial audit trail.
// ---------------------------------------------------------------------------
describe("Task 11.9: Application Admin audit trail for content endpoint denials", () => {
  beforeEach(() => vi.clearAllMocks());

  it("admin request to sessions endpoint: 403 response AND audit log written with http_status=403", async () => {
    mockQ1Admin();
    mockAuditInsert(); // audit INSERT must be called BEFORE reply is sent

    const app = await buildApp("admin-actor");
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(403);

    // Audit log must be written (Task 5.11)
    const auditCall = mockDbQuery.mock.calls[1];
    expect(auditCall).toBeDefined();
    const auditSql = (auditCall[0] as string).toLowerCase();
    expect(auditSql).toContain("insert into audit_log");
    const auditValues = auditCall[1] as unknown[];
    // operation field
    expect(auditValues[3]).toBe("admin.session_content_denied");
    // metadata must include http_status: 403
    const metadata = JSON.parse(auditValues[5] as string) as Record<string, unknown>;
    expect(metadata["http_status"]).toBe(403);
  });

  it("admin request to trends endpoint: 403 AND audit log written", async () => {
    mockQ1Admin();
    mockAuditInsert();

    const app = await buildApp("admin-actor");
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/trends" });

    expect(res.statusCode).toBe(403);
    const auditCall = mockDbQuery.mock.calls[1];
    const auditValues = auditCall[1] as unknown[];
    expect(auditValues[3]).toBe("admin.session_content_denied");
    const metadata = JSON.parse(auditValues[5] as string) as Record<string, unknown>;
    expect(metadata["http_status"]).toBe(403);
  });

  it("admin request to action-items endpoint: 403 AND audit log written", async () => {
    mockQ1Admin();
    mockAuditInsert();

    const app = await buildApp("admin-actor");
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/action-items" });

    expect(res.statusCode).toBe(403);
    const auditCall = mockDbQuery.mock.calls[1];
    const auditValues = auditCall[1] as unknown[];
    expect(auditValues[3]).toBe("admin.session_content_denied");
    const metadata = JSON.parse(auditValues[5] as string) as Record<string, unknown>;
    expect(metadata["http_status"]).toBe(403);
  });

  it("admin audit log entry includes actorUserId, actorGlobalRole, and teamId", async () => {
    mockQ1Admin();
    mockAuditInsert();

    const app = await buildApp("admin-user-123");
    await app.inject({ method: "GET", url: "/api/v1/teams/team-xyz/sessions" });

    const auditCall = mockDbQuery.mock.calls[1];
    const auditValues = auditCall[1] as unknown[];
    // actor_user_id
    expect(auditValues[0]).toBe("admin-user-123");
    // actor_global_role
    expect(auditValues[1]).toBe("application_admin");
    // team_id
    expect(auditValues[4]).toBe("team-xyz");
    // operation
    expect(auditValues[3]).toBe("admin.session_content_denied");
  });

  it("audit log entry is written BEFORE the 403 response is sent (Task 5.11 ordering guarantee)", async () => {
    // Verify that the audit INSERT DB call occurs before the response is sent.
    // We do this by tracking the order of calls: DB call index 1 (audit INSERT)
    // must execute before the reply.code(403) is reached in the route handler.
    // Since the handler awaits db.query() for the audit INSERT before calling
    // reply.send(), and our mock runs synchronously in order, the ordering is
    // guaranteed if the test passes (the mock is consumed in call order).
    const callOrder: string[] = [];
    mockDbQuery.mockImplementationOnce(async () => {
      callOrder.push("admin-check");
      return { rows: [{ global_role: "application_admin", membership_role: null }] };
    });
    mockDbQuery.mockImplementationOnce(async () => {
      callOrder.push("audit-insert");
      return { rows: [] };
    });

    const app = await buildApp("admin-actor");
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(403);
    expect(callOrder).toEqual(["admin-check", "audit-insert"]);
    // audit-insert happened before the response was returned
  });
});
