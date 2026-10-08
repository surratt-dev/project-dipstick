import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type * as SubscriberAccessHelperModule from "../../auth/session-subscriber-access-helper.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockDbQuery = vi.fn();
const mockDbConnect = vi.fn();
const mockEmitAuditEvent = vi.fn();
const mockPublishSessionStateChange = vi.fn();
const mockPublishVoteRevealed = vi.fn();
const mockPublishTopicHistoryUpdate = vi.fn();

vi.mock("../../db.js", () => ({
  db: {
    query: (...args: unknown[]) => mockDbQuery(...args),
    connect: () => mockDbConnect(),
  },
}));
vi.mock("../../auth/audit-logger.js", () => ({
  emitAuditEvent: (...args: unknown[]) => mockEmitAuditEvent(...args),
}));
const mockPublishVoteReadinessUpdate = vi.fn();
const mockClearFacilitatorConnectedFlag = vi.fn().mockResolvedValue(undefined);

vi.mock("../../realtime/ws-pubsub.js", () => ({
  publishSessionStateChange: (...args: unknown[]) => mockPublishSessionStateChange(...args),
  publishVoteRevealed: (...args: unknown[]) => mockPublishVoteRevealed(...args),
  publishTopicHistoryUpdate: (...args: unknown[]) => mockPublishTopicHistoryUpdate(...args),
  publishVoteReadinessUpdate: (...args: unknown[]) => mockPublishVoteReadinessUpdate(...args),
  clearFacilitatorConnectedFlag: (...args: unknown[]) => mockClearFacilitatorConnectedFlag(...args),
}));
const mockEvaluateSessionSubscriberAccess = vi.fn();
vi.mock("../../auth/session-subscriber-access-helper.js", () => ({
  evaluateSessionSubscriberAccess: (...args: unknown[]) => mockEvaluateSessionSubscriberAccess(...args),
}));

const mockApplyTimingFloor = vi.fn().mockResolvedValue(undefined);
vi.mock("../../content/timing-oracle.js", () => ({
  applyTimingFloor: (...args: unknown[]) => mockApplyTimingFloor(...args),
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
import { DEFAULT_TOPICS_TEAM_ID } from "../../sessions/default-topics.js";
import type { FastifyBaseLogger } from "fastify";
import { DatabaseError } from "pg";
import {
  facilitatorSessionRoutes,
  recordRevealTriggeredAudit,
  computeStalenessLevel,
  getOrCreateJoinLink,
} from "../facilitator-sessions.js";
import { sessionRoutes } from "../sessions.js";

/** Prototype used to fabricate `err instanceof DatabaseError` fixtures without pg's real constructor args. */
const DatabaseErrorProto = DatabaseError.prototype;

/** Returns a mock transaction client that records calls, matching teams.test.ts's pattern. */
function makeMockClient(queryResponses: Array<{ rows: unknown[]; rowCount?: number }> = []) {
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

function buildApp(userId = "facilitator-1") {
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
  });
  app.register(facilitatorSessionRoutes);
  return app.ready().then(() => app);
}

function buildSessionsApp(userId = "participant-1") {
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
  });
  app.register(sessionRoutes);
  return app.ready().then(() => app);
}

// ---------------------------------------------------------------------------
// computeStalenessLevel (tasks.md task 2.0a/2.0b, design.md Decision 7)
//
// Regression guard for the drift that went unnoticed the first time: the
// legend this change ships states 1/2/3-session thresholds, and this test
// asserts computeStalenessLevel's actual output agrees with those thresholds
// — including at the current application_settings.staleness_threshold_sessions
// seed-data default (2), which this function no longer reads at all.
// ---------------------------------------------------------------------------
describe("computeStalenessLevel (design.md Decision 7 — fixed 1/2/3-session mapping)", () => {
  it("0 sessions elapsed computes 'none'", () => {
    expect(computeStalenessLevel(0)).toBe("none");
  });

  it("1 session elapsed computes 'yellow', matching the legend, regardless of the configured threshold default", () => {
    expect(computeStalenessLevel(1)).toBe("yellow");
  });

  it("2 sessions elapsed computes 'orange', matching the legend, regardless of the configured threshold default", () => {
    expect(computeStalenessLevel(2)).toBe("orange");
  });

  it("3 sessions elapsed computes 'red', matching the legend — the concrete case the fix corrects", () => {
    expect(computeStalenessLevel(3)).toBe("red");
  });

  it("more than 3 sessions elapsed also computes 'red'", () => {
    expect(computeStalenessLevel(7)).toBe("red");
  });

  it("does not accept a threshold parameter — the function's only argument is sessionsSinceUpdate", () => {
    // Type-level guard: computeStalenessLevel is unary. If this file fails to
    // compile because a second argument became required again, that's this
    // test doing its job.
    expect(computeStalenessLevel.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getOrCreateJoinLink (join-link-redemption-wiring, design.md Decisions 1
// and 3, tasks.md Task 2.4)
// ---------------------------------------------------------------------------
describe("getOrCreateJoinLink", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reuses an existing active link: no new row created, and no join.link_created emission", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ token: "existing-token" }] });
    const resolveActorGlobalRole = vi.fn();

    const token = await getOrCreateJoinLink({
      teamId: "11111111-1111-4111-8111-111111111111",
      createdByUserId: "user-1",
      actorIp: "127.0.0.1",
      logger: { info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger,
      resolveActorGlobalRole,
    });

    expect(token).toBe("existing-token");
    expect(resolveActorGlobalRole).not.toHaveBeenCalled();
    expect(mockDbConnect).not.toHaveBeenCalled();
    expect(mockEmitAuditEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      "join.link_created",
      expect.anything(),
    );
  });

  it("the active-row SELECT deterministically prefers the most-recently-created row (ORDER BY created_at DESC LIMIT 1)", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ token: "most-recent-token" }] });

    await getOrCreateJoinLink({
      teamId: "11111111-1111-4111-8111-111111111111",
      createdByUserId: "user-1",
      actorIp: "127.0.0.1",
      logger: { info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger,
      resolveActorGlobalRole: vi.fn(),
    });

    const activeRowCall = mockDbQuery.mock.calls.find((call) =>
      (call[0] as string).includes("FROM join_links"),
    );
    expect(activeRowCall).toBeDefined();
    expect(activeRowCall![0] as string).toContain("ORDER BY created_at DESC LIMIT 1");
    expect(activeRowCall![0] as string).toContain("revoked_at IS NULL AND expires_at > NOW()");
  });

  it("creates a new join_links row via the shared audited helper when no active row exists", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // no active row
    const resolveActorGlobalRole = vi.fn().mockResolvedValue("facilitator");
    const client = makeMockClient([
      { rows: [] }, // BEGIN
      {
        rows: [
          {
            id: "link-new",
            team_id: "11111111-1111-4111-8111-111111111111",
            token: "new-token",
            created_at: new Date("2026-01-01"),
            expires_at: new Date("2026-01-08"),
          },
        ],
      }, // INSERT INTO join_links
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const token = await getOrCreateJoinLink({
      teamId: "11111111-1111-4111-8111-111111111111",
      createdByUserId: "user-1",
      actorIp: "127.0.0.1",
      logger: { info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger,
      resolveActorGlobalRole,
    });

    expect(token).toBe("new-token");
    expect(resolveActorGlobalRole).toHaveBeenCalledTimes(1);
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "join.link_created",
      expect.objectContaining({ teamId: "11111111-1111-4111-8111-111111111111", linkId: "link-new" }),
    );
  });

  it("two concurrent calls that both observe no active row both succeed without a database error", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const clientA = makeMockClient([
      { rows: [] },
      {
        rows: [
          { id: "link-a", team_id: "11111111-1111-4111-8111-111111111111", token: "token-a", created_at: new Date(), expires_at: new Date() },
        ],
      },
    ]);
    const clientB = makeMockClient([
      { rows: [] },
      {
        rows: [
          { id: "link-b", team_id: "11111111-1111-4111-8111-111111111111", token: "token-b", created_at: new Date(), expires_at: new Date() },
        ],
      },
    ]);
    mockDbConnect.mockResolvedValueOnce(clientA).mockResolvedValueOnce(clientB);

    const [tokenA, tokenB] = await Promise.all([
      getOrCreateJoinLink({
        teamId: "11111111-1111-4111-8111-111111111111",
        createdByUserId: "user-1",
        actorIp: "127.0.0.1",
        logger: { info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger,
        resolveActorGlobalRole: vi.fn().mockResolvedValue("facilitator"),
      }),
      getOrCreateJoinLink({
        teamId: "11111111-1111-4111-8111-111111111111",
        createdByUserId: "user-2",
        actorIp: "127.0.0.1",
        logger: { info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger,
        resolveActorGlobalRole: vi.fn().mockResolvedValue("facilitator"),
      }),
    ]);

    expect(tokenA).toBe("token-a");
    expect(tokenB).toBe("token-b");
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/teams/:teamId/sessions/draft
//
// session-creation-existing-team, design.md Decision D1 (combined
// global_role/is_member query, check ordering, audit logging) and Decision
// D3 (concurrent-session 409 via the sessions_team_active_unique partial
// unique index). tasks.md Section 2.
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/sessions/draft", () => {
  beforeEach(() => vi.clearAllMocks());

  // Implementation review M1/MF1: Postgres would resolve these spellings to
  // the same team, so they are rejected before the membership query rather
  // than letting the membership and existence checks disagree.
  it.each([
    ["hyphenless", "11111111111141118111111111111111"],
    ["braced", "{11111111-1111-4111-8111-111111111111}"],
    ["regrouped", "11111111-11114111-81111111-11111111"],
    ["malformed", "not-a-uuid"],
  ])("a non-canonical (%s) teamId is 404 before any query, and nothing is written", async (_label, badTeamId) => {
    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/teams/${encodeURIComponent(badTeamId)}/sessions/draft`,
    });

    expect(res.statusCode).toBe(404);
    // #184 m5 task 2.3: the shared teamNotFoundEnvelope(), with its code.
    expect(res.json().error).toMatchObject({ category: "not_found", code: "TEAM_NOT_FOUND", message: "Team not found." });
    expect(mockDbQuery).not.toHaveBeenCalled();
    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  function mockActorQuery(globalRole: string, isMember: boolean) {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: globalRole, is_member: isMember }],
    });
  }

  // task 2.5: non-facilitator caller
  it("2.5: returns 403 with a message distinguishable from the cross-team-constraint message when actor is not a facilitator, and writes no audit row", async () => {
    mockActorQuery("engineer", false);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/draft",
    });

    expect(res.statusCode).toBe(403);
    const message = res.json().error.message as string;
    expect(message).toContain("facilitator");
    expect(message).not.toContain("member of");
    expect(mockDbQuery).toHaveBeenCalledTimes(1); // no team-existence or audit query reached
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  it("returns 404 when team does not exist", async () => {
    mockActorQuery("facilitator", false);
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // team not found

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/99999999-9999-4999-8999-999999999999/sessions/draft",
    });

    expect(res.statusCode).toBe(404);
    // #184 m5 task 2.3: the shared teamNotFoundEnvelope(), with its code.
    expect(res.json().error).toMatchObject({ category: "not_found", code: "TEAM_NOT_FOUND", message: "Team not found." });
  });

  // task 2.8: a nonexistent team where the caller also has no membership row
  it("2.8: a request for a nonexistent :teamId with no membership row returns 404, not the membership-conflict 403, and writes no audit row", async () => {
    mockActorQuery("facilitator", false);
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // team not found

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/99999999-9999-4999-8999-999999999999/sessions/draft",
    });

    expect(res.statusCode).toBe(404);
    expect(mockDbQuery).toHaveBeenCalledTimes(2); // actor query + team-existence query, nothing further
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  // task 2.3 / 2.6 / 2.7: active membership on the target team is rejected
  // regardless of how the request arrives (direct API call, stale
  // eligible-teams list state) -- the endpoint is the control, not the UI.
  it("2.3/2.6/2.7: facilitator with active membership on target team returns 403 with the named cross-team error, creates no session, and writes an audit row", async () => {
    mockActorQuery("facilitator", true);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "11111111-1111-4111-8111-111111111111" }] }); // team exists
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // INSERT INTO audit_log (denial)

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/draft",
    });

    expect(res.statusCode).toBe(403);
    const message = res.json().error.message as string;
    expect(message).toContain("member of");
    expect(message).not.toBe("Only a facilitator can create a draft session.");

    expect(mockDbConnect).not.toHaveBeenCalled(); // no transaction opened, no session created

    const auditCall = mockDbQuery.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toContain("session.draft_denied_membership_conflict");

    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "session.draft_denied_membership_conflict",
      expect.objectContaining({ teamId: "11111111-1111-4111-8111-111111111111" }),
    );
  });

  // task 2.4: a previously-removed membership does not block creation
  it("2.4: facilitator with a previously-removed (removed_at set) membership on target team is permitted", async () => {
    // removed_at IS NULL is part of the query's JOIN condition, so a
    // soft-deleted membership row makes is_member false at the DB layer —
    // simulated here directly, since the query itself is not re-executed.
    mockActorQuery("facilitator", false);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "11111111-1111-4111-8111-111111111111" }] }); // team exists

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ id: "session-draft-1" }] }, // INSERT sessions
      { rows: [] }, // INSERT audit_log (draft_created)
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ token: "active-join-token" }] }); // get-or-create: reuse active join_links row

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/draft",
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().sessionId).toBe("session-draft-1");
  });

  // cross-team-facilitator-constraint tasks 2.1/2.2 — the actor query's
  // membership join uses removed_at IS NULL to determine is_member;
  // asserted at the query-text level since the mocked DB layer doesn't
  // evaluate JOIN conditions. "FROM users u" uniquely isolates this query
  // from the team-exists check ("FROM teams") and the denial-path audit
  // insert ("INSERT INTO audit_log") mocked elsewhere in this block; the
  // success-path INSERT INTO sessions/audit_log pair runs on the
  // transaction client, not db.query, so it never appears in this list.
  it("the actor query's membership join excludes removed memberships via removed_at IS NULL", async () => {
    mockActorQuery("facilitator", false);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "11111111-1111-4111-8111-111111111111" }] }); // team exists

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ id: "session-draft-1" }] }, // INSERT sessions
      { rows: [] }, // INSERT audit_log (draft_created)
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/draft",
    });

    const actorQueryCall = mockDbQuery.mock.calls.find((call) =>
      (call[0] as string).includes("FROM users u"),
    );
    expect(actorQueryCall).toBeDefined();
    expect(actorQueryCall![0] as string).toContain("removed_at IS NULL");
  });

  // join-link-redemption-wiring, tasks.md Task 2.2: joinToken is now sourced
  // via get-or-create from a real join_links row, not the dead
  // session-scoped value.
  it("returns 201 with draft status, a joinToken sourced from get-or-create, and writes the draft_created audit row in the same transaction as the insert", async () => {
    mockActorQuery("facilitator", false);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "11111111-1111-4111-8111-111111111111" }] }); // team exists

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ id: "session-draft-1" }] }, // INSERT sessions
      { rows: [] }, // INSERT audit_log (draft_created)
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ token: "active-join-token" }] }); // get-or-create: reuse active join_links row

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/draft",
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("draft");
    expect(body.sessionId).toBe("session-draft-1");
    expect(body.teamId).toBe("11111111-1111-4111-8111-111111111111");
    expect(body.joinToken).toBe("active-join-token");

    // task 2.16: audit insert happens on the same client, between BEGIN/COMMIT
    const calls = client.query.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toContain("BEGIN");
    expect(calls[1]).toContain("INSERT INTO sessions");
    expect(calls[2]).toContain("INSERT INTO audit_log");
    expect(calls[2]).toContain("audit_log");
    expect(client.query.mock.calls[2]![1]).toContain("session.draft_created");
    expect(calls[3]).toContain("COMMIT");

    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "session.draft_created",
      expect.objectContaining({ teamId: "11111111-1111-4111-8111-111111111111", sessionId: "session-draft-1" }),
    );
  });

  // join-link-redemption-wiring, tasks.md Task 2.4: parity with
  // facilitator-state's miss-path lookup test -- POST /draft's get-or-create
  // call sources actor_global_role from the value already resolved earlier
  // in this handler (the facilitator check above), issuing no additional
  // SELECT global_role query, on either the reuse or miss path.
  it("sources actor_global_role from the already-resolved value on both get-or-create's reuse and miss paths, issuing no additional SELECT global_role query", async () => {
    mockActorQuery("facilitator", false);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "11111111-1111-4111-8111-111111111111" }] }); // team exists

    const sessionClient = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ id: "session-draft-3" }] }, // INSERT sessions
      { rows: [] }, // INSERT audit_log (draft_created)
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(sessionClient);
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // get-or-create: no active row (miss path)
    const joinLinkClient = makeMockClient([
      { rows: [] }, // BEGIN
      {
        rows: [
          {
            id: "link-4",
            team_id: "11111111-1111-4111-8111-111111111111",
            token: "new-join-token",
            created_at: new Date("2026-01-01"),
            expires_at: new Date("2026-01-08"),
          },
        ],
      }, // INSERT INTO join_links
    ]);
    mockDbConnect.mockResolvedValueOnce(joinLinkClient);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/draft",
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().joinToken).toBe("new-join-token");

    const globalRoleCall = mockDbQuery.mock.calls.find((call) =>
      (call[0] as string).includes("SELECT global_role"),
    );
    expect(globalRoleCall).toBeUndefined();

    const auditInsertCall = joinLinkClient.query.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO audit_log"),
    );
    expect(auditInsertCall).toBeDefined();
    expect((auditInsertCall![1] as unknown[])[1]).toBe("facilitator");
  });

  // task 2.14: concurrent-session 409
  it("2.14: creating a session for a team that already has a lobby session returns 409 with the existing session's id/status, and creates no new row", async () => {
    mockActorQuery("facilitator", false);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "11111111-1111-4111-8111-111111111111" }] }); // team exists

    const violation = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "sessions_team_active_unique",
    });
    Object.setPrototypeOf(violation, DatabaseErrorProto);

    const client = makeMockClient();
    client.query = vi.fn((sql: string) => {
      if (sql.includes("BEGIN")) return Promise.resolve({ rows: [] });
      if (sql.includes("INSERT INTO sessions")) return Promise.reject(violation);
      if (sql.includes("ROLLBACK")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    mockDbConnect.mockResolvedValueOnce(client);

    // follow-up SELECT for the existing session, after rollback
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: "existing-session-1", status: "lobby" }],
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/draft",
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.errorState).toBe("session_already_exists");
    expect(body.existingSessionId).toBe("existing-session-1");
    expect(body.existingSessionStatus).toBe("lobby");
    expect(body.teamId).toBe("11111111-1111-4111-8111-111111111111");

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("ROLLBACK"));
  });

  // task 2.15: only prior session terminal -> permitted
  it("2.15: creating a session for a team whose only prior session is complete is permitted", async () => {
    mockActorQuery("facilitator", false);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "11111111-1111-4111-8111-111111111111" }] }); // team exists

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ id: "session-draft-2" }] }, // INSERT sessions succeeds — no violation
      { rows: [] }, // INSERT audit_log
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ token: "active-join-token" }] }); // get-or-create: reuse active join_links row

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/draft",
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().sessionId).toBe("session-draft-2");
  });

  // task 2.17: of two concurrent creation requests for the same team,
  // exactly one succeeds and the other is rejected identifying the winner.
  //
  // A mocked unit test cannot exercise real event-loop-level concurrency or
  // the database's actual lock ordering (that guarantee comes from the
  // partial unique index itself, verified against a real Postgres instance
  // per task 1.2's manual verification). What this test asserts is the
  // *application-level contract* the index's atomicity is relied on to
  // produce: the second insert against an already-occupied team_id surfaces
  // as a 23505 on sessions_team_active_unique, and the handler resolves that
  // into a 409 naming the session the first request created — regardless of
  // which of the two requests happens to reach Postgres first.
  it("2.17: of two concurrent creation requests for the same team, exactly one succeeds and the other receives 409 identifying the winner's session", async () => {
    mockActorQuery("facilitator", false);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "11111111-1111-4111-8111-111111111111" }] }); // team exists (request A, the winner)

    const winnerClient = makeMockClient([
      { rows: [] },
      { rows: [{ id: "session-winner" }] },
      { rows: [] },
      { rows: [] },
    ]);
    mockDbConnect.mockResolvedValueOnce(winnerClient);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ token: "active-join-token" }] }); // get-or-create: reuse active join_links row

    const app = await buildApp();
    const resA = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/draft",
    });
    expect(resA.statusCode).toBe(201);
    expect(resA.json().sessionId).toBe("session-winner");

    // Request B arrives after A has already committed — the index rejects it.
    mockActorQuery("facilitator", false);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "11111111-1111-4111-8111-111111111111" }] }); // team exists (request B, the loser)

    const violation = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "sessions_team_active_unique",
    });
    Object.setPrototypeOf(violation, DatabaseErrorProto);
    const loserClient = makeMockClient();
    loserClient.query = vi.fn((sql: string) => {
      if (sql.includes("BEGIN")) return Promise.resolve({ rows: [] });
      if (sql.includes("INSERT INTO sessions")) return Promise.reject(violation);
      if (sql.includes("ROLLBACK")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    mockDbConnect.mockResolvedValueOnce(loserClient);
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: "session-winner", status: "draft" }],
    }); // loser's follow-up SELECT, after rollback

    const resB = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/draft",
    });

    expect(resB.statusCode).toBe(409);
    expect(resB.json().existingSessionId).toBe("session-winner");
  });

  // task 2.18: a 23505 on an unrelated constraint must not be mistaken for the 409 case.
  // join-link-redemption-wiring, task 4.11: sessions_join_token_unique no
  // longer exists after Migration B (the column and its constraint are
  // dropped) -- teams_name_unique is a real, still-existing constraint
  // unrelated to sessions_team_active_unique, serving the same "some other
  // 23505" role this test exists to guard against.
  it("2.18: a 23505 unique-violation on a different constraint propagates as an unhandled 500, not a false-positive 409", async () => {
    mockActorQuery("facilitator", false);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "11111111-1111-4111-8111-111111111111" }] }); // team exists

    const otherViolation = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "teams_name_unique",
    });
    Object.setPrototypeOf(otherViolation, DatabaseErrorProto);

    const client = makeMockClient();
    client.query = vi.fn((sql: string) => {
      if (sql.includes("BEGIN")) return Promise.resolve({ rows: [] });
      if (sql.includes("INSERT INTO sessions")) return Promise.reject(otherViolation);
      if (sql.includes("ROLLBACK")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/draft",
    });

    expect(res.statusCode).toBe(500);
  });

  // task 2.19: a non-23505 database error must also propagate as a 500
  it("2.19: a non-23505 database error during the insert propagates as an unhandled 500, not a false-positive 409", async () => {
    mockActorQuery("facilitator", false);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "11111111-1111-4111-8111-111111111111" }] }); // team exists

    const client = makeMockClient();
    client.query = vi.fn((sql: string) => {
      if (sql.includes("BEGIN")) return Promise.resolve({ rows: [] });
      if (sql.includes("INSERT INTO sessions")) return Promise.reject(new Error("connection reset"));
      if (sql.includes("ROLLBACK")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/draft",
    });

    expect(res.statusCode).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/teams  (inline-team-creation)
//
// design.md D3 (transaction shape), D4 (normalized uniqueness + 23505
// handling), D6 (no team_memberships row), D8 (check ordering). tasks.md
// task 7.1.
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams", () => {
  beforeEach(() => vi.clearAllMocks());

  function mockActorRoleQuery(globalRole: string) {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: globalRole }] });
  }

  function mockCollisionPrecheck(collides: boolean) {
    mockDbQuery.mockResolvedValueOnce({ rows: collides ? [{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }] : [] });
  }

  function successTransactionClient() {
    return makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ id: "new-team-1" }] }, // INSERT teams
      { rows: [] }, // INSERT topics (copy)
      { rows: [{ id: "new-session-1" }] }, // INSERT sessions
      { rows: [] }, // SELECT pg_advisory_xact_lock (uniformity)
      {
        rows: [
          { topic_id: "default-2", display_order: 2 },
          { topic_id: "default-1", display_order: 1 },
        ],
        rowCount: 2,
      }, // INSERT INTO session_topics ... RETURNING (snapshot)
      { rows: [] }, // INSERT audit_log
      { rows: [] }, // COMMIT
    ]);
  }

  /** The copy succeeds, but the snapshot's RETURNING yields nothing: an empty template. */
  function emptyTemplateClient() {
    return makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ id: "new-team-1" }] }, // INSERT teams
      { rows: [] }, // INSERT topics (copy)
      { rows: [{ id: "new-session-1" }] }, // INSERT sessions
      { rows: [] }, // lock
      { rows: [], rowCount: 0 }, // snapshot RETURNING: none
      { rows: [] }, // ROLLBACK
    ]);
  }

  it("7.1 success path: creates a team, copies default topics, creates a lobby session with is_first_session true, and returns 201", async () => {
    mockActorRoleQuery("facilitator");
    mockCollisionPrecheck(false);

    const client = successTransactionClient();
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams",
      payload: { name: "Platform Team" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.teamId).toBe("new-team-1");
    expect(body.sessionId).toBe("new-session-1");
    expect(body.status).toBe("lobby");
    // join-link-redemption-wiring, design.md Decision 1's note, tasks.md
    // Task 4.2: this endpoint's response no longer carries a joinToken
    // field at all -- it would otherwise be a fabricated value with
    // nothing writing it, once join_token stops being generated below.
    expect(body.joinToken).toBeUndefined();

    const calls = client.query.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toContain("BEGIN");
    expect(calls[1]).toContain("INSERT INTO teams");
    expect(calls[2]).toContain("INSERT INTO topics");
    expect(calls[2]).toContain("is_default = true");
    expect(calls[3]).toContain("INSERT INTO sessions");
    expect(calls[3]).not.toContain("join_token");
    expect(client.query.mock.calls[3]![1]).toEqual(["new-team-1", "facilitator-1"]);
    // is_first_session and session_number are literal true/1 in the SQL text
    // itself (design.md D3), not bound parameters.
    expect(calls[3]).toContain("true, 1");
    // session-topics-snapshot-at-creation: creation is this session's room open.
    expect(calls[3]).toContain("room_opened_at");
    expect(calls[3]).toContain("now()");
    expect(calls[4]).toContain("pg_advisory_xact_lock(hashtext($1::uuid::text))");
    expect(client.query.mock.calls[4]![1]).toEqual(["new-team-1"]);
    expect(calls[5]).toContain("INSERT INTO session_topics");
    expect(client.query.mock.calls[5]![1]).toEqual(["new-session-1"]);
    expect(calls[6]).toContain("INSERT INTO audit_log");
    expect(client.query.mock.calls[6]![1]).toContain("team.created_with_session");
    expect(calls[7]).toContain("COMMIT");

    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "team.created_with_session",
      expect.objectContaining({ teamId: "new-team-1", sessionId: "new-session-1" }),
    );
  });

  it("copies the template by the named DEFAULT_TOPICS_TEAM_ID constant, bound as a parameter", async () => {
    mockActorRoleQuery("facilitator");
    mockCollisionPrecheck(false);
    const client = successTransactionClient();
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    await app.inject({ method: "POST", url: "/api/v1/teams", payload: { name: "Platform Team" } });

    expect(client.query.mock.calls[2]![1]).toEqual(["new-team-1", "00000000-0000-0000-0000-000000000001"]);
  });

  // session-topics-snapshot-at-creation design.md Decision 3b — sinks.
  it("the audit row carries topic_count and ordered topic_ids; the event carries topicCount only", async () => {
    mockActorRoleQuery("facilitator");
    mockCollisionPrecheck(false);
    const client = successTransactionClient();
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    await app.inject({ method: "POST", url: "/api/v1/teams", payload: { name: "Platform Team" } });

    const metadata = JSON.parse((client.query.mock.calls[6]![1] as unknown[])[5] as string);
    expect(metadata).toEqual({
      team_id: "new-team-1",
      session_id: "new-session-1",
      topic_count: 2,
      topic_ids: ["default-1", "default-2"],
    });
    const fields = mockEmitAuditEvent.mock.calls.find((c) => c[1] === "team.created_with_session")![2] as Record<
      string,
      unknown
    >;
    expect(fields.topicCount).toBe(metadata.topic_count);
    expect(fields).not.toHaveProperty("topicIds");
    expect(fields).not.toHaveProperty("topic_ids");
    expect(JSON.stringify(fields)).not.toContain("default-1");
  });

  it("an empty default-topic template rolls back and returns a fixed 500 internal_error, logged with templateTeamId and correlationId", async () => {
    mockActorRoleQuery("facilitator");
    mockCollisionPrecheck(false);
    const client = emptyTemplateClient();
    mockDbConnect.mockResolvedValueOnce(client);

    // A logger whose child() returns itself, so request.log.error is observable.
    const logError = vi.fn();
    const noop = () => undefined;
    const logger = {
      level: "info",
      info: noop,
      warn: noop,
      debug: noop,
      trace: noop,
      fatal: noop,
      silent: noop,
      error: logError,
      child() {
        return logger;
      },
    };
    const app = Fastify({ loggerInstance: logger as unknown as FastifyBaseLogger });
    app.decorateRequest("session", null);
    app.addHook("onRequest", async (request) => {
      (request as unknown as Record<string, unknown>).session = { userId: "facilitator-1" };
    });
    app.register(facilitatorSessionRoutes);
    await app.ready();

    const res = await app.inject({ method: "POST", url: "/api/v1/teams", payload: { name: "Platform Team" } });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toEqual({
      category: "internal_error",
      message:
        "Team creation is unavailable because the default topic set is not configured. Contact an administrator.",
      correlationId: expect.any(String),
    });
    expect(res.body).not.toContain("00000000-0000-0000-0000-000000000001");

    const logged = logError.mock.calls.find(
      (args) => (args[0] as Record<string, unknown>)?.templateTeamId !== undefined,
    );
    expect(logged).toBeDefined();
    expect(logged![0]).toEqual({
      templateTeamId: "00000000-0000-0000-0000-000000000001",
      correlationId: body.error.correlationId,
    });

    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.query).not.toHaveBeenCalledWith("COMMIT");
    const calls = client.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes("INSERT INTO audit_log"))).toBe(false);
    expect(mockEmitAuditEvent).not.toHaveBeenCalledWith(expect.anything(), "team.created_with_session", expect.anything());
  });

  it("a database error from the snapshot leaves none of its text in the 500 body", async () => {
    mockActorRoleQuery("facilitator");
    mockCollisionPrecheck(false);
    const secret = "relation session_topics violates sekrit constraint";
    const client = makeMockClient();
    client.query = vi.fn((sql: string) => {
      if (sql.includes("INSERT INTO teams")) return Promise.resolve({ rows: [{ id: "new-team-1" }] });
      if (sql.includes("INSERT INTO sessions")) return Promise.resolve({ rows: [{ id: "new-session-1" }] });
      if (sql.includes("INSERT INTO session_topics")) {
        const err = Object.assign(new Error(secret), { code: "23505" });
        Object.setPrototypeOf(err, DatabaseErrorProto);
        return Promise.reject(err);
      }
      return Promise.resolve({ rows: [] });
    }) as typeof client.query;
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/teams", payload: { name: "Platform Team" } });

    expect(res.statusCode).toBe(500);
    expect(res.json().error.category).toBe("internal_error");
    expect(res.body).not.toContain("sekrit");
    expect(res.body).not.toContain("session_topics");
    // A 23505 from the snapshot is not mistaken for a team-name collision.
    expect(res.json().errorState).toBeUndefined();
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.query).not.toHaveBeenCalledWith("COMMIT");
  });

  it("a snapshot failure's 500 copy names team creation, not locking in topics (architect review S2)", async () => {
    mockActorRoleQuery("facilitator");
    mockCollisionPrecheck(false);
    const client = makeMockClient();
    client.query = vi.fn((sql: string) => {
      if (sql.includes("INSERT INTO teams")) return Promise.resolve({ rows: [{ id: "new-team-1" }] });
      if (sql.includes("INSERT INTO sessions")) return Promise.resolve({ rows: [{ id: "new-session-1" }] });
      if (sql.includes("INSERT INTO session_topics")) return Promise.reject(new Error("boom"));
      return Promise.resolve({ rows: [] });
    }) as typeof client.query;
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/teams", payload: { name: "Platform Team" } });

    expect(res.statusCode).toBe(500);
    expect(res.json().error.message).toBe("Something went wrong creating this team. Try again.");
  });

  it("any other database error in the transaction answers a fixed 500 with no database text (security review SF1)", async () => {
    mockActorRoleQuery("facilitator");
    mockCollisionPrecheck(false);
    const client = makeMockClient();
    client.query = vi.fn((sql: string) => {
      if (sql.includes("INSERT INTO teams")) return Promise.resolve({ rows: [{ id: "new-team-1" }] });
      if (sql.includes("INSERT INTO sessions")) {
        const err = Object.assign(new Error("sekrit sessions detail"), { code: "XX000" });
        Object.setPrototypeOf(err, DatabaseErrorProto);
        return Promise.reject(err);
      }
      return Promise.resolve({ rows: [] });
    }) as typeof client.query;
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/teams", payload: { name: "Platform Team" } });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toEqual({
      category: "internal_error",
      message: "Something went wrong creating this team. Try again.",
      correlationId: expect.any(String),
    });
    expect(res.body).not.toContain("sekrit");
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
  });

  // Security-critical (design.md D6): a facilitator who creates a team must
  // NOT become a member of it -- that would manufacture a
  // same-team-facilitator conflict the first time this person tries to
  // facilitate the team they just created. This assertion protects that
  // facilitator-neutrality invariant and must not be weakened or dropped in
  // a future refactor without that being a visible, deliberate decision
  // (security review Finding F2).
  it("7.1 (security-critical, design.md D6): no team_memberships row is inserted for the creating facilitator", async () => {
    mockActorRoleQuery("facilitator");
    mockCollisionPrecheck(false);

    const client = successTransactionClient();
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    await app.inject({
      method: "POST",
      url: "/api/v1/teams",
      payload: { name: "Platform Team" },
    });

    const allCalls = [...client.query.mock.calls, ...mockDbQuery.mock.calls];
    const membershipInsert = allCalls.find((c) => (c[0] as string).includes("INSERT INTO team_memberships"));
    expect(membershipInsert).toBeUndefined();
  });

  it("7.1: non-facilitator caller is rejected with 403 and writes the team.creation_denied_role audit row", async () => {
    mockActorRoleQuery("engineer");
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // INSERT audit_log (denial)

    const app = await buildApp("engineer-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams",
      payload: { name: "Platform Team" },
    });

    expect(res.statusCode).toBe(403);
    expect(mockDbConnect).not.toHaveBeenCalled(); // no transaction opened, no team created

    const auditCall = mockDbQuery.mock.calls.find((call) => (call[0] as string).includes("INSERT INTO audit_log"));
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toContain("team.creation_denied_role");

    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "team.creation_denied_role",
      expect.objectContaining({ actorGlobalRole: "engineer" }),
    );
  });

  // design.md D8, spec's "a non-facilitator caller cannot probe name
  // existence" scenario: check order puts role authorization ahead of any
  // name-dependent check, so the 403 response is identical whether or not
  // the submitted name happens to collide with an existing team.
  it("7.1/D8: non-facilitator rejection is byte-identical whether the submitted name collides or not, and never reaches the uniqueness check", async () => {
    mockActorRoleQuery("engineer");
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // INSERT audit_log (denial)
    const appA = await buildApp("engineer-1");
    const resFreshName = await appA.inject({
      method: "POST",
      url: "/api/v1/teams",
      payload: { name: "A Totally Fresh Name" },
    });

    vi.clearAllMocks();

    mockActorRoleQuery("engineer");
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // INSERT audit_log (denial)
    const appB = await buildApp("engineer-1");
    const resCollidingName = await appB.inject({
      method: "POST",
      url: "/api/v1/teams",
      payload: { name: "Already Taken Team" },
    });

    expect(resCollidingName.statusCode).toBe(resFreshName.statusCode);
    // correlationId is a fresh crypto.randomUUID() per request by design and
    // is excluded from the equality check on that basis alone; every other
    // field -- category, message -- must be identical.
    const { error: errFresh, ...restFresh } = resFreshName.json();
    const { error: errColliding, ...restColliding } = resCollidingName.json();
    expect(restColliding).toEqual(restFresh);
    expect(errColliding.category).toBe(errFresh.category);
    expect(errColliding.message).toBe(errFresh.message);
    // Only the actor-role query and the denial audit insert ran -- the
    // normalized-uniqueness precheck (a third db.query call) was never
    // reached for either request.
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
  });

  it("7.1: empty (or whitespace-only) team name is rejected with a validation error, before any uniqueness check", async () => {
    mockActorRoleQuery("facilitator");

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams",
      payload: { name: "   " },
    });

    expect(res.statusCode).toBe(400);
    expect(mockDbQuery).toHaveBeenCalledTimes(1); // actor query only
    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  it("7.1: exact-duplicate name is rejected 409 via the normalized pre-check, with a typed TeamNameCollisionResponse", async () => {
    mockActorRoleQuery("facilitator");
    mockCollisionPrecheck(true);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams",
      payload: { name: "Platform Team" },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.errorState).toBe("team_name_collision");
    expect(body.providedName).toBe("Platform Team");
    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  it("7.1: case/whitespace-variant duplicate name is rejected 409 via the normalized pre-check", async () => {
    mockActorRoleQuery("facilitator");
    mockCollisionPrecheck(true);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams",
      payload: { name: "  platform team  " },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.errorState).toBe("team_name_collision");
    // providedName echoes the trimmed (not lowercased) submission.
    expect(body.providedName).toBe("platform team");
  });

  // design.md D4, engineer review Finding 1: an exact-duplicate name can
  // race past the app-level pre-check (both concurrent requests see no
  // existing row) and only get caught by the database's teams_name_unique
  // constraint on the INSERT itself.
  it("7.1/D4 Finding 1: concurrent identical-name race is caught by teams_name_unique on the INSERT (exact-match constraint path)", async () => {
    mockActorRoleQuery("facilitator");
    mockCollisionPrecheck(false); // pre-check race window: no row yet

    const violation = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "teams_name_unique",
    });
    Object.setPrototypeOf(violation, DatabaseErrorProto);

    const client = makeMockClient();
    client.query = vi.fn((sql: string) => {
      if (sql.includes("BEGIN")) return Promise.resolve({ rows: [] });
      if (sql.includes("INSERT INTO teams")) return Promise.reject(violation);
      if (sql.includes("ROLLBACK")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams",
      payload: { name: "Platform Team" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().errorState).toBe("team_name_collision");
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("ROLLBACK"));
  });

  // design.md D4: only one of two concurrent requests for normalized-
  // duplicate (differently cased/whitespaced) names succeeds -- the loser's
  // INSERT hits teams_name_unique_normalized, reported via the SAME
  // err.code === "23505" check (not a constraint-name match), per Finding 1.
  it("7.1/D4: concurrent case/whitespace-variant race is caught by teams_name_unique_normalized on the INSERT, translated to the same typed response", async () => {
    mockActorRoleQuery("facilitator");
    mockCollisionPrecheck(false);

    const violation = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "teams_name_unique_normalized",
    });
    Object.setPrototypeOf(violation, DatabaseErrorProto);

    const client = makeMockClient();
    client.query = vi.fn((sql: string) => {
      if (sql.includes("BEGIN")) return Promise.resolve({ rows: [] });
      if (sql.includes("INSERT INTO teams")) return Promise.reject(violation);
      if (sql.includes("ROLLBACK")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams",
      payload: { name: "platform team" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().errorState).toBe("team_name_collision");
  });

  it("7.1: transaction-rollback-on-failure -- a non-23505 error during the transaction rolls back and propagates as 500, creating nothing", async () => {
    mockActorRoleQuery("facilitator");
    mockCollisionPrecheck(false);

    const client = makeMockClient();
    client.query = vi.fn((sql: string) => {
      if (sql.includes("BEGIN")) return Promise.resolve({ rows: [] });
      if (sql.includes("INSERT INTO teams")) return Promise.resolve({ rows: [{ id: "new-team-1" }] });
      if (sql.includes("INSERT INTO topics")) return Promise.reject(new Error("connection reset"));
      if (sql.includes("ROLLBACK")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams",
      payload: { name: "Platform Team" },
    });

    expect(res.statusCode).toBe(500);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("ROLLBACK"));
    expect(mockEmitAuditEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      "team.created_with_session",
      expect.anything(),
    );
  });

  it("a 23505 on a statement other than the teams INSERT is not mistaken for a name collision", async () => {
    mockActorRoleQuery("facilitator");
    mockCollisionPrecheck(false);

    const otherViolation = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "topics_team_order",
    });
    Object.setPrototypeOf(otherViolation, DatabaseErrorProto);

    const client = makeMockClient();
    client.query = vi.fn((sql: string) => {
      if (sql.includes("BEGIN")) return Promise.resolve({ rows: [] });
      if (sql.includes("INSERT INTO teams")) return Promise.resolve({ rows: [{ id: "new-team-1" }] });
      if (sql.includes("INSERT INTO topics")) return Promise.reject(otherViolation);
      if (sql.includes("ROLLBACK")) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams",
      payload: { name: "Platform Team" },
    });

    expect(res.statusCode).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/teams/:teamId/sessions/:sessionId/advance (Task 8.3)
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/sessions/:sessionId/advance", () => {
  beforeEach(() => vi.clearAllMocks());

  const DRAFT_ROW = { id: "5e550000-0000-4000-8000-000000000001", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1", status: "draft" };
  const NO_TOPICS_MESSAGE =
    "This team has no active topics. Add or restore a topic on Topic Management before opening the room.";

  function mockPreTransaction(row: Record<string, unknown> = DRAFT_ROW, globalRole: string | null = "facilitator") {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [row] }) // session lookup
      .mockResolvedValueOnce({ rows: globalRole === null ? [] : [{ global_role: globalRole }] }); // live global_role
  }

  /**
   * Room-open transaction (session-topics-snapshot-at-creation design.md
   * Decision 3): BEGIN, team lock, conditional UPDATE, snapshot, audit, COMMIT.
   */
  function successClient(snapshotRows = [
    { topic_id: "topic-b", display_order: 2 },
    { topic_id: "topic-a", display_order: 1 },
    { topic_id: "topic-c", display_order: 3 },
  ]) {
    return makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // SELECT pg_advisory_xact_lock
      { rows: [], rowCount: 1 }, // UPDATE sessions ... AND status = 'draft'
      { rows: snapshotRows, rowCount: snapshotRows.length }, // INSERT INTO session_topics ... RETURNING
      { rows: [] }, // INSERT audit_log (session.state_changed)
      { rows: [] }, // COMMIT
    ]);
  }

  async function advance(userId = "facilitator-1") {
    const app = await buildApp(userId);
    return app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/5e550000-0000-4000-8000-000000000001/advance" });
  }

  function sqlOf(client: ReturnType<typeof makeMockClient>) {
    return client.query.mock.calls.map((c) => c[0] as string);
  }

  it("transitions draft to lobby successfully", async () => {
    mockPreTransaction();
    const client = successClient();
    mockDbConnect.mockResolvedValueOnce(client);

    const res = await advance();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sessionId: "5e550000-0000-4000-8000-000000000001", teamId: "11111111-1111-4111-8111-111111111111", status: "lobby" });

    const auditInsertCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditInsertCall).toBeDefined();
    expect(auditInsertCall![1]).toContain("session.state_changed");

    // Publish-after-commit: published only after the transaction committed.
    expect(mockPublishSessionStateChange).toHaveBeenCalledWith(
      "5e550000-0000-4000-8000-000000000001",
      expect.objectContaining({ previousStatus: "draft", newStatus: "lobby" }),
    );
  });

  it("takes the canonical team lock on the session row's team, then the conditional update, then the snapshot", async () => {
    mockPreTransaction();
    const client = successClient();
    mockDbConnect.mockResolvedValueOnce(client);

    await advance();

    const calls = sqlOf(client);
    expect(calls[0]).toBe("BEGIN");
    expect(calls[1]).toContain("pg_advisory_xact_lock(hashtext($1::uuid::text))");
    expect(client.query.mock.calls[1]![1]).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(calls[2]).toContain("SET status = 'lobby', room_opened_at = now()");
    expect(calls[2]).toContain("WHERE id = $1 AND team_id = $2 AND facilitator_id = $3 AND status = 'draft'");
    expect(client.query.mock.calls[2]![1]).toEqual(["5e550000-0000-4000-8000-000000000001", "11111111-1111-4111-8111-111111111111", "facilitator-1"]);
    expect(calls[3]).toContain("INSERT INTO session_topics");
    expect(client.query.mock.calls[3]![1]).toEqual(["5e550000-0000-4000-8000-000000000001"]);
    expect(calls[4]).toContain("INSERT INTO audit_log");
    expect(calls[5]).toBe("COMMIT");
  });

  it("returns 422 when session is not in draft status", async () => {
    mockPreTransaction({ ...DRAFT_ROW, status: "active" });

    const res = await advance();

    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toBe("Session cannot be advanced from status 'active'.");
    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  it("returns 403 when actor is not the session facilitator", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ ...DRAFT_ROW, facilitator_id: "other-facilitator" }] });

    const res = await advance("facilitator-1"); // different user

    expect(res.statusCode).toBe(403);
    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown session, before any role or status check", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await advance();

    expect(res.statusCode).toBe(404);
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  it("returns 403 when the session belongs to another team, before the creator and role checks", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ ...DRAFT_ROW, team_id: "22222222-2222-4222-8222-222222222222" }] });

    const res = await advance();

    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toBe("Session does not belong to this team.");
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  it("a failure after the snapshot (the audit insert) rolls back and rethrows, with no event or publish", async () => {
    mockPreTransaction();
    const client = makeMockClient();
    client.query = vi.fn((sql: string) => {
      if (sql.includes("UPDATE sessions")) return Promise.resolve({ rows: [], rowCount: 1 });
      if (sql.includes("INSERT INTO session_topics"))
        return Promise.resolve({ rows: [{ topic_id: "topic-a", display_order: 1 }], rowCount: 1 });
      if (sql.includes("INSERT INTO audit_log")) return Promise.reject(new Error("audit write failed"));
      return Promise.resolve({ rows: [] });
    }) as typeof client.query;
    mockDbConnect.mockResolvedValueOnce(client);

    const res = await advance();

    expect(res.statusCode).toBe(500);
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.query).not.toHaveBeenCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalled();
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
    expect(mockPublishSessionStateChange).not.toHaveBeenCalled();
  });

  // design.md Decision 3a — the live facilitator role.
  describe("live facilitator role (design.md Decision 3a)", () => {
    it("rejects a creator whose global_role is no longer facilitator with 403 forbidden and a denial audit row", async () => {
      mockPreTransaction(DRAFT_ROW, "engineer");
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // INSERT audit_log (denial)

      const res = await advance();

      expect(res.statusCode).toBe(403);
      expect(res.json().error.category).toBe("forbidden");
      expect(res.json().error.message).toBe("Only a facilitator can open the room.");
      expect(res.json().error.correlationId).toEqual(expect.any(String));

      const auditCall = mockDbQuery.mock.calls.find((c) => (c[0] as string).includes("INSERT INTO audit_log"));
      expect(auditCall![1]).toEqual([
        "facilitator-1",
        "engineer",
        expect.any(String),
        "session.advance_denied_role",
        "11111111-1111-4111-8111-111111111111",
        JSON.stringify({ session_id: "5e550000-0000-4000-8000-000000000001" }),
      ]);
      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        "session.advance_denied_role",
        expect.objectContaining({ actorGlobalRole: "engineer", teamId: "11111111-1111-4111-8111-111111111111", sessionId: "5e550000-0000-4000-8000-000000000001" }),
      );

      // The session stays draft: no transaction, no event.
      expect(mockDbConnect).not.toHaveBeenCalled();
      expect(mockPublishSessionStateChange).not.toHaveBeenCalled();
    });

    it("treats a missing user row as a denial, recorded with actor_global_role 'unknown'", async () => {
      mockPreTransaction(DRAFT_ROW, null);
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // INSERT audit_log (denial)

      const res = await advance();

      expect(res.statusCode).toBe(403);
      const auditCall = mockDbQuery.mock.calls.find((c) => (c[0] as string).includes("INSERT INTO audit_log"));
      expect((auditCall![1] as unknown[])[1]).toBe("unknown");
      expect(mockDbConnect).not.toHaveBeenCalled();
    });

    it("checks the live role before the status: a revoked creator of a non-draft session gets 403, not 422", async () => {
      mockPreTransaction({ ...DRAFT_ROW, status: "lobby" }, "engineer");
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // INSERT audit_log (denial)

      const res = await advance();

      expect(res.statusCode).toBe(403);
    });
  });

  it("a conditional update matching no row (double-click) re-reads the status, rolls back, and returns today's 422", async () => {
    mockPreTransaction();
    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // lock
      { rows: [], rowCount: 0 }, // UPDATE matched nothing
      { rows: [{ status: "lobby" }] }, // re-read status
      { rows: [] }, // ROLLBACK
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const res = await advance();

    expect(res.statusCode).toBe(422);
    expect(res.json().error.category).toBe("invalid_request");
    expect(res.json().error.message).toBe("Session cannot be advanced from status 'lobby'.");
    const calls = sqlOf(client);
    expect(calls[3]).toContain("SELECT status FROM sessions WHERE id = $1");
    expect(calls[4]).toBe("ROLLBACK");
    expect(calls.some((c) => c.includes("INSERT INTO session_topics"))).toBe(false);
    expect(calls.some((c) => c.includes("INSERT INTO audit_log"))).toBe(false);
    expect(calls).not.toContain("COMMIT");
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
    expect(mockPublishSessionStateChange).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });

  it("an undefined rowCount is not treated as success (explicit rowCount === 1)", async () => {
    mockPreTransaction();
    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // lock
      { rows: [] }, // UPDATE with rowCount undefined
      { rows: [] }, // re-read status: row gone
      { rows: [] }, // ROLLBACK
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const res = await advance();

    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toBe("Session cannot be advanced from status 'unknown'.");
  });

  it("zero active topics rolls back and returns 409 NO_ACTIVE_TOPICS with no audit row and no event", async () => {
    mockPreTransaction();
    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // lock
      { rows: [], rowCount: 1 }, // UPDATE
      { rows: [], rowCount: 0 }, // snapshot RETURNING: no rows
      { rows: [] }, // ROLLBACK
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const res = await advance();

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toEqual({
      category: "precondition_failed",
      code: "NO_ACTIVE_TOPICS",
      message: NO_TOPICS_MESSAGE,
      correlationId: expect.any(String),
    });
    const calls = sqlOf(client);
    expect(calls[4]).toBe("ROLLBACK");
    expect(calls.some((c) => c.includes("INSERT INTO audit_log"))).toBe(false);
    expect(calls).not.toContain("COMMIT");
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
    expect(mockPublishSessionStateChange).not.toHaveBeenCalled();
  });

  it("a database error from the snapshot rolls back and never echoes its text in the response", async () => {
    mockPreTransaction();
    const secret = "duplicate key value violates unique constraint session_topics_session_topic DETAIL sekrit";
    const client = makeMockClient();
    client.query = vi.fn((sql: string) => {
      if (sql.includes("UPDATE sessions")) return Promise.resolve({ rows: [], rowCount: 1 });
      if (sql.includes("INSERT INTO session_topics")) {
        const err = Object.assign(new Error(secret), { code: "23505" });
        Object.setPrototypeOf(err, DatabaseErrorProto);
        return Promise.reject(err);
      }
      return Promise.resolve({ rows: [] });
    }) as typeof client.query;
    mockDbConnect.mockResolvedValueOnce(client);

    const res = await advance();

    expect(res.statusCode).toBe(500);
    expect(res.json().error.category).toBe("internal_error");
    expect(res.body).not.toContain("sekrit");
    expect(res.body).not.toContain("duplicate key");
    expect(res.body).not.toContain("session_topics");
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.query).not.toHaveBeenCalledWith("COMMIT");
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
    expect(mockPublishSessionStateChange).not.toHaveBeenCalled();
  });

  // Security review SF1: every other failure inside the room-open
  // transaction also answers a fixed 500, never the database text.
  it.each([
    ["the team lock", "pg_advisory_xact_lock"],
    ["the conditional UPDATE", "UPDATE sessions"],
    ["the audit INSERT", "INSERT INTO audit_log"],
    ["COMMIT", "COMMIT"],
  ])("a database error from %s rolls back and answers a fixed 500 with no database text", async (_label, failing) => {
    mockPreTransaction();
    const secret = "sekrit relation detail from postgres";
    const client = makeMockClient();
    client.query = vi.fn((sql: string) => {
      if (sql.includes(failing)) {
        const err = Object.assign(new Error(secret), { code: "XX000" });
        Object.setPrototypeOf(err, DatabaseErrorProto);
        return Promise.reject(err);
      }
      if (sql.includes("UPDATE sessions")) return Promise.resolve({ rows: [], rowCount: 1 });
      if (sql.includes("INSERT INTO session_topics")) {
        return Promise.resolve({ rows: [{ topic_id: "topic-a", display_order: 1 }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [] });
    }) as typeof client.query;
    mockDbConnect.mockResolvedValueOnce(client);

    const res = await advance();

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toEqual({
      category: "internal_error",
      message: "Something went wrong opening the room. Try again.",
      correlationId: expect.any(String),
    });
    expect(res.body).not.toContain("sekrit");
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalled();
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
    expect(mockPublishSessionStateChange).not.toHaveBeenCalled();
  });

  it("a ROLLBACK that itself fails still answers the fixed 500", async () => {
    mockPreTransaction();
    const client = makeMockClient();
    client.query = vi.fn((sql: string) => {
      if (sql.includes("UPDATE sessions") || sql === "ROLLBACK") return Promise.reject(new Error("sekrit"));
      return Promise.resolve({ rows: [] });
    }) as typeof client.query;
    mockDbConnect.mockResolvedValueOnce(client);

    const res = await advance();

    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("sekrit");
  });

  it.each(["not-a-uuid", "5e5500000000400080000000000000001", "{5e550000-0000-4000-8000-000000000001}"])(
    "a non-canonical sessionId (%s) is 404 before any query, never a 22P02 500 (security review SF1)",
    async (badSessionId) => {
      const app = await buildApp("facilitator-1");
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/${encodeURIComponent(badSessionId)}/advance`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toMatchObject({ category: "not_found", message: "Session not found." });
      expect(mockDbQuery).not.toHaveBeenCalled();
      expect(mockDbConnect).not.toHaveBeenCalled();
    },
  );

  // Security review SF2: the committed records take the team from the
  // session row, not the URL.
  it("both audit sinks take team_id from the session row", async () => {
    mockPreTransaction();
    const client = successClient();
    mockDbConnect.mockResolvedValueOnce(client);

    await advance();

    const auditCall = client.query.mock.calls.find((c) => (c[0] as string).includes("INSERT INTO audit_log"));
    expect((auditCall![1] as unknown[])[4]).toBe(DRAFT_ROW.team_id);
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "session.state_changed",
      expect.objectContaining({ teamId: DRAFT_ROW.team_id }),
    );
  });

  // design.md Decision 3b — audit content boundary and sinks.
  it("the audit row carries topic_count and topic_ids in snapshot order; the event carries topicCount only", async () => {
    mockPreTransaction();
    const client = successClient();
    mockDbConnect.mockResolvedValueOnce(client);

    await advance();

    const auditInsertCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    )!;
    const metadata = JSON.parse((auditInsertCall[1] as unknown[])[5] as string);
    expect(metadata).toEqual({
      session_id: "5e550000-0000-4000-8000-000000000001",
      prior_status: "draft",
      new_status: "lobby",
      topic_count: 3,
      topic_ids: ["topic-a", "topic-b", "topic-c"],
    });

    const eventCall = mockEmitAuditEvent.mock.calls.find((c) => c[1] === "session.state_changed")!;
    const fields = eventCall[2] as Record<string, unknown>;
    expect(fields.topicCount).toBe(3);
    expect(fields).not.toHaveProperty("topicIds");
    expect(fields).not.toHaveProperty("topic_ids");
    expect(JSON.stringify(fields)).not.toContain("topic-a");
  });

  it("emits and publishes only after COMMIT", async () => {
    mockPreTransaction();
    const order: string[] = [];
    const client = successClient();
    const inner = client.query;
    client.query = vi.fn((...args: unknown[]) => {
      order.push(String(args[0]).trim().split(/\s+/)[0]!);
      return inner(...args);
    }) as typeof client.query;
    mockDbConnect.mockResolvedValueOnce(client);
    mockEmitAuditEvent.mockImplementationOnce(() => order.push("emit"));
    mockPublishSessionStateChange.mockImplementationOnce(async () => {
      order.push("publish");
    });

    await advance();

    expect(order.slice(-3)).toEqual(["COMMIT", "emit", "publish"]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/sessions/:sessionId/start (SESSION-004, tasks.md 1.8)
// ---------------------------------------------------------------------------
describe("POST /api/v1/sessions/:sessionId/start", () => {
  beforeEach(() => vi.clearAllMocks());

  it("transitions lobby to pre_session and returns action items oldest first", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ id: "5e550000-0000-4000-8000-000000000001", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1", status: "lobby" }],
      }) // session lookup
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] }) // actor global_role
      .mockResolvedValueOnce({
        rows: [
          {
            action_item_id: "ai-1",
            description: "Fix flaky test",
            owner_user_id: "user-1",
            owner_display_name: "Alice",
            status: "open",
            originating_session_id: "session-old-1",
            originating_session_number: 3,
            created_at: new Date("2026-01-01T00:00:00Z"),
            updated_at: new Date("2026-01-01T00:00:00Z"),
            sessions_since_update: "5",
          },
        ],
      }); // action items query

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ started_at: new Date("2026-09-08T00:00:00Z") }] }, // UPDATE sessions RETURNING started_at
      { rows: [] }, // INSERT audit_log
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/start",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("pre_session");
    expect(body.sessionId).toBe("5e550000-0000-4000-8000-000000000001");
    expect(body.hasOpenItems).toBe(true);
    expect(body.actionItems).toHaveLength(1);
    expect(body.actionItems[0].stalenessLevel).toBe("red"); // 5 sessions since update -> fixed mapping, >= 3 is red

    const auditInsertCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditInsertCall![1]).toContain("session.state_changed");

    expect(mockPublishSessionStateChange).toHaveBeenCalledWith(
      "5e550000-0000-4000-8000-000000000001",
      expect.objectContaining({ previousStatus: "lobby", newStatus: "pre_session" }),
    );
  });

  it("returns hasOpenItems: false and an empty array as a pass-through, not a screen to dismiss", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ id: "5e550000-0000-4000-8000-000000000001", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1", status: "lobby" }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      .mockResolvedValueOnce({ rows: [] }); // no open action items

    const client = makeMockClient([
      { rows: [] },
      { rows: [{ started_at: new Date("2026-09-08T00:00:00Z") }] },
      { rows: [] },
      { rows: [] },
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/start" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hasOpenItems).toBe(false);
    expect(body.actionItems).toEqual([]);
  });

  it("returns 403 when actor is not the session facilitator", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: "5e550000-0000-4000-8000-000000000001", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "other-facilitator", status: "lobby" }],
    });

    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/start" });

    expect(res.statusCode).toBe(403);
  });

  it("returns 409 when session is not in lobby status", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: "5e550000-0000-4000-8000-000000000001", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1", status: "active" }],
    });

    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/start" });

    expect(res.statusCode).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/sessions/:sessionId/begin-voting (SESSION-005, tasks.md 1.8)
// ---------------------------------------------------------------------------
describe("POST /api/v1/sessions/:sessionId/begin-voting", () => {
  beforeEach(() => vi.clearAllMocks());

  it("transitions pre_session to active, sets the first topic voting, and current_topic_id to topics.id", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "5e550000-0000-4000-8000-000000000001", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1",
          status: "pre_session", is_first_session: false,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      {
        rows: [{
          id: "session-topic-1", // session_topics.id
          topic_id: "topic-catalog-1", // topics.id
          topic_name: "Production Code",
          topic_prompt: "How easy is it to add new features?",
          vote_type: "finger",
          first_session_description: null,
        }],
      }, // SELECT first topic
      { rows: [{ voting_started_at: new Date("2026-09-08T00:00:00Z") }] }, // UPDATE sessions RETURNING
      { rows: [] }, // UPDATE session_topics
      { rows: [] }, // INSERT audit_log
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/begin-voting" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("active");
    expect(body.currentTopic.sessionTopicId).toBe("session-topic-1"); // firstSessionTopicId, never firstTopicId

    // Regression test for the id-space defect: sessions.current_topic_id must
    // receive firstTopicId (topics.id = "topic-catalog-1"), NOT
    // firstSessionTopicId (session_topics.id = "session-topic-1").
    const updateSessionsCall = client.query.mock.calls[2]!;
    expect((updateSessionsCall[0] as string).toLowerCase()).toContain("update sessions");
    expect(updateSessionsCall[1]).toEqual(["5e550000-0000-4000-8000-000000000001", "topic-catalog-1"]);

    // The session_topics UPDATE's WHERE id = ... must receive
    // firstSessionTopicId ("session-topic-1"), NOT firstTopicId.
    const updateTopicCall = client.query.mock.calls[3]!;
    expect((updateTopicCall[0] as string).toLowerCase()).toContain("update session_topics");
    expect(updateTopicCall[1]).toEqual(["session-topic-1"]);

    const auditInsertCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditInsertCall![1]).toContain("session.state_changed");

    expect(mockPublishSessionStateChange).toHaveBeenCalledWith(
      "5e550000-0000-4000-8000-000000000001",
      expect.objectContaining({ previousStatus: "pre_session", newStatus: "active" }),
    );
  });

  it("populates firstSessionDescription only when sessions.is_first_session is true", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "5e550000-0000-4000-8000-000000000001", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1",
          status: "pre_session", is_first_session: true,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });

    const client = makeMockClient([
      { rows: [] },
      {
        rows: [{
          id: "session-topic-1", topic_id: "topic-catalog-1",
          topic_name: "Production Code", topic_prompt: "prompt",
          vote_type: "finger", first_session_description: "Welcome! Here's how voting works.",
        }],
      },
      { rows: [{ voting_started_at: new Date("2026-09-08T00:00:00Z") }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/begin-voting" });

    expect(res.json().currentTopic.firstSessionDescription).toBe("Welcome! Here's how voting works.");
  });

  it("returns 403 when actor is not the session facilitator", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "5e550000-0000-4000-8000-000000000001", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "other-facilitator",
        status: "pre_session", is_first_session: false,
      }],
    });

    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/begin-voting" });

    expect(res.statusCode).toBe(403);
  });

  it("returns 409 when session is not in pre_session status", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "5e550000-0000-4000-8000-000000000001", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1",
        status: "lobby", is_first_session: false,
      }],
    });

    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/begin-voting" });

    expect(res.statusCode).toBe(409);
  });

  it("rolls back and commits neither table's write when the second UPDATE fails (dual-table atomicity)", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "5e550000-0000-4000-8000-000000000001", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1",
          status: "pre_session", is_first_session: false,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });

    let callIndex = 0;
    const responses: Array<{ rows: unknown[] } | Error> = [
      { rows: [] }, // BEGIN
      {
        rows: [{
          id: "session-topic-1", topic_id: "topic-catalog-1",
          topic_name: "Production Code", topic_prompt: "prompt",
          vote_type: "finger", first_session_description: null,
        }],
      }, // SELECT first topic
      { rows: [{ voting_started_at: new Date("2026-09-08T00:00:00Z") }] }, // UPDATE sessions succeeds
      new Error("simulated failure before session_topics UPDATE commits"), // UPDATE session_topics fails
    ];
    const mockClientQuery = vi.fn((..._args: unknown[]) => {
      const resp = responses[callIndex] ?? { rows: [] };
      callIndex++;
      if (resp instanceof Error) return Promise.reject(resp);
      return Promise.resolve(resp);
    });
    const client = { query: mockClientQuery, release: vi.fn() };
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/begin-voting" });

    // The handler rethrows after ROLLBACK — Fastify surfaces this as a 500,
    // not a partial success.
    expect(res.statusCode).toBe(500);
    const rollbackCall = client.query.mock.calls.find((call) => call[0] === "ROLLBACK");
    expect(rollbackCall).toBeDefined();
    const commitCall = client.query.mock.calls.find((call) => call[0] === "COMMIT");
    expect(commitCall).toBeUndefined();
    // Neither the reveal-write style publish nor a partial response ever ran.
    expect(mockPublishSessionStateChange).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Task 8.1/8.2 (remove-topic, design.md Decision 8) — the zero-active-topics
  // crash fix. Previously an unhandled `throw new Error(...)` inside the
  // transaction, surfaced as an unhandled 500; now a clean 409 with no
  // sessions.status transition.
  // -------------------------------------------------------------------------
  it("returns a clean 409 (not an unhandled 500) when the session has no session_topics row at display_order 1", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "5e550000-0000-4000-8000-000000000001", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1",
          status: "pre_session", is_first_session: false,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // SELECT first topic — no session_topics row at display_order 1
      { rows: [] }, // ROLLBACK
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/begin-voting" });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.category).toBe("invalid_request");
    expect(body.error.message).toBe(
      "This session has no topics configured and cannot begin voting.",
    );
    expect(body.error.code).toBeUndefined();

    const rollbackCall = client.query.mock.calls.find((call) => call[0] === "ROLLBACK");
    expect(rollbackCall).toBeDefined();
    const updateSessionsCall = client.query.mock.calls.find((call) =>
      (call[0] as string).toLowerCase().includes("update sessions"),
    );
    expect(updateSessionsCall).toBeUndefined();
    expect(mockPublishSessionStateChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/sessions/:sessionId/action-items-review
// (pre-session-action-item-review, tasks.md 3.5/3.6)
// ---------------------------------------------------------------------------
describe("GET /api/v1/sessions/:sessionId/action-items-review", () => {
  beforeEach(() => vi.clearAllMocks());

  it("authorized participant success: 200 with the team's action items and isFacilitator: false", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "participant",
      sessionId: "5e550000-0000-4000-8000-000000000001",
      teamId: "11111111-1111-4111-8111-111111111111",
      actorGlobalRole: "engineer",
    });
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ status: "pre_session" }] }) // session-status gate
      .mockResolvedValueOnce({
        rows: [
          {
            action_item_id: "ai-1",
            description: "Fix flaky test",
            owner_user_id: "user-1",
            owner_display_name: "Alice",
            status: "open",
            originating_session_id: "session-old-1",
            originating_session_number: 3,
            created_at: new Date("2026-01-01T00:00:00Z"),
            updated_at: new Date("2026-01-01T00:00:00Z"),
            sessions_since_update: "1",
          },
        ],
      }); // action items query

    const app = await buildApp("participant-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/action-items-review",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.isFacilitator).toBe(false);
    expect(body.actionItems).toHaveLength(1);
    expect(body.actionItems[0].stalenessLevel).toBe("yellow");
    expect(mockEvaluateSessionSubscriberAccess).toHaveBeenCalledWith("participant-1", "5e550000-0000-4000-8000-000000000001");
  });

  it("authorized facilitator success: 200 with the same action items and isFacilitator: true", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "facilitator",
      sessionId: "5e550000-0000-4000-8000-000000000001",
      teamId: "11111111-1111-4111-8111-111111111111",
      sessionStatus: "pre_session",
      actorGlobalRole: "facilitator",
    });
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ status: "pre_session" }] })
      .mockResolvedValueOnce({ rows: [] }); // no open items

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/action-items-review",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.isFacilitator).toBe(true);
    expect(body.actionItems).toEqual([]);
  });

  it("no-grant: returns 404, identical shape whether the session is missing or the caller has no standing", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce(null);

    const app = await buildApp("stranger-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/action-items-review",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.category).toBe("not_found");
    // No session-status query or action-items query is reached past a null grant.
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it("Engineering Manager: 404, inherited from evaluateSessionSubscriberAccess's own no-EM-grant behavior", async () => {
    // evaluateSessionSubscriberAccess is mocked directly here, so this test
    // asserts the route's own behavior on a null grant — the EM exclusion
    // itself is verified in session-subscriber-access-helper's own test suite.
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce(null);

    const app = await buildApp("em-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/action-items-review",
    });

    expect(res.statusCode).toBe(404);
  });

  it("wrong session status (lobby): 409 with currentSessionStatus and isFacilitator", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "facilitator",
      sessionId: "5e550000-0000-4000-8000-000000000001",
      teamId: "11111111-1111-4111-8111-111111111111",
      sessionStatus: "lobby",
      actorGlobalRole: "facilitator",
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ status: "lobby" }] });

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/action-items-review",
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.currentSessionStatus).toBe("lobby");
    expect(body.isFacilitator).toBe(true);
  });

  it("wrong session status (active): 409 with currentSessionStatus and isFacilitator: false for a participant", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "participant",
      sessionId: "5e550000-0000-4000-8000-000000000001",
      teamId: "11111111-1111-4111-8111-111111111111",
      actorGlobalRole: "engineer",
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ status: "active" }] });

    const app = await buildApp("participant-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/action-items-review",
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.currentSessionStatus).toBe("active");
    expect(body.isFacilitator).toBe(false);
  });

  it("response shape: 200 body carries only actionItems and isFacilitator for both grant paths", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "participant",
      sessionId: "5e550000-0000-4000-8000-000000000001",
      teamId: "11111111-1111-4111-8111-111111111111",
      actorGlobalRole: "engineer",
    });
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ status: "pre_session" }] })
      .mockResolvedValueOnce({ rows: [] });

    const app = await buildApp("participant-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/action-items-review",
    });

    expect(Object.keys(res.json()).sort()).toEqual(["actionItems", "isFacilitator"]);
  });
});

// ---------------------------------------------------------------------------
// GET .../action-items-review — F1/F2 cross-cutting regression coverage
// (tasks.md 3.6, narrowed per task-review architect finding #4): with
// applyTimingFloor()/Cache-Control already applied inline in each response
// path, this covers only what needs all three response paths to exist —
// that the floor is invoked, unconditionally, on every path (the timing
// floor's own padding behavior is covered generically by
// content/timing-oracle.test.ts), and that no-store is set on every path.
// ---------------------------------------------------------------------------
describe("GET .../action-items-review — F1/F2 regression coverage (tasks.md 3.6)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("applies the timing floor on the 404 path", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce(null);
    const app = await buildApp("stranger-1");
    const res = await app.inject({ method: "GET", url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/action-items-review" });

    expect(res.statusCode).toBe(404);
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
    expect(mockApplyTimingFloor).toHaveBeenCalledWith(expect.any(Number));
  });

  it("applies the timing floor on the 409 path", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "participant", sessionId: "5e550000-0000-4000-8000-000000000001", teamId: "11111111-1111-4111-8111-111111111111", actorGlobalRole: "engineer",
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ status: "active" }] });
    const app = await buildApp("participant-1");
    const res = await app.inject({ method: "GET", url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/action-items-review" });

    expect(res.statusCode).toBe(409);
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
    expect(mockApplyTimingFloor).toHaveBeenCalledWith(expect.any(Number));
  });

  it("applies the timing floor on the 200 path", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "participant", sessionId: "5e550000-0000-4000-8000-000000000001", teamId: "11111111-1111-4111-8111-111111111111", actorGlobalRole: "engineer",
    });
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ status: "pre_session" }] })
      .mockResolvedValueOnce({ rows: [] });
    const app = await buildApp("participant-1");
    const res = await app.inject({ method: "GET", url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/action-items-review" });

    expect(res.statusCode).toBe(200);
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
    expect(mockApplyTimingFloor).toHaveBeenCalledWith(expect.any(Number));
  });

  it("sets Cache-Control: no-store on the 404, 409, and 200 response codes", async () => {
    // 404
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce(null);
    const app1 = await buildApp("stranger-1");
    const res404 = await app1.inject({ method: "GET", url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/action-items-review" });
    expect(res404.headers["cache-control"]).toBe("no-store");

    // 409
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "participant", sessionId: "5e550000-0000-4000-8000-000000000001", teamId: "11111111-1111-4111-8111-111111111111", actorGlobalRole: "engineer",
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ status: "lobby" }] });
    const app2 = await buildApp("participant-1");
    const res409 = await app2.inject({ method: "GET", url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/action-items-review" });
    expect(res409.headers["cache-control"]).toBe("no-store");

    // 200
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "participant", sessionId: "5e550000-0000-4000-8000-000000000001", teamId: "11111111-1111-4111-8111-111111111111", actorGlobalRole: "engineer",
    });
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ status: "pre_session" }] })
      .mockResolvedValueOnce({ rows: [] });
    const app3 = await buildApp("participant-1");
    const res200 = await app3.inject({ method: "GET", url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/action-items-review" });
    expect(res200.headers["cache-control"]).toBe("no-store");
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/sessions/:sessionId/participants-roster
// (participant-readiness-roster, design.md Decision D5, tasks.md 2.1-2.3)
// ---------------------------------------------------------------------------
describe("GET /api/v1/sessions/:sessionId/participants-roster", () => {
  beforeEach(() => vi.clearAllMocks());

  it("facilitator success: 200 with the roster, alphabetically ordered", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "facilitator",
      sessionId: "5e550000-0000-4000-8000-000000000001",
      teamId: "11111111-1111-4111-8111-111111111111",
      sessionStatus: "lobby",
      actorGlobalRole: "facilitator",
    });
    mockDbQuery.mockResolvedValueOnce({
      rows: [
        { user_id: "user-1", display_name: "Alice" },
        { user_id: "user-2", display_name: "Bob" },
      ],
    });

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/participants-roster",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      participants: [
        { userId: "user-1", displayName: "Alice" },
        { userId: "user-2", displayName: "Bob" },
      ],
    });
  });

  it("empty roster: 200 with an empty participants array when no one has joined yet", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "facilitator",
      sessionId: "5e550000-0000-4000-8000-000000000001",
      teamId: "11111111-1111-4111-8111-111111111111",
      sessionStatus: "lobby",
      actorGlobalRole: "facilitator",
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/participants-roster",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ participants: [] });
  });

  it("no-grant caller: 404, identical shape whether the session is missing or the caller has no standing", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce(null);

    const app = await buildApp("stranger-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/participants-roster",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.category).toBe("not_found");
    // No roster query is reached past a null/non-facilitator grant.
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  // Security review Finding 2 (design.md D5's correction), caller-level
  // authorization: a legitimately-registered Engineer participant, calling
  // this endpoint with their OWN valid `participant` grant, gets the SAME
  // 404 a stranger gets -- not a filtered/degraded 200. This is distinct
  // from the row-level EM-filtering test below; a suite covering only that
  // one could pass while this gap ships.
  it("participant-grant caller: 404, not a filtered 200 (caller-level authorization, security review Finding 2)", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "participant",
      sessionId: "5e550000-0000-4000-8000-000000000001",
      teamId: "11111111-1111-4111-8111-111111111111",
      actorGlobalRole: "engineer",
    });

    const app = await buildApp("participant-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/participants-roster",
    });

    expect(res.statusCode).toBe(404);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  // Security review Finding 2, row-level content filtering: the roster
  // query itself excludes an EM who somehow has a session_participants row
  // -- verified here by asserting the query text carries the EM-exclusion
  // predicate the mocked DB call would apply in a real database.
  it("row-level filtering: the roster query excludes engineering_manager rows", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "facilitator",
      sessionId: "5e550000-0000-4000-8000-000000000001",
      teamId: "11111111-1111-4111-8111-111111111111",
      sessionStatus: "lobby",
      actorGlobalRole: "facilitator",
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ user_id: "user-1", display_name: "Alice" }] });

    const app = await buildApp("facilitator-1");
    await app.inject({
      method: "GET",
      url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/participants-roster",
    });

    const [sql] = mockDbQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("engineering_manager");
    expect(sql).toContain("tm.removed_at IS NULL");
    expect(sql).toContain("tm.user_id IS NOT NULL");
  });

  it("applies the timing floor and Cache-Control: no-store on both the 404 and 200 paths (security review Finding 4)", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce(null);
    const app1 = await buildApp("stranger-1");
    const res404 = await app1.inject({ method: "GET", url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/participants-roster" });
    expect(res404.headers["cache-control"]).toBe("no-store");

    mockEvaluateSessionSubscriberAccess.mockResolvedValueOnce({
      path: "facilitator", sessionId: "5e550000-0000-4000-8000-000000000001", teamId: "11111111-1111-4111-8111-111111111111", sessionStatus: "lobby", actorGlobalRole: "facilitator",
    });
    mockDbQuery.mockResolvedValueOnce({ rows: [] });
    const app2 = await buildApp("facilitator-1");
    const res200 = await app2.inject({ method: "GET", url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/participants-roster" });
    expect(res200.headers["cache-control"]).toBe("no-store");

    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// configurable-oidc-role-map (#243), design D11, task 2.2 (E3 grant reuse, E4).
// The admin-caller cases run the REAL evaluateSessionSubscriberAccess over the
// mocked db, so they fail if the helper ever grants an admin participant
// access (a stubbed null grant would make them vacuous).
// ---------------------------------------------------------------------------
describe("D11: application_admin exclusion on grant-reusing session endpoints", () => {
  const SESSION = "5e550000-0000-4000-8000-000000000001";
  const ADMIN_PARTICIPANT_ROW = {
    session_id: SESSION, team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1",
    session_status: "pre_session", global_role: "application_admin", participant_row_id: "p1",
    membership_role: "participant", membership_removed_at: null, membership_exists: true,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbQuery.mockReset();
    const actual = await vi.importActual<typeof SubscriberAccessHelperModule>(
      "../../auth/session-subscriber-access-helper.js",
    );
    mockEvaluateSessionSubscriberAccess.mockImplementation((userId: string, sessionId: string) =>
      actual.evaluateSessionSubscriberAccess(userId, sessionId),
    );
  });

  afterEach(() => {
    mockEvaluateSessionSubscriberAccess.mockReset();
  });

  it("an admin caller with a participant row is denied at action-items-review as a no-grant caller (404)", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [ADMIN_PARTICIPANT_ROW] });

    const app = await buildApp("admin-1");
    const res = await app.inject({ method: "GET", url: `/api/v1/sessions/${SESSION}/action-items-review` });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.category).toBe("not_found");
    expect(mockDbQuery).toHaveBeenCalledTimes(1); // only the grant query
  });

  it("an admin caller with a participant row is denied at participants-roster as a no-grant caller (404)", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [ADMIN_PARTICIPANT_ROW] });

    const app = await buildApp("admin-1");
    const res = await app.inject({ method: "GET", url: `/api/v1/sessions/${SESSION}/participants-roster` });

    expect(res.statusCode).toBe(404);
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it("the roster query excludes application_admin rows (E4)", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ ...ADMIN_PARTICIPANT_ROW, facilitator_id: "facilitator-1", global_role: "facilitator", participant_row_id: null, session_status: "lobby" }] })
      .mockResolvedValueOnce({ rows: [] });

    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "GET", url: `/api/v1/sessions/${SESSION}/participants-roster` });

    expect(res.statusCode).toBe(200);
    const [sql] = mockDbQuery.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/u\.global_role != 'application_admin'/);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/teams/:teamId/sessions/:sessionId/complete (Task 8.8)
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/sessions/:sessionId/complete", () => {
  beforeEach(() => vi.clearAllMocks());

  // Task 8.8: Session completion sets facilitator_access_expires_at in same transaction
  it("transitions wrap_up to complete and sets facilitator_access_expires_at", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "5e550000-0000-4000-8000-000000000001",
          team_id: "11111111-1111-4111-8111-111111111111",
          facilitator_id: "facilitator-1",
          status: "wrap_up",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] }); // actor global_role lookup

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // UPDATE sessions with facilitator_access_expires_at
      { rows: [] }, // INSERT audit_log (session.state_changed)
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/5e550000-0000-4000-8000-000000000001/complete",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("complete");

    // Verify the UPDATE SQL sets facilitator_access_expires_at (Task 8.8)
    const updateCall = client.query.mock.calls[1]!;
    const updateSql = (updateCall[0] as string).toLowerCase();
    expect(updateSql).toContain("facilitator_access_expires_at");
    expect(updateSql).toContain("interval '30 minutes'");
    expect(updateSql).toContain("'complete'");

    const auditInsertCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditInsertCall![1]).toContain("session.state_changed");

    expect(mockPublishSessionStateChange).toHaveBeenCalledWith(
      "5e550000-0000-4000-8000-000000000001",
      expect.objectContaining({ previousStatus: "wrap_up", newStatus: "complete" }),
    );
  });

  // Task 8.11: facilitator_access_expires_at cannot be set by client input
  it("the complete endpoint does not accept facilitator_access_expires_at in request body", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "5e550000-0000-4000-8000-000000000001",
          team_id: "11111111-1111-4111-8111-111111111111",
          facilitator_id: "facilitator-1",
          status: "wrap_up",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [] }, // UPDATE
      { rows: [] }, // INSERT audit_log
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    // Attempt to supply facilitator_access_expires_at in the request body
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/5e550000-0000-4000-8000-000000000001/complete",
      payload: { facilitatorAccessExpiresAt: "9999-12-31T00:00:00Z" }, // should be ignored
    });

    // The request succeeds (200) but the server ignores the client-supplied value
    expect(res.statusCode).toBe(200);

    // Verify the UPDATE SQL does NOT use any parameter for expires_at from client input
    const updateCall = client.query.mock.calls[1]!;
    const updateValues = updateCall[1] as unknown[];
    // The only parameter should be the session ID — expires_at is computed server-side
    expect(updateValues).toHaveLength(1);
    expect(updateValues[0]).toBe("5e550000-0000-4000-8000-000000000001");
  });

  it("returns 422 when session is not in wrap_up status", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "5e550000-0000-4000-8000-000000000001",
        team_id: "11111111-1111-4111-8111-111111111111",
        facilitator_id: "facilitator-1",
        status: "active", // not wrap_up
      }],
    });

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/5e550000-0000-4000-8000-000000000001/complete",
    });

    expect(res.statusCode).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/teams/:teamId/sessions/:sessionId/reveal — the reveal write
// (session-lifecycle-transitions design.md Decision D2/D3, tasks.md 3.8-3.13)
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/sessions/:sessionId/reveal — reveal write", () => {
  beforeEach(() => vi.clearAllMocks());

  // tasks.md 3.8
  it("3.8: successful reveal transitions the topic to revealed, writes one audit row, publishes one event", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1",
          status: "active", current_topic_id: "topic-1",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ id: "session-topic-1", revealed_at: new Date("2026-09-08T00:00:00Z") }], rowCount: 1 }, // conditional UPDATE
      { rows: [] }, // INSERT audit_log (recordRevealTriggeredAudit)
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/sess-1/reveal",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().revealed).toBe(true);

    const updateCall = client.query.mock.calls[1]!;
    expect((updateCall[0] as string).toLowerCase()).toContain("update session_topics");
    expect((updateCall[0] as string).toLowerCase()).toContain("status = 'revealed'");
    expect(updateCall[1]).toEqual(["sess-1", "topic-1"]);

    const auditInsertCalls = client.query.mock.calls.filter((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditInsertCalls).toHaveLength(1);
    expect(auditInsertCalls[0]![1]).toContain("session.reveal_triggered");

    expect(mockPublishVoteRevealed).toHaveBeenCalledTimes(1);
    expect(mockPublishVoteRevealed).toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({
        sessionId: "sess-1",
        sessionStatus: "active",
        // FR-4.6.1 (websocket-specification Decision D2): stamped here,
        // once, after the transaction above commits.
        serverTimestamp: expect.any(String),
      }),
    );
  });

  // tasks.md 3.9
  it("3.9: a second reveal on an already-revealed topic returns 409/already_revealed, no extra audit row or publish", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1",
          status: "active", current_topic_id: "topic-1",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      // follow-up read (Decision D2) to populate the already_revealed response
      .mockResolvedValueOnce({
        rows: [{ id: "session-topic-1", revealed_at: new Date("2026-09-08T00:00:00Z") }],
      });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [], rowCount: 0 }, // conditional UPDATE — already revealed, zero rows affected
      { rows: [] }, // ROLLBACK
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/sess-1/reveal",
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.errorState).toBe("already_revealed");
    expect(body.sessionTopicId).toBe("session-topic-1");
    expect(body.revealedAt).toBe("2026-09-08T00:00:00.000Z");

    const auditInsertCalls = client.query.mock.calls.filter((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditInsertCalls).toHaveLength(0);
    expect(mockPublishVoteRevealed).not.toHaveBeenCalled();

    const commitCall = client.query.mock.calls.find((call) => call[0] === "COMMIT");
    expect(commitCall).toBeUndefined();
    const rollbackCall = client.query.mock.calls.find((call) => call[0] === "ROLLBACK");
    expect(rollbackCall).toBeDefined();
  });

  // tasks.md 3.10 — this codebase's established concurrency-test convention
  // (see teams.test.ts's zero-participant race test) simulates the DB-level
  // row lock at the mock-response level, since the test suite mocks the pg
  // client rather than running against a real Postgres: the first reveal's
  // conditional UPDATE affects one row (it wins the lock); the second
  // reveal's conditional UPDATE — modeling the request that had to wait for
  // the first transaction's lock and then re-evaluates against the
  // now-committed 'revealed' row — affects zero rows. Requests are issued
  // sequentially (not via Promise.all) so each one's DB calls consume the
  // mock queue in a known order — Promise.all against a single shared mock
  // queue would interleave the two requests' calls nondeterministically,
  // which is a property of the test double, not of the real row lock this
  // test is asserting.
  it("3.10: of two concurrent reveal requests for the same topic, exactly one commits and exactly one event publishes", async () => {
    mockDbQuery
      // First request
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1",
          status: "active", current_topic_id: "topic-1",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      // Second request
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1",
          status: "active", current_topic_id: "topic-1",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      // Second request's follow-up read after losing the race
      .mockResolvedValueOnce({
        rows: [{ id: "session-topic-1", revealed_at: new Date("2026-09-08T00:00:00Z") }],
      });

    const winnerClient = makeMockClient([
      { rows: [] },
      { rows: [{ id: "session-topic-1", revealed_at: new Date("2026-09-08T00:00:00Z") }], rowCount: 1 },
      { rows: [] },
      { rows: [] },
    ]);
    const loserClient = makeMockClient([
      { rows: [] },
      { rows: [], rowCount: 0 },
      { rows: [] },
    ]);
    mockDbConnect.mockResolvedValueOnce(winnerClient).mockResolvedValueOnce(loserClient);

    const app = await buildApp("facilitator-1");
    const res1 = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/sess-1/reveal" });
    const res2 = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/sess-1/reveal" });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(409);
    expect(res2.json().errorState).toBe("already_revealed");
    expect(mockPublishVoteRevealed).toHaveBeenCalledTimes(1);
  });

  // tasks.md 3.11 (design.md Decision D5's required test, distinct from 3.10):
  // a lock-in request and a live reveal request racing for the same topic.
  // Models the "reveal commits first" branch — the reveal's transaction
  // commits, and the subsequent lock-in's row lock (sessions.ts) observes
  // the now-'revealed' status and is rejected. The complementary branch (the
  // vote commits and is included in the reveal) is the ordinary
  // lock-in-then-reveal happy path already covered by 3.8 and sessions.test.ts.
  it("3.11: a reveal that commits first causes a concurrently-racing lock-in to be rejected, never inserting a post-reveal vote", async () => {
    // Reveal request
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1",
          status: "active", current_topic_id: "topic-1",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });

    const revealClient = makeMockClient([
      { rows: [] },
      { rows: [{ id: "session-topic-1", revealed_at: new Date("2026-09-08T00:00:00Z") }], rowCount: 1 },
      { rows: [] },
      { rows: [] },
    ]);
    mockDbConnect.mockResolvedValueOnce(revealClient);

    const facilitatorApp = await buildApp("facilitator-1");
    const revealRes = await facilitatorApp.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/sess-1/reveal",
    });
    expect(revealRes.statusCode).toBe(200);

    // Lock-in request for the same topic, arriving after the reveal committed.
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ session_status: "active", team_id: "11111111-1111-4111-8111-111111111111", topic_status: "voting" }],
      }) // pre-transaction check still sees 'voting' (the race window)
      .mockResolvedValueOnce({ rows: [{ global_role: "engineer", membership_role: "participant", membership_removed_at: null, membership_exists: true }] })
      .mockResolvedValueOnce({ rows: [{ id: "sp-1" }] });

    const lockInClient = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ status: "revealed" }] }, // SELECT ... FOR UPDATE — sees the reveal's committed state
      { rows: [] }, // ROLLBACK
    ]);
    mockDbConnect.mockResolvedValueOnce(lockInClient);

    const participantApp = await buildSessionsApp("participant-1");
    const lockInRes = await participantApp.inject({
      method: "POST",
      url: "/api/v1/sessions/sess-1/topics/session-topic-1/lock-in",
      payload: { voteValue: 3, voteType: "finger" },
    });

    expect(lockInRes.statusCode).toBe(422);
    const insertVoteCall = lockInClient.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO votes"),
    );
    expect(insertVoteCall).toBeUndefined();
    expect(mockPublishVoteReadinessUpdate).not.toHaveBeenCalled();
  });

  // tasks.md 3.13 (design.md Decision D3's ordering requirement)
  it("3.13: a non-facilitator's reveal against an already-revealed topic returns the generic 403, never already_revealed", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "sess-1", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "other-facilitator",
        status: "active", current_topic_id: "topic-1",
      }],
    });

    const app = await buildApp("facilitator-1"); // not the session's facilitator
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/sess-1/reveal",
    });

    // Session is live (active), so this is the recoverable 503 auth-failure
    // path — never the already_revealed 409 shape, which the handler never
    // even attempts to compute without first passing authorization.
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.errorState).toBe("reveal_failure");
    expect(body.errorState).not.toBe("already_revealed");
    expect(mockDbConnect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/teams/:teamId/sessions/:sessionId/topics/advance (SESSION-012,
// tasks.md 4.11-4.14)
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/sessions/:sessionId/topics/advance", () => {
  beforeEach(() => vi.clearAllMocks());

  // tasks.md 4.11
  it("4.11: advances to the next topic, updates current_topic_id to topics.id, keeps session active, publishes one topic_history_update", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1",
          status: "active", current_topic_id: "topic-1",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      {
        rows: [{ id: "session-topic-1", topic_name: "Production Code", completed_at: new Date("2026-09-08T00:00:00Z") }],
        rowCount: 1,
      }, // conditional UPDATE (complete current topic)
      {
        rows: [{
          id: "session-topic-2", topic_id: "topic-2",
          topic_name: "Deployment Process", topic_prompt: "How easy is it to deploy?",
          vote_type: "finger",
        }],
      }, // next-topic lookup
      { rows: [] }, // UPDATE session_topics SET status = 'voting'
      { rows: [] }, // UPDATE sessions SET current_topic_id
      { rows: [] }, // INSERT audit_log (session.topic_advanced)
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/sess-1/topics/advance",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("active");
    expect(body.completedTopic.sessionTopicId).toBe("session-topic-1");
    expect(body.currentTopic.sessionTopicId).toBe("session-topic-2");

    // Regression test for the id-space defect: sessions.current_topic_id
    // must receive the next topic's topics.id ("topic-2"), never its
    // session_topics.id ("session-topic-2").
    const updateSessionsCall = client.query.mock.calls[4]!;
    expect((updateSessionsCall[0] as string).toLowerCase()).toContain("update sessions");
    expect(updateSessionsCall[1]).toEqual(["sess-1", "topic-2"]);

    const updateTopicCall = client.query.mock.calls[3]!;
    expect((updateTopicCall[0] as string).toLowerCase()).toContain("update session_topics");
    expect(updateTopicCall[1]).toEqual(["session-topic-2"]);

    const auditInsertCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditInsertCall![1]).toContain("session.topic_advanced");

    // Security review finding: the DB audit_log row alone is not enough —
    // every other state-transition endpoint in this file also emits the
    // structured-log counterpart (emitAuditEvent) for operational alerting.
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "session.topic_advanced",
      expect.objectContaining({
        sessionId: "sess-1",
        teamId: "11111111-1111-4111-8111-111111111111",
        completedSessionTopicId: "session-topic-1",
        newSessionTopicId: "session-topic-2",
      }),
    );

    expect(mockPublishTopicHistoryUpdate).toHaveBeenCalledTimes(1);
    expect(mockPublishTopicHistoryUpdate).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({ teamId: "11111111-1111-4111-8111-111111111111", updateType: "topic_advanced", sessionId: "sess-1", topicId: "topic-2" }),
    );
    expect(mockPublishSessionStateChange).not.toHaveBeenCalled();
  });

  // tasks.md 4.12(1)
  it("4.12: a facilitator of a different session's team is rejected with 403 (team-id cross-check)", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "sess-1", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1",
        status: "active", current_topic_id: "topic-1",
      }],
    });

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/22222222-2222-4222-8222-222222222222/sessions/sess-1/topics/advance", // wrong team
    });

    expect(res.statusCode).toBe(403);
    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  // tasks.md 4.12(2) — mirrors task 3.13's ordering test
  it("4.12: a non-facilitator's advance against a not-yet-revealed topic returns the generic 403, never advance_blocked", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "sess-1", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "other-facilitator",
        status: "active", current_topic_id: "topic-1",
      }],
    });

    const app = await buildApp("facilitator-1"); // not the session's facilitator
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/sess-1/topics/advance",
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.errorState).not.toBe("advance_blocked");
    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  // tasks.md 4.13
  it("4.13: advancing past the final topic transitions to wrap_up, sets wrap_up_started_at, clears current_topic_id, publishes both events", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1",
          status: "active", current_topic_id: "topic-final",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      {
        rows: [{ id: "session-topic-final", topic_name: "Final Topic", completed_at: new Date("2026-09-08T00:00:00Z") }],
        rowCount: 1,
      }, // conditional UPDATE
      { rows: [] }, // next-topic lookup — none found
      { rows: [{ wrap_up_started_at: new Date("2026-09-08T00:05:00Z") }] }, // UPDATE sessions -> wrap_up RETURNING
      { rows: [] }, // INSERT audit_log (session.state_changed)
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/sess-1/topics/advance",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("wrap_up");
    expect(body.wrapUpStartedAt).toBe("2026-09-08T00:05:00.000Z");
    expect(body.currentTopic).toBeUndefined();
    expect(body.completedTopic.sessionTopicId).toBe("session-topic-final");

    const updateSessionsCall = client.query.mock.calls[3]!;
    expect((updateSessionsCall[0] as string).toLowerCase()).toContain("wrap_up");
    expect((updateSessionsCall[0] as string).toLowerCase()).toContain("current_topic_id = null");

    const auditInsertCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditInsertCall![1]).toContain("session.state_changed");
    expect(auditInsertCall![1] as unknown[]).toEqual(
      expect.arrayContaining([expect.stringContaining("completed_session_topic_id")]),
    );

    // Security review finding: the wrap-up-entry branch also needs the
    // structured-log counterpart, matching every other endpoint in this
    // file that writes a session.state_changed audit_log row.
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "session.state_changed",
      expect.objectContaining({
        sessionId: "sess-1",
        teamId: "11111111-1111-4111-8111-111111111111",
        priorStatus: "active",
        newStatus: "wrap_up",
        completedSessionTopicId: "session-topic-final",
      }),
    );

    expect(mockPublishSessionStateChange).toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({ previousStatus: "active", newStatus: "wrap_up" }),
    );
    expect(mockPublishTopicHistoryUpdate).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({ teamId: "11111111-1111-4111-8111-111111111111", updateType: "topic_advanced", sessionId: "sess-1", topicId: "topic-final" }),
    );
  });

  // tasks.md 4.14
  it("4.14: advancing before the current topic is revealed returns 409/advance_blocked, modifies no state", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1",
          status: "active", current_topic_id: "topic-1",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      // follow-up read to populate the blocked response
      .mockResolvedValueOnce({ rows: [{ id: "session-topic-1" }] });

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [], rowCount: 0 }, // conditional UPDATE — current topic is still 'voting', not 'revealed'
      { rows: [] }, // ROLLBACK
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/sess-1/topics/advance",
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.errorState).toBe("advance_blocked");
    expect(body.requiresReveal).toBe(true);
    expect(body.sessionTopicId).toBe("session-topic-1");

    const commitCall = client.query.mock.calls.find((call) => call[0] === "COMMIT");
    expect(commitCall).toBeUndefined();
    expect(mockPublishTopicHistoryUpdate).not.toHaveBeenCalled();
    expect(mockPublishSessionStateChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// recordRevealTriggeredAudit — SEC-13/SEC-14 audit write for the reveal
// action (task 7.2). BLOCKED on GitHub issue #26 for real wiring into the
// reveal handler's own transaction (no such transaction exists yet, because
// the reveal endpoint does not commit a state transition today). This
// function is verified in isolation, against a stubbed commit point, per
// the Blocking Dependency section's testability guidance.
// ---------------------------------------------------------------------------
describe("recordRevealTriggeredAudit (task 7.2 — BLOCKED on #26 for production wiring)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes exactly one audit_log row with operation session.reveal_triggered and the session identifier in metadata", async () => {
    const client = makeMockClient([{ rows: [] }]);
    const logger = { info: vi.fn() } as unknown as FastifyBaseLogger;

    await recordRevealTriggeredAudit(client, logger, {
      actorUserId: "facilitator-1",
      actorGlobalRole: "facilitator",
      actorIp: "127.0.0.1",
      teamId: "11111111-1111-4111-8111-111111111111",
      sessionId: "5e550000-0000-4000-8000-000000000001",
    });

    expect(client.query).toHaveBeenCalledTimes(1);
    const [sql, params] = client.query.mock.calls[0]!;
    expect(sql as string).toContain("INSERT INTO audit_log");
    expect(params).toContain("session.reveal_triggered");
    const metadataArg = (params as unknown[]).find(
      (p) => typeof p === "string" && p.includes("session_id"),
    ) as string;
    expect(JSON.parse(metadataArg)).toEqual({ session_id: "5e550000-0000-4000-8000-000000000001" });
  });

  it("also emits the structured-log counterpart via emitAuditEvent", async () => {
    const client = makeMockClient([{ rows: [] }]);
    const logger = { info: vi.fn() } as unknown as FastifyBaseLogger;

    await recordRevealTriggeredAudit(client, logger, {
      actorUserId: "facilitator-1",
      actorGlobalRole: "facilitator",
      actorIp: "127.0.0.1",
      teamId: "11111111-1111-4111-8111-111111111111",
      sessionId: "5e550000-0000-4000-8000-000000000001",
    });

    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      logger,
      "session.reveal_triggered",
      expect.objectContaining({ sessionId: "5e550000-0000-4000-8000-000000000001", teamId: "11111111-1111-4111-8111-111111111111" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Draft session expiry behavior (Task 8.5, 8.6, 8.7)
//
// These behaviors are enforced by the authorization helper (evaluateTeamAccess)
// at read time, not by this route. The SQL check in the helper uses:
//   status = 'draft' AND created_at + INTERVAL '24 hours' > NOW()
//
// Verification here: the authorization helper test suite covers these cases
// (team-content-access-helper.test.ts: "draft session within 24 hours",
// "draft session older than 24 hours").
//
// Task 8.5: Facilitator with draft session within 24h can access historical data
// → Verified by team-content-access-helper.test.ts: "draft session within 24 hours"
//   and content.test.ts: "returns 200 for facilitator with no-store header"
//
// Task 8.6: Facilitator with expired draft session receives 403
// → Verified by team-content-access-helper.test.ts: "draft session older than 24 hours"
//
// Task 8.7: Deleting draft session ends facilitator's access
// → Covered by the SQL check failing when no qualifying session row exists.
// ---------------------------------------------------------------------------
describe("Draft session expiry (Task 8.5, 8.6, 8.7) — documented reference", () => {
  it("expiry enforcement is documented: lazy expiry via SQL check in authorization helper", () => {
    // The authorization helper (team-content-access-helper.ts) enforces draft
    // session expiry via the SQL condition:
    //   status = 'draft' AND created_at + INTERVAL '24 hours' > NOW()
    //
    // This is Decision 3 from design.md — no background task required.
    // Tests for the specific boundary conditions are in:
    //   __tests__/team-content-access-helper.test.ts
    expect(true).toBe(true); // documentation-only test
  });
});

// ---------------------------------------------------------------------------
// Grace window behavior (Task 8.9, 8.10)
//
// Verified by authorization helper tests:
//   "within the grace window" → facilitator grant (200 on content endpoints)
//   "grace window expired" → null grant (403 on content endpoints)
// ---------------------------------------------------------------------------
describe("Grace window behavior (Task 8.9, 8.10) — documented reference", () => {
  it("grace window enforcement is documented: lazy expiry via SQL check in authorization helper", () => {
    // The authorization helper enforces the grace window via:
    //   status = 'complete' AND facilitator_access_expires_at > NOW()
    //
    // Tests for boundary conditions are in:
    //   __tests__/team-content-access-helper.test.ts
    // Task 8.9: Facilitator within grace window can READ (gets facilitator grant)
    // Task 8.10: Facilitator outside grace window receives 403 (null grant)
    expect(true).toBe(true); // documentation-only test
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/teams/:teamId/sessions/:sessionId/facilitator-state
//
// cross-team-facilitator-constraint task 3.1 — demonstrates there is no
// mechanism that re-evaluates or invalidates an existing session record in
// response to a later team_memberships change: this handler's only query is
// against `sessions`, with no team_memberships reference anywhere in it.
// Backs session-creation/spec.md's "does not invalidate the existing
// session record" scenario.
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/:teamId/sessions/:sessionId/facilitator-state", () => {
  beforeEach(() => vi.clearAllMocks());

  // join-link-redemption-wiring, tasks.md Task 2.5: joinToken is now sourced
  // via get-or-create from a real join_links row, not sessions.join_token
  // (dropped from this handler's SELECT in Task 2.3/4.3).
  it("reflects the mocked session row unchanged, sources joinToken via get-or-create, and issues no team_memberships query", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "5e550000-0000-4000-8000-000000000001",
            team_id: "11111111-1111-4111-8111-111111111111",
            facilitator_id: "facilitator-1",
            status: "active",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ token: "active-join-token" }] }); // get-or-create: reuse active join_links row

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/5e550000-0000-4000-8000-000000000001/facilitator-state",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessionId).toBe("5e550000-0000-4000-8000-000000000001");
    expect(body.teamId).toBe("11111111-1111-4111-8111-111111111111");
    expect(body.currentSessionState).toBe("active");
    expect(body.bannerState).toBeNull();
    expect(body.joinToken).toBe("active-join-token");

    const teamMembershipsCall = mockDbQuery.mock.calls.find((call) =>
      (call[0] as string).includes("team_memberships"),
    );
    expect(teamMembershipsCall).toBeUndefined();
  });

  // session-topics-snapshot-at-creation design.md Decision 6: activeTopicCount.
  it("a draft session carries activeTopicCount as a number, counted for the session row's team", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ id: "5e550000-0000-4000-8000-000000000001", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1", status: "draft" }],
      })
      .mockResolvedValueOnce({ rows: [{ token: "active-join-token" }] }) // get-or-create reuse
      .mockResolvedValueOnce({ rows: [{ count: 9 }] }); // active topic count

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/5e550000-0000-4000-8000-000000000001/facilitator-state",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().activeTopicCount).toBe(9);
    expect(typeof res.json().activeTopicCount).toBe("number");
    const countCall = mockDbQuery.mock.calls.find((c) => (c[0] as string).includes("count(*)::int"));
    expect(countCall![0]).toContain("FROM topics WHERE team_id = $1 AND status = 'active'");
    expect(countCall![1]).toEqual(["11111111-1111-4111-8111-111111111111"]);
  });

  it("a draft whose team has no active topics reports activeTopicCount: 0, and a string count is coerced to a number", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ id: "5e550000-0000-4000-8000-000000000001", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1", status: "draft" }],
      })
      .mockResolvedValueOnce({ rows: [{ token: "active-join-token" }] })
      .mockResolvedValueOnce({ rows: [{ count: "0" }] });

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/5e550000-0000-4000-8000-000000000001/facilitator-state",
    });

    expect(res.json().activeTopicCount).toBe(0);
  });

  it.each(["lobby", "pre_session", "active", "wrap_up"])(
    "a %s session omits activeTopicCount and issues no count query",
    async (status) => {
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [{ id: "5e550000-0000-4000-8000-000000000001", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1", status }],
        })
        .mockResolvedValueOnce({ rows: [{ token: "active-join-token" }] });

      const app = await buildApp("facilitator-1");
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/5e550000-0000-4000-8000-000000000001/facilitator-state",
      });

      expect(res.json()).not.toHaveProperty("activeTopicCount");
      expect(mockDbQuery.mock.calls.some((c) => (c[0] as string).includes("count(*)"))).toBe(false);
    },
  );

  // join-link-redemption-wiring, tasks.md Task 2.3/2.4: the miss-path
  // actor_global_role SELECT (SELECT global_role FROM users WHERE id = $1)
  // fires only when get-or-create is about to create a new join_links row,
  // never on the common reuse path exercised above.
  it("issues no SELECT global_role query when an active join_links row already exists (reuse path)", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "5e550000-0000-4000-8000-000000000001",
            team_id: "11111111-1111-4111-8111-111111111111",
            facilitator_id: "facilitator-1",
            status: "active",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ token: "active-join-token" }] });

    const app = await buildApp("facilitator-1");
    await app.inject({
      method: "GET",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/5e550000-0000-4000-8000-000000000001/facilitator-state",
    });

    const globalRoleCall = mockDbQuery.mock.calls.find((call) =>
      (call[0] as string).includes("SELECT global_role"),
    );
    expect(globalRoleCall).toBeUndefined();
  });

  // join-link-redemption-wiring, tasks.md Task 2.3/2.4: on a miss, this
  // handler resolves actor_global_role via a fresh SELECT (no such value is
  // otherwise in scope here), then invokes the shared createJoinLink helper.
  it("on a miss, resolves actor_global_role via a fresh SELECT and creates a new join_links row via the shared audited helper", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "5e550000-0000-4000-8000-000000000001",
            team_id: "11111111-1111-4111-8111-111111111111",
            facilitator_id: "facilitator-1",
            status: "active",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // get-or-create: no active row
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] }); // miss-path actor_global_role lookup

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      {
        rows: [
          {
            id: "link-1",
            team_id: "11111111-1111-4111-8111-111111111111",
            token: "new-join-token",
            created_at: new Date("2026-01-01"),
            expires_at: new Date("2026-01-08"),
          },
        ],
      }, // INSERT INTO join_links
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/5e550000-0000-4000-8000-000000000001/facilitator-state",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().joinToken).toBe("new-join-token");

    const globalRoleCall = mockDbQuery.mock.calls.find((call) =>
      (call[0] as string).includes("SELECT global_role"),
    );
    expect(globalRoleCall).toBeDefined();
    expect((globalRoleCall as unknown[])[1]).toEqual(["facilitator-1"]);

    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "join.link_created",
      expect.objectContaining({ teamId: "11111111-1111-4111-8111-111111111111", linkId: "link-1" }),
    );
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/teams/eligible-for-session
//
// session-creation-existing-team, design.md Decision D2. tasks.md Section 3.
// ---------------------------------------------------------------------------
describe("GET /api/v1/teams/eligible-for-session", () => {
  beforeEach(() => vi.clearAllMocks());

  // task 3.5
  it("3.5: returns 403 when actor is not a facilitator", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/eligible-for-session" });

    expect(res.statusCode).toBe(403);
  });

  // task 3.6
  it("3.6: facilitator with eligible teams returns 200 with the correct team list", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] }) // actor check
      .mockResolvedValueOnce({
        rows: [
          { team_id: "22222222-2222-4222-8222-222222222222", team_name: "Team Two", last_session_at: new Date("2026-08-01T00:00:00Z") },
        ],
      }) // eligible query
      .mockResolvedValueOnce({ rows: [{ exists: true }] }); // callerHasTeamMemberships

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/eligible-for-session" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.eligibleTeams).toEqual([
      { teamId: "22222222-2222-4222-8222-222222222222", teamName: "Team Two", lastSessionAt: "2026-08-01T00:00:00.000Z" },
    ]);
  });

  // task 3.7 — dddddddd-dddd-4ddd-8ddd-dddddddddddd exclusion lives in the query's WHERE clause
  // (deactivated_at IS NULL); this test documents that contract at the
  // handler level by asserting the query text, since the mock DB layer
  // cannot itself enforce a WHERE predicate.
  it("3.7: the eligibility query excludes deactivated teams via its WHERE clause", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ exists: false }] });

    const app = await buildApp();
    await app.inject({ method: "GET", url: "/api/v1/teams/eligible-for-session" });

    const eligibleQueryCall = mockDbQuery.mock.calls.find((call) =>
      (call[0] as string).includes("FROM teams"),
    );
    expect(eligibleQueryCall).toBeDefined();
    expect(eligibleQueryCall![0] as string).toContain("deactivated_at IS NULL");
  });

  // template-team-not-usable (#214) tasks.md 3.1: the template team is
  // excluded by binding the shared DEFAULT_TOPICS_TEAM_ID constant as $2,
  // never by a UUID literal or by name in the SQL text. Also covers the
  // "fresh install where the template is the only team" scenario at the
  // handler level: with the template excluded, the query returns no row and
  // the response is the zero-home-team empty list.
  it("#214 3.1: the eligibility query excludes the template by a bound parameter, and an empty result is 200 []", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ exists: false }] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/eligible-for-session" });

    const eligibleQueryCall = mockDbQuery.mock.calls.find((call) =>
      (call[0] as string).includes("FROM teams"),
    );
    expect(eligibleQueryCall).toBeDefined();
    const [sql, params] = eligibleQueryCall as [string, unknown[]];
    expect(sql).toContain("t.id <> $2");
    expect(params[1]).toBe(DEFAULT_TOPICS_TEAM_ID);
    expect(sql).not.toContain(DEFAULT_TOPICS_TEAM_ID);
    expect(sql).not.toContain("__default_topics__");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ eligibleTeams: [], callerHasTeamMemberships: false });
  });

  // cross-team-facilitator-constraint task 1.1 — the eligibility query
  // excludes the caller's own active team memberships via this LEFT
  // JOIN/WHERE shape; asserted at the query-text level for the same reason
  // as 3.7 above (the mocked DB layer doesn't evaluate WHERE clauses).
  it("the eligibility query excludes the caller's own team memberships via its WHERE clause", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ exists: false }] });

    const app = await buildApp();
    await app.inject({ method: "GET", url: "/api/v1/teams/eligible-for-session" });

    const eligibleQueryCall = mockDbQuery.mock.calls.find((call) =>
      (call[0] as string).includes("FROM teams"),
    );
    expect(eligibleQueryCall).toBeDefined();
    expect(eligibleQueryCall![0] as string).toContain("LEFT JOIN team_memberships");
    expect(eligibleQueryCall![0] as string).toContain("WHERE tm.id IS NULL");
    // facilitator-session-entry-point (#237), task 3.4, spec R5 server half:
    // the exclusion has no membership-role predicate, so a facilitator's
    // engineering_manager membership excludes that team like any other role.
    // Regression guard, expected to pass at once.
    expect(eligibleQueryCall![0] as string).not.toMatch(/tm\.role|membership_role/);
  });

  // task 3.8
  it("3.8: facilitator with zero team memberships returns 200, full eligible list, callerHasTeamMemberships: false", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      .mockResolvedValueOnce({
        rows: [{ team_id: "11111111-1111-4111-8111-111111111111", team_name: "Team One", last_session_at: null }],
      })
      .mockResolvedValueOnce({ rows: [{ exists: false }] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/eligible-for-session" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.callerHasTeamMemberships).toBe(false);
    expect(body.eligibleTeams).toHaveLength(1);
  });

  // task 3.9
  it("3.9: facilitator with a home team and zero eligible targets returns 200, empty array, callerHasTeamMemberships: true", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ exists: true }] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/eligible-for-session" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.eligibleTeams).toEqual([]);
    expect(body.callerHasTeamMemberships).toBe(true);
  });

  // task 3.10
  it("3.10: a team whose most recent session is draft or lobby reports lastSessionAt from its last completed session, or null", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      .mockResolvedValueOnce({
        rows: [
          { team_id: "33333333-3333-4333-8333-333333333333", team_name: "Team Three", last_session_at: null },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ exists: false }] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/eligible-for-session" });

    const body = res.json();
    expect(body.eligibleTeams[0].lastSessionAt).toBeNull();

    // The query itself sources last_session_at only from status = 'complete'
    // sessions (design.md D2) — a live draft/lobby session's timestamp is
    // never read for this field, regardless of how recent it is.
    const eligibleQueryCall = mockDbQuery.mock.calls.find((call) =>
      (call[0] as string).includes("FROM teams"),
    );
    expect(eligibleQueryCall![0] as string).toContain("s.status = 'complete'");
  });

  // task 3.11
  it("3.11: a global_role downgrade between two calls is reflected on the very next call", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ exists: false }] });

    const app = await buildApp();
    const res1 = await app.inject({ method: "GET", url: "/api/v1/teams/eligible-for-session" });
    expect(res1.statusCode).toBe(200);

    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] });
    const res2 = await app.inject({ method: "GET", url: "/api/v1/teams/eligible-for-session" });
    expect(res2.statusCode).toBe(403);
  });

  // task 3.12
  it("3.12: a team with a live non-terminal session and no membership row still appears in eligibleTeams, unfiltered by session status", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      .mockResolvedValueOnce({
        rows: [
          { team_id: "team-live", team_name: "Team Live", last_session_at: null },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ exists: true }] });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/teams/eligible-for-session" });

    const body = res.json();
    expect(body.eligibleTeams.map((t: { teamId: string }) => t.teamId)).toContain("team-live");

    // The eligibility query joins only team_memberships, never sessions —
    // confirming a live session cannot filter a team out of this list.
    const eligibleQueryCall = mockDbQuery.mock.calls.find((call) =>
      (call[0] as string).includes("FROM teams"),
    );
    expect(eligibleQueryCall![0] as string).not.toContain("JOIN sessions");
  });
});
// ---------------------------------------------------------------------------
// topic-annotation Tasks 6.2/6.3 — SESSION-005 / SESSION-012 carry
// currentTopic.topicAnnotation from the session_topics snapshot only.
// The real-Postgres negative test (live edit does not leak) is in
// topic-annotation-integration.test.ts; this mocked SQL-text guard runs even
// when that suite self-skips locally.
// ---------------------------------------------------------------------------
describe("topic-annotation — session payloads read the snapshot only (design.md Decision 8)", () => {
  beforeEach(() => vi.clearAllMocks());

  async function beginVoting(topicAnnotation: string | null) {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "5e550000-0000-4000-8000-000000000001", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1",
          status: "pre_session", is_first_session: false,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });
    const client = makeMockClient([
      { rows: [] },
      {
        rows: [{
          id: "session-topic-1", topic_id: "topic-1", topic_name: "Pipeline", topic_prompt: "P",
          vote_type: "finger", first_session_description: null, topic_annotation: topicAnnotation,
        }],
      },
      { rows: [{ voting_started_at: new Date("2026-09-08T00:00:00Z") }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    mockDbConnect.mockResolvedValueOnce(client);
    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/sessions/5e550000-0000-4000-8000-000000000001/begin-voting" });
    return { res, client };
  }

  async function advance(topicAnnotation: string | null) {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1", team_id: "11111111-1111-4111-8111-111111111111", facilitator_id: "facilitator-1",
          status: "active", current_topic_id: "topic-1",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });
    const client = makeMockClient([
      { rows: [] },
      {
        rows: [{ id: "session-topic-1", topic_name: "Pipeline", completed_at: new Date("2026-09-08T00:00:00Z") }],
        rowCount: 1,
      },
      {
        rows: [{
          id: "session-topic-2", topic_id: "topic-2", topic_name: "Deploys", topic_prompt: "P2",
          vote_type: "finger", topic_annotation: topicAnnotation,
        }],
      },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    mockDbConnect.mockResolvedValueOnce(client);
    const app = await buildApp("facilitator-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/sessions/sess-1/topics/advance" });
    return { res, client };
  }

  it("SESSION-005 returns the snapshotted annotation", async () => {
    const { res } = await beginVoting("X");
    expect(res.statusCode).toBe(200);
    expect(res.json().currentTopic.topicAnnotation).toBe("X");
  });

  it("SESSION-005 returns null for a null snapshot", async () => {
    const { res } = await beginVoting(null);
    expect(res.json().currentTopic.topicAnnotation).toBeNull();
  });

  it("SESSION-012 returns the snapshotted annotation", async () => {
    const { res } = await advance("X");
    expect(res.statusCode).toBe(200);
    expect(res.json().currentTopic.topicAnnotation).toBe("X");
  });

  it("SESSION-012 returns null for a null snapshot", async () => {
    const { res } = await advance(null);
    expect(res.json().currentTopic.topicAnnotation).toBeNull();
  });

  it("SQL-text guard: both topic SELECTs read st.topic_annotation and never t.team_annotation", async () => {
    const { client: beginClient } = await beginVoting("X");
    const { client: advanceClient } = await advance("X");

    for (const client of [beginClient, advanceClient]) {
      const topicSelect = client.query.mock.calls
        .map((call: unknown[]) => String(call[0]))
        .find((sql: string) => /SELECT[\s\S]*FROM session_topics st/.test(sql));
      expect(topicSelect).toBeDefined();
      expect(topicSelect).toContain("st.topic_annotation");
      expect(topicSelect).not.toMatch(/\bt\.team_annotation\b/);
      expect(topicSelect).not.toMatch(/\bteam_annotation\b/);
    }
  });
});
