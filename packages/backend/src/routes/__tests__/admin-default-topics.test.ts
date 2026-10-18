import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type * as MaintenanceModule from "../../sessions/default-topic-maintenance.js";

// ---------------------------------------------------------------------------
// admin-default-topic-maintenance (#216): the seven routes as a unit test, with no database,
// Redis or session store. The role read, the writer, the limiter and the denial seam are mocked;
// the route module's own behaviour is real: the preParsing admission (role first, then the
// mutation-control header), the check order (415, id syntax 404, rate limit, 422), the parser and
// error-handler envelopes, the error table, and the listUnavailable path. The same behaviour
// against real Postgres and Redis is in admin-default-topics-*-integration.test.ts.
// ---------------------------------------------------------------------------

const m = vi.hoisted(() => ({
  query: vi.fn(),
  write: vi.fn(),
  list: vi.fn(),
  history: vi.fn(),
  denial: vi.fn(),
  floor: vi.fn(),
}));

vi.mock("../../db.js", () => ({ db: { query: (...a: unknown[]) => m.query(...a) } }));
vi.mock("../../config.js", () => ({ config: { DATABASE_URL: "postgres://test", REDIS_URL: "redis://test" } }));
vi.mock("../../content/timing-oracle.js", () => ({
  applyTimingFloor: (...a: unknown[]) => m.floor(...a),
  CONTENT_TIMING_FLOOR_MS: 150,
}));
vi.mock("../topic-write-rate-limit.js", () => import("./helpers/topic-write-rate-limit-mock.js"));
vi.mock("../../auth/default-maintenance-denial-audit.js", () => ({
  recordMaintenanceDenial: (...a: unknown[]) => m.denial(...a),
}));
vi.mock("../../sessions/default-topic-maintenance.js", async (importOriginal) => {
  const actual = await importOriginal<typeof MaintenanceModule>();
  return {
    ...actual,
    writeTemplateTopics: (...a: unknown[]) => m.write(...a),
    readTemplateList: (...a: unknown[]) => m.list(...a),
    readTemplateHistory: (...a: unknown[]) => m.history(...a),
  };
});

import { adminDefaultTopicRoutes } from "../admin-default-topics.js";
import { enforceTopicWriteRateLimit } from "./helpers/topic-write-rate-limit-mock.js";
import { AuditWriteError } from "../../auth/errors.js";
import {
  BackstopError,
  MaintenanceError,
  RENAME_NOTICE,
  SCOPE_STATEMENT,
  type MaintenanceErrorCode,
} from "../../sessions/default-topic-maintenance.js";

const BASE = "/api/v1/admin/default-topics";
const ID = "11111111-1111-4111-8111-111111111111";
const HDR = { "x-requested-with": "dipstick" };
const LIST = { defaults: [{ id: ID, name: "A", status: "active", displayOrder: 1 }], limits: { maxActive: 15 }, orderLastChangedAt: null };
const validAdd = { name: "New", prompt: "Prompt?", firstSessionDescription: "About.", voteType: "finger" };

let app: FastifyInstance;
let role: string | null;
let userId: string;

async function build(): Promise<FastifyInstance> {
  const a = Fastify();
  a.decorateRequest("session", null as never);
  a.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
  });
  await a.register(adminDefaultTopicRoutes);
  await a.ready();
  return a;
}

beforeEach(async () => {
  vi.clearAllMocks();
  role = "application_admin";
  userId = "admin-1";
  m.query.mockImplementation(async () => ({ rows: role === null ? [] : [{ global_role: role }] }));
  m.floor.mockResolvedValue(undefined);
  m.denial.mockResolvedValue(undefined);
  m.list.mockResolvedValue(LIST);
  m.history.mockResolvedValue([{ id: "h1" }]);
  m.write.mockResolvedValue({ unchanged: false, operation: "topic.default_edited", renamed: false, list: LIST, changedTopicId: ID });
  enforceTopicWriteRateLimit.mockImplementation(async () => "allowed");
  app = await build();
});
afterEach(async () => {
  await app.close();
});

const inject = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, opts: { payload?: unknown; headers?: Record<string, string> } = {}) =>
  app.inject({ method, url, headers: opts.headers ?? {}, ...(opts.payload !== undefined ? { payload: opts.payload as object } : {}) });

describe("authorization runs first, in preParsing, on all seven routes", () => {
  const SEVEN: Array<["GET" | "POST" | "PUT" | "PATCH", string]> = [
    ["GET", BASE], ["GET", `${BASE}/history`], ["POST", BASE], ["PUT", `${BASE}/order`],
    ["PATCH", `${BASE}/${ID}`], ["POST", `${BASE}/${ID}/archive`], ["POST", `${BASE}/${ID}/restore`],
  ];

  it.each([["facilitator"], ["engineering_manager"], [null]])("a %s gets the envelope 403, a denial record with the route TEMPLATE, the floor, and no write", async (r) => {
    role = r;
    for (const [method, url] of SEVEN) {
      const res = await inject(method, url, { headers: HDR });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json().error).toMatchObject({ category: "forbidden", code: "DEFAULT_MAINTENANCE_ADMIN_ONLY" });
      expect(res.headers["cache-control"]).toBe("no-store");
    }
    expect(m.denial).toHaveBeenCalledTimes(7);
    expect(m.denial.mock.calls.map((c) => (c[0] as { routeTemplate: string }).routeTemplate).sort()).toEqual(
      [BASE, `${BASE}/history`, BASE, `${BASE}/order`, `${BASE}/:topicId`, `${BASE}/:topicId/archive`, `${BASE}/:topicId/restore`].sort(),
    );
    expect(m.denial.mock.calls[0]![0]).toMatchObject({ actorUserId: "admin-1", actorGlobalRole: r, method: "GET" });
    expect(m.floor).toHaveBeenCalled();
    expect(m.write).not.toHaveBeenCalled();
    expect(enforceTopicWriteRateLimit).not.toHaveBeenCalled();
  });

  it("a non-admin is refused before the body is read: oversize, malformed, form and xml bodies all get the 403", async () => {
    role = "facilitator";
    const cases: Array<[string, string]> = [
      ["application/json", JSON.stringify({ x: "y".repeat(20 * 1024) })],
      ["application/json", "{bad"],
      ["application/x-www-form-urlencoded", "a=b"],
      ["application/xml", "<a/>"],
    ];
    for (const [type, payload] of cases) {
      const res = await app.inject({ method: "POST", url: BASE, headers: { "content-type": type }, payload });
      expect(res.statusCode, type).toBe(403);
      expect(res.json().error.code).toBe("DEFAULT_MAINTENANCE_ADMIN_ONLY");
    }
  });

  it("a non-admin without the mutation header still gets the role 403, not the header error", async () => {
    role = "facilitator";
    const res = await inject("POST", `${BASE}/${ID}/archive`);
    expect(res.json().error.code).toBe("DEFAULT_MAINTENANCE_ADMIN_ONLY");
  });

  it("an admin without the mutation header (or with another value) gets 403 MUTATION_CONTROL_HEADER_REQUIRED on every mutating route, with no echo; GETs need none", async () => {
    for (const [method, url] of SEVEN.filter(([mm]) => mm !== "GET")) {
      for (const headers of [{}, { "x-requested-with": "SECRET-VALUE" }]) {
        const res = await inject(method, url, { headers });
        expect(res.statusCode, `${method} ${url}`).toBe(403);
        expect(res.json().error).toMatchObject({ code: "MUTATION_CONTROL_HEADER_REQUIRED", category: "forbidden" });
        expect(res.body).not.toContain("SECRET-VALUE");
      }
    }
    expect(m.write).not.toHaveBeenCalled();
    expect((await inject("GET", BASE)).statusCode).toBe(200);
    expect((await inject("GET", `${BASE}/history`)).statusCode).toBe(200);
  });

  it("a failing role read is the generic envelope 500 with no error text", async () => {
    m.query.mockRejectedValue(new Error("connection refused to secret-host"));
    const res = await inject("GET", BASE);
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatchObject({ category: "internal_error", code: "DEFAULT_MAINTENANCE_FAILED" });
    expect(res.body).not.toContain("secret-host");
  });
});

describe("reads", () => {
  it("GET list returns the list; a failing read is the generic 500", async () => {
    const res = await inject("GET", BASE);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(LIST);
    m.list.mockRejectedValue(new Error("db down"));
    expect((await inject("GET", BASE)).statusCode).toBe(500);
  });

  it("GET history validates and passes the limit, and wraps the rows as { history }", async () => {
    const res = await inject("GET", `${BASE}/history?limit=7`);
    expect(res.json()).toEqual({ history: [{ id: "h1" }] });
    expect(m.history).toHaveBeenCalledWith(7);
    await inject("GET", `${BASE}/history`);
    expect(m.history).toHaveBeenLastCalledWith(50);
    expect((await inject("GET", `${BASE}/history?limit=201`)).statusCode).toBe(200);
    expect(m.history).toHaveBeenLastCalledWith(200);
    for (const bad of ["0", "abc", "-1"]) {
      const r = await inject("GET", `${BASE}/history?limit=${bad}`);
      expect(r.statusCode).toBe(422);
      expect(r.json().error.code).toBe("INVALID_HISTORY_LIMIT");
    }
  });
});

describe("write cascade after authorization: media type, id syntax, rate limit, validation, writer", () => {
  it("a non-JSON media type is 415 before the rate limit; text/plain reaches our own check", async () => {
    const res = await inject("POST", BASE, { headers: { ...HDR, "content-type": "text/plain" }, payload: "hello" });
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(enforceTopicWriteRateLimit).not.toHaveBeenCalled();
    const json = await inject("POST", BASE, { headers: { ...HDR, "content-type": "application/json; charset=utf-8" }, payload: validAdd });
    expect(json.statusCode).toBe(201);
  });

  it("a non-canonical :topicId is 404 DEFAULT_TOPIC_NOT_FOUND before the limiter and the writer", async () => {
    for (const [method, url] of [["PATCH", `${BASE}/nope`], ["POST", `${BASE}/nope/archive`], ["POST", `${BASE}/nope/restore`]] as const) {
      const res = await inject(method, url, { headers: HDR, payload: method === "PATCH" ? { name: "x" } : undefined });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("DEFAULT_TOPIC_NOT_FOUND");
    }
    expect(enforceTopicWriteRateLimit).not.toHaveBeenCalled();
    expect(m.write).not.toHaveBeenCalled();
  });

  it("the rate limit runs after authorization and before validation, with the sentinel as the denial context team", async () => {
    enforceTopicWriteRateLimit.mockImplementation(async (...args: unknown[]) => {
      const reply = args[1] as { code: (n: number) => { send: (b: unknown) => unknown } };
      await reply.code(429).send({ error: { code: "TOPIC_WRITE_BURST_LIMIT_EXCEEDED" } });
      return "rejected";
    });
    const res = await inject("POST", BASE, { headers: HDR, payload: {} }); // an invalid body: 429 wins over 422
    expect(res.statusCode).toBe(429);
    const ctx = (enforceTopicWriteRateLimit.mock.calls[0] as unknown as unknown[])[2] as Record<string, unknown>;
    expect(ctx).toMatchObject({
      actorUserId: "admin-1",
      actorGlobalRole: "application_admin",
      endpoint: `POST ${BASE}`,
      attemptedOperation: "topic.default_added",
    });
    expect(ctx["teamId"]).toMatch(/^0{8}-0{4}-0{4}-0{4}-0{11}1$/);
    expect(m.write).not.toHaveBeenCalled();
  });

  it("validation 422s reach the client with field names and without the rejected value; the writer is not called", async () => {
    const marker = "ZEBRA-9137";
    const cases: Array<[unknown, string, string?]> = [
      [{}, "DEFAULT_FIELD_REQUIRED", "name"],
      [{ ...validAdd, name: "n".repeat(61) }, "DEFAULT_FIELD_TOO_LONG", "name"],
      [{ ...validAdd, prompt: `<b>${marker}</b>` }, "PROMPT_FORMAT_INVALID", "prompt"],
      [{ ...validAdd, voteType: marker }, "DEFAULT_VOTE_TYPE_INVALID", "voteType"],
      [{ ...validAdd, voteType: undefined }, "DEFAULT_FIELD_REQUIRED", "voteType"],
      [[1, 2], "DEFAULT_FIELD_REQUIRED", "body"],
    ];
    for (const [payload, code, field] of cases) {
      const res = await inject("POST", BASE, { headers: HDR, payload });
      expect(res.statusCode, code).toBe(422);
      expect(res.json().error).toMatchObject({ code, field });
      expect(res.body).not.toContain(marker);
    }
    expect(m.write).not.toHaveBeenCalled();
  });

  it("add: picks the four fields explicitly (a hostile body adds nothing), 201 with scope and changedTopicId", async () => {
    m.write.mockResolvedValue({ unchanged: false, operation: "topic.default_added", renamed: false, list: LIST, changedTopicId: ID });
    const res = await inject("POST", BASE, { headers: HDR, payload: { ...validAdd, teamId: "x", status: "archived", isDefault: false, id: "y", displayOrder: 1 } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ...LIST, scope: SCOPE_STATEMENT, changedTopicId: ID });
    const [op, who, c] = m.write.mock.calls[0]!;
    expect(op).toEqual({ kind: "add", input: { name: "New", prompt: "Prompt?", firstSessionDescription: "About.", voteType: "finger" } });
    expect(who).toMatchObject({ userId: "admin-1", role: "application_admin" });
    expect(c).toMatchObject({ correlationId: expect.any(String) });
  });

  it("edit: parses and trims only supplied fields, lowercases the id, adds the rename notice and the unchanged flag", async () => {
    m.write.mockResolvedValue({ unchanged: false, operation: "topic.default_edited", renamed: true, list: LIST, changedTopicId: ID });
    const res = await inject("PATCH", `${BASE}/${ID.toUpperCase()}`, { headers: HDR, payload: { name: "  Renamed ", voteType: "roman", junk: 1 } });
    expect(res.json()).toMatchObject({ notice: RENAME_NOTICE, scope: SCOPE_STATEMENT });
    expect(m.write.mock.calls[0]![0]).toEqual({ kind: "edit", topicId: ID, fields: { name: "Renamed" }, voteType: "roman" });

    m.write.mockResolvedValue({ unchanged: true, operation: "topic.default_edited", renamed: false, list: LIST, changedTopicId: ID });
    const noop = await inject("PATCH", `${BASE}/${ID}`, { headers: HDR });
    expect(noop.statusCode).toBe(200);
    expect(noop.json()).toMatchObject({ unchanged: true, scope: SCOPE_STATEMENT });
    expect(m.write.mock.calls[1]![0]).toEqual({ kind: "edit", topicId: ID, fields: {} });
  });

  it("archive and restore take no body: an empty body with a JSON content type is accepted", async () => {
    const a = await app.inject({ method: "POST", url: `${BASE}/${ID}/archive`, headers: { ...HDR, "content-type": "application/json" } });
    const r = await app.inject({ method: "POST", url: `${BASE}/${ID}/restore`, headers: HDR });
    expect([a.statusCode, r.statusCode]).toEqual([200, 200]);
    expect(m.write.mock.calls.map((c) => (c[0] as { kind: string }).kind)).toEqual(["archive", "restore"]);
  });

  it("reorder: lowercases ids; rejects empty, non-array, over-long, repeated and non-uuid lists before the writer", async () => {
    const ok = await inject("PUT", `${BASE}/order`, { headers: HDR, payload: { order: [ID.toUpperCase()] } });
    expect(ok.statusCode).toBe(200);
    expect(m.write.mock.calls[0]![0]).toEqual({ kind: "reorder", order: [ID] });
    const other = "22222222-2222-4222-8222-222222222222";
    const bad: unknown[] = [
      {}, { order: "x" }, { order: [] }, { order: [ID, ID] }, { order: [ID, "nope"] }, { order: Array.from({ length: 16 }, (_, i) => `${i}`) }, [], null,
    ];
    for (const payload of bad) {
      const res = await inject("PUT", `${BASE}/order`, { headers: HDR, payload: payload as object });
      expect(res.statusCode, JSON.stringify(payload)).toBe(422);
      expect(res.json().error.code).toBe("INVALID_DEFAULT_ORDER");
    }
    expect(m.write).toHaveBeenCalledTimes(1);
    void other;
  });

  it("a committed write whose list could not be read is still 200 with listUnavailable and no defaults", async () => {
    m.write.mockResolvedValue({ unchanged: false, operation: "topic.default_archived", renamed: false, list: null, changedTopicId: ID });
    const res = await inject("POST", `${BASE}/${ID}/archive`, { headers: HDR });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ listUnavailable: true, scope: SCOPE_STATEMENT, changedTopicId: ID });
  });
});

describe("parser and body errors for administrators are envelopes with no parser text", () => {
  it("malformed JSON is 400 INVALID_JSON_BODY; a literal __proto__ key is also refused", async () => {
    for (const payload of ["{bad json", '{"__proto__": {"x": 1}}']) {
      const res = await app.inject({ method: "POST", url: BASE, headers: { ...HDR, "content-type": "application/json" }, payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatchObject({ code: "INVALID_JSON_BODY", correlationId: expect.any(String) });
      expect(res.body).not.toMatch(/FST_|Unexpected token/);
    }
  });

  it("a body over 16 KiB is 413 BODY_TOO_LARGE; form and xml bodies are 415", async () => {
    const big = await app.inject({ method: "POST", url: BASE, headers: { ...HDR, "content-type": "application/json" }, payload: JSON.stringify({ name: "x".repeat(20 * 1024) }) });
    expect(big.statusCode).toBe(413);
    expect(big.json().error.code).toBe("BODY_TOO_LARGE");
    for (const type of ["application/x-www-form-urlencoded", "application/xml"]) {
      const res = await app.inject({ method: "POST", url: BASE, headers: { ...HDR, "content-type": type }, payload: "a=b" });
      expect(res.statusCode, type).toBe(415);
      expect(res.json().error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    }
  });

  it("a synchronous throw inside a read is the generic envelope 500", async () => {
    m.list.mockImplementation(() => {
      throw new Error("sync boom");
    });
    const res = await inject("GET", BASE);
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("DEFAULT_MAINTENANCE_FAILED");
  });
});

describe("the error table", () => {
  const rows: Array<[MaintenanceErrorCode, number, string, Record<string, unknown>?]> = [
    ["DEFAULT_FIELD_REQUIRED", 422, "invalid_request"],
    ["DEFAULT_FIELD_TOO_LONG", 422, "invalid_request"],
    ["PROMPT_FORMAT_INVALID", 422, "invalid_request"],
    ["DEFAULT_VOTE_TYPE_INVALID", 422, "invalid_request"],
    ["DEFAULT_VOTE_TYPE_IMMUTABLE", 422, "invalid_request"],
    ["DEFAULT_NAME_DUPLICATE", 409, "precondition_failed"],
    ["INVALID_HISTORY_LIMIT", 422, "invalid_request"],
    ["TEMPLATE_AT_CAPACITY", 409, "precondition_failed"],
    ["LAST_ACTIVE_DEFAULT", 409, "precondition_failed"],
    ["REORDER_ID_MISMATCH", 409, "precondition_failed"],
    ["INVALID_DEFAULT_ORDER", 422, "invalid_request"],
    ["DEFAULT_TOPIC_NOT_FOUND", 404, "not_found"],
    ["DEFAULT_ARCHIVED", 409, "precondition_failed"],
    ["DEFAULT_ALREADY_ARCHIVED", 422, "invalid_request"],
    ["DEFAULT_ALREADY_ACTIVE", 422, "invalid_request"],
    ["DEFAULT_MAINTENANCE_BUSY", 503, "service_unavailable"],
  ];

  it.each(rows)("%s maps to %i %s with a fixed message", async (code, status, category) => {
    m.write.mockRejectedValue(new MaintenanceError(code, { field: "name", max: 60 }));
    const res = await inject("POST", `${BASE}/${ID}/archive`, { headers: HDR });
    expect(res.statusCode).toBe(status);
    expect(res.json().error).toMatchObject({ category, code, correlationId: expect.any(String) });
    expect(res.json().error.message).toEqual(expect.any(String));
  });

  it("DEFAULT_MAINTENANCE_BUSY carries Retry-After 3 and the settled message", async () => {
    m.write.mockRejectedValue(new MaintenanceError("DEFAULT_MAINTENANCE_BUSY"));
    const res = await inject("POST", `${BASE}/${ID}/archive`, { headers: HDR });
    expect(res.headers["retry-after"]).toBe("3");
    expect(res.json().error.message).toBe("Another change to the default topics is in progress. Try again in a moment.");
  });

  it("field and max are carried; REORDER_ID_MISMATCH carries the current active list; a name conflict names the conflicting default", async () => {
    m.write.mockRejectedValue(new MaintenanceError("DEFAULT_FIELD_TOO_LONG", { field: "prompt", max: 400 }));
    expect((await inject("PATCH", `${BASE}/${ID}`, { headers: HDR, payload: { prompt: "x" } })).json().error).toMatchObject({ field: "prompt", max: 400 });
    m.list.mockResolvedValue({ ...LIST, defaults: [{ id: "a", status: "active" }, { id: "b", status: "archived" }] });
    m.write.mockRejectedValue(new MaintenanceError("REORDER_ID_MISMATCH"));
    const mismatch = await inject("PUT", `${BASE}/order`, { headers: HDR, payload: { order: [ID] } });
    expect(mismatch.json().error.current).toEqual([{ id: "a", status: "active" }]);
    m.list.mockRejectedValue(new Error("list down"));
    const noCurrent = await inject("PUT", `${BASE}/order`, { headers: HDR, payload: { order: [ID] } });
    expect(noCurrent.statusCode).toBe(409);
    expect(noCurrent.json().error.current).toBeUndefined();
    m.write.mockRejectedValue(new MaintenanceError("DEFAULT_NAME_DUPLICATE", { field: "name", conflictingTopicId: "c1", conflictingName: "Pairing" }));
    expect((await inject("POST", `${BASE}/${ID}/restore`, { headers: HDR })).json().error).toMatchObject({ conflictingTopicId: "c1", conflictingName: "Pairing" });
  });

  it("an audit failure, a backstop failure, a unique violation and an unknown error are the generic 500 with no driver text", async () => {
    const generic = ["audit", "backstop", "unique", "unknown"] as const;
    const errors: Record<(typeof generic)[number], unknown> = {
      audit: new AuditWriteError(new Error("insert into audit_log failed: secret")),
      backstop: new BackstopError("at least one active default"),
      unique: Object.assign(new Error('duplicate key value violates "secret_idx"'), { code: "23505", constraint: "topics_team_active_order" }),
      unknown: new Error("secret driver failure"),
    };
    for (const kind of generic) {
      m.write.mockRejectedValue(errors[kind]);
      const res = await inject("POST", `${BASE}/${ID}/archive`, { headers: HDR });
      expect(res.statusCode, kind).toBe(500);
      expect(res.json().error).toMatchObject({ category: "internal_error", code: "DEFAULT_MAINTENANCE_FAILED" });
      expect(res.body).not.toMatch(/secret|audit_log|duplicate key/);
    }
  });
});

describe("the timing floor", () => {
  it("is applied on success, refusal and error returns", async () => {
    await inject("GET", BASE);
    role = "facilitator";
    await inject("GET", BASE);
    role = "application_admin";
    m.write.mockRejectedValue(new Error("x"));
    await inject("POST", `${BASE}/${ID}/archive`, { headers: HDR });
    expect(m.floor.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
