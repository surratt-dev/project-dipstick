import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be defined before importing the module under test
// ---------------------------------------------------------------------------
const mockDbQuery = vi.fn();
const mockDbConnect = vi.fn();
const mockEmitAuditEvent = vi.fn();
const mockRedisEval = vi.fn();

vi.mock("../../db.js", () => ({
  db: {
    query: (...args: unknown[]) => mockDbQuery(...args),
    connect: () => mockDbConnect(),
  },
}));
vi.mock("../../auth/audit-logger.js", () => ({
  emitAuditEvent: (...args: unknown[]) => mockEmitAuditEvent(...args),
}));
vi.mock("../../redis.js", () => ({
  redis: { eval: (...args: unknown[]) => mockRedisEval(...args) },
}));
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    DATABASE_URL: "postgres://test",
    REDIS_URL: "redis://test",
    SESSION_SECRET: "test",
    OIDC_ISSUER: "https://idp.example.com",
    OIDC_CLIENT_ID: "client-id",
    OIDC_CLIENT_SECRET: "client-secret",
    OIDC_REDIRECT_URI: "http://localhost:3000/auth/callback",
    NODE_ENV: "test",
    APPLICATION_ADMIN_CONTACT_EMAIL: undefined as string | undefined,
  },
}));
vi.mock("../../config.js", () => ({
  config: mockConfig,
}));

import Fastify from "fastify";
import { teamRoutes } from "../teams.js";

// ---------------------------------------------------------------------------
// Fake Redis sorted-set backing store for the TEAM-006 sliding-window rate
// limiter (task 3.10). Mirrors the SLIDING_WINDOW_LUA script in teams.ts
// (ZREMRANGEBYSCORE + ZADD + ZCARD + oldest-entry lookup) closely enough to
// exercise real sliding-window semantics — expiry of individual entries as
// time passes, not a fixed-bucket reset — without requiring a real Redis
// instance. Cleared before every test (see the file-level beforeEach below)
// so no test's rate-limit state leaks into another.
// ---------------------------------------------------------------------------
const fakeRedisStore = new Map<string, Array<{ score: number; member: string }>>();

function fakeSlidingWindowEval(
  _script: unknown,
  _numkeys: unknown,
  key: unknown,
  now: unknown,
  windowMs: unknown,
  member: unknown,
): Promise<[number, number]> {
  const k = String(key);
  const nowNum = Number(now);
  const windowNum = Number(windowMs);
  const cutoff = nowNum - windowNum;

  let entries = fakeRedisStore.get(k) ?? [];
  entries = entries.filter((e) => e.score > cutoff);
  entries.push({ score: nowNum, member: String(member) });
  entries.sort((a, b) => a.score - b.score);
  fakeRedisStore.set(k, entries);

  const count = entries.length;
  const oldestScore = entries[0]?.score ?? nowNum;
  return Promise.resolve([count, oldestScore]);
}
mockRedisEval.mockImplementation(fakeSlidingWindowEval);

// File-level hook: clears the fake Redis store before every test in this
// file, regardless of which describe block it lives in, so unrelated tests
// (including the pre-existing TEAM-006 tests below, which issue one POST
// each against the same default actor) never contribute entries that could
// push a later test over a rate-limit threshold.
beforeEach(() => {
  fakeRedisStore.clear();
  mockConfig.APPLICATION_ADMIN_CONTACT_EMAIL = undefined;
});

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

  // restrict-team-005-em-promotion (GitHub issue #109), design.md Decision B.
  // Rewritten (task 3.7): this test previously pinned the bug this change
  // fixes — TEAM-005 promoting a participant to engineering_manager and
  // succeeding. TEAM-005 now unconditionally rejects this transition, for
  // every actor including Application Admin — establishing a new EM
  // relationship is exclusively TEAM-006's function. Coverage for the
  // Application-Admin-specific and EM-actor-specific variants of this
  // rejection lives in the "restrict-team-005-em-promotion" describe block
  // below (tasks 4.1/4.4); this test's own case is task 4.4 there, so it is
  // removed here rather than kept as a redundant "(superseded)" duplicate.

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

  // restrict-team-005-em-promotion (GitHub issue #109), design.md Decision B,
  // task 3.7. These two tests previously reached the zero-participant guard
  // (teams.ts's transaction block) via a participant -> engineering_manager
  // promotion. That transition is now rejected before the transaction ever
  // opens, so the guard is unreachable through TEAM-005 (the only remaining
  // transition, demotion, strictly INCREASES participant count). Rewritten
  // to assert exactly that: the promotion-block check fires before, and
  // regardless of, confirmedZeroParticipant — this flag cannot be used to
  // bypass the promotion restriction (Decision C: no admin-configurable
  // exception, structurally). The guard itself and confirmedZeroParticipant
  // are left in place undeleted, per task 3.7's resolution — see the
  // defensive comment at the guard's call site in teams.ts.
  it("4.3 (superseded): rejects the promotion before the zero-participant check ever runs, without confirmedZeroParticipant", async () => {
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
      })
      // Blocked-promotion audit_log INSERT
      .mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/teams/team-1/members/user-alice/role",
      payload: { role: "engineering_manager" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).not.toEqual({ requiresConfirmation: true });
    // The transaction that would run the zero-participant count check never opens
    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  it("4.3 (superseded): confirmedZeroParticipant: true does not bypass the promotion block", async () => {
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
      })
      // Blocked-promotion audit_log INSERT
      .mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/teams/team-1/members/user-alice/role",
      payload: { role: "engineering_manager", confirmedZeroParticipant: true },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().member).toBeUndefined();
    expect(mockDbConnect).not.toHaveBeenCalled();
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
  //
  // restrict-team-005-em-promotion (GitHub issue #109), design.md Decision B,
  // task 3.7: this test originally exercised a participant -> engineering_manager
  // promotion, which TEAM-005 now unconditionally rejects. Rewritten to use
  // demotion (engineering_manager -> participant) — TEAM-005's one remaining
  // transition — to preserve this test's original intent (audit_log gets the
  // correct column layout and values for a TEAM-005 change) without relying
  // on now-blocked behavior.
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
            current_role: "engineering_manager",
          },
        ],
      });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // SELECT FOR UPDATE (team-level lock)
      { rows: [] }, // UPDATE
      { rows: [{ participant_count: "3" }] }, // count check — demotion increases it
      { rows: [] }, // audit INSERT into audit_log
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp();
    await app.inject({
      method: "PATCH",
      url: "/api/v1/teams/team-1/members/user-carol/role",
      payload: { role: "participant" },
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
    expect(metadata).toMatchObject({ from_role: "engineering_manager", to_role: "participant" });
  });

  // Task 4.5 — TEAM-006 is NOT called
  // restrict-team-005-em-promotion, task 3.7: rewritten to use demotion — see
  // the rationale on the 4.4 test above.
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
            current_role: "engineering_manager",
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
      payload: { role: "participant" },
    });

    // The route has 6 DB interactions (BEGIN, SELECT FOR UPDATE, UPDATE, COUNT, AUDIT, COMMIT)
    // If TEAM-006 were invoked it would be an additional network call outside
    // our mocked DB layer, which would fail — this test implicitly verifies it.
    expect(res.statusCode).toBe(200);
    expect(client.query).toHaveBeenCalledTimes(6);
  });

  // Task 4.6 — users.global_role is NOT written
  // restrict-team-005-em-promotion, task 3.7: rewritten to use demotion — see
  // the rationale on the 4.4 test above.
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
            current_role: "engineering_manager",
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
      payload: { role: "participant" },
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
// restrict-team-005-em-promotion (GitHub issue #109) — regression suite from
// tasks.md §4 / exploration §6. TEAM-005 must be structurally incapable of
// originating a participant -> engineering_manager transition, for every
// actor, unconditionally (design.md Decision B/C).
// ---------------------------------------------------------------------------
describe("PATCH /api/v1/teams/:teamId/members/:userId/role — TEAM-005 promotion block (issue #109)", () => {
  beforeEach(() => vi.clearAllMocks());

  // Task 4.1
  it("4.1: rejects a Team-A EM promoting a Team-A participant who already holds global_role=engineering_manager from a different team", async () => {
    mockDbQuery
      // authorization: actor is EM on team-a
      .mockResolvedValueOnce({
        rows: [{ global_role: "engineering_manager", membership_role: "engineering_manager" }],
      })
      // subject lookup: target is currently a participant on team-a — note the
      // target's users.global_role is irrelevant to TEAM-005 (it never queries
      // it); the "already holds global_role=engineering_manager elsewhere"
      // half of this scenario is exactly why the read-side dual-check
      // (evaluateTeamAccess) is pinned independently in
      // team-content-access-helper.test.ts — this test only proves the write
      // side rejects the transition and never touches team_memberships.
      .mockResolvedValueOnce({
        rows: [
          {
            display_name: "Frank",
            email: "frank@test.com",
            current_role: "participant",
          },
        ],
      })
      // blocked-promotion audit_log INSERT
      .mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/teams/team-a/members/user-frank/role",
      payload: { role: "engineering_manager" },
    });

    expect(res.statusCode).toBe(403);
    // No transaction opens — team_memberships.role is never touched
    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  // Task 4.3
  it("4.3: rejects self-targeting — an EM-authorized actor cannot use TEAM-005 to promote their own row from participant to engineering_manager", async () => {
    mockDbQuery
      // authorization check for this actor/team combination succeeds
      .mockResolvedValueOnce({
        rows: [{ global_role: "engineering_manager", membership_role: "engineering_manager" }],
      })
      // subject lookup — actor === target (self-targeting): current_role participant
      .mockResolvedValueOnce({
        rows: [
          {
            display_name: "Self Actor",
            email: "actor@test.com",
            current_role: "participant",
          },
        ],
      })
      // blocked-promotion audit_log INSERT
      .mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      // session.userId defaults to "actor-1" (see buildApp) — targeting the
      // same id models actor === target
      url: "/api/v1/teams/team-b/members/actor-1/role",
      payload: { role: "engineering_manager" },
    });

    expect(res.statusCode).toBe(403);
    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  // Task 4.4
  it("4.4: rejects an Application Admin's participant -> engineering_manager transition via TEAM-005, distinct from the unauthorized-actor 403", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ global_role: "application_admin", membership_role: null }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            display_name: "Grace",
            email: "grace@test.com",
            current_role: "participant",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/teams/team-1/members/user-grace/role",
      payload: { role: "engineering_manager" },
    });

    // This actor IS fully authorized to call TEAM-005 (unlike the 4.7 tests'
    // unauthorized-actor 403s) — the rejection here is the transition block,
    // not the authorization check. Both currently surface as 403, but the
    // audit trail distinguishes them (team.role_change_denied is only
    // reachable after checkAssignRolesAuthorization already passed).
    expect(res.statusCode).toBe(403);
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "team.role_change_denied",
      expect.objectContaining({ actorGlobalRole: "application_admin" }),
    );
    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  // Task 4.5 (EM-actor half; the Application-Admin half is covered by the
  // existing "4.9: demotes engineering_manager back to participant" test above)
  it("4.5: demotion (engineering_manager -> participant) still succeeds for an authorized EM actor", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ global_role: "engineering_manager", membership_role: "engineering_manager" }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            display_name: "Henry",
            email: "henry@test.com",
            current_role: "engineering_manager",
          },
        ],
      });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // SELECT FOR UPDATE
      { rows: [] }, // UPDATE
      { rows: [{ participant_count: "4" }] }, // count check
      { rows: [] }, // audit INSERT
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/teams/team-1/members/user-henry/role",
      payload: { role: "participant" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().member.role).toBe("participant");
  });

  // Task 4.6
  it("4.6: a blocked promotion attempt writes audit_log with operation='team.role_change_denied', never 'team.role_changed', for the participant->engineering_manager transition", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ global_role: "application_admin", membership_role: null }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            display_name: "Iris",
            email: "iris@test.com",
            current_role: "participant",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const app = await buildApp();
    await app.inject({
      method: "PATCH",
      url: "/api/v1/teams/team-1/members/user-iris/role",
      payload: { role: "engineering_manager" },
    });

    // The 3rd call to db.query is the blocked-promotion audit_log INSERT
    // (index 2: 0 = authorization check, 1 = subject lookup, 2 = audit insert)
    const auditInsertCall = mockDbQuery.mock.calls[2];
    expect(auditInsertCall).toBeDefined();
    const auditValues = auditInsertCall[1] as unknown[];
    expect(auditValues[3]).toBe("team.role_change_denied");
    const metadata = JSON.parse(auditValues[6] as string) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      from_role: "participant",
      to_role: "engineering_manager",
      http_status: 403,
    });

    // No audit_log row for this request carries operation = 'team.role_changed'
    // with from_role=participant/to_role=engineering_manager — the mockDbConnect
    // transaction (where 'team.role_changed' would be written) never opened.
    expect(mockDbConnect).not.toHaveBeenCalled();
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

  // Task 2.3 — escalation-contact-mechanism: applicationAdminContactEmail is
  // populated unconditionally, for admin and non-admin callers alike.
  it("2.3: returns the configured applicationAdminContactEmail for an admin caller", async () => {
    mockConfig.APPLICATION_ADMIN_CONTACT_EMAIL = "app-admins@example.com";
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
    expect(res.json().applicationAdminContactEmail).toBe("app-admins@example.com");
  });

  it("2.3: returns the configured applicationAdminContactEmail for a non-admin caller", async () => {
    mockConfig.APPLICATION_ADMIN_CONTACT_EMAIL = "app-admins@example.com";
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "engineer", is_member: true }] })
      .mockResolvedValueOnce({ rows: [{ name: "Team Y" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ global_role: "engineer", membership_role: "participant" }] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1" });

    expect(res.statusCode).toBe(200);
    expect(res.json().applicationAdminContactEmail).toBe("app-admins@example.com");
  });

  // Task 2.4
  it("2.4: returns applicationAdminContactEmail: null when APPLICATION_ADMIN_CONTACT_EMAIL is unset", async () => {
    mockConfig.APPLICATION_ADMIN_CONTACT_EMAIL = undefined;
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "engineer", is_member: true }] })
      .mockResolvedValueOnce({ rows: [{ name: "Team Y" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ global_role: "engineer", membership_role: "participant" }] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/team-1" });

    expect(res.statusCode).toBe(200);
    expect(res.json().applicationAdminContactEmail).toBeNull();
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

// ---------------------------------------------------------------------------
// POST /api/v1/teams/:teamId/managers — rate limiting (task 3.10 / GitHub
// issue #13 / Q6 decision)
//
// Acceptance criteria under test are Section 6 of
// openspec/changes/archive/2026-07-07-establish-manager-team-relationship/
// q6-rate-limit-decision.md. Redis is backed by an in-memory fake sorted set
// (fakeSlidingWindowEval, above) so these tests exercise real sliding-window
// counting and expiry rather than a hand-scripted sequence of mock return
// values — the acceptance criteria are inherently about counts over time,
// which a real (if in-memory) sliding window verifies far more directly
// than mocking each of a hundred-plus individual Redis round trips would.
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/managers — rate limiting (task 3.10)", () => {
  const TEN_MINUTES_MS = 10 * 60 * 1000;
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

  let currentTimeMs: number;
  let dateNowSpy: MockInstance<() => number>;

  /** Configures db.query / db.connect to happily approve every request that
   * reaches them (admin actor, existing team, target already an EM, fresh
   * upsert) so tests can focus on rate-limit behavior instead of re-deriving
   * this scaffolding for every one of a hundred-plus requests. */
  function setupHappyPathDb() {
    mockDbQuery.mockImplementation((sql: unknown) => {
      const s = String(sql).toLowerCase();
      if (s.includes("select global_role from users")) {
        return Promise.resolve({ rows: [{ global_role: "application_admin" }] });
      }
      if (s.includes("select id from teams")) {
        return Promise.resolve({ rows: [{ id: "team-1" }] });
      }
      if (s.includes("select global_role, display_name from users")) {
        return Promise.resolve({
          rows: [{ global_role: "engineering_manager", display_name: "Some EM" }],
        });
      }
      // audit_log INSERT (both the in-transaction 3.9 path and the
      // out-of-transaction rate-limit-breach path use db.query/client.query
      // shapes that don't need a specific return value here).
      return Promise.resolve({ rows: [] });
    });

    mockDbConnect.mockImplementation(() =>
      Promise.resolve(
        makeMockClient([
          { rows: [] }, // BEGIN
          { rows: [{ id: "membership-1", is_new_row: true }] }, // upsert
          { rows: [] }, // audit INSERT
          { rows: [] }, // COMMIT
        ]),
      ),
    );
  }

  async function postManagers(app: Awaited<ReturnType<typeof buildApp>>, teamId = "team-1") {
    return app.inject({
      method: "POST",
      url: `/api/v1/teams/${teamId}/managers`,
      payload: { engineeringManagerUserId: "em-user-1" },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupHappyPathDb();
    currentTimeMs = Date.parse("2026-01-01T00:00:00.000Z");
    dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => currentTimeMs);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  it("allows the first 20 requests from one actor within a rolling 10-minute window, then rejects the 21st with TEAM006_BURST_LIMIT_EXCEEDED and a Retry-After header", async () => {
    const app = await buildApp({ userId: "actor-burst-1" });

    for (let i = 0; i < 20; i++) {
      const res = await postManagers(app);
      expect(res.statusCode).toBeLessThan(300);
    }

    const connectCallsBeforeBreach = mockDbConnect.mock.calls.length;
    const res21 = await postManagers(app);

    expect(res21.statusCode).toBe(429);
    const body = res21.json() as { error: { category: string; code: string; correlationId: string } };
    expect(body.error.category).toBe("rate_limited");
    expect(body.error.code).toBe("TEAM006_BURST_LIMIT_EXCEEDED");
    expect(body.error.correlationId).toBeTruthy();
    expect(res21.headers["retry-after"]).toBeDefined();
    expect(Number(res21.headers["retry-after"])).toBeGreaterThan(0);

    // No team_memberships write occurred for the rejected request.
    expect(mockDbConnect.mock.calls.length).toBe(connectCallsBeforeBreach);

    // The durable audit_log row was written before the 429 was returned.
    const auditCall = mockDbQuery.mock.calls.find(
      (call) =>
        String(call[0]).toLowerCase().includes("audit_log") &&
        (call[1] as unknown[])?.[3] === "team.manager_association_rate_limited",
    );
    expect(auditCall).toBeDefined();
    const auditParams = auditCall![1] as unknown[];
    expect(auditParams[0]).toBe("actor-burst-1"); // actor_user_id
    expect(auditParams[4]).toBeNull(); // target_user_id — no target established at rejection
    expect(auditParams[5]).toBe("team-1"); // team_id
    const metadata = JSON.parse(auditParams[6] as string) as Record<string, unknown>;
    expect(metadata["limit_type"]).toBe("burst");
    expect(metadata["observed_count"]).toBe(21);

    // The structured rate_limit_exceeded event was emitted.
    const structuredEventCall = mockEmitAuditEvent.mock.calls.find(
      (call) => call[1] === "team.manager_association_rate_limit_exceeded",
    );
    expect(structuredEventCall).toBeDefined();
    expect((structuredEventCall![2] as Record<string, unknown>)["limitType"]).toBe("burst");
  });

  it("allows the first 100 requests from one actor within a rolling 24-hour window (spaced beyond the burst window), then rejects the 101st with TEAM006_DAILY_LIMIT_EXCEEDED", async () => {
    const app = await buildApp({ userId: "actor-daily-1" });

    // 5 batches of 20, each batch more than 10 minutes after the previous
    // one so the burst window resets between batches but the 24-hour daily
    // window keeps accumulating. 5 * 20 = 100, all within the daily limit.
    for (let batch = 0; batch < 5; batch++) {
      for (let i = 0; i < 20; i++) {
        const res = await postManagers(app);
        expect(res.statusCode).toBeLessThan(300);
      }
      currentTimeMs += TEN_MINUTES_MS + 60_000; // advance 11 minutes
    }

    // 101st request, still well within 24 hours of the first.
    const res101 = await postManagers(app);
    expect(res101.statusCode).toBe(429);
    const body = res101.json() as { error: { code: string } };
    expect(body.error.code).toBe("TEAM006_DAILY_LIMIT_EXCEEDED");
    expect(res101.headers["retry-after"]).toBeDefined();

    const auditCall = mockDbQuery.mock.calls.find(
      (call) =>
        String(call[0]).toLowerCase().includes("audit_log") &&
        (call[1] as unknown[])?.[3] === "team.manager_association_rate_limited",
    );
    const metadata = JSON.parse((auditCall![1] as unknown[])[6] as string) as Record<string, unknown>;
    expect(metadata["limit_type"]).toBe("daily");
    expect(metadata["observed_count"]).toBe(101);
  });

  it("rejects the 101st request across all actors combined within a rolling 10-minute window with TEAM006_GLOBAL_LIMIT_EXCEEDED, distinct from the per-actor codes", async () => {
    // 5 distinct actors each make 20 requests (their own burst limit exactly,
    // never exceeded) within the same 10-minute window: 5 * 20 = 100 global.
    for (let actorIndex = 0; actorIndex < 5; actorIndex++) {
      const app = await buildApp({ userId: `actor-global-${actorIndex}` });
      for (let i = 0; i < 20; i++) {
        const res = await postManagers(app);
        expect(res.statusCode).toBeLessThan(300);
      }
    }

    // A 6th, previously-unseen actor's very first request is the 101st
    // request overall in this window — its own burst/daily state is nowhere
    // near its limits, so only the global limit can explain a rejection.
    const sixthActorApp = await buildApp({ userId: "actor-global-sixth" });
    const res = await postManagers(sixthActorApp);

    expect(res.statusCode).toBe(429);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe("TEAM006_GLOBAL_LIMIT_EXCEEDED");
    expect(body.error.code).not.toBe("TEAM006_BURST_LIMIT_EXCEEDED");
    expect(body.error.code).not.toBe("TEAM006_DAILY_LIMIT_EXCEEDED");

    const auditCall = mockDbQuery.mock.calls.find(
      (call) =>
        String(call[0]).toLowerCase().includes("audit_log") &&
        (call[1] as unknown[])?.[3] === "team.manager_association_rate_limited",
    );
    const metadata = JSON.parse((auditCall![1] as unknown[])[6] as string) as Record<string, unknown>;
    expect(metadata["limit_type"]).toBe("global");
  });

  it("emits team.manager_association_rate_approaching (window: burst) on the 16th request without rejecting it", async () => {
    const app = await buildApp({ userId: "actor-warn-burst" });

    let res;
    for (let i = 0; i < 16; i++) {
      res = await postManagers(app);
    }

    expect(res!.statusCode).toBeLessThan(300);

    const approachingCalls = mockEmitAuditEvent.mock.calls.filter(
      (call) => call[1] === "team.manager_association_rate_approaching",
    );
    const burstApproaching = approachingCalls.filter(
      (call) => (call[2] as Record<string, unknown>)["window"] === "burst",
    );
    expect(burstApproaching).toHaveLength(1);
    expect((burstApproaching[0]![2] as Record<string, unknown>)["observedCount"]).toBe(16);
  });

  it("emits team.manager_association_rate_approaching (window: daily) on the 80th request without rejecting it", async () => {
    const app = await buildApp({ userId: "actor-warn-daily" });

    // 4 batches of 20 (spaced beyond the burst window), 4 * 20 = 80.
    let res;
    for (let batch = 0; batch < 4; batch++) {
      for (let i = 0; i < 20; i++) {
        res = await postManagers(app);
      }
      if (batch < 3) currentTimeMs += TEN_MINUTES_MS + 60_000;
    }

    expect(res!.statusCode).toBeLessThan(300);

    const dailyApproaching = mockEmitAuditEvent.mock.calls.filter(
      (call) =>
        call[1] === "team.manager_association_rate_approaching" &&
        (call[2] as Record<string, unknown>)["window"] === "daily",
    );
    expect(dailyApproaching).toHaveLength(1);
    expect((dailyApproaching[0]![2] as Record<string, unknown>)["observedCount"]).toBe(80);
  });

  it("does not let one actor's burst/daily state affect a different actor, but does count both toward the shared global limit", async () => {
    const actorAApp = await buildApp({ userId: "actor-isolated-a" });
    const actorBApp = await buildApp({ userId: "actor-isolated-b" });

    // Actor A exhausts their own burst limit.
    for (let i = 0; i < 20; i++) {
      const res = await postManagers(actorAApp);
      expect(res.statusCode).toBeLessThan(300);
    }
    const actorABreach = await postManagers(actorAApp);
    expect(actorABreach.statusCode).toBe(429);
    expect((actorABreach.json() as { error: { code: string } }).error.code).toBe(
      "TEAM006_BURST_LIMIT_EXCEEDED",
    );

    // Actor B, entirely unaffected by A's per-actor state, still succeeds —
    // this is their first request.
    const actorBRes = await postManagers(actorBApp);
    expect(actorBRes.statusCode).toBeLessThan(300);

    // But the global counter is shared: A contributed 21 requests (20
    // allowed + 1 rejected — the rejected request itself still counts, see
    // "every call counts against every window" in enforceTeam006RateLimit),
    // B contributed 1, so 79 more requests are needed to push the combined
    // count over the global limit of 100. Those 79 are spread across four
    // more actors (20 + 20 + 20 + 19), each staying under its OWN 20-request
    // burst limit, so the eventual rejection can only be explained by the
    // shared global counter, not by any single actor's per-actor state.
    const perActorRequestCounts = [20, 20, 20, 19];
    let lastRes;
    for (let a = 0; a < perActorRequestCounts.length; a++) {
      const extraApp = await buildApp({ userId: `actor-isolated-extra-${a}` });
      for (let i = 0; i < perActorRequestCounts[a]!; i++) {
        lastRes = await postManagers(extraApp);
      }
    }
    expect(lastRes!.statusCode).toBe(429);
    expect((lastRes!.json() as { error: { code: string } }).error.code).toBe(
      "TEAM006_GLOBAL_LIMIT_EXCEEDED",
    );
  });

  it("resets gradually under sliding-window semantics, not as a single fixed-bucket reset", async () => {
    const app = await buildApp({ userId: "actor-sliding" });

    // 20 requests at t=0 exhaust the burst limit.
    for (let i = 0; i < 20; i++) {
      const res = await postManagers(app);
      expect(res.statusCode).toBeLessThan(300);
    }

    // A request 5 minutes later is still rejected — all 20 initial entries
    // are still within the 10-minute window.
    currentTimeMs += 5 * 60 * 1000;
    const rejectedAtFiveMin = await postManagers(app);
    expect(rejectedAtFiveMin.statusCode).toBe(429);

    // Just past 10 minutes after the FIRST batch (not the rejected request),
    // those first 20 entries have aged out of the window, but the request
    // rejected at t=5min is still within it — proving entries expire
    // individually as time passes, not all at once on a fixed boundary.
    currentTimeMs = Date.parse("2026-01-01T00:00:00.000Z") + TEN_MINUTES_MS + 1_000;
    const afterPartialExpiry = await postManagers(app);
    expect(afterPartialExpiry.statusCode).toBeLessThan(300);
  });

  it("allows the first 20 requests from one actor within a rolling 24-hour daily window and does not touch the daily limit prematurely", async () => {
    // Sanity check distinguishing the burst and daily limiters: 20 requests
    // in immediate succession never approach the daily limit's own 80%
    // early-warning threshold.
    const app = await buildApp({ userId: "actor-daily-sanity" });
    for (let i = 0; i < 20; i++) {
      const res = await postManagers(app);
      expect(res.statusCode).toBeLessThan(300);
    }
    const dailyApproaching = mockEmitAuditEvent.mock.calls.filter(
      (call) =>
        call[1] === "team.manager_association_rate_approaching" &&
        (call[2] as Record<string, unknown>)["window"] === "daily",
    );
    expect(dailyApproaching).toHaveLength(0);
  });

  it("daily window resets gradually under sliding-window semantics, not as a single fixed-bucket reset", async () => {
    const app = await buildApp({ userId: "actor-daily-sliding" });

    // 5 batches of 20, each starting 11 minutes after the previous (clearing
    // the burst window between batches), reaching exactly the 100-request
    // daily limit. Batch 0 lands at t=0; batch 4 lands at t=44min.
    for (let batch = 0; batch < 5; batch++) {
      for (let i = 0; i < 20; i++) {
        const res = await postManagers(app);
        expect(res.statusCode).toBeLessThan(300);
      }
      if (batch < 4) {
        currentTimeMs += TEN_MINUTES_MS + 60_000;
      }
    }

    // Just past 24 hours after the FIRST batch (not the most recent one),
    // batch 0's 20 entries have aged out of the daily window, but batches
    // 1-4 (80 entries, all made after batch 0) have not — proving daily-window
    // entries expire individually as time passes, not all at once on a single
    // fixed 24-hour boundary. A fixed-bucket daily reset would still show 100
    // active entries here (or reject); a true sliding window has already
    // freed up the 20 slots batch 0 occupied.
    currentTimeMs = Date.parse("2026-01-01T00:00:00.000Z") + TWENTY_FOUR_HOURS_MS + 1_000;
    const afterPartialExpiry = await postManagers(app);
    expect(afterPartialExpiry.statusCode).toBeLessThan(300);
  });

  // Architect + security implementation review findings
  // (implementation-review-architect.md Finding 1,
  // implementation-review-security.md Finding 6): the rate limiter must fail
  // closed — as a deliberate, tested decision, not an accident of missing
  // error handling — when its own Redis backend is unavailable.
  it("fails closed with 503 TEAM006_RATE_LIMIT_UNAVAILABLE when the rate limiter's Redis backend errors, without writing a team_memberships row or a rate-limit-breach audit row", async () => {
    const app = await buildApp({ userId: "actor-redis-down" });

    // Only the first redis.eval call in this request rejects — the
    // mockRejectedValueOnce overrides the persistent fakeSlidingWindowEval
    // default for exactly one call, so enforceTeam006RateLimit's burst check
    // throws before ever reaching the daily/global checks.
    mockRedisEval.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const connectCallsBefore = mockDbConnect.mock.calls.length;
    const res = await postManagers(app);

    expect(res.statusCode).toBe(503);
    const body = res.json() as {
      error: { category: string; code: string; correlationId: string };
    };
    expect(body.error.category).toBe("service_unavailable");
    expect(body.error.code).toBe("TEAM006_RATE_LIMIT_UNAVAILABLE");
    expect(body.error.correlationId).toBeTruthy();

    // No team_memberships write — the request was denied, not processed.
    expect(mockDbConnect.mock.calls.length).toBe(connectCallsBefore);

    // This is a limiter-AVAILABILITY failure, not a rate-limit BREACH — the
    // breach-specific audit_log row and structured event must not fire.
    const breachAuditRow = mockDbQuery.mock.calls.find(
      (call) =>
        String(call[0]).toLowerCase().includes("audit_log") &&
        (call[1] as unknown[])?.[3] === "team.manager_association_rate_limited",
    );
    expect(breachAuditRow).toBeUndefined();
    const breachEvent = mockEmitAuditEvent.mock.calls.find(
      (call) => call[1] === "team.manager_association_rate_limit_exceeded",
    );
    expect(breachEvent).toBeUndefined();

    // The distinct check-failed signal fires instead, so this condition is
    // greppable/alertable separately from an ordinary breach or bug.
    const checkFailedEvent = mockEmitAuditEvent.mock.calls.find(
      (call) => call[1] === "team.manager_association_rate_limit_check_failed",
    );
    expect(checkFailedEvent).toBeDefined();
    expect((checkFailedEvent![2] as Record<string, unknown>)["actorUserId"]).toBe(
      "actor-redis-down",
    );

    // Once Redis recovers, the very next request is evaluated normally again
    // — the rejection above only overrode a single call.
    const recoveredRes = await postManagers(app);
    expect(recoveredRes.statusCode).toBeLessThan(300);
  });
});
