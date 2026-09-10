import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockDbQuery = vi.fn();
const mockEvaluateSessionSubscriberAccess = vi.fn();
const mockEvaluateTeamAccess = vi.fn();
const mockEmitAuditEvent = vi.fn();

vi.mock("../../db.js", () => ({
  db: { query: (...args: unknown[]) => mockDbQuery(...args) },
}));
vi.mock("../../auth/session-subscriber-access-helper.js", () => ({
  evaluateSessionSubscriberAccess: (...args: unknown[]) => mockEvaluateSessionSubscriberAccess(...args),
}));
vi.mock("../../auth/team-content-access-helper.js", () => ({
  evaluateTeamAccess: (...args: unknown[]) => mockEvaluateTeamAccess(...args),
}));
vi.mock("../../auth/audit-logger.js", () => ({
  emitAuditEvent: (...args: unknown[]) => mockEmitAuditEvent(...args),
}));
vi.mock("../../config.js", () => ({
  config: { DATABASE_URL: "postgres://test", REDIS_URL: "redis://test", SESSION_SECRET: "test", NODE_ENV: "test" },
}));

import {
  scheduleReauthorizationSweep,
  REAUTHORIZATION_INTERVAL_MS,
} from "../connection-reauthorization.js";
import { ConnectionRegistry, type RegisteredConnection } from "../connection-registry.js";
import { STALE_SIGNAL_CLOSE_CODE } from "../staleness-signal.js";

function fakeConn(overrides: Partial<RegisteredConnection> = {}): RegisteredConnection & {
  socket: { readyState: number; OPEN: number; close: ReturnType<typeof vi.fn> };
} {
  const socket = { readyState: 1, OPEN: 1, close: vi.fn() };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double for a `ws` socket
    socket: socket as any,
    userId: "user-1",
    sessionCreatedAt: Date.now(),
    fastifySessionId: "fastify-sess-1",
    ...overrides,
  } as RegisteredConnection & { socket: typeof socket };
}

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(() => ({ info: vi.fn() })),
};

describe("scheduleReauthorizationSweep (SEC-25/SEC-27, design.md Decision D2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockDbQuery.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("session-scoped: closes with STALE_SIGNAL_CLOSE_CODE and writes exactly one audit_log row when access is revoked, without pushing any event", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValue(null);
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] }) // actor role lookup
      .mockResolvedValueOnce({ rows: [{ team_id: "team-1" }] }) // team id for session
      .mockResolvedValueOnce({ rows: [] }); // INSERT INTO audit_log

    const registry = new ConnectionRegistry();
    const conn = fakeConn();
    registry.register("session", "session-1", conn);

    scheduleReauthorizationSweep(conn, "session", "session-1", registry, noopLogger as never);
    await vi.advanceTimersByTimeAsync(REAUTHORIZATION_INTERVAL_MS);

    expect(conn.socket.close).toHaveBeenCalledWith(STALE_SIGNAL_CLOSE_CODE);
    expect(registry.candidates("session", "session-1")).toHaveLength(0);

    const insertCall = mockDbQuery.mock.calls.find((c) => String(c[0]).includes("INSERT INTO audit_log"));
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual([
      "user-1",
      "engineer",
      "team-1",
      JSON.stringify({ scope: "session", scopeId: "session-1" }),
    ]);
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      noopLogger,
      "session.access_revoked_live",
      expect.objectContaining({ scope: "session", scopeId: "session-1" }),
    );
  });

  it("team-scoped: closes when the grant is null", async () => {
    mockEvaluateTeamAccess.mockResolvedValue(null);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] }).mockResolvedValueOnce({ rows: [] });

    const registry = new ConnectionRegistry();
    const conn = fakeConn();
    registry.register("team", "team-1", conn);

    scheduleReauthorizationSweep(conn, "team", "team-1", registry, noopLogger as never);
    await vi.advanceTimersByTimeAsync(REAUTHORIZATION_INTERVAL_MS);

    expect(conn.socket.close).toHaveBeenCalledWith(STALE_SIGNAL_CLOSE_CODE);
  });

  it("team-scoped: an application_admin's admin-path grant is rejected even though membership was never removed", async () => {
    mockEvaluateTeamAccess.mockResolvedValue({ path: "admin", actorGlobalRole: "application_admin" });
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "application_admin" }] }).mockResolvedValueOnce({ rows: [] });

    const registry = new ConnectionRegistry();
    const conn = fakeConn();
    registry.register("team", "team-1", conn);

    scheduleReauthorizationSweep(conn, "team", "team-1", registry, noopLogger as never);
    await vi.advanceTimersByTimeAsync(REAUTHORIZATION_INTERVAL_MS);

    expect(conn.socket.close).toHaveBeenCalledWith(STALE_SIGNAL_CLOSE_CODE);
  });

  it("EM-promotion mid-connection: a session-scoped grant that now fails (e.g. global_role changed) is treated the same as any other revocation", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValue(null);
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "engineering_manager" }] })
      .mockResolvedValueOnce({ rows: [{ team_id: "team-1" }] })
      .mockResolvedValueOnce({ rows: [] });

    const registry = new ConnectionRegistry();
    const conn = fakeConn();
    registry.register("session", "session-1", conn);

    scheduleReauthorizationSweep(conn, "session", "session-1", registry, noopLogger as never);
    await vi.advanceTimersByTimeAsync(REAUTHORIZATION_INTERVAL_MS);

    expect(conn.socket.close).toHaveBeenCalledWith(STALE_SIGNAL_CLOSE_CODE);
  });

  it("a healthy connection receives no message, is not closed, and produces no audit row across multiple intervals", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValue({
      path: "participant",
      sessionId: "session-1",
      teamId: "team-1",
      actorGlobalRole: "engineer",
    });

    const registry = new ConnectionRegistry();
    const conn = fakeConn();
    registry.register("session", "session-1", conn);

    scheduleReauthorizationSweep(conn, "session", "session-1", registry, noopLogger as never);
    await vi.advanceTimersByTimeAsync(REAUTHORIZATION_INTERVAL_MS * 3);

    expect(conn.socket.close).not.toHaveBeenCalled();
    expect(registry.candidates("session", "session-1")).toEqual([conn]);
    expect(mockDbQuery).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.anything());
  });
});
