import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type * as AuditLoggerModule from "../../auth/audit-logger.js";

// ---------------------------------------------------------------------------
// template-team-not-usable (#214) tasks.md 2.1: isTemplateTeam and
// writeTemplateAccessDenial (teams/template-team-guard.ts), design.md D2/D2a.
//
// db.js and redis.js are mocked. The Redis stand-in implements SET ... PX NX
// against Date.now(), so fake timers move it past the 60-second window.
// ---------------------------------------------------------------------------

const mockDbQuery = vi.fn();
const mockEmitAuditEvent = vi.fn();
const redisStore = new Map<string, number>(); // key -> expiry (ms since epoch)
const mockRedisSet = vi.fn(async (key: string, _value: string, _px: "PX", ttlMs: number, _nx: "NX") => {
  const expiry = redisStore.get(key);
  if (expiry !== undefined && expiry > Date.now()) return null;
  redisStore.set(key, Date.now() + ttlMs);
  return "OK";
});

vi.mock("../../db.js", () => ({
  db: { query: (...args: unknown[]) => mockDbQuery(...args) },
}));
const mockRedisDel = vi.fn(async (key: string) => (redisStore.delete(key) ? 1 : 0));
vi.mock("../../redis.js", () => ({
  redis: {
    set: (...args: Parameters<typeof mockRedisSet>) => mockRedisSet(...args),
    del: (key: string) => mockRedisDel(key),
  },
}));
vi.mock("../../auth/audit-logger.js", async () => {
  const actual = await vi.importActual<typeof AuditLoggerModule>("../../auth/audit-logger.js");
  return { ...actual, emitAuditEvent: (...args: unknown[]) => mockEmitAuditEvent(...args) };
});

import {
  isTemplateTeam,
  writeTemplateAccessDenial,
  templateDenialDedupeKey,
  TEMPLATE_DENIAL_DEDUPE_WINDOW_MS,
} from "../template-team-guard.js";
import { AUDIT_WRITE_TIMEOUT_MS } from "../../auth/audit-write-timeout.js";
import { DEFAULT_TOPICS_TEAM_ID } from "../../sessions/default-topics.js";

const ACTOR = "11111111-2222-4333-8444-555555555555";
const ENDPOINT = "POST /api/v1/teams/:teamId/sessions/draft";

function fakeLog() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), child: vi.fn(() => ({ info: vi.fn() })) };
}

function insertCalls() {
  return mockDbQuery.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO audit_log"));
}

function lastEvent(): Record<string, unknown> {
  const call = mockEmitAuditEvent.mock.calls.at(-1)!;
  expect(call[1]).toBe("team.template_access_denied");
  return call[2] as Record<string, unknown>;
}

// Spellings are derived from the shared constant (tasks.md 5.4: no template
// UUID literal outside migrations/ and sessions/default-topics.ts).
const T = DEFAULT_TOPICS_TEAM_ID;
const HEX = T.replace(/-/g, "");

describe("isTemplateTeam (#214 D2)", () => {
  it.each([
    ["canonical", T],
    ["upper case", T.toUpperCase()],
    ["no hyphens", HEX],
    ["braced", `{${T}}`],
    ["braced, no hyphens", `{${HEX}}`],
    ["other hyphen grouping", HEX.match(/.{4}/g)!.join("-")],
  ])("is true for the %s spelling of the template", (_label, value) => {
    expect(isTemplateTeam(value)).toBe(true);
  });

  it("matches the shared constant, not a copy", () => {
    expect(isTemplateTeam(DEFAULT_TOPICS_TEAM_ID)).toBe(true);
  });

  it.each([
    ["a real team id", "4b0f0c1e-8d55-4f7a-9a43-3f2c9d1e6a10"],
    ["a near miss", "00000000-0000-0000-0000-000000000002"],
    ["a longer string ending in the template hex", `1${T}`],
    ["two brace pairs", `{{${T}}}`],
    ["an empty string", ""],
  ])("is false for %s", (_label, value) => {
    expect(isTemplateTeam(value)).toBe(false);
  });

  it.each([[undefined], [null], [1], [{}], [[DEFAULT_TOPICS_TEAM_ID]]])(
    "is false for the non-string %j",
    (value) => {
      expect(isTemplateTeam(value)).toBe(false);
    },
  );
});

describe("writeTemplateAccessDenial (#214 D2/D2a)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisStore.clear();
    mockDbQuery.mockImplementation(async (sql: string) =>
      String(sql).startsWith("SELECT global_role") ? { rows: [{ global_role: "engineer" }] } : { rows: [] },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes one row with the actor, the template team and metadata { endpoint, surface } only", async () => {
    const log = fakeLog();
    await writeTemplateAccessDenial({
      actorUserId: ACTOR,
      actorGlobalRole: "facilitator",
      actorIp: "203.0.113.9",
      log: log as never,
      endpoint: ENDPOINT,
      surface: "session",
      correlationId: "corr-1",
    });

    const inserts = insertCalls();
    expect(inserts).toHaveLength(1);
    const params = inserts[0]![1] as unknown[];
    expect(params.slice(0, 5)).toEqual([ACTOR, "facilitator", "203.0.113.9", "team.template_access_denied", DEFAULT_TOPICS_TEAM_ID]);
    expect(JSON.parse(params[5] as string)).toEqual({ endpoint: ENDPOINT, surface: "session" });
    // The role was supplied, so no lookup ran.
    expect(mockDbQuery.mock.calls.some(([sql]) => String(sql).startsWith("SELECT global_role"))).toBe(false);

    expect(lastEvent()).toEqual({
      actorUserId: ACTOR,
      actorGlobalRole: "facilitator",
      actorIp: "203.0.113.9",
      teamId: DEFAULT_TOPICS_TEAM_ID,
      endpoint: ENDPOINT,
      surface: "session",
      correlationId: "corr-1",
      auditRowWritten: true,
    });
    expect(log.error).not.toHaveBeenCalled();
  });

  it("resolves the actor's real role from users when none is supplied", async () => {
    await writeTemplateAccessDenial({
      actorUserId: ACTOR,
      actorIp: "203.0.113.9",
      log: fakeLog() as never,
      endpoint: "POST /api/v1/teams/:teamId/sessions/:sessionId/advance",
      surface: "session",
    });
    const lookup = mockDbQuery.mock.calls.find(([sql]) => String(sql).startsWith("SELECT global_role"))!;
    expect(lookup[1]).toEqual([ACTOR]);
    expect((insertCalls()[0]![1] as unknown[])[1]).toBe("engineer");
    expect(lastEvent()["actorGlobalRole"]).toBe("engineer");
  });

  it("never writes a placeholder role: an actor with no users row writes no row and logs audit_write_failed", async () => {
    mockDbQuery.mockImplementation(async () => ({ rows: [] }));
    const log = fakeLog();
    await writeTemplateAccessDenial({
      actorUserId: ACTOR,
      actorIp: "203.0.113.9",
      log: log as never,
      endpoint: ENDPOINT,
      surface: "session",
    });
    expect(insertCalls()).toHaveLength(0);
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ audit_write_failed: true }), expect.any(String));
    expect(lastEvent()).not.toHaveProperty("actorGlobalRole");
  });

  it("a null actor writes no row and touches neither the database nor Redis; the event is still emitted", async () => {
    await writeTemplateAccessDenial({
      actorUserId: null,
      actorIp: "203.0.113.9",
      log: fakeLog() as never,
      endpoint: "GET /api/join/:token",
      surface: "join_link",
    });
    expect(mockDbQuery).not.toHaveBeenCalled();
    expect(mockRedisSet).not.toHaveBeenCalled();
    expect(lastEvent()).toMatchObject({ actorUserId: null, surface: "join_link", auditRowWritten: false });
  });

  it("claims the D2a slot with SET <key> 1 PX 60000 NX on the documented key", async () => {
    await writeTemplateAccessDenial({
      actorUserId: ACTOR,
      actorGlobalRole: "facilitator",
      actorIp: "203.0.113.9",
      log: fakeLog() as never,
      endpoint: ENDPOINT,
      surface: "session",
    });
    expect(mockRedisSet).toHaveBeenCalledWith(
      `dipstick:template-denial:${ACTOR}:${ENDPOINT}`,
      "1",
      "PX",
      TEMPLATE_DENIAL_DEDUPE_WINDOW_MS,
      "NX",
    );
    expect(templateDenialDedupeKey(ACTOR, ENDPOINT)).toBe(`dipstick:template-denial:${ACTOR}:${ENDPOINT}`);
    expect(TEMPLATE_DENIAL_DEDUPE_WINDOW_MS).toBe(60_000);
  });

  describe("dedupe (specs: Repeated refusals by one actor are bounded)", () => {
    async function refuse(endpoint = ENDPOINT) {
      await writeTemplateAccessDenial({
        actorUserId: ACTOR,
        actorGlobalRole: "facilitator",
        actorIp: "203.0.113.9",
        log: fakeLog() as never,
        endpoint,
        surface: "session",
      });
    }

    it("a second refusal by the same actor on the same endpoint within the window writes no row and emits audit_row_suppressed", async () => {
      await refuse();
      await refuse();
      expect(insertCalls()).toHaveLength(1);
      expect(lastEvent()).toMatchObject({ auditRowWritten: false, audit_row_suppressed: true });
    });

    it("a refusal by the same actor on a different endpoint writes a row", async () => {
      await refuse();
      await refuse("GET /api/v1/teams/:teamId/sessions/:sessionId/facilitator-state");
      expect(insertCalls()).toHaveLength(2);
      expect(lastEvent()).toMatchObject({ auditRowWritten: true });
      expect(lastEvent()).not.toHaveProperty("audit_row_suppressed");
    });

    it("a refusal on the same endpoint after the window writes a row", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
      await refuse();
      vi.setSystemTime(new Date("2026-10-06T12:00:59Z"));
      await refuse();
      expect(insertCalls()).toHaveLength(1);
      vi.setSystemTime(new Date("2026-10-06T12:01:00.001Z"));
      await refuse();
      expect(insertCalls()).toHaveLength(2);
      expect(lastEvent()).toMatchObject({ auditRowWritten: true });
    });

    // Security implementation review F1: a failed insert must not hold the
    // slot, or the next refusal's row would be suppressed for a minute.
    it("an insert failure releases the slot, so the next refusal within the window writes its row", async () => {
      mockDbQuery.mockRejectedValueOnce(Object.assign(new Error("insert failed"), { code: "57014" }));
      await refuse();
      expect(insertCalls()).toHaveLength(1);
      await vi.waitFor(() => expect(mockRedisDel).toHaveBeenCalledWith(templateDenialDedupeKey(ACTOR, ENDPOINT)));
      expect(redisStore.has(templateDenialDedupeKey(ACTOR, ENDPOINT))).toBe(false);

      await refuse();
      expect(insertCalls()).toHaveLength(2);
      expect(lastEvent()).toMatchObject({ auditRowWritten: true });
      expect(lastEvent()).not.toHaveProperty("audit_row_suppressed");
    });

    it("a successful insert keeps the slot (no release)", async () => {
      await refuse();
      expect(mockRedisDel).not.toHaveBeenCalled();
      expect(redisStore.has(templateDenialDedupeKey(ACTOR, ENDPOINT))).toBe(true);
    });

    it("writes the row when Redis errors", async () => {
      mockRedisSet.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      await refuse();
      expect(insertCalls()).toHaveLength(1);
    });
  });

  it("an insert failure logs audit_write_failed with the code and message only, and does not throw", async () => {
    const dbError = Object.assign(new Error("relation is gone"), {
      code: "42P01",
      detail: "secret detail",
      parameters: ["bound value"],
    });
    mockDbQuery.mockRejectedValueOnce(dbError);
    const log = fakeLog();
    await expect(
      writeTemplateAccessDenial({
        actorUserId: ACTOR,
        actorGlobalRole: "facilitator",
        actorIp: "203.0.113.9",
        log: log as never,
        endpoint: ENDPOINT,
        surface: "session",
        correlationId: "corr-2",
      }),
    ).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledTimes(1);
    const logged = log.error.mock.calls[0]![0] as Record<string, unknown>;
    expect(logged).toEqual({
      audit_write_failed: true,
      operation: "team.template_access_denied",
      correlationId: "corr-2",
      failureMode: "error",
      dbErrorCode: "42P01",
      dbErrorMessage: "relation is gone",
    });
    expect(JSON.stringify(logged)).not.toContain("secret detail");
    expect(lastEvent()).toMatchObject({ auditRowWritten: false, correlationId: "corr-2" });
  });

  it("an insert that hangs is abandoned after AUDIT_WRITE_TIMEOUT_MS with audit_write_failed (failureMode timeout)", async () => {
    vi.useFakeTimers();
    mockDbQuery.mockImplementationOnce(() => new Promise(() => undefined));
    const log = fakeLog();
    const pending = writeTemplateAccessDenial({
      actorUserId: ACTOR,
      actorGlobalRole: "facilitator",
      actorIp: "203.0.113.9",
      log: log as never,
      endpoint: ENDPOINT,
      surface: "session",
    });
    await vi.advanceTimersByTimeAsync(AUDIT_WRITE_TIMEOUT_MS);
    await expect(pending).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ audit_write_failed: true, failureMode: "timeout" }),
      expect.any(String),
    );
    expect(lastEvent()).toMatchObject({ auditRowWritten: false });
  });
});
