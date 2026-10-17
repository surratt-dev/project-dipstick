import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type * as TopicLockStateModule from "../../auth/topic-lock-state.js";
import type * as StandingHelperModule from "../../auth/standing-facilitator-access-helper.js";
import type * as TimingOracleModule from "../../content/timing-oracle.js";

// NOTE: a module-level afterEach (in the #232 fixture section below) calls
// mockDbQuery.mockReset() after EVERY test in this file, not only #232's.
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

// #265 security N2: a pass-through spy on the shared authorization decision so
// one test can have it admit a role the real helper never admits.
const { decisionOverride } = vi.hoisted(() => ({
  decisionOverride: { value: null as null | { authorized: true; actorGlobalRole: string } },
}));
vi.mock("../../auth/standing-facilitator-access-helper.js", async (importOriginal) => {
  const actual = await importOriginal<typeof StandingHelperModule>();
  return {
    ...actual,
    checkStandingFacilitatorOrAdminAuthorization: async (...args: Parameters<typeof actual.checkStandingFacilitatorOrAdminAuthorization>) => {
      const real = await actual.checkStandingFacilitatorOrAdminAuthorization(...args);
      return decisionOverride.value ?? real;
    },
  };
});

import Fastify from "fastify";
import { contentRoutes, assertTopic002AuthorizedRole } from "../content.js";
import { DEFAULT_TOPICS_TEAM_ID } from "../../sessions/default-topics.js";
import type { GetAllTopicsResponse } from "@dipstick/shared";
import baseline403 from "./fixtures/topic-002-403-baseline.json";

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
 * buildApp plus a capturing error handler that answers the generic 500
 * envelope. The production app registers no generic handler (Fastify's
 * default echoes err.message and err.code in the body; see the report on #265
 * implementation review N1), so a handler-level test cannot prove the real
 * body is clean. What it can prove: the route propagates the raw error
 * (no catch-and-forward into the body), sends no data of its own, and the
 * propagated error is the one the DB raised. The leak assertions therefore run
 * against this stand-in envelope and the captured error is asserted separately.
 */
async function buildAppWithErrorCapture(userId = "actor-1") {
  const thrown: unknown[] = [];
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
  });
  app.setErrorHandler((err, _req, reply) => {
    thrown.push(err);
    return reply.code(500).send({ error: { category: "internal" } });
  });
  app.register(contentRoutes);
  await app.ready();
  return { app, thrown };
}

/** Strings a 500 body must never carry: error text, SQLSTATE, SQL text. */
const LEAK_STRINGS = ["leaked-detail", "boom", "08006", "FROM teams", "SELECT"];
function expectGeneric500(body: string) {
  for (const s of LEAK_STRINGS) expect(body).not.toContain(s);
  expect(JSON.parse(body)).toEqual({ error: { category: "internal" } });
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

// ---------------------------------------------------------------------------
// #232 task 2.0 — SQL-routed fixture for ADMIN TOPIC-002 requests.
//
// Routes by SQL text (mockDbQuery.mockImplementation), never by a positional
// mockResolvedValueOnce queue: an exhausted queue returns undefined, the
// handler throws a TypeError, and a miscounted fixture would then look like a
// passing fail-closed test. Injected failures are explicit (`reject`), and any
// SQL the router does not recognise is recorded in `unroutedSql` and rejected;
// every describe block that uses the router asserts `unroutedSql` is empty
// after each test, so an unrouted query fails the test.
//
// Facilitator tests keep their positional queues and queue no extra row.
// ---------------------------------------------------------------------------
type Topic002Route =
  | "helper"
  | "membership"
  | "role_set"
  | "team_name"
  | "active"
  | "archived"
  | "defaults"
  | "lock"
  | "audit_insert";

const TOPIC_002_ROUTES: Array<[Topic002Route, RegExp]> = [
  // Membership-role read (readActiveMembershipRole) before any broader rule.
  ["membership", /SELECT role FROM team_memberships/],
  // The shared helper's users-LEFT-JOIN-team_memberships row (`FROM users u`).
  ["helper", /FROM users u\s[\s\S]*team_memberships/],
  // The role-set read (`FROM users WHERE id`), distinct from `FROM users u`.
  ["role_set", /SELECT roles::text\[\] AS roles FROM users WHERE id/],
  ["team_name", /SELECT name FROM teams WHERE id/],
  ["defaults", /FROM topics dt/],
  ["active", /FROM topics t[\s\S]*t\.status = 'active'/],
  ["archived", /FROM topics t[\s\S]*t\.status = 'archived'/],
  ["lock", /COUNT\(\*\) AS count FROM sessions/],
  ["audit_insert", /INSERT INTO audit_log/],
];

interface Topic002Fixture {
  globalRole?: string;
  isMember?: boolean;
  /** null = the team-name SELECT returns no row (TOPIC-002 answers 404, #265). */
  teamName?: string | null;
  active?: Array<Record<string, unknown>>;
  archived?: Array<Record<string, unknown>>;
  defaults?: Array<Record<string, unknown>>;
  completedSessions?: string;
  /** readActiveMembershipRole's row; null = no active membership. */
  membershipRole?: string | null;
  /** users.roles as served by the role-set read; null = zero rows. */
  roles?: string[] | null;
  /** #264: the shared helper's read returns zero rows (the caller has no users row). */
  noUsersRow?: boolean;
  /** #264: actor_roles as returned by the denial insert's RETURNING; null = no users row. */
  denialRoles?: string[] | null;
  /** Explicit injected failures: reject when the SQL matches. */
  reject?: Array<{ match: RegExp; error: Error }>;
}

let unroutedSql: string[] = [];

// The router installs a persistent mockImplementation; reset it after every
// test so no later (queue-based) test inherits it.
afterEach(() => mockDbQuery.mockReset());

function classifyTopic002Sql(sql: string): Topic002Route | null {
  for (const [route, pattern] of TOPIC_002_ROUTES) {
    if (pattern.test(sql)) return route;
  }
  return null;
}

function routeTopic002(fixture: Topic002Fixture = {}) {
  const f = {
    globalRole: "application_admin",
    isMember: false,
    teamName: "Platform Squad" as string | null,
    active: [] as Array<Record<string, unknown>>,
    archived: [] as Array<Record<string, unknown>>,
    defaults: [] as Array<Record<string, unknown>>,
    completedSessions: "1",
    membershipRole: null as string | null,
    roles: ["application_admin"] as string[] | null,
    noUsersRow: false,
    denialRoles: ["participant", "engineering_manager"] as string[] | null,
    reject: [] as Array<{ match: RegExp; error: Error }>,
    ...fixture,
  };
  mockDbQuery.mockImplementation(async (sqlArg: unknown) => {
    const sql = String(sqlArg);
    for (const { match, error } of f.reject) {
      if (match.test(sql)) throw error;
    }
    switch (classifyTopic002Sql(sql)) {
      case "helper":
        return { rows: f.noUsersRow ? [] : [{ global_role: f.globalRole, is_member: f.isMember }] };
      case "membership":
        return { rows: f.membershipRole === null ? [] : [{ role: f.membershipRole }] };
      case "role_set":
        return { rows: f.roles === null ? [] : [{ roles: f.roles }] };
      case "team_name":
        return { rows: f.teamName === null ? [] : [{ name: f.teamName }] };
      case "active":
        return { rows: f.active };
      case "archived":
        return { rows: f.archived };
      case "defaults":
        return { rows: f.defaults };
      case "lock":
        return { rows: [{ count: f.completedSessions }] };
      case "audit_insert":
        return { rows: [{ actor_roles: f.denialRoles }], rowCount: 1 };
      default:
        unroutedSql.push(sql);
        throw new Error(`unrouted SQL in TOPIC-002 fixture: ${sql}`);
    }
  });
}

function sqlCallsMatching(pattern: RegExp): unknown[][] {
  return mockDbQuery.mock.calls.filter((c) => pattern.test(String(c[0])));
}

/** INSERT INTO audit_log calls, optionally for one operation (param $4). */
function auditInsertCalls(operation?: string): unknown[][] {
  return sqlCallsMatching(/INSERT INTO audit_log/).filter(
    (c) => operation === undefined || (c[1] as unknown[])[3] === operation,
  );
}

function auditInsertMetadata(call: unknown[]): Record<string, unknown> {
  return JSON.parse(String((call[1] as unknown[])[5])) as Record<string, unknown>;
}

const TOPIC_002_TEAM_ID = "11111111-1111-4111-8111-111111111111";
const TOPIC_002_URL = `/api/v1/teams/${TOPIC_002_TEAM_ID}/topics/all`;

/** buildApp plus a spy that records when the reply is sent (onSend hook). */
async function buildAppWithReplySpy(userId = "actor-1") {
  const replySpy = vi.fn();
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
  });
  app.addHook("onSend", async () => {
    replySpy();
  });
  app.register(contentRoutes);
  await app.ready();
  return { app, replySpy };
}

/**
 * #232 D4, kept by #208: on the admin 200 the tail is
 * audit insert < structured event < applyTimingFloor < reply sent.
 */
function expectAuditTailOrder(operation: string, replySpy: ReturnType<typeof vi.fn>) {
  const insertIndex = mockDbQuery.mock.calls.findIndex(
    (c) => /INSERT INTO audit_log/.test(String(c[0])) && (c[1] as unknown[])[3] === operation,
  );
  expect(insertIndex).toBeGreaterThanOrEqual(0);
  const insertOrder = mockDbQuery.mock.invocationCallOrder[insertIndex]!;
  const eventIndex = mockEmitAuditEvent.mock.calls.findIndex((c) => c[1] === operation);
  expect(eventIndex).toBeGreaterThanOrEqual(0);
  const eventOrder = mockEmitAuditEvent.mock.invocationCallOrder[eventIndex]!;
  expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  const floorOrder = mockApplyTimingFloor.mock.invocationCallOrder[0]!;
  expect(replySpy).toHaveBeenCalledTimes(1);
  const replyOrder = replySpy.mock.invocationCallOrder[0]!;
  expect(insertOrder).toBeLessThan(eventOrder);
  expect(eventOrder).toBeLessThan(floorOrder);
  expect(floorOrder).toBeLessThan(replyOrder);
}

describe("GET /api/v1/teams/:teamId/topics/all (design.md Decision 9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbQuery.mockReset();
    unroutedSql = [];
  });
  afterEach(() => expect(unroutedSql).toEqual([]));

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

  // #208 (reverses #232's no-manager rule): every application_admin is
  // admitted whatever their live membership role on the team, and every read
  // writes exactly one access row recording that role raw. No path writes an
  // admin.topic_config_denied row any more.
  it.each([
    ["no membership", false, null],
    ["a participant membership", true, "participant"],
    ["an engineering_manager membership", true, "engineering_manager"],
  ] as const)(
    "#208: an application_admin with %s gets 200 and one access row recording it; insert < event < floor < reply",
    async (_label, isMember, membershipRole) => {
      routeTopic002({ globalRole: "application_admin", isMember, membershipRole });

      const { app, replySpy } = await buildAppWithReplySpy();
      const res = await app.inject({ method: "GET", url: TOPIC_002_URL });

      expect(res.statusCode).toBe(200);
      const inserts = auditInsertCalls("admin.topic_config_accessed");
      expect(inserts).toHaveLength(1);
      expect(auditInsertCalls()).toHaveLength(1);
      expect(auditInsertCalls("admin.topic_config_denied")).toHaveLength(0);
      expect(eventCalls("admin.topic_config_denied")).toHaveLength(0);
      expect(auditInsertMetadata(inserts[0]!).membership_role).toBe(membershipRole);
      expectAuditTailOrder("admin.topic_config_accessed", replySpy);
    },
  );

  // #208 task 2.1 (topic-annotation scenario: an administrator who manages
  // the team reads its definitions; the audit carries no definition text).
  it("#208: an application_admin with an engineering_manager membership gets 200 with topic data and exactly one access row recording engineering_manager", async () => {
    const DEF_X = "Definition-X-sentinel-208a";
    const DEF_Y = "Definition-Y-sentinel-208b";
    routeTopic002({
      globalRole: "application_admin",
      isMember: true,
      membershipRole: "engineering_manager",
      roles: ["application_admin", "engineering_manager"],
      active: [
        {
          id: "topic-x",
          name: "Topic X",
          prompt: "X?",
          vote_type: "finger",
          display_order: 1,
          is_default: false,
          first_session_description: null,
          created_at: new Date("2026-09-01T00:00:00.000Z"),
          updated_at: new Date("2026-09-01T00:00:00.000Z"),
          team_annotation: DEF_X,
          annotation_updated_at: new Date("2026-09-20T10:00:00.000Z"),
          annotation_updated_by: "user-f",
          annotation_updated_by_display_name: "Fran Facilitator",
        },
      ],
      archived: [
        {
          id: "topic-y",
          name: "Topic Y",
          prompt: "Y?",
          vote_type: "finger",
          is_default: false,
          archived_at: new Date("2026-09-29T12:00:00.000Z"),
          archived_by: null,
          archived_by_display_name: null,
          restored_at: null,
          restored_by: null,
          restored_by_display_name: null,
          team_annotation: DEF_Y,
          annotation_updated_at: new Date("2026-09-21T10:00:00.000Z"),
          annotation_updated_by: "user-f",
          annotation_updated_by_display_name: "Fran Facilitator",
        },
      ],
    });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: TOPIC_002_URL });

    expect(res.statusCode).toBe(200);
    const body = res.json() as GetAllTopicsResponse;
    expect(body.active.map((t) => t.teamAnnotation)).toEqual([DEF_X]);
    expect(body.archived.map((t) => t.teamAnnotation)).toEqual([DEF_Y]);
    expect(body.canEditAnnotations).toBe(false);
    expect(body.canAddTopics).toBe(true);

    const inserts = auditInsertCalls("admin.topic_config_accessed");
    expect(inserts).toHaveLength(1);
    expect(auditInsertCalls()).toHaveLength(1);
    const metadata = auditInsertMetadata(inserts[0]!);
    expect(metadata).toMatchObject({ membership_role: "engineering_manager", annotated_count: 2 });
    expect(JSON.stringify(metadata)).not.toContain(DEF_X);
    expect(JSON.stringify(metadata)).not.toContain(DEF_Y);

    const events = eventCalls("admin.topic_config_accessed");
    expect(events).toHaveLength(1);
    const payload = events[0]![2] as Record<string, unknown>;
    expect(payload["membershipRole"]).toBe("engineering_manager");
    expect(JSON.stringify(payload)).not.toContain(DEF_X);
    expect(JSON.stringify(payload)).not.toContain(DEF_Y);
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
    // Only the auth query and the #264 denial audit insert ran -- no
    // resource queries reached.
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
    expect(String(mockDbQuery.mock.calls[1]![0])).toMatch(/INSERT INTO audit_log/);
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
// #264 task 0.2 -- the TOPIC-002 403 baseline. The fixture was captured
// against the pre-change handler. #263 deliberately hand-edited it to add the
// `code` member (exactly two insertions), so it is no longer a pre-change
// baseline; the describe title keeps "baseline" on purpose. It is still never
// regenerated from the handler: later commits must keep these exact bytes
// (status, Content-Type, body) on every denial path, including audit-failure
// paths.
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/:teamId/topics/all -- 403 baseline snapshot (#264 task 0.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbQuery.mockReset();
    unroutedSql = [];
  });
  afterEach(() => expect(unroutedSql).toEqual([]));

  it.each([
    ["NOT_A_FACILITATOR", "engineer", false],
    ["FACILITATOR_IS_TEAM_MEMBER", "facilitator", true],
  ] as const)("%s 403 equals the committed snapshot", async (reason, globalRole, isMember) => {
    routeTopic002({ globalRole, isMember });
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: TOPIC_002_URL });

    const snap = baseline403[reason];
    expect(res.statusCode).toBe(snap.status);
    expect(res.headers["content-type"]).toBe(snap.contentType);
    const parsed = res.json() as { error: { correlationId: string } };
    expect(res.body.replace(parsed.error.correlationId, baseline403.correlationIdPlaceholder)).toBe(snap.body);
  });
});

// ---------------------------------------------------------------------------
// topic-annotation Task 5.3 — TOPIC-002 annotation fields and
// canEditAnnotations; TOPIC-001 carries no annotation (design.md Decision 8).
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/:teamId/topics/all — team annotation (topic-annotation design.md Decision 8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbQuery.mockReset();
    unroutedSql = [];
  });
  afterEach(() => expect(unroutedSql).toEqual([]));

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
    // #232 task 2.0: admin requests go through the SQL-routed fixture; the
    // facilitator path keeps its positional queue and queues no extra row.
    if (globalRole === "application_admin") {
      routeTopic002({ globalRole, active, archived });
      return;
    }
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

// ---------------------------------------------------------------------------
// #232 (232-topic-002-admin-read-audit-no-manager) tasks 3.2–3.7, as amended
// by #208 (which reverses #232's admission bar) — TOPIC-002's administrator
// arm: the text-free audit rows and events, fail-closed handling, and the
// facilitator / global-EM regressions. Every admin test uses the SQL-routed
// fixture (task 2.0).
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/:teamId/topics/all — administrator audit (#232, #208)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbQuery.mockReset();
    unroutedSql = [];
  });
  afterEach(() => expect(unroutedSql).toEqual([]));

  const ACTIVE_DEFINITION = "OUR-SECRET-DEFINITION-ACTIVE";
  const ARCHIVED_DEFINITION = "OUR-SECRET-DEFINITION-ARCHIVED";
  const ACTIVE_NAME = "Pipeline Confidence Zeta";
  const ARCHIVED_NAME = "Retired Topic Omega";
  const ACTIVE_ID = "topic-active-0001";
  const ARCHIVED_ID = "topic-archived-0002";
  // The team name is the routeTopic002 fixture default; after the reads it is
  // the only other datum the handler holds (implementation review security N4).
  const TEAM_NAME = "Platform Squad";
  const FORBIDDEN_STRINGS = [
    ACTIVE_DEFINITION,
    ARCHIVED_DEFINITION,
    ACTIVE_NAME,
    ARCHIVED_NAME,
    ACTIVE_ID,
    ARCHIVED_ID,
    TEAM_NAME,
  ];

  const annotatedActive = {
    id: ACTIVE_ID,
    name: ACTIVE_NAME,
    prompt: "Confidence in the pipeline",
    vote_type: "finger",
    display_order: 0,
    is_default: false,
    first_session_description: null,
    created_at: new Date("2026-09-01T00:00:00.000Z"),
    updated_at: new Date("2026-09-01T00:00:00.000Z"),
    team_annotation: ACTIVE_DEFINITION,
    annotation_updated_at: new Date("2026-09-20T10:00:00.000Z"),
    annotation_updated_by: "user-f",
    annotation_updated_by_display_name: "Fran Facilitator",
  };
  const annotatedArchived = {
    id: ARCHIVED_ID,
    name: ARCHIVED_NAME,
    prompt: "An old prompt",
    vote_type: "finger",
    is_default: false,
    archived_at: new Date("2026-09-29T12:00:00.000Z"),
    archived_by: null,
    archived_by_display_name: null,
    restored_at: null,
    restored_by: null,
    restored_by_display_name: null,
    team_annotation: ARCHIVED_DEFINITION,
    annotation_updated_at: new Date("2026-09-21T10:00:00.000Z"),
    annotation_updated_by: "user-f",
    annotation_updated_by_display_name: "Fran Facilitator",
  };
  const unannotatedActive = { ...annotatedActive, id: "topic-plain-0003", name: "Plain", team_annotation: null };

  const ACCESS_METADATA_KEYS = [
    "active_count",
    "actor_idp_roles_include_em",
    "annotated_count",
    "archived_count",
    "endpoint",
    "http_status",
    "membership_role",
  ];
  const ACCESS_EVENT_KEYS = [
    "activeCount",
    "actorGlobalRole",
    "actorIdpRolesIncludeEm",
    "actorIp",
    "actorRoles",
    "actorUserId",
    "annotatedCount",
    "archivedCount",
    "endpoint",
    "httpStatus",
    "membershipRole",
    "teamId",
  ];
  function eventPayload(event: string): Record<string, unknown> {
    const calls = eventCalls(event);
    expect(calls).toHaveLength(1);
    return calls[0]![2] as Record<string, unknown>;
  }

  function expectTextFree(value: unknown) {
    const text = JSON.stringify(value);
    for (const forbidden of FORBIDDEN_STRINGS) expect(text).not.toContain(forbidden);
  }

  function adminEvents(): unknown[][] {
    return mockEmitAuditEvent.mock.calls.filter((c) => String(c[1]).startsWith("admin."));
  }

  async function get(url = TOPIC_002_URL) {
    const app = await buildApp();
    return app.inject({ method: "GET", url });
  }

  function dbError(code: string) {
    return Object.assign(new Error("boom: row value leaked-sensitive-detail"), { code, detail: "Key (x)=(leaked-detail)" });
  }

  // -------------------------------------------------------------------------
  // 3.2, converted by #208 (design.md D2, engineer E1): the membership role is
  // recorded raw. An unrecognised value (the DB enum has no third value, so
  // only a unit test can pin this) is admitted and recorded verbatim. If this
  // fails because the value was mapped, dropped or denied, an allow-list has
  // been put back: the membership role is audit data, not an admission input.
  // -------------------------------------------------------------------------
  it("3.2: an unrecognised membership role (observer) gets 200 and is recorded verbatim in the access row and event", async () => {
    routeTopic002({ isMember: true, membershipRole: "observer" });

    const res = await get();

    expect(res.statusCode).toBe(200);
    const inserts = auditInsertCalls("admin.topic_config_accessed");
    expect(inserts).toHaveLength(1);
    expect(auditInsertCalls()).toHaveLength(1);
    expect(auditInsertMetadata(inserts[0]!).membership_role).toBe("observer");
    expect(eventPayload("admin.topic_config_accessed")["membershipRole"]).toBe("observer");
  });

  // -------------------------------------------------------------------------
  // 3.3 — rows and events (design.md D5)
  // -------------------------------------------------------------------------
  // #208: run with and without an engineering_manager membership; the key
  // set is the same and only membership_role differs.
  it.each([
    ["no membership", false, null],
    ["an engineering_manager membership", true, "engineering_manager"],
  ] as const)("3.3: with %s, the access row and event carry exactly the specified keys and values, text-free, with actor_roles", async (_label, isMember, membershipRole) => {
    routeTopic002({
      isMember,
      membershipRole,
      active: [annotatedActive],
      archived: [annotatedArchived],
      roles: ["application_admin"],
    });

    const res = await get();

    expect(res.statusCode).toBe(200);
    const body = res.json() as GetAllTopicsResponse;
    const [insert] = auditInsertCalls("admin.topic_config_accessed");
    expect(String(insert![0])).toMatch(/actor_roles\)[\s\S]*\$7::text\[\]/);
    const params = insert![1] as unknown[];
    expect(params[0]).toBe("actor-1");
    expect(params[1]).toBe("application_admin");
    expect(params[3]).toBe("admin.topic_config_accessed");
    expect(params[4]).toBe(TOPIC_002_TEAM_ID);
    expect(params[6]).toEqual(["application_admin"]);

    const metadata = auditInsertMetadata(insert!);
    expect(Object.keys(metadata).sort()).toEqual(ACCESS_METADATA_KEYS);
    expect(metadata).toEqual({
      endpoint: "GET /api/v1/teams/:teamId/topics/all",
      http_status: 200,
      membership_role: membershipRole,
      actor_idp_roles_include_em: false,
      active_count: body.active.length,
      archived_count: body.archived.length,
      annotated_count: 2,
    });
    expect(metadata.active_count).toBe(1);
    expect(metadata.archived_count).toBe(1);
    expectTextFree(metadata);

    const payload = eventPayload("admin.topic_config_accessed");
    expect(Object.keys(payload).sort()).toEqual(ACCESS_EVENT_KEYS);
    expect(payload).toMatchObject({
      actorUserId: "actor-1",
      actorGlobalRole: "application_admin",
      teamId: TOPIC_002_TEAM_ID,
      endpoint: "GET /api/v1/teams/:teamId/topics/all",
      httpStatus: 200,
      membershipRole,
      actorRoles: ["application_admin"],
      actorIdpRolesIncludeEm: false,
      activeCount: 1,
      archivedCount: 1,
      annotatedCount: 2,
    });
    expectTextFree(payload);
  });

  it.each([
    [["application_admin"], false],
    [["application_admin", "engineering_manager"], true],
  ])("3.3: roles %j record actor_idp_roles_include_em = %s, equal to actor_roles.includes('engineering_manager')", async (roles, expected) => {
    routeTopic002({ roles });

    expect((await get()).statusCode).toBe(200);
    const [insert] = auditInsertCalls("admin.topic_config_accessed");
    const actorRoles = (insert![1] as unknown[])[6] as string[];
    expect(actorRoles).toEqual(roles);
    expect(auditInsertMetadata(insert!).actor_idp_roles_include_em).toBe(expected);
    expect(auditInsertMetadata(insert!).actor_idp_roles_include_em).toBe(actorRoles.includes("engineering_manager"));
  });

  // #265: replaces the pre-change "team_found is false" case. A team lookup
  // that returns no row is a 404 and writes no access row at all.
  it("3.3: a team lookup that returns no row is 404 with no access row (replaces team_found = false)", async () => {
    routeTopic002({ teamName: null });

    const res = await get();

    expect(res.statusCode).toBe(404);
    expect(auditInsertCalls()).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 3.4 — fail closed (spec "Failure handling on the administrator arm")
  // -------------------------------------------------------------------------
  function expectAuditWriteFailed(operation: string, stage: string, errorCode: string | null) {
    const payload = eventPayload("admin.audit_write_failed");
    expect(payload).toEqual({
      actorUserId: "actor-1",
      teamId: TOPIC_002_TEAM_ID,
      endpoint: "GET /api/v1/teams/:teamId/topics/all",
      operation,
      stage,
      errorCode,
    });
    const text = JSON.stringify(payload);
    expect(text).not.toContain("boom");
    expect(text).not.toContain("leaked");
  }

  function expectNoTopicQuery() {
    expect(sqlCallsMatching(/FROM topics/)).toHaveLength(0);
  }

  it("3.4: a rejected access insert is 500 with no topic data and one admin.audit_write_failed", async () => {
    routeTopic002({
      active: [annotatedActive],
      archived: [annotatedArchived],
      reject: [{ match: /INSERT INTO audit_log/, error: dbError("53100") }],
    });

    const res = await get();

    expect(res.statusCode).toBe(500);
    expectTextFree(res.body);
    expectAuditWriteFailed("admin.topic_config_accessed", "audit_insert", "53100");
    expect(eventCalls("admin.topic_config_accessed")).toHaveLength(0);
  });

  it("3.4: a rejected membership read is 500, runs no topic/lock query (the team-name read now precedes it, #265) and emits no admin.audit_write_failed", async () => {
    routeTopic002({ reject: [{ match: /SELECT role FROM team_memberships/, error: dbError("08006") }] });

    const { app, thrown } = await buildAppWithErrorCapture();
    const res = await app.inject({ method: "GET", url: TOPIC_002_URL });

    expect(res.statusCode).toBe(500);
    expectGeneric500(res.body);
    expect(thrown).toHaveLength(1);
    expect((thrown[0] as { code?: string }).code).toBe("08006");
    // #265 deliberately changes the #259 order pinned here: the team-name
    // read now runs before the membership read, so only topic and lock
    // queries are still absent.
    expect(sqlCallsMatching(/FROM topics/)).toHaveLength(0);
    expect(sqlCallsMatching(/COUNT\(\*\) AS count FROM sessions/)).toHaveLength(0);
    expect(res.body).not.toContain("Platform Squad");
    expect(eventCalls("admin.audit_write_failed")).toHaveLength(0);
    expect(auditInsertCalls()).toHaveLength(0);
  });

  it("3.4: a rejected role-set read on an admitted request is 500 with no topic data and no topic query", async () => {
    routeTopic002({
      active: [annotatedActive],
      reject: [{ match: /roles::text\[\] AS roles FROM users/, error: dbError("57014") }],
    });

    const res = await get();

    expect(res.statusCode).toBe(500);
    expectTextFree(res.body);
    expectNoTopicQuery();
    expect(auditInsertCalls()).toHaveLength(0);
    expectAuditWriteFailed("admin.topic_config_accessed", "role_set_read", "57014");
  });

  it("3.4: a role-set read returning zero rows is 500, not 200 with a defaulted false", async () => {
    routeTopic002({ roles: null, active: [annotatedActive] });

    const res = await get();

    expect(res.statusCode).toBe(500);
    expectTextFree(res.body);
    expectNoTopicQuery();
    expect(auditInsertCalls()).toHaveLength(0);
    expectAuditWriteFailed("admin.topic_config_accessed", "role_set_read", null);
  });

  // -------------------------------------------------------------------------
  // 3.5 / 3.5a — audited on every read, no deduplication
  // -------------------------------------------------------------------------
  it("3.5: an admin read of the template team writes exactly one access row", async () => {
    routeTopic002({ teamName: "__default_topics__" });

    const res = await get(`/api/v1/teams/${DEFAULT_TOPICS_TEAM_ID}/topics/all`);

    expect(res.statusCode).toBe(200);
    const inserts = auditInsertCalls("admin.topic_config_accessed");
    expect(inserts).toHaveLength(1);
    expect((inserts[0]![1] as unknown[])[4]).toBe(DEFAULT_TOPICS_TEAM_ID);
  });

  it("3.5: a team with topics but no definitions still writes one access row with annotated_count 0", async () => {
    routeTopic002({ active: [unannotatedActive] });

    expect((await get()).statusCode).toBe(200);
    const inserts = auditInsertCalls("admin.topic_config_accessed");
    expect(inserts).toHaveLength(1);
    expect(auditInsertMetadata(inserts[0]!)).toMatchObject({ annotated_count: 0, active_count: 1 });
  });

  it("3.5a: two admin requests for the same team write two access rows (no deduplication)", async () => {
    routeTopic002();

    const app = await buildApp();
    expect((await app.inject({ method: "GET", url: TOPIC_002_URL })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: TOPIC_002_URL })).statusCode).toBe(200);

    expect(auditInsertCalls("admin.topic_config_accessed")).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // 3.6 — facilitator regression
  // -------------------------------------------------------------------------
  it("3.6: a non-member facilitator gets 200, canEditAnnotations true, no admin.* insert, and only the helper's team_memberships query", async () => {
    routeTopic002({ globalRole: "facilitator", isMember: false });

    const res = await get();

    expect(res.statusCode).toBe(200);
    expect((res.json() as GetAllTopicsResponse).canEditAnnotations).toBe(true);
    expect(auditInsertCalls()).toHaveLength(0);
    expect(adminEvents()).toHaveLength(0);
    // The shared helper issues exactly one team_memberships query (its LEFT
    // JOIN); the administrator arm's membership and role-set reads never run.
    const helperCount = sqlCallsMatching(/FROM users u\s[\s\S]*team_memberships/).length;
    expect(helperCount).toBe(1);
    expect(sqlCallsMatching(/team_memberships/)).toHaveLength(helperCount);
    expect(sqlCallsMatching(/roles::text\[\]/)).toHaveLength(0);
  });

  it("3.6: a member facilitator gets 403 with the existing message", async () => {
    routeTopic002({ globalRole: "facilitator", isMember: true, membershipRole: "participant" });

    const res = await get();

    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toBe("A facilitator cannot view topic management for a team they are a member of.");
    expect(sqlCallsMatching(/SELECT role FROM team_memberships/)).toHaveLength(0);
    expect(auditInsertCalls("admin.topic_config_accessed")).toHaveLength(0);
  });

  it("3.6: a global facilitator with an engineering_manager membership gets 403 as a member-facilitator", async () => {
    routeTopic002({ globalRole: "facilitator", isMember: true, membershipRole: "engineering_manager" });

    const res = await get();

    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toBe("A facilitator cannot view topic management for a team they are a member of.");
    expect(sqlCallsMatching(/SELECT role FROM team_memberships/)).toHaveLength(0);
    expect(auditInsertCalls("admin.topic_config_accessed")).toHaveLength(0);
    expect(adminEvents()).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 3.7 — global engineering manager regression
  // -------------------------------------------------------------------------
  it.each([
    ["no membership", false, null],
    ["a participant membership", true, "participant"],
    ["an engineering_manager membership", true, "engineering_manager"],
  ] as const)("3.7: a global engineering_manager with %s gets 403 NOT_A_FACILITATOR and no admin.* insert", async (_label, isMember, membershipRole) => {
    routeTopic002({ globalRole: "engineering_manager", isMember, membershipRole });

    const res = await get();

    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toBe("Only a facilitator or an application admin can view this team's topic list.");
    expect(auditInsertCalls("admin.topic_config_accessed")).toHaveLength(0);
    expect(adminEvents()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// #264 -- TOPIC-002 non-admin denial audit. Fail-open on the response, one
// durable row and one event per denial, 403 byte-identical to the 0.2
// snapshot on every path. Uses the SQL-routed fixture.
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/:teamId/topics/all -- non-admin denial audit (#264)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbQuery.mockReset();
    unroutedSql = [];
  });
  afterEach(() => expect(unroutedSql).toEqual([]));

  const OP = "topic.config_list_denied";
  const ENDPOINT = "GET /api/v1/teams/:teamId/topics/all";
  const DENIAL_EVENT_KEYS = [
    "actorGlobalRole",
    "actorIp",
    "actorRoles",
    "actorUserId",
    "endpoint",
    "httpStatus",
    "reason",
    "rowWritten",
    "teamId",
  ];
  const FAILURE_EVENT_KEYS = [
    "actorUserId",
    "endpoint",
    "errorCode",
    "failureMode",
    "operation",
    "reason",
    "stage",
    "teamId",
  ];
  const CASES = [
    ["NOT_A_FACILITATOR", { globalRole: "engineer", isMember: false }, "engineer"],
    ["NOT_A_FACILITATOR", { globalRole: "engineering_manager", isMember: true }, "engineering_manager"],
    ["FACILITATOR_IS_TEAM_MEMBER", { globalRole: "facilitator", isMember: true }, "facilitator"],
    // #263: a facilitator whose team membership role is engineering_manager.
    ["FACILITATOR_IS_TEAM_MEMBER", { globalRole: "facilitator", isMember: true, membershipRole: "engineering_manager" }, "facilitator"],
  ] as const;

  async function get() {
    const app = await buildApp();
    return app.inject({ method: "GET", url: TOPIC_002_URL });
  }

  function denialEvents() {
    return eventCalls(OP);
  }
  function failureEvents() {
    return eventCalls("topic.audit_write_failed");
  }

  /** The 403 equals the committed 0.2 snapshot (status, Content-Type, body string). */
  function expectBaseline403(res: { statusCode: number; headers: Record<string, unknown>; body: string }, reason: "NOT_A_FACILITATOR" | "FACILITATOR_IS_TEAM_MEMBER") {
    const snap = baseline403[reason];
    expect(res.statusCode).toBe(snap.status);
    expect(res.headers["content-type"]).toBe(snap.contentType);
    const id = (JSON.parse(res.body) as { error: { correlationId: string } }).error.correlationId;
    expect(res.body.replace(id, baseline403.correlationIdPlaceholder)).toBe(snap.body);
    // No header or field mentions auditing.
    expect(Object.keys(res.headers).join(",").toLowerCase()).not.toContain("audit");
    expect(res.body.toLowerCase()).not.toContain("audit");
  }

  it.each(CASES)("%s (%s): exactly one durable row with the decision's role, request.ip, and the pinned metadata", async (reason, fixture, role) => {
    routeTopic002(fixture);
    const res = await get();

    expectBaseline403(res, reason);
    const inserts = auditInsertCalls(OP);
    expect(inserts).toHaveLength(1);
    expect(auditInsertCalls()).toHaveLength(1);
    const params = inserts[0]![1] as unknown[];
    expect(params).toEqual(["actor-1", role, "127.0.0.1", OP, TOPIC_002_TEAM_ID, expect.any(String)]);
    expect(auditInsertMetadata(inserts[0]!)).toEqual({ endpoint: ENDPOINT, http_status: 403, reason });
    expect(Object.keys(auditInsertMetadata(inserts[0]!)).sort()).toEqual(["endpoint", "http_status", "reason"]);
    expect(failureEvents()).toHaveLength(0);
  });

  it("the insert SQL is a constant string: casts on every parameter, no request data interpolated (Security A2)", async () => {
    routeTopic002({ globalRole: "engineer" });
    await get();
    const sql = String(auditInsertCalls(OP)[0]![0]);
    for (const cast of ["$1::uuid", "$2::text", "$3::inet", "$4::text", "$5::uuid", "$6::jsonb"]) {
      expect(sql).toContain(cast);
    }
    expect(sql).toMatch(/FROM \(SELECT 1\) s LEFT JOIN users u ON u\.id = \$1::uuid/);
    expect(sql).toMatch(/RETURNING actor_roles/);
    for (const datum of ["actor-1", TOPIC_002_TEAM_ID, "127.0.0.1", "NOT_A_FACILITATOR", "engineer"]) {
      expect(sql).not.toContain(datum);
    }
    // The text is the same constant on a second request.
    mockDbQuery.mockClear();
    await get();
    expect(String(auditInsertCalls(OP)[0]![0])).toBe(sql);
  });

  it("the denial event carries exactly nine keys; actorRoles is what the insert returned", async () => {
    routeTopic002({ globalRole: "engineer", denialRoles: ["participant", "engineering_manager"] });
    await get();
    const events = denialEvents();
    expect(events).toHaveLength(1);
    const payload = events[0]![2] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(DENIAL_EVENT_KEYS);
    expect(payload).toEqual({
      actorUserId: "actor-1",
      actorGlobalRole: "engineer",
      actorIp: "127.0.0.1",
      teamId: TOPIC_002_TEAM_ID,
      endpoint: ENDPOINT,
      httpStatus: 403,
      reason: "NOT_A_FACILITATOR",
      actorRoles: ["participant", "engineering_manager"], // stored order, not sorted
      rowWritten: true,
    });
  });

  it("a caller with no users row: row with 'unknown' and NULL roles, 403 unchanged, no failure event", async () => {
    routeTopic002({ noUsersRow: true, denialRoles: null });
    const res = await get();

    expectBaseline403(res, "NOT_A_FACILITATOR");
    const inserts = auditInsertCalls(OP);
    expect(inserts).toHaveLength(1);
    expect((inserts[0]![1] as unknown[])[1]).toBe("unknown");
    expect(auditInsertMetadata(inserts[0]!).reason).toBe("NOT_A_FACILITATOR");
    const payload = denialEvents()[0]![2] as Record<string, unknown>;
    expect(payload["actorGlobalRole"]).toBe("unknown");
    expect(payload["actorRoles"]).toBeNull();
    expect(payload["rowWritten"]).toBe(true);
    expect(failureEvents()).toHaveLength(0);
  });

  it("the same caller denied twice writes two rows and two events (no dedup)", async () => {
    routeTopic002({ globalRole: "engineer" });
    const app = await buildApp();
    await app.inject({ method: "GET", url: TOPIC_002_URL });
    await app.inject({ method: "GET", url: TOPIC_002_URL });
    expect(auditInsertCalls(OP)).toHaveLength(2);
    expect(denialEvents()).toHaveLength(2);
  });

  it("reason precedence: a non-facilitator member is NOT_A_FACILITATOR, only a member facilitator is FACILITATOR_IS_TEAM_MEMBER", async () => {
    routeTopic002({ globalRole: "engineering_manager", isMember: true });
    await get();
    expect(auditInsertMetadata(auditInsertCalls(OP)[0]!).reason).toBe("NOT_A_FACILITATOR");
    mockDbQuery.mockReset();
    routeTopic002({ globalRole: "facilitator", isMember: true });
    await get();
    expect(auditInsertMetadata(auditInsertCalls(OP)[0]!).reason).toBe("FACILITATOR_IS_TEAM_MEMBER");
  });

  it("a malformed team id is the untouched 404: no helper call, no row, no event", async () => {
    routeTopic002({ globalRole: "engineer" });
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/not-a-uuid/topics/all" });
    expect(res.statusCode).toBe(404);
    expect(mockDbQuery).not.toHaveBeenCalled();
    expect(denialEvents()).toHaveLength(0);
  });

  it("a random valid team id writes a row with that team_id, no teams lookup, no failure event", async () => {
    routeTopic002({ globalRole: "engineer" });
    const other = "99999999-9999-4999-8999-999999999999";
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/api/v1/teams/${other}/topics/all` });
    expect(res.statusCode).toBe(403);
    expect((auditInsertCalls(OP)[0]![1] as unknown[])[4]).toBe(other);
    expect(failureEvents()).toHaveLength(0);
  });

  it.each(CASES)("call order on %s (%s): insert, event, floor, send", async (_reason, fixture) => {
    routeTopic002(fixture);
    const { app, replySpy } = await buildAppWithReplySpy();
    await app.inject({ method: "GET", url: TOPIC_002_URL });
    expectAuditTailOrder(OP, replySpy);
  });

  // ---- #263: error.code on the two 403s ---------------------------------
  const MESSAGES = {
    NOT_A_FACILITATOR: "Only a facilitator or an application admin can view this team's topic list.",
    FACILITATOR_IS_TEAM_MEMBER: "A facilitator cannot view topic management for a team they are a member of.",
  } as const;

  it.each(CASES)("#263 %s (%s): 403 carries category, code and the exact message, no-store", async (reason, fixture) => {
    routeTopic002(fixture);
    const res = await get();
    expect(res.statusCode).toBe(403);
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json() as { error: { category: string; code: string; message: string } };
    expect(body.error.category).toBe("forbidden");
    expect(body.error.code).toBe(reason);
    expect(body.error.message).toBe(MESSAGES[reason]);
  });

  // A distinct fixture from the active-member CASES row: a user who previously
  // ran sessions for the team and is now a member of it. The helper decides on
  // is_member alone, so the outcome is the member-facilitator denial.
  it("returning facilitator who is a member of the team gets FACILITATOR_IS_TEAM_MEMBER", async () => {
    routeTopic002({ globalRole: "facilitator", isMember: true, membershipRole: "participant" });
    const res = await get();
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("FACILITATOR_IS_TEAM_MEMBER");
    expect(body.error.message).toBe(MESSAGES.FACILITATOR_IS_TEAM_MEMBER);
  });

  it.each(CASES)("#263 %s (%s): error.code equals the audit row metadata.reason", async (reason, fixture) => {
    routeTopic002(fixture);
    const res = await get();
    const code = (res.json() as { error: { code: string } }).error.code;
    expect(code).toBe(auditInsertMetadata(auditInsertCalls(OP)[0]!).reason);
    expect(code).toBe(reason);
  });

  it.each([
    ["rejected insert", { match: /INSERT INTO audit_log/, error: new Error("boom") }],
  ] as const)("#263 audit failure (%s): 403 still carries the code and equals the fixture", async (_label, rej) => {
    for (const [reason, fixture] of [
      ["NOT_A_FACILITATOR", { globalRole: "engineer", isMember: false }],
      ["FACILITATOR_IS_TEAM_MEMBER", { globalRole: "facilitator", isMember: true }],
    ] as const) {
      mockDbQuery.mockReset();
      routeTopic002({ ...fixture, reject: [rej] });
      const res = await get();
      expect((res.json() as { error: { code: string } }).error.code).toBe(reason);
      expectBaseline403(res, reason);
    }
  });

  it("#263 audit timeout: the hanging insert still gives the 403 with the code, equal to the fixture", async () => {
    routeTopic002({ globalRole: "facilitator", isMember: true });
    const route = mockDbQuery.getMockImplementation()!;
    mockDbQuery.mockImplementation((sql: unknown, params: unknown) =>
      /INSERT INTO audit_log/.test(String(sql)) ? new Promise(() => undefined) : route(sql, params),
    );
    const res = await get();
    expect((res.json() as { error: { code: string } }).error.code).toBe("FACILITATOR_IS_TEAM_MEMBER");
    expectBaseline403(res, "FACILITATOR_IS_TEAM_MEMBER");
  });

  it("#263 exactly two observable bodies and two codes across every denial fixture", async () => {
    const normalise = (r: { body: string }) => {
      const id = (JSON.parse(r.body) as { error: { correlationId: string } }).error.correlationId;
      return r.body.replace(id, baseline403.correlationIdPlaceholder);
    };
    const bodies = new Set<string>();
    const codes = new Set<string>();
    for (const [, fixture] of CASES) {
      mockDbQuery.mockReset();
      routeTopic002(fixture);
      const res = await get();
      bodies.add(normalise(res));
      codes.add((res.json() as { error: { code: string } }).error.code);
    }
    const message =
      "A new or different TOPIC-002 denial code is a disclosure decision; get Security review before changing this test";
    expect(bodies.size, message).toBe(2);
    expect([...bodies].sort(), message).toEqual(
      [baseline403.NOT_A_FACILITATOR.body, baseline403.FACILITATOR_IS_TEAM_MEMBER.body].sort(),
    );
    expect([...codes].sort(), message).toEqual(["FACILITATOR_IS_TEAM_MEMBER", "NOT_A_FACILITATOR"]);
  });

  it("#263 a spurious header and query parameter do not alter status, code or message", async () => {
    routeTopic002({ globalRole: "engineer", isMember: false });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `${TOPIC_002_URL}?reason=FACILITATOR_IS_TEAM_MEMBER&code=X`,
      headers: { "x-denial-reason": "FACILITATOR_IS_TEAM_MEMBER" },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("NOT_A_FACILITATOR");
    expect(body.error.message).toBe(MESSAGES.NOT_A_FACILITATOR);
  });

  it("#263 the Application Admin 200 has no code member", async () => {
    routeTopic002({ globalRole: "application_admin" });
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty("code");
    expect(res.json()).not.toHaveProperty("error");
  });

  // ---- fail-open --------------------------------------------------------
  it.each(CASES)("a rejected insert (%s, %s): 403 equals the snapshot, one failure event, denial event with rowWritten false", async (reason, fixture) => {
    routeTopic002({
      ...fixture,
      reject: [{ match: /INSERT INTO audit_log/, error: Object.assign(new Error("boom: leaked-sensitive-detail"), { code: "53100", detail: "Key (x)=(leaked-detail)" }) }],
    });
    const res = await get();

    expectBaseline403(res, reason);
    const failures = failureEvents();
    expect(failures).toHaveLength(1);
    const payload = failures[0]![2] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(FAILURE_EVENT_KEYS);
    expect(payload).toEqual({
      actorUserId: "actor-1",
      teamId: TOPIC_002_TEAM_ID,
      endpoint: ENDPOINT,
      operation: OP,
      stage: "audit_insert",
      reason,
      failureMode: "error",
      errorCode: "53100",
    });
    expect(failures[0]![3]).toBe("error"); // error level
    const text = JSON.stringify(payload);
    expect(text).not.toContain("boom");
    expect(text).not.toContain("leaked");

    const denial = denialEvents();
    expect(denial).toHaveLength(1);
    const dp = denial[0]![2] as Record<string, unknown>;
    expect(Object.keys(dp).sort()).toEqual(DENIAL_EVENT_KEYS);
    expect(dp["rowWritten"]).toBe(false);
    expect(dp["actorRoles"]).toBeNull();
    expect(dp["reason"]).toBe(reason);
  });

  it("a failure without a SQLSTATE reports errorCode null", async () => {
    routeTopic002({ globalRole: "engineer", reject: [{ match: /INSERT INTO audit_log/, error: new Error("no code") }] });
    await get();
    expect((failureEvents()[0]![2] as Record<string, unknown>)["errorCode"]).toBeNull();
  });

  it("a hanging insert times out at the 500 ms bound: 403 unchanged, failureMode timeout, no extra wait", async () => {
    routeTopic002({ globalRole: "engineer" });
    const route = mockDbQuery.getMockImplementation()!;
    mockDbQuery.mockImplementation((sql: unknown, params: unknown) =>
      /INSERT INTO audit_log/.test(String(sql)) ? new Promise(() => undefined) : route(sql, params),
    );
    const started = Date.now();
    const res = await get();
    const elapsed = Date.now() - started;

    expectBaseline403(res, "NOT_A_FACILITATOR");
    expect(elapsed).toBeGreaterThanOrEqual(450);
    expect(elapsed).toBeLessThan(900);
    const payload = failureEvents()[0]![2] as Record<string, unknown>;
    expect(payload["failureMode"]).toBe("timeout");
    expect(payload["errorCode"]).toBeNull();
    expect((denialEvents()[0]![2] as Record<string, unknown>)["rowWritten"]).toBe(false);
  });

  it("fail-open covers the insert only: a throwing helper query is still 500, with no row", async () => {
    routeTopic002({ reject: [{ match: /FROM users u/, error: new Error("helper down") }] });
    const res = await get();
    expect(res.statusCode).toBe(500);
    expect(auditInsertCalls()).toHaveLength(0);
    expect(denialEvents()).toHaveLength(0);
  });

  it("fail-open covers the insert only: a throwing timing floor is still 500", async () => {
    routeTopic002({ globalRole: "engineer" });
    mockApplyTimingFloor.mockRejectedValueOnce(new Error("floor broke"));
    const res = await get();
    expect(res.statusCode).toBe(500);
  });

  // ---- timing -----------------------------------------------------------
  it("the floor is a minimum measured from handler entry: helper plus audit of 20 ms still answers at about 150 ms, not 170 ms", async () => {
    const { applyTimingFloor: realFloor } = await vi.importActual<typeof TimingOracleModule>(
      "../../content/timing-oracle.js",
    );
    mockApplyTimingFloor.mockImplementation(realFloor);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      routeTopic002({ globalRole: "engineer" });
      const route = mockDbQuery.getMockImplementation()!;
      // 10 ms for the helper read and 10 ms for the audit insert.
      mockDbQuery.mockImplementation(
        (sql: unknown, params: unknown) =>
          new Promise((resolve, reject) => {
            setTimeout(() => route(sql, params).then(resolve, reject), 10);
          }),
      );
      const app = await buildApp();
      let doneAt: number | null = null;
      const t0 = Date.now();
      const pending = app.inject({ method: "GET", url: TOPIC_002_URL }).then((r) => {
        doneAt = Date.now() - t0;
        return r;
      });
      await vi.advanceTimersByTimeAsync(149);
      expect(doneAt).toBeNull(); // the floor has not elapsed yet
      await vi.advanceTimersByTimeAsync(1);
      const res = await pending;
      expect(res.statusCode).toBe(403);
      expect(doneAt).toBe(150); // not 170
    } finally {
      vi.useRealTimers();
      mockApplyTimingFloor.mockReset();
      mockApplyTimingFloor.mockResolvedValue(undefined);
    }
  });

  // ---- scope guards -----------------------------------------------------
  it("an admitted facilitator and an admitted admin run no denial insert and no added query", async () => {
    routeTopic002({ globalRole: "facilitator", isMember: false });
    const resF = await get();
    expect(resF.statusCode).toBe(200);
    expect(auditInsertCalls()).toHaveLength(0);
    expect(denialEvents()).toHaveLength(0);
    // Same SQL set as the #259 fixture: helper, team name, active, archived, defaults, lock.
    const facilitatorSql = mockDbQuery.mock.calls.map((c) => classifyTopic002Sql(String(c[0])));
    expect(facilitatorSql).not.toContain("audit_insert");
    expect(facilitatorSql).not.toContain("membership");
    expect(facilitatorSql).not.toContain("role_set");

    mockDbQuery.mockReset();
    routeTopic002({ globalRole: "application_admin" });
    const resA = await get();
    expect(resA.statusCode).toBe(200);
    expect(auditInsertCalls()).toHaveLength(1);
    expect(auditInsertCalls(OP)).toHaveLength(0);
    expect(auditInsertCalls("admin.topic_config_accessed")).toHaveLength(1);
  });

  it("a denied request reads no teams, topics, annotations or lock state, and nothing identifying them reaches the row or event", async () => {
    const SENTINELS = ["Platform Squad", "SECRET-TOPIC-NAME", "SECRET-TOPIC-ID", "SECRET-ANNOTATION"];
    routeTopic002({
      globalRole: "engineer",
      teamName: "Platform Squad",
      active: [{ id: "SECRET-TOPIC-ID", name: "SECRET-TOPIC-NAME", team_annotation: "SECRET-ANNOTATION" }],
    });
    await get();
    for (const call of mockDbQuery.mock.calls) {
      const sql = String(call[0]);
      expect(sql).not.toMatch(/FROM teams/);
      expect(sql).not.toMatch(/FROM topics/);
      expect(sql).not.toMatch(/COUNT\(\*\) AS count FROM sessions/);
      expect(sql).not.toMatch(/annotation/);
    }
    const serialized = JSON.stringify([auditInsertCalls(OP).map((c) => c[1]), denialEvents(), failureEvents()]);
    for (const sentinel of SENTINELS) expect(serialized).not.toContain(sentinel);
    expect(mockGetTopicLockState).not.toHaveBeenCalled();
  });

  it("the administrator arm stays fail-closed (#232): a rejected admin insert is still 500 and writes no denial row or event", async () => {
    routeTopic002({ reject: [{ match: /INSERT INTO audit_log/, error: Object.assign(new Error("x"), { code: "53100" }) }] });
    const res = await get();
    expect(res.statusCode).toBe(500);
    expect(failureEvents()).toHaveLength(0);
    expect(denialEvents()).toHaveLength(0);
  });
});

// #232 implementation review (security N1), kept by #208: the tripwire guards
// the audited admin arm. TOPIC-002 fails closed on any authorized role other
// than the two it knows, so a role the shared helper admits in future cannot
// reach the data unaudited.
describe("assertTopic002AuthorizedRole (#232 security N1)", () => {
  it("accepts facilitator and application_admin", () => {
    expect(() => assertTopic002AuthorizedRole("facilitator")).not.toThrow();
    expect(() => assertTopic002AuthorizedRole("application_admin")).not.toThrow();
  });

  it.each(["engineering_manager", "engineer", "Application_Admin", "application_admin ", ""])(
    "throws on unexpected authorized role %j, and the message names no role",
    (role) => {
      let thrown: unknown;
      try {
        assertTopic002AuthorizedRole(role);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      const message = (thrown as Error).message;
      expect(message).toMatch(/unexpected role/);
      if (role.trim() !== "") expect(message).not.toContain(role.trim());
    },
  );
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

// ---------------------------------------------------------------------------
// #265 -- TOPIC-002 answers a canonical UUID that names no team with 404.
//
// Group A (characterization): passes against the unmodified handler. It is
// the control against re-introducing an enumeration oracle (authorization
// precedes lookup) and pins the 200 shapes that must NOT become 404.
// Group B/C/D: the 404 behaviour, the audit/query shape and the key sets.
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/:teamId/topics/all -- unknown team (#265)", () => {
  const UNKNOWN_TEAM_ID = "99999999-9999-4999-8999-999999999999";
  const UNKNOWN_URL = `/api/v1/teams/${UNKNOWN_TEAM_ID}/topics/all`;
  const DENIAL_OP = "topic.config_list_denied";
  const TEAM_NAME_SQL = /SELECT name FROM teams WHERE id/;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbQuery.mockReset();
    unroutedSql = [];
  });
  afterEach(() => expect(unroutedSql).toEqual([]));

  async function get(url = TOPIC_002_URL) {
    const app = await buildApp();
    return app.inject({ method: "GET", url });
  }

  function teamsQueries(): unknown[][] {
    return sqlCallsMatching(/FROM teams/);
  }

  /** Every audit-style event emitted: anything under admin.* or topic.*. */
  function auditStyleEvents(): unknown[][] {
    return mockEmitAuditEvent.mock.calls.filter((c) => /^(admin|topic)\./.test(String(c[1])));
  }

  const UNKNOWN_TEAM_EVENT = "topic.config_read_unknown_team";

  /** The log-only probing signal (user decision 2026-10-12): never an audit_log row, never admin.*. */
  function unknownTeamEvents(): unknown[][] {
    return mockEmitAuditEvent.mock.calls.filter((c) => c[1] === UNKNOWN_TEAM_EVENT);
  }

  /**
   * Normalization named here (AC 7): `correlationId` in the body is replaced by
   * a placeholder, and the per-request `date` header is dropped. Nothing else
   * is normalized, so status, every other header and the body must match.
   */
  function normalize(res: { statusCode: number; headers: Record<string, unknown>; body: string }) {
    const headers = { ...res.headers };
    delete headers["date"];
    const id = (JSON.parse(res.body) as { error: { correlationId: string } }).error.correlationId;
    return { status: res.statusCode, headers, body: res.body.replace(id, "<correlationId>") };
  }

  // ---- Group A: characterization (already green before the handler change) --
  describe("characterization (passes before and after)", () => {
    it("AC7: a participant gets an identical 403 NOT_A_FACILITATOR for an existing and a non-existent team, each with one denial row equal except team_id", async () => {
      routeTopic002({ globalRole: "engineer", isMember: false });
      const existing = await get(TOPIC_002_URL);
      const existingRows = auditInsertCalls(DENIAL_OP);
      mockDbQuery.mockReset();
      mockEmitAuditEvent.mockClear();

      routeTopic002({ globalRole: "engineer", isMember: false, teamName: null });
      const unknown = await get(UNKNOWN_URL);
      const unknownRows = auditInsertCalls(DENIAL_OP);

      expect(existing.statusCode).toBe(403);
      expect(normalize(unknown)).toEqual(normalize(existing));
      expect(existingRows).toHaveLength(1);
      expect(unknownRows).toHaveLength(1);
      const strip = (call: unknown[]) => (call[1] as unknown[]).filter((_p, i) => i !== 4);
      expect((existingRows[0]![1] as unknown[])[4]).toBe(TOPIC_002_TEAM_ID);
      expect((unknownRows[0]![1] as unknown[])[4]).toBe(UNKNOWN_TEAM_ID);
      expect(strip(unknownRows[0]!)).toEqual(strip(existingRows[0]!));
      expect(teamsQueries()).toHaveLength(0);
    });

    it.each([
      ["a participant", { globalRole: "engineer", isMember: false }, 403],
      ["a member-facilitator", { globalRole: "facilitator", isMember: true }, 403],
    ] as const)("AC7: %s requesting a non-existent team runs zero SQL against teams", async (_label, fixture, status) => {
      routeTopic002({ ...fixture, teamName: null });
      const res = await get(UNKNOWN_URL);
      expect(res.statusCode).toBe(status);
      expect(teamsQueries()).toHaveLength(0);
      expect(unknownTeamEvents()).toEqual([]);
      expect(mockGetTopicLockState).not.toHaveBeenCalled();
    });

    it("AC7: a member-facilitator of an existing team still gets FACILITATOR_IS_TEAM_MEMBER", async () => {
      routeTopic002({ globalRole: "facilitator", isMember: true });
      const res = await get();
      expect(res.statusCode).toBe(403);
      expect(res.json().error.message).toBe("A facilitator cannot view topic management for a team they are a member of.");
      expect(auditInsertCalls(DENIAL_OP)).toHaveLength(1);
      expect(teamsQueries()).toHaveLength(0);
    });

    it("AC6: an existing team with zero topics is 200 with empty lists and its real teamName", async () => {
      routeTopic002({ globalRole: "facilitator", isMember: false, teamName: "Quiet Team" });
      const res = await get();
      expect(res.statusCode).toBe(200);
      const body = res.json() as GetAllTopicsResponse;
      expect(body.teamName).toBe("Quiet Team");
      expect(body.active).toEqual([]);
      expect(body.archived).toEqual([]);
      expect(unknownTeamEvents()).toEqual([]);
    });

    it.each([["facilitator"], ["application_admin"]])(
      "AC6: a deactivated team is 200 for %s: the name lookup filters nothing on deactivated_at",
      async (globalRole) => {
        // The mock cannot mark a team deactivated; what is pinned is that the
        // lookup SQL has no deactivated_at filter, so a deactivated row is found.
        routeTopic002({ globalRole, isMember: false, teamName: "Retired Team" });
        const res = await get();
        expect(res.statusCode).toBe(200);
        const [call] = sqlCallsMatching(TEAM_NAME_SQL);
        expect(String(call![0])).not.toMatch(/deactivated_at/);
        expect(call![1]).toEqual([TOPIC_002_TEAM_ID]);
      },
    );

    it("AC6: the template team is 200 for an admin with exactly one access row", async () => {
      routeTopic002({ teamName: "__default_topics__" });
      const res = await get(`/api/v1/teams/${DEFAULT_TOPICS_TEAM_ID}/topics/all`);
      expect(res.statusCode).toBe(200);
      expect(auditInsertCalls("admin.topic_config_accessed")).toHaveLength(1);
      expect(auditInsertCalls()).toHaveLength(1);
      expect(unknownTeamEvents()).toEqual([]);
    });

    it("N2: a decision admitting an unexpected role is 500 with no teams query", async () => {
      routeTopic002({ globalRole: "facilitator", isMember: false });
      decisionOverride.value = { authorized: true, actorGlobalRole: "engineering_manager" };
      let res;
      let thrown: unknown[];
      try {
        const built = await buildAppWithErrorCapture();
        thrown = built.thrown;
        res = await built.app.inject({ method: "GET", url: TOPIC_002_URL });
      } finally {
        decisionOverride.value = null;
      }

      expect(res.statusCode).toBe(500);
      expectGeneric500(res.body);
      expect(thrown).toHaveLength(1);
      expect((thrown[0] as Error).message).toMatch(/unexpected role/);
      expect(teamsQueries()).toHaveLength(0);
      expect(sqlCallsMatching(/FROM topics/)).toHaveLength(0);
      expect(sqlCallsMatching(/INSERT INTO audit_log/)).toHaveLength(0);
    });

    it("AC8: TOPIC-001 for an unknown team still answers 403 (no TOPIC-001 change)", async () => {
      mockNoGrant();
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: `/api/v1/teams/${UNKNOWN_TEAM_ID}/topics` });
      expect(res.statusCode).toBe(403);
      expect(sqlCallsMatching(/FROM teams/)).toHaveLength(0);
    });
  });

  // ---- Group B: the 404 ---------------------------------------------------
  describe("404 behaviour", () => {
    it.each([
      ["a standing facilitator", { globalRole: "facilitator", isMember: false }],
      ["an application admin", { globalRole: "application_admin", isMember: false }],
    ] as const)("AC1/AC3: %s requesting a canonical UUID with no team gets 404 teamNotFoundEnvelope, no-store, floor once before the reply", async (_label, fixture) => {
      routeTopic002({ ...fixture, teamName: null });
      const { app, replySpy } = await buildAppWithReplySpy();
      const res = await app.inject({ method: "GET", url: UNKNOWN_URL });

      expect(res.statusCode).toBe(404);
      // Log-only probing signal: fired once, exact fields, no topic data, before the floor.
      const events = unknownTeamEvents();
      expect(events).toHaveLength(1);
      expect(events[0]![2]).toEqual({ userId: expect.any(String), teamId: UNKNOWN_TEAM_ID, globalRole: fixture.globalRole });
      expect(Object.keys(events[0]![2] as object).sort()).toEqual(["globalRole", "teamId", "userId"]);
      expect(mockEmitAuditEvent.mock.invocationCallOrder[mockEmitAuditEvent.mock.calls.indexOf(events[0]!)]!).toBeLessThan(
        mockApplyTimingFloor.mock.invocationCallOrder[0]!,
      );
      const body = res.json() as { error: Record<string, unknown> };
      expect(body.error).toMatchObject({ category: "not_found", code: "TEAM_NOT_FOUND", message: "Team not found." });
      expect(Object.keys(body.error).sort()).toEqual(["category", "code", "correlationId", "message"]);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
      expect(replySpy).toHaveBeenCalledTimes(1);
      expect(mockApplyTimingFloor.mock.invocationCallOrder[0]!).toBeLessThan(replySpy.mock.invocationCallOrder[0]!);
    });

    it("AC3: a standing facilitator on a missing team gets 404, explicitly not 403", async () => {
      routeTopic002({ globalRole: "facilitator", isMember: false, teamName: null });
      const res = await get(UNKNOWN_URL);
      expect(res.statusCode).not.toBe(403);
      expect(res.statusCode).toBe(404);
    });

    it("AC2: an upper-case canonical UUID that matches no team is 404", async () => {
      routeTopic002({ globalRole: "facilitator", isMember: false, teamName: null });
      const res = await get(`/api/v1/teams/${UNKNOWN_TEAM_ID.toUpperCase()}/topics/all`);
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("TEAM_NOT_FOUND");
    });

    it.each([
      ["a participant", { globalRole: "engineer", isMember: false }],
      ["a facilitator", { globalRole: "facilitator", isMember: false }],
      ["an application admin", { globalRole: "application_admin", isMember: false }],
    ] as const)("AC2: a non-canonical id is 404 for %s before any query", async (_label, fixture) => {
      routeTopic002(fixture);
      const res = await get("/api/v1/teams/not-a-uuid/topics/all");
      expect(res.statusCode).toBe(404);
      expect(mockDbQuery).not.toHaveBeenCalled();
    });

    it("AC2: the order is authorization (403) before the name read (404): a participant on a missing team is 403, not 404", async () => {
      routeTopic002({ globalRole: "engineer", isMember: false, teamName: null });
      const res = await get(UNKNOWN_URL);
      expect(res.statusCode).toBe(403);
      expect(unknownTeamEvents()).toEqual([]);
    });
  });

  // ---- Group C: audit and query shape -------------------------------------
  describe("audit and query shape", () => {
    it("AC3: an admin 404 writes no audit_log row and emits no admin.* event (only the log-only unknown-team event), and runs no membership-role or role-set query", async () => {
      routeTopic002({ globalRole: "application_admin", teamName: null });
      const res = await get(UNKNOWN_URL);

      expect(res.statusCode).toBe(404);
      expect(auditInsertCalls()).toHaveLength(0);
      expect(sqlCallsMatching(/INSERT INTO audit_log/)).toHaveLength(0);
      expect(mockEmitAuditEvent.mock.calls.filter((c) => /^admin\./.test(String(c[1])))).toEqual([]);
      expect(auditStyleEvents().map((c) => c[1])).toEqual([UNKNOWN_TEAM_EVENT]);
      expect(unknownTeamEvents()).toHaveLength(1);
      expect(sqlCallsMatching(/SELECT role FROM team_memberships/)).toHaveLength(0);
      expect(sqlCallsMatching(/roles::text\[\]/)).toHaveLength(0);
      expect(sqlCallsMatching(/FROM topics/)).toHaveLength(0);
      expect(mockGetTopicLockState).not.toHaveBeenCalled();
    });

    it("AC3: a facilitator 404 writes no audit_log row and emits no admin.* event (only the log-only unknown-team event)", async () => {
      routeTopic002({ globalRole: "facilitator", isMember: false, teamName: null });
      const res = await get(UNKNOWN_URL);
      expect(res.statusCode).toBe(404);
      expect(sqlCallsMatching(/INSERT INTO audit_log/)).toHaveLength(0);
      expect(mockEmitAuditEvent.mock.calls.filter((c) => /^admin\./.test(String(c[1])))).toEqual([]);
      expect(mockEmitAuditEvent.mock.calls.map((c) => c[1])).toEqual([UNKNOWN_TEAM_EVENT]);
    });

    it("AC5: a standing facilitator on an existing team executes exactly the pre-change multiset of SQL texts", async () => {
      // Baseline recorded in task 0.1 against the unmodified handler: the
      // shared helper row, the team-name read, active, archived, defaults, lock.
      routeTopic002({ globalRole: "facilitator", isMember: false });
      const res = await get();
      expect(res.statusCode).toBe(200);
      const classified = mockDbQuery.mock.calls.map((c) => classifyTopic002Sql(String(c[0])));
      expect([...classified].sort()).toEqual(["active", "archived", "defaults", "helper", "lock", "team_name"]);
    });

    it("AC5: the admin query order is helper, team_name, membership, role_set, topics reads, lock, audit insert", async () => {
      // Deliberate change from #259: the name read now precedes the admin arm.
      routeTopic002({ globalRole: "application_admin" });
      const res = await get();
      expect(res.statusCode).toBe(200);
      const classified = mockDbQuery.mock.calls.map((c) => classifyTopic002Sql(String(c[0])));
      expect(classified.slice(0, 4)).toEqual(["helper", "team_name", "membership", "role_set"]);
      expect(classified.at(-1)).toBe("audit_insert");
    });

    it.each([
      ["a standing facilitator", { globalRole: "facilitator", isMember: false }],
      ["an application admin", { globalRole: "application_admin", isMember: false }],
    ] as const)("AC3: a failed team-name read for %s is the existing 500 with no row, no unknown-team or other audit event and no data", async (_label, fixture) => {
      routeTopic002({
        ...fixture,
        active: [{ id: "SECRET-ID", name: "SECRET-NAME" }],
        reject: [{ match: TEAM_NAME_SQL, error: Object.assign(new Error("boom: leaked-detail"), { code: "08006" }) }],
      });
      const { app, thrown } = await buildAppWithErrorCapture();
      const res = await app.inject({ method: "GET", url: TOPIC_002_URL });

      expect(res.statusCode).toBe(500);
      expect(res.body).not.toContain("SECRET");
      expect(res.body).not.toContain("Platform Squad");
      expectGeneric500(res.body);
      expect(thrown).toHaveLength(1);
      expect((thrown[0] as { code?: string }).code).toBe("08006");
      expect(sqlCallsMatching(/INSERT INTO audit_log/)).toHaveLength(0);
      expect(sqlCallsMatching(/FROM topics/)).toHaveLength(0);
      expect(auditStyleEvents()).toEqual([]);
      if (fixture.globalRole === "application_admin") {
        expect(sqlCallsMatching(/SELECT role FROM team_memberships/)).toHaveLength(0);
        expect(sqlCallsMatching(/roles::text\[\]/)).toHaveLength(0);
      }
    });
  });

  // ---- Group D: key sets --------------------------------------------------
  describe("key sets", () => {
    it("AC4: the admin 200 metadata and event key sets are exact and carry no team_found / teamFound", async () => {
      routeTopic002({ globalRole: "application_admin" });
      const res = await get();
      expect(res.statusCode).toBe(200);

      const [insert] = auditInsertCalls("admin.topic_config_accessed");
      const metadata = auditInsertMetadata(insert!);
      expect(Object.keys(metadata).sort()).toEqual([
        "active_count",
        "actor_idp_roles_include_em",
        "annotated_count",
        "archived_count",
        "endpoint",
        "http_status",
        "membership_role",
      ]);
      expect(metadata).not.toHaveProperty("team_found");

      const events = eventCalls("admin.topic_config_accessed");
      expect(events).toHaveLength(1);
      const payload = events[0]![2] as Record<string, unknown>;
      expect(Object.keys(payload).sort()).toEqual([
        "activeCount",
        "actorGlobalRole",
        "actorIdpRolesIncludeEm",
        "actorIp",
        "actorRoles",
        "actorUserId",
        "annotatedCount",
        "archivedCount",
        "endpoint",
        "httpStatus",
        "membershipRole",
        "teamId",
      ]);
      expect(payload).not.toHaveProperty("teamFound");
    });
  });
});

// ---------------------------------------------------------------------------
// zero-topic-team-recovery (#200) tasks.md 4.1 (design.md D6): canAssignDefaults
// on TOPIC-002. True only for (application admin, zero ACTIVE topics, not the
// template team); computed with the same isApplicationAdmin predicate as the
// assign-defaults endpoint. One table over all eight combinations. The
// agreement with the endpoint's own 403 for every caller class, and a template
// whose active topics are all archived, are proved against real Postgres in
// assign-defaults-flag-integration.test.ts.
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/:teamId/topics/all -- canAssignDefaults truth table (#200 4.1)", () => {
  const REAL_TEAM = "11111111-1111-4111-8111-111111111111";
  const oneActive = {
    id: "topic-1",
    name: "Pipeline",
    prompt: "Confidence in the pipeline",
    vote_type: "finger",
    display_order: 1,
    is_default: true,
    first_session_description: null,
    team_annotation: null,
    created_at: new Date("2026-09-01T00:00:00.000Z"),
    updated_at: new Date("2026-09-01T00:00:00.000Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbQuery.mockReset();
    unroutedSql = [];
  });
  afterEach(() => expect(unroutedSql).toEqual([]));

  async function flagFor(role: "application_admin" | "facilitator", zeroActive: boolean, template: boolean) {
    routeTopic002({ globalRole: role, active: zeroActive ? [] : [oneActive] });
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/teams/${template ? DEFAULT_TOPICS_TEAM_ID : REAL_TEAM}/topics/all`,
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as GetAllTopicsResponse).canAssignDefaults;
  }

  const rows: Array<[admin: boolean, zeroActive: boolean, template: boolean]> = [];
  for (const admin of [true, false]) for (const zero of [true, false]) for (const template of [true, false]) rows.push([admin, zero, template]);

  it.each(rows)("admin=%s zeroActive=%s template=%s", async (admin, zeroActive, template) => {
    const flag = await flagFor(admin ? "application_admin" : "facilitator", zeroActive, template);

    // Only (admin, zero active, not template) is true; the rest are false (the
    // handler always sends a boolean; the screen also treats absent as false).
    expect(flag).toBe(admin && zeroActive && !template);
  });

  it("an unlocked team with zero active topics still reports true for an admin (the screen picks the control from the lock state)", async () => {
    routeTopic002({ globalRole: "application_admin", active: [], completedSessions: "1" });
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: `/api/v1/teams/${REAL_TEAM}/topics/all` });

    expect(res.json()).toMatchObject({ isCustomizationLocked: false, canAssignDefaults: true });
  });

  it("archived topics do not count as active: a team with only archived topics reports true for an admin", async () => {
    routeTopic002({
      globalRole: "application_admin",
      active: [],
      archived: [
        {
          id: "topic-old",
          name: "Old",
          prompt: "Old?",
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
      ],
    });
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: `/api/v1/teams/${REAL_TEAM}/topics/all` });

    expect(res.json()).toMatchObject({ canAssignDefaults: true });
  });
});
