import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// zero-topic-team-recovery (#200) tasks.md 3.1 -- the mock-based half of the
// assign-defaults suite: the pieces a real database cannot show cleanly. The
// ORDER of calls (the limiter after the 403 and before the team lookup, the
// event only after COMMIT), the timing floor on every return, the rollback and
// release on every path out of the transaction, and the fixed 500s. The same
// mock shape as topics.test.ts. Behaviour against real rows is in
// assign-defaults-integration.test.ts.
// ---------------------------------------------------------------------------
const mockDbQuery = vi.fn();
const mockDbConnect = vi.fn();
const mockEmitAuditEvent = vi.fn();
const mockRecordDenial = vi.fn().mockResolvedValue(undefined);
const mockRecordFailure = vi.fn().mockResolvedValue(undefined);
const mockCopy = vi.fn();
const mockApplyTimingFloor = vi.fn().mockResolvedValue(undefined);
const callLog: string[] = [];

vi.mock("../../db.js", () => ({
  db: {
    query: (...args: unknown[]) => mockDbQuery(...args),
    connect: () => mockDbConnect(),
  },
}));
vi.mock("../../auth/audit-logger.js", () => ({
  emitAuditEvent: (...args: unknown[]) => mockEmitAuditEvent(...args),
}));
vi.mock("../../content/timing-oracle.js", () => ({
  applyTimingFloor: (...args: unknown[]) => mockApplyTimingFloor(...args),
  CONTENT_TIMING_FLOOR_MS: 150,
}));
vi.mock("../../auth/assign-defaults-audit.js", () => ({
  ASSIGN_DEFAULTS_ENDPOINT: "POST /api/v1/teams/:teamId/topics/assign-defaults",
  recordDenial: (...args: unknown[]) => mockRecordDenial(...args),
  recordFailure: (...args: unknown[]) => mockRecordFailure(...args),
}));
vi.mock("../../sessions/default-topics.js", async (importOriginal) => {
  const actual = await importOriginal<typeof DefaultTopicsModule>();
  return { ...actual, copyCanonicalDefaults: (...args: unknown[]) => mockCopy(...args) };
});
// #184 5.4a: the shared limiter stand-in (helpers/topic-write-rate-limit-mock.ts).
// Its enforceTopicWriteRateLimit is a vi.fn, so the ordering tests below give
// it an implementation that logs the call (and, for a rejection, answers 429).
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
import { enforceTopicWriteRateLimit } from "./helpers/topic-write-rate-limit-mock.js";
import { topicRoutes } from "../topics.js";
import { DEFAULT_TOPICS_TEAM_ID, DefaultTopicsUnavailableError } from "../../sessions/default-topics.js";
import type * as DefaultTopicsModule from "../../sessions/default-topics.js";

// (request, reply, ctx, startTime) -> "allowed" | "rejected"; typed loosely on purpose.
const mockLimiter = vi.mocked(enforceTopicWriteRateLimit) as unknown as ReturnType<typeof vi.fn>;

const TEAM = "11111111-1111-4111-8111-111111111111";
const URL = `/api/v1/teams/${TEAM}/topics/assign-defaults`;

function buildApp(userId = "admin-1") {
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
  });
  app.register(topicRoutes);
  return app.ready().then(() => app);
}

/** Pool queries in order: the live role read, then the team-existence read. */
function mockPoolReads(role: string | null, teamExists = true) {
  mockDbQuery.mockImplementation(async (sql: string) => {
    callLog.push(sql.includes("FROM users") ? "role-read" : sql.includes("FROM teams") ? "team-lookup" : "pool-query");
    if (sql.includes("FROM users")) return { rows: role === null ? [] : [{ global_role: role }] };
    if (sql.includes("FROM teams")) return { rows: teamExists ? [{ id: TEAM }] : [] };
    return { rows: [] };
  });
}

interface ClientOpts {
  activeCount?: number;
  failOn?: RegExp;
}
function mockClient(opts: ClientOpts = {}) {
  const client = {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      callLog.push(`client:${sql.trim().split(/\s+/).slice(0, 3).join(" ")}`);
      if (opts.failOn?.test(sql)) throw Object.assign(new Error("duplicate key value violates unique constraint SECRET_SQL_TEXT"), { code: "23505" });
      if (sql.includes("count(*)")) return { rows: [{ n: opts.activeCount ?? 0 }] };
      return { rows: [] };
    }),
    release: vi.fn(() => callLog.push("release")),
  };
  mockDbConnect.mockResolvedValue(client);
  return client;
}

const sqls = (client: ReturnType<typeof mockClient>) => client.query.mock.calls.map((c) => String(c[0]).trim());

beforeEach(() => {
  vi.clearAllMocks();
  callLog.length = 0;
  mockApplyTimingFloor.mockResolvedValue(undefined);
  mockRecordDenial.mockResolvedValue(undefined);
  mockRecordFailure.mockResolvedValue(undefined);
  mockLimiter.mockImplementation(async () => {
    callLog.push("limiter");
    return "allowed";
  });
  mockEmitAuditEvent.mockReset();
  mockCopy.mockResolvedValue(["t1", "t2", "t3"]);
});

describe("POST assign-defaults -- check order (design.md D2)", () => {
  it("a non-admin gets 403 before the limiter and before any team lookup; the denial is recorded before the floor", async () => {
    mockPoolReads("facilitator");
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: URL });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatchObject({ category: "forbidden", code: "NOT_AN_ADMIN" });
    expect(mockLimiter).not.toHaveBeenCalled();
    expect(callLog).toEqual(["role-read"]); // no team lookup, no lock, no transaction
    expect(mockDbConnect).not.toHaveBeenCalled();
    expect(mockRecordDenial).toHaveBeenCalledTimes(1);
    expect(mockRecordDenial.mock.calls[0]![0]).toMatchObject({
      actorUserId: "admin-1",
      actorGlobalRole: "facilitator",
      teamId: TEAM,
      correlationId: res.json().error.correlationId,
    });
    expect(mockRecordDenial.mock.invocationCallOrder[0]!).toBeLessThan(mockApplyTimingFloor.mock.invocationCallOrder[0]!);
  });

  it("a caller with no users row is a non-admin (role passed to the denial as null)", async () => {
    mockPoolReads(null);
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: URL });

    expect(res.statusCode).toBe(403);
    expect(mockRecordDenial.mock.calls[0]![0]).toMatchObject({ actorGlobalRole: null });
  });

  it("an admin: role read, then the limiter, then the team lookup, in that order", async () => {
    mockPoolReads("application_admin");
    mockClient();
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: URL });

    expect(res.statusCode).toBe(201);
    expect(callLog.slice(0, 3)).toEqual(["role-read", "limiter", "team-lookup"]);
  });

  it("a rate-limited admin stops at the limiter: no team lookup, no transaction", async () => {
    mockPoolReads("application_admin");
    mockLimiter.mockImplementation(async (_request: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
      callLog.push("limiter");
      await reply.code(429).send({ error: { category: "rate_limited" } });
      return "rejected";
    });
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: URL });

    expect(res.statusCode).toBe(429);
    expect(callLog).toEqual(["role-read", "limiter"]);
    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  it("a non-canonical team id is 404 before the role read", async () => {
    mockPoolReads("application_admin");
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: "/api/v1/teams/not-a-uuid/topics/assign-defaults" });

    expect(res.statusCode).toBe(404);
    expect(callLog).toEqual([]);
  });

  it("the id is lowercased once, immediately after the canonical check", async () => {
    mockPoolReads("application_admin");
    const client = mockClient();
    const app = await buildApp();

    await app.inject({ method: "POST", url: `/api/v1/teams/${TEAM.toUpperCase()}/topics/assign-defaults` });

    expect(mockCopy).toHaveBeenCalledWith(client, TEAM);
    const auditInsert = client.query.mock.calls.find((c) => String(c[0]).includes("INSERT INTO audit_log"))!;
    expect((auditInsert[1] as unknown[])[4]).toBe(TEAM);
  });
});

describe("POST assign-defaults -- the transaction", () => {
  it("takes the lock, then counts as a fresh statement, then copies, audits and commits; the event follows COMMIT", async () => {
    mockPoolReads("application_admin");
    const client = mockClient();
    mockEmitAuditEvent.mockImplementation(() => callLog.push("emit"));
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: URL });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ topicCount: 3 });
    const statements = sqls(client).map((s) => s.split(/\s+/).slice(0, 2).join(" "));
    expect(statements).toEqual(["BEGIN", "SELECT pg_advisory_xact_lock(hashtext($1::uuid::text))".split(/\s+/).slice(0, 2).join(" "), "SELECT count(*)::int", "INSERT INTO", "COMMIT"]);
    expect(sqls(client).some((s) => /ISOLATION/i.test(s))).toBe(false);
    const order = callLog.filter((c) => c === "client:COMMIT" || c === "emit" || c === "release");
    expect(order).toEqual(["client:COMMIT", "release", "emit"]);
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(expect.anything(), "topic.defaults_assigned", expect.objectContaining({ topicCount: 3 }));
    const insert = client.query.mock.calls.find((c) => String(c[0]).includes("INSERT INTO audit_log"))!;
    expect(insert[1]).toEqual([
      "admin-1",
      "application_admin",
      "127.0.0.1",
      "topic.defaults_assigned",
      TEAM,
      JSON.stringify({ topic_count: 3, correlation_id: "req-1" }),
    ]);
  });

  it("a team with active topics: ROLLBACK, release, 409, and no copy, no audit insert, no event", async () => {
    mockPoolReads("application_admin");
    const client = mockClient({ activeCount: 2 });
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: URL });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ category: "precondition_failed", code: "TEAM_HAS_ACTIVE_TOPICS" });
    expect(sqls(client).at(-1)).toBe("ROLLBACK");
    expect(sqls(client).some((s) => s.startsWith("COMMIT"))).toBe(false);
    expect(mockCopy).not.toHaveBeenCalled();
    expect(sqls(client).some((s) => s.includes("INSERT INTO audit_log"))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  it("a throwing emit AFTER commit still returns 201", async () => {
    mockPoolReads("application_admin");
    mockClient();
    mockEmitAuditEvent.mockImplementation(() => {
      throw new Error("log sink down");
    });
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: URL });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ topicCount: 3 });
  });

  it("an unrelated fault (forced insert error): ROLLBACK, release, fixed 500 ASSIGN_DEFAULTS_FAILED, no database text, no failure row", async () => {
    mockPoolReads("application_admin");
    const client = mockClient();
    mockCopy.mockRejectedValue(Object.assign(new Error("duplicate key value violates unique constraint SECRET_SQL_TEXT"), { code: "23505" }));
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: URL });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatchObject({ category: "internal_error", code: "ASSIGN_DEFAULTS_FAILED" });
    expect(res.json().error.correlationId).toBeTruthy();
    expect(res.body).not.toContain("SECRET_SQL_TEXT");
    expect(res.body).not.toContain("duplicate key");
    expect(sqls(client).at(-1)).toBe("ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(mockRecordFailure).not.toHaveBeenCalled();
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  it("a failed audit insert on the success path rolls back and answers the generic 500", async () => {
    mockPoolReads("application_admin");
    const client = mockClient({ failOn: /INSERT INTO audit_log/ });
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: URL });

    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("ASSIGN_DEFAULTS_FAILED");
    expect(res.body).not.toContain("SECRET_SQL_TEXT");
    expect(sqls(client).some((s) => s.startsWith("COMMIT"))).toBe(false);
    expect(sqls(client).at(-1)).toBe("ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  it("a failing COMMIT is also the generic 500, never the template-empty code", async () => {
    mockPoolReads("application_admin");
    const client = mockClient({ failOn: /^COMMIT/ });
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: URL });

    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("ASSIGN_DEFAULTS_FAILED");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("an empty template: rollback, 500 DEFAULT_TOPICS_UNAVAILABLE with the settled sentence, then the fail-open failure row", async () => {
    mockPoolReads("application_admin");
    const client = mockClient();
    mockCopy.mockRejectedValue(new DefaultTopicsUnavailableError());
    const logged: Array<[Record<string, unknown>, string]> = [];
    const app = await buildApp();
    app.log.error = ((obj: Record<string, unknown>, msg: string) => void logged.push([obj, msg])) as never;

    const res = await app.inject({ method: "POST", url: URL });

    expect(res.statusCode).toBe(500);
    const { error } = res.json() as { error: { code: string; message: string; correlationId: string } };
    expect(error.code).toBe("DEFAULT_TOPICS_UNAVAILABLE");
    expect(error.message).toBe(
      'The default topic template is empty or unavailable, so nothing was assigned. An operator needs to fix the default topic template (see "Zero-topic teams" in the deployment runbook, docs/deployment.md), then try again.',
    );
    expect(res.body).not.toContain(DEFAULT_TOPICS_TEAM_ID);
    expect(sqls(client).at(-1)).toBe("ROLLBACK");
    expect(sqls(client).some((s) => s.includes("INSERT INTO audit_log"))).toBe(false);
    // The failure row is written after the rollback, with the response's correlation id and no template id.
    expect(mockRecordFailure).toHaveBeenCalledTimes(1);
    expect(mockRecordFailure.mock.calls[0]![0]).toMatchObject({
      actorUserId: "admin-1",
      teamId: TEAM,
      reason: "DEFAULT_TOPICS_UNAVAILABLE",
      correlationId: error.correlationId,
    });
    expect(JSON.stringify(mockRecordFailure.mock.calls[0]![0])).not.toContain(DEFAULT_TOPICS_TEAM_ID);
    expect(callLog.indexOf("client:ROLLBACK")).toBeLessThan(callLog.indexOf("release"));
    void logged;
  });
});

describe("POST assign-defaults -- the timing floor is applied once on every return", () => {
  const cases: Array<[string, number, () => void]> = [
    ["201", 201, () => { mockPoolReads("application_admin"); mockClient(); }],
    ["403", 403, () => { mockPoolReads("engineer"); }],
    ["404 missing team", 404, () => { mockPoolReads("application_admin", false); }],
    ["409", 409, () => { mockPoolReads("application_admin"); mockClient({ activeCount: 1 }); }],
    ["500 generic", 500, () => { mockPoolReads("application_admin"); mockClient(); mockCopy.mockRejectedValue(new Error("boom")); }],
    ["500 empty template", 500, () => { mockPoolReads("application_admin"); mockClient(); mockCopy.mockRejectedValue(new DefaultTopicsUnavailableError()); }],
  ];

  it.each(cases)("%s", async (_label, status, arrange) => {
    arrange();
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: URL });

    expect(res.statusCode).toBe(status);
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("the template team 404 also applies the floor once, after its denial audit", async () => {
    mockPoolReads("application_admin");
    mockDbQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users")) return { rows: [{ global_role: "application_admin" }] };
      return { rows: [{ id: DEFAULT_TOPICS_TEAM_ID }] };
    });
    const app = await buildApp();

    const res = await app.inject({ method: "POST", url: `/api/v1/teams/${DEFAULT_TOPICS_TEAM_ID}/topics/assign-defaults` });

    expect(res.statusCode).toBe(404);
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
    expect(mockDbConnect).not.toHaveBeenCalled();
  });
});
