import { describe, it, expect, vi, beforeEach } from "vitest";
import { emitAuditEvent } from "../audit-logger.js";

describe("emitAuditEvent", () => {
  const mockInfo = vi.fn();
  const mockError = vi.fn();
  const mockChild = vi.fn(() => ({ info: mockInfo, error: mockError }));
  const mockLogger = { child: mockChild } as unknown as Parameters<typeof emitAuditEvent>[0];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create a child logger with audit: true", () => {
    emitAuditEvent(mockLogger, "auth.success", { userId: "u1" });
    expect(mockChild).toHaveBeenCalledWith({ audit: true });
  });

  it("should log the event with timestamp and fields", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T10:00:00Z"));

    emitAuditEvent(mockLogger, "auth.session_created", {
      userId: "u1",
      sessionId: "s1",
    });

    expect(mockInfo).toHaveBeenCalledWith({
      event: "auth.session_created",
      timestamp: "2025-01-15T10:00:00.000Z",
      userId: "u1",
      sessionId: "s1",
    });

    vi.useRealTimers();
  });

  it("should handle empty fields", () => {
    emitAuditEvent(mockLogger, "auth.failure", {});
    expect(mockInfo).toHaveBeenCalledWith(
      expect.objectContaining({ event: "auth.failure" }),
    );
  });

  it("emits at error level only when asked (#264 topic.audit_write_failed), info otherwise", () => {
    emitAuditEvent(mockLogger, "topic.audit_write_failed", { teamId: "t" }, "error");
    expect(mockError).toHaveBeenCalledWith(expect.objectContaining({ event: "topic.audit_write_failed" }));
    expect(mockInfo).not.toHaveBeenCalled();
    emitAuditEvent(mockLogger, "topic.config_list_denied", {});
    expect(mockInfo).toHaveBeenCalledTimes(1);
    expect(mockError).toHaveBeenCalledTimes(1);
  });
});
