import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// TOPIC-007 — PUT /api/v1/teams/:teamId/topics/:topicId/annotation
// (topic-annotation tasks.md sections 3 and 4). Mocked-db unit suite.
//
// The real-Postgres counterpart (migration, template isolation, snapshot
// negative test, seed isolation, non-UUID teamId) lives in
// topic-annotation-integration.test.ts.
//
// 401: an unauthenticated request never reaches this handler. It is rejected
// by the shared global onRequest authMiddleware (app.ts), exactly as for
// TOPIC-004/005/006; that path is covered once for every /api route by
// auth/__tests__/middleware.test.ts ("should return 401 when session has no
// userId"), so it is not duplicated per endpoint (tasks.md T3).
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
import { topicRoutes, validateAnnotationBody } from "../topics.js";

const TEAM_ID = "11111111-1111-4111-8111-111111111111";
const TOPIC_ID = "22222222-2222-4222-8222-222222222222";
const FACILITATOR_F = "33333333-3333-4333-8333-333333333333";
const FACILITATOR_G = "44444444-4444-4444-8444-444444444444";
const URL = `/api/v1/teams/${TEAM_ID}/topics/${TOPIC_ID}/annotation`;
const SENTINEL = "ZQX-annotation-sentinel-7781";

const TYPE_MESSAGE = "annotation must be a string.";
const CHARS_MESSAGE = "Team definition contains characters that can't be saved.";
const LENGTH_MESSAGE = "Team definition must be 500 characters or fewer.";

function buildApp(userId = FACILITATOR_G) {
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
  });
  app.register(topicRoutes);
  return app.ready().then(() => app);
}

function mockAuthQuery(globalRole: string, isMember: boolean) {
  mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: globalRole, is_member: isMember }] });
}
function mockTeamExists(exists: boolean) {
  mockDbQuery.mockResolvedValueOnce({ rows: exists ? [{ id: TEAM_ID }] : [] });
}
function mockLockCount(count: number) {
  mockDbQuery.mockResolvedValueOnce({ rows: [{ count: String(count) }] });
}
function mockDenialAuditInsert() {
  mockDbQuery.mockResolvedValueOnce({ rows: [] });
}
function mockTopicPrecheck(status: "active" | "archived" | null) {
  mockDbQuery.mockResolvedValueOnce({ rows: status ? [{ id: TOPIC_ID, status }] : [] });
}
function mockPassGates(globalRole = "facilitator") {
  mockAuthQuery(globalRole, false);
  mockTeamExists(true);
  mockLockCount(1);
}
function mockPassAllChecks() {
  mockPassGates();
  mockTopicPrecheck("active");
}

interface StoredRow {
  status: "active" | "archived";
  team_annotation: string | null;
  annotation_updated_at: Date | null;
  annotation_updated_by: string | null;
}

const DISPLAY_NAMES: Record<string, string> = {
  [FACILITATOR_F]: "Fran Facilitator",
  [FACILITATOR_G]: "Gil Facilitator",
};

/**
 * Stateful mock transaction client, dispatched on SQL text. `row` is the
 * stored topic (or null for "no row"); a successful UPDATE mutates it, so
 * sequential requests observe each other's writes.
 */
function makeAnnotationClient(
  state: { row: StoredRow | null },
  opts: { updateThrows?: boolean; updateMatchesNoRow?: boolean } = {},
) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("FOR UPDATE OF t")) {
      if (!state.row) return { rows: [] };
      const by = state.row.annotation_updated_by;
      return { rows: [{ ...state.row, display_name: by ? (DISPLAY_NAMES[by] ?? null) : null }] };
    }
    if (sql.includes("WITH upd AS")) {
      if (opts.updateThrows) throw new Error("simulated update failure");
      if (opts.updateMatchesNoRow) return { rows: [] };
      if (!state.row || state.row.status !== "active") return { rows: [] };
      const [, , value, userId] = params as [string, string, string | null, string];
      state.row = {
        ...state.row,
        team_annotation: value,
        annotation_updated_by: userId,
        annotation_updated_at: new Date("2026-09-30T12:00:00.000Z"),
      };
      return {
        rows: [
          {
            team_annotation: state.row.team_annotation,
            annotation_updated_at: state.row.annotation_updated_at,
            annotation_updated_by: userId,
            display_name: DISPLAY_NAMES[userId] ?? null,
          },
        ],
      };
    }
    return { rows: [] };
  });
  const client = { query, release: vi.fn() };
  mockDbConnect.mockResolvedValueOnce(client);
  return client;
}

function activeRow(overrides: Partial<StoredRow> = {}): StoredRow {
  return {
    status: "active",
    team_annotation: null,
    annotation_updated_at: null,
    annotation_updated_by: null,
    ...overrides,
  };
}

function auditInserts(client: { query: ReturnType<typeof vi.fn> }) {
  return client.query.mock.calls.filter(
    (call) =>
      String(call[0]).includes("INSERT INTO audit_log") && (call[1] as unknown[])[3] === "topic.annotation_updated",
  );
}

function sqlCalls(client: { query: ReturnType<typeof vi.fn> }): string[] {
  return client.query.mock.calls.map((call) => String(call[0]).trim());
}

async function put(payload: unknown, opts: { userId?: string; url?: string; raw?: string } = {}) {
  const app = await buildApp(opts.userId);
  return app.inject({
    method: "PUT",
    url: opts.url ?? URL,
    headers: { "content-type": "application/json" },
    payload: opts.raw ?? JSON.stringify(payload),
  });
}

function expectEnvelope(body: { error?: Record<string, unknown> }) {
  expect(body.error).toBeDefined();
  expect(typeof body.error?.["category"]).toBe("string");
  expect(typeof body.error?.["code"]).toBe("string");
  expect(typeof body.error?.["message"]).toBe("string");
  expect(typeof body.error?.["correlationId"]).toBe("string");
}

/** Walks every string reachable in a value (object keys and values). */
function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [k, ...allStrings(v)]);
  }
  return [];
}

beforeEach(() => {
  vi.resetAllMocks();
  mockApplyTimingFloor.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Task 3.4 — one test per cascade row, plus precedence
// ---------------------------------------------------------------------------
describe("PUT …/topics/:topicId/annotation — authorization and cascade (design.md Decisions 1/2)", () => {
  it("a non-facilitator gets 403 NOT_A_FACILITATOR with the TOPIC-007 message", async () => {
    mockAuthQuery("engineer", false);

    const res = await put({ annotation: "X" });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NOT_A_FACILITATOR");
    expect(res.json().error.message).toBe("Only a facilitator can edit a team's topic definition.");
    expectEnvelope(res.json());
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it("an engineering manager gets 403 NOT_A_FACILITATOR", async () => {
    mockAuthQuery("engineering_manager", false);

    const res = await put({ annotation: "X" });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NOT_A_FACILITATOR");
  });

  it("an application admin gets 403 NOT_A_FACILITATOR (FR-8.7) and nothing is written", async () => {
    mockAuthQuery("application_admin", false);

    const res = await put({ annotation: "X" });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("NOT_A_FACILITATOR");
    expectEnvelope(res.json());
    // No transaction was opened, so the annotation and provenance are unchanged.
    expect(mockDbConnect).not.toHaveBeenCalled();
    expect(mockDbQuery).toHaveBeenCalledTimes(1);
  });

  it("a facilitator who is a member gets 403 FACILITATOR_IS_TEAM_MEMBER", async () => {
    mockAuthQuery("facilitator", true);

    const res = await put({ annotation: "X" });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FACILITATOR_IS_TEAM_MEMBER");
    expect(res.json().error.message).toBe(
      "A facilitator cannot edit topic definitions for a team they are a member of.",
    );
    expectEnvelope(res.json());
  });

  it("an unknown team gets 404 TEAM_NOT_FOUND", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(false);

    const res = await put({ annotation: "X" });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TEAM_NOT_FOUND");
    expectEnvelope(res.json());
  });

  it("a locked team gets 409 plus a topic.write_denied_locked row naming topic.annotation_updated, and nothing is stored", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();

    const res = await put({ annotation: "X" });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("TOPIC_CUSTOMIZATION_LOCKED");
    expectEnvelope(res.json());
    const denial = mockDbQuery.mock.calls[3] as [string, unknown[]];
    expect(denial[0]).toContain("INSERT INTO audit_log");
    expect(denial[1][3]).toBe("topic.write_denied_locked");
    expect(JSON.parse(denial[1][5] as string)).toEqual({
      endpoint: "PUT /api/v1/teams/:teamId/topics/:topicId/annotation",
      attempted_operation: "topic.annotation_updated",
    });
    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  it("a bad body gets 422 INVALID_ANNOTATION with field 'annotation'", async () => {
    mockPassGates();

    const res = await put({ annotation: 42 });

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({
      category: "invalid_request",
      code: "INVALID_ANNOTATION",
      field: "annotation",
      message: TYPE_MESSAGE,
    });
    expectEnvelope(res.json());
  });

  it("a topic on another team gets 404 TOPIC_NOT_FOUND", async () => {
    mockPassGates();
    mockTopicPrecheck(null);

    const res = await put({ annotation: "X" });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TOPIC_NOT_FOUND");
    expectEnvelope(res.json());
    // The pre-check is team-scoped.
    expect(mockDbQuery.mock.calls[3]?.[1]).toEqual([TOPIC_ID, TEAM_ID]);
  });

  it("an archived topic gets 422 TOPIC_ALREADY_ARCHIVED and nothing is stored", async () => {
    mockPassGates();
    mockTopicPrecheck("archived");

    const res = await put({ annotation: "X" });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("TOPIC_ALREADY_ARCHIVED");
    expectEnvelope(res.json());
    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  it("a non-UUID topicId ('order') gets 404 TOPIC_NOT_FOUND without querying Postgres", async () => {
    mockPassGates();

    const res = await put({ annotation: "X" }, { url: `/api/v1/teams/${TEAM_ID}/topics/order/annotation` });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TOPIC_NOT_FOUND");
    expectEnvelope(res.json());
    expect(mockDbQuery).toHaveBeenCalledTimes(3);
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("precedence: locked + bad body → 409, not 422", async () => {
    mockAuthQuery("facilitator", false);
    mockTeamExists(true);
    mockLockCount(0);
    mockDenialAuditInsert();

    const res = await put({ annotation: "x".repeat(501) });

    expect(res.statusCode).toBe(409);
  });

  it("precedence: bad body + missing topic → 422 with field 'annotation', not 404", async () => {
    mockPassGates();

    const res = await put({ annotation: null });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.field).toBe("annotation");
    // The topic lookup was never reached.
    expect(mockDbQuery).toHaveBeenCalledTimes(3);
  });

  it("malformed JSON is rejected by Fastify's body parser exactly as on TOPIC-006, before any check runs", async () => {
    const app = await buildApp();
    const annotationRes = await app.inject({
      method: "PUT",
      url: URL,
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    const orderRes = await app.inject({
      method: "PUT",
      url: `/api/v1/teams/${TEAM_ID}/topics/order`,
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });

    expect(annotationRes.statusCode).toBe(400);
    expect(annotationRes.statusCode).toBe(orderRes.statusCode);
    expect(annotationRes.json().code).toBe(orderRes.json().code);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Task 3.5 — validation
// ---------------------------------------------------------------------------
describe("PUT …/topics/:topicId/annotation — validation and normalization (design.md Decision 3)", () => {
  async function putValid(annotation: unknown, row: StoredRow = activeRow()) {
    mockPassAllChecks();
    const state = { row };
    const client = makeAnnotationClient(state);
    const res = await put({ annotation });
    return { res, state, client };
  }

  async function putInvalid(payload: unknown) {
    mockPassGates();
    const res = await put(payload);
    expect(mockDbConnect).not.toHaveBeenCalled();
    return res;
  }

  it("500 units are accepted", async () => {
    const { res, state } = await putValid("a".repeat(500));
    expect(res.statusCode).toBe(200);
    expect(state.row?.team_annotation).toHaveLength(500);
  });

  it("501 units are rejected with the over-length message", async () => {
    const res = await putInvalid({ annotation: "a".repeat(501) });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: "INVALID_ANNOTATION", field: "annotation", message: LENGTH_MESSAGE });
  });

  it("trims then counts: 500 units surrounded by spaces are accepted and stored trimmed", async () => {
    const { res, state } = await putValid(`   ${"b".repeat(500)}   `);
    expect(res.statusCode).toBe(200);
    expect(state.row?.team_annotation).toBe("b".repeat(500));
  });

  it("250 astral emoji (500 units) are accepted; 251 are rejected", async () => {
    const ok = await putValid("😀".repeat(250));
    expect(ok.res.statusCode).toBe(200);

    vi.resetAllMocks();
    mockApplyTimingFloor.mockResolvedValue(undefined);
    const bad = await putInvalid({ annotation: "😀".repeat(251) });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.message).toBe(LENGTH_MESSAGE);
  });

  it("null is rejected with the type message and is not a clear", async () => {
    const res = await putInvalid({ annotation: null });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: "INVALID_ANNOTATION", field: "annotation", message: TYPE_MESSAGE });
  });

  it.each([
    ["a missing field", {}],
    ["a number", { annotation: 7 }],
    ["an object", { annotation: { text: "X" } }],
    ["a bare-string body", "X"],
    ["an array body", ["X"]],
  ])("%s → 422 with the type message", async (_label, payload) => {
    const res = await putInvalid(payload);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: "INVALID_ANNOTATION", field: "annotation", message: TYPE_MESSAGE });
  });

  it.each([
    ["U+0000", "before\u0000after"],
    ["a lone high surrogate", "before\ud800after"],
    ["a lone low surrogate", "before\udc00after"],
    ["U+202E", "before\u202Eafter"],
    ["U+2066", "before\u2066after"],
    ["BEL (\\x07)", "before\x07after"],
    ["a lone CR", "before\rafter"],
    ["U+007F", "before\u007Fafter"],
  ])("%s → 422 with the characters message (not 500)", async (_label, annotation) => {
    const res = await putInvalid({ annotation });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({ code: "INVALID_ANNOTATION", field: "annotation", message: CHARS_MESSAGE });
  });

  it("disallowed characters are checked before length", async () => {
    const res = await putInvalid({ annotation: `${"a".repeat(600)}\u0000` });
    expect(res.json().error.message).toBe(CHARS_MESSAGE);
  });

  it("a tab is accepted", async () => {
    const { res, state } = await putValid("col\tcol");
    expect(res.statusCode).toBe(200);
    expect(state.row?.team_annotation).toBe("col\tcol");
  });

  it("whitespace-only input clears the annotation", async () => {
    const { res, state } = await putValid("   \r\n  ", activeRow({ team_annotation: "X" }));
    expect(res.statusCode).toBe(200);
    expect(res.json().teamAnnotation).toBeNull();
    expect(state.row?.team_annotation).toBeNull();
  });

  it("CRLF is normalized to LF and interior line breaks are preserved", async () => {
    const { res, state } = await putValid("Line one\r\nLine two\n\nLine three");
    expect(res.statusCode).toBe(200);
    expect(state.row?.team_annotation).toBe("Line one\nLine two\n\nLine three");
  });

  it("unknown top-level keys are ignored", async () => {
    mockPassAllChecks();
    const state = { row: activeRow() };
    makeAnnotationClient(state);

    const res = await put({ annotation: "X", teamId: "other", extra: true });

    expect(res.statusCode).toBe(200);
    expect(state.row.team_annotation).toBe("X");
  });

  it("validateAnnotationBody returns null for an empty normalized value", () => {
    expect(validateAnnotationBody({ annotation: "" })).toEqual({ valid: true, annotation: null });
    expect(validateAnnotationBody(undefined)).toEqual({ valid: false, message: TYPE_MESSAGE });
  });
});

// ---------------------------------------------------------------------------
// Tasks 4.1–4.3 — write, provenance, no-op, last-writer-wins
// ---------------------------------------------------------------------------
describe("PUT …/topics/:topicId/annotation — write, provenance, and no-op (design.md Decisions 5/6)", () => {
  it("a set records the caller and time and returns the response shape", async () => {
    mockPassAllChecks();
    const state = { row: activeRow() };
    const client = makeAnnotationClient(state);

    const res = await put({ annotation: "Our build and deploy pipeline" }, { userId: FACILITATOR_F });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      topicId: TOPIC_ID,
      teamAnnotation: "Our build and deploy pipeline",
      annotationUpdatedAt: "2026-09-30T12:00:00.000Z",
      annotationUpdatedBy: { userId: FACILITATOR_F, displayName: "Fran Facilitator" },
    });
    expect(res.headers["cache-control"]).toBe("no-store");

    const sql = sqlCalls(client);
    expect(sql[0]).toBe("BEGIN");
    expect(sql[sql.length - 1]).toBe("COMMIT");
    // Scoped UPDATE (security R1), annotation's own clock, updated_at untouched.
    const update = sql.find((s) => s.includes("WITH upd AS")) as string;
    expect(update).toMatch(/WHERE id = \$1 AND team_id = \$2 AND status = 'active'/);
    expect(update).toContain("annotation_updated_at = now()");
    expect(update).not.toMatch(/[^_]updated_at\s*=/);
    // No per-team advisory lock (design.md Decision 5).
    expect(sql.some((s) => s.includes("pg_advisory_xact_lock"))).toBe(false);
  });

  it("a clear records the clearer and returns teamAnnotation null", async () => {
    mockPassAllChecks();
    const state = {
      row: activeRow({
        team_annotation: "X",
        annotation_updated_by: FACILITATOR_F,
        annotation_updated_at: new Date("2026-09-01T00:00:00.000Z"),
      }),
    };
    makeAnnotationClient(state);

    const res = await put({ annotation: "" }, { userId: FACILITATOR_G });

    expect(res.statusCode).toBe(200);
    expect(res.json().teamAnnotation).toBeNull();
    expect(res.json().annotationUpdatedBy).toEqual({ userId: FACILITATOR_G, displayName: "Gil Facilitator" });
    expect(state.row.annotation_updated_by).toBe(FACILITATOR_G);
    expect(state.row.annotation_updated_at).not.toEqual(new Date("2026-09-01T00:00:00.000Z"));
  });

  it("resubmitting '  X  ' over 'X' is a 200 no-op: provenance unchanged, no write, no audit", async () => {
    mockPassAllChecks();
    const editedAt = new Date("2026-09-01T00:00:00.000Z");
    const state = {
      row: activeRow({ team_annotation: "X", annotation_updated_by: FACILITATOR_F, annotation_updated_at: editedAt }),
    };
    const client = makeAnnotationClient(state);

    const res = await put({ annotation: "  X  " }, { userId: FACILITATOR_G });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      topicId: TOPIC_ID,
      teamAnnotation: "X",
      annotationUpdatedAt: editedAt.toISOString(),
      annotationUpdatedBy: { userId: FACILITATOR_F, displayName: "Fran Facilitator" },
    });
    expect(sqlCalls(client).some((s) => s.includes("WITH upd AS"))).toBe(false);
    expect(auditInserts(client)).toHaveLength(0);
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
  });

  it("'' over NULL is a no-op", async () => {
    mockPassAllChecks();
    const state = { row: activeRow() };
    const client = makeAnnotationClient(state);

    const res = await put({ annotation: "" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      topicId: TOPIC_ID,
      teamAnnotation: null,
      annotationUpdatedAt: null,
      annotationUpdatedBy: null,
    });
    expect(auditInserts(client)).toHaveLength(0);
    expect(state.row.annotation_updated_by).toBeNull();
  });

  it("last-writer-wins: two sequential writes by different facilitators leave the second's text and provenance", async () => {
    const state = { row: activeRow() as StoredRow | null };

    mockPassAllChecks();
    makeAnnotationClient(state);
    const first = await put({ annotation: "First wording" }, { userId: FACILITATOR_F });
    expect(first.statusCode).toBe(200);

    mockPassAllChecks();
    makeAnnotationClient(state);
    const second = await put({ annotation: "Second wording" }, { userId: FACILITATOR_G });
    expect(second.statusCode).toBe(200);

    expect(state.row?.team_annotation).toBe("Second wording");
    expect(state.row?.annotation_updated_by).toBe(FACILITATOR_G);
    expect(second.json().annotationUpdatedBy).toEqual({ userId: FACILITATOR_G, displayName: "Gil Facilitator" });
  });

  it("provenance is null when the editor has no display name", async () => {
    mockPassAllChecks();
    const unknownUser = "55555555-5555-4555-8555-555555555555";
    const state = {
      row: activeRow({
        team_annotation: "X",
        annotation_updated_by: unknownUser,
        annotation_updated_at: new Date("2026-09-01T00:00:00.000Z"),
      }),
    };
    makeAnnotationClient(state);

    const res = await put({ annotation: "X" });

    expect(res.json().annotationUpdatedBy).toBeNull();
    expect(res.json().annotationUpdatedAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("in-transaction re-read: a topic gone since the pre-check → 404, archived since → 422, both rolled back", async () => {
    mockPassAllChecks();
    const goneClient = makeAnnotationClient({ row: null });
    const gone = await put({ annotation: "X" });
    expect(gone.statusCode).toBe(404);
    expect(gone.json().error.code).toBe("TOPIC_NOT_FOUND");
    expect(sqlCalls(goneClient)).toContain("ROLLBACK");

    mockPassAllChecks();
    const archivedClient = makeAnnotationClient({ row: activeRow({ status: "archived" }) });
    const archived = await put({ annotation: "X" });
    expect(archived.statusCode).toBe(422);
    expect(archived.json().error.code).toBe("TOPIC_ALREADY_ARCHIVED");
    expect(sqlCalls(archivedClient)).toContain("ROLLBACK");
    expect(sqlCalls(archivedClient).some((s) => s.includes("WITH upd AS"))).toBe(false);
  });

  it("the in-transaction read is a single team-scoped row-locking query", async () => {
    mockPassAllChecks();
    const client = makeAnnotationClient({ row: activeRow() });

    await put({ annotation: "X" });

    const lockRead = client.query.mock.calls.find((c) => String(c[0]).includes("FOR UPDATE OF t"));
    expect(String(lockRead?.[0])).toMatch(/WHERE t\.id = \$1 AND t\.team_id = \$2/);
    expect(lockRead?.[1]).toEqual([TOPIC_ID, TEAM_ID]);
  });

  it("<script>alert(1)</script> is stored and returned byte-for-byte (Task 4.5)", async () => {
    mockPassAllChecks();
    const state = { row: activeRow() };
    makeAnnotationClient(state);

    const res = await put({ annotation: "<script>alert(1)</script>" });

    expect(res.statusCode).toBe(200);
    expect(res.json().teamAnnotation).toBe("<script>alert(1)</script>");
    expect(state.row.team_annotation).toBe("<script>alert(1)</script>");
  });
});

// ---------------------------------------------------------------------------
// Task 4.4 — audit without text
// ---------------------------------------------------------------------------
describe("PUT …/topics/:topicId/annotation — audit without text (design.md Decision 7)", () => {
  it("a set writes action 'set' with the stored length, in the same transaction", async () => {
    mockPassAllChecks();
    const client = makeAnnotationClient({ row: activeRow() });

    await put({ annotation: "Pipeline speed and reliability" });

    const inserts = auditInserts(client);
    expect(inserts).toHaveLength(1);
    expect(JSON.parse((inserts[0]?.[1] as unknown[])[5] as string)).toEqual({
      topic_id: TOPIC_ID,
      action: "set",
      length: 30,
    });
    const sql = sqlCalls(client);
    expect(sql.findIndex((s) => s.includes("INSERT INTO audit_log"))).toBeLessThan(sql.indexOf("COMMIT"));
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "topic.annotation_updated",
      expect.objectContaining({ teamId: TEAM_ID, topicId: TOPIC_ID, action: "set", length: 30 }),
    );
  });

  it("a clear writes action 'cleared' with length 0", async () => {
    mockPassAllChecks();
    const client = makeAnnotationClient({ row: activeRow({ team_annotation: "X" }) });

    await put({ annotation: "  " });

    const inserts = auditInserts(client);
    expect(inserts).toHaveLength(1);
    expect(JSON.parse((inserts[0]?.[1] as unknown[])[5] as string)).toEqual({
      topic_id: TOPIC_ID,
      action: "cleared",
      length: 0,
    });
  });

  it("the sentinel text appears in no audit_log metadata value and no field of the emitted log event", async () => {
    mockPassAllChecks();
    const client = makeAnnotationClient({ row: activeRow() });

    const res = await put({ annotation: SENTINEL });
    expect(res.statusCode).toBe(200);

    const inserts = auditInserts(client);
    expect(inserts).toHaveLength(1);
    for (const call of client.query.mock.calls) {
      if (!String(call[0]).includes("INSERT INTO audit_log")) continue;
      const metadata = JSON.parse((call[1] as unknown[])[5] as string) as unknown;
      expect(allStrings(metadata).some((s) => s.includes(SENTINEL))).toBe(false);
      expect(JSON.stringify(call[1])).not.toContain(SENTINEL);
    }
    expect(mockEmitAuditEvent).toHaveBeenCalledTimes(1);
    for (const call of mockEmitAuditEvent.mock.calls) {
      expect(allStrings(call.slice(1)).some((s) => s.includes(SENTINEL))).toBe(false);
    }
  });

  it.each([
    ["over-length", `${SENTINEL}${"x".repeat(500)}`],
    ["disallowed characters", `${SENTINEL}\u0000`],
  ])("no 422 body (%s) contains the sentinel", async (_label, annotation) => {
    mockPassGates();
    const res = await put({ annotation });
    expect(res.statusCode).toBe(422);
    expect(res.body).not.toContain(SENTINEL);
  });

  it("no 422 body (type) contains the sentinel", async () => {
    mockPassGates();
    const res = await put({ annotation: [SENTINEL] });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toBe(TYPE_MESSAGE);
    expect(res.body).not.toContain(SENTINEL);
  });

  it.each([
    ["403", () => mockAuthQuery("application_admin", false), { annotation: "X" }],
    [
      "409",
      () => {
        mockAuthQuery("facilitator", false);
        mockTeamExists(true);
        mockLockCount(0);
        mockDenialAuditInsert();
      },
      { annotation: "X" },
    ],
    ["422", () => mockPassGates(), { annotation: null }],
    [
      "404 topic",
      () => {
        mockPassGates();
        mockTopicPrecheck(null);
      },
      { annotation: "X" },
    ],
  ])("a rejected request (%s) writes no topic.annotation_updated row", async (_label, arrange, payload) => {
    arrange();
    await put(payload);
    const updateRows = mockDbQuery.mock.calls.filter((c) => (c[1] as unknown[] | undefined)?.[3] === "topic.annotation_updated");
    expect(updateRows).toHaveLength(0);
    expect(mockDbConnect).not.toHaveBeenCalled();
    expect(mockEmitAuditEvent).not.toHaveBeenCalledWith(expect.anything(), "topic.annotation_updated", expect.anything());
  });
});

// ---------------------------------------------------------------------------
// Task 11.2 — timing floor and Cache-Control: no-store on every exit
// ---------------------------------------------------------------------------
describe("PUT …/topics/:topicId/annotation — timing floor and no-store on every handled exit", () => {
  const exits: Array<[string, () => void, unknown, number, string?]> = [
    ["403 NOT_A_FACILITATOR", () => mockAuthQuery("engineer", false), { annotation: "X" }, 403],
    ["403 NOT_A_FACILITATOR (admin)", () => mockAuthQuery("application_admin", false), { annotation: "X" }, 403],
    ["403 FACILITATOR_IS_TEAM_MEMBER", () => mockAuthQuery("facilitator", true), { annotation: "X" }, 403],
    [
      "404 TEAM_NOT_FOUND",
      () => {
        mockAuthQuery("facilitator", false);
        mockTeamExists(false);
      },
      { annotation: "X" },
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
      { annotation: "X" },
      409,
    ],
    ["422 INVALID_ANNOTATION", () => mockPassGates(), { annotation: null }, 422],
    ["404 TOPIC_NOT_FOUND (non-UUID)", () => mockPassGates(), { annotation: "X" }, 404, `/api/v1/teams/${TEAM_ID}/topics/order/annotation`],
    [
      "404 TOPIC_NOT_FOUND",
      () => {
        mockPassGates();
        mockTopicPrecheck(null);
      },
      { annotation: "X" },
      404,
    ],
    [
      "422 TOPIC_ALREADY_ARCHIVED",
      () => {
        mockPassGates();
        mockTopicPrecheck("archived");
      },
      { annotation: "X" },
      422,
    ],
    [
      "404 TOPIC_NOT_FOUND (in transaction)",
      () => {
        mockPassAllChecks();
        makeAnnotationClient({ row: null });
      },
      { annotation: "X" },
      404,
    ],
    [
      "200 no-op",
      () => {
        mockPassAllChecks();
        makeAnnotationClient({ row: activeRow({ team_annotation: "X" }) });
      },
      { annotation: "X" },
      200,
    ],
    [
      "200 changed",
      () => {
        mockPassAllChecks();
        makeAnnotationClient({ row: activeRow() });
      },
      { annotation: "X" },
      200,
    ],
  ];

  it.each(exits)("%s applies the floor exactly once and sets Cache-Control: no-store", async (_label, arrange, payload, status, url) => {
    arrange();

    const res = await put(payload, url ? { url } : {});

    expect(res.statusCode).toBe(status);
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
    expect(res.headers["cache-control"]).toBe("no-store");
    if (status !== 200) expectEnvelope(res.json());
  });

  it("the thrown-path 500 also carries Cache-Control: no-store and rolls back", async () => {
    mockPassAllChecks();
    const client = makeAnnotationClient({ row: activeRow() }, { updateThrows: true });

    const res = await put({ annotation: "X" });

    expect(res.statusCode).toBe(500);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(sqlCalls(client)).toContain("ROLLBACK");
    expect(client.release).toHaveBeenCalled();
  });

  // Implementation review N-1 / security N3: the defensive 0-row UPDATE
  // branch (unreachable under the row lock) mirrors TOPIC-004 -- it returns
  // 422 without a second lookup after ROLLBACK.
  it("the defensive 0-row UPDATE branch returns 422 with no lookup after ROLLBACK", async () => {
    mockPassAllChecks();
    const client = makeAnnotationClient({ row: activeRow() }, { updateMatchesNoRow: true });
    const res = await put({ annotation: "X" });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("TOPIC_ALREADY_ARCHIVED");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
    expect(sqlCalls(client)).toContain("ROLLBACK");
    expect(sqlCalls(client)).not.toContain("COMMIT");
    // Only the pre-transaction existence check reads topics via db.query.
    const topicReads = mockDbQuery.mock.calls.filter((c) => /FROM topics WHERE id = \$1/.test(String(c[0])));
    expect(topicReads).toHaveLength(1);
    expect(client.release).toHaveBeenCalled();
  });
});
