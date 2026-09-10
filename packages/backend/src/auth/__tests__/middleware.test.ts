import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockRefreshOidcToken = vi.fn();
const mockEncryptToken = vi.fn((v: string) => `enc(${v})`);
const mockGetDecryptedTokens = vi.fn();
const mockEmitAuditEvent = vi.fn();

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
vi.mock("../../config.js", () => ({
  config: { SESSION_SECRET: "test" },
}));

import { authMiddleware, refreshSessionTokens } from "../middleware.js";

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

    for (const url of ["/health", "/auth/login", "/auth/callback", "/auth/logout", "/api/join/abc"]) {
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
      expect.objectContaining({ reason: "absolute_timeout" }),
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

    mockRefreshOidcToken.mockRejectedValue(new Error("invalid_grant"));

    await hook(req, reply);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(req.session.destroy).toHaveBeenCalled();
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
