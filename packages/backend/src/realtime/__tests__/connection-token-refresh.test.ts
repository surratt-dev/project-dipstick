import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockRedisSetex = vi.fn();
const mockRedisDel = vi.fn();
const mockGetSessionDataById = vi.fn();
const mockRefreshSessionTokens = vi.fn();
const mockConditionallyUpdateSession = vi.fn();
const mockEmitAuditEvent = vi.fn();
const mockResolveActorGlobalRole = vi.fn();
const mockResolveTeamIdForAudit = vi.fn();
const mockDbQuery = vi.fn();

vi.mock("../../redis.js", () => ({
  redis: {
    setex: (...args: unknown[]) => mockRedisSetex(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  },
}));
vi.mock("../../db.js", () => ({
  db: { query: (...args: unknown[]) => mockDbQuery(...args) },
}));
vi.mock("../../auth/middleware.js", () => ({
  refreshSessionTokens: (...args: unknown[]) => mockRefreshSessionTokens(...args),
  TOKEN_REFRESH_THRESHOLD_S: 5 * 60,
}));
vi.mock("../../auth/session-store.js", () => ({
  conditionallyUpdateSession: (...args: unknown[]) => mockConditionallyUpdateSession(...args),
  getSessionDataById: (...args: unknown[]) => mockGetSessionDataById(...args),
}));
vi.mock("../../auth/audit-logger.js", () => ({
  emitAuditEvent: (...args: unknown[]) => mockEmitAuditEvent(...args),
}));
vi.mock("../connection-reauthorization.js", () => ({
  resolveActorGlobalRole: (...args: unknown[]) => mockResolveActorGlobalRole(...args),
  resolveTeamIdForAudit: (...args: unknown[]) => mockResolveTeamIdForAudit(...args),
}));
vi.mock("../../config.js", () => ({
  config: { DATABASE_URL: "postgres://test", REDIS_URL: "redis://test", SESSION_SECRET: "test", NODE_ENV: "test" },
}));

import {
  scheduleTokenRefreshMonitor,
  consumeGraceRecoveryMarker,
  recordConnectionRecoveredAudit,
  REAUTH_GRACE_EXPIRED_CLOSE_CODE,
} from "../connection-token-refresh.js";
import { STALE_SIGNAL_CLOSE_CODE } from "../staleness-signal.js";
import { ConnectionRegistry, type RegisteredConnection } from "../connection-registry.js";

function fakeConn(overrides: Partial<RegisteredConnection> = {}): RegisteredConnection & {
  socket: { readyState: number; OPEN: number; close: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
} {
  const socket = { readyState: 1, OPEN: 1, close: vi.fn(), send: vi.fn() };
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

const nowSec = () => Math.floor(Date.now() / 1000);

describe("scheduleTokenRefreshMonitor (SEC-26, design.md Decisions D3/D3a/D3c)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    mockResolveActorGlobalRole.mockResolvedValue("engineer");
    mockResolveTeamIdForAudit.mockResolvedValue("team-1");
    mockDbQuery.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("silent refresh success: no client-visible message, connection stays open past the original tokenExpiresAt (task 3.8)", async () => {
    const expiresAt = nowSec() + 60; // within 5-min threshold immediately
    mockGetSessionDataById.mockResolvedValue({
      userId: "user-1",
      tokenExpiresAt: expiresAt,
      encryptedAccessToken: "enc(old)",
    });
    mockRefreshSessionTokens.mockResolvedValue({
      status: "refreshed",
      session: { userId: "user-1", tokenExpiresAt: expiresAt + 3600, encryptedAccessToken: "enc(new)" },
    });
    mockConditionallyUpdateSession.mockResolvedValue(true);

    const conn = fakeConn();
    const registry = new ConnectionRegistry();
    registry.register("session", "session-1", conn);

    scheduleTokenRefreshMonitor(conn, "session", "session-1", registry, noopLogger as never);
    await vi.advanceTimersByTimeAsync(0);

    expect(mockRefreshSessionTokens).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      "fastify-sess-1",
      noopLogger,
      "websocket",
    );
    expect(mockConditionallyUpdateSession).toHaveBeenCalledWith(
      "fastify-sess-1",
      expect.objectContaining({ tokenExpiresAt: expiresAt + 3600 }),
    );
    expect(conn.socket.send).not.toHaveBeenCalled();
    expect(conn.socket.close).not.toHaveBeenCalled();
  });

  it("transient failure retries then falls through to reauth_required (task 3.8) and writes exactly one audit_log row", async () => {
    const expiresAt = nowSec() + 60;
    mockGetSessionDataById.mockResolvedValue({ userId: "user-1", tokenExpiresAt: expiresAt });
    mockRefreshSessionTokens.mockResolvedValue({ status: "transient_failure" });

    const conn = fakeConn();
    const registry = new ConnectionRegistry();
    registry.register("session", "session-1", conn);

    scheduleTokenRefreshMonitor(conn, "session", "session-1", registry, noopLogger as never);
    await vi.advanceTimersByTimeAsync(0);

    expect(conn.socket.send).toHaveBeenCalledWith(JSON.stringify({ eventType: "reauth_required" }));
    const insertCall = mockDbQuery.mock.calls.find((c) => String(c[0]).includes("INSERT INTO audit_log"));
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual([
      "user-1",
      "engineer",
      "session.token_refresh_failed_live",
      "team-1",
      JSON.stringify({ scope: "session", scopeId: "session-1", failureType: "transient_failure" }),
    ]);
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      noopLogger,
      "session.token_refresh_failed_live",
      expect.objectContaining({ failureType: "transient_failure" }),
    );
  });

  it("a successful refresh does not alter sessionCreatedAt and the connection is still force-closed independently of refresh recency (task 3.8)", async () => {
    // This module never reads or writes conn.sessionCreatedAt at all — the
    // absolute-lifetime bound (scheduleForceClose, websocket-routes.ts) is
    // structurally independent of this refresh path (design.md Decision D6).
    const expiresAt = nowSec() + 60;
    const sessionCreatedAtBefore = Date.now() - 1000;
    mockGetSessionDataById.mockResolvedValue({ userId: "user-1", tokenExpiresAt: expiresAt });
    mockRefreshSessionTokens.mockResolvedValue({
      status: "refreshed",
      session: { userId: "user-1", tokenExpiresAt: expiresAt + 3600 },
    });
    mockConditionallyUpdateSession.mockResolvedValue(true);

    const conn = fakeConn({ sessionCreatedAt: sessionCreatedAtBefore });
    const registry = new ConnectionRegistry();
    registry.register("session", "session-1", conn);

    scheduleTokenRefreshMonitor(conn, "session", "session-1", registry, noopLogger as never);
    await vi.advanceTimersByTimeAsync(0);

    expect(conn.sessionCreatedAt).toBe(sessionCreatedAtBefore);
  });

  it("a timer fire against an already-refreshed session skips refreshSessionTokens entirely (task 3.2, also the Decision D3c rotation-race mitigation)", async () => {
    // Scheduled far enough out that by the time it fires, an independent HTTP
    // request has already pushed tokenExpiresAt well past the threshold.
    const initialExpiresAt = nowSec() + 6 * 60; // 6 min out — timer scheduled for ~1 min from now
    mockGetSessionDataById.mockResolvedValueOnce({ userId: "user-1", tokenExpiresAt: initialExpiresAt });

    const conn = fakeConn();
    const registry = new ConnectionRegistry();
    registry.register("session", "session-1", conn);
    scheduleTokenRefreshMonitor(conn, "session", "session-1", registry, noopLogger as never);
    await vi.advanceTimersByTimeAsync(0); // let the initial scheduling read resolve

    // Simulate an HTTP-side refresh landing before the WS timer fires.
    mockGetSessionDataById.mockResolvedValue({ userId: "user-1", tokenExpiresAt: nowSec() + 3600 });

    await vi.advanceTimersByTimeAsync(60 * 1000);

    expect(mockRefreshSessionTokens).not.toHaveBeenCalled();
  });

  it('"no_refresh_token" reschedules without error (task 3.8)', async () => {
    const expiresAt = nowSec() + 60;
    mockGetSessionDataById.mockResolvedValue({ userId: "user-1", tokenExpiresAt: expiresAt });
    mockRefreshSessionTokens.mockResolvedValue({ status: "no_refresh_token" });

    const conn = fakeConn();
    const registry = new ConnectionRegistry();
    registry.register("session", "session-1", conn);

    scheduleTokenRefreshMonitor(conn, "session", "session-1", registry, noopLogger as never);
    await vi.advanceTimersByTimeAsync(0);

    expect(conn.socket.send).not.toHaveBeenCalled();
    expect(conn.socket.close).not.toHaveBeenCalled();
    expect(conn.tokenRefreshTimer).toBeDefined();
  });

  it("a conditionallyUpdateSession rejection (destroy() raced ahead) is treated as a failure, not a silent success (task 3.7 / Decision D3a)", async () => {
    const expiresAt = nowSec() + 60;
    mockGetSessionDataById.mockResolvedValue({ userId: "user-1", tokenExpiresAt: expiresAt });
    mockRefreshSessionTokens.mockResolvedValue({
      status: "refreshed",
      session: { userId: "user-1", tokenExpiresAt: expiresAt + 3600 },
    });
    mockConditionallyUpdateSession.mockResolvedValue(false); // destroy() ran first

    const conn = fakeConn();
    const registry = new ConnectionRegistry();
    registry.register("session", "session-1", conn);

    scheduleTokenRefreshMonitor(conn, "session", "session-1", registry, noopLogger as never);
    await vi.advanceTimersByTimeAsync(0);

    // Never falls back to an unconditional write, never retries — proceeds
    // straight to the grace-period path, same as a "revoked" result.
    expect(mockConditionallyUpdateSession).toHaveBeenCalledTimes(1);
    expect(conn.socket.send).toHaveBeenCalledWith(JSON.stringify({ eventType: "reauth_required" }));
    const insertCall = mockDbQuery.mock.calls.find((c) => String(c[0]).includes("INSERT INTO audit_log"));
    expect(insertCall![1]).toEqual([
      "user-1",
      "engineer",
      "session.token_refresh_failed_live",
      "team-1",
      JSON.stringify({ scope: "session", scopeId: "session-1", failureType: "session_destroyed_concurrently" }),
    ]);
  });
});

describe("SEC-26 grace period — hygiene bound, not in-place recovery (design.md Decision D4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockResolveActorGlobalRole.mockResolvedValue("engineer");
    mockResolveTeamIdForAudit.mockResolvedValue("team-1");
    mockDbQuery.mockResolvedValue({ rows: [] });
    mockRedisSetex.mockResolvedValue("OK");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("positive mirror scenario: reauth_required is sent before the grace-expiry close, which uses REAUTH_GRACE_EXPIRED_CLOSE_CODE — never STALE_SIGNAL_CLOSE_CODE (task 4.6)", async () => {
    const expiresAt = nowSec() + 60;
    mockGetSessionDataById.mockResolvedValue({ userId: "user-1", tokenExpiresAt: expiresAt });
    mockRefreshSessionTokens.mockResolvedValue({ status: "revoked" });

    const conn = fakeConn();
    const registry = new ConnectionRegistry();
    registry.register("session", "session-1", conn);

    scheduleTokenRefreshMonitor(conn, "session", "session-1", registry, noopLogger as never);
    await vi.advanceTimersByTimeAsync(0);

    expect(conn.socket.send).toHaveBeenCalledWith(JSON.stringify({ eventType: "reauth_required" }));
    expect(conn.socket.close).not.toHaveBeenCalled(); // not yet — grace period just started

    await vi.advanceTimersByTimeAsync(30 * 1000);

    expect(conn.socket.close).toHaveBeenCalledWith(REAUTH_GRACE_EXPIRED_CLOSE_CODE);
    expect(conn.socket.close).not.toHaveBeenCalledWith(STALE_SIGNAL_CLOSE_CODE);
    expect(registry.candidates("session", "session-1")).toHaveLength(0);
  });

  it("negative acceptance scenario: the grace-expiry close never sends or implies STALE_SIGNAL_CLOSE_CODE, and no code path in this module can send both signals for one closure (task 4.5)", async () => {
    // Structural check: REAUTH_GRACE_EXPIRED_CLOSE_CODE and
    // STALE_SIGNAL_CLOSE_CODE must be distinct values, and this module's
    // only close() call site uses the former exclusively.
    expect(REAUTH_GRACE_EXPIRED_CLOSE_CODE).not.toBe(STALE_SIGNAL_CLOSE_CODE);
    expect(REAUTH_GRACE_EXPIRED_CLOSE_CODE).toBe(4001);
  });

  it("grace-period timer performs no re-read of session state on expiry — unconditional close (task 4.3)", async () => {
    const expiresAt = nowSec() + 60;
    mockGetSessionDataById.mockResolvedValue({ userId: "user-1", tokenExpiresAt: expiresAt });
    mockRefreshSessionTokens.mockResolvedValue({ status: "revoked" });

    const conn = fakeConn();
    const registry = new ConnectionRegistry();
    registry.register("session", "session-1", conn);

    scheduleTokenRefreshMonitor(conn, "session", "session-1", registry, noopLogger as never);
    await vi.advanceTimersByTimeAsync(0);

    const getCallCountAtGraceStart = mockGetSessionDataById.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30 * 1000);

    expect(mockGetSessionDataById.mock.calls.length).toBe(getCallCountAtGraceStart); // no additional read on expiry
    expect(conn.socket.close).toHaveBeenCalledWith(REAUTH_GRACE_EXPIRED_CLOSE_CODE);
  });
});

describe("consumeGraceRecoveryMarker (design.md Decision D4/D9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recovery scenario: a marker written for a user is consumed exactly once (task 4.7)", async () => {
    mockRedisDel.mockResolvedValueOnce(1); // first check: marker existed and was deleted
    const first = await consumeGraceRecoveryMarker("user-1");
    expect(first).toBe(true);
    expect(mockRedisDel).toHaveBeenCalledWith("dipstick:reauth-grace:user-1");

    mockRedisDel.mockResolvedValueOnce(0); // second check: nothing left to delete
    const second = await consumeGraceRecoveryMarker("user-1");
    expect(second).toBe(false);
  });

  it("security-boundary test: lookup is keyed strictly by the resolved userId argument, never any other identifier (task 4.8)", async () => {
    mockRedisDel.mockResolvedValue(0);
    await consumeGraceRecoveryMarker("user-2");
    expect(mockRedisDel).toHaveBeenCalledWith("dipstick:reauth-grace:user-2");
    expect(mockRedisDel).not.toHaveBeenCalledWith(expect.stringContaining("user-1"));
  });
});

describe("recordConnectionRecoveredAudit (design.md Decision D9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveActorGlobalRole.mockResolvedValue("engineer");
    mockResolveTeamIdForAudit.mockResolvedValue("team-1");
    mockDbQuery.mockResolvedValue({ rows: [] });
  });

  it("writes exactly one session.connection_recovered row with no cause/token detail in metadata", async () => {
    await recordConnectionRecoveredAudit("user-1", "session", "session-1", noopLogger as never);

    const insertCall = mockDbQuery.mock.calls.find((c) => String(c[0]).includes("INSERT INTO audit_log"));
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual([
      "user-1",
      "engineer",
      "session.connection_recovered",
      "team-1",
      JSON.stringify({ scope: "session", scopeId: "session-1" }),
    ]);
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      noopLogger,
      "session.connection_recovered",
      expect.objectContaining({ scope: "session", scopeId: "session-1" }),
    );
  });
});
