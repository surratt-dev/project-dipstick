import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockDbQuery = vi.fn();
const mockEmitAuditEvent = vi.fn();

vi.mock("../../db.js", () => ({
  db: { query: (...args: unknown[]) => mockDbQuery(...args) },
}));
// resolveActorGlobalRole is imported (unmocked) from the real
// connection-reauthorization.js -- only its own db.query dependency is
// mocked, matching connection-reauthorization.test.ts's own pattern. Its
// sibling imports (session-subscriber-access-helper.js,
// team-content-access-helper.js) depend only on db.js/audit-logger.js,
// both already mocked here.
vi.mock("../audit-logger.js", () => ({
  emitAuditEvent: (...args: unknown[]) => mockEmitAuditEvent(...args),
}));
vi.mock("../../config.js", () => ({
  config: { DATABASE_URL: "postgres://test", REDIS_URL: "redis://test", SESSION_SECRET: "test", NODE_ENV: "test" },
}));

import {
  writeSessionInvalidatedAuditRow,
  withTimeout,
  AuditWriteTimeoutError,
  AUDIT_WRITE_TIMEOUT_MS,
} from "../session-invalidation-audit.js";

function fakeRequest(overrides: Record<string, unknown> = {}) {
  return {
    ip: "203.0.113.7",
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), child: vi.fn(() => ({ info: vi.fn() })) },
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double for FastifyRequest
  } as any;
}

describe("writeSessionInvalidatedAuditRow (http-auth-audit-log-coverage, design.md Decisions D2/D5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes an audit_log row with actor_global_role, actor_ip, team_id NULL, and reason/authSessionId metadata (no failureType/retryCount for absolute_timeout)", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] }) // resolveActorGlobalRole SELECT
      .mockResolvedValueOnce({ rows: [] }); // INSERT INTO audit_log

    const request = fakeRequest();
    await writeSessionInvalidatedAuditRow("user-1", "sess-1", "absolute_timeout", request);

    expect(mockDbQuery).toHaveBeenCalledTimes(2);
    const insertCall = mockDbQuery.mock.calls[1] as [string, unknown[]];
    expect(insertCall[0]).toContain("INSERT INTO audit_log");
    expect(insertCall[0]).toContain("'auth.session_invalidated'");
    expect(insertCall[1]).toEqual([
      "user-1",
      "engineer",
      "203.0.113.7",
      JSON.stringify({ reason: "absolute_timeout", authSessionId: "sess-1" }),
    ]);
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  it("includes failureType/retryCount in metadata for the token_revoked branch", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] })
      .mockResolvedValueOnce({ rows: [] });

    const request = fakeRequest();
    await writeSessionInvalidatedAuditRow("user-1", "sess-1", "token_revoked", request, {
      failureType: "revoked",
      retryCount: 0,
    });

    const insertCall = mockDbQuery.mock.calls[1] as [string, unknown[]];
    expect(insertCall[1]).toEqual([
      "user-1",
      "engineer",
      "203.0.113.7",
      JSON.stringify({
        reason: "token_revoked",
        authSessionId: "sess-1",
        failureType: "revoked",
        retryCount: 0,
      }),
    ]);
  });

  it("includes failureType/retryCount in metadata for the refresh_failure branch", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] })
      .mockResolvedValueOnce({ rows: [] });

    const request = fakeRequest();
    await writeSessionInvalidatedAuditRow("user-1", "sess-1", "refresh_failure", request, {
      failureType: "transient",
      retryCount: 2,
    });

    const insertCall = mockDbQuery.mock.calls[1] as [string, unknown[]];
    expect(insertCall[1]).toEqual([
      "user-1",
      "engineer",
      "203.0.113.7",
      JSON.stringify({
        reason: "refresh_failure",
        authSessionId: "sess-1",
        failureType: "transient",
        retryCount: 2,
      }),
    ]);
  });

  it("explicit_logout carries no failureType/retryCount, and team_id is a literal NULL", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] })
      .mockResolvedValueOnce({ rows: [] });

    const request = fakeRequest();
    await writeSessionInvalidatedAuditRow("user-1", "sess-1", "explicit_logout", request);

    const insertCall = mockDbQuery.mock.calls[1] as [string, unknown[]];
    expect(insertCall[0]).toContain("NULL");
    expect(insertCall[1]).toEqual([
      "user-1",
      "engineer",
      "203.0.113.7",
      JSON.stringify({ reason: "explicit_logout", authSessionId: "sess-1" }),
    ]);
  });

  // Task 5.8: resolveActorGlobalRole's no-row-found fallback to "unknown" is
  // documented behavior, not a failure -- this must complete the write
  // normally and must NOT emit auth.audit_write_failed.
  it("completes the write with actor_global_role 'unknown' when the user lookup finds no row, and does not emit auth.audit_write_failed", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [] }) // no matching users row
      .mockResolvedValueOnce({ rows: [] }); // INSERT still proceeds

    const request = fakeRequest();
    await writeSessionInvalidatedAuditRow("user-missing", "sess-1", "absolute_timeout", request);

    const insertCall = mockDbQuery.mock.calls[1] as [string, unknown[]];
    expect(insertCall[1][1]).toBe("unknown");
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  // Task 5.5
  it("fails open on a database error without rethrowing, and emits auth.audit_write_failed with failureMode 'error' and sourceIp", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] })
      .mockRejectedValueOnce(new Error("connection reset")); // INSERT fails

    const request = fakeRequest();
    await expect(
      writeSessionInvalidatedAuditRow("user-1", "sess-1", "refresh_failure", request, {
        failureType: "transient",
        retryCount: 2,
      }),
    ).resolves.toBeUndefined();

    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "auth.audit_write_failed",
      expect.objectContaining({
        userId: "user-1",
        authSessionId: "sess-1",
        reason: "refresh_failure",
        failureMode: "error",
        sourceIp: "203.0.113.7",
      }),
    );
  });

  it("fails open on an error thrown by the actor-global-role lookup itself", async () => {
    mockDbQuery.mockRejectedValueOnce(new Error("pool exhausted"));

    const request = fakeRequest();
    await writeSessionInvalidatedAuditRow("user-1", "sess-1", "absolute_timeout", request);

    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "auth.audit_write_failed",
      expect.objectContaining({ reason: "absolute_timeout", failureMode: "error" }),
    );
  });

  // Task 5.6 / 5.1: a hang on either DB call must not block past the single
  // ~500ms AUDIT_WRITE_TIMEOUT_MS bound -- not ~1000ms from two independent
  // timeouts (Decision D5's corrected mechanism). Uses
  // vi.advanceTimersByTimeAsync, not vi.advanceTimersByTime, per tasks.md 5.1
  // -- the latter deadlocks racing a mocked-to-hang promise against
  // withTimeout's own internal setTimeout.
  it("does not block past the single AUDIT_WRITE_TIMEOUT_MS bound when a DB call hangs, and emits failureMode 'timeout'", async () => {
    vi.useFakeTimers();
    try {
      let releaseHang: () => void = () => {};
      const hang = new Promise<{ rows: { global_role: string }[] }>((resolve) => {
        releaseHang = () => resolve({ rows: [{ global_role: "engineer" }] });
      });
      mockDbQuery.mockReturnValueOnce(hang); // actor-role SELECT hangs

      const request = fakeRequest();
      const writePromise = writeSessionInvalidatedAuditRow(
        "user-1",
        "sess-1",
        "absolute_timeout",
        request,
      );

      await vi.advanceTimersByTimeAsync(AUDIT_WRITE_TIMEOUT_MS);
      await writePromise;

      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        "auth.audit_write_failed",
        expect.objectContaining({ reason: "absolute_timeout", failureMode: "timeout" }),
      );

      // The INSERT never ran -- the SELECT it depends on never resolved
      // before the shared timeout fired.
      expect(mockDbQuery).toHaveBeenCalledTimes(1);

      // Clean up the still-pending hang so it doesn't leak into another test
      // as an unhandled rejection/resolution.
      releaseHang();
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("withTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the promise's value when it settles before the timeout", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 500)).resolves.toBe("ok");
  });

  it("throws AuditWriteTimeoutError when the timer wins, and does not leave an unhandled rejection when the raced promise later rejects", async () => {
    vi.useFakeTimers();
    let rejectLate: (err: Error) => void = () => {};
    const late = new Promise<string>((_, reject) => {
      rejectLate = reject;
    });

    const racePromise = withTimeout(late, 100);
    const assertion = expect(racePromise).rejects.toBeInstanceOf(AuditWriteTimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;

    // The original promise rejects after the race is already decided --
    // withTimeout's own no-op .catch must have already been attached so this
    // does not surface as an unhandled rejection.
    rejectLate(new Error("late failure"));
    await Promise.resolve();
    vi.useRealTimers();
  });
});
