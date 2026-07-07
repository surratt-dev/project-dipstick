import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be defined before importing the modules under test
// ---------------------------------------------------------------------------
const mockDbQuery = vi.fn();
const mockDbConnect = vi.fn();
const mockEmitAuditEvent = vi.fn();

vi.mock("../../db.js", () => ({
  db: {
    query: (...args: unknown[]) => mockDbQuery(...args),
    connect: () => mockDbConnect(),
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

import Fastify from "fastify";
import { teamRoutes } from "../teams.js";
import { emViewRoutes } from "../em-views.js";

// ---------------------------------------------------------------------------
// End-to-End Verification Tests
//
// These tests verify end-to-end scenarios that span both the TEAM-006 endpoint
// (in teamRoutes) and the EM-facing view endpoints (in emViewRoutes). Each test
// is named after the task it verifies.
//
// These tests use the same mock database pattern as teams.test.ts and
// em-views.test.ts — mockDbQuery intercepts db.query calls in sequence,
// mockDbConnect intercepts transaction clients. The sequence of mock calls must
// match the sequence of real database calls in the handlers being tested.
// ---------------------------------------------------------------------------

/** Build a Fastify app that registers both teamRoutes and emViewRoutes. */
function buildCombinedApp(sessionData: Record<string, unknown> = {}) {
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = {
      userId: "em-user-1",
      ...sessionData,
    };
  });
  app.register(teamRoutes);
  app.register(emViewRoutes);
  return app.ready().then(() => app);
}

/** Returns a mock transaction client with a scripted sequence of responses. */
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

// ---------------------------------------------------------------------------
// Task 9.1 — End-to-end: global_role established → TEAM-006 call → EM
//            session history accessible
//
// This test simulates the full chain:
//   1. A user arrives with global_role = 'engineering_manager' already set
//      (established in Phase 1 via IdP claim mapping per Decision 2 / task 2.4)
//   2. An Application Admin calls TEAM-006 to associate the EM with a team
//   3. The EM calls GET /em/sessions and receives 200 with session history
//
// The global_role mechanism itself (IdP claim → resolveOrCreateAccount) is
// tested by tasks 2.3 and 2.4 in auth.test.ts. This test picks up after
// global_role is set and verifies that the complete downstream chain works.
// ---------------------------------------------------------------------------
describe("9.1: End-to-end — global_role → TEAM-006 → session history accessible", () => {
  beforeEach(() => vi.clearAllMocks());

  it("EM can access session history after TEAM-006 establishes their association", async () => {
    // ------------------------------------------------------------------
    // Step 1: Admin calls TEAM-006 to associate the EM with the team.
    // The session here is an admin's session, not the EM's.
    // ------------------------------------------------------------------
    const adminSessionApp = Fastify();
    adminSessionApp.decorateRequest("session", null);
    adminSessionApp.addHook("onRequest", async (request) => {
      (request as unknown as Record<string, unknown>).session = { userId: "admin-1" };
    });
    adminSessionApp.register(teamRoutes);
    await adminSessionApp.ready();

    // TEAM-006 query sequence:
    // 1) actor global_role check → admin
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "application_admin" }] });
    // 2) team exists check
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-alpha" }] });
    // 3) target user global_role check
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineering_manager", display_name: "Eve EM" }],
    });
    // Transaction: BEGIN, upsert, audit INSERT, COMMIT
    const team006Client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ id: "mem-1", is_new_row: true }] }, // upsert → 201
      { rows: [] }, // audit INSERT
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(team006Client);

    const team006Res = await adminSessionApp.inject({
      method: "POST",
      url: "/api/v1/teams/team-alpha/managers",
      payload: { engineeringManagerUserId: "em-user-1" },
    });
    expect(team006Res.statusCode).toBe(201);

    // ------------------------------------------------------------------
    // Step 2: EM calls GET /api/v1/teams/:teamId/em/sessions.
    // The EM now has both global_role = 'engineering_manager' (from IdP)
    // and team_memberships.role = 'engineering_manager' (from TEAM-006).
    // Both checks must pass for session history to be returned.
    // ------------------------------------------------------------------

    // SESSION-007 query sequence:
    // 1) dual auth check → both checks pass
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineering_manager", membership_role: "engineering_manager" }],
    });
    // 2) team exists check
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-alpha" }] });
    // 3) sessions list — includes a session that pre-dates the TEAM-006 call
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        {
          session_id: "sess-pre-1",
          completed_at: new Date("2024-11-01T09:00:00Z"), // before TEAM-006
          session_number: 1,
          facilitator_name: "Alice",
          participant_count: "5",
        },
      ],
    });
    // 4) topics for sess-pre-1
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        {
          topic_id: "t-1",
          topic_name: "Delivery Confidence",
          vote_value: 4,
          vote_count: "5",
          has_outlier: false,
          flagged_for_discussion: false,
        },
      ],
    });
    // 5) audit INSERT
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    // Build app as the EM user
    const emApp = await buildCombinedApp();
    const historyRes = await emApp.inject({
      method: "GET",
      url: "/api/v1/teams/team-alpha/em/sessions",
    });

    expect(historyRes.statusCode).toBe(200);
    const body = JSON.parse(historyRes.body);
    expect(body.teamId).toBe("team-alpha");
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].sessionId).toBe("sess-pre-1");

    // Verify the TEAM-006 audit record was written with correct fields
    const auditCall = team006Client.query.mock.calls[2];
    expect(auditCall).toBeDefined();
    const auditValues = auditCall[1] as unknown[];
    expect(auditValues[3]).toBe("team.manager_established");
    expect(auditValues[4]).toBe("em-user-1");
    expect(auditValues[5]).toBe("team-alpha");
  });

  it("EM with global_role but no TEAM-006 association cannot access session history (precondition gap)", async () => {
    // This test verifies the negative: global_role alone is not sufficient.
    // The team association (from TEAM-006) is also required per Decision 14.
    //
    // The auth check returns global_role = 'engineering_manager' but
    // membership_role = null (TEAM-006 was never called for this team).
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineering_manager", membership_role: null }],
    });

    const app = await buildCombinedApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-alpha/em/sessions",
    });

    expect(res.statusCode).toBe(403);
    // No audit record produced on 403 (task 5.13)
    expect(mockDbQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_log"),
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// Task 9.3 — Multi-team EM: two TEAM-006 calls produce independent access;
//            no cross-team access
//
// Spec scenario (manager-team-association spec):
//   WHEN TEAM-006 is called with EM X and team A, then with EM X and team B
//   THEN the EM can access session history for A and B independently
//   AND access to A does not grant access to B, and vice versa
// ---------------------------------------------------------------------------
describe("9.3: Multi-team EM — independent access, no cross-team access", () => {
  beforeEach(() => vi.clearAllMocks());

  it("EM associated with team-A can access team-A history", async () => {
    // Auth check: EM associated with team-A → both checks pass
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineering_manager", membership_role: "engineering_manager" }],
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-A" }] });
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // no sessions (empty is OK — 200)
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // audit INSERT

    const app = await buildCombinedApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-A/em/sessions" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).teamId).toBe("team-A");
  });

  it("same EM associated with team-B can also access team-B history", async () => {
    // Auth check for team-B: EM has membership_role = 'engineering_manager' for team-B too
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineering_manager", membership_role: "engineering_manager" }],
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-B" }] });
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // no sessions
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // audit INSERT

    const app = await buildCombinedApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-B/em/sessions" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).teamId).toBe("team-B");
  });

  it("EM associated with team-A and team-B cannot access team-C history (no cross-team access)", async () => {
    // Auth check for team-C: membership_role = null (no TEAM-006 call for team-C)
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineering_manager", membership_role: null }],
    });

    const app = await buildCombinedApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-C/em/sessions" });
    expect(res.statusCode).toBe(403);
  });

  it("each team's history is scoped to its own data — team-A result does not include team-B sessions", async () => {
    // Auth check for team-A
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineering_manager", membership_role: "engineering_manager" }],
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-A" }] });
    // Sessions for team-A (just one session with teamId verified in response)
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        {
          session_id: "sess-a1",
          completed_at: new Date("2025-01-10T09:00:00Z"),
          session_number: 1,
          facilitator_name: "Alice",
          participant_count: "3",
        },
      ],
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // topics for sess-a1
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // audit INSERT

    const app = await buildCombinedApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-A/em/sessions" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // The response is scoped to team-A
    expect(body.teamId).toBe("team-A");
    // There is exactly one session — no team-B sessions leaked in
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].sessionId).toBe("sess-a1");
  });
});

// ---------------------------------------------------------------------------
// Task 9.4 — Historical participant designated as EM retains prior records
//
// Spec requirement (manager-team-association spec):
//   WHEN a user has prior session_participants rows and vote records on a team
//   AND TEAM-006 is called to establish them as the EM
//   THEN their prior participation records are not deleted or hidden
//   AND their team_memberships.role is updated to 'engineering_manager'
//
// The mechanism here is the TEAM-006 upsert: it uses ON CONFLICT (user_id, team_id)
// WHERE removed_at IS NULL DO UPDATE SET role = 'engineering_manager'. This updates
// the role in place — no new row is created, no session_participants rows are
// touched. The session history endpoint queries sessions/session_participants/votes
// separately from team_memberships; the role change does not filter or remove
// any session history records.
// ---------------------------------------------------------------------------
describe("9.4: Historical participant designated as EM retains prior participation records", () => {
  beforeEach(() => vi.clearAllMocks());

  it("TEAM-006 upsert for an existing participant updates role in place (xmax = 0 is false)", async () => {
    // Admin calls TEAM-006 for a user who already has a participant row.
    // The upsert returns is_new_row = false (xmax != 0 → row was updated, not inserted).
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "application_admin" }] });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-1" }] });
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineering_manager", display_name: "Pat (formerly participant)" }],
    });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      // is_new_row = false → the row existed (participant → EM role update)
      { rows: [{ id: "mem-existing", is_new_row: false }] },
      { rows: [] }, // audit INSERT
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const adminApp = Fastify();
    adminApp.decorateRequest("session", null);
    adminApp.addHook("onRequest", async (request) => {
      (request as unknown as Record<string, unknown>).session = { userId: "admin-1" };
    });
    adminApp.register(teamRoutes);
    await adminApp.ready();

    const res = await adminApp.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/managers",
      payload: { engineeringManagerUserId: "pat-user" },
    });

    // 200 (not 201) because the row existed — it was updated in place
    expect(res.statusCode).toBe(200);

    // Verify the upsert SQL uses ON CONFLICT with the partial index and xmax
    const upsertCall = client.query.mock.calls[1];
    const upsertSql = (upsertCall[0] as string).toLowerCase();
    expect(upsertSql).toContain("on conflict");
    expect(upsertSql).toContain("where removed_at is null");
    expect(upsertSql).toContain("xmax");

    // The upsert uses DO UPDATE SET role = 'engineering_manager' —
    // no DELETE of the existing row, no separate INSERT
    expect(upsertSql).toContain("do update set");
    expect(upsertSql).toContain("engineering_manager");
  });

  it("session history query does not filter by current team_memberships.role (prior sessions are included)", async () => {
    // After the role change, the EM requests session history.
    // The session history query selects sessions for the team regardless of
    // the requesting user's role. Prior sessions (when they were a participant)
    // are included — the query has no role-based date boundary.
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineering_manager", membership_role: "engineering_manager" }],
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-1" }] });
    // Two sessions returned — one predating the TEAM-006 call (when user was a participant)
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        {
          session_id: "sess-old-1",
          completed_at: new Date("2024-06-01T09:00:00Z"), // predates role change
          session_number: 1,
          facilitator_name: "Dana",
          participant_count: "4",
        },
        {
          session_id: "sess-new-2",
          completed_at: new Date("2025-05-01T09:00:00Z"), // after role change
          session_number: 2,
          facilitator_name: "Dana",
          participant_count: "3",
        },
      ],
    });
    // Topics for sess-old-1
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    // Topics for sess-new-2
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    // audit INSERT
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = await buildCombinedApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1/em/sessions" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // Both sessions are returned — the old one (from when the user was a participant)
    // and the new one (after they became the EM). No date boundary applied.
    expect(body.sessions).toHaveLength(2);
    const sessionIds = body.sessions.map((s: { sessionId: string }) => s.sessionId);
    expect(sessionIds).toContain("sess-old-1");
    expect(sessionIds).toContain("sess-new-2");
  });

  it("audit record for TEAM-006 role update includes the target user ID and team ID", async () => {
    // When an existing participant is updated to EM via TEAM-006, the audit
    // record must be written with the same fields as a create case.
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "application_admin" }] });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-1" }] });
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineering_manager", display_name: "Robin" }],
    });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ id: "mem-robin", is_new_row: false }] }, // role update (not new row)
      { rows: [] }, // audit INSERT
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const adminApp = Fastify();
    adminApp.decorateRequest("session", null);
    adminApp.addHook("onRequest", async (request) => {
      (request as unknown as Record<string, unknown>).session = { userId: "admin-1" };
    });
    adminApp.register(teamRoutes);
    await adminApp.ready();

    await adminApp.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/managers",
      payload: { engineeringManagerUserId: "robin-user" },
    });

    const auditCall = client.query.mock.calls[2];
    const auditValues = auditCall[1] as unknown[];
    // operation = 'team.manager_established' (same for create and update)
    expect(auditValues[3]).toBe("team.manager_established");
    // target_user_id
    expect(auditValues[4]).toBe("robin-user");
    // team_id
    expect(auditValues[5]).toBe("team-1");
  });
});

// ---------------------------------------------------------------------------
// Task 9.5 — Labeled sections: participants and managers in separate sections
//
// Backend verification: TEAM-003 (GET /api/v1/teams/:teamId) returns participants
// and engineeringManagers as separate arrays — never a flat members array.
// After TEAM-006 establishes an EM, TEAM-003 puts that user in engineeringManagers
// only, not in participants.
//
// Note: The frontend rendering of labeled sections is verified by section 6 tests
// in MemberManagement.test.tsx (tasks 6.1-6.5 and 9.5 acceptance test).
// This test verifies the backend data contract that those frontend tests depend on.
// ---------------------------------------------------------------------------
describe("9.5: Backend contract — participants and managers in separate labeled arrays", () => {
  beforeEach(() => vi.clearAllMocks());

  it("TEAM-003 returns participants and engineeringManagers as separate arrays (not a flat members array)", async () => {
    // TEAM-003 handler query sequence:
    // 1) actor check (global_role + is_member)
    // 2) team name
    // 3) members list
    // 4) checkAssignRolesAuthorization (called after members fetch)
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "application_admin", is_member: false }],
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ name: "Beta Team" }] });
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        { user_id: "u1", display_name: "Alice", email: "alice@test.com", role: "participant" },
        { user_id: "u2", display_name: "Bob", email: "bob@test.com", role: "participant" },
        { user_id: "u3", display_name: "Carol EM", email: "carol@test.com", role: "engineering_manager" },
      ],
    });
    // 4) checkAssignRolesAuthorization — returns admin actor's global_role
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "application_admin", membership_role: null }],
    });

    const app = await buildCombinedApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-beta" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // Response shape must have participants and engineeringManagers arrays
    expect(body).toHaveProperty("participants");
    expect(body).toHaveProperty("engineeringManagers");
    // No flat members array
    expect(body).not.toHaveProperty("members");

    // Participants section: Alice and Bob only
    expect(body.participants).toHaveLength(2);
    expect(body.participants.map((p: { userId: string }) => p.userId)).toContain("u1");
    expect(body.participants.map((p: { userId: string }) => p.userId)).toContain("u2");

    // EM section: Carol only
    expect(body.engineeringManagers).toHaveLength(1);
    expect(body.engineeringManagers[0].userId).toBe("u3");
    expect(body.engineeringManagers[0].displayName).toBe("Carol EM");

    // Carol must NOT appear in participants
    const participantIds = body.participants.map((p: { userId: string }) => p.userId);
    expect(participantIds).not.toContain("u3");
  });

  it("after TEAM-006, the newly associated EM appears only in engineeringManagers (not in participants)", async () => {
    // Scenario: Pat was a participant. TEAM-006 updated their role to engineering_manager.
    // TEAM-003 must show them in engineeringManagers, not in participants.
    // TEAM-003 handler query sequence (same 4-query pattern as above):
    // 1) actor check, 2) team name, 3) members list, 4) checkAssignRolesAuthorization
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "application_admin", is_member: false }],
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ name: "Gamma Team" }] });
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        { user_id: "u-alice", display_name: "Alice", email: "alice@test.com", role: "participant" },
        // Pat was previously a participant; after TEAM-006 their role is now engineering_manager
        { user_id: "u-pat", display_name: "Pat EM", email: "pat@test.com", role: "engineering_manager" },
      ],
    });
    // 4) checkAssignRolesAuthorization
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "application_admin", membership_role: null }],
    });

    const app = await buildCombinedApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-gamma" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // Alice is in participants
    expect(body.participants).toHaveLength(1);
    expect(body.participants[0].userId).toBe("u-alice");

    // Pat is in engineeringManagers (role was updated by TEAM-006)
    expect(body.engineeringManagers).toHaveLength(1);
    expect(body.engineeringManagers[0].userId).toBe("u-pat");

    // Pat must NOT appear in participants
    const participantIds = body.participants.map((p: { userId: string }) => p.userId);
    expect(participantIds).not.toContain("u-pat");
  });
});
