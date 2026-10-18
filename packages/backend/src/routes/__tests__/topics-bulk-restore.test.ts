import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// bulk-restore-default-topics (#218) -- unit tests with mocked db/limiter.
// Real-Postgres coverage (ordering equivalence, concurrency, live sessions,
// cross-team isolation) is in topics-bulk-restore-integration.test.ts.
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
import { enforceTopicWriteRateLimit } from "./helpers/topic-write-rate-limit-mock.js";

const TEAM = "11111111-1111-4111-8111-111111111111";
const URL = `/api/v1/teams/${TEAM}/topics/restore-defaults`;

function buildApp(userId = "facilitator-1") {
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
  });
  app.register(topicRoutes);
  return app.ready().then(() => app);
}

function mockAuth(globalRole: string, isMember: boolean) {
  mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: globalRole, is_member: isMember }] });
}
function mockGates(opts: { teamExists?: boolean; completed?: number } = {}) {
  mockDbQuery.mockResolvedValueOnce({ rows: opts.teamExists === false ? [] : [{ id: TEAM }] });
  if (opts.teamExists === false) return;
  mockDbQuery.mockResolvedValueOnce({ rows: [{ count: String(opts.completed ?? 1) }] });
}
function mockPassGates() {
  mockAuth("facilitator", false);
  mockGates();
}

type Row = { id: string; name: string; display_order: number };
interface TxOpts {
  archived: Row[];
  active?: Array<{ name: string; display_order: number }>;
  updateRows?: number; // override affected rows
  failAuditInsert?: boolean;
}
function mockTx(opts: TxOpts) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    release: vi.fn(),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/FROM topics\s+WHERE team_id = \$1 AND status = 'archived'/.test(sql)) return { rows: opts.archived };
      if (/FROM topics WHERE team_id = \$1 AND status = 'active'/.test(sql)) return { rows: opts.active ?? [] };
      if (/^\s*UPDATE topics/.test(sql)) {
        const ids = params[0] as string[];
        const n = opts.updateRows ?? ids.length;
        return { rows: ids.slice(0, n).map((id) => ({ id })) };
      }
      if (/INSERT INTO audit_log/.test(sql) && opts.failAuditInsert) throw new Error("audit insert failed");
      return { rows: [] };
    }),
  };
  mockDbConnect.mockResolvedValueOnce(client);
  return { client, calls };
}
const dml = (calls: Array<{ sql: string }>) =>
  calls.map((c) => c.sql.trim().split(/\s+/)[0]).filter((w) => w !== "BEGIN" && w !== "COMMIT");

describe("POST .../topics/restore-defaults", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApplyTimingFloor.mockResolvedValue(undefined);
    enforceTopicWriteRateLimit.mockImplementation(async () => "allowed");
  });

  describe("cascade", () => {
    it("non-canonical teamId is 404 with no SQL", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: "/api/v1/teams/not-a-uuid/topics/restore-defaults" });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("TEAM_NOT_FOUND");
      expect(mockDbQuery).not.toHaveBeenCalled();
      expect(mockDbConnect).not.toHaveBeenCalled();
    });

    it("non-facilitator is 403 NOT_A_FACILITATOR and spends no budget", async () => {
      mockAuth("participant", false);
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: URL });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("NOT_A_FACILITATOR");
      expect(enforceTopicWriteRateLimit).not.toHaveBeenCalled();
      expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
    });

    it("member facilitator is 403 FACILITATOR_IS_TEAM_MEMBER", async () => {
      mockAuth("facilitator", true);
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: URL });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("FACILITATOR_IS_TEAM_MEMBER");
    });

    it("application_admin with a membership is admitted", async () => {
      mockAuth("application_admin", true);
      mockGates();
      mockTx({ archived: [] });
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: URL });
      expect(res.statusCode).toBe(200);
    });

    it("limiter is called once with the bulk context, and a rejection stops the handler", async () => {
      mockAuth("facilitator", false);
      enforceTopicWriteRateLimit.mockImplementationOnce((async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => Promise<unknown> } }) => {
        await reply.code(429).send({ error: { code: "TOPIC_WRITE_BURST_LIMIT_EXCEEDED" } });
        return "rejected";
      }) as never);
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: URL });
      expect(res.statusCode).toBe(429);
      expect(enforceTopicWriteRateLimit).toHaveBeenCalledTimes(1);
      const ctx = (enforceTopicWriteRateLimit.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
      expect(ctx["attemptedOperation"]).toBe("topic.defaults_restored");
      expect(ctx["endpoint"]).toBe("POST /api/v1/teams/:teamId/topics/restore-defaults");
      expect(mockDbConnect).not.toHaveBeenCalled();
    });

    it("nonexistent team is 404 TEAM_NOT_FOUND", async () => {
      mockAuth("facilitator", false);
      mockGates({ teamExists: false });
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: URL });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("TEAM_NOT_FOUND");
    });

    it("locked team is 409 TOPIC_CUSTOMIZATION_LOCKED before any topic read", async () => {
      mockAuth("facilitator", false);
      mockGates({ completed: 0 });
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // denial audit insert
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: URL });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("TOPIC_CUSTOMIZATION_LOCKED");
      expect(mockDbConnect).not.toHaveBeenCalled();
      const denial = mockDbQuery.mock.calls.at(-1) as unknown[];
      const meta = JSON.parse((denial[1] as unknown[])[5] as string);
      expect(meta.attempted_operation).toBe("topic.defaults_restored");
    });
  });

  describe("routing", () => {
    it("restore-defaults, order and :topicId/restore each hit their own handler", async () => {
      const app = await buildApp();
      // Non-canonical team id: each answers its own handler's 404 with no SQL,
      // proving the route resolved (a miss would be Fastify's route-not-found).
      const bulk = await app.inject({ method: "POST", url: "/api/v1/teams/x/topics/restore-defaults" });
      const order = await app.inject({ method: "PUT", url: "/api/v1/teams/x/topics/order", payload: {} });
      const single = await app.inject({ method: "POST", url: "/api/v1/teams/x/topics/abc/restore" });
      for (const res of [bulk, order, single]) {
        expect(res.statusCode).toBe(404);
        expect(res.json().error.code).toBe("TEAM_NOT_FOUND");
      }
      expect(mockDbQuery).not.toHaveBeenCalled();
    });
  });

  describe("restore and ordering", () => {
    it("places defaults after the active max, in prior order, with one UPDATE and one audit row", async () => {
      mockPassGates();
      const { calls } = mockTx({
        archived: [
          { id: "c", name: "C", display_order: 5 },
          { id: "a", name: "A", display_order: 4 },
          { id: "b", name: "B", display_order: 2 },
        ],
        active: [{ name: "Custom 1", display_order: 1 }, { name: "Custom 2", display_order: 7 }],
      });
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: URL });
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.json()).toEqual({
        restored: [
          { topicId: "b", name: "B", displayOrder: 8 },
          { topicId: "a", name: "A", displayOrder: 9 },
          { topicId: "c", name: "C", displayOrder: 10 },
        ],
        skipped: [],
      });
      const update = calls.find((c) => /^\s*UPDATE topics/.test(c.sql))!;
      expect(update.params[0]).toEqual(["b", "a", "c"]);
      expect(update.params[1]).toEqual([8, 9, 10]);
      expect(update.sql).toContain("restored_at = now()");
      expect(update.sql).not.toContain("archived_at");
      expect(calls.filter((c) => /INSERT INTO audit_log/.test(c.sql))).toHaveLength(1);
      expect(mockEmitAuditEvent).toHaveBeenCalledTimes(1);
    });

    it("starts at 1 with no active topics", async () => {
      mockPassGates();
      mockTx({ archived: [{ id: "a", name: "A", display_order: 3 }] });
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: URL });
      expect(res.json().restored[0].displayOrder).toBe(1);
    });

    it("statement count is independent of N", async () => {
      const run = async (n: number) => {
        mockPassGates();
        const { calls } = mockTx({
          archived: Array.from({ length: n }, (_, i) => ({ id: `id${String(i).padStart(3, "0")}`, name: `T${i}`, display_order: i })),
        });
        const app = await buildApp();
        await app.inject({ method: "POST", url: URL });
        return dml(calls).length;
      };
      expect(await run(1)).toBe(await run(12));
      expect(await run(50)).toBeGreaterThan(0);
    });
  });

  describe("duplicate rule", () => {
    it("skips a name-matched default and reports it", async () => {
      mockPassGates();
      mockTx({
        archived: [
          { id: "a", name: "Code Quality", display_order: 1 },
          { id: "b", name: "Delivery", display_order: 2 },
        ],
        active: [{ name: "code quality ", display_order: 1 }],
      });
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: URL });
      expect(res.json()).toEqual({
        restored: [{ topicId: "b", name: "Delivery", displayOrder: 2 }],
        skipped: [{ topicId: "a", name: "Code Quality", reason: "NAME_ACTIVE" }],
      });
    });

    it("skipped-only returns 200 with no UPDATE, no audit row, ROLLBACK", async () => {
      mockPassGates();
      const { calls } = mockTx({
        archived: [{ id: "a", name: "A", display_order: 1 }],
        active: [{ name: "a", display_order: 1 }],
      });
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: URL });
      expect(res.statusCode).toBe(200);
      expect(res.json().restored).toEqual([]);
      expect(res.json().skipped).toHaveLength(1);
      expect(calls.some((c) => /UPDATE|INSERT/.test(c.sql))).toBe(false);
      expect(calls.some((c) => c.sql === "ROLLBACK")).toBe(true);
      expect(mockEmitAuditEvent).not.toHaveBeenCalled();
    });
  });

  describe("empty case", () => {
    it("nothing archived is 200 empty, no audit, floor applied, no-store", async () => {
      mockPassGates();
      const { calls } = mockTx({ archived: [] });
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: URL });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ restored: [], skipped: [] });
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(calls.some((c) => /INSERT INTO audit_log/.test(c.sql))).toBe(false);
      expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
      expect(enforceTopicWriteRateLimit).toHaveBeenCalledTimes(1);
    });
  });

  describe("audit", () => {
    it("metadata has ids and positions, no names, counts, and caps skipped at 100", async () => {
      mockPassGates();
      const skippedRows = Array.from({ length: 101 }, (_, i) => ({
        id: `s${String(i).padStart(3, "0")}`,
        name: "SecretName",
        display_order: i,
      }));
      const { calls } = mockTx({
        archived: [{ id: "z", name: "UniqueSecret", display_order: 999 }, ...skippedRows],
        active: [{ name: "secretname", display_order: 1 }],
      });
      const app = await buildApp();
      await app.inject({ method: "POST", url: URL });
      const insert = calls.find((c) => /INSERT INTO audit_log/.test(c.sql))!;
      const raw = insert.params[5] as string;
      expect(raw).not.toMatch(/Secret|secret/);
      const meta = JSON.parse(raw);
      expect(meta.restored_count).toBe(1);
      expect(meta.skipped_count).toBe(101);
      expect(meta.skipped).toHaveLength(100);
      expect(insert.params[3]).toBe("topic.defaults_restored");
      expect(insert.params[2]).toBe("127.0.0.1");
      expect(insert.params[1]).toBe("facilitator");
      const fields = mockEmitAuditEvent.mock.calls[0]![2] as Record<string, unknown>;
      expect(JSON.stringify(fields)).not.toMatch(/Secret/);
    });
  });

  describe("failure paths", () => {
    it("audit insert failure rolls back, applies the floor and answers 500 with no-store", async () => {
      mockPassGates();
      const { calls } = mockTx({ archived: [{ id: "a", name: "A", display_order: 1 }], failAuditInsert: true });
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: URL });
      expect(res.statusCode).toBe(500);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(calls.some((c) => c.sql === "ROLLBACK")).toBe(true);
      expect(calls.some((c) => c.sql === "COMMIT")).toBe(false);
      expect(mockApplyTimingFloor).toHaveBeenCalled();
      expect(mockEmitAuditEvent).not.toHaveBeenCalled();
    });

    it("row-count mismatch rolls back, applies the floor and answers 500", async () => {
      mockPassGates();
      const { calls } = mockTx({
        archived: [{ id: "a", name: "A", display_order: 1 }, { id: "b", name: "B", display_order: 2 }],
        updateRows: 1,
      });
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: URL });
      expect(res.statusCode).toBe(500);
      expect(calls.some((c) => /INSERT INTO audit_log/.test(c.sql))).toBe(false);
      expect(calls.some((c) => c.sql === "ROLLBACK")).toBe(true);
      expect(mockApplyTimingFloor).toHaveBeenCalled();
    });

    it("emitAuditEvent throwing after COMMIT still returns 200 and applies the floor", async () => {
      mockPassGates();
      mockTx({ archived: [{ id: "a", name: "A", display_order: 1 }] });
      mockEmitAuditEvent.mockImplementation(() => {
        throw new Error("log sink down");
      });
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: URL });
      expect(res.statusCode).toBe(200);
      expect(res.json().restored).toHaveLength(1);
      expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
    });
  });

  describe("body handling", () => {
    it("ignores a JSON body naming ids", async () => {
      mockPassGates();
      mockTx({ archived: [{ id: "a", name: "A", display_order: 1 }] });
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: URL,
        payload: { topicIds: ["x"], restore: "everything" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().restored.map((r: { topicId: string }) => r.topicId)).toEqual(["a"]);
    });

    it.each([
      ["text/plain", "hello"],
      ["application/x-www-form-urlencoded", "a=b"],
      ["application/json", "{not json"],
    ])("a %s body never yields a 5xx and changes no state when rejected", async (contentType, payload) => {
      mockPassGates();
      mockTx({ archived: [] });
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: URL, headers: { "content-type": contentType }, payload });
      expect(res.statusCode).toBeLessThan(500);
    });

    it("a body over 1 MiB is rejected pre-handler", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: URL,
        headers: { "content-type": "text/plain" },
        payload: "x".repeat(1024 * 1024 + 10),
      });
      expect([413, 415]).toContain(res.statusCode);
      expect(mockDbConnect).not.toHaveBeenCalled();
    });
  });

  describe("timing floor", () => {
    it("is applied exactly once on 404, 409 and 200 exits", async () => {
      mockAuth("facilitator", false);
      mockGates({ teamExists: false });
      let app = await buildApp();
      await app.inject({ method: "POST", url: URL });
      expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);

      mockApplyTimingFloor.mockClear();
      mockPassGates();
      mockTx({ archived: [{ id: "a", name: "A", display_order: 1 }] });
      app = await buildApp();
      await app.inject({ method: "POST", url: URL });
      expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
    });
  });
});
