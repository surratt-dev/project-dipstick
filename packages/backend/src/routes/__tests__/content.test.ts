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

// Mock the timing oracle to skip the floor delay in tests
const mockApplyTimingFloor = vi.fn().mockResolvedValue(undefined);
vi.mock("../../content/timing-oracle.js", () => ({
  applyTimingFloor: (...args: unknown[]) => mockApplyTimingFloor(...args),
  CONTENT_TIMING_FLOOR_MS: 150,
}));

import Fastify from "fastify";
import { contentRoutes } from "../content.js";

// ---------------------------------------------------------------------------
// Test helpers
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
 * Mock evaluateTeamAccess by controlling the db.query responses.
 * The helper's first query is the user+membership query.
 * The helper's second query (if needed) is the facilitator session query.
 */
function mockMemberGrant(role: "participant" | "engineering_manager") {
  // user+membership query
  mockDbQuery.mockResolvedValueOnce({
    rows: [{ global_role: "engineer", membership_role: role }],
  });
}

function mockAdminGrant() {
  mockDbQuery.mockResolvedValueOnce({
    rows: [{ global_role: "application_admin", membership_role: null }],
  });
}

function mockFacilitatorGrant(sessionId = "session-1", sessionStatus = "active") {
  // user+membership: no membership row
  mockDbQuery.mockResolvedValueOnce({
    rows: [{ global_role: "facilitator", membership_role: null }],
  });
  // facilitator session query: returns a session
  mockDbQuery.mockResolvedValueOnce({
    rows: [{ session_id: sessionId, session_status: sessionStatus }],
  });
}

function mockNoGrant() {
  // user exists but no membership
  mockDbQuery.mockResolvedValueOnce({
    rows: [{ global_role: "engineer", membership_role: null }],
  });
  // no facilitator session for the requested team
  mockDbQuery.mockResolvedValueOnce({ rows: [] });
  // cross-team check (Error State 4 / Task 10.4): no active session for other teams
  // When this returns empty, the generic "You do not have access" message is returned.
  mockDbQuery.mockResolvedValueOnce({ rows: [] });
}

// ---------------------------------------------------------------------------
// GET /api/v1/teams/:teamId/sessions
// Task 5.1 / Task 5.12
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/:teamId/sessions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 when caller has no relationship to the team (null grant)", async () => {
    mockNoGrant();

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(403);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("returns 403 and writes audit log for Application Admin request (Task 5.12)", async () => {
    // Admin grant
    mockAdminGrant();
    // Audit log INSERT
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    // Task 5.12: Application Admin gets 403 on session history
    expect(res.statusCode).toBe(403);
    expect(res.headers["cache-control"]).toBe("no-store");

    // Task 5.11: Audit log MUST be written for denied admin access
    const auditCall = mockDbQuery.mock.calls[1]; // 2nd query call is the audit INSERT
    expect(auditCall).toBeDefined();
    const auditSql = (auditCall[0] as string).toLowerCase();
    expect(auditSql).toContain("audit_log");
    const auditValues = auditCall[1] as unknown[];
    expect(auditValues[3]).toBe("admin.session_content_denied");
    // Audit entry includes HTTP status code
    const metadata = JSON.parse(auditValues[5] as string) as Record<string, unknown>;
    expect(metadata["http_status"]).toBe(403);
  });

  it("returns 200 with Cache-Control: no-store for a team member (participant)", async () => {
    mockMemberGrant("participant");
    // Sessions query result (empty for this test)
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(200);
    // Task 5.7: Cache-Control: no-store on all content responses
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("returns 200 for EM member with no-store header", async () => {
    mockMemberGrant("engineering_manager");
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("returns 200 for facilitator with no-store header", async () => {
    mockFacilitatorGrant();
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // session-history query
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // connectionRecoveries query

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  // -------------------------------------------------------------------------
  // websocket-connection-reauthorization (SEC-26), design.md Decision D9,
  // tasks.md task 5.2: the facilitator session-history response's
  // connectionRecoveries field, and its non-disclosure filter.
  // -------------------------------------------------------------------------
  it("includes SEC-26 connectionRecoveries for a facilitator, filtered explicitly to session.connection_recovered (task 5.2)", async () => {
    mockFacilitatorGrant("session-1");
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // session-history query
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        { actor_user_id: "user-a", timestamp: new Date("2026-01-01T00:00:00.000Z") },
        { actor_user_id: "user-b", timestamp: new Date("2026-01-01T00:05:00.000Z") },
      ],
    });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as { connectionRecoveries: Array<{ userId: string; recoveredAt: string }> };
    expect(body.connectionRecoveries).toEqual([
      { userId: "user-a", recoveredAt: "2026-01-01T00:00:00.000Z" },
      { userId: "user-b", recoveredAt: "2026-01-01T00:05:00.000Z" },
    ]);

    // Non-disclosure guard: the query must filter explicitly to
    // operation = 'session.connection_recovered' — never a wildcard/prefix
    // match that could also surface session.access_revoked_live or
    // session.token_refresh_failed_live rows.
    const recoveriesCall = mockDbQuery.mock.calls[3]!;
    const sql = (recoveriesCall[0] as string).toLowerCase();
    expect(sql).toContain("operation = 'session.connection_recovered'");
    expect(sql).not.toContain("like");
    expect(sql).not.toContain("session.%");
  });

  it("never returns session.access_revoked_live or session.token_refresh_failed_live rows in connectionRecoveries", async () => {
    mockFacilitatorGrant("session-1");
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // session-history query
    // The mocked db layer only ever returns what the (correctly-scoped) SQL
    // WHERE clause would select — simulating the DB actually enforcing the
    // filter. A wildcard/wrong query would need no code change to "leak"
    // here, since this test controls what the mock returns; the real
    // non-disclosure guarantee is the string assertion in the previous test.
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ actor_user_id: "user-a", timestamp: new Date("2026-01-01T00:00:00.000Z") }],
    });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });
    const body = JSON.parse(res.payload) as { connectionRecoveries: Array<{ userId: string }> };

    expect(body.connectionRecoveries).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("access_revoked_live");
    expect(JSON.stringify(body)).not.toContain("token_refresh_failed_live");
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/teams/:teamId/trends
// Task 5.2 / Task 5.12
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/:teamId/trends", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 for null grant", async () => {
    mockNoGrant();

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/trends" });

    expect(res.statusCode).toBe(403);
  });

  it("returns 403 and writes audit log for Application Admin (Task 5.12)", async () => {
    mockAdminGrant();
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // audit INSERT

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/trends" });

    expect(res.statusCode).toBe(403);

    // Verify audit log was written
    const auditCall = mockDbQuery.mock.calls[1];
    const auditValues = auditCall[1] as unknown[];
    expect(auditValues[3]).toBe("admin.session_content_denied");
  });

  it("returns 200 with no-store for member", async () => {
    mockMemberGrant("participant");
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/trends" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/teams/:teamId/action-items
// Task 5.3 / Task 5.12
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/:teamId/action-items", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 for Application Admin on action items (Task 5.12)", async () => {
    mockAdminGrant();
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // audit INSERT

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/action-items" });

    expect(res.statusCode).toBe(403);
  });

  it("returns 200 with no-store for member", async () => {
    mockMemberGrant("participant");
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/action-items" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/teams/:teamId/topics
// topic-customization-lock-and-add-custom-topic, design.md Decision 1 /
// tasks.md Task 2.1-2.3.
//
// isCustomizationLocked is computed via the shared hasCompletedFirstSession
// lock-check function (topic-lock-helper.ts), which issues one additional
// db.query call (COUNT(*) FROM sessions ...) after the topics SELECT.
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/:teamId/topics — isCustomizationLocked (Task 2.1-2.3)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("includes isCustomizationLocked: true for a team with zero completed sessions", async () => {
    mockMemberGrant("participant");
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: "topic-1", name: "Topic 1", prompt: "Prompt 1", vote_type: "finger", display_order: 0, status: "active" }],
    }); // topics SELECT
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] }); // hasCompletedFirstSession

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/topics" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json() as { isCustomizationLocked: boolean };
    expect(body.isCustomizationLocked).toBe(true);
  });

  it("includes isCustomizationLocked: false for a team with at least one completed session", async () => {
    mockMemberGrant("participant");
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // topics SELECT (empty list)
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] }); // hasCompletedFirstSession

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/topics" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { isCustomizationLocked: boolean };
    expect(body.isCustomizationLocked).toBe(false);
  });

  it("is present regardless of caller role — facilitator grant", async () => {
    mockFacilitatorGrant();
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // topics SELECT
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] }); // hasCompletedFirstSession

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/topics" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { isCustomizationLocked: boolean };
    expect(body.isCustomizationLocked).toBe(true);
  });

  it("is present regardless of caller role — engineering_manager grant", async () => {
    mockMemberGrant("engineering_manager");
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // topics SELECT
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "2" }] }); // hasCompletedFirstSession

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/topics" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { isCustomizationLocked: boolean };
    expect(body.isCustomizationLocked).toBe(false);
  });

  it("does not remap existing snake_case fields to camelCase (design.md Decision 5 addendum)", async () => {
    mockMemberGrant("participant");
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: "topic-1", name: "Topic 1", prompt: "Prompt 1", vote_type: "finger", display_order: 0, status: "active" }],
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/topics" });

    const body = res.json() as { topics: Array<Record<string, unknown>> };
    expect(body.topics[0]).toHaveProperty("vote_type");
    expect(body.topics[0]).toHaveProperty("display_order");
    expect(body.topics[0]).not.toHaveProperty("voteType");
  });
});

// ---------------------------------------------------------------------------
// Authorization-before-lookup (Task 5.6 / Decision 7)
//
// Unauthorized requests must not reveal resource existence.
// The auth check must be BEFORE any resource query.
// ---------------------------------------------------------------------------
describe("Authorization-before-lookup (Task 5.6)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 for null grant WITHOUT querying any resources (auth before lookup)", async () => {
    mockNoGrant();

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/nonexistent-team/sessions" });

    expect(res.statusCode).toBe(403);

    // 3 db.query calls: user+membership (Q1), facilitator session (Q2),
    // cross-team facilitator check (Q3 — Error State 4).
    // No additional RESOURCE queries (team existence, sessions table content, etc.)
    // Authorization-before-lookup is maintained: Q1/Q2/Q3 are all authorization
    // checks, not resource reads.
    expect(mockDbQuery).toHaveBeenCalledTimes(3);
  });

  it("returns 403 (not 404) for unauthorized caller to nonexistent team (Task 7.2)", async () => {
    // Mock for first request
    mockNoGrant();
    // Mock for second request — same mock setup
    mockNoGrant();

    const app = await buildApp();
    const existingTeamRes = await app.inject({ method: "GET", url: "/api/v1/teams/existing-team/sessions" });
    const nonexistentTeamRes = await app.inject({ method: "GET", url: "/api/v1/teams/nonexistent-team/sessions" });

    // Both must return 403 — not 404 for nonexistent team
    expect(existingTeamRes.statusCode).toBe(403);
    expect(nonexistentTeamRes.statusCode).toBe(403);

    // Response codes and error categories must be identical (no information disclosure)
    // correlationId is per-request-unique so we compare the structure, not the exact value
    expect(existingTeamRes.json().error.category).toEqual(nonexistentTeamRes.json().error.category);
    expect(existingTeamRes.json().error.message).toEqual(nonexistentTeamRes.json().error.message);
  });
});

// ---------------------------------------------------------------------------
// Cache-Control: no-store on all content responses (Task 5.7)
// ---------------------------------------------------------------------------
describe("Cache-Control header (Task 5.7)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("denied responses include Cache-Control: no-store", async () => {
    mockNoGrant();

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(403);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("admin-denied responses include Cache-Control: no-store", async () => {
    mockAdminGrant();
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // audit

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(403);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("authorized responses include Cache-Control: no-store", async () => {
    mockMemberGrant("participant");
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // resource query

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/teams/:teamId/topics/all  (TOPIC-002, remove-topic Task 7)
//
// design.md Decision 9: the standing, org-wide facilitator model — NOT
// evaluateTeamAccess. Query order on the success path: (1) auth
// (evaluateStandingFacilitatorAccess), (2) team name SELECT (Decision 10's
// confirmation-copy requirement), (3) active topics SELECT, (4) archived
// topics SELECT (LEFT JOIN users for archivedBy), (5) defaultTopicsNotActive
// SELECT, (6) hasCompletedFirstSession's COUNT.
// ---------------------------------------------------------------------------
function mockStandingAuthQuery(globalRole: string, isMember: boolean) {
  mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: globalRole, is_member: isMember }] });
}

function mockTeamNameQuery(name = "Platform Squad") {
  mockDbQuery.mockResolvedValueOnce({ rows: [{ name }] });
}

describe("GET /api/v1/teams/:teamId/topics/all (design.md Decision 9)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a standing facilitator with no session history for the team can list its topics", async () => {
    mockStandingAuthQuery("facilitator", false);
    mockTeamNameQuery();
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // active topics
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // archived topics
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // defaultTopicsNotActive
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] }); // hasCompletedFirstSession

    const app = await buildApp("facilitator-with-no-history");
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/topics/all" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { teamId: string; teamName: string; isCustomizationLocked: boolean };
    expect(body.teamId).toBe("team-1");
    expect(body.teamName).toBe("Platform Squad");
    expect(body.isCustomizationLocked).toBe(true);
  });

  it("an application_admin can list any team's topics, including one they are an active member of", async () => {
    mockStandingAuthQuery("application_admin", true);
    mockTeamNameQuery();
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/topics/all" });

    expect(res.statusCode).toBe(200);
  });

  it("a caller who is neither a standing facilitator nor an admin is rejected 403", async () => {
    mockStandingAuthQuery("engineer", false);

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/topics/all" });

    expect(res.statusCode).toBe(403);
    // Only the auth query ran — no resource queries reached.
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it("a facilitator who is an active member of the team is rejected 403, even though they hold the facilitator role", async () => {
    mockStandingAuthQuery("facilitator", true);

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/topics/all" });

    expect(res.statusCode).toBe(403);
  });

  it("an archived topic's entry includes archivedAt and archivedBy matching the archiving facilitator", async () => {
    mockStandingAuthQuery("facilitator", false);
    mockTeamNameQuery();
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // active topics
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "topic-1",
          name: "Old Topic",
          prompt: "A prompt",
          vote_type: "finger",
          is_default: false,
          archived_at: new Date("2026-09-29T12:00:00.000Z"),
          archived_by: "user-42",
          archived_by_display_name: "Priya Nair",
        },
      ],
    }); // archived topics
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // defaultTopicsNotActive
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] }); // hasCompletedFirstSession

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/topics/all" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      archived: Array<{ topicId: string; archivedAt: string; archivedBy: { userId: string; displayName: string } | null }>;
    };
    expect(body.archived).toHaveLength(1);
    expect(body.archived[0]!.archivedAt).toBe("2026-09-29T12:00:00.000Z");
    expect(body.archived[0]!.archivedBy).toEqual({ userId: "user-42", displayName: "Priya Nair" });
  });

  it("applies the timing floor on the 403 branch", async () => {
    mockStandingAuthQuery("engineer", false);
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/api/v1/teams/team-1/topics/all" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 200 success branch", async () => {
    mockStandingAuthQuery("facilitator", false);
    mockTeamNameQuery();
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] });
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/api/v1/teams/team-1/topics/all" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });
});
