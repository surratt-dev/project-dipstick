import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type * as SubscriberAccessHelperModule from "../../auth/session-subscriber-access-helper.js";

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

  // template-team-not-usable (#214) tasks.md 8.5: after migration 23 no
  // template membership is active and no template session grants its
  // facilitator, so evaluateTeamAccess returns no grant for a connection on
  // the template team. A single sweep closes it (the up-to-5-minute residual
  // design.md D4 accepts for sockets already open at deploy time).
  it("#214 8.5: a connection on the template team with no grant is closed by a single sweep", async () => {
    const { DEFAULT_TOPICS_TEAM_ID } = await import("../../sessions/default-topics.js");
    mockEvaluateTeamAccess.mockResolvedValue(null);
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] }).mockResolvedValueOnce({ rows: [] });

    const registry = new ConnectionRegistry();
    const conn = fakeConn();
    registry.register("team", DEFAULT_TOPICS_TEAM_ID, conn);

    scheduleReauthorizationSweep(conn, "team", DEFAULT_TOPICS_TEAM_ID, registry, noopLogger as never);
    await vi.advanceTimersByTimeAsync(REAUTHORIZATION_INTERVAL_MS);

    expect(mockEvaluateTeamAccess).toHaveBeenCalledWith("user-1", DEFAULT_TOPICS_TEAM_ID, expect.anything());
    expect(conn.socket.close).toHaveBeenCalledTimes(1);
    expect(conn.socket.close).toHaveBeenCalledWith(STALE_SIGNAL_CLOSE_CODE);
    expect(registry.candidates("team", DEFAULT_TOPICS_TEAM_ID)).toHaveLength(0);
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

  // configurable-oidc-role-map D11 (E3). Uses the REAL
  // evaluateSessionSubscriberAccess over the mocked db, so the sweep's
  // revocation is driven by the helper's admin check, not a stubbed null.
  it("D11: the sweep drops the participant grant of a user whose global_role is now application_admin", async () => {
    const actual = await vi.importActual<typeof SubscriberAccessHelperModule>(
      "../../auth/session-subscriber-access-helper.js",
    );
    mockEvaluateSessionSubscriberAccess.mockImplementation((userId: string, sessionId: string) =>
      actual.evaluateSessionSubscriberAccess(userId, sessionId),
    );
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          session_id: "session-1", team_id: "team-1", facilitator_id: "someone-else", session_status: "active",
          global_role: "application_admin", participant_row_id: "p1", membership_role: "participant",
          membership_removed_at: null, membership_exists: true,
        }],
      }) // evaluateSessionSubscriberAccess
      .mockResolvedValueOnce({ rows: [{ global_role: "application_admin" }] }) // actor role lookup
      .mockResolvedValueOnce({ rows: [{ team_id: "team-1" }] })
      .mockResolvedValueOnce({ rows: [] }); // INSERT INTO audit_log

    const registry = new ConnectionRegistry();
    const conn = fakeConn();
    registry.register("session", "session-1", conn);

    scheduleReauthorizationSweep(conn, "session", "session-1", registry, noopLogger as never);
    await vi.advanceTimersByTimeAsync(REAUTHORIZATION_INTERVAL_MS);

    expect(conn.socket.close).toHaveBeenCalledWith(STALE_SIGNAL_CLOSE_CODE);
    expect(registry.candidates("session", "session-1")).toHaveLength(0);
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
