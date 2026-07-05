import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDbQuery = vi.fn();
const mockRedisSetex = vi.fn();
const mockRedisGet = vi.fn();
const mockRedisDel = vi.fn();
const mockEmitAuditEvent = vi.fn();
const mockGetAuthorizationUrl = vi.fn();
const mockHandleCallback = vi.fn();
const mockGetEndSessionUrl = vi.fn();
const mockResolveOrCreateAccount = vi.fn();
const mockBuildSessionData = vi.fn();
const mockGetDecryptedTokens = vi.fn();
const mockMapAuthError = vi.fn();

vi.mock("../../db.js", () => ({
  db: { query: (...args: unknown[]) => mockDbQuery(...args) },
}));
vi.mock("../../redis.js", () => ({
  redis: {
    setex: (...args: unknown[]) => mockRedisSetex(...args),
    get: (...args: unknown[]) => mockRedisGet(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  },
}));
vi.mock("../../config.js", () => ({
  config: {
    DATABASE_URL: "postgres://test",
    REDIS_URL: "redis://test",
    SESSION_SECRET: "test-secret",
    OIDC_ISSUER: "https://idp.example.com",
    OIDC_CLIENT_ID: "client-id",
    OIDC_CLIENT_SECRET: "client-secret",
    OIDC_REDIRECT_URI: "http://localhost:3000/auth/callback",
    NODE_ENV: "test",
    APP_ORIGIN: "http://localhost:5173",
  },
}));
vi.mock("../../auth/oidc-client.js", () => ({
  getAuthorizationUrl: (...args: unknown[]) => mockGetAuthorizationUrl(...args),
  handleCallback: (...args: unknown[]) => mockHandleCallback(...args),
  getEndSessionUrl: (...args: unknown[]) => mockGetEndSessionUrl(...args),
}));
vi.mock("../../auth/account-resolver.js", () => ({
  resolveOrCreateAccount: (...args: unknown[]) => mockResolveOrCreateAccount(...args),
}));
vi.mock("../../auth/session-store.js", () => ({
  buildSessionData: (...args: unknown[]) => mockBuildSessionData(...args),
  getDecryptedTokens: (...args: unknown[]) => mockGetDecryptedTokens(...args),
}));
vi.mock("../../auth/audit-logger.js", () => ({
  emitAuditEvent: (...args: unknown[]) => mockEmitAuditEvent(...args),
}));
vi.mock("../../auth/error-handler.js", () => ({
  mapAuthError: (...args: unknown[]) => mockMapAuthError(...args),
}));
vi.mock("openid-client", () => ({
  randomNonce: () => "mock-nonce",
  randomPKCECodeVerifier: () => "mock-verifier",
}));

import Fastify from "fastify";
import { authRoutes } from "../auth.js";

function buildApp(sessionOverrides: Record<string, unknown> = {}) {
  const app = Fastify();

  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    const sess: Record<string, unknown> = {
      userId: "user-1",
      sessionCreatedAt: new Date().toISOString(),
      encryptedAccessToken: "enc(token)",
      sessionId: "sess-1",
      destroy: vi.fn((cb?: () => void) => cb?.()),
      regenerate: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
      touch: vi.fn(),
      ...sessionOverrides,
    };
    (request as unknown as Record<string, unknown>).session = sess;
  });

  app.register(authRoutes, { prefix: "/auth" });
  return app.ready().then(() => app);
}

describe("authRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /auth/login", () => {
    it("should redirect to authorization URL", async () => {
      mockRedisSetex.mockResolvedValue("OK");
      mockGetAuthorizationUrl.mockResolvedValue({
        url: new URL("https://idp.example.com/authorize?state=abc"),
        codeVerifier: "mock-verifier",
      });

      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/auth/login" });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain("idp.example.com/authorize");
      expect(mockRedisSetex).toHaveBeenCalled();
      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        "auth.authorization_initiated",
        expect.anything(),
      );
    });

    it("should store joinToken in state data when provided", async () => {
      mockRedisSetex.mockResolvedValue("OK");
      mockGetAuthorizationUrl.mockResolvedValue({
        url: new URL("https://idp.example.com/authorize"),
        codeVerifier: "mock-verifier",
      });

      const app = await buildApp();
      await app.inject({ method: "GET", url: "/auth/login?joinToken=join-abc" });

      const setexCall = mockRedisSetex.mock.calls[0];
      const storedData = JSON.parse(setexCall[2] as string);
      expect(storedData.pendingJoinToken).toBe("join-abc");
    });
  });

  describe("GET /auth/callback", () => {
    it("should redirect to error when state param is missing", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/auth/callback" });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain("category=invalid_request");
    });

    it("should redirect to error when state not found in Redis", async () => {
      mockRedisGet.mockResolvedValue(null);
      mockRedisDel.mockResolvedValue(1);

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/auth/callback?state=unknown&code=abc",
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain("category=invalid_request");
    });

    it("should complete sign-in flow successfully", async () => {
      mockRedisGet.mockResolvedValue(
        JSON.stringify({ nonce: "n", codeVerifier: "cv", createdAt: new Date().toISOString() }),
      );
      mockRedisDel.mockResolvedValue(1);
      mockHandleCallback.mockResolvedValue({
        claims: () => ({ sub: "sub-1", iss: "https://idp.example.com", name: "Alice", email: "alice@example.com" }),
        access_token: "at",
        refresh_token: "rt",
        id_token: "it",
        expires_in: 3600,
      });
      mockResolveOrCreateAccount.mockResolvedValue({
        id: "user-1",
        oidcSubject: "sub-1",
        oidcIssuer: "https://idp.example.com",
        displayName: "Alice",
        email: "alice@example.com",
        isNewUser: false,
      });
      mockBuildSessionData.mockReturnValue({
        userId: "user-1",
        sessionCreatedAt: new Date().toISOString(),
        encryptedAccessToken: "enc(at)",
        tokenExpiresAt: 9999999999,
      });

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/auth/callback?state=valid&code=abc",
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("/");
      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        "auth.success",
        expect.objectContaining({ userId: "user-1" }),
      );
    });

    it("should redirect to error on callback failure", async () => {
      mockRedisGet.mockResolvedValue(
        JSON.stringify({ nonce: "n", codeVerifier: "cv", createdAt: new Date().toISOString() }),
      );
      mockRedisDel.mockResolvedValue(1);
      mockHandleCallback.mockRejectedValue(new Error("invalid_grant"));
      mockMapAuthError.mockReturnValue({
        category: "authentication_failed",
        message: "Auth failed",
      });

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/auth/callback?state=valid&code=abc",
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain("category=authentication_failed");
    });

    it("should emit first_access_created for new users", async () => {
      mockRedisGet.mockResolvedValue(
        JSON.stringify({ nonce: "n", codeVerifier: "cv", createdAt: new Date().toISOString() }),
      );
      mockRedisDel.mockResolvedValue(1);
      mockHandleCallback.mockResolvedValue({
        claims: () => ({ sub: "sub-new", iss: "https://idp.example.com" }),
        access_token: "at",
        expires_in: 3600,
      });
      mockResolveOrCreateAccount.mockResolvedValue({
        id: "user-new",
        oidcSubject: "sub-new",
        oidcIssuer: "https://idp.example.com",
        displayName: "New User",
        email: "new@example.com",
        isNewUser: true,
      });
      mockBuildSessionData.mockReturnValue({
        userId: "user-new",
        sessionCreatedAt: new Date().toISOString(),
        encryptedAccessToken: "enc(at)",
        tokenExpiresAt: 9999999999,
      });

      const app = await buildApp();
      await app.inject({
        method: "GET",
        url: "/auth/callback?state=valid&code=abc",
      });

      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        "auth.first_access_created",
        expect.objectContaining({ userId: "user-new" }),
      );
    });
  });

  describe("POST /auth/logout", () => {
    it("should return 401 when no session", async () => {
      const app = await buildApp({ userId: undefined });
      const res = await app.inject({ method: "POST", url: "/auth/logout" });

      expect(res.statusCode).toBe(401);
    });

    it("should prompt confirmation when user has active sessions", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "session-1" }] });

      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: "/auth/logout" });

      expect(res.statusCode).toBe(200);
      expect(res.json().confirmRequired).toBe(true);
    });

    it("should logout and return redirect when confirmed", async () => {
      mockGetDecryptedTokens.mockReturnValue({ idToken: "id-tok" });
      mockGetEndSessionUrl.mockResolvedValue(new URL("https://idp.example.com/logout"));

      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/auth/logout?confirmed=true",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().redirectUrl).toContain("idp.example.com/logout");
      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        "auth.session_invalidated",
        expect.objectContaining({ reason: "explicit_logout" }),
      );
    });

    it("should return / redirect when no end_session_endpoint", async () => {
      mockGetDecryptedTokens.mockReturnValue({ idToken: "id-tok" });
      mockGetEndSessionUrl.mockResolvedValue(null);

      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/auth/logout?confirmed=true",
      });

      expect(res.json().redirectUrl).toBe("/");
    });

    it("should handle decrypt failure gracefully and still logout", async () => {
      mockGetDecryptedTokens.mockImplementation(() => {
        throw new Error("decrypt failed");
      });

      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/auth/logout?confirmed=true",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().redirectUrl).toBe("/");
    });
  });

  describe("GET /auth/session", () => {
    it("should return 401 when no session", async () => {
      const app = await buildApp({ userId: undefined });
      const res = await app.inject({ method: "GET", url: "/auth/session" });

      expect(res.statusCode).toBe(401);
    });

    it("should return 401 when user not found in DB", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // user not found

      const app = await buildApp({
        sessionCreatedAt: new Date().toISOString(),
      });
      const res = await app.inject({ method: "GET", url: "/auth/session" });

      expect(res.statusCode).toBe(401);
    });

    it("should return session data with team memberships", async () => {
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [{ id: "user-1", display_name: "Alice", email: "alice@example.com" }],
        })
        .mockResolvedValueOnce({
          rows: [{ team_id: "team-1", team_name: "Team Alpha", role: "participant" }],
        });

      const app = await buildApp({
        sessionCreatedAt: "2025-06-01T12:00:00Z",
      });
      const res = await app.inject({ method: "GET", url: "/auth/session" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.user.id).toBe("user-1");
      expect(body.user.displayName).toBe("Alice");
      expect(body.teamMemberships).toHaveLength(1);
      expect(body.teamMemberships[0].teamId).toBe("team-1");
      expect(body.sessionCreatedAt).toBe("2025-06-01T12:00:00Z");
      expect(body.expiresAt).toBeDefined();
    });
  });
});
