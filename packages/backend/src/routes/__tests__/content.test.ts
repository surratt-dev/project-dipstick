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
vi.mock("../../content/timing-oracle.js", () => ({
  applyTimingFloor: vi.fn().mockResolvedValue(undefined),
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

function mockUserNotFound() {
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
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/sessions" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
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
