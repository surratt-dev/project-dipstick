import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as TopicLockStateModule from "../../auth/topic-lock-state.js";

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

// template-team-not-usable (#214) tasks.md 6.1: a pass-through spy on the
// shared lock-state function, so tests can assert TOPIC-001/002 call it (and
// that a denied request does not). The real function still runs, issuing
// hasCompletedFirstSession's COUNT through the mocked db.
const { mockGetTopicLockState } = vi.hoisted(() => ({ mockGetTopicLockState: vi.fn() }));
vi.mock("../../auth/topic-lock-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof TopicLockStateModule>();
  mockGetTopicLockState.mockImplementation(actual.getTopicLockState);
  return { getTopicLockState: (...args: [string]) => mockGetTopicLockState(...args) };
});

import Fastify from "fastify";
import { contentRoutes } from "../content.js";
import { DEFAULT_TOPICS_TEAM_ID } from "../../sessions/default-topics.js";
import type { GetAllTopicsResponse } from "@dipstick/shared";

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

/**
 * topic-001-authz-contract-reconcile (#187) task 4.0: TOPIC-001's member path
 * runs a second, live membership read (readActiveMembershipRole) after
 * evaluateTeamAccess, so every member-grant TOPIC-001 test queues two rows:
 * the helper's user+membership row (with the given global_role, unlike
 * mockMemberGrant, which hardcodes 'engineer') and then the membership read's
 * row ([] when liveMembershipRole is null). globalRole values come only from
 * the user_role enum; 'participant' is a membership role, never a global role.
 */
function mockTopic001MemberGrant(
  globalRole: string,
  membershipRole: "participant" | "engineering_manager",
  liveMembershipRole: string | null = membershipRole,
) {
  mockDbQuery.mockResolvedValueOnce({
    rows: [{ global_role: globalRole, membership_role: membershipRole }],
  });
  mockDbQuery.mockResolvedValueOnce({
    rows: liveMembershipRole === null ? [] : [{ role: liveMembershipRole }],
  });
}

/** emitAuditEvent calls for one event name (emitAuditEvent is mocked above). */
function eventCalls(event: string): unknown[][] {
  return mockEmitAuditEvent.mock.calls.filter((c) => c[1] === event);
}

function deniedRoleEvents(): unknown[][] {
  return eventCalls("topic.config_read_denied_role");
}

/**
 * #187: a TOPIC-001 denial must not run the topics SELECT or the lock check.
 * Proven by call count and SQL text, never by mock position.
 */
function expectTopicAndLockQueriesSkipped(expectedCalls: number) {
  expect(mockDbQuery).toHaveBeenCalledTimes(expectedCalls);
  // #214 6.1: nor the shared lock-state function (modified TOPIC-001
  // denied-caller clause).
  expect(mockGetTopicLockState).not.toHaveBeenCalled();
  for (const call of mockDbQuery.mock.calls) {
    const sql = String(call[0]);
    expect(sql).not.toMatch(/FROM topics/);
    expect(sql).not.toMatch(/FROM sessions\s+WHERE team_id/);
  }
}

function mockAdminGrant() {
  mockDbQuery.mockResolvedValueOnce({
    rows: [{ global_role: "application_admin", membership_role: null }],
  });
}

function mockFacilitatorGrant(sessionId = "5e550000-0000-4000-8000-000000000001", sessionStatus = "active") {
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
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions" });

    expect(res.statusCode).toBe(403);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("returns 403 and writes audit log for Application Admin request (Task 5.12)", async () => {
    // Admin grant
    mockAdminGrant();
    // Audit log INSERT
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions" });

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
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions" });

    expect(res.statusCode).toBe(200);
    // Task 5.7: Cache-Control: no-store on all content responses
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("returns 200 for EM member with no-store header", async () => {
    mockMemberGrant("engineering_manager");
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("returns 200 for facilitator with no-store header", async () => {
    mockFacilitatorGrant();
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // session-history query
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // connectionRecoveries query

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  // -------------------------------------------------------------------------
  // websocket-connection-reauthorization (SEC-26), design.md Decision D9,
  // tasks.md task 5.2: the facilitator session-history response's
  // connectionRecoveries field, and its non-disclosure filter.
  // -------------------------------------------------------------------------
  it("includes SEC-26 connectionRecoveries for a facilitator, filtered explicitly to session.connection_recovered (task 5.2)", async () => {
    mockFacilitatorGrant("5e550000-0000-4000-8000-000000000001");
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // session-history query
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        { actor_user_id: "user-a", timestamp: new Date("2026-01-01T00:00:00.000Z") },
        { actor_user_id: "user-b", timestamp: new Date("2026-01-01T00:05:00.000Z") },
      ],
    });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions" });

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
    mockFacilitatorGrant("5e550000-0000-4000-8000-000000000001");
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
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions" });
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
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/trends" });

    expect(res.statusCode).toBe(403);
  });

  it("returns 403 and writes audit log for Application Admin (Task 5.12)", async () => {
    mockAdminGrant();
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // audit INSERT

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/trends" });

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
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/trends" });

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
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/action-items" });

    expect(res.statusCode).toBe(403);
  });

  it("returns 200 with no-store for member", async () => {
    mockMemberGrant("participant");
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/action-items" });

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

  // template-team-not-usable (#214) tasks.md 6.1: the handler-level test that
  // replaces #188's retired template-member read. TOPIC-001 admits no caller
  // for the template over HTTP once it has no members and no unexpired
  // facilitator access, so the grant is simulated here.
  it("#214 6.1: TOPIC-001 obtains isCustomizationLocked and lockReason from getTopicLockState (template: canonical_defaults, no session query)", async () => {
    mockFacilitatorGrant();
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // topics SELECT

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/api/v1/teams/${DEFAULT_TOPICS_TEAM_ID}/topics` });

    expect(res.statusCode).toBe(200);
    expect(mockGetTopicLockState).toHaveBeenCalledTimes(1);
    expect(mockGetTopicLockState).toHaveBeenCalledWith(DEFAULT_TOPICS_TEAM_ID);
    expect(res.json()).toMatchObject({ isCustomizationLocked: true, lockReason: "canonical_defaults" });
    expect(mockDbQuery.mock.calls.some(([sql]) => /FROM sessions\s+WHERE team_id/.test(String(sql)))).toBe(false);
  });

  it.each([
    ["0", true, "first_session"],
    ["1", false, null],
  ] as const)("#214 6.1: TOPIC-001 on a real team with %s completed sessions has lockReason %s", async (count, locked, reason) => {
    mockTopic001MemberGrant("engineer", "participant");
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // topics SELECT
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count }] }); // hasCompletedFirstSession

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics" });

    expect(res.statusCode).toBe(200);
    expect(mockGetTopicLockState).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    expect(res.json()).toMatchObject({ isCustomizationLocked: locked, lockReason: reason });
  });

  it("includes isCustomizationLocked: true for a team with zero completed sessions", async () => {
    mockTopic001MemberGrant("engineer", "participant");
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: "topic-1", name: "Topic 1", prompt: "Prompt 1", vote_type: "finger", display_order: 0, status: "active" }],
    }); // topics SELECT
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] }); // hasCompletedFirstSession

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json() as { isCustomizationLocked: boolean };
    expect(body.isCustomizationLocked).toBe(true);
  });

  it("includes isCustomizationLocked: false for a team with at least one completed session", async () => {
    mockTopic001MemberGrant("engineer", "participant");
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // topics SELECT (empty list)
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] }); // hasCompletedFirstSession

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { isCustomizationLocked: boolean };
    expect(body.isCustomizationLocked).toBe(false);
  });

  it("is present regardless of caller role — facilitator grant", async () => {
    mockFacilitatorGrant();
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // topics SELECT
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] }); // hasCompletedFirstSession

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { isCustomizationLocked: boolean };
    expect(body.isCustomizationLocked).toBe(true);
  });

  // topic-001-authz-contract-reconcile (#187) task 4.1: path 2, global EM AND
  // EM membership (the helper's true EM grant). Previously this test used
  // mockMemberGrant("engineering_manager"), whose hardcoded 'engineer' global
  // role made it path 2', and expected 200: the defect #187 fixes.
  it("TOPIC-001 denies an EM by both global role and membership (path 2)", async () => {
    // Only the two rows the deny path reads: helper read + membership read.
    mockTopic001MemberGrant("engineering_manager", "engineering_manager");

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics" });

    expect(res.statusCode).toBe(403);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json()).toEqual({
      error: {
        category: "forbidden",
        message: "You do not have access to this team's content.",
        correlationId: expect.any(String),
      },
    });
    expect(res.body).not.toContain("isCustomizationLocked");

    const denials = deniedRoleEvents();
    expect(denials).toHaveLength(1);
    const fields = denials[0]![2] as Record<string, unknown>;
    expect(fields["reason"]).toBe("membership_em");
    // Exact key set: adding topic data to this event later fails here.
    expect(Object.keys(fields).sort()).toEqual(
      ["globalRole", "grantPath", "membershipRole", "reason", "teamId", "userId"],
    );
    expect(fields).toEqual({
      userId: "actor-1",
      teamId: "11111111-1111-4111-8111-111111111111",
      grantPath: "member",
      globalRole: "engineering_manager",
      membershipRole: "engineering_manager",
      reason: "membership_em",
    });
    expect(eventCalls("team.access_grant_mismatch")).toHaveLength(0);
    expectTopicAndLockQueriesSkipped(2);
  });

  // Tripwire, not a target: topic entries are raw snake_case rows today. See
  // the REST API Contract TOPIC-001 "As built (#187)" note: the camelCase
  // shape there is the target, and the first change that adds a TOPIC-001
  // consumer must do the remap and flip this test on purpose.
  it("does not remap existing snake_case fields to camelCase (design.md Decision 5 addendum)", async () => {
    mockTopic001MemberGrant("engineer", "participant");
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: "topic-1", name: "Topic 1", prompt: "Prompt 1", vote_type: "finger", display_order: 0, status: "active" }],
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics" });

    // A failure here is an authorization regression, not a shape change.
    expect(res.statusCode).toBe(200);
    const body = res.json() as { topics: Array<Record<string, unknown>> };
    expect(body.topics[0]).toHaveProperty("vote_type");
    expect(body.topics[0]).toHaveProperty("display_order");
    expect(body.topics[0]).not.toHaveProperty("voteType");
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/teams/:teamId/topics — engineering managers denied
// topic-001-authz-contract-reconcile (#187), tasks 4.2-4.5 and 4.10-4.12.
//
// Spec: team-content-access "The active-topics endpoint admits only
// non-manager participant members and eligible session facilitators". An EM by live membership role OR stored global role is denied on
// every grant path, unconditionally; admins keep their audited 403. Every
// denial emits the log-only topic.config_read_denied_role event, runs the
// timing floor once, and never reaches the topics SELECT or the lock check.
// ---------------------------------------------------------------------------
const TOPICS_URL = "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics";
const TOPIC_ROW = { id: "topic-1", name: "Topic 1", prompt: "Prompt 1", vote_type: "finger", display_order: 0, status: "active" };

function mockFacilitatorGrantWithGlobalRole(globalRole: string) {
  mockDbQuery.mockResolvedValueOnce({
    rows: [{ global_role: globalRole, membership_role: null }],
  });
  mockDbQuery.mockResolvedValueOnce({
    rows: [{ session_id: "5e550000-0000-4000-8000-000000000001", session_status: "active" }],
  });
}

function mockTopicsAndLock() {
  mockDbQuery.mockResolvedValueOnce({ rows: [TOPIC_ROW] }); // topics SELECT
  mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] }); // hasCompletedFirstSession
}

describe("GET /api/v1/teams/:teamId/topics — engineering managers denied (#187)", () => {
  beforeEach(() => vi.clearAllMocks());

  // 4.2: one row per denied state. calls = the rows the deny path reads.
  it.each([
    {
      label: "(a) path 2': global engineer with an EM membership",
      arrange: () => mockTopic001MemberGrant("engineer", "engineering_manager"),
      grantPath: "member",
      globalRole: "engineer",
      membershipRole: "engineering_manager",
      reason: "membership_em",
      mismatch: true,
      calls: 2,
    },
    {
      label: "(b) global EM with a participant membership",
      arrange: () => mockTopic001MemberGrant("engineering_manager", "participant"),
      grantPath: "member",
      globalRole: "engineering_manager",
      membershipRole: "participant",
      reason: "global_em",
      mismatch: false,
      calls: 2,
    },
    {
      label: "(c) facilitator grant whose global role drifted to engineering_manager",
      // helper read + facilitator-session read; no membership read (asserted below).
      arrange: () => mockFacilitatorGrantWithGlobalRole("engineering_manager"),
      grantPath: "facilitator",
      globalRole: "engineering_manager",
      membershipRole: null,
      reason: "global_em",
      mismatch: false,
      calls: 2,
    },
    {
      label: "(d) global facilitator with an active EM membership (member path)",
      arrange: () => mockTopic001MemberGrant("facilitator", "engineering_manager"),
      grantPath: "member",
      globalRole: "facilitator",
      membershipRole: "engineering_manager",
      reason: "membership_em",
      mismatch: true,
      calls: 2,
    },
    {
      label: "(e) member grant whose live membership read returns no row",
      arrange: () => mockTopic001MemberGrant("engineer", "participant", null),
      grantPath: "member",
      globalRole: "engineer",
      membershipRole: null,
      reason: "not_admitted",
      mismatch: false,
      calls: 2,
    },
  ])("$label → 403, reason $reason", async ({ arrange, grantPath, globalRole, membershipRole, reason, mismatch, calls }) => {
    arrange();

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: TOPICS_URL });

    expect(res.statusCode).toBe(403);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json().error).toMatchObject({
      category: "forbidden",
      message: "You do not have access to this team's content.",
    });
    expect(res.body).not.toContain("isCustomizationLocked");

    const denials = deniedRoleEvents();
    expect(denials).toHaveLength(1);
    expect(denials[0]![2]).toEqual({
      userId: "actor-1",
      teamId: "11111111-1111-4111-8111-111111111111",
      grantPath,
      globalRole,
      membershipRole,
      reason,
    });
    expect(eventCalls("team.access_grant_mismatch")).toHaveLength(mismatch ? 1 : 0);
    expectTopicAndLockQueriesSkipped(calls);
    if (grantPath === "facilitator") {
      for (const call of mockDbQuery.mock.calls) {
        expect(String(call[0])).not.toMatch(/SELECT role FROM team_memberships/);
      }
    }
  });

  // 4.3: the allow-list must not over-deny. Placed next to the EM denials.
  it.each([
    { label: "participant member, global engineer", arrange: () => mockTopic001MemberGrant("engineer", "participant") },
    { label: "participant member, global senior_engineer", arrange: () => mockTopic001MemberGrant("senior_engineer", "participant") },
    { label: "facilitator grant, global facilitator", arrange: () => mockFacilitatorGrantWithGlobalRole("facilitator") },
    { label: "global facilitator with an active participant membership", arrange: () => mockTopic001MemberGrant("facilitator", "participant") },
  ])("$label → 200 with no denial event", async ({ arrange }) => {
    arrange();
    mockTopicsAndLock();

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: TOPICS_URL });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { teamId: string; topics: unknown[]; isCustomizationLocked: unknown };
    expect(body.teamId).toBe("11111111-1111-4111-8111-111111111111");
    expect(body.topics.length).toBeGreaterThan(0);
    expect(typeof body.isCustomizationLocked).toBe("boolean");
    expect(deniedRoleEvents()).toHaveLength(0);
  });

  // 4.4: admin precedence comes from evaluateTeamAccess checking admin FIRST
  // (Path 0), before any membership. If the helper is reordered, the EM
  // membership case below fails: see the team-content-access spec.
  it.each([
    { label: "admin with no membership", membershipRole: null },
    { label: "admin who also holds an active EM membership", membershipRole: "engineering_manager" },
  ])("$label → 403 with exactly one admin.session_content_denied audit row", async ({ membershipRole }) => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "application_admin", membership_role: membershipRole }],
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // audit_log INSERT

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: TOPICS_URL });

    expect(res.statusCode).toBe(403);
    const auditInserts = mockDbQuery.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO audit_log"));
    expect(auditInserts).toHaveLength(1);
    const values = auditInserts[0]![1] as unknown[];
    expect(values[3]).toBe("admin.session_content_denied");
    const metadata = JSON.parse(values[5] as string) as Record<string, unknown>;
    expect(metadata["endpoint"]).toBe("GET /api/v1/teams/:teamId/topics");
    expect(deniedRoleEvents()).toHaveLength(0);
    expectTopicAndLockQueriesSkipped(2);
  });

  // 4.5: the EM denial waits on the timing floor exactly once, with the
  // handler's startTime, before responding; same as the null-grant branch.
  // timing-oracle.js is mocked, so this checks the call, not wall-clock time.
  it.each([
    { label: "EM denial", arrange: () => mockTopic001MemberGrant("engineering_manager", "engineering_manager") },
    { label: "null grant", arrange: () => mockNoGrant() },
  ])("$label: applyTimingFloor(startTime) once, before the response", async ({ arrange }) => {
    arrange();
    const startTime = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(startTime);
    let release!: () => void;
    mockApplyTimingFloor.mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );

    try {
      const app = await buildApp();
      let settled = false;
      const pending = app.inject({ method: "GET", url: TOPICS_URL }).then((r) => {
        settled = true;
        return r;
      });
      await vi.waitFor(() => expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1));
      // The floor has not resolved, so the response must not have gone out.
      await new Promise((r) => setTimeout(r, 10));
      expect(settled).toBe(false);
      release();
      const res = await pending;

      expect(res.statusCode).toBe(403);
      expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
      expect(mockApplyTimingFloor).toHaveBeenCalledWith(startTime);
    } finally {
      nowSpy.mockRestore();
    }
  });

  // 4.5: an EM denial is indistinguishable from a null-grant 403 apart from
  // correlationId. This is also the only guard against the EM denial using
  // the cross-team facilitator message: do not weaken to "same status".
  it("EM-denial and null-grant 403s have identical status, headers, and body apart from correlationId", async () => {
    const app = await buildApp();

    mockTopic001MemberGrant("engineering_manager", "engineering_manager");
    const em = await app.inject({ method: "GET", url: TOPICS_URL });
    mockNoGrant();
    const nul = await app.inject({ method: "GET", url: TOPICS_URL });

    expect(em.statusCode).toBe(nul.statusCode);
    // date can tick between the two requests; every other header must match.
    const headers = (h: Record<string, unknown>) => {
      const rest = { ...h };
      delete rest["date"];
      return rest;
    };
    expect(headers(em.headers)).toEqual(headers(nul.headers));
    const body = (raw: string) => {
      const parsed = JSON.parse(raw) as { error: Record<string, unknown> };
      delete parsed.error["correlationId"];
      return parsed;
    };
    expect(body(em.body)).toEqual(body(nul.body));
  });

  // 4.10: the canonical-id check runs before evaluateTeamAccess, so an EM
  // gets 404 TEAM_NOT_FOUND, not 403, and no grant query runs.
  it("an EM calling with a non-canonical teamId gets 404 TEAM_NOT_FOUND and evaluateTeamAccess is not called", async () => {
    // Nothing queued: the request must not reach the DB at all.
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111111141118111111111111111/topics" });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({ category: "not_found", code: "TEAM_NOT_FOUND" });
    expect(mockDbQuery).not.toHaveBeenCalled();
    expect(deniedRoleEvents()).toHaveLength(0);
  });

  // 4.11: the denial is unconditional; the predicate reads no env. production
  // is excluded: timing-oracle.ts throws at import there while the floor is a
  // placeholder (that governs the floor, not admission).
  it.each(["development", "test"])("EM denial is 403 with NODE_ENV=%s", async (nodeEnv) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    try {
      mockTopic001MemberGrant("engineering_manager", "engineering_manager");

      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: TOPICS_URL });

      expect(res.statusCode).toBe(403);
      expect(deniedRoleEvents()).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // 4.12: fail closed. A rejected membership read is a 500, never an admit,
  // and the topics and lock queries do not run.
  it("a rejected membership read for a member grant is 500, not 200", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineer", membership_role: "participant" }],
    });
    mockDbQuery.mockRejectedValueOnce(new Error("connection lost"));

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: TOPICS_URL });

    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("isCustomizationLocked");
    expectTopicAndLockQueriesSkipped(2);
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
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/99999999-9999-4999-8999-999999999999/sessions" });

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
    const existingTeamRes = await app.inject({ method: "GET", url: "/api/v1/teams/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/sessions" });
    const nonexistentTeamRes = await app.inject({ method: "GET", url: "/api/v1/teams/99999999-9999-4999-8999-999999999999/sessions" });

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
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions" });

    expect(res.statusCode).toBe(403);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("admin-denied responses include Cache-Control: no-store", async () => {
    mockAdminGrant();
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // audit

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions" });

    expect(res.statusCode).toBe(403);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("authorized responses include Cache-Control: no-store", async () => {
    mockMemberGrant("participant");
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // resource query

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions" });

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
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/all" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { teamId: string; teamName: string; isCustomizationLocked: boolean };
    expect(body.teamId).toBe("11111111-1111-4111-8111-111111111111");
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
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/all" });

    expect(res.statusCode).toBe(200);
  });

  // topic-add-form-and-empty-state task 1.3: this rejection is also the
  // coverage for Add Custom Topic's "Engineers cannot add topics" acceptance
  // criterion -- an engineer (or engineering manager) never reaches the
  // Topic Management screen, so no add control can be shown to them.
  it("a caller who is neither a standing facilitator nor an admin is rejected 403", async () => {
    mockStandingAuthQuery("engineer", false);

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/all" });

    expect(res.statusCode).toBe(403);
    // Only the auth query ran — no resource queries reached.
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it("a facilitator who is an active member of the team is rejected 403, even though they hold the facilitator role", async () => {
    mockStandingAuthQuery("facilitator", true);

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/all" });

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
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/all" });

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
    await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/all" });
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
    await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/all" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// topic-annotation Task 5.3 — TOPIC-002 annotation fields and
// canEditAnnotations; TOPIC-001 carries no annotation (design.md Decision 8).
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/:teamId/topics/all — team annotation (topic-annotation design.md Decision 8)", () => {
  beforeEach(() => vi.clearAllMocks());

  const activeRow = {
    id: "topic-1",
    name: "Pipeline",
    prompt: "Confidence in the pipeline",
    vote_type: "finger",
    display_order: 0,
    is_default: true,
    first_session_description: null,
    created_at: new Date("2026-09-01T00:00:00.000Z"),
    updated_at: new Date("2026-09-01T00:00:00.000Z"),
  };

  function mockAllTopics(
    globalRole: string,
    active: Array<Record<string, unknown>>,
    archived: Array<Record<string, unknown>> = [],
  ) {
    mockStandingAuthQuery(globalRole, false);
    mockTeamNameQuery();
    mockDbQuery.mockResolvedValueOnce({ rows: active });
    mockDbQuery.mockResolvedValueOnce({ rows: archived });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] });
  }

  async function getAll() {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/all" });
    expect(res.statusCode).toBe(200);
    return res.json() as GetAllTopicsResponse;
  }

  it("an annotated active topic returns its text and provenance", async () => {
    mockAllTopics("facilitator", [
      {
        ...activeRow,
        team_annotation: "Our build and deploy pipeline",
        annotation_updated_at: new Date("2026-09-20T10:00:00.000Z"),
        annotation_updated_by: "user-f",
        annotation_updated_by_display_name: "Fran Facilitator",
      },
    ]);

    const body = await getAll();

    expect(body.active[0]).toMatchObject({
      teamAnnotation: "Our build and deploy pipeline",
      annotationUpdatedAt: "2026-09-20T10:00:00.000Z",
      annotationUpdatedBy: { userId: "user-f", displayName: "Fran Facilitator" },
    });
  });

  it("an unannotated topic returns all three fields as null", async () => {
    mockAllTopics("facilitator", [
      {
        ...activeRow,
        team_annotation: null,
        annotation_updated_at: null,
        annotation_updated_by: null,
        annotation_updated_by_display_name: null,
      },
    ]);

    const body = await getAll();

    expect(body.active[0]?.teamAnnotation).toBeNull();
    expect(body.active[0]?.annotationUpdatedAt).toBeNull();
    expect(body.active[0]?.annotationUpdatedBy).toBeNull();
  });

  it("an archived topic returns its teamAnnotation and provenance", async () => {
    mockAllTopics(
      "facilitator",
      [],
      [
        {
          id: "topic-old",
          name: "Old Topic",
          prompt: "A prompt",
          vote_type: "finger",
          is_default: false,
          archived_at: new Date("2026-09-29T12:00:00.000Z"),
          archived_by: "user-42",
          archived_by_display_name: "Priya Nair",
          restored_at: null,
          restored_by: null,
          restored_by_display_name: null,
          team_annotation: "X",
          annotation_updated_at: new Date("2026-09-10T00:00:00.000Z"),
          annotation_updated_by: "user-f",
          annotation_updated_by_display_name: "Fran Facilitator",
        },
      ],
    );

    const body = await getAll();

    expect(body.archived[0]).toMatchObject({
      teamAnnotation: "X",
      annotationUpdatedAt: "2026-09-10T00:00:00.000Z",
      annotationUpdatedBy: { userId: "user-f", displayName: "Fran Facilitator" },
    });
  });

  it("canEditAnnotations is true for a standing facilitator", async () => {
    mockAllTopics("facilitator", []);
    expect((await getAll()).canEditAnnotations).toBe(true);
  });

  it("canEditAnnotations is false for an application admin", async () => {
    mockAllTopics("application_admin", []);
    expect((await getAll()).canEditAnnotations).toBe(false);
  });

  // topic-add-form-and-empty-state task 1.3 (design.md Decision 1).
  it("canAddTopics is true for a standing facilitator", async () => {
    mockAllTopics("facilitator", []);
    expect((await getAll()).canAddTopics).toBe(true);
  });

  // topic-003-admin-authorization task 1.1 (BA M8): FR-8.2 admits admins.
  it("canAddTopics is true for an application admin, canEditAnnotations stays false, and the full lists are returned", async () => {
    mockAllTopics("application_admin", [{ ...activeRow, team_annotation: null }], [
      {
        id: "topic-old",
        name: "Old Topic",
        prompt: "A prompt",
        vote_type: "finger",
        is_default: false,
        archived_at: new Date("2026-09-29T12:00:00.000Z"),
        archived_by: null,
        archived_by_display_name: null,
        restored_at: null,
        restored_by: null,
        restored_by_display_name: null,
        team_annotation: null,
      },
    ]);
    const body = await getAll();
    expect(body.canAddTopics).toBe(true);
    expect(body.canEditAnnotations).toBe(false);
    expect(body.active).toHaveLength(1);
    expect(body.archived).toHaveLength(1);
  });

  it("canAddTopics does not depend on the lock: a locked team still reports true for a facilitator", async () => {
    mockStandingAuthQuery("facilitator", false);
    mockTeamNameQuery();
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] }); // no completed session: locked
    const body = await getAll();
    expect(body.isCustomizationLocked).toBe(true);
    expect(body.canAddTopics).toBe(true);
  });

  it("an application admin still receives teamAnnotation and annotationUpdatedBy, read-only (security R4)", async () => {
    mockAllTopics("application_admin", [
      {
        ...activeRow,
        team_annotation: "X",
        annotation_updated_at: new Date("2026-09-20T10:00:00.000Z"),
        annotation_updated_by: "user-f",
        annotation_updated_by_display_name: "Fran Facilitator",
      },
    ]);

    const body = await getAll();

    expect(body.canEditAnnotations).toBe(false);
    expect(body.active[0]?.teamAnnotation).toBe("X");
    expect(body.active[0]?.annotationUpdatedBy).toEqual({ userId: "user-f", displayName: "Fran Facilitator" });
  });

  it("provenance is null when the editing user has no display name", async () => {
    mockAllTopics("facilitator", [
      {
        ...activeRow,
        team_annotation: "X",
        annotation_updated_at: new Date("2026-09-20T10:00:00.000Z"),
        annotation_updated_by: "user-gone",
        annotation_updated_by_display_name: null,
      },
    ]);

    const body = await getAll();

    expect(body.active[0]?.annotationUpdatedBy).toBeNull();
    expect(body.active[0]?.annotationUpdatedAt).toBe("2026-09-20T10:00:00.000Z");
  });

  it("both the active and archived queries select the annotation columns joined to users", async () => {
    mockAllTopics("facilitator", []);
    await getAll();

    const activeSql = String(mockDbQuery.mock.calls[2]?.[0]);
    const archivedSql = String(mockDbQuery.mock.calls[3]?.[0]);
    for (const sql of [activeSql, archivedSql]) {
      expect(sql).toContain("t.team_annotation");
      expect(sql).toContain("t.annotation_updated_at");
      expect(sql).toMatch(/LEFT JOIN users annotation_user ON annotation_user\.id = t\.annotation_updated_by/);
    }
  });
});

describe("GET /api/v1/teams/:teamId/topics (TOPIC-001) — no annotation fields (topic-annotation security R7)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not select team_annotation or its provenance", async () => {
    mockTopic001MemberGrant("engineer", "participant");
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: "t1", name: "N", prompt: "P", vote_type: "finger", display_order: 0, status: "active" }],
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics" });

    expect(res.statusCode).toBe(200);
    const topicsSql = String(mockDbQuery.mock.calls.find((c) => String(c[0]).includes("FROM topics"))?.[0]);
    // Strip SQL comments before checking, so only the executable text counts.
    const executable = topicsSql.replace(/--.*$/gm, "");
    expect(executable).not.toMatch(/annotation/);
    const body = res.json() as { topics: Array<Record<string, unknown>> };
    for (const topic of body.topics) {
      for (const key of ["teamAnnotation", "team_annotation", "annotationUpdatedBy", "annotationUpdatedAt"]) {
        expect(topic).not.toHaveProperty(key);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Implementation review M1/MF1 (session-topics-snapshot-at-creation): a
// non-canonical teamId is 404 before the member-denial query, so a member
// facilitator cannot read their own team's list through another spelling.
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/:teamId/topics/all — non-canonical teamId (implementation review M1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["hyphenless", "11111111111141118111111111111111"],
    ["braced", "{11111111-1111-4111-8111-111111111111}"],
    ["malformed", "not-a-uuid"],
  ])("a %s teamId is 404 TEAM_NOT_FOUND before any query, with no-store", async (_label, bad) => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/api/v1/teams/${encodeURIComponent(bad)}/topics/all` });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({ category: "not_found", code: "TEAM_NOT_FOUND" });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(mockDbQuery).not.toHaveBeenCalled();
    expect(mockApplyTimingFloor).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// harden-topic-write-endpoints (#184) task 3.9, spec "No team-scoped topic
// route returns 5xx for a malformed path identifier" → "Malformed teamId on
// the topic read routes". Both read routes answer a non-canonical teamId with
// 404 TEAM_NOT_FOUND, the timing floor and no-store, before any query.
// ---------------------------------------------------------------------------
describe("topic read routes — malformed teamId (#184 task 3.9)", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["GET /topics", "/api/v1/teams/not-a-uuid/topics"],
    ["GET /topics/all", "/api/v1/teams/not-a-uuid/topics/all"],
  ])("%s: 404 TEAM_NOT_FOUND, never 5xx, no query", async (_label, url) => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({ category: "not_found", code: "TEAM_NOT_FOUND", message: "Team not found." });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(mockDbQuery).not.toHaveBeenCalled();
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });
});
