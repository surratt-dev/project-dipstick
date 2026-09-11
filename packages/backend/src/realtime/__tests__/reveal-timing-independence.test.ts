import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Reveal-timing independence — websocket-connection-reauthorization,
// design.md Decision D8, tasks.md Group 6.
//
// Confirms that concurrent SEC-25 (connection-reauthorization.ts) and
// SEC-26 (connection-token-refresh.ts) timer activity on a connection does
// not gate, delay, or bypass a vote_revealed delivery-time check
// (dispatchVoteRevealed in ws-event-dispatcher.ts). All three modules run
// for real here — only their own DB/Redis/OIDC boundaries are mocked — so
// this exercises the actual interaction between three independently
// scheduled timers and one delivery-time push on the same connection
// object, not three isolated unit tests asserting the same thing in
// separate processes.
// ---------------------------------------------------------------------------

const mockEvaluateSessionSubscriberAccess = vi.fn();
const mockEvaluateTeamAccess = vi.fn();
const mockDbQuery = vi.fn();
const mockRedisSetex = vi.fn();
const mockRedisDel = vi.fn();
const mockRefreshSessionTokens = vi.fn();
const mockGetSessionDataById = vi.fn();
const mockConditionallyUpdateSession = vi.fn();
const mockEmitAuditEvent = vi.fn();
const mockBuildVoteRevealedPayload = vi.fn();

vi.mock("../../auth/session-subscriber-access-helper.js", () => ({
  evaluateSessionSubscriberAccess: (...args: unknown[]) => mockEvaluateSessionSubscriberAccess(...args),
}));
vi.mock("../../auth/team-content-access-helper.js", () => ({
  evaluateTeamAccess: (...args: unknown[]) => mockEvaluateTeamAccess(...args),
}));
vi.mock("../../db.js", () => ({
  db: { query: (...args: unknown[]) => mockDbQuery(...args) },
}));
vi.mock("../../redis.js", () => ({
  redis: {
    setex: (...args: unknown[]) => mockRedisSetex(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
    publish: vi.fn(),
    duplicate: vi.fn(),
  },
}));
vi.mock("../../auth/middleware.js", () => ({
  refreshSessionTokens: (...args: unknown[]) => mockRefreshSessionTokens(...args),
  TOKEN_REFRESH_THRESHOLD_S: 5 * 60,
  ABSOLUTE_LIFETIME_MS: 90 * 60 * 1000,
}));
vi.mock("../../auth/session-store.js", () => ({
  getSessionDataById: (...args: unknown[]) => mockGetSessionDataById(...args),
  conditionallyUpdateSession: (...args: unknown[]) => mockConditionallyUpdateSession(...args),
}));
vi.mock("../../auth/audit-logger.js", () => ({
  emitAuditEvent: (...args: unknown[]) => mockEmitAuditEvent(...args),
}));
vi.mock("../vote-revealed-payload.js", () => ({
  buildVoteRevealedPayload: (...args: unknown[]) => mockBuildVoteRevealedPayload(...args),
}));
vi.mock("../../config.js", () => ({
  config: { DATABASE_URL: "postgres://test", REDIS_URL: "redis://test", SESSION_SECRET: "test", NODE_ENV: "test" },
}));

import { handleIncomingMessage } from "../ws-event-dispatcher.js";
import { scheduleReauthorizationSweep, REAUTHORIZATION_INTERVAL_MS } from "../connection-reauthorization.js";
import { scheduleTokenRefreshMonitor } from "../connection-token-refresh.js";
import { ConnectionRegistry, type RegisteredConnection } from "../connection-registry.js";
import type { WsEventEnvelope } from "@dipstick/shared";

function fakeConn(userId: string): RegisteredConnection & { sent: string[]; socket: { readyState: number; OPEN: number; send: (d: string) => void; close: ReturnType<typeof vi.fn> } } {
  const sent: string[] = [];
  const socket = { readyState: 1, OPEN: 1, send: (data: string) => sent.push(data), close: vi.fn() };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double for a `ws` socket
    socket: socket as any,
    userId,
    sessionCreatedAt: Date.now(),
    fastifySessionId: "fastify-sess-1",
    sent,
  } as unknown as RegisteredConnection & { sent: string[]; socket: typeof socket };
}

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(() => ({ info: vi.fn() })),
};

describe("Reveal-timing independence (design.md Decision D8, tasks.md Group 6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Both SEC-25 and SEC-26 see a perpetually healthy connection: the
    // sweep never closes it, and the token never needs refreshing.
    mockEvaluateSessionSubscriberAccess.mockResolvedValue({
      path: "participant",
      sessionId: "s1",
      teamId: "t1",
      actorGlobalRole: "engineer",
    });
    mockGetSessionDataById.mockResolvedValue({
      userId: "participant-1",
      sessionCreatedAt: new Date().toISOString(),
      encryptedAccessToken: "enc(token)",
      tokenExpiresAt: Math.floor(Date.now() / 1000) + 3600, // comfortably healthy
    });
    mockDbQuery.mockResolvedValue({ rows: [] });
    mockRedisSetex.mockResolvedValue("OK");
    mockBuildVoteRevealedPayload.mockResolvedValue({ sessionId: "s1", sessionStatus: "active", topics: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a vote_revealed push firing concurrently with an in-flight SEC-25 sweep tick and SEC-26 refresh cycle is delivered unaffected", async () => {
    const registry = new ConnectionRegistry();
    const conn = fakeConn("participant-1");
    registry.register("session", "s1", conn);

    // Start both independent timers on the same connection.
    scheduleReauthorizationSweep(conn, "session", "s1", registry, noopLogger as never);
    scheduleTokenRefreshMonitor(conn, "session", "s1", registry, noopLogger as never);

    // Let the token-refresh monitor's registration-time read resolve, and
    // the sweep interval fire at least once — both mid-phase, neither
    // closing the connection.
    await vi.advanceTimersByTimeAsync(REAUTHORIZATION_INTERVAL_MS);
    expect(conn.socket.close).not.toHaveBeenCalled();
    expect(registry.candidates("session", "s1")).toEqual([conn]);

    // Fire the reveal push in the same tick window as the next sweep cycle
    // and while the refresh monitor's own wait-for-expiry phase is still
    // pending — the push must not be gated, delayed, or bypassed by either.
    const envelope: WsEventEnvelope = {
      eventType: "vote_revealed",
      sessionId: "s1",
      payload: { sessionId: "s1", sessionStatus: "active", serverTimestamp: "2026-01-01T00:00:00.000Z" },
    };
    await handleIncomingMessage(JSON.stringify(envelope), noopLogger as never, registry);

    expect(conn.sent).toHaveLength(1);
    const message = JSON.parse(conn.sent[0]!);
    expect(message.eventType).toBe("vote_revealed");

    // The connection is still registered and open — neither timer's phase
    // interfered with, gated, or consumed the delivery-time push.
    expect(registry.candidates("session", "s1")).toEqual([conn]);
    expect(conn.socket.close).not.toHaveBeenCalled();

    // Both mechanisms remain independently live afterward: another sweep
    // interval and another push both still work normally.
    await vi.advanceTimersByTimeAsync(REAUTHORIZATION_INTERVAL_MS);
    expect(conn.socket.close).not.toHaveBeenCalled();

    await handleIncomingMessage(JSON.stringify(envelope), noopLogger as never, registry);
    expect(conn.sent).toHaveLength(2);
  });

  it("dispatchVoteRevealed's own authorization check runs independently, reading only conn.userId — never conn.reauthSweepTimer/tokenRefreshTimer/fastifySessionId", async () => {
    // Code-review-checklist item (task 6.1), made executable: confirm the
    // delivery-time check is called with exactly (userId, sessionId) — no
    // new state from Groups 2-4 is threaded into it.
    const registry = new ConnectionRegistry();
    const conn = fakeConn("participant-1");
    registry.register("session", "s1", conn);

    scheduleReauthorizationSweep(conn, "session", "s1", registry, noopLogger as never);
    scheduleTokenRefreshMonitor(conn, "session", "s1", registry, noopLogger as never);
    await vi.advanceTimersByTimeAsync(0);

    mockEvaluateSessionSubscriberAccess.mockClear();

    const envelope: WsEventEnvelope = {
      eventType: "vote_revealed",
      sessionId: "s1",
      payload: { sessionId: "s1", sessionStatus: "active", serverTimestamp: "2026-01-01T00:00:00.000Z" },
    };
    await handleIncomingMessage(JSON.stringify(envelope), noopLogger as never, registry);

    expect(mockEvaluateSessionSubscriberAccess).toHaveBeenCalledWith("participant-1", "s1");
  });
});
