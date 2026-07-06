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
  it("4.4: writes audit log with actor global_role, actor IP, from-role, to-role", async () => {
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
      { rows: [] }, // audit INSERT
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
    const auditValues = auditInsertCall[1] as unknown[];
    // Values: actorUserId, actorGlobalRole, actorIp, subjectUserId, teamId, fromRole, toRole
    expect(auditValues[1]).toBe("engineering_manager"); // actor_global_role
    expect(auditValues[3]).toBe("user-carol"); // subject_user_id
    expect(auditValues[4]).toBe("team-1"); // team_id
    expect(auditValues[5]).toBe("participant"); // from_role
    expect(auditValues[6]).toBe("engineering_manager"); // to_role
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
