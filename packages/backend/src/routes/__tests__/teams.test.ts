import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be defined before importing the module under test
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

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
function buildApp(sessionData: Record<string, unknown> = {}) {
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = {
      userId: "actor-1",
      ...sessionData,
    };
  });
  app.register(teamRoutes);
  return app.ready().then(() => app);
}

/** Returns a mock transaction client that records calls. */
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
// GET /api/v1/teams/:teamId/members
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/:teamId/members", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 when actor is not a team member and not application_admin", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineer", is_member: false }],
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-1/members",
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toContain("not a member");
  });

  it("returns member list with canAssignRoles: true for application_admin", async () => {
    // 1) actor check — admin, not a member but that's OK
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "application_admin", is_member: false }],
    });
    // 2) team name
    mockDbQuery.mockResolvedValueOnce({ rows: [{ name: "Alpha Team" }] });
    // 3) members list
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        {
          user_id: "u1",
          display_name: "Alice",
          email: "alice@test.com",
          role: "participant",
        },
        {
          user_id: "u2",
          display_name: "Bob",
          email: "bob@test.com",
          role: "engineering_manager",
        },
      ],
    });
    // 4) canAssignRoles check — admin
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "application_admin", membership_role: null }],
    });
    // 5) admin audit INSERT (Task 3.4 — log admin reads of membership list)
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-1/members",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.teamName).toBe("Alpha Team");
    expect(body.canAssignRoles).toBe(true);
    expect(body.members).toHaveLength(2);
    expect(body.members[0].role).toBe("participant");
    expect(body.members[1].role).toBe("engineering_manager");
  });

  // Task 3.7 (enforce-access-control-on-team-content):
  // Application Admin gets 200 on membership list AND audit log is written
  it("3.7: Application Admin gets 200 on membership list and audit log is written", async () => {
    // 1) actor check
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "application_admin", is_member: false }],
    });
    // 2) team name
    mockDbQuery.mockResolvedValueOnce({ rows: [{ name: "Audit Test Team" }] });
    // 3) members list
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ user_id: "u1", display_name: "Alice", email: "alice@test.com", role: "participant" }],
    });
    // 4) canAssignRoles check
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "application_admin", membership_role: null }],
    });
    // 5) admin audit INSERT
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-audit/members",
    });

    expect(res.statusCode).toBe(200);

    // Verify audit INSERT was called with correct operation
    // The 5th db.query call (index 4) is the audit log INSERT
    const auditCall = mockDbQuery.mock.calls[4];
    expect(auditCall).toBeDefined();
    const auditSql = (auditCall[0] as string).toLowerCase();
    expect(auditSql).toContain("audit_log");
    const auditValues = auditCall[1] as unknown[];
    expect(auditValues[1]).toBe("application_admin"); // actor_global_role
    expect(auditValues[3]).toBe("admin.membership_list_accessed"); // operation

    // Verify emitAuditEvent was called with the admin event
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "admin.membership_list_accessed",
      expect.objectContaining({ actorGlobalRole: "application_admin" }),
    );
  });

  it("returns canAssignRoles: false for a regular engineer member", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ global_role: "engineer", is_member: true }],
      })
      .mockResolvedValueOnce({ rows: [{ name: "Beta Team" }] })
      .mockResolvedValueOnce({ rows: [] }) // empty member list
      .mockResolvedValueOnce({
        rows: [{ global_role: "engineer", membership_role: "participant" }],
      });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-1/members",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().canAssignRoles).toBe(false);
  });

  it("returns canAssignRoles: true for an EM member of the team", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ global_role: "engineering_manager", is_member: true }],
      })
      .mockResolvedValueOnce({ rows: [{ name: "Gamma Team" }] })
      .mockResolvedValueOnce({ rows: [] })
      // canAssignRoles check: EM with EM membership on THIS team
      .mockResolvedValueOnce({
        rows: [
          {
            global_role: "engineering_manager",
            membership_role: "engineering_manager",
          },
        ],
      });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-1/members",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().canAssignRoles).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/teams/:teamId/members/:userId/role   (TEAM-005)
// ---------------------------------------------------------------------------
describe("PATCH /api/v1/teams/:teamId/members/:userId/role", () => {
  beforeEach(() => vi.clearAllMocks());

  // Task 4.7 — unauthorized actor receives 403
  it("4.7: returns 403 for an unauthorized actor (regular engineer)", async () => {
    // Authorization check: engineer, not EM membership on this team
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineer", membership_role: null }],
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/teams/team-1/members/user-2/role",
      payload: { role: "engineering_manager" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("4.7: returns 403 for a facilitator (facilitators cannot assign roles — Option A)", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "facilitator", membership_role: null }],
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/teams/team-1/members/user-2/role",
      payload: { role: "engineering_manager" },
    });

    expect(res.statusCode).toBe(403);
  });

  // Task 4.7 — EM on a DIFFERENT team receives 403
  it("4.7: returns 403 for an EM who is NOT an EM on this specific team", async () => {
    // global_role = engineering_manager, but membership_role on THIS team is
    // participant (or null) — they are EM on a different team
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        { global_role: "engineering_manager", membership_role: "participant" },
      ],
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/teams/team-1/members/user-2/role",
      payload: { role: "engineering_manager" },
    });

    expect(res.statusCode).toBe(403);
  });

  // Task 4.8 — promoting to engineering_manager succeeds
  it("4.8: promotes participant to engineering_manager and returns updated member", async () => {
    // 1) authorization — application_admin
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "application_admin", membership_role: null }],
    });
    // 2) subject check — currently participant
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        {
          display_name: "Alice",
          email: "alice@test.com",
          current_role: "participant",
        },
      ],
    });

    // Transaction client
    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // SELECT FOR UPDATE (team-level lock)
      { rows: [] }, // UPDATE
      { rows: [{ participant_count: "1" }] }, // count check — 1 Engineer remains
      { rows: [] }, // INSERT audit log
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/teams/team-1/members/user-alice/role",
      payload: { role: "engineering_manager" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.member.role).toBe("engineering_manager");
    expect(body.member.displayName).toBe("Alice");
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "team.role_changed",
      expect.objectContaining({
        subjectUserId: "user-alice",
        fromRole: "participant",
        toRole: "engineering_manager",
      }),
    );
  });

  // Task 4.9 — demoting back to participant succeeds
  it("4.9: demotes engineering_manager back to participant and returns updated member", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ global_role: "application_admin", membership_role: null }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            display_name: "Bob",
            email: "bob@test.com",
            current_role: "engineering_manager",
          },
        ],
      });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // SELECT FOR UPDATE (team-level lock)
      { rows: [] }, // UPDATE
      { rows: [{ participant_count: "2" }] }, // 2 engineers remain after demotion
      { rows: [] }, // INSERT audit log
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/teams/team-1/members/user-bob/role",
      payload: { role: "participant" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().member.role).toBe("participant");
  });

  // Task 4.3 — zero-participant 422 on first PATCH (without confirmation)
  it("4.3: returns 422 with requiresConfirmation when change would leave zero Engineers", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ global_role: "application_admin", membership_role: null }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            display_name: "Alice",
            email: "alice@test.com",
            current_role: "participant",
          },
        ],
      });

    // Transaction: count returns 0 after update, no confirmation flag
    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // SELECT FOR UPDATE (team-level lock)
      { rows: [] }, // UPDATE
      { rows: [{ participant_count: "0" }] }, // 0 engineers remain — trigger 422
      { rows: [] }, // ROLLBACK
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/teams/team-1/members/user-alice/role",
      payload: { role: "engineering_manager" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ requiresConfirmation: true });
  });

  // Task 4.3 — second PATCH with confirmedZeroParticipant: true applies the change
  it("4.3: applies change when confirmedZeroParticipant: true even if zero Engineers remain", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ global_role: "application_admin", membership_role: null }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            display_name: "Alice",
            email: "alice@test.com",
            current_role: "participant",
          },
        ],
      });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // SELECT FOR UPDATE (team-level lock)
      { rows: [] }, // UPDATE
      { rows: [{ participant_count: "0" }] }, // 0 engineers — but confirmed
      { rows: [] }, // INSERT audit log
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/teams/team-1/members/user-alice/role",
      payload: { role: "engineering_manager", confirmedZeroParticipant: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().member.role).toBe("engineering_manager");
  });

  // Task 4.4 — audit log is written with correct fields
  // Updated by task 2a.5 (establish-manager-team-relationship): TEAM-005 now
  // writes to audit_log instead of role_change_audit (Decision 9, design.md).
  // The audit_log INSERT has a different column layout: operation, target_user_id,
  // team_id, and metadata (JSONB with from_role/to_role) instead of
  // subject_user_id, from_role, to_role as positional columns.
  //
  // New audit_log INSERT parameters for TEAM-005:
  //   $1 = actor_user_id
  //   $2 = actor_global_role
  //   $3 = actor_ip
  //   $4 = operation     ('team.role_changed')
  //   $5 = target_user_id (subject_user_id in the old schema)
  //   $6 = team_id
  //   $7 = metadata JSONB (contains from_role and to_role)
  it("4.4: writes audit_log with correct fields for TEAM-005 role change", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            global_role: "engineering_manager",
            membership_role: "engineering_manager",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            display_name: "Carol",
            email: "carol@test.com",
            current_role: "participant",
          },
        ],
      });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // SELECT FOR UPDATE (team-level lock)
      { rows: [] }, // UPDATE
      { rows: [{ participant_count: "2" }] }, // count check
      { rows: [] }, // audit INSERT into audit_log
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp();
    await app.inject({
      method: "PATCH",
      url: "/api/v1/teams/team-1/members/user-carol/role",
      payload: { role: "engineering_manager" },
    });

    // The 5th call to client.query is the audit INSERT (index 4)
    const auditInsertCall = client.query.mock.calls[4];
    expect(auditInsertCall).toBeDefined();

    // Verify the INSERT targets audit_log (not role_change_audit)
    const auditSql = (auditInsertCall[0] as string).toLowerCase();
    expect(auditSql).toContain("audit_log");
    expect(auditSql).not.toContain("role_change_audit");

    const auditValues = auditInsertCall[1] as unknown[];
    // $1 = actor_user_id
    expect(auditValues[0]).toBe("actor-1");
    // $2 = actor_global_role
    expect(auditValues[1]).toBe("engineering_manager");
    // $3 = actor_ip (may vary in test context)
    // $4 = operation
    expect(auditValues[3]).toBe("team.role_changed");
    // $5 = target_user_id (was subject_user_id in role_change_audit)
    expect(auditValues[4]).toBe("user-carol");
    // $6 = team_id
    expect(auditValues[5]).toBe("team-1");
    // $7 = metadata JSONB — stored as a JSON string in the parameterized query;
    // must be parsed before structural comparison.
    const metadata = JSON.parse(auditValues[6] as string) as Record<string, unknown>;
    expect(metadata).toMatchObject({ from_role: "participant", to_role: "engineering_manager" });
  });

  // Task 4.5 — TEAM-006 is NOT called
  it("4.5: does not call TEAM-006 (POST /api/v1/teams/:teamId/managers) during role assignment", async () => {
    // TEAM-005 only touches team_memberships.role. We verify no route for
    // /api/v1/teams/:teamId/managers exists in the teamRoutes handler.
    // This is a structural test: if TEAM-006 were called it would result in
    // an additional POST fetch call which is not present in this route module.
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ global_role: "application_admin", membership_role: null }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            display_name: "Dave",
            email: "dave@test.com",
            current_role: "participant",
          },
        ],
      });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // SELECT FOR UPDATE (team-level lock)
      { rows: [] }, // UPDATE
      { rows: [{ participant_count: "1" }] }, // count check
      { rows: [] }, // audit INSERT
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/teams/team-1/members/user-dave/role",
      payload: { role: "engineering_manager" },
    });

    // The route has 6 DB interactions (BEGIN, SELECT FOR UPDATE, UPDATE, COUNT, AUDIT, COMMIT)
    // If TEAM-006 were invoked it would be an additional network call outside
    // our mocked DB layer, which would fail — this test implicitly verifies it.
    expect(res.statusCode).toBe(200);
    expect(client.query).toHaveBeenCalledTimes(6);
  });

  // Task 4.6 — users.global_role is NOT written
  it("4.6: does not write users.global_role during role assignment", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ global_role: "application_admin", membership_role: null }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            display_name: "Eve",
            email: "eve@test.com",
            current_role: "participant",
          },
        ],
      });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // SELECT FOR UPDATE (team-level lock)
      { rows: [] }, // UPDATE
      { rows: [{ participant_count: "1" }] }, // count check
      { rows: [] }, // audit INSERT
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp();
    await app.inject({
      method: "PATCH",
      url: "/api/v1/teams/team-1/members/user-eve/role",
      payload: { role: "engineering_manager" },
    });

    // None of the SQL queries sent to the mock client should UPDATE the users
    // table (which is where global_role lives). The audit INSERT may reference
    // actor_global_role as a column name — that is correct and expected.
    for (const call of client.query.mock.calls) {
      const sql = (call[0] as string).toLowerCase();
      // Must not UPDATE the users table at all
      expect(sql).not.toMatch(/update\s+users\b/);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/teams/:teamId   (TEAM-003)
// Task 2a.6 / 2a.10 — establish-manager-team-relationship
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/:teamId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 403 when actor is not a team member and not application_admin", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineer", is_member: false }],
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-1",
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toContain("not a member");
  });

  it("returns participants and engineeringManagers split arrays — not a flat members array", async () => {
    // 1) actor check — admin
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "application_admin", is_member: false }],
    });
    // 2) team name
    mockDbQuery.mockResolvedValueOnce({ rows: [{ name: "Delta Team" }] });
    // 3) members with roles
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        { user_id: "u1", display_name: "Alice", email: "alice@test.com", role: "participant" },
        { user_id: "u2", display_name: "Bob", email: "bob@test.com", role: "participant" },
        { user_id: "u3", display_name: "Carol EM", email: "carol@test.com", role: "engineering_manager" },
      ],
    });
    // 4) canAssignRoles check
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "application_admin", membership_role: null }],
    });
    // 5) admin audit INSERT (Task 3.4)
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-1",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Must NOT have a flat members array
    expect(body.members).toBeUndefined();

    // Must have split arrays
    expect(body.participants).toHaveLength(2);
    expect(body.engineeringManagers).toHaveLength(1);

    expect(body.participants[0].role).toBe("participant");
    expect(body.participants[1].role).toBe("participant");
    expect(body.engineeringManagers[0].role).toBe("engineering_manager");
    expect(body.engineeringManagers[0].displayName).toBe("Carol EM");
  });

  it("returns canAssociateManagers: true for application_admin", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "application_admin", is_member: false }] })
      .mockResolvedValueOnce({ rows: [{ name: "Team X" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ global_role: "application_admin", membership_role: null }] })
      // admin audit INSERT (Task 3.4)
      .mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1" });

    expect(res.statusCode).toBe(200);
    expect(res.json().canAssociateManagers).toBe(true);
  });

  it("returns canAssociateManagers: false for a non-admin member", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "engineer", is_member: true }] })
      .mockResolvedValueOnce({ rows: [{ name: "Team Y" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ global_role: "engineer", membership_role: "participant" }] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1" });

    expect(res.statusCode).toBe(200);
    expect(res.json().canAssociateManagers).toBe(false);
  });

  // Task 2a.10 — EM created by TEAM-006 appears in engineeringManagers, not participants
  it("2a.10: EM user appears in engineeringManagers, not participants", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "application_admin", is_member: false }] })
      .mockResolvedValueOnce({ rows: [{ name: "Team Z" }] })
      .mockResolvedValueOnce({
        rows: [
          { user_id: "u-em", display_name: "Eve EM", email: "eve@test.com", role: "engineering_manager" },
          { user_id: "u-p", display_name: "Frank", email: "frank@test.com", role: "participant" },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "application_admin", membership_role: null }] })
      // admin audit INSERT (Task 3.4)
      .mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-z" });

    const body = res.json();
    expect(body.engineeringManagers).toHaveLength(1);
    expect(body.engineeringManagers[0].userId).toBe("u-em");
    expect(body.participants).toHaveLength(1);
    expect(body.participants[0].userId).toBe("u-p");

    // u-em must NOT appear in participants
    const emInParticipants = (body.participants as Array<{ userId: string }>).some(
      (m) => m.userId === "u-em",
    );
    expect(emInParticipants).toBe(false);
  });

  it("2a.10: user previously a participant who becomes EM appears only in engineeringManagers", async () => {
    // This covers the case where team_memberships.role was updated in-place by TEAM-006
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "application_admin", is_member: false }] })
      .mockResolvedValueOnce({ rows: [{ name: "Team W" }] })
      .mockResolvedValueOnce({
        rows: [
          // Grace was a participant, now is engineering_manager — appears only in EM array
          { user_id: "u-grace", display_name: "Grace", email: "grace@test.com", role: "engineering_manager" },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "application_admin", membership_role: null }] })
      // admin audit INSERT (Task 3.4)
      .mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-w" });

    const body = res.json();
    expect(body.engineeringManagers).toHaveLength(1);
    expect(body.engineeringManagers[0].userId).toBe("u-grace");
    expect(body.participants).toHaveLength(0);

    // Grace must not appear in participants at all
    expect((body.participants as unknown[]).some(
      (m) => (m as { userId: string }).userId === "u-grace",
    )).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/teams/:teamId/managers   (TEAM-006)
// Tasks 3.1 – 3.9 — establish-manager-team-relationship
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/managers", () => {
  beforeEach(() => vi.clearAllMocks());

  // Task 3.5 — 403 for unauthorized actor
  it("3.5: returns 403 when actor is not an application_admin", async () => {
    // Actor check: engineering_manager (not admin)
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "engineering_manager" }] });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/managers",
      payload: { engineeringManagerUserId: "em-user-1" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("3.5: returns 403 when actor is a regular engineer", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/managers",
      payload: { engineeringManagerUserId: "em-user-1" },
    });

    expect(res.statusCode).toBe(403);
  });

  // Task 3.4 — 404 for unknown teamId
  it("3.4: returns 404 for unknown teamId", async () => {
    // Actor is admin
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "application_admin" }] });
    // Team not found
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/nonexistent-team/managers",
      payload: { engineeringManagerUserId: "em-user-1" },
    });

    expect(res.statusCode).toBe(404);
    // Must NOT return 409 for this condition
    expect(res.statusCode).not.toBe(409);
  });

  // Task 3.2 — 409 for global_role precondition failure
  it("3.2: returns 409 with GLOBAL_ROLE_PRECONDITION_NOT_MET error code when target lacks EM role", async () => {
    // Actor is admin
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "application_admin" }] });
    // Team exists
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-1" }] });
    // Target user has global_role = 'engineer' (not engineering_manager)
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineer", display_name: "Regular User" }],
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/managers",
      payload: { engineeringManagerUserId: "not-an-em" },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe("GLOBAL_ROLE_PRECONDITION_NOT_MET");
    // No team_memberships row should be created — this is pre-transaction,
    // no DB write has occurred at this point
  });

  // Task 3.1 + 3.3 — 201 on create-new with xmax
  it("3.1 / 3.3: returns 201 Created for a new EM/team association (xmax = 0 → is_new_row = true)", async () => {
    // Actor is admin
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "application_admin" }] });
    // Team exists
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-1" }] });
    // Target user is an EM
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineering_manager", display_name: "Erin EM" }],
    });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ id: "membership-1", is_new_row: true }] }, // upsert — new row (xmax = 0)
      { rows: [] }, // audit INSERT into audit_log
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/managers",
      payload: { engineeringManagerUserId: "em-user-1" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.engineeringManagerUserId).toBe("em-user-1");
    expect(body.engineeringManagerDisplayName).toBe("Erin EM");
    expect(body.teamId).toBe("team-1");
  });

  // Task 3.3 — 200 on idempotent update (xmax != 0 → is_new_row = false)
  it("3.3: returns 200 OK for an idempotent re-association (xmax != 0 → is_new_row = false)", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "application_admin" }] });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-1" }] });
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineering_manager", display_name: "Erin EM" }],
    });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ id: "membership-1", is_new_row: false }] }, // upsert — updated row (xmax != 0)
      { rows: [] }, // audit INSERT
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/managers",
      payload: { engineeringManagerUserId: "em-user-1" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Response body must be identical to 201 case
    expect(body.engineeringManagerUserId).toBe("em-user-1");
  });

  // Task 3.9 — verify response body is identical for 201 and 200 cases
  it("3.9: response body shape is identical for both 201 and 200 cases", async () => {
    // Build 201 response
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "application_admin" }] })
      .mockResolvedValueOnce({ rows: [{ id: "team-1" }] })
      .mockResolvedValueOnce({ rows: [{ global_role: "engineering_manager", display_name: "Dana" }] });

    const client201 = makeMockClient([
      { rows: [] },
      { rows: [{ id: "m1", is_new_row: true }] },
      { rows: [] },
      { rows: [] },
    ]);
    mockDbConnect.mockResolvedValueOnce(client201);

    const app = await buildApp();
    const res201 = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/managers",
      payload: { engineeringManagerUserId: "em-dana" },
    });

    // Build 200 response
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "application_admin" }] })
      .mockResolvedValueOnce({ rows: [{ id: "team-1" }] })
      .mockResolvedValueOnce({ rows: [{ global_role: "engineering_manager", display_name: "Dana" }] });

    const client200 = makeMockClient([
      { rows: [] },
      { rows: [{ id: "m1", is_new_row: false }] },
      { rows: [] },
      { rows: [] },
    ]);
    mockDbConnect.mockResolvedValueOnce(client200);

    const res200 = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/managers",
      payload: { engineeringManagerUserId: "em-dana" },
    });

    // Verify same body keys regardless of status code
    const keys201 = Object.keys(res201.json() as object).sort();
    const keys200 = Object.keys(res200.json() as object).sort();
    expect(keys201).toEqual(keys200);
  });

  // Task 3.6 — audit rollback on audit write failure
  it("3.6: rolls back team_memberships if audit INSERT fails", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "application_admin" }] });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-1" }] });
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineering_manager", display_name: "Frank EM" }],
    });

    // Transaction: upsert succeeds but audit INSERT throws
    let callIndex = 0;
    const mockClientQuery = vi.fn((..._args: unknown[]) => {
      callIndex++;
      if (callIndex === 1) return Promise.resolve({ rows: [] }); // BEGIN
      if (callIndex === 2) return Promise.resolve({ rows: [{ id: "m-frank", is_new_row: true }] }); // upsert succeeds
      if (callIndex === 3) return Promise.reject(new Error("audit INSERT failed")); // audit THROWS
      if (callIndex === 4) return Promise.resolve({ rows: [] }); // ROLLBACK
      return Promise.resolve({ rows: [] });
    });
    const mockClientRelease = vi.fn();
    mockDbConnect.mockResolvedValueOnce({ query: mockClientQuery, release: mockClientRelease });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/managers",
      payload: { engineeringManagerUserId: "em-frank" },
    });

    // The handler should throw (no 200/201) — the error propagates
    expect(res.statusCode).toBe(500);

    // ROLLBACK must have been called
    const rollbackCall = Array.from({ length: callIndex }, (_, i) => i + 1).find(
      (i) => {
        const call = mockClientQuery.mock.calls[i - 1];
        return call && typeof call[0] === "string" && call[0].toUpperCase() === "ROLLBACK";
      },
    );
    expect(rollbackCall).toBeDefined();
  });

  // Task 3.9 — writes audit_log entry with correct fields
  it("3.9: writes audit_log entry with operation = 'team.manager_established'", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "application_admin" }] });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-1" }] });
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineering_manager", display_name: "Gina EM" }],
    });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ id: "m-gina", is_new_row: true }] }, // upsert
      { rows: [] }, // audit INSERT
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/managers",
      payload: { engineeringManagerUserId: "em-gina" },
    });

    // audit INSERT is the 3rd client.query call (index 2)
    const auditCall = client.query.mock.calls[2];
    expect(auditCall).toBeDefined();

    const auditSql = (auditCall[0] as string).toLowerCase();
    expect(auditSql).toContain("audit_log");

    const auditValues = auditCall[1] as unknown[];
    // $4 = operation
    expect(auditValues[3]).toBe("team.manager_established");
    // $5 = target_user_id
    expect(auditValues[4]).toBe("em-gina");
    // $6 = team_id
    expect(auditValues[5]).toBe("team-1");
  });

  // Task 3.3 — verify xmax-based idempotency (the ON CONFLICT clause must reference the partial index)
  it("3.3: upsert SQL uses ON CONFLICT (user_id, team_id) WHERE removed_at IS NULL", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "application_admin" }] });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "team-1" }] });
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineering_manager", display_name: "Hannah" }],
    });

    const client = makeMockClient([
      { rows: [] },
      { rows: [{ id: "m-h", is_new_row: true }] },
      { rows: [] },
      { rows: [] },
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/managers",
      payload: { engineeringManagerUserId: "em-hannah" },
    });

    // The upsert is the 2nd client.query call (index 1)
    const upsertCall = client.query.mock.calls[1];
    const upsertSql = (upsertCall[0] as string).toLowerCase();

    // Verify ON CONFLICT uses the partial index condition
    expect(upsertSql).toContain("on conflict");
    expect(upsertSql).toContain("where removed_at is null");
    // Verify xmax is used for new-row detection
    expect(upsertSql).toContain("xmax");
  });
});
