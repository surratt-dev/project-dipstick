import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResponseBodyError } from "openid-client";

const mockRefreshOidcToken = vi.fn();
const mockEncryptToken = vi.fn((v: string) => `enc(${v})`);
const mockGetDecryptedTokens = vi.fn();
const mockEmitAuditEvent = vi.fn();
const mockWriteSessionInvalidatedAuditRow = vi.fn();

vi.mock("../oidc-client.js", () => ({
  refreshToken: (...args: unknown[]) => mockRefreshOidcToken(...args),
}));
vi.mock("../token-encryption.js", () => ({
  encryptToken: (v: string) => mockEncryptToken(v),
}));
vi.mock("../session-store.js", () => ({
  getDecryptedTokens: (...args: unknown[]) => mockGetDecryptedTokens(...args),
}));
vi.mock("../audit-logger.js", () => ({
  emitAuditEvent: (...args: unknown[]) => mockEmitAuditEvent(...args),
}));
// http-auth-audit-log-coverage, tasks.md 2.4: middleware.ts only ever reaches
// db.js/connection-reauthorization.ts transitively through
// session-invalidation-audit.ts, so mocking this one boundary is sufficient --
// no separate db.js or resolveActorGlobalRole mock is needed here.
vi.mock("../session-invalidation-audit.js", () => ({
  writeSessionInvalidatedAuditRow: (...args: unknown[]) =>
    mockWriteSessionInvalidatedAuditRow(...args),
}));
vi.mock("../../config.js", () => ({
  config: { SESSION_SECRET: "test" },
}));

import { authMiddleware, refreshSessionTokens, REFRESH_RETRY_DELAY_MS } from "../middleware.js";

function createMockApp() {
  const hooks: Array<(req: unknown, reply: unknown) => Promise<unknown>> = [];
  return {
    addHook: (_name: string, fn: (req: unknown, reply: unknown) => Promise<unknown>) => {
      hooks.push(fn);
    },
    getHook: () => hooks[0],
  };
}

function createMockRequest(overrides: Record<string, unknown> = {}) {
  return {
    url: overrides.url ?? "/api/something",
    ip: overrides.ip ?? "198.51.100.5",
    session: {
      userId: "user-1",
      sessionCreatedAt: new Date().toISOString(),
      tokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
      encryptedAccessToken: "enc(token)",
      sessionId: "sess-1",
      destroy: vi.fn(),
      touch: vi.fn(),
      ...overrides.session,
    },
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), child: vi.fn(() => ({ info: vi.fn() })) },
    ...overrides,
  };
}

function createMockReply() {
  const reply: Record<string, unknown> = {};
  reply.code = vi.fn(() => reply);
  reply.send = vi.fn(() => reply);
  return reply;
}

describe("authMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should skip public routes", async () => {
    const app = createMockApp();
    await authMiddleware(app as unknown as Parameters<typeof authMiddleware>[0]);
    const hook = app.getHook()!;
    const reply = createMockReply();

    for (const url of [
      "/health",
      "/auth/login",
      "/auth/callback",
      "/auth/logout",
      "/auth/dev-login-options",
      "/api/join/abc",
    ]) {
      const req = createMockRequest({ url });
      await hook(req, reply);
      expect(reply.code).not.toHaveBeenCalled();
    }
  });

  it("should return 401 when session has no userId", async () => {
    const app = createMockApp();
    await authMiddleware(app as unknown as Parameters<typeof authMiddleware>[0]);
    const hook = app.getHook()!;
    const reply = createMockReply();
    const req = createMockRequest({ session: { userId: undefined } });

    await hook(req, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it("should return 401 when absolute lifetime exceeded", async () => {
    const app = createMockApp();
    await authMiddleware(app as unknown as Parameters<typeof authMiddleware>[0]);
    const hook = app.getHook()!;
    const reply = createMockReply();

    // Session created 91 minutes ago (> 90 min absolute lifetime)
    const req = createMockRequest({
      session: {
        userId: "user-1",
        sessionCreatedAt: new Date(Date.now() - 91 * 60 * 1000).toISOString(),
        tokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
        sessionId: "sess-1",
        destroy: vi.fn(),
        touch: vi.fn(),
      },
    });

    await hook(req, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
    expect(req.session.destroy).toHaveBeenCalled();
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "auth.session_invalidated",
      expect.objectContaining({ reason: "absolute_timeout", sourceIp: "198.51.100.5" }),
    );
    // Task 5.2: the write helper is invoked with no failureType/retryCount
    // for absolute_timeout (Decision D2).
    expect(mockWriteSessionInvalidatedAuditRow).toHaveBeenCalledTimes(1);
    expect(mockWriteSessionInvalidatedAuditRow).toHaveBeenCalledWith(
      "user-1",
      "sess-1",
      "absolute_timeout",
      req,
    );
  });

  it("should refresh token when near expiry", async () => {
    const app = createMockApp();
    await authMiddleware(app as unknown as Parameters<typeof authMiddleware>[0]);
    const hook = app.getHook()!;
    const reply = createMockReply();

    const nowSec = Math.floor(Date.now() / 1000);
    const req = createMockRequest({
      session: {
        userId: "user-1",
        sessionCreatedAt: new Date().toISOString(),
        tokenExpiresAt: nowSec + 60, // expires in 60s (< 5min threshold)
        encryptedAccessToken: "enc(old)",
        sessionId: "sess-1",
        destroy: vi.fn(),
        touch: vi.fn(),
      },
    });

    mockGetDecryptedTokens.mockReturnValue({
      accessToken: "old-token",
      refreshToken: "refresh-tok",
      expiresAt: nowSec + 60,
    });

    mockRefreshOidcToken.mockResolvedValue({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
    });

    await hook(req, reply);

    expect(mockRefreshOidcToken).toHaveBeenCalledWith("refresh-tok");
    expect(req.session.encryptedAccessToken).toBe("enc(new-access)");
    expect(req.session.encryptedRefreshToken).toBe("enc(new-refresh)");
    expect(req.session.touch).toHaveBeenCalled();
    // Task 5.3: a successful token refresh adds no audit_log write at all.
    expect(mockWriteSessionInvalidatedAuditRow).not.toHaveBeenCalled();
  });

  it("should destroy session on token revocation (invalid_grant)", async () => {
    const app = createMockApp();
    await authMiddleware(app as unknown as Parameters<typeof authMiddleware>[0]);
    const hook = app.getHook()!;
    const reply = createMockReply();

    const nowSec = Math.floor(Date.now() / 1000);
    const req = createMockRequest({
      session: {
        userId: "user-1",
        sessionCreatedAt: new Date().toISOString(),
        tokenExpiresAt: nowSec + 60,
        encryptedAccessToken: "enc(old)",
        sessionId: "sess-1",
        destroy: vi.fn(),
        touch: vi.fn(),
      },
    });

    mockGetDecryptedTokens.mockReturnValue({
      accessToken: "old",
      refreshToken: "refresh-tok",
      expiresAt: nowSec + 60,
    });

    // D10: revocation is now detected via `err instanceof ResponseBodyError && err.error
    // === "invalid_grant"` -- a generic Error carrying that string in its message no
    // longer qualifies (that was exactly the pre-existing misclassification bug D10 fixes).
    mockRefreshOidcToken.mockRejectedValue(
      new ResponseBodyError("server responded with an error in the response body", {
        cause: { error: "invalid_grant", error_description: "refresh token revoked" },
        response: { status: 400 },
      }),
    );

    await hook(req, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(req.session.destroy).toHaveBeenCalled();
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "auth.token_refresh_failure",
      expect.objectContaining({ failureType: "revoked", retryCount: 0 }),
    );
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "auth.session_invalidated",
      expect.objectContaining({ reason: "token_revoked", sourceIp: "198.51.100.5" }),
    );
    // Task 5.2/5.4: retryCount from RefreshResult's "revoked" variant reaches
    // the write helper's metadata, and exactly one row is written for this
    // request (not a second one under auth.token_refresh_failure).
    expect(mockWriteSessionInvalidatedAuditRow).toHaveBeenCalledTimes(1);
    expect(mockWriteSessionInvalidatedAuditRow).toHaveBeenCalledWith(
      "user-1",
      "sess-1",
      "token_revoked",
      req,
      { failureType: "revoked", retryCount: 0 },
    );
  });

  it("D9/D10: an unrecognized refresh error still exhausts retries, audits transient, and logs exactly one sanitized error line", async () => {
    const app = createMockApp();
    await authMiddleware(app as unknown as Parameters<typeof authMiddleware>[0]);
    const hook = app.getHook()!;
    const reply = createMockReply();

    const nowSec = Math.floor(Date.now() / 1000);
    const req = createMockRequest({
      session: {
        userId: "user-1",
        sessionCreatedAt: new Date().toISOString(),
        tokenExpiresAt: nowSec + 60,
        encryptedAccessToken: "enc(old)",
        sessionId: "sess-1",
        destroy: vi.fn(),
        touch: vi.fn(),
      },
    });

    mockGetDecryptedTokens.mockReturnValue({
      accessToken: "old",
      refreshToken: "refresh-tok",
      expiresAt: nowSec + 60,
    });

    // Not a ResponseBodyError, not any other recognized OIDC error class -- this is
    // the fail-closed path (design D3 case 4).
    mockRefreshOidcToken.mockRejectedValue(new Error("network blip"));

    const hookPromise = hook(req, reply);
    // Two retries at REFRESH_RETRY_DELAY_MS apart before the loop exhausts.
    await vi.advanceTimersByTimeAsync(REFRESH_RETRY_DELAY_MS);
    await vi.advanceTimersByTimeAsync(REFRESH_RETRY_DELAY_MS);
    await hookPromise;

    expect(mockRefreshOidcToken).toHaveBeenCalledTimes(3); // initial attempt + 2 retries
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "auth.token_refresh_failure",
      expect.objectContaining({ failureType: "transient" }),
    );
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      "auth.session_invalidated",
      expect.objectContaining({ reason: "refresh_failure", sourceIp: "198.51.100.5" }),
    );
    expect(reply.code).toHaveBeenCalledWith(401);
    // Task 5.2/5.4: retryCount from RefreshResult's "transient_failure"
    // variant reaches the write helper, and exactly one row is written
    // (not one under auth.token_refresh_failure and one under
    // auth.session_invalidated).
    expect(mockWriteSessionInvalidatedAuditRow).toHaveBeenCalledTimes(1);
    expect(mockWriteSessionInvalidatedAuditRow).toHaveBeenCalledWith(
      "user-1",
      "sess-1",
      "refresh_failure",
      req,
      { failureType: "transient", retryCount: 3 },
    );

    // The new D9 log line: fires exactly once (not once per retry attempt), and its
    // `err` field is the sanitized wrapper output, not the raw Error.
    const tokenRefreshErrorCalls = (req.log.error as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([arg]: [Record<string, unknown>]) => arg.event === "auth.token_refresh_error",
    );
    expect(tokenRefreshErrorCalls).toHaveLength(1);
    const [loggedArg] = tokenRefreshErrorCalls[0] as [Record<string, unknown>];
    expect(loggedArg.err).toMatchObject({ errorClass: "Error", unrecognized: true });
    expect(loggedArg).toMatchObject({ userId: "user-1", sessionId: "sess-1", source: "http" });
  });

  it("copy-back: refreshSessionTokens returns a NEW object, and authMiddleware explicitly copies its fields back onto request.session (design.md Decision D3)", async () => {
    const app = createMockApp();
    await authMiddleware(app as unknown as Parameters<typeof authMiddleware>[0]);
    const hook = app.getHook()!;
    const reply = createMockReply();

    const nowSec = Math.floor(Date.now() / 1000);
    const originalSession = {
      userId: "user-1",
      sessionCreatedAt: new Date().toISOString(),
      tokenExpiresAt: nowSec + 60,
      encryptedAccessToken: "enc(old)",
      sessionId: "sess-1",
      destroy: vi.fn(),
      touch: vi.fn(),
    };
    const req = createMockRequest({ session: originalSession });

    mockGetDecryptedTokens.mockReturnValue({
      accessToken: "old-token",
      refreshToken: "refresh-tok",
      expiresAt: nowSec + 60,
    });
    mockRefreshOidcToken.mockResolvedValue({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 7200,
    });

    await hook(req, reply);

    // The same request.session object was mutated in place (copy-back), not replaced.
    expect(req.session).toBe(originalSession);
    expect(req.session.encryptedAccessToken).toBe("enc(new-access)");
    expect(req.session.encryptedRefreshToken).toBe("enc(new-refresh)");
    expect(req.session.tokenExpiresAt).toBe(nowSec + 7200);
  });

  it("refreshSessionTokens itself does not mutate its input session object", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const inputSession = {
      userId: "user-1",
      sessionCreatedAt: new Date().toISOString(),
      tokenExpiresAt: nowSec + 60,
      encryptedAccessToken: "enc(old)",
    };
    const frozenCopy = { ...inputSession };

    mockGetDecryptedTokens.mockReturnValue({
      accessToken: "old-token",
      refreshToken: "refresh-tok",
      expiresAt: nowSec + 60,
    });
    mockRefreshOidcToken.mockResolvedValue({
      access_token: "new-access",
      expires_in: 3600,
    });

    const log = { child: vi.fn(() => ({ info: vi.fn() })) } as unknown as Parameters<typeof refreshSessionTokens>[2];
    const result = await refreshSessionTokens(inputSession, "sess-1", log, "websocket");

    expect(inputSession).toEqual(frozenCopy);
    expect(result.status).toBe("refreshed");
    if (result.status === "refreshed") {
      expect(result.session).not.toBe(inputSession);
      expect(result.session.encryptedAccessToken).toBe("enc(new-access)");
    }
  });

  it("should touch session when token is not near expiry", async () => {
    const app = createMockApp();
    await authMiddleware(app as unknown as Parameters<typeof authMiddleware>[0]);
    const hook = app.getHook()!;
    const reply = createMockReply();

    const req = createMockRequest(); // defaults have token far from expiry
    await hook(req, reply);

    expect(req.session.touch).toHaveBeenCalled();
    expect(reply.code).not.toHaveBeenCalled();
  });

  // websocket-connection-reauthorization, design.md Decision D3: refreshSessionTokens
  // now returns a new SessionData object rather than mutating its input in place, so
  // authMiddleware must explicitly copy the refreshed fields back onto request.session
  // for @fastify/session's dirty-tracking to persist them. This test exists specifically
  // to catch a regression where that copy-back step is silently dropped.
  it("should copy back all three refreshed fields (copy-back step, Decision D3)", async () => {
    const app = createMockApp();
    await authMiddleware(app as unknown as Parameters<typeof authMiddleware>[0]);
    const hook = app.getHook()!;
    const reply = createMockReply();

    const nowSec = Math.floor(Date.now() / 1000);
    const req = createMockRequest({
      session: {
        userId: "user-1",
        sessionCreatedAt: new Date().toISOString(),
        tokenExpiresAt: nowSec + 60,
        encryptedAccessToken: "enc(old)",
        sessionId: "sess-1",
        destroy: vi.fn(),
        touch: vi.fn(),
      },
    });

    mockGetDecryptedTokens.mockReturnValue({
      accessToken: "old-token",
      refreshToken: "refresh-tok",
      expiresAt: nowSec + 60,
    });

    mockRefreshOidcToken.mockResolvedValue({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 7200,
    });

    await hook(req, reply);

    expect(req.session.encryptedAccessToken).toBe("enc(new-access)");
    expect(req.session.encryptedRefreshToken).toBe("enc(new-refresh)");
    expect(req.session.tokenExpiresAt).toBe(nowSec + 7200);
    expect(reply.code).not.toHaveBeenCalled();
  });

  // websocket-connection-reauthorization, design.md Decision D3: refreshSessionTokens's
  // "no_refresh_token" result must preserve today's existing behavior — silently proceed
  // on the existing token, no error, no session destruction.
  it("should proceed without error when session has no refresh token", async () => {
    const app = createMockApp();
    await authMiddleware(app as unknown as Parameters<typeof authMiddleware>[0]);
    const hook = app.getHook()!;
    const reply = createMockReply();

    const nowSec = Math.floor(Date.now() / 1000);
    const req = createMockRequest({
      session: {
        userId: "user-1",
        sessionCreatedAt: new Date().toISOString(),
        tokenExpiresAt: nowSec + 60,
        encryptedAccessToken: "enc(old)",
        sessionId: "sess-1",
        destroy: vi.fn(),
        touch: vi.fn(),
      },
    });

    mockGetDecryptedTokens.mockReturnValue({
      accessToken: "old-token",
      refreshToken: undefined,
      expiresAt: nowSec + 60,
    });

    await hook(req, reply);

    expect(mockRefreshOidcToken).not.toHaveBeenCalled();
    expect(req.session.destroy).not.toHaveBeenCalled();
    expect(reply.code).not.toHaveBeenCalled();
    expect(req.session.touch).toHaveBeenCalled();
  });
});
