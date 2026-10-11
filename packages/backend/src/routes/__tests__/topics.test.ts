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

const mockApplyTimingFloor = vi.fn().mockResolvedValue(undefined);
vi.mock("../../content/timing-oracle.js", () => ({
  applyTimingFloor: (...args: unknown[]) => mockApplyTimingFloor(...args),
  CONTENT_TIMING_FLOOR_MS: 150,
}));

// #184 5.4a: the topic-write rate limiter is replaced by the shared "allowed"
// stand-in (helpers/topic-write-rate-limit-mock.ts); see that file for why.
vi.mock("../topic-write-rate-limit.js", () => import("./helpers/topic-write-rate-limit-mock.js"));
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
import { topicRoutes } from "../topics.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
function buildApp(userId = "facilitator-1") {
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
  });
  app.register(topicRoutes);
  return app.ready().then(() => app);
}

/** Query #1 in the cascade: evaluateStandingFacilitatorAccess. */
function mockAuthQuery(globalRole: string, isMember: boolean) {
  mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: globalRole, is_member: isMember }] });
}

function mockAuthQueryNoUser() {
  mockDbQuery.mockResolvedValueOnce({ rows: [] });
}

/** Query #2: team-existence check. */
function mockTeamExists(exists: boolean) {
  mockDbQuery.mockResolvedValueOnce({ rows: exists ? [{ id: "11111111-1111-4111-8111-111111111111" }] : [] });
}

/** Query #3: hasCompletedFirstSession's COUNT(*). */
function mockLockCount(count: number) {
  mockDbQuery.mockResolvedValueOnce({ rows: [{ count: String(count) }] });
}

/** Query #4 (denial path only): INSERT INTO audit_log for the 409 rejection. */
function mockDenialAuditInsert() {
  mockDbQuery.mockResolvedValueOnce({ rows: [] });
}

/** Standard happy path through the three gates: facilitator, non-member, unlocked team, existing team. */
function mockPassAllGates() {
  mockAuthQuery("facilitator", false);
  mockTeamExists(true);
  mockLockCount(1);
}

/** DELETE cascade query #4: topic existence/status (Task 3.2/3.3). */
function mockTopicExists(status: "active" | "archived" | null) {
  mockDbQuery.mockResolvedValueOnce({ rows: status ? [{ id: "70000000-0000-4000-8000-000000000001", status }] : [] });
}

/** Standard happy path through all four gate checks TOPIC-004 shares before its transaction. */
function mockPassAllArchiveGates(topicStatus: "active" = "active") {
  mockAuthQuery("facilitator", false);
  mockTeamExists(true);
  mockLockCount(1);
  mockTopicExists(topicStatus);
}

const VALID_BODY = { name: "Team Health", prompt: "How healthy does the team feel?", voteType: "finger" };

/** Mock transaction client that returns queued responses per client.query() call. */
function makeMockClient(queryResponses: Array<{ rows: unknown[] }> = []) {
  let callIndex = 0;
  const mockClientQuery = vi.fn((..._args: unknown[]) => {
    const resp = queryResponses[callIndex] ?? { rows: [] };
    callIndex++;
    return Promise.resolve(resp);
  });
  return { query: mockClientQuery, release: vi.fn() };
}

function mockSuccessfulInsertTransaction(opts: { topicId?: string; nextDisplayOrder?: number; createdAt?: Date } = {}) {
  const topicId = opts.topicId ?? "topic-new-1";
  const nextDisplayOrder = opts.nextDisplayOrder ?? 0;
  const createdAt = opts.createdAt ?? new Date("2026-09-29T00:00:00.000Z");

  const client = makeMockClient([
    { rows: [] }, // BEGIN
    { rows: [] }, // pg_advisory_xact_lock
    { rows: [{ next_display_order: nextDisplayOrder }] }, // MAX read
    { rows: [{ id: topicId, created_at: createdAt }] }, // INSERT topics
    { rows: [] }, // INSERT audit_log
    { rows: [] }, // COMMIT
  ]);
  mockDbConnect.mockResolvedValueOnce(client);
  return client;
}

// ---------------------------------------------------------------------------
// Task 3.5 / spec "evaluates checks in a fixed order" — full ordering
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/topics — check ordering (design.md Decision 9)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a non-facilitator against a locked team receives 403, not 404 or 409, and reveals nothing about lock/existence", async () => {
    mockAuthQuery("engineer", false);

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: VALID_BODY });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NOT_A_FACILITATOR");
    // Only the auth query ran — no team-existence or lock query reached.
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it("a same-team-member facilitator receives 403 FACILITATOR_IS_TEAM_MEMBER, not 404 or 409", async () => {
    mockAuthQuery("facilitator", true);

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: VALID_BODY });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FACILITATOR_IS_TEAM_MEMBER");
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it("a standing, non-member facilitator against a nonexistent team receives 404, not 409", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(false);

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/99999999-9999-4999-8999-999999999999/topics", payload: VALID_BODY });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TEAM_NOT_FOUND");
    // auth query + team-existence query only — lock-check never reached.
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
  });

  it("a standing, non-member facilitator against a locked, existing team receives 409, not 404", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: VALID_BODY });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TOPIC_CUSTOMIZATION_LOCKED");
  });

  it("a non-facilitator submitting an invalid body still receives 403, not 422", async () => {
    mockAuthQuery("engineer", false);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics",
      payload: { voteType: "not-a-real-type" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.field).toBeUndefined();
  });

  it("a locked team's rejection takes priority over an invalid body (409, not 422)", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics",
      payload: { name: "" }, // also invalid, should not matter
    });

    expect(res.statusCode).toBe(409);
  });

  it("a request against a nonexistent team with an invalid body still receives 404, not 422", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(false);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/99999999-9999-4999-8999-999999999999/topics",
      payload: { prompt: "" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TEAM_NOT_FOUND");
  });

  it("treats a caller with no user row the same as not-a-facilitator (403)", async () => {
    mockAuthQueryNoUser();

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: VALID_BODY });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NOT_A_FACILITATOR");
  });
});

// ---------------------------------------------------------------------------
// Task 3.5 (Decision 11) — deactivated teams are not treated as nonexistent
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/topics — deactivated teams (design.md Decision 11)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a deactivated but existing team is not rejected 404 for deactivation alone", async () => {
    // The team-existence check does not filter on deactivated_at — a row
    // exists regardless of that column's value, so the mocked response is
    // identical to any other existing team.
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(1);
    mockSuccessfulInsertTransaction();

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/dddddddd-dddd-4ddd-8ddd-dddddddddddd/topics", payload: VALID_BODY });

    expect(res.statusCode).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Task 4.1-4.3 — audit logging for denied lock-bypass attempts
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/topics — lock-denial audit logging (design.md Decision 8, Task 4.1-4.3)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes an audit_log row (topic.write_denied_locked) before the 409 response is sent", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: VALID_BODY });

    expect(res.statusCode).toBe(409);

    const auditCall = mockDbQuery.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toContain("topic.write_denied_locked");
    expect(auditCall![1]).toContain("11111111-1111-4111-8111-111111111111");

    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "topic.write_denied_locked",
      expect.objectContaining({ teamId: "11111111-1111-4111-8111-111111111111" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Task 5.3 — request body validation (422)
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/topics — body validation (Task 5.3)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a missing name with 422 identifying the failing field", async () => {
    mockPassAllGates();

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics",
      payload: { prompt: "A prompt", voteType: "finger" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.field).toBe("name");
  });

  it("rejects an empty-after-trim name with 422", async () => {
    mockPassAllGates();

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics",
      payload: { name: "   ", prompt: "A prompt", voteType: "finger" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.field).toBe("name");
  });

  it("rejects a name longer than 100 characters with 422", async () => {
    mockPassAllGates();

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics",
      payload: { name: "x".repeat(101), prompt: "A prompt", voteType: "finger" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.field).toBe("name");
  });

  it("rejects a missing prompt with 422 identifying the failing field", async () => {
    mockPassAllGates();

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics",
      payload: { name: "Team Health", voteType: "finger" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.field).toBe("prompt");
  });

  it("rejects a prompt longer than 500 characters with 422", async () => {
    mockPassAllGates();

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics",
      payload: { name: "Team Health", prompt: "x".repeat(501), voteType: "finger" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.field).toBe("prompt");
  });

  it("rejects a missing voteType with 422", async () => {
    mockPassAllGates();

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics",
      payload: { name: "Team Health", prompt: "A prompt" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.field).toBe("voteType");
  });

  it("rejects an invalid voteType value with 422", async () => {
    mockPassAllGates();

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics",
      payload: { name: "Team Health", prompt: "A prompt", voteType: "not-real" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.field).toBe("voteType");
  });

  it("rejects a firstSessionDescription longer than 500 characters with 422", async () => {
    mockPassAllGates();

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics",
      payload: { ...VALID_BODY, firstSessionDescription: "x".repeat(501) },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.field).toBe("firstSessionDescription");
  });

  it("accepts each valid voteType", async () => {
    for (const voteType of ["finger", "roman", "modified_roman"]) {
      vi.clearAllMocks();
      mockPassAllGates();
      mockSuccessfulInsertTransaction();

      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics",
        payload: { ...VALID_BODY, voteType },
      });

      expect(res.statusCode).toBe(201);
    }
  });
});

// ---------------------------------------------------------------------------
// Task 5.4/5.6 — successful creation
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/topics — successful creation (Task 5.4/5.6)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a topic and returns 201 with the expected response shape", async () => {
    mockPassAllGates();
    mockSuccessfulInsertTransaction({ topicId: "topic-abc", nextDisplayOrder: 3 });

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: VALID_BODY });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      topicId: "topic-abc",
      name: "Team Health",
      prompt: "How healthy does the team feel?",
      voteType: "finger",
      displayOrder: 3,
      isDefault: false,
    });
    expect(body.createdAt).toBe("2026-09-29T00:00:00.000Z");
  });

  it("persists an optional firstSessionDescription when provided", async () => {
    mockPassAllGates();
    const client = mockSuccessfulInsertTransaction();

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics",
      payload: { ...VALID_BODY, firstSessionDescription: "Read this before your first vote." },
    });

    expect(res.statusCode).toBe(201);
    const insertCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO topics"),
    );
    expect(insertCall![1]).toContain("Read this before your first vote.");
  });

  it("succeeds with firstSessionDescription set to null when omitted", async () => {
    mockPassAllGates();
    const client = mockSuccessfulInsertTransaction();

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: VALID_BODY });

    expect(res.statusCode).toBe(201);
    const insertCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO topics"),
    );
    expect(insertCall![1]).toContain(null);
  });

  it("assigns displayOrder = n + 1 when appending to a non-empty topic list", async () => {
    mockPassAllGates();
    mockSuccessfulInsertTransaction({ nextDisplayOrder: 7 });

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: VALID_BODY });

    expect(res.json().displayOrder).toBe(7);
  });

  it("accepts a duplicate prompt without a uniqueness check (Task 5.5)", async () => {
    mockPassAllGates();
    mockSuccessfulInsertTransaction();

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: VALID_BODY });

    // No uniqueness pre-check query is issued between the lock gate and the
    // transaction: mockPassAllGates supplies exactly 3 db.query calls, and
    // the insert path proceeds straight into db.connect()'s transaction.
    expect(mockDbQuery).toHaveBeenCalledTimes(3);
    expect(res.statusCode).toBe(201);
  });

  it("opens the transaction with the advisory lock before the MAX(display_order) read (design.md Decision 10)", async () => {
    mockPassAllGates();
    const client = mockSuccessfulInsertTransaction();

    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: VALID_BODY });

    const calls = client.query.mock.calls.map((call) => call[0] as string);
    const lockIndex = calls.findIndex((sql) => sql.includes("pg_advisory_xact_lock"));
    const maxIndex = calls.findIndex((sql) => sql.includes("MAX(display_order)"));
    expect(lockIndex).toBeGreaterThan(-1);
    expect(maxIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeLessThan(maxIndex);
  });

  it("writes a topic.custom_added audit_log row in the same transaction as the INSERT, and emits the audit event", async () => {
    mockPassAllGates();
    const client = mockSuccessfulInsertTransaction({ topicId: "topic-audit-1" });

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: VALID_BODY });

    expect(res.statusCode).toBe(201);

    const auditCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toContain("topic.custom_added");
    expect(JSON.stringify(auditCall![1])).toContain("topic-audit-1");

    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "topic.custom_added",
      expect.objectContaining({ teamId: "11111111-1111-4111-8111-111111111111", topicId: "topic-audit-1" }),
    );

    // The denial-path audit write (topic.write_denied_locked) must never
    // fire alongside a success.
    expect(mockEmitAuditEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      "topic.write_denied_locked",
      expect.anything(),
    );
  });

  it("writes no audit_log row via db.query directly for a successful write — the write happens on the transaction client", async () => {
    mockPassAllGates();
    mockSuccessfulInsertTransaction();

    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: VALID_BODY });

    // Only the 3 gate-check db.query calls occur; the transaction runs
    // entirely on the connected client, never on db.query directly.
    expect(mockDbQuery).toHaveBeenCalledTimes(3);
  });

  it("succeeds for a standing facilitator who has never run any session for the target team (design.md Decision 3)", async () => {
    // mockPassAllGates already models exactly this: is_member = false, with
    // no session-history relationship implied anywhere in the auth query.
    mockPassAllGates();
    mockSuccessfulInsertTransaction();

    const app = await buildApp("facilitator-with-no-history-for-team-1");
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: VALID_BODY });

    expect(res.statusCode).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Task 5.7 — concurrency: two concurrent requests never collide on
// displayOrder (design.md Decision 10, corrected)
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/topics — concurrency (design.md Decision 10, Task 5.7)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("two concurrent valid requests against the same team both succeed with distinct displayOrder values", async () => {
    // Gate checks for both requests (interleaved order doesn't matter since
    // each request consumes its own queued mockResolvedValueOnce in FIFO
    // order against the shared mockDbQuery).
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(1);
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(1);

    // Two distinct transaction clients — the advisory lock is what would
    // serialize these against a real Postgres instance; here, each mocked
    // client independently returns the next display_order it was told to,
    // modeling the correct post-lock re-read outcome (0, then 1) rather than
    // the old race's incorrect outcome (both compute the same value).
    mockDbConnect.mockResolvedValueOnce(
      makeMockClient([
        { rows: [] },
        { rows: [] },
        { rows: [{ next_display_order: 0 }] },
        { rows: [{ id: "topic-a", created_at: new Date() }] },
        { rows: [] },
        { rows: [] },
      ]),
    );
    mockDbConnect.mockResolvedValueOnce(
      makeMockClient([
        { rows: [] },
        { rows: [] },
        { rows: [{ next_display_order: 1 }] },
        { rows: [{ id: "topic-b", created_at: new Date() }] },
        { rows: [] },
        { rows: [] },
      ]),
    );

    const app = await buildApp();

    // Issue both requests before either resolves — genuine concurrency, not
    // a sequential call pair.
    const [res1, res2] = await Promise.all([
      app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: { ...VALID_BODY, name: "Topic A" } }),
      app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: { ...VALID_BODY, name: "Topic B" } }),
    ]);

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);

    const displayOrders = [res1.json().displayOrder, res2.json().displayOrder].sort();
    expect(displayOrders).toEqual([0, 1]);
    expect(displayOrders[0]).not.toBe(displayOrders[1]);
  });
});

// ---------------------------------------------------------------------------
// design.md Decision 9's security-review Finding 1 amendment — timing floor
// applied at every early-return, 201 included (Task 3.6 / Task 5.6)
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/topics — timing floor applied on every branch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("applies the timing floor on the 403 branch", async () => {
    mockAuthQuery("engineer", false);
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: VALID_BODY });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 404 branch", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(false);
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: VALID_BODY });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 409 branch", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: VALID_BODY });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 422 branch", async () => {
    mockPassAllGates();
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: { name: "" } });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 201 success branch", async () => {
    mockPassAllGates();
    mockSuccessfulInsertTransaction();
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: VALID_BODY });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("the 403 response is not detectably faster than the 404/409/422 responses — all apply the same mocked floor call exactly once", async () => {
    // With applyTimingFloor mocked to a fixed resolved promise (as every
    // other endpoint test file in this codebase does), the observable
    // invariant a unit test can assert is that every branch calls the floor
    // exactly once, not zero times conditionally — a real p95/p99
    // measurement is an operational task (see timing-oracle.ts's own
    // header), not something a mocked unit test can measure directly.
    const branches: Array<() => Promise<void>> = [
      async () => {
        mockAuthQuery("engineer", false);
      },
      async () => {
        mockAuthQuery("facilitator", false);
        mockTeamExists(false);
      },
      async () => {
        mockAuthQuery("facilitator", false);
        mockTeamExists(true);
        mockLockCount(0);
        mockDenialAuditInsert();
      },
      async () => {
        mockPassAllGates();
      },
    ];

    for (const setup of branches) {
      vi.clearAllMocks();
      await setup();
      const app = await buildApp();
      await app.inject({
        method: "POST",
        url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics",
        payload: setup === branches[3] ? { name: "" } : VALID_BODY,
      });
      expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
    }
  });
});

// ---------------------------------------------------------------------------
// design.md Decision 4 — error envelope shape
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/topics — error envelope shape (design.md Decision 4)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("the 409 lock rejection carries the stable reason code and message, nested under error", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: VALID_BODY });

    const body = res.json();
    expect(body.error.category).toBe("precondition_failed");
    expect(body.error.code).toBe("TOPIC_CUSTOMIZATION_LOCKED");
    expect(body.error.message).toBe(
      "Topics cannot be customized until this team's first session is completed.",
    );
    expect(typeof body.error.correlationId).toBe("string");
    expect(body.error.correlationId.length).toBeGreaterThan(0);
  });

  it("the 403 NOT_A_FACILITATOR rejection carries a distinct reason code and category", async () => {
    mockAuthQuery("engineer", false);

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: VALID_BODY });

    const body = res.json();
    expect(body.error.category).toBe("forbidden");
    expect(body.error.code).toBe("NOT_A_FACILITATOR");
  });

  it("the 403 FACILITATOR_IS_TEAM_MEMBER rejection carries a distinct reason code", async () => {
    mockAuthQuery("facilitator", true);

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: VALID_BODY });

    const body = res.json();
    expect(body.error.code).toBe("FACILITATOR_IS_TEAM_MEMBER");
  });

  it("never ships a bare top-level { code, message } body without the error envelope", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics", payload: VALID_BODY });

    const body = res.json();
    expect(body.code).toBeUndefined();
    expect(body.message).toBeUndefined();
    expect(body.error).toBeDefined();
  });
});

// =============================================================================
// topic-003-admin-authorization (#176) — application admins on TOPIC-003
// (BRD FR-8.2 [HARD]). tasks.md 2.1–2.6.
// =============================================================================
const TEAM_URL = "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics";
const MISSING_TEAM_URL = "/api/v1/teams/99999999-9999-4999-8999-999999999999/topics";
const NEW_NOT_A_FACILITATOR_COPY = "Only a facilitator or an application admin can add a custom topic.";
const MEMBER_COPY = "A facilitator cannot add a custom topic to a team they are a member of.";

function successAuditCalls(client: ReturnType<typeof makeMockClient>) {
  return client.query.mock.calls.filter((call) => (call[0] as string).includes("INSERT INTO audit_log"));
}

function anySuccessAuditViaDb() {
  return mockDbQuery.mock.calls.some(
    (call) => (call[0] as string).includes("INSERT INTO audit_log") && (call[1] as unknown[]).includes("topic.custom_added"),
  );
}

describe("POST /api/v1/teams/:teamId/topics — application admin success (tasks 2.1, 2.2)", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["non-member", false],
    ["active member of the team", true],
  ])("an application_admin (%s) on an unlocked team gets 201, appended last, with exactly one admin audit row in the insert's transaction", async (_label, isMember) => {
    mockAuthQuery("application_admin", isMember);
    mockTeamExists(true);
    mockLockCount(1);
    const client = mockSuccessfulInsertTransaction({ topicId: "topic-admin-1", nextDisplayOrder: 5 });

    const app = await buildApp("admin-1");
    const res = await app.inject({ method: "POST", url: TEAM_URL, payload: VALID_BODY });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ topicId: "topic-admin-1", displayOrder: 5, isDefault: false });
    // The MAX(display_order) read runs on active topics only: appended at the end.
    const maxSql = client.query.mock.calls.map((c) => c[0] as string).find((sql) => sql.includes("MAX(display_order)"));
    expect(maxSql).toContain("status = 'active'");

    // Topic fields only: no session fields leak into the admin's 201 (security review §5).
    expect(Object.keys(body).sort()).toEqual(
      ["createdAt", "displayOrder", "isDefault", "name", "prompt", "topicId", "voteType"].sort(),
    );
    expect(body).not.toHaveProperty("openSessionCreatedAt");

    // The permanent audit record of admin topic writes (#208 decision):
    // exactly one topic.custom_added row, attributed to application_admin, on
    // the transaction client between INSERT topics and COMMIT. Do not weaken.
    const audits = successAuditCalls(client);
    expect(audits).toHaveLength(1);
    const params = audits[0]![1] as unknown[];
    expect(params[0]).toBe("admin-1");
    expect(params[1]).toBe("application_admin");
    expect(params[3]).toBe("topic.custom_added");
    expect(JSON.parse(params[5] as string)).toEqual({ topic_id: "topic-admin-1" });
    const sqls = client.query.mock.calls.map((c) => c[0] as string);
    const insertIdx = sqls.findIndex((s) => s.includes("INSERT INTO topics"));
    const auditIdx = sqls.findIndex((s) => s.includes("INSERT INTO audit_log"));
    const commitIdx = sqls.indexOf("COMMIT");
    expect(insertIdx).toBeLessThan(auditIdx);
    expect(auditIdx).toBeLessThan(commitIdx);
    expect(anySuccessAuditViaDb()).toBe(false);

    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "topic.custom_added",
      expect.objectContaining({ actorGlobalRole: "application_admin", topicId: "topic-admin-1" }),
    );
  });
});

describe("POST /api/v1/teams/:teamId/topics — application admin and the lock (task 2.3)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("an application_admin on a locked team gets 409 TOPIC_CUSTOMIZATION_LOCKED, a denial row attributed to application_admin, and no success row", async () => {
    mockAuthQuery("application_admin", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();

    const app = await buildApp("admin-1");
    const res = await app.inject({ method: "POST", url: TEAM_URL, payload: VALID_BODY });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TOPIC_CUSTOMIZATION_LOCKED");

    const auditCalls = mockDbQuery.mock.calls.filter((call) => (call[0] as string).includes("INSERT INTO audit_log"));
    expect(auditCalls).toHaveLength(1);
    const params = auditCalls[0]![1] as unknown[];
    expect(params[1]).toBe("application_admin");
    expect(params[3]).toBe("topic.write_denied_locked");
    expect(JSON.parse(params[5] as string)).toMatchObject({ attempted_operation: "topic.custom_added" });
    expect(mockDbConnect).not.toHaveBeenCalled();
    expect(mockEmitAuditEvent).not.toHaveBeenCalledWith(expect.anything(), "topic.custom_added", expect.anything());
  });
});

describe("POST /api/v1/teams/:teamId/topics — application admin check order (task 2.4)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("nonexistent team + invalid body -> 404 (not 422), no error.field, no success row", async () => {
    mockAuthQuery("application_admin", false);
    mockTeamExists(false);

    const app = await buildApp("admin-1");
    const res = await app.inject({ method: "POST", url: MISSING_TEAM_URL, payload: { prompt: "" } });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TEAM_NOT_FOUND");
    expect(res.json().error.field).toBeUndefined();
    expect(mockDbConnect).not.toHaveBeenCalled();
    expect(anySuccessAuditViaDb()).toBe(false);
  });

  it("locked team + invalid body -> 409 (not 422), no error.field", async () => {
    mockAuthQuery("application_admin", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();

    const app = await buildApp("admin-1");
    const res = await app.inject({ method: "POST", url: TEAM_URL, payload: { name: "" } });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.field).toBeUndefined();
  });

  it("unlocked team + missing voteType -> 422 with error.field voteType, no success row", async () => {
    mockAuthQuery("application_admin", false);
    mockTeamExists(true);
    mockLockCount(1);

    const app = await buildApp("admin-1");
    const res = await app.inject({ method: "POST", url: TEAM_URL, payload: { name: "Team Health", prompt: "A prompt" } });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.field).toBe("voteType");
    expect(mockDbConnect).not.toHaveBeenCalled();
    expect(anySuccessAuditViaDb()).toBe(false);
  });
});

describe("POST /api/v1/teams/:teamId/topics — timing floor on the admin paths and the new wrapper's 403 branches (task 2.5)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("admin -> 404 applies the floor once", async () => {
    mockAuthQuery("application_admin", false);
    mockTeamExists(false);
    const app = await buildApp("admin-1");
    const res = await app.inject({ method: "POST", url: MISSING_TEAM_URL, payload: VALID_BODY });
    expect(res.statusCode).toBe(404);
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("admin -> 409 applies the floor once", async () => {
    mockAuthQuery("application_admin", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();
    const app = await buildApp("admin-1");
    const res = await app.inject({ method: "POST", url: TEAM_URL, payload: VALID_BODY });
    expect(res.statusCode).toBe(409);
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["engineer", () => mockAuthQuery("engineer", true), "NOT_A_FACILITATOR"],
    ["engineering_manager", () => mockAuthQuery("engineering_manager", true), "NOT_A_FACILITATOR"],
    ["no users row", () => mockAuthQueryNoUser(), "NOT_A_FACILITATOR"],
    ["member facilitator", () => mockAuthQuery("facilitator", true), "FACILITATOR_IS_TEAM_MEMBER"],
  ])("%s -> 403 %s applies the floor once", async (_label, setup, code) => {
    setup();
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: TEAM_URL, payload: VALID_BODY });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe(code);
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/v1/teams/:teamId/topics — callers still rejected, and the 403 copy (task 2.6)", () => {
  // resetAllMocks (not clear): some cases queue team/lock responses that a
  // correct 403 never consumes, and those must not leak into the next case.
  beforeEach(() => vi.resetAllMocks());

  const rejected: Array<[string, () => void]> = [
    ["engineer", () => mockAuthQuery("engineer", true)],
    ["engineering_manager", () => mockAuthQuery("engineering_manager", true)],
    ["no users row", () => mockAuthQueryNoUser()],
  ];

  it.each(rejected)("%s against a locked team -> 403 NOT_A_FACILITATOR with the new copy (not 409; lock state not revealed)", async (_label, setup) => {
    setup();
    // Even if the lock and existence checks were reached they would say
    // "locked"; the 403 must come first and touch nothing else.
    mockTeamExists(true);
    mockLockCount(0);
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: TEAM_URL, payload: VALID_BODY });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NOT_A_FACILITATOR");
    expect(res.json().error.message).toBe(NEW_NOT_A_FACILITATOR_COPY);
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it.each(rejected)("%s against a nonexistent team with an invalid body -> 403 (not 404 or 422), no error.field", async (_label, setup) => {
    setup();
    mockTeamExists(false);
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: MISSING_TEAM_URL, payload: { voteType: "nope" } });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NOT_A_FACILITATOR");
    expect(res.json().error.message).toBe(NEW_NOT_A_FACILITATOR_COPY);
    expect(res.json().error.field).toBeUndefined();
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it("a member facilitator -> 403 FACILITATOR_IS_TEAM_MEMBER with unchanged copy", async () => {
    mockAuthQuery("facilitator", true);
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: TEAM_URL, payload: VALID_BODY });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FACILITATOR_IS_TEAM_MEMBER");
    expect(res.json().error.message).toBe(MEMBER_COPY);
  });
});

// =============================================================================
// DELETE /api/v1/teams/:teamId/topics/:topicId  (TOPIC-004, remove-topic)
// =============================================================================

/**
 * Mock client for the DELETE handler's transaction. Queue order:
 * BEGIN, pg_advisory_xact_lock, COUNT active, [open-items SELECT if reached],
 * [UPDATE archive + INSERT audit_log if reached], COMMIT.
 */
function mockArchiveTransaction(opts: {
  activeCount: number;
  openItemsRows?: Array<{ id: string; description: string }>;
  archivedAt?: Date;
}) {
  const { activeCount, openItemsRows, archivedAt = new Date("2026-09-30T00:00:00.000Z") } = opts;
  const responses: Array<{ rows: unknown[] }> = [
    { rows: [] }, // BEGIN
    { rows: [] }, // pg_advisory_xact_lock
    { rows: [{ active_count: String(activeCount) }] }, // COUNT active
  ];

  if (activeCount <= 1) {
    responses.push({ rows: [] }); // ROLLBACK (no further queries reached)
    const client = makeMockClient(responses);
    mockDbConnect.mockResolvedValueOnce(client);
    return client;
  }

  responses.push({ rows: openItemsRows ?? [] }); // open-action-items SELECT

  if (openItemsRows && openItemsRows.length > 0) {
    responses.push({ rows: [] }); // ROLLBACK
    const client = makeMockClient(responses);
    mockDbConnect.mockResolvedValueOnce(client);
    return client;
  }

  responses.push({ rows: [{ archived_at: archivedAt }] }); // UPDATE archive
  responses.push({ rows: [] }); // INSERT audit_log
  responses.push({ rows: [] }); // COMMIT
  const client = makeMockClient(responses);
  mockDbConnect.mockResolvedValueOnce(client);
  return client;
}

/** Same shape as above, but for the confirm=true path (skips the unconfirmed open-items branch). */
function mockArchiveTransactionConfirmed(opts: {
  activeCount: number;
  reDerivedOpenItemsRows?: Array<{ id: string; description: string }>;
  archivedAt?: Date;
}) {
  const {
    activeCount,
    reDerivedOpenItemsRows = [],
    archivedAt = new Date("2026-09-30T00:00:00.000Z"),
  } = opts;
  const responses: Array<{ rows: unknown[] }> = [
    { rows: [] }, // BEGIN
    { rows: [] }, // pg_advisory_xact_lock
    { rows: [{ active_count: String(activeCount) }] }, // COUNT active
  ];

  if (activeCount <= 1) {
    responses.push({ rows: [] }); // ROLLBACK
    const client = makeMockClient(responses);
    mockDbConnect.mockResolvedValueOnce(client);
    return client;
  }

  responses.push({ rows: reDerivedOpenItemsRows }); // re-derivation SELECT (confirm=true path)
  responses.push({ rows: [{ archived_at: archivedAt }] }); // UPDATE archive
  responses.push({ rows: [] }); // INSERT audit_log
  responses.push({ rows: [] }); // COMMIT
  const client = makeMockClient(responses);
  mockDbConnect.mockResolvedValueOnce(client);
  return client;
}

// -----------------------------------------------------------------------
// Task 3.6 / 7.4-mirroring — identity/role scenarios
// -----------------------------------------------------------------------
describe("DELETE /api/v1/teams/:teamId/topics/:topicId — identity/role (design.md Decision 1)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("a standing facilitator who is not a team member succeeds", async () => {
    mockPassAllArchiveGates();
    mockArchiveTransaction({ activeCount: 2 });

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });

    expect(res.statusCode).toBe(200);
  });

  it("an application_admin succeeds for any team, including one they are an active member of", async () => {
    mockAuthQuery("application_admin", true);
    mockTeamExists(true);
    mockLockCount(1);
    mockTopicExists("active");
    mockArchiveTransaction({ activeCount: 2 });

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });

    expect(res.statusCode).toBe(200);
  });

  it("a caller who is neither a facilitator nor an admin is rejected 403 NOT_A_FACILITATOR", async () => {
    mockAuthQuery("engineer", false);

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NOT_A_FACILITATOR");
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it("a facilitator who is an active member of the team is rejected 403 FACILITATOR_IS_TEAM_MEMBER", async () => {
    mockAuthQuery("facilitator", true);

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FACILITATOR_IS_TEAM_MEMBER");
  });

  it("treats a caller with no user row the same as not-a-facilitator (403)", async () => {
    mockAuthQueryNoUser();

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NOT_A_FACILITATOR");
  });
});

// -----------------------------------------------------------------------
// Task 3.5 / spec "Archive Topic evaluates checks in a fixed order"
// -----------------------------------------------------------------------
describe("DELETE /api/v1/teams/:teamId/topics/:topicId — check ordering (design.md Decision 2)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("a non-facilitator against a nonexistent team/topic receives 403, revealing nothing else", async () => {
    mockAuthQuery("engineer", false);

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });

    expect(res.statusCode).toBe(403);
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it("a nonexistent team is rejected 404 before the lock or topic are evaluated", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(false);

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/99999999-9999-4999-8999-999999999999/topics/70000000-0000-4000-8000-000000000001" });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TEAM_NOT_FOUND");
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
  });

  it("a locked team's rejection (409) takes priority over an already-archived topic's state", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TOPIC_CUSTOMIZATION_LOCKED");
    // The topic-existence query is never reached.
    expect(mockDbQuery).toHaveBeenCalledTimes(4);
  });

  it("a nonexistent topic is rejected 404 TOPIC_NOT_FOUND after the lock passes", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(1);
    mockTopicExists(null);

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/7000ffff-0000-4000-8000-00000000ffff" });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TOPIC_NOT_FOUND");
  });

  it("an already-archived topic is rejected 422 TOPIC_ALREADY_ARCHIVED", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(1);
    mockTopicExists("archived");

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("TOPIC_ALREADY_ARCHIVED");
  });

  it("an already-archived topic's 422 takes priority over the last-active-topic guard (the transaction is never opened)", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(1);
    mockTopicExists("archived");

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("TOPIC_ALREADY_ARCHIVED");
    expect(mockDbConnect).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------
// Task 4.3/4.4 — last-active-topic guard
// -----------------------------------------------------------------------
describe("DELETE /api/v1/teams/:teamId/topics/:topicId — last-active-topic guard (design.md Decision 3)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("blocks archiving a team's sole remaining active topic with 409 TOPIC_LAST_ACTIVE", async () => {
    mockPassAllArchiveGates();
    mockArchiveTransaction({ activeCount: 1 });

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TOPIC_LAST_ACTIVE");
  });

  it("archiving one of several (3+) active topics succeeds, decrementing the active count by exactly one", async () => {
    mockPassAllArchiveGates();
    const client = mockArchiveTransaction({ activeCount: 3 });

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });

    expect(res.statusCode).toBe(200);
    const updateCall = client.query.mock.calls.find((call) => (call[0] as string).includes("UPDATE topics"));
    expect(updateCall).toBeDefined();
  });

  it("opens the transaction with the advisory lock before the active-count read (design.md Decision 3)", async () => {
    mockPassAllArchiveGates();
    const client = mockArchiveTransaction({ activeCount: 2 });

    const app = await buildApp();
    await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });

    const calls = client.query.mock.calls.map((call) => call[0] as string);
    const lockIndex = calls.findIndex((sql) => sql.includes("pg_advisory_xact_lock"));
    const countIndex = calls.findIndex((sql) => sql.includes("COUNT(*) AS active_count"));
    expect(lockIndex).toBeGreaterThan(-1);
    expect(countIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeLessThan(countIndex);
  });

  it("two concurrent requests against a team's exactly two active topics never both succeed", async () => {
    // Gate checks for both requests: a shape-aware implementation, not a
    // FIFO once-queue — genuine concurrency means the two requests' gate
    // checks can interleave at the mock-call level in either order, and a
    // strict queue position would make this test's outcome depend on an
    // interleaving order this test does not (and should not need to)
    // control. Matching on each query's distinguishing SQL fragment keeps
    // the test correct regardless of interleaving.
    mockDbQuery.mockImplementation((sql: unknown) => {
      const text = sql as string;
      if (text.includes("FROM users u")) {
        return Promise.resolve({ rows: [{ global_role: "facilitator", is_member: false }] });
      }
      if (text.includes("FROM teams WHERE id")) {
        return Promise.resolve({ rows: [{ id: "11111111-1111-4111-8111-111111111111" }] });
      }
      if (text.includes("FROM sessions WHERE team_id")) {
        return Promise.resolve({ rows: [{ count: "1" }] });
      }
      if (text.includes("FROM topics WHERE id")) {
        return Promise.resolve({ rows: [{ id: "70000000-0000-4000-8000-000000000001", status: "active" }] });
      }
      return Promise.resolve({ rows: [] });
    });

    // First request's transaction: still 2 active topics, archives successfully.
    mockDbConnect.mockResolvedValueOnce(
      makeMockClient([
        { rows: [] }, // BEGIN
        { rows: [] }, // advisory lock
        { rows: [{ active_count: "2" }] }, // COUNT — sees both still active
        { rows: [] }, // open items
        { rows: [{ archived_at: new Date("2026-09-30T00:00:00.000Z") }] }, // UPDATE
        { rows: [] }, // audit insert
        { rows: [] }, // COMMIT
      ]),
    );
    // Second request's transaction: serialized behind the first by the
    // advisory lock, now sees only 1 active topic remaining — blocked.
    mockDbConnect.mockResolvedValueOnce(
      makeMockClient([
        { rows: [] }, // BEGIN
        { rows: [] }, // advisory lock
        { rows: [{ active_count: "1" }] }, // COUNT — post-first-archive state
        { rows: [] }, // ROLLBACK
      ]),
    );

    const app = await buildApp();
    const [res1, res2] = await Promise.all([
      app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/7000000a-0000-4000-8000-00000000000a" }),
      app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/7000000b-0000-4000-8000-00000000000b" }),
    ]);

    const statuses = [res1.statusCode, res2.statusCode].sort();
    expect(statuses).toEqual([200, 409]);
    const rejected = res1.statusCode === 409 ? res1 : res2;
    expect(rejected.json().error.code).toBe("TOPIC_LAST_ACTIVE");
  });
});

// -----------------------------------------------------------------------
// Task 5.5 — open-action-item confirmation flow
// -----------------------------------------------------------------------
describe("DELETE /api/v1/teams/:teamId/topics/:topicId — open-action-item confirmation (design.md Decision 5)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("a topic with open action items returns requiresConfirmation without archiving", async () => {
    mockPassAllArchiveGates();
    mockArchiveTransaction({
      activeCount: 2,
      openItemsRows: [
        { id: "ai-1", description: "Fix the flaky test" },
        { id: "ai-2", description: "Update the runbook" },
      ],
    });

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.requiresConfirmation).toBe(true);
    expect(body.reason).toBe("openActionItems");
    expect(body.openActionItemCount).toBe(2);
    expect(body.openActionItems).toEqual([
      { actionItemId: "ai-1", description: "Fix the flaky test" },
      { actionItemId: "ai-2", description: "Update the runbook" },
    ]);
  });

  it("a topic with zero open action items archives immediately without requiring confirmation", async () => {
    mockPassAllArchiveGates();
    mockArchiveTransaction({ activeCount: 2, openItemsRows: [] });

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("archived");
  });

  it("a confirm=true request archives regardless of the current open-item count", async () => {
    mockPassAllArchiveGates();
    mockArchiveTransactionConfirmed({
      activeCount: 2,
      reDerivedOpenItemsRows: [{ id: "ai-1", description: "Still open" }],
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001?confirm=true",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("archived");
  });

  it("the confirming request re-derives the open-item state rather than trusting a prior value (staleness scenario)", async () => {
    // First (unconfirmed) request would have shown 2 open items; by the
    // time the confirm=true request arrives, one has been resolved. The
    // second request's own transaction re-derives independently and the
    // archive still succeeds, unaffected by the earlier count.
    mockPassAllArchiveGates();
    const client = mockArchiveTransactionConfirmed({
      activeCount: 2,
      reDerivedOpenItemsRows: [{ id: "ai-1", description: "Still open" }],
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001?confirm=true",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("archived");

    const auditCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect((auditCall![1] as unknown[])[5] as string).toContain('"openActionItemCount":1');
  });
});

// -----------------------------------------------------------------------
// Task 6.3 — audit logging for successful archives
// -----------------------------------------------------------------------
describe("DELETE /api/v1/teams/:teamId/topics/:topicId — audit logging (design.md Decision 7, Task 6.3)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("a successful immediate archive writes a topic.archived audit row with openActionItemCount 0", async () => {
    mockPassAllArchiveGates();
    const client = mockArchiveTransaction({ activeCount: 2, openItemsRows: [] });

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });

    expect(res.statusCode).toBe(200);
    const auditCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toContain("topic.archived");
    expect(auditCall![1]).toContain("11111111-1111-4111-8111-111111111111");
    expect((auditCall![1] as unknown[])[5] as string).toContain('"openActionItemCount":0');

    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "topic.archived",
      expect.objectContaining({ teamId: "11111111-1111-4111-8111-111111111111", topicId: "70000000-0000-4000-8000-000000000001", openActionItemCount: 0 }),
    );
  });

  it("a confirm=true archive's audit row records the freshly re-derived count", async () => {
    mockPassAllArchiveGates();
    const client = mockArchiveTransactionConfirmed({
      activeCount: 2,
      reDerivedOpenItemsRows: [
        { id: "ai-1", description: "a" },
        { id: "ai-2", description: "b" },
        { id: "ai-3", description: "c" },
      ],
    });

    const app = await buildApp();
    await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001?confirm=true" });

    const auditCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect((auditCall![1] as unknown[])[5] as string).toContain('"openActionItemCount":3');
  });

  it("no audit_log row is written via the transaction client when rejected by identity/role (never opens a transaction)", async () => {
    mockAuthQuery("engineer", false);

    const app = await buildApp();
    await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });

    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  it("no topic.archived audit row is written when the request only receives requiresConfirmation", async () => {
    mockPassAllArchiveGates();
    const client = mockArchiveTransaction({
      activeCount: 2,
      openItemsRows: [{ id: "ai-1", description: "open" }],
    });

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });

    expect(res.statusCode).toBe(200);
    expect(res.json().requiresConfirmation).toBe(true);
    const auditCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditCall).toBeUndefined();
    expect(mockEmitAuditEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      "topic.archived",
      expect.anything(),
    );
  });

  it("the lock-denied rejection is audited under the shared topic.write_denied_locked operation, not a new variant", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });

    expect(res.statusCode).toBe(409);
    const auditCall = mockDbQuery.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditCall![1]).toContain("topic.write_denied_locked");
  });

  it("records metadata.attempted_operation as topic.archived, not the POST endpoint's topic.custom_added", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });

    expect(res.statusCode).toBe(409);
    const auditCall = mockDbQuery.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    const metadata = JSON.parse((auditCall![1] as unknown[])[5] as string);
    expect(metadata.attempted_operation).toBe("topic.archived");
  });
});

// -----------------------------------------------------------------------
// Task 3.4/4.2/5.4/11.2 — timing floor applied on every branch
// -----------------------------------------------------------------------
describe("DELETE /api/v1/teams/:teamId/topics/:topicId — timing floor applied on every branch", () => {
  beforeEach(() => vi.resetAllMocks());

  it("applies the timing floor on the 403 branch", async () => {
    mockAuthQuery("engineer", false);
    const app = await buildApp();
    await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 404 (team) branch", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(false);
    const app = await buildApp();
    await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 409 lock branch", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();
    const app = await buildApp();
    await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 404 (topic) branch", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(1);
    mockTopicExists(null);
    const app = await buildApp();
    await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 422 branch", async () => {
    mockPassAllArchiveGates("archived");
    const app = await buildApp();
    await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 409 TOPIC_LAST_ACTIVE branch", async () => {
    mockPassAllArchiveGates();
    mockArchiveTransaction({ activeCount: 1 });
    const app = await buildApp();
    await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 200 requiresConfirmation branch", async () => {
    mockPassAllArchiveGates();
    mockArchiveTransaction({ activeCount: 2, openItemsRows: [{ id: "ai-1", description: "open" }] });
    const app = await buildApp();
    await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 200 success branch", async () => {
    mockPassAllArchiveGates();
    mockArchiveTransaction({ activeCount: 2, openItemsRows: [] });
    const app = await buildApp();
    await app.inject({ method: "DELETE", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// POST /api/v1/teams/:teamId/topics/:topicId/restore  (TOPIC-005,
// re-add-removed-topic)
// =============================================================================

/** Standard happy path through all four gate checks TOPIC-005 shares before its transaction. */
function mockPassAllRestoreGates(topicStatus: "archived" = "archived") {
  mockAuthQuery("facilitator", false);
  mockTeamExists(true);
  mockLockCount(1);
  mockTopicExists(topicStatus);
}

/**
 * Mock client for the restore handler's transaction. Queue order:
 * BEGIN, pg_advisory_xact_lock, MAX(display_order) read,
 * UPDATE ... RETURNING (empty rows on the zero-rows race branch),
 * [INSERT audit_log, COMMIT] or [ROLLBACK].
 */
function mockRestoreTransaction(opts: {
  newPosition: number;
  name?: string;
  restoredAt?: Date;
  zeroRows?: boolean;
}) {
  const { newPosition, name = "Topic A", restoredAt = new Date("2026-09-30T00:00:00.000Z"), zeroRows = false } =
    opts;
  const responses: Array<{ rows: unknown[] }> = [
    { rows: [] }, // BEGIN
    { rows: [] }, // pg_advisory_xact_lock
    { rows: [{ new_position: newPosition }] }, // MAX read
  ];

  if (zeroRows) {
    responses.push({ rows: [] }); // UPDATE — zero rows (concurrent race)
    responses.push({ rows: [] }); // ROLLBACK
    const client = makeMockClient(responses);
    mockDbConnect.mockResolvedValueOnce(client);
    return client;
  }

  responses.push({ rows: [{ name, restored_at: restoredAt }] }); // UPDATE
  responses.push({ rows: [] }); // INSERT audit_log
  responses.push({ rows: [] }); // COMMIT
  const client = makeMockClient(responses);
  mockDbConnect.mockResolvedValueOnce(client);
  return client;
}

// -----------------------------------------------------------------------
// Task 2.7/3.9 — identity/role scenarios
// -----------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/topics/:topicId/restore — identity/role (design.md Decision 1)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("a standing facilitator who is not a team member succeeds", async () => {
    mockPassAllRestoreGates();
    mockRestoreTransaction({ newPosition: 3 });

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });

    expect(res.statusCode).toBe(200);
  });

  it("an application_admin succeeds for any team, including one they are an active member of", async () => {
    mockAuthQuery("application_admin", true);
    mockTeamExists(true);
    mockLockCount(1);
    mockTopicExists("archived");
    mockRestoreTransaction({ newPosition: 3 });

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });

    expect(res.statusCode).toBe(200);
  });

  it("a caller who is neither a facilitator nor an admin is rejected 403 NOT_A_FACILITATOR", async () => {
    mockAuthQuery("engineer", false);

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NOT_A_FACILITATOR");
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it("a facilitator who is an active member of the team is rejected 403 FACILITATOR_IS_TEAM_MEMBER", async () => {
    mockAuthQuery("facilitator", true);

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FACILITATOR_IS_TEAM_MEMBER");
  });

  it("treats a caller with no user row the same as not-a-facilitator (403)", async () => {
    mockAuthQueryNoUser();

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NOT_A_FACILITATOR");
  });
});

// -----------------------------------------------------------------------
// Task 2.6 — "Restore Topic evaluates checks in a fixed order"
// -----------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/topics/:topicId/restore — check ordering (design.md Decision 2)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("a non-facilitator against a nonexistent team/topic receives 403, revealing nothing else", async () => {
    mockAuthQuery("engineer", false);

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });

    expect(res.statusCode).toBe(403);
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it("a nonexistent team is rejected 404 before the lock or topic are evaluated", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(false);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/99999999-9999-4999-8999-999999999999/topics/70000000-0000-4000-8000-000000000001/restore",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TEAM_NOT_FOUND");
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
  });

  it("a locked team's rejection (409) takes priority over an already-active topic's state", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TOPIC_CUSTOMIZATION_LOCKED");
    // The topic-existence query is never reached.
    expect(mockDbQuery).toHaveBeenCalledTimes(4);
  });

  it("a nonexistent topic is rejected 404 TOPIC_NOT_FOUND after the lock passes", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(1);
    mockTopicExists(null);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/7000ffff-0000-4000-8000-00000000ffff/restore",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TOPIC_NOT_FOUND");
  });

  it("an already-active topic is rejected 422 TOPIC_ALREADY_ACTIVE, and the transaction is never opened", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(1);
    mockTopicExists("active");

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("TOPIC_ALREADY_ACTIVE");
    expect(mockDbConnect).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------
// Task 3.1/3.5/3.6/3.8 — append-position reposition, zero-rows race, and
// provenance
// -----------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/topics/:topicId/restore — reposition and provenance (design.md Decision 3/4)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("appends the restored topic at max(active display_order) + 1", async () => {
    mockPassAllRestoreGates();
    const client = mockRestoreTransaction({ newPosition: 4 });

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.displayOrder).toBe(4);
    expect(body.status).toBe("active");

    const updateCall = client.query.mock.calls.find((call) => (call[0] as string).includes("UPDATE topics"));
    expect(updateCall).toBeDefined();
    expect((updateCall![1] as unknown[])[0]).toBe(4);
  });

  it("opens the transaction with the advisory lock before the MAX(display_order) read (design.md Decision 3)", async () => {
    mockPassAllRestoreGates();
    const client = mockRestoreTransaction({ newPosition: 2 });

    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });

    const calls = client.query.mock.calls.map((call) => call[0] as string);
    const lockIndex = calls.findIndex((sql) => sql.includes("pg_advisory_xact_lock"));
    const maxIndex = calls.findIndex((sql) => sql.includes("COALESCE(MAX(display_order)"));
    expect(lockIndex).toBeGreaterThan(-1);
    expect(maxIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeLessThan(maxIndex);
  });

  it("the UPDATE leaves archived_at/archived_by untouched, setting only restored_at/restored_by (design.md Decision 4)", async () => {
    mockPassAllRestoreGates();
    const client = mockRestoreTransaction({ newPosition: 2 });

    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });

    const updateCall = client.query.mock.calls.find((call) => (call[0] as string).includes("UPDATE topics"));
    const sql = updateCall![0] as string;
    expect(sql).toContain("restored_at = now()");
    expect(sql).toContain("restored_by = $2");
    expect(sql).not.toContain("archived_at");
    expect(sql).not.toContain("archived_by");
  });

  it("a zero-rows UPDATE (concurrent race) rolls back and responds 422 TOPIC_ALREADY_ACTIVE", async () => {
    mockPassAllRestoreGates();
    const client = mockRestoreTransaction({ newPosition: 2, zeroRows: true });

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("TOPIC_ALREADY_ACTIVE");
    const rollbackCall = client.query.mock.calls.find((call) => call[0] === "ROLLBACK");
    expect(rollbackCall).toBeDefined();
  });
});

// -----------------------------------------------------------------------
// Task 4.3/4.4 — audit logging for successful restores
// -----------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/topics/:topicId/restore — audit logging (design.md Decision 6)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("a successful restore writes a topic.restored audit row", async () => {
    mockPassAllRestoreGates();
    const client = mockRestoreTransaction({ newPosition: 2 });

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });

    expect(res.statusCode).toBe(200);
    const auditCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toContain("topic.restored");
    expect(auditCall![1]).toContain("11111111-1111-4111-8111-111111111111");

    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "topic.restored",
      expect.objectContaining({ teamId: "11111111-1111-4111-8111-111111111111", topicId: "70000000-0000-4000-8000-000000000001" }),
    );
  });

  it("no audit_log row is written when rejected at identity/role (never opens a transaction)", async () => {
    mockAuthQuery("engineer", false);

    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });

    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  it("no topic.restored audit row is written when rejected by the zero-rows race (422)", async () => {
    mockPassAllRestoreGates();
    const client = mockRestoreTransaction({ newPosition: 2, zeroRows: true });

    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });

    const auditCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditCall).toBeUndefined();
  });

  it("the lock-denied rejection is audited under the shared topic.write_denied_locked operation, not a new variant", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });

    expect(res.statusCode).toBe(409);
    const auditCall = mockDbQuery.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditCall![1]).toContain("topic.write_denied_locked");
    const metadata = JSON.parse((auditCall![1] as unknown[])[5] as string);
    expect(metadata.attempted_operation).toBe("topic.restored");
  });
});

// -----------------------------------------------------------------------
// Task 8.2 — timing floor applied on every branch
// -----------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/topics/:topicId/restore — timing floor applied on every branch", () => {
  beforeEach(() => vi.resetAllMocks());

  it("applies the timing floor on the 403 branch", async () => {
    mockAuthQuery("engineer", false);
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 404 (team) branch", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(false);
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 409 lock branch", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 404 (topic) branch", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(1);
    mockTopicExists(null);
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 422 TOPIC_ALREADY_ACTIVE (precheck) branch", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(1);
    mockTopicExists("active");
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 422 TOPIC_ALREADY_ACTIVE (zero-rows race) branch", async () => {
    mockPassAllRestoreGates();
    mockRestoreTransaction({ newPosition: 2, zeroRows: true });
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 200 success branch", async () => {
    mockPassAllRestoreGates();
    mockRestoreTransaction({ newPosition: 2 });
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });
});

// -----------------------------------------------------------------------
// Error envelope shape (design.md Decision 4, matching TOPIC-003/004)
// -----------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/topics/:topicId/restore — error envelope shape", () => {
  beforeEach(() => vi.resetAllMocks());

  it("the 422 TOPIC_ALREADY_ACTIVE rejection carries the stable reason code and message, nested under error", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(1);
    mockTopicExists("active");

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });

    const body = res.json();
    expect(body.error.category).toBe("invalid_request");
    expect(body.error.code).toBe("TOPIC_ALREADY_ACTIVE");
    expect(body.error.message).toBe("This topic is already active.");
    expect(typeof body.error.correlationId).toBe("string");
    expect(body.error.correlationId.length).toBeGreaterThan(0);
  });

  it("never ships a bare top-level { code, message } body without the error envelope", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(1);
    mockTopicExists("active");

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/70000000-0000-4000-8000-000000000001/restore" });

    const body = res.json();
    expect(body.code).toBeUndefined();
    expect(body.message).toBeUndefined();
    expect(body.error).toBeDefined();
  });
});

// ===========================================================================
// PUT /api/v1/teams/:teamId/topics/order  (TOPIC-006, reorder-topics)
// ===========================================================================

const REORDER_URL = "/api/v1/teams/11111111-1111-4111-8111-111111111111/topics/order";
const T1 = "aaaaaaaa-0000-4000-8000-000000000001";
const T2 = "aaaaaaaa-0000-4000-8000-000000000002";
const T3 = "aaaaaaaa-0000-4000-8000-000000000003";
const CURRENT_ROWS = [
  { id: T1, name: "Topic One", display_order: 1 },
  { id: T2, name: "Topic Two", display_order: 2 },
  { id: T3, name: "Topic Three", display_order: 4 },
];

/** Standard happy path through the three gates TOPIC-006 shares before body validation. */
function mockPassAllReorderGates(globalRole: "facilitator" | "application_admin" = "facilitator") {
  mockAuthQuery(globalRole, false);
  mockTeamExists(true);
  mockLockCount(1);
}

/**
 * Mock transaction client for the reorder handler, dispatched on SQL text
 * rather than call position so each test states only what differs.
 */
function makeReorderClient(
  opts: {
    current?: Array<{ id: string; name: string; display_order: number }>;
    phase1Count?: number;
    phase2Count?: number;
    phase2Throws?: boolean;
    openSessionCreatedAt?: Date | null;
  } = {},
) {
  const current = opts.current ?? CURRENT_ROWS;
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.includes("FROM topics") && sql.startsWith("SELECT id, name, display_order")) {
      return { rows: current, rowCount: current.length };
    }
    if (sql.includes("SET display_order = -v.pos")) {
      return { rows: [], rowCount: opts.phase1Count ?? current.length };
    }
    if (sql.includes("SET display_order = -display_order")) {
      if (opts.phase2Throws) throw new Error("simulated phase-2 failure");
      return { rows: [], rowCount: opts.phase2Count ?? current.length };
    }
    if (sql.includes("FROM sessions")) {
      return { rows: opts.openSessionCreatedAt ? [{ opened_at: opts.openSessionCreatedAt }] : [] };
    }
    return { rows: [], rowCount: 0 };
  });
  const client = { query, release: vi.fn() };
  mockDbConnect.mockResolvedValueOnce(client);
  return client;
}

function sqlCalls(client: { query: ReturnType<typeof vi.fn> }): string[] {
  return client.query.mock.calls.map((call) => String(call[0]).trim());
}

function reorderAuditInserts(client: { query: ReturnType<typeof vi.fn> }) {
  return client.query.mock.calls.filter(
    (call) => String(call[0]).includes("INSERT INTO audit_log") && (call[1] as unknown[])[3] === "topic.reordered",
  );
}

async function putOrder(payload: unknown, userId?: string) {
  const app = await buildApp(userId);
  return app.inject({
    method: "PUT",
    url: REORDER_URL,
    headers: { "content-type": "application/json" },
    payload: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Task 3.5 — error cascade (spec "Reorder Topics evaluates checks in a fixed order")
// ---------------------------------------------------------------------------
describe("PUT /api/v1/teams/:teamId/topics/order — check ordering (design.md Decision 2)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a non-facilitator against a nonexistent team receives 403 NOT_A_FACILITATOR, before team or lock", async () => {
    mockAuthQuery("engineer", false);

    const res = await putOrder({ orderedTopicIds: [T1] });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NOT_A_FACILITATOR");
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  it("a facilitator who is a team member receives 403 FACILITATOR_IS_TEAM_MEMBER", async () => {
    mockAuthQuery("facilitator", true);

    const res = await putOrder({ orderedTopicIds: [T1] });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FACILITATOR_IS_TEAM_MEMBER");
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it("a nonexistent team receives 404 TEAM_NOT_FOUND before the lock is evaluated", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(false);

    const res = await putOrder({ orderedTopicIds: [T1] });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.category).toBe("not_found");
    expect(res.json().error.code).toBe("TEAM_NOT_FOUND");
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
  });

  it("a locked team with an empty-array body receives 409 TOPIC_CUSTOMIZATION_LOCKED, not 422", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();

    const res = await putOrder({ orderedTopicIds: [] });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TOPIC_CUSTOMIZATION_LOCKED");
    expect(mockDbConnect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Task 3.6 — malformed bodies, each 422 INVALID_TOPIC_ORDER with no transaction
// ---------------------------------------------------------------------------
describe("PUT /api/v1/teams/:teamId/topics/order — body validation (design.md Decision 2 step 4)", () => {
  beforeEach(() => vi.clearAllMocks());

  const uuid = (n: number) => `bbbbbbbb-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
  const LENGTH_MESSAGE = "orderedTopicIds must contain between 1 and 200 entries.";

  const cases: Array<[string, unknown]> = [
    ["orderedTopicIds missing", {}],
    ["orderedTopicIds not an array", { orderedTopicIds: T1 }],
    ["an empty array", { orderedTopicIds: [] }],
    ["201 valid UUIDs", { orderedTopicIds: Array.from({ length: 201 }, (_, i) => uuid(i)) }],
    ["a non-UUID string entry", { orderedTopicIds: [T1, "not-a-uuid"] }],
    ["a number entry", { orderedTopicIds: [T1, 42] }],
    ["a null entry", { orderedTopicIds: [T1, null] }],
    ["an object entry", { orderedTopicIds: [T1, { id: T2 }] }],
    ["a same-case duplicate", { orderedTopicIds: [T1, T2, T1] }],
    ["a mixed-case duplicate", { orderedTopicIds: [T1, T2, T1.toUpperCase()] }],
    ["a null body", null],
    ["a bare-array body", [T1, T2]],
    ["a string body", "orderedTopicIds"],
  ];

  it.each(cases)("%s → 422 INVALID_TOPIC_ORDER, field orderedTopicIds, no BEGIN and no write", async (_label, payload) => {
    mockPassAllReorderGates();

    const res = await putOrder(payload);

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.category).toBe("invalid_request");
    expect(body.error.code).toBe("INVALID_TOPIC_ORDER");
    expect(body.error.field).toBe("orderedTopicIds");
    expect(mockDbConnect).not.toHaveBeenCalled();
    // auth + team + lock only; nothing reaches the database afterwards.
    expect(mockDbQuery).toHaveBeenCalledTimes(3);
  });

  it("201 non-UUID strings fail on length first (the cap is checked before per-entry work)", async () => {
    mockPassAllReorderGates();

    const res = await putOrder({ orderedTopicIds: Array.from({ length: 201 }, (_, i) => `junk-${i}`) });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toBe(LENGTH_MESSAGE);
  });

  it("the 422 message never echoes a submitted value", async () => {
    mockPassAllReorderGates();
    const probe = "probe-value-<script>";

    const res = await putOrder({ orderedTopicIds: [T1, probe] });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).not.toContain(probe);
    expect(res.body).not.toContain(probe);
  });
});

// ---------------------------------------------------------------------------
// Task 3.7 / 5.11 — exit invariants: timing floor exactly once and
// Cache-Control: no-store on every handled exit.
// ---------------------------------------------------------------------------
describe("PUT /api/v1/teams/:teamId/topics/order — timing floor and no-store on every handled exit", () => {
  beforeEach(() => vi.clearAllMocks());

  const exits: Array<[string, () => void, unknown, number]> = [
    ["403 NOT_A_FACILITATOR", () => mockAuthQuery("engineer", false), { orderedTopicIds: [T1] }, 403],
    ["403 FACILITATOR_IS_TEAM_MEMBER", () => mockAuthQuery("facilitator", true), { orderedTopicIds: [T1] }, 403],
    [
      "404 TEAM_NOT_FOUND",
      () => {
        mockAuthQuery("facilitator", false);
        mockTeamExists(false);
      },
      { orderedTopicIds: [T1] },
      404,
    ],
    [
      "409 TOPIC_CUSTOMIZATION_LOCKED",
      () => {
        mockAuthQuery("facilitator", false);
        mockTeamExists(true);
        mockLockCount(0);
        mockDenialAuditInsert();
      },
      { orderedTopicIds: [T1] },
      409,
    ],
    ["422 INVALID_TOPIC_ORDER", () => mockPassAllReorderGates(), { orderedTopicIds: [] }, 422],
    [
      "409 TOPIC_ORDER_STALE",
      () => {
        mockPassAllReorderGates();
        makeReorderClient();
      },
      { orderedTopicIds: [T1, T2] },
      409,
    ],
    [
      "200 no-op",
      () => {
        mockPassAllReorderGates();
        makeReorderClient();
      },
      { orderedTopicIds: [T1, T2, T3] },
      200,
    ],
    [
      "200 changed",
      () => {
        mockPassAllReorderGates();
        makeReorderClient();
      },
      { orderedTopicIds: [T3, T1, T2] },
      200,
    ],
  ];

  it.each(exits)("%s applies the floor exactly once and sets Cache-Control: no-store", async (_label, arrange, payload, status) => {
    arrange();

    const res = await putOrder(payload);

    expect(res.statusCode).toBe(status);
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("the thrown-path 500 from the global error handler also carries Cache-Control: no-store", async () => {
    mockPassAllReorderGates();
    makeReorderClient({ phase2Throws: true });

    const res = await putOrder({ orderedTopicIds: [T3, T1, T2] });

    expect(res.statusCode).toBe(500);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

// ---------------------------------------------------------------------------
// Tasks 4.1/5.6 — stale set mismatch (unit): constant body, rolled back, no audit
// ---------------------------------------------------------------------------
describe("PUT /api/v1/teams/:teamId/topics/order — stale set (design.md Decision 4)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("takes the advisory lock as the first statement after BEGIN and reads the team-scoped active set", async () => {
    mockPassAllReorderGates();
    const client = makeReorderClient();

    await putOrder({ orderedTopicIds: [T3, T1, T2] });

    const calls = sqlCalls(client);
    expect(calls[0]).toBe("BEGIN");
    expect(calls[1]).toContain("pg_advisory_xact_lock(hashtext($1::uuid::text))");
    expect(calls[2]).toContain("WHERE team_id = $1 AND status = 'active'");
    expect(calls[2]).toContain("ORDER BY display_order, id");
  });

  it("missing, extra, and unknown IDs all return an identical 409 TOPIC_ORDER_STALE body and roll back", async () => {
    const variants = [
      [T1, T2],
      [T1, T2, T3, "cccccccc-0000-4000-8000-000000000009"],
      [T1, T2, "cccccccc-0000-4000-8000-000000000009"],
    ];
    const bodies: Array<{ category: string; code: string; message: string }> = [];

    for (const ids of variants) {
      vi.clearAllMocks();
      mockPassAllReorderGates();
      const client = makeReorderClient();

      const res = await putOrder({ orderedTopicIds: ids });

      expect(res.statusCode).toBe(409);
      const { category, code, message } = res.json().error;
      bodies.push({ category, code, message });
      expect(sqlCalls(client)).toContain("ROLLBACK");
      expect(sqlCalls(client)).not.toContain("COMMIT");
      expect(sqlCalls(client).some((sql) => sql.startsWith("UPDATE"))).toBe(false);
      expect(reorderAuditInserts(client)).toHaveLength(0);
      expect(mockEmitAuditEvent).not.toHaveBeenCalled();
      expect(res.body).not.toContain("cccccccc");
      expect(res.body).not.toContain(T3);
    }

    expect(bodies[0]).toEqual({
      category: "precondition_failed",
      code: "TOPIC_ORDER_STALE",
      message: bodies[0]!.message,
    });
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });
});

// ---------------------------------------------------------------------------
// Tasks 4.3/5.3 — no-op (unit)
// ---------------------------------------------------------------------------
describe("PUT /api/v1/teams/:teamId/topics/order — no-op (design.md Decision 2 step 6)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("submitting the current order returns 200 { topics, openSessionCreatedAt }, writes nothing, and emits nothing", async () => {
    mockPassAllReorderGates();
    const createdAt = new Date("2026-09-30T12:00:00.000Z");
    const client = makeReorderClient({ openSessionCreatedAt: createdAt });

    const res = await putOrder({ orderedTopicIds: [T1, T2, T3] });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      topics: [
        { topicId: T1, name: "Topic One", displayOrder: 1 },
        { topicId: T2, name: "Topic Two", displayOrder: 2 },
        { topicId: T3, name: "Topic Three", displayOrder: 4 },
      ],
      openSessionCreatedAt: createdAt.toISOString(),
    });
    expect(sqlCalls(client).some((sql) => sql.startsWith("UPDATE"))).toBe(false);
    expect(reorderAuditInserts(client)).toHaveLength(0);
    expect(sqlCalls(client)).toContain("COMMIT");
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tasks 4.4/4.6/5.10 — changed save, audit row, structured-log event (unit)
// ---------------------------------------------------------------------------
describe("PUT /api/v1/teams/:teamId/topics/order — changed save and audit (design.md Decisions 3, 6)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renumbers in two phases, audits in the transaction, emits after COMMIT, and returns dense 1-based order", async () => {
    mockPassAllReorderGates();
    const client = makeReorderClient();

    const res = await putOrder({ orderedTopicIds: [T3.toUpperCase(), T1, T2] });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      topics: [
        { topicId: T3, name: "Topic Three", displayOrder: 1 },
        { topicId: T1, name: "Topic One", displayOrder: 2 },
        { topicId: T2, name: "Topic Two", displayOrder: 3 },
      ],
      openSessionCreatedAt: null,
    });

    const calls = sqlCalls(client);
    const phase1 = calls.findIndex((sql) => sql.includes("SET display_order = -v.pos"));
    const phase2 = calls.findIndex((sql) => sql.includes("SET display_order = -display_order"));
    const audit = calls.findIndex((sql) => sql.startsWith("INSERT INTO audit_log"));
    const commit = calls.indexOf("COMMIT");
    expect(phase1).toBeGreaterThan(-1);
    expect(phase2).toBeGreaterThan(phase1);
    expect(audit).toBeGreaterThan(phase2);
    expect(commit).toBeGreaterThan(audit);

    // Phase 1 binds the lowercased IDs as a JS array.
    expect(client.query.mock.calls[phase1]![1]).toEqual(["11111111-1111-4111-8111-111111111111", [T3, T1, T2]]);

    const inserts = reorderAuditInserts(client);
    expect(inserts).toHaveLength(1);
    const params = inserts[0]![1] as unknown[];
    expect(params[0]).toBe("facilitator-1");
    expect(params[1]).toBe("facilitator");
    expect(params[4]).toBe("11111111-1111-4111-8111-111111111111");
    const metadata = JSON.parse(params[5] as string);
    expect(metadata).toEqual({ previous_order: [T1, T2, T3], new_order: [T3, T1, T2] });
    expect(params[5]).not.toContain("Topic");

    expect(mockEmitAuditEvent).toHaveBeenCalledTimes(1);
    const [, event, fields] = mockEmitAuditEvent.mock.calls[0]!;
    expect(event).toBe("topic.reordered");
    expect(Object.keys(fields as object).sort()).toEqual(
      ["actorGlobalRole", "actorIp", "actorUserId", "teamId", "topicCount"].sort(),
    );
    expect(fields).toMatchObject({ actorUserId: "facilitator-1", teamId: "11111111-1111-4111-8111-111111111111", topicCount: 3 });
    // emitAuditEvent runs only after COMMIT has been issued.
    const commitCallIndex = client.query.mock.invocationCallOrder[commit]!;
    const emitCallIndex = mockEmitAuditEvent.mock.invocationCallOrder[0]!;
    expect(emitCallIndex).toBeGreaterThan(commitCallIndex);
  });

  it("the lock denial writes topic.write_denied_locked with attempted_operation topic.reordered and no order payload", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();

    const res = await putOrder({ orderedTopicIds: [T1, T2] });

    expect(res.statusCode).toBe(409);
    const denial = mockDbQuery.mock.calls.find((call) => String(call[0]).includes("INSERT INTO audit_log"));
    expect(denial).toBeDefined();
    const params = denial![1] as unknown[];
    expect(params[3]).toBe("topic.write_denied_locked");
    expect(JSON.parse(params[5] as string)).toEqual({
      endpoint: "PUT /api/v1/teams/:teamId/topics/order",
      attempted_operation: "topic.reordered",
    });
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "topic.write_denied_locked",
      expect.objectContaining({ attemptedOperation: "topic.reordered" }),
    );
  });

  it.each([
    ["403", () => mockAuthQuery("engineer", false), { orderedTopicIds: [T1] }],
    [
      "404",
      () => {
        mockAuthQuery("facilitator", false);
        mockTeamExists(false);
      },
      { orderedTopicIds: [T1] },
    ],
    ["422", () => mockPassAllReorderGates(), { orderedTopicIds: [] }],
  ])("a %s writes no audit row and emits no event", async (_label, arrange, payload) => {
    arrange();

    await putOrder(payload);

    expect(mockDbQuery.mock.calls.some((call) => String(call[0]).includes("INSERT INTO audit_log"))).toBe(false);
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tasks 4.2/5.8 — openSessionCreatedAt, and the admin security boundary (unit)
// ---------------------------------------------------------------------------
describe("PUT /api/v1/teams/:teamId/topics/order — openSessionCreatedAt (design.md Decision 7)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("for a facilitator, returns the open session's room-open time (falling back to created_at) and filters out draft and terminal statuses", async () => {
    mockPassAllReorderGates("facilitator");
    const createdAt = new Date("2026-09-30T12:00:00.000Z");
    const client = makeReorderClient({ openSessionCreatedAt: createdAt });

    const res = await putOrder({ orderedTopicIds: [T3, T1, T2] });

    expect(res.json().openSessionCreatedAt).toBe(createdAt.toISOString());
    const sessionsSql = sqlCalls(client).find((sql) => sql.includes("FROM sessions"));
    expect(sessionsSql).toContain("status IN ('lobby', 'pre_session', 'active', 'wrap_up')");
    expect(sessionsSql).not.toContain("draft");
    // session-topics-snapshot-at-creation design.md Decision 5: room open,
    // with created_at only as the pre-migration-20 fallback.
    expect(sessionsSql).toContain("COALESCE(room_opened_at, created_at) AS opened_at");
    expect(sessionsSql).toContain("ORDER BY COALESCE(room_opened_at, created_at) DESC");
    expect(sessionsSql).toContain("LIMIT 1");
  });

  it.each([
    ["changed save", [T3, T1, T2]],
    ["no-op", [T1, T2, T3]],
  ])("for an application_admin (%s), returns null and never queries sessions", async (_label, ids) => {
    mockPassAllReorderGates("application_admin");
    const client = makeReorderClient({ openSessionCreatedAt: new Date("2026-09-30T12:00:00.000Z") });

    const res = await putOrder({ orderedTopicIds: ids });

    expect(res.statusCode).toBe(200);
    expect(res.json().openSessionCreatedAt).toBeNull();
    expect(sqlCalls(client).some((sql) => sql.includes("sessions"))).toBe(false);
    expect(mockDbQuery.mock.calls.some((call) => /FROM sessions\s+WHERE team_id = \$1 AND status IN/.test(String(call[0])))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tasks 5.4/5.5 — forced failure and row-count guard (unit, mocked client)
// ---------------------------------------------------------------------------
describe("PUT /api/v1/teams/:teamId/topics/order — atomicity and row-count guard (design.md Decision 3)", () => {
  beforeEach(() => vi.clearAllMocks());

  function expectRolledBackWithoutAudit(client: { query: ReturnType<typeof vi.fn> }) {
    expect(sqlCalls(client)).toContain("ROLLBACK");
    expect(sqlCalls(client)).not.toContain("COMMIT");
    expect(reorderAuditInserts(client)).toHaveLength(0);
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  }

  it("a phase-2 UPDATE failure rolls back, writes no audit row, emits nothing, and responds 500", async () => {
    mockPassAllReorderGates();
    const client = makeReorderClient({ phase2Throws: true });

    const res = await putOrder({ orderedTopicIds: [T3, T1, T2] });

    expect(res.statusCode).toBe(500);
    expectRolledBackWithoutAudit(client);
    expect(client.release).toHaveBeenCalled();
  });

  it.each([
    ["phase 1", { phase1Count: 2 }],
    ["phase 2", { phase2Count: 4 }],
  ])("a %s row-count mismatch throws ReorderRowCountMismatchError, rolls back, and responds 500", async (_label, counts) => {
    mockPassAllReorderGates();
    const client = makeReorderClient(counts);
    const thrown: unknown[] = [];
    const app = Fastify();
    app.decorateRequest("session", null);
    app.addHook("onRequest", async (request) => {
      (request as unknown as Record<string, unknown>).session = { userId: "facilitator-1" };
    });
    app.setErrorHandler((err, _req, reply) => {
      thrown.push(err);
      return reply.code(500).send({ error: { category: "internal" } });
    });
    app.register(topicRoutes);
    await app.ready();

    const res = await app.inject({
      method: "PUT",
      url: REORDER_URL,
      payload: { orderedTopicIds: [T3, T1, T2] },
    });

    expect(res.statusCode).toBe(500);
    expect(thrown).toHaveLength(1);
    expect((thrown[0] as Error).name).toBe("ReorderRowCountMismatchError");
    expectRolledBackWithoutAudit(client);
  });
});

// ---------------------------------------------------------------------------
// Implementation review M1/MF1 (session-topics-snapshot-at-creation): every
// topic write route rejects a non-canonical teamId at the route boundary,
// before the authorization query, so a spelling Postgres would resolve to a
// real team never reaches the member-denial check, and a malformed id never
// raises 22P02. Real-DB counterpart: session-topic-snapshot-integration.test.ts.
// ---------------------------------------------------------------------------
describe("topic write routes — non-canonical teamId (implementation review M1)", () => {
  beforeEach(() => vi.clearAllMocks());

  const TOPIC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const spellings = [
    ["hyphenless", "11111111111141118111111111111111"],
    ["braced", "{11111111-1111-4111-8111-111111111111}"],
    ["malformed", "not-a-uuid"],
    // #188 tasks.md 2.3: the template team's own non-canonical spellings are
    // rejected here too, before any query -- so no template-denial row.
    ["hyphenless template", "00000000000000000000000000000001"],
    ["braced template", "{00000000-0000-0000-0000-000000000001}"],
  ] as const;
  const routes = [
    ["POST add", "POST", (t: string) => `/api/v1/teams/${t}/topics`, { name: "X", prompt: "Y?", voteType: "finger" }],
    ["DELETE archive", "DELETE", (t: string) => `/api/v1/teams/${t}/topics/${TOPIC}?confirm=true`, undefined],
    ["POST restore", "POST", (t: string) => `/api/v1/teams/${t}/topics/${TOPIC}/restore`, {}],
    ["PUT reorder", "PUT", (t: string) => `/api/v1/teams/${t}/topics/order`, { orderedTopicIds: [TOPIC] }],
    ["PUT annotation", "PUT", (t: string) => `/api/v1/teams/${t}/topics/${TOPIC}/annotation`, { annotation: "x" }],
  ] as const;

  for (const [routeLabel, method, url, payload] of routes) {
    it.each(spellings)(`${routeLabel}: a %s teamId is 404 TEAM_NOT_FOUND before any query`, async (_label, bad) => {
      const app = await buildApp();
      const res = await app.inject({
        method,
        url: url(encodeURIComponent(bad)),
        ...(payload === undefined ? {} : { payload }),
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toMatchObject({ category: "not_found", code: "TEAM_NOT_FOUND" });
      expect(mockDbQuery).not.toHaveBeenCalled();
      expect(mockDbConnect).not.toHaveBeenCalled();
      expect(mockApplyTimingFloor).toHaveBeenCalled();
    });
  }
});

// ---------------------------------------------------------------------------
// reject-template-team-topic-writes (#188) — tasks.md 2.1/2.2. Every
// team-scoped topic-write endpoint answers the __default_topics__ template
// team with the missing-team 404, after authorization and before the lock,
// and writes one topic.write_denied_template audit row (design.md D1-D3).
// The mock call order for non-template teams is unchanged (D2): the template
// check is a constant comparison after the existing existence query.
// ---------------------------------------------------------------------------
const TEMPLATE_TEAM_ID = "00000000-0000-0000-0000-000000000001";
const TEMPLATE_TOPIC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const TEMPLATE_ROUTES = [
  {
    label: "TOPIC-003 add",
    method: "POST",
    url: `/api/v1/teams/${TEMPLATE_TEAM_ID}/topics`,
    payload: VALID_BODY as object | undefined,
    endpoint: "POST /api/v1/teams/:teamId/topics",
    attemptedOperation: "topic.custom_added",
    noStore: false,
  },
  {
    label: "TOPIC-004 archive",
    method: "DELETE",
    url: `/api/v1/teams/${TEMPLATE_TEAM_ID}/topics/${TEMPLATE_TOPIC}?confirm=true`,
    payload: undefined,
    endpoint: "DELETE /api/v1/teams/:teamId/topics/:topicId",
    attemptedOperation: "topic.archived",
    noStore: false,
  },
  {
    label: "TOPIC-005 restore",
    method: "POST",
    url: `/api/v1/teams/${TEMPLATE_TEAM_ID}/topics/${TEMPLATE_TOPIC}/restore`,
    payload: {},
    endpoint: "POST /api/v1/teams/:teamId/topics/:topicId/restore",
    attemptedOperation: "topic.restored",
    noStore: false,
  },
  {
    label: "TOPIC-006 reorder",
    method: "PUT",
    url: `/api/v1/teams/${TEMPLATE_TEAM_ID}/topics/order`,
    payload: { orderedTopicIds: [TEMPLATE_TOPIC] },
    endpoint: "PUT /api/v1/teams/:teamId/topics/order",
    attemptedOperation: "topic.reordered",
    noStore: true,
  },
  {
    label: "TOPIC-007 annotation",
    method: "PUT",
    url: `/api/v1/teams/${TEMPLATE_TEAM_ID}/topics/${TEMPLATE_TOPIC}/annotation`,
    payload: { annotation: "x" },
    endpoint: "PUT /api/v1/teams/:teamId/topics/:topicId/annotation",
    attemptedOperation: "topic.annotation_updated",
    noStore: true,
  },
] as const;

type TemplateRoute = (typeof TEMPLATE_ROUTES)[number];

/** buildApp plus a spy on request.log.error (the audit-failure log, design.md D3). */
async function buildAppWithErrorLogSpy(userId: string) {
  const errorLog = vi.fn();
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
    const log = Object.create(request.log) as typeof request.log;
    log.error = errorLog as unknown as typeof log.error;
    request.log = log;
  });
  app.register(topicRoutes);
  await app.ready();
  return { app, errorLog };
}

function injectTemplate(app: Awaited<ReturnType<typeof buildApp>>, route: TemplateRoute) {
  return app.inject({
    method: route.method,
    url: route.url,
    ...(route.payload === undefined ? {} : { payload: route.payload }),
  });
}

function templateAuditCalls() {
  return mockDbQuery.mock.calls.filter(
    (c) => typeof c[0] === "string" && (c[0] as string).includes("INSERT INTO audit_log"),
  );
}

function lockQueryCalls() {
  return mockDbQuery.mock.calls.filter(
    (c) => typeof c[0] === "string" && (c[0] as string).includes("FROM sessions"),
  );
}

describe("topic write routes — template team rejected as 404 (#188, tasks.md 2.1)", () => {
  beforeEach(() => vi.clearAllMocks());

  for (const route of TEMPLATE_ROUTES) {
    it(`${route.label}: a facilitator gets 404 TEAM_NOT_FOUND, one template-denial audit row and event, no lock check`, async () => {
      mockAuthQuery("facilitator", false);
      mockTeamExists(true);
      mockDenialAuditInsert();

      const { app } = await buildAppWithErrorLogSpy("facilitator-1");
      const res = await injectTemplate(app, route);

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toMatchObject({ category: "not_found", code: "TEAM_NOT_FOUND", message: "Team not found." });
      expect(lockQueryCalls()).toHaveLength(0);
      expect(mockDbQuery).toHaveBeenCalledTimes(3);
      expect(mockDbConnect).not.toHaveBeenCalled();

      const audits = templateAuditCalls();
      expect(audits).toHaveLength(1);
      const params = audits[0]![1] as unknown[];
      expect(params[0]).toBe("facilitator-1");
      expect(params[1]).toBe("facilitator");
      expect(params[3]).toBe("topic.write_denied_template");
      expect(params[4]).toBe(TEMPLATE_TEAM_ID);
      const metadata = JSON.parse(params[5] as string);
      expect(metadata).toEqual({ endpoint: route.endpoint, attempted_operation: route.attemptedOperation });
      expect(metadata).not.toHaveProperty("correlationId");

      // Timing floor applied after the audit insert, before the response.
      expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
      expect(mockApplyTimingFloor.mock.invocationCallOrder[0]!).toBeGreaterThan(
        mockDbQuery.mock.invocationCallOrder[2]!,
      );

      expect(mockEmitAuditEvent).toHaveBeenCalledTimes(1);
      expect(mockEmitAuditEvent).toHaveBeenCalledWith(expect.anything(), "topic.write_denied_template", {
        actorUserId: "facilitator-1",
        actorGlobalRole: "facilitator",
        actorIp: expect.any(String),
        teamId: TEMPLATE_TEAM_ID,
        endpoint: route.endpoint,
        attemptedOperation: route.attemptedOperation,
        correlationId: body.error.correlationId,
        auditRowWritten: true,
      });
    });

    it(`${route.label}: an engineer gets 403 NOT_A_FACILITATOR with no template audit`, async () => {
      mockAuthQuery("engineer", false);

      const app = await buildApp("engineer-1");
      const res = await injectTemplate(app, route);

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("NOT_A_FACILITATOR");
      expect(mockDbQuery).toHaveBeenCalledTimes(1);
      expect(templateAuditCalls()).toHaveLength(0);
      expect(mockEmitAuditEvent).not.toHaveBeenCalled();
    });
  }

  for (const route of TEMPLATE_ROUTES.filter((r) => r.attemptedOperation !== "topic.annotation_updated")) {
    it(`${route.label}: an application_admin gets 404 with the template-denial row attributed to application_admin`, async () => {
      mockAuthQuery("application_admin", false);
      mockTeamExists(true);
      mockDenialAuditInsert();

      const app = await buildApp("admin-1");
      const res = await injectTemplate(app, route);

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("TEAM_NOT_FOUND");
      expect(lockQueryCalls()).toHaveLength(0);
      const audits = templateAuditCalls();
      expect(audits).toHaveLength(1);
      expect((audits[0]![1] as unknown[])[1]).toBe("application_admin");
    });
  }

  it("TOPIC-007 annotation: an application_admin gets 403 with no template audit (FR-8.7)", async () => {
    mockAuthQuery("application_admin", false);

    const app = await buildApp("admin-1");
    const res = await injectTemplate(app, TEMPLATE_ROUTES[4]);

    expect(res.statusCode).toBe(403);
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
    expect(templateAuditCalls()).toHaveLength(0);
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });
});

describe("topic write routes — template audit insert failure (#188, tasks.md 2.2)", () => {
  beforeEach(() => vi.clearAllMocks());

  for (const route of [TEMPLATE_ROUTES[0], TEMPLATE_ROUTES[3]]) {
    it(`${route.label}: a failed audit insert still answers the same 404 (not 500) and leaves a complete log trace`, async () => {
      mockAuthQuery("facilitator", false);
      mockTeamExists(true);
      mockDbQuery.mockRejectedValueOnce(
        Object.assign(new Error("connection terminated"), { code: "57P01", detail: "secret", parameters: ["x"] }),
      );

      const { app, errorLog } = await buildAppWithErrorLogSpy("facilitator-1");
      const res = await injectTemplate(app, route);

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toMatchObject({ category: "not_found", code: "TEAM_NOT_FOUND", message: "Team not found." });
      if (route.noStore) {
        expect(res.headers["cache-control"]).toBe("no-store");
      } else {
        expect(res.headers["cache-control"]).toBeUndefined();
      }
      expect(lockQueryCalls()).toHaveLength(0);
      expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);

      expect(errorLog).toHaveBeenCalledTimes(1);
      const [logObj] = errorLog.mock.calls[0]! as [Record<string, unknown>];
      expect(logObj).toEqual({
        audit_write_failed: true,
        operation: "topic.write_denied_template",
        correlationId: body.error.correlationId,
        dbErrorCode: "57P01",
        dbErrorMessage: "connection terminated",
      });
      expect(logObj).not.toHaveProperty("err");

      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        "topic.write_denied_template",
        expect.objectContaining({
          actorUserId: "facilitator-1",
          actorGlobalRole: "facilitator",
          actorIp: expect.any(String),
          endpoint: route.endpoint,
          attemptedOperation: route.attemptedOperation,
          correlationId: body.error.correlationId,
          auditRowWritten: false,
        }),
      );
    });
  }
});
