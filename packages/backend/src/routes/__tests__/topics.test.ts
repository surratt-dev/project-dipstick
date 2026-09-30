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
  mockDbQuery.mockResolvedValueOnce({ rows: exists ? [{ id: "team-1" }] : [] });
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
  mockDbQuery.mockResolvedValueOnce({ rows: status ? [{ id: "topic-1", status }] : [] });
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
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: VALID_BODY });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NOT_A_FACILITATOR");
    // Only the auth query ran — no team-existence or lock query reached.
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it("a same-team-member facilitator receives 403 FACILITATOR_IS_TEAM_MEMBER, not 404 or 409", async () => {
    mockAuthQuery("facilitator", true);

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: VALID_BODY });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FACILITATOR_IS_TEAM_MEMBER");
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it("a standing, non-member facilitator against a nonexistent team receives 404, not 409", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(false);

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/nonexistent-team/topics", payload: VALID_BODY });

    expect(res.statusCode).toBe(404);
    // auth query + team-existence query only — lock-check never reached.
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
  });

  it("a standing, non-member facilitator against a locked, existing team receives 409, not 404", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: VALID_BODY });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TOPIC_CUSTOMIZATION_LOCKED");
  });

  it("a non-facilitator submitting an invalid body still receives 403, not 422", async () => {
    mockAuthQuery("engineer", false);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/topics",
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
      url: "/api/v1/teams/team-1/topics",
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
      url: "/api/v1/teams/nonexistent-team/topics",
      payload: { prompt: "" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("treats a caller with no user row the same as not-a-facilitator (403)", async () => {
    mockAuthQueryNoUser();

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: VALID_BODY });

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
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/deactivated-team/topics", payload: VALID_BODY });

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
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: VALID_BODY });

    expect(res.statusCode).toBe(409);

    const auditCall = mockDbQuery.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toContain("topic.write_denied_locked");
    expect(auditCall![1]).toContain("team-1");

    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "topic.write_denied_locked",
      expect.objectContaining({ teamId: "team-1" }),
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
      url: "/api/v1/teams/team-1/topics",
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
      url: "/api/v1/teams/team-1/topics",
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
      url: "/api/v1/teams/team-1/topics",
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
      url: "/api/v1/teams/team-1/topics",
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
      url: "/api/v1/teams/team-1/topics",
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
      url: "/api/v1/teams/team-1/topics",
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
      url: "/api/v1/teams/team-1/topics",
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
      url: "/api/v1/teams/team-1/topics",
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
        url: "/api/v1/teams/team-1/topics",
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
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: VALID_BODY });

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
      url: "/api/v1/teams/team-1/topics",
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
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: VALID_BODY });

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
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: VALID_BODY });

    expect(res.json().displayOrder).toBe(7);
  });

  it("accepts a duplicate prompt without a uniqueness check (Task 5.5)", async () => {
    mockPassAllGates();
    mockSuccessfulInsertTransaction();

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: VALID_BODY });

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
    await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: VALID_BODY });

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
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: VALID_BODY });

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
      expect.objectContaining({ teamId: "team-1", topicId: "topic-audit-1" }),
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
    await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: VALID_BODY });

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
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: VALID_BODY });

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
      app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: { ...VALID_BODY, name: "Topic A" } }),
      app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: { ...VALID_BODY, name: "Topic B" } }),
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
    await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: VALID_BODY });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 404 branch", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(false);
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: VALID_BODY });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 409 branch", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: VALID_BODY });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 422 branch", async () => {
    mockPassAllGates();
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: { name: "" } });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 201 success branch", async () => {
    mockPassAllGates();
    mockSuccessfulInsertTransaction();
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: VALID_BODY });
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
        url: "/api/v1/teams/team-1/topics",
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
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: VALID_BODY });

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
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: VALID_BODY });

    const body = res.json();
    expect(body.error.category).toBe("forbidden");
    expect(body.error.code).toBe("NOT_A_FACILITATOR");
  });

  it("the 403 FACILITATOR_IS_TEAM_MEMBER rejection carries a distinct reason code", async () => {
    mockAuthQuery("facilitator", true);

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: VALID_BODY });

    const body = res.json();
    expect(body.error.code).toBe("FACILITATOR_IS_TEAM_MEMBER");
  });

  it("never ships a bare top-level { code, message } body without the error envelope", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics", payload: VALID_BODY });

    const body = res.json();
    expect(body.code).toBeUndefined();
    expect(body.message).toBeUndefined();
    expect(body.error).toBeDefined();
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
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });

    expect(res.statusCode).toBe(200);
  });

  it("an application_admin succeeds for any team, including one they are an active member of", async () => {
    mockAuthQuery("application_admin", true);
    mockTeamExists(true);
    mockLockCount(1);
    mockTopicExists("active");
    mockArchiveTransaction({ activeCount: 2 });

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });

    expect(res.statusCode).toBe(200);
  });

  it("a caller who is neither a facilitator nor an admin is rejected 403 NOT_A_FACILITATOR", async () => {
    mockAuthQuery("engineer", false);

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NOT_A_FACILITATOR");
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it("a facilitator who is an active member of the team is rejected 403 FACILITATOR_IS_TEAM_MEMBER", async () => {
    mockAuthQuery("facilitator", true);

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FACILITATOR_IS_TEAM_MEMBER");
  });

  it("treats a caller with no user row the same as not-a-facilitator (403)", async () => {
    mockAuthQueryNoUser();

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });

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
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });

    expect(res.statusCode).toBe(403);
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it("a nonexistent team is rejected 404 before the lock or topic are evaluated", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(false);

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/nonexistent-team/topics/topic-1" });

    expect(res.statusCode).toBe(404);
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
  });

  it("a locked team's rejection (409) takes priority over an already-archived topic's state", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });

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
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/nonexistent-topic" });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TOPIC_NOT_FOUND");
  });

  it("an already-archived topic is rejected 422 TOPIC_ALREADY_ARCHIVED", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(1);
    mockTopicExists("archived");

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("TOPIC_ALREADY_ARCHIVED");
  });

  it("an already-archived topic's 422 takes priority over the last-active-topic guard (the transaction is never opened)", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(1);
    mockTopicExists("archived");

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });

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
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TOPIC_LAST_ACTIVE");
  });

  it("archiving one of several (3+) active topics succeeds, decrementing the active count by exactly one", async () => {
    mockPassAllArchiveGates();
    const client = mockArchiveTransaction({ activeCount: 3 });

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });

    expect(res.statusCode).toBe(200);
    const updateCall = client.query.mock.calls.find((call) => (call[0] as string).includes("UPDATE topics"));
    expect(updateCall).toBeDefined();
  });

  it("opens the transaction with the advisory lock before the active-count read (design.md Decision 3)", async () => {
    mockPassAllArchiveGates();
    const client = mockArchiveTransaction({ activeCount: 2 });

    const app = await buildApp();
    await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });

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
        return Promise.resolve({ rows: [{ id: "team-1" }] });
      }
      if (text.includes("FROM sessions WHERE team_id")) {
        return Promise.resolve({ rows: [{ count: "1" }] });
      }
      if (text.includes("FROM topics WHERE id")) {
        return Promise.resolve({ rows: [{ id: "topic-1", status: "active" }] });
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
      app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-a" }),
      app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-b" }),
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
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });

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
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });

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
      url: "/api/v1/teams/team-1/topics/topic-1?confirm=true",
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
      url: "/api/v1/teams/team-1/topics/topic-1?confirm=true",
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
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });

    expect(res.statusCode).toBe(200);
    const auditCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toContain("topic.archived");
    expect(auditCall![1]).toContain("team-1");
    expect((auditCall![1] as unknown[])[5] as string).toContain('"openActionItemCount":0');

    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "topic.archived",
      expect.objectContaining({ teamId: "team-1", topicId: "topic-1", openActionItemCount: 0 }),
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
    await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1?confirm=true" });

    const auditCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect((auditCall![1] as unknown[])[5] as string).toContain('"openActionItemCount":3');
  });

  it("no audit_log row is written via the transaction client when rejected by identity/role (never opens a transaction)", async () => {
    mockAuthQuery("engineer", false);

    const app = await buildApp();
    await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });

    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  it("no topic.archived audit row is written when the request only receives requiresConfirmation", async () => {
    mockPassAllArchiveGates();
    const client = mockArchiveTransaction({
      activeCount: 2,
      openItemsRows: [{ id: "ai-1", description: "open" }],
    });

    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });

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
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });

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
    const res = await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });

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
    await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 404 (team) branch", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(false);
    const app = await buildApp();
    await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 409 lock branch", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();
    const app = await buildApp();
    await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 404 (topic) branch", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(1);
    mockTopicExists(null);
    const app = await buildApp();
    await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 422 branch", async () => {
    mockPassAllArchiveGates("archived");
    const app = await buildApp();
    await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 409 TOPIC_LAST_ACTIVE branch", async () => {
    mockPassAllArchiveGates();
    mockArchiveTransaction({ activeCount: 1 });
    const app = await buildApp();
    await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 200 requiresConfirmation branch", async () => {
    mockPassAllArchiveGates();
    mockArchiveTransaction({ activeCount: 2, openItemsRows: [{ id: "ai-1", description: "open" }] });
    const app = await buildApp();
    await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 200 success branch", async () => {
    mockPassAllArchiveGates();
    mockArchiveTransaction({ activeCount: 2, openItemsRows: [] });
    const app = await buildApp();
    await app.inject({ method: "DELETE", url: "/api/v1/teams/team-1/topics/topic-1" });
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
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });

    expect(res.statusCode).toBe(200);
  });

  it("an application_admin succeeds for any team, including one they are an active member of", async () => {
    mockAuthQuery("application_admin", true);
    mockTeamExists(true);
    mockLockCount(1);
    mockTopicExists("archived");
    mockRestoreTransaction({ newPosition: 3 });

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });

    expect(res.statusCode).toBe(200);
  });

  it("a caller who is neither a facilitator nor an admin is rejected 403 NOT_A_FACILITATOR", async () => {
    mockAuthQuery("engineer", false);

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NOT_A_FACILITATOR");
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it("a facilitator who is an active member of the team is rejected 403 FACILITATOR_IS_TEAM_MEMBER", async () => {
    mockAuthQuery("facilitator", true);

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FACILITATOR_IS_TEAM_MEMBER");
  });

  it("treats a caller with no user row the same as not-a-facilitator (403)", async () => {
    mockAuthQueryNoUser();

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });

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
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });

    expect(res.statusCode).toBe(403);
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it("a nonexistent team is rejected 404 before the lock or topic are evaluated", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(false);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/nonexistent-team/topics/topic-1/restore",
    });

    expect(res.statusCode).toBe(404);
    expect(mockDbQuery).toHaveBeenCalledTimes(2);
  });

  it("a locked team's rejection (409) takes priority over an already-active topic's state", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });

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
      url: "/api/v1/teams/team-1/topics/nonexistent-topic/restore",
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
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });

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
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });

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
    await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });

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
    await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });

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
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });

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
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });

    expect(res.statusCode).toBe(200);
    const auditCall = client.query.mock.calls.find((call) =>
      (call[0] as string).includes("INSERT INTO audit_log"),
    );
    expect(auditCall).toBeDefined();
    expect(auditCall![1]).toContain("topic.restored");
    expect(auditCall![1]).toContain("team-1");

    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "topic.restored",
      expect.objectContaining({ teamId: "team-1", topicId: "topic-1" }),
    );
  });

  it("no audit_log row is written when rejected at identity/role (never opens a transaction)", async () => {
    mockAuthQuery("engineer", false);

    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });

    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  it("no topic.restored audit row is written when rejected by the zero-rows race (422)", async () => {
    mockPassAllRestoreGates();
    const client = mockRestoreTransaction({ newPosition: 2, zeroRows: true });

    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });

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
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });

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
    await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 404 (team) branch", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(false);
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 409 lock branch", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 404 (topic) branch", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(1);
    mockTopicExists(null);
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 422 TOPIC_ALREADY_ACTIVE (precheck) branch", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(1);
    mockTopicExists("active");
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 422 TOPIC_ALREADY_ACTIVE (zero-rows race) branch", async () => {
    mockPassAllRestoreGates();
    mockRestoreTransaction({ newPosition: 2, zeroRows: true });
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("applies the timing floor on the 200 success branch", async () => {
    mockPassAllRestoreGates();
    mockRestoreTransaction({ newPosition: 2 });
    const app = await buildApp();
    await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });
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
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });

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
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/team-1/topics/topic-1/restore" });

    const body = res.json();
    expect(body.code).toBeUndefined();
    expect(body.message).toBeUndefined();
    expect(body.error).toBeDefined();
  });
});
