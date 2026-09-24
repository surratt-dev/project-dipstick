import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type * as AuditLoggerModule from "../audit-logger.js";

const mockDbQuery = vi.fn();
const mockEmitAuditEvent = vi.fn();

vi.mock("../../db.js", () => ({
  db: { query: (...args: unknown[]) => mockDbQuery(...args) },
}));
vi.mock("../audit-logger.js", async () => {
  const actual = await vi.importActual<typeof AuditLoggerModule>("../audit-logger.js");
  return {
    ...actual,
    emitAuditEvent: (...args: unknown[]) => mockEmitAuditEvent(...args),
  };
});

import { writeFailOpenAuditRow } from "../fail-open-audit-write.js";
import { AUDIT_WRITE_TIMEOUT_MS } from "../audit-write-timeout.js";

function fakeLog() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), child: vi.fn(() => ({ info: vi.fn() })) } as never;
}

describe("writeFailOpenAuditRow (auth-events-audit-log-coverage, design.md Decision D2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes an audit_log row with the given operation, actor fields, team_id, and metadata", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    await writeFailOpenAuditRow({
      operation: "auth.success",
      userId: "user-1",
      actorGlobalRole: "engineer",
      actorIp: "203.0.113.7",
      teamId: null,
      metadata: { oidcSubject: "sub-1", oidcIssuer: "https://idp.example.com", isFirstAccess: false, correlationId: "corr-1" },
      log: fakeLog(),
      failureAuditFields: { userId: "user-1", operation: "auth.success" },
    });

    expect(mockDbQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockDbQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO audit_log");
    expect(params[0]).toBe("user-1");
    expect(params[1]).toBe("engineer");
    expect(params[2]).toBe("203.0.113.7");
    expect(params[3]).toBe("auth.success");
    expect(params[4]).toBeNull();
    expect(JSON.parse(params[5] as string)).toEqual({
      oidcSubject: "sub-1",
      oidcIssuer: "https://idp.example.com",
      isFirstAccess: false,
      correlationId: "corr-1",
    });
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  it("does not rethrow on a database error, and emits auth.audit_write_failed with failureMode 'error'", async () => {
    mockDbQuery.mockRejectedValueOnce(new Error("connection reset"));

    await expect(
      writeFailOpenAuditRow({
        operation: "auth.session_created",
        userId: "user-1",
        actorGlobalRole: "engineer",
        actorIp: "203.0.113.7",
        teamId: null,
        metadata: {},
        log: fakeLog(),
        failureAuditFields: { userId: "user-1", authSessionId: "sess-1", operation: "auth.session_created" },
      }),
    ).resolves.toBeUndefined();

    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "auth.audit_write_failed",
      expect.objectContaining({
        userId: "user-1",
        authSessionId: "sess-1",
        operation: "auth.session_created",
        failureMode: "error",
        sourceIp: "203.0.113.7",
      }),
    );
  });

  describe("timeout behavior", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("does not block past AUDIT_WRITE_TIMEOUT_MS when the INSERT hangs, and emits failureMode 'timeout'", async () => {
      vi.useFakeTimers();
      try {
        let releaseHang: () => void = () => {};
        const hang = new Promise<{ rows: unknown[] }>((resolve) => {
          releaseHang = () => resolve({ rows: [] });
        });
        mockDbQuery.mockReturnValueOnce(hang);

        const writePromise = writeFailOpenAuditRow({
          operation: "auth.idp_logout_failed",
          userId: "user-1",
          actorGlobalRole: "engineer",
          actorIp: "203.0.113.7",
          teamId: null,
          metadata: { authSessionId: "sess-1" },
          log: fakeLog(),
          failureAuditFields: { userId: "user-1", authSessionId: "sess-1", operation: "auth.idp_logout_failed" },
        });

        await vi.advanceTimersByTimeAsync(AUDIT_WRITE_TIMEOUT_MS);
        await writePromise;

        expect(mockEmitAuditEvent).toHaveBeenCalledWith(
          expect.anything(),
          "auth.audit_write_failed",
          expect.objectContaining({ failureMode: "timeout", operation: "auth.idp_logout_failed" }),
        );

        releaseHang();
        await Promise.resolve();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
