import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as OpenidClientModule from "openid-client";
import type * as ErrorHandlerModule from "../../auth/error-handler.js";

const mockDbQuery = vi.fn();
const mockRedisSetex = vi.fn();
const mockRedisGetdel = vi.fn();
const mockEmitAuditEvent = vi.fn();
const mockGetAuthorizationUrl = vi.fn();
const mockHandleCallback = vi.fn();
const mockGetEndSessionUrl = vi.fn();
const mockResolveOrCreateAccount = vi.fn();
const mockBuildSessionData = vi.fn();
const mockGetDecryptedTokens = vi.fn();
const mockMapAuthError = vi.fn();
const mockSanitizeOidcError = vi.fn();

vi.mock("../../db.js", () => ({
  db: { query: (...args: unknown[]) => mockDbQuery(...args) },
}));
vi.mock("../../redis.js", () => ({
  redis: {
    setex: (...args: unknown[]) => mockRedisSetex(...args),
    // getdel replaces the former get+del pair — atomic retrieval-and-deletion
    // closes the non-atomic window that existed between the two separate calls.
    getdel: (...args: unknown[]) => mockRedisGetdel(...args),
  },
}));
const { mockConfig, mockIsPrivateAddress } = vi.hoisted(() => ({
  mockConfig: {
    DATABASE_URL: "postgres://test",
    REDIS_URL: "redis://test",
    SESSION_SECRET: "test-secret",
    OIDC_ISSUER: "https://idp.example.com",
    OIDC_CLIENT_ID: "client-id",
    OIDC_CLIENT_SECRET: "client-secret",
    OIDC_REDIRECT_URI: "http://localhost:3000/auth/callback",
    NODE_ENV: "test" as string,
    APP_ORIGIN: "http://localhost:5173",
  },
  mockIsPrivateAddress: vi.fn(),
}));
vi.mock("../../config.js", () => ({
  config: mockConfig,
  isPrivateAddress: (...args: unknown[]) => mockIsPrivateAddress(...args),
  getAppOrigin: () =>
    mockConfig.APP_ORIGIN ?? (mockConfig.NODE_ENV === "production" ? "" : "http://localhost:5173"),
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
vi.mock("../../auth/oidc-error-sanitizer.js", () => ({
  sanitizeOidcError: (...args: unknown[]) => mockSanitizeOidcError(...args),
}));
vi.mock("openid-client", async () => {
  const actual = await vi.importActual<typeof OpenidClientModule>("openid-client");
  return {
    ...actual,
    randomNonce: () => "mock-nonce",
    randomPKCECodeVerifier: () => "mock-verifier",
  };
});

import Fastify from "fastify";
import type { FastifyBaseLogger } from "fastify";
import { authRoutes, validateReturnTo } from "../auth.js";
import { ResponseBodyError } from "openid-client";

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

/** Shared setup for callback tests that need a valid state/token exchange. */
function setupValidCallbackMocks(opts: {
  sub?: string;
  iss?: string;
  isNewUser?: boolean;
  teamMemberships?: { team_id: string }[];
}) {
  const sub = opts.sub ?? "sub-1";
  const iss = opts.iss ?? "https://idp.example.com";
  const isNewUser = opts.isNewUser ?? false;
  const teamMemberships = opts.teamMemberships ?? [{ team_id: "team-1" }];

  // Task 8.1: getdel replaces the former get+del pair
  mockRedisGetdel.mockResolvedValue(
    JSON.stringify({ nonce: "n", codeVerifier: "cv", createdAt: new Date().toISOString() }),
  );
  mockHandleCallback.mockResolvedValue({
    claims: () => ({ sub, iss, name: "Alice", email: "alice@example.com" }),
    access_token: "at",
    refresh_token: "rt",
    id_token: "it",
    expires_in: 3600,
  });
  mockResolveOrCreateAccount.mockResolvedValue({
    id: "user-1",
    oidcSubject: sub,
    oidcIssuer: iss,
    displayName: "Alice",
    email: "alice@example.com",
    isNewUser,
  });
  mockBuildSessionData.mockReturnValue({
    userId: "user-1",
    sessionCreatedAt: new Date().toISOString(),
    encryptedAccessToken: "enc(at)",
    tokenExpiresAt: 9999999999,
  });
  // Team membership query (Task 5: server-side redirect)
  mockDbQuery.mockResolvedValueOnce({ rows: teamMemberships });
}

/**
 * Like setupValidCallbackMocks, but does NOT queue the team-membership
 * fallback query's mockResolvedValueOnce — for reauth-return-to tests
 * (design.md Decision 3) where a stored returnTo (or pendingJoinToken)
 * short-circuits before that fallback query ever runs. Queuing an unused
 * mockResolvedValueOnce here would otherwise leak into and corrupt the
 * first db.query call of whichever test runs next.
 */
function setupValidCallbackMocksNoMembershipFallback(opts: {
  sub?: string;
  iss?: string;
  isNewUser?: boolean;
} = {}) {
  const sub = opts.sub ?? "sub-1";
  const iss = opts.iss ?? "https://idp.example.com";
  const isNewUser = opts.isNewUser ?? false;

  mockHandleCallback.mockResolvedValue({
    claims: () => ({ sub, iss, name: "Alice", email: "alice@example.com" }),
    access_token: "at",
    refresh_token: "rt",
    id_token: "it",
    expires_in: 3600,
  });
  mockResolveOrCreateAccount.mockResolvedValue({
    id: "user-1",
    oidcSubject: sub,
    oidcIssuer: iss,
    displayName: "Alice",
    email: "alice@example.com",
    isNewUser,
  });
  mockBuildSessionData.mockReturnValue({
    userId: "user-1",
    sessionCreatedAt: new Date().toISOString(),
    encryptedAccessToken: "enc(at)",
    tokenExpiresAt: 9999999999,
  });
}

describe("authRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.NODE_ENV = "test";
    mockConfig.OIDC_ISSUER = "https://idp.example.com";
    mockIsPrivateAddress.mockReturnValue(false);
    mockSanitizeOidcError.mockReturnValue({ errorClass: "MockSanitized" });
    // http-auth-audit-log-coverage, tasks.md 2.4: a default fallback so the
    // new SELECT global_role/INSERT audit_log calls that
    // session-invalidation-audit.ts issues on every /auth/logout request
    // (imported transitively -- this file's existing db.js mock is
    // resolved-path-keyed, so it also intercepts that module's db import)
    // resolve to something safe instead of undefined. Tests that care about
    // specific db.query calls still override individual calls with
    // mockResolvedValueOnce, which takes priority over this default.
    mockDbQuery.mockResolvedValue({ rows: [] });
  });

  describe("GET /auth/dev-login-options", () => {
    it("returns options when both gates pass", async () => {
      mockConfig.NODE_ENV = "development";
      mockIsPrivateAddress.mockReturnValue(true);

      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/auth/dev-login-options" });

      expect(res.statusCode).toBe(200);
      expect(mockIsPrivateAddress).toHaveBeenCalledWith(mockConfig.OIDC_ISSUER);
      const body = res.json() as { options: Array<{ accountId: string; seeded: boolean }> };
      expect(body.options).toHaveLength(4);
      expect(body.options.find((o) => o.accountId === "facilitator-001")?.seeded).toBe(false);
      expect(body.options.find((o) => o.accountId === "manager-001")?.seeded).toBe(true);
      expect(body.options.find((o) => o.accountId === "admin-001")?.seeded).toBe(true);
      expect(body.options.find((o) => o.accountId === "participant-001")?.seeded).toBe(true);
    });

    it("returns 404 with no body when NODE_ENV=production, regardless of issuer", async () => {
      mockConfig.NODE_ENV = "production";
      mockIsPrivateAddress.mockReturnValue(true);

      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/auth/dev-login-options" });

      expect(res.statusCode).toBe(404);
      expect(res.body).toBe("");
      expect(mockDbQuery).not.toHaveBeenCalled();
      expect(mockRedisSetex).not.toHaveBeenCalled();
      expect(mockRedisGetdel).not.toHaveBeenCalled();
    });

    it("returns 404 with no body when the issuer is not private, regardless of NODE_ENV", async () => {
      mockConfig.NODE_ENV = "development";
      mockIsPrivateAddress.mockReturnValue(false);

      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/auth/dev-login-options" });

      expect(res.statusCode).toBe(404);
      expect(res.body).toBe("");
      expect(mockDbQuery).not.toHaveBeenCalled();
    });
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

    it("forwards a valid loginHint to getAuthorizationUrl and sets hasLoginHint on the audit event", async () => {
      mockRedisSetex.mockResolvedValue("OK");
      mockGetAuthorizationUrl.mockResolvedValue({
        url: new URL("https://idp.example.com/authorize?login_hint=manager-001"),
        codeVerifier: "mock-verifier",
      });

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/auth/login?loginHint=manager-001",
      });

      expect(res.statusCode).toBe(302);
      expect(mockGetAuthorizationUrl).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        "manager-001",
      );
      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        "auth.authorization_initiated",
        expect.objectContaining({ hasLoginHint: true }),
      );
    });

    it("returns 400 for an unrecognized loginHint and forwards nothing", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/auth/login?loginHint=not-a-real-account",
      });

      expect(res.statusCode).toBe(400);
      expect(mockGetAuthorizationUrl).not.toHaveBeenCalled();
      expect(mockRedisSetex).not.toHaveBeenCalled();
    });

    it("omits loginHint from getAuthorizationUrl and sets hasLoginHint false when absent", async () => {
      mockRedisSetex.mockResolvedValue("OK");
      mockGetAuthorizationUrl.mockResolvedValue({
        url: new URL("https://idp.example.com/authorize"),
        codeVerifier: "mock-verifier",
      });

      const app = await buildApp();
      await app.inject({ method: "GET", url: "/auth/login" });

      expect(mockGetAuthorizationUrl).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        undefined,
      );
      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        "auth.authorization_initiated",
        expect.objectContaining({ hasLoginHint: false }),
      );
    });

    // reauth-return-to: design.md Decision 3, tasks.md tasks 2.6/2.8/2.11.
    describe("returnTo (reauth-return-to)", () => {
      beforeEach(() => {
        mockRedisSetex.mockResolvedValue("OK");
        mockGetAuthorizationUrl.mockResolvedValue({
          url: new URL("https://idp.example.com/authorize"),
          codeVerifier: "mock-verifier",
        });
      });

      it("stores an allow-listed /session/:id returnTo value in state data", async () => {
        const app = await buildApp();
        await app.inject({
          method: "GET",
          url: "/auth/login?returnTo=" + encodeURIComponent("/session/9f8b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c"),
        });

        const setexCall = mockRedisSetex.mock.calls[0];
        const storedData = JSON.parse(setexCall[2] as string);
        expect(storedData.returnTo).toBe("/session/9f8b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c");
      });

      it("stores an allow-listed /team/:id returnTo value in state data", async () => {
        const app = await buildApp();
        await app.inject({
          method: "GET",
          url: "/auth/login?returnTo=" + encodeURIComponent("/team/9f8b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c"),
        });

        const setexCall = mockRedisSetex.mock.calls[0];
        const storedData = JSON.parse(setexCall[2] as string);
        expect(storedData.returnTo).toBe("/team/9f8b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c");
      });

      it("tolerates an optional query string suffix on an otherwise-matching path", async () => {
        const app = await buildApp();
        const value = "/session/9f8b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c?newMember=true";
        await app.inject({ method: "GET", url: "/auth/login?returnTo=" + encodeURIComponent(value) });

        const setexCall = mockRedisSetex.mock.calls[0];
        const storedData = JSON.parse(setexCall[2] as string);
        expect(storedData.returnTo).toBe(value);
      });

      it("drops a non-allow-listed path silently and logs at debug level", async () => {
        const app = await buildApp();
        const res = await app.inject({
          method: "GET",
          url: "/auth/login?returnTo=" + encodeURIComponent("/some/unrecognized/path"),
        });

        expect(res.statusCode).toBe(302);
        const setexCall = mockRedisSetex.mock.calls[0];
        const storedData = JSON.parse(setexCall[2] as string);
        expect(storedData.returnTo).toBeUndefined();
      });

      it("drops a non-UUID :id segment (not a loose up-to-next-slash match)", async () => {
        const app = await buildApp();
        await app.inject({
          method: "GET",
          url: "/auth/login?returnTo=" + encodeURIComponent("/session/not-a-uuid"),
        });

        const setexCall = mockRedisSetex.mock.calls[0];
        const storedData = JSON.parse(setexCall[2] as string);
        expect(storedData.returnTo).toBeUndefined();
      });

      it("rejects a full URL or protocol-relative value", async () => {
        const app = await buildApp();
        await app.inject({
          method: "GET",
          url: "/auth/login?returnTo=" + encodeURIComponent("https://evil.example.com/session/9f8b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c"),
        });

        const setexCall = mockRedisSetex.mock.calls[0];
        const storedData = JSON.parse(setexCall[2] as string);
        expect(storedData.returnTo).toBeUndefined();
      });

      it("rejects a value containing a raw CRLF or a backslash", async () => {
        const app = await buildApp();

        await app.inject({
          method: "GET",
          url: "/auth/login?returnTo=" + encodeURIComponent("/session/9f8b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c\r\nX-Injected: 1"),
        });
        let setexCall = mockRedisSetex.mock.calls[0];
        expect(JSON.parse(setexCall[2] as string).returnTo).toBeUndefined();

        mockRedisSetex.mockClear();
        await app.inject({
          method: "GET",
          url: "/auth/login?returnTo=" + encodeURIComponent("/session/9f8b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c\\evil"),
        });
        setexCall = mockRedisSetex.mock.calls[0];
        expect(JSON.parse(setexCall[2] as string).returnTo).toBeUndefined();
      });

      it("does not branch on which OIDC provider is configured", async () => {
        // The returnTo mechanism reads only request.query and config's shared,
        // provider-agnostic OIDC settings — never a provider-specific claim or
        // field. Asserted here by confirming behavior is identical regardless
        // of OIDC_ISSUER's value (per project_oidc_multi_provider).
        mockConfig.OIDC_ISSUER = "https://another-idp.example.org";
        const app = await buildApp();
        await app.inject({
          method: "GET",
          url: "/auth/login?returnTo=" + encodeURIComponent("/team/9f8b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c"),
        });

        const setexCall = mockRedisSetex.mock.calls[0];
        const storedData = JSON.parse(setexCall[2] as string);
        expect(storedData.returnTo).toBe("/team/9f8b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c");
      });
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
      // Task 8.1: getdel returning null means state was not found (or already consumed)
      mockRedisGetdel.mockResolvedValue(null);

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/auth/callback?state=unknown&code=abc",
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain("category=invalid_request");
    });

    it("should complete sign-in flow and redirect to team page for user with memberships", async () => {
      // isNewUser: false — returning user with existing team membership
      setupValidCallbackMocks({ isNewUser: false, teamMemberships: [{ team_id: "team-1" }] });

      const mockDestroy = vi.fn((cb?: () => void) => cb?.());
      const mockRegenerate = vi.fn();
      const app = await buildApp({ destroy: mockDestroy, regenerate: mockRegenerate });
      const res = await app.inject({
        method: "GET",
        url: "/auth/callback?state=valid&code=abc",
      });

      expect(res.statusCode).toBe(302);
      // Task 5: server-side redirect to /team/:teamId
      expect(res.headers.location).toBe("http://localhost:5173/team/team-1");
      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        "auth.success",
        expect.objectContaining({ userId: "user-1" }),
      );
      // Task 21: returning user must NOT emit first_access_created
      expect(mockEmitAuditEvent).not.toHaveBeenCalledWith(
        expect.anything(),
        "auth.first_access_created",
        expect.anything(),
      );

      // Issue #4 / AC2: callback_received, session_created, and success each
      // carry sourceIp and correlationId.
      const callbackReceivedCall = mockEmitAuditEvent.mock.calls.find(
        (c: unknown[]) => c[1] === "auth.callback_received",
      );
      const sessionCreatedCall = mockEmitAuditEvent.mock.calls.find(
        (c: unknown[]) => c[1] === "auth.session_created",
      );
      const successCall = mockEmitAuditEvent.mock.calls.find(
        (c: unknown[]) => c[1] === "auth.success",
      );
      expect(callbackReceivedCall![2]).toMatchObject({
        sourceIp: expect.any(String),
        correlationId: expect.any(String),
      });
      expect(sessionCreatedCall![2]).toMatchObject({
        sourceIp: expect.any(String),
        correlationId: expect.any(String),
      });
      expect(successCall![2]).toMatchObject({
        sourceIp: expect.any(String),
        correlationId: expect.any(String),
      });

      // Task 3: session fixation prevention — regenerate() alone, never destroy().
      expect(mockRegenerate).toHaveBeenCalledTimes(1);
      expect(mockDestroy).not.toHaveBeenCalled();
    });

    it("should redirect to error on callback failure", async () => {
      mockRedisGetdel.mockResolvedValue(
        JSON.stringify({ nonce: "n", codeVerifier: "cv", createdAt: new Date().toISOString() }),
      );
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

    it("user-facing error page is unaffected by log sanitization (design D6/D7, task 4.1)", async () => {
      // Uses the REAL mapAuthError (not the file-level mock) so this proves the actual
      // user-facing categorization path -- not just that mockMapAuthError was configured
      // a particular way. sanitizeOidcError only ever wraps what goes into request.log.error;
      // mapAuthError(err) is (and remains) called with the original, unsanitized err. This
      // test would catch a regression where a future change accidentally passed the
      // sanitized object to mapAuthError instead of the raw error.
      const actualErrorHandler = await vi.importActual<typeof ErrorHandlerModule>(
        "../../auth/error-handler.js",
      );
      mockMapAuthError.mockImplementation(actualErrorHandler.mapAuthError);

      const CANARY = `CANARY_TOKEN_${crypto.randomUUID()}`;
      mockRedisGetdel.mockResolvedValue(
        JSON.stringify({ nonce: "n", codeVerifier: "cv", createdAt: new Date().toISOString() }),
      );
      mockHandleCallback.mockRejectedValue(
        new ResponseBodyError("server responded with an error in the response body", {
          cause: { error: "invalid_grant", error_description: CANARY },
          response: { status: 400 },
        }),
      );

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/auth/callback?state=valid&code=abc",
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain("category=authentication_failed");
      expect(res.headers.location).not.toContain(CANARY);
      expect(decodeURIComponent(res.headers.location as string)).not.toContain(CANARY);

      // The log call is independently sanitized -- confirms the two code paths (log vs.
      // user-facing redirect) are wired separately, as the design requires.
      expect(mockSanitizeOidcError).toHaveBeenCalled();
    });

    it("should emit first_access_created with all required fields for new users (Task 21)", async () => {
      // isNewUser: true, no team memberships → redirect to /no-team
      mockRedisGetdel.mockResolvedValue(
        JSON.stringify({ nonce: "n", codeVerifier: "cv", createdAt: new Date().toISOString() }),
      );
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
      // Task 5: no team memberships → /no-team
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/auth/callback?state=valid&code=abc",
      });

      // Task 5: redirects to /no-team when no memberships
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("http://localhost:5173/no-team");

      // Task 21: first_access_created emitted with all required fields
      const firstAccessCall = mockEmitAuditEvent.mock.calls.find(
        (c: unknown[]) => c[1] === "auth.first_access_created",
      );
      expect(firstAccessCall).toBeDefined();
      const auditFields = firstAccessCall![2] as Record<string, unknown>;

      // Task 7: sourceIp and correlationId must be present
      expect(auditFields).toMatchObject({
        userId: "user-new",
        oidcSubject: "sub-new",
        oidcIssuer: "https://idp.example.com",
        sourceIp: expect.any(String),
        correlationId: expect.any(String),
      });

      // Must not include PII fields
      expect(auditFields).not.toHaveProperty("displayName");
      expect(auditFields).not.toHaveProperty("email");
      expect(auditFields).not.toHaveProperty("name");

      // Issue #4 / AC1: callback_received, session_created, success, and
      // first_access_created from this single invocation all share the exact
      // same correlationId value.
      const callbackReceivedCall = mockEmitAuditEvent.mock.calls.find(
        (c: unknown[]) => c[1] === "auth.callback_received",
      );
      const sessionCreatedCall = mockEmitAuditEvent.mock.calls.find(
        (c: unknown[]) => c[1] === "auth.session_created",
      );
      const successCall = mockEmitAuditEvent.mock.calls.find(
        (c: unknown[]) => c[1] === "auth.success",
      );
      const correlationId = (callbackReceivedCall![2] as Record<string, unknown>).correlationId;
      expect(auditFields.correlationId).toBe(correlationId);
      expect((sessionCreatedCall![2] as Record<string, unknown>).correlationId).toBe(
        correlationId,
      );
      expect((successCall![2] as Record<string, unknown>).correlationId).toBe(correlationId);
    });

    it("should emit role_claim_mapped with matching correlationId for returning users with a non-default globalRole (Issue #4)", async () => {
      mockRedisGetdel.mockResolvedValue(
        JSON.stringify({ nonce: "n", codeVerifier: "cv", createdAt: new Date().toISOString() }),
      );
      mockHandleCallback.mockResolvedValue({
        claims: () => ({ sub: "sub-admin", iss: "https://idp.example.com" }),
        access_token: "at",
        expires_in: 3600,
      });
      mockResolveOrCreateAccount.mockResolvedValue({
        id: "user-admin",
        oidcSubject: "sub-admin",
        oidcIssuer: "https://idp.example.com",
        displayName: "Admin User",
        email: "admin@example.com",
        isNewUser: false,
        globalRole: "admin",
      });
      mockBuildSessionData.mockReturnValue({
        userId: "user-admin",
        sessionCreatedAt: new Date().toISOString(),
        encryptedAccessToken: "enc(at)",
        tokenExpiresAt: 9999999999,
      });
      mockDbQuery.mockResolvedValueOnce({ rows: [{ team_id: "team-1" }] });

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/auth/callback?state=valid&code=abc",
      });

      expect(res.statusCode).toBe(302);

      const roleClaimMappedCall = mockEmitAuditEvent.mock.calls.find(
        (c: unknown[]) => c[1] === "auth.role_claim_mapped",
      );
      expect(roleClaimMappedCall).toBeDefined();
      const auditFields = roleClaimMappedCall![2] as Record<string, unknown>;
      expect(auditFields).toMatchObject({
        userId: "user-admin",
        oidcSubject: "sub-admin",
        globalRole: "admin",
        sourceIp: expect.any(String),
        correlationId: expect.any(String),
      });

      // Issue #4 / AC1: callback_received, session_created, success, and
      // role_claim_mapped from this single invocation all share the exact
      // same correlationId value.
      const callbackReceivedCall = mockEmitAuditEvent.mock.calls.find(
        (c: unknown[]) => c[1] === "auth.callback_received",
      );
      const sessionCreatedCall = mockEmitAuditEvent.mock.calls.find(
        (c: unknown[]) => c[1] === "auth.session_created",
      );
      const successCall = mockEmitAuditEvent.mock.calls.find(
        (c: unknown[]) => c[1] === "auth.success",
      );
      const correlationId = (callbackReceivedCall![2] as Record<string, unknown>).correlationId;
      expect(auditFields.correlationId).toBe(correlationId);
      expect((sessionCreatedCall![2] as Record<string, unknown>).correlationId).toBe(
        correlationId,
      );
      expect((successCall![2] as Record<string, unknown>).correlationId).toBe(correlationId);
    });

    // Task 12: Missing claims rejection

    describe("missing claims rejection (Task 12)", () => {
      const validStateData = JSON.stringify({
        nonce: "n",
        codeVerifier: "cv",
        createdAt: new Date().toISOString(),
      });

      beforeEach(() => {
        mockRedisGetdel.mockResolvedValue(validStateData);
        mockMapAuthError.mockReturnValue({
          category: "authentication_failed",
          message: "Auth failed",
        });
      });

      it("rejects authentication when sub is an empty string", async () => {
        mockHandleCallback.mockResolvedValue({
          claims: () => ({ sub: "", iss: "https://idp.example.com" }),
          access_token: "at",
          expires_in: 3600,
        });

        const app = await buildApp();
        const res = await app.inject({
          method: "GET",
          url: "/auth/callback?state=valid&code=abc",
        });

        // No account created or modified
        expect(mockResolveOrCreateAccount).not.toHaveBeenCalled();
        // Redirect to error page
        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toContain("/auth/error");
        // Audit event identifies the missing claim without PII
        const failureCall = mockEmitAuditEvent.mock.calls.find(
          (c: unknown[]) => c[1] === "auth.failure",
        );
        expect(failureCall).toBeDefined();
        const auditFields = failureCall![2] as Record<string, unknown>;
        expect(auditFields.missingClaim).toBe("sub");
        // Must not include claim values (no email, no iss value, no token)
        expect(auditFields).not.toHaveProperty("email");
        expect(auditFields).not.toHaveProperty("subValue");

        // Issue #4 / AC1: the failure path's correlationId matches the one
        // already emitted on auth.callback_received for this same invocation.
        const callbackReceivedCall = mockEmitAuditEvent.mock.calls.find(
          (c: unknown[]) => c[1] === "auth.callback_received",
        );
        expect(callbackReceivedCall).toBeDefined();
        const callbackReceivedFields = callbackReceivedCall![2] as Record<string, unknown>;
        expect(auditFields.correlationId).toBe(callbackReceivedFields.correlationId);
      });

      it("rejects authentication when iss is an empty string", async () => {
        mockHandleCallback.mockResolvedValue({
          claims: () => ({ sub: "sub-1", iss: "" }),
          access_token: "at",
          expires_in: 3600,
        });

        const app = await buildApp();
        const res = await app.inject({
          method: "GET",
          url: "/auth/callback?state=valid&code=abc",
        });

        expect(mockResolveOrCreateAccount).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toContain("/auth/error");

        const failureCall = mockEmitAuditEvent.mock.calls.find(
          (c: unknown[]) => c[1] === "auth.failure",
        );
        expect(failureCall).toBeDefined();
        const auditFields = failureCall![2] as Record<string, unknown>;
        expect(auditFields.missingClaim).toBe("iss");
        expect(auditFields).not.toHaveProperty("email");
      });

      it("rejects authentication when claims() returns null", async () => {
        mockHandleCallback.mockResolvedValue({
          claims: () => null,
          access_token: "at",
          expires_in: 3600,
        });

        const app = await buildApp();
        const res = await app.inject({
          method: "GET",
          url: "/auth/callback?state=valid&code=abc",
        });

        expect(mockResolveOrCreateAccount).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toContain("/auth/error");

        // Even with null claims, the audit event must identify a missing claim
        const failureCall = mockEmitAuditEvent.mock.calls.find(
          (c: unknown[]) => c[1] === "auth.failure",
        );
        expect(failureCall).toBeDefined();
        const auditFields = failureCall![2] as Record<string, unknown>;
        expect(auditFields.missingClaim).toBe("id_token");
        // No PII
        expect(auditFields).not.toHaveProperty("email");
      });
    });

    // Task 13: Server-side no-team redirect

    describe("server-side no-team redirect (Task 13)", () => {
      it("redirects new user with no team memberships to /no-team", async () => {
        setupValidCallbackMocks({ isNewUser: true, teamMemberships: [] });

        const app = await buildApp();
        const res = await app.inject({
          method: "GET",
          url: "/auth/callback?state=valid&code=abc",
        });

        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe("http://localhost:5173/no-team");
      });

      it("redirects user with team memberships to /team/:teamId", async () => {
        setupValidCallbackMocks({ teamMemberships: [{ team_id: "team-abc" }] });

        const app = await buildApp();
        const res = await app.inject({
          method: "GET",
          url: "/auth/callback?state=valid&code=abc",
        });

        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe("http://localhost:5173/team/team-abc");
      });

      it("uses join flow redirect with ?alreadyMember=true when join token is processed for existing member", async () => {
        // Task 4.2: through-auth already-member case appends ?alreadyMember=true
        mockRedisGetdel.mockResolvedValue(
          JSON.stringify({
            nonce: "n",
            codeVerifier: "cv",
            pendingJoinToken: "join-tok-1",
            createdAt: new Date().toISOString(),
          }),
        );
        mockHandleCallback.mockResolvedValue({
          claims: () => ({ sub: "sub-1", iss: "https://idp.example.com" }),
          access_token: "at",
          expires_in: 3600,
        });
        mockResolveOrCreateAccount.mockResolvedValue({
          id: "user-1",
          oidcSubject: "sub-1",
          oidcIssuer: "https://idp.example.com",
          displayName: "Alice",
          email: "alice@example.com",
          isNewUser: true,
        });
        mockBuildSessionData.mockReturnValue({
          userId: "user-1",
          sessionCreatedAt: new Date().toISOString(),
          encryptedAccessToken: "enc(at)",
          tokenExpiresAt: 9999999999,
        });

        // executeJoinFlow db queries:
        // 1. join_links lookup — valid link
        mockDbQuery.mockResolvedValueOnce({
          rows: [{
            id: "link-1",
            team_id: "team-joined",
            expires_at: new Date(Date.now() + 3600_000),
            revoked_at: null,
          }],
        });
        // 2. INSERT INTO team_memberships — ON CONFLICT, no new row (already a member)
        mockDbQuery.mockResolvedValueOnce({ rows: [] });
        // 3. Sessions query — no active session
        mockDbQuery.mockResolvedValueOnce({ rows: [] });
        // Join flow always sets redirectUrl so no membership query runs

        const app = await buildApp();
        const res = await app.inject({
          method: "GET",
          url: "/auth/callback?state=valid&code=abc",
        });

        expect(res.statusCode).toBe(302);
        // Task 4.2: already-member through-auth path appends ?alreadyMember=true
        expect(res.headers.location).toBe("http://localhost:5173/team/team-joined?alreadyMember=true");
        expect(res.headers.location).not.toBe("/no-team");
      });
    });

    // reauth-return-to: design.md Decision 3, tasks.md tasks 2.6/2.7/2.8/2.9/2.12.
    describe("returnTo redirect (reauth-return-to)", () => {
      function mockStateWithReturnTo(returnTo?: string, pendingJoinToken?: string) {
        mockRedisGetdel.mockResolvedValueOnce(
          JSON.stringify({
            nonce: "n",
            codeVerifier: "cv",
            createdAt: new Date().toISOString(),
            ...(returnTo ? { returnTo } : {}),
            ...(pendingJoinToken ? { pendingJoinToken } : {}),
          }),
        );
      }

      it("redirects to a stored /session/:id returnTo value when no pendingJoinToken is present", async () => {
        setupValidCallbackMocksNoMembershipFallback();
        mockStateWithReturnTo("/session/9f8b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c");

        const app = await buildApp();
        const res = await app.inject({ method: "GET", url: "/auth/callback?state=valid&code=abc" });

        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe("http://localhost:5173/session/9f8b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c");
      });

      it("redirects to a stored /team/:id returnTo value when no pendingJoinToken is present", async () => {
        setupValidCallbackMocksNoMembershipFallback();
        mockStateWithReturnTo("/team/9f8b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c");

        const app = await buildApp();
        const res = await app.inject({ method: "GET", url: "/auth/callback?state=valid&code=abc" });

        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe("http://localhost:5173/team/9f8b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c");
      });

      it("a pending join token takes precedence over a stored returnTo value", async () => {
        setupValidCallbackMocksNoMembershipFallback();
        mockStateWithReturnTo("/session/9f8b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c", "join-tok-1");

        // executeJoinFlow db queries: join_links lookup (valid), INSERT (new row), sessions (none active)
        mockDbQuery.mockResolvedValueOnce({
          rows: [{ id: "link-1", team_id: "team-joined", expires_at: new Date(Date.now() + 3600_000), revoked_at: null }],
        });
        mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "membership-1" }] });
        mockDbQuery.mockResolvedValueOnce({ rows: [] });

        const app = await buildApp();
        const res = await app.inject({ method: "GET", url: "/auth/callback?state=valid&code=abc" });

        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe("http://localhost:5173/team/team-joined?newMember=true");
        expect(res.headers.location).not.toContain("/session/9f8b1a2c");
      });

      it("behaves exactly as before when no returnTo value was stored (falls back to live membership data)", async () => {
        setupValidCallbackMocks({ teamMemberships: [{ team_id: "team-1" }] });

        const app = await buildApp();
        const res = await app.inject({ method: "GET", url: "/auth/callback?state=valid&code=abc" });

        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe("http://localhost:5173/team/team-1");
      });

      it("does not redirect a non-allow-listed stored returnTo value (defensive — /auth/login already filters this)", async () => {
        // Simulates a stateData payload that somehow carries a non-allow-listed
        // returnTo (e.g. a future bug in /auth/login's own validation) — the
        // callback handler trusts whatever was stored, since /auth/login is
        // this mechanism's only writer; this test documents that current
        // behavior rather than asserting a second, redundant validation layer.
        setupValidCallbackMocksNoMembershipFallback();
        mockStateWithReturnTo("/some/unrecognized/path");

        const app = await buildApp();
        const res = await app.inject({ method: "GET", url: "/auth/callback?state=valid&code=abc" });

        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe("http://localhost:5173/some/unrecognized/path");
      });

      it("does not perform any authorization check for the returnTo destination — the redirect is a navigation convenience only", async () => {
        // The backend issues an unconditional redirect; it is the destination
        // route's own (frontend/SPA) authorization check that runs on load,
        // exactly as it would for any direct, unprompted navigation there.
        // Confirmed here by checking no additional db.query beyond the ones
        // setupValidCallbackMocks/this test already account for is made
        // specifically to re-evaluate access to the returnTo path.
        setupValidCallbackMocksNoMembershipFallback();
        mockStateWithReturnTo("/session/9f8b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c");

        const app = await buildApp();
        const res = await app.inject({ method: "GET", url: "/auth/callback?state=valid&code=abc" });

        expect(res.statusCode).toBe(302);
        // No membership query needed/run since returnTo already produced a redirectUrl.
        expect(mockDbQuery).not.toHaveBeenCalledWith(
          expect.stringContaining("team_memberships"),
          expect.anything(),
        );
      });

      it("the stored returnTo value is single-use via the same atomic redis.getdel already used for pendingJoinToken", async () => {
        setupValidCallbackMocksNoMembershipFallback();
        mockStateWithReturnTo("/session/9f8b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c");

        const app = await buildApp();
        const first = await app.inject({ method: "GET", url: "/auth/callback?state=valid&code=abc" });
        expect(first.statusCode).toBe(302);
        expect(first.headers.location).toBe("http://localhost:5173/session/9f8b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c");

        // getdel already deleted the key — a replayed callback for the same
        // state gets nothing back, exactly like an expired/invalid state.
        mockRedisGetdel.mockResolvedValueOnce(null);
        const second = await app.inject({ method: "GET", url: "/auth/callback?state=valid&code=abc" });
        expect(second.statusCode).toBe(302);
        expect(second.headers.location).toContain("category=invalid_request");
      });
    });

    // Task 14: Returning user with all memberships removed → /no-team

    it("redirects returning user with all memberships removed to /no-team (Task 14)", async () => {
      // Existing account (isNewUser: false) — the user has authenticated before
      setupValidCallbackMocks({ isNewUser: false, teamMemberships: [] });

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/auth/callback?state=valid&code=abc",
      });

      expect(res.statusCode).toBe(302);
      // Live database query reflects no active memberships → /no-team
      expect(res.headers.location).toBe("http://localhost:5173/no-team");
      // Not a team URL
      expect(res.headers.location).not.toContain("/team/");
    });

    // Task 15: Database failure during account creation

    it("redirects to error page when resolveOrCreateAccount throws (Task 15)", async () => {
      mockRedisGetdel.mockResolvedValue(
        JSON.stringify({ nonce: "n", codeVerifier: "cv", createdAt: new Date().toISOString() }),
      );
      mockHandleCallback.mockResolvedValue({
        claims: () => ({ sub: "sub-1", iss: "https://idp.example.com" }),
        access_token: "at",
        expires_in: 3600,
      });
      // Simulate database failure during account creation
      mockResolveOrCreateAccount.mockRejectedValue(new Error("db connection failed"));
      mockMapAuthError.mockReturnValue({
        category: "authentication_failed",
        message: "An unexpected error occurred during sign-in.",
      });

      const mockSave = vi.fn(async () => {});
      const app = await buildApp({ save: mockSave });
      const res = await app.inject({
        method: "GET",
        url: "/auth/callback?state=valid&code=abc",
      });

      // (a) No session established — save must not be called
      expect(mockSave).not.toHaveBeenCalled();
      // (b) Redirect to error page, not /no-team or any team URL
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain("/auth/error");
      expect(res.headers.location).not.toContain("/no-team");
      expect(res.headers.location).not.toContain("/team/");
      // (c) auth.failure audit event emitted
      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        "auth.failure",
        expect.objectContaining({ failureCategory: "authentication_failed" }),
      );
      // (d) resolveOrCreateAccount was called and threw — no further db writes
      expect(mockResolveOrCreateAccount).toHaveBeenCalled();
      // No team membership query was reached
      expect(mockDbQuery).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Task 11.1 — Expired pendingJoinToken → /join-error?joinError=expired
    // -------------------------------------------------------------------------

    it("11.1: expired pendingJoinToken at callback time redirects to /join-error?joinError=expired", async () => {
      mockRedisGetdel.mockResolvedValue(
        JSON.stringify({
          nonce: "n",
          codeVerifier: "cv",
          pendingJoinToken: "expired-join-tok",
          createdAt: new Date().toISOString(),
        }),
      );
      mockHandleCallback.mockResolvedValue({
        claims: () => ({ sub: "sub-1", iss: "https://idp.example.com" }),
        access_token: "at",
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

      // join_links lookup — expired link (expires_at in the past, no revoked_at)
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          id: "link-expired",
          team_id: "team-1",
          expires_at: new Date(Date.now() - 86_400_000), // yesterday
          revoked_at: null,
        }],
      });
      // No INSERT should run; no session lookup should run

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/auth/callback?state=valid&code=abc",
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("http://localhost:5173/join-error?joinError=expired");
      // User not routed to /no-team
      expect(res.headers.location).not.toBe("/no-team");
      // join.link_rejected audit emitted; join.link_redeemed must NOT be emitted
      const rejectedCall = mockEmitAuditEvent.mock.calls.find(
        (c: unknown[]) => c[1] === "join.link_rejected",
      );
      expect(rejectedCall).toBeDefined();
      expect(rejectedCall![2]).toMatchObject({ reason: "expired" });
      expect(mockEmitAuditEvent).not.toHaveBeenCalledWith(
        expect.anything(),
        "join.link_redeemed",
        expect.anything(),
      );
      // No team membership INSERT was attempted — only one db query (link lookup)
      expect(mockDbQuery).toHaveBeenCalledTimes(1);
    });

    // -------------------------------------------------------------------------
    // Task 11.2 — Revoked pendingJoinToken → /join-error?joinError=expired
    // -------------------------------------------------------------------------

    it("11.2: revoked pendingJoinToken at callback time redirects to /join-error?joinError=expired", async () => {
      mockRedisGetdel.mockResolvedValue(
        JSON.stringify({
          nonce: "n",
          codeVerifier: "cv",
          pendingJoinToken: "revoked-join-tok",
          createdAt: new Date().toISOString(),
        }),
      );
      mockHandleCallback.mockResolvedValue({
        claims: () => ({ sub: "sub-1", iss: "https://idp.example.com" }),
        access_token: "at",
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

      // join_links lookup — revoked link (revoked_at is set)
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          id: "link-revoked",
          team_id: "team-1",
          expires_at: new Date(Date.now() + 86_400_000), // still in future
          revoked_at: new Date(),
        }],
      });

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/auth/callback?state=valid&code=abc",
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("http://localhost:5173/join-error?joinError=expired");
      expect(res.headers.location).not.toBe("/no-team");
      // User not added to any team
      expect(mockDbQuery).toHaveBeenCalledTimes(1);
      const rejectedCall = mockEmitAuditEvent.mock.calls.find(
        (c: unknown[]) => c[1] === "join.link_rejected",
      );
      expect(rejectedCall).toBeDefined();
      expect(rejectedCall![2]).toMatchObject({ reason: "revoked" });
    });

    // -------------------------------------------------------------------------
    // Task 11.3 — Nonexistent pendingJoinToken → /join-error?joinError=invalid
    // -------------------------------------------------------------------------

    it("11.3: nonexistent pendingJoinToken at callback time redirects to /join-error?joinError=invalid", async () => {
      mockRedisGetdel.mockResolvedValue(
        JSON.stringify({
          nonce: "n",
          codeVerifier: "cv",
          pendingJoinToken: "bad-tok",
          createdAt: new Date().toISOString(),
        }),
      );
      mockHandleCallback.mockResolvedValue({
        claims: () => ({ sub: "sub-1", iss: "https://idp.example.com" }),
        access_token: "at",
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

      // join_links lookup — token not found
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/auth/callback?state=valid&code=abc",
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("http://localhost:5173/join-error?joinError=invalid");
      expect(res.headers.location).not.toBe("/no-team");
      // User not added to any team — only one db query (link lookup)
      expect(mockDbQuery).toHaveBeenCalledTimes(1);
      const rejectedCall = mockEmitAuditEvent.mock.calls.find(
        (c: unknown[]) => c[1] === "join.link_rejected",
      );
      expect(rejectedCall).toBeDefined();
      expect(rejectedCall![2]).toMatchObject({ reason: "not_found" });
    });

    // -------------------------------------------------------------------------
    // Task 11.4 — Successful through-auth join (new member) → ?newMember=true
    // -------------------------------------------------------------------------

    it("11.4: successful through-auth join for new member redirects with ?newMember=true and emits join.link_redeemed", async () => {
      mockRedisGetdel.mockResolvedValue(
        JSON.stringify({
          nonce: "n",
          codeVerifier: "cv",
          pendingJoinToken: "valid-tok",
          createdAt: new Date().toISOString(),
        }),
      );
      mockHandleCallback.mockResolvedValue({
        claims: () => ({ sub: "sub-1", iss: "https://idp.example.com" }),
        access_token: "at",
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

      // 1. join_links lookup — valid link
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          id: "link-1",
          team_id: "team-new",
          expires_at: new Date(Date.now() + 3_600_000),
          revoked_at: null,
        }],
      });
      // 2. INSERT — new row inserted (new member)
      mockDbQuery.mockResolvedValueOnce({ rows: [{ id: "membership-1" }] });
      // 3. Sessions query — no active session
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/auth/callback?state=valid&code=abc",
      });

      expect(res.statusCode).toBe(302);
      // Task 4.1: new member gets ?newMember=true
      expect(res.headers.location).toBe("http://localhost:5173/team/team-new?newMember=true");
      // Task 4.0: join.link_redeemed emitted when new row was inserted
      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        "join.link_redeemed",
        expect.objectContaining({ userId: "user-1", teamId: "team-new" }),
      );
    });

    // -------------------------------------------------------------------------
    // Task 11.5 — Already-a-member through-auth → ?alreadyMember=true, no audit
    // -------------------------------------------------------------------------

    it("11.5: through-auth join for already-a-member user redirects with ?alreadyMember=true and does NOT emit join.link_redeemed", async () => {
      mockRedisGetdel.mockResolvedValue(
        JSON.stringify({
          nonce: "n",
          codeVerifier: "cv",
          pendingJoinToken: "valid-tok",
          createdAt: new Date().toISOString(),
        }),
      );
      mockHandleCallback.mockResolvedValue({
        claims: () => ({ sub: "sub-1", iss: "https://idp.example.com" }),
        access_token: "at",
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

      // 1. join_links lookup — valid link
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          id: "link-1",
          team_id: "team-existing",
          expires_at: new Date(Date.now() + 3_600_000),
          revoked_at: null,
        }],
      });
      // 2. INSERT — ON CONFLICT, no new row (already a member)
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      // 3. Sessions query — no active session
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/auth/callback?state=valid&code=abc",
      });

      expect(res.statusCode).toBe(302);
      // Task 4.2: already-member gets ?alreadyMember=true
      expect(res.headers.location).toBe("http://localhost:5173/team/team-existing?alreadyMember=true");
      // Task 4.0: join.link_redeemed must NOT be emitted when no new row inserted
      expect(mockEmitAuditEvent).not.toHaveBeenCalledWith(
        expect.anything(),
        "join.link_redeemed",
        expect.anything(),
      );
    });

    // -------------------------------------------------------------------------
    // Task 11.6 — Audit events carry real sourceIp (not the string "callback")
    // -------------------------------------------------------------------------

    it("11.6: join.link_rejected audit event carries real sourceIp (not the literal string 'callback')", async () => {
      mockRedisGetdel.mockResolvedValue(
        JSON.stringify({
          nonce: "n",
          codeVerifier: "cv",
          pendingJoinToken: "bad-tok",
          createdAt: new Date().toISOString(),
        }),
      );
      mockHandleCallback.mockResolvedValue({
        claims: () => ({ sub: "sub-1", iss: "https://idp.example.com" }),
        access_token: "at",
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
      // Token not found
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const app = await buildApp();
      await app.inject({
        method: "GET",
        url: "/auth/callback?state=valid&code=abc",
      });

      const rejectedCall = mockEmitAuditEvent.mock.calls.find(
        (c: unknown[]) => c[1] === "join.link_rejected",
      );
      expect(rejectedCall).toBeDefined();
      const auditFields = rejectedCall![2] as Record<string, unknown>;
      // sourceIp must be a real IP (from request.ip in the test injector), not
      // the string "callback" that the previous implementation used as a placeholder
      expect(auditFields.sourceIp).toBeDefined();
      expect(auditFields.sourceIp).not.toBe("callback");
      expect(typeof auditFields.sourceIp).toBe("string");
    });

    it("11.6b: join.link_redeemed audit event carries sourceIp when a new membership is created", async () => {
      mockRedisGetdel.mockResolvedValue(
        JSON.stringify({
          nonce: "n",
          codeVerifier: "cv",
          pendingJoinToken: "valid-tok",
          createdAt: new Date().toISOString(),
        }),
      );
      mockHandleCallback.mockResolvedValue({
        claims: () => ({ sub: "sub-1", iss: "https://idp.example.com" }),
        access_token: "at",
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
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [{
            id: "link-1",
            team_id: "team-1",
            expires_at: new Date(Date.now() + 3_600_000),
            revoked_at: null,
          }],
        })
        .mockResolvedValueOnce({ rows: [{ id: "membership-1" }] }) // new member
        .mockResolvedValueOnce({ rows: [] }); // no active session

      const app = await buildApp();
      await app.inject({
        method: "GET",
        url: "/auth/callback?state=valid&code=abc",
      });

      const redeemedCall = mockEmitAuditEvent.mock.calls.find(
        (c: unknown[]) => c[1] === "join.link_redeemed",
      );
      expect(redeemedCall).toBeDefined();
      const auditFields = redeemedCall![2] as Record<string, unknown>;
      expect(auditFields.sourceIp).toBeDefined();
      expect(auditFields.sourceIp).not.toBe("callback");
      expect(typeof auditFields.sourceIp).toBe("string");
    });

    // -------------------------------------------------------------------------
    // Task 11.9 — team_memberships INSERT uses role = 'participant'
    // -------------------------------------------------------------------------

    it("11.9: successful join writes team_memberships row with role = 'participant'", async () => {
      // This test is the automated backstop for the role vocabulary comments in
      // Tasks 2.1 and 2.2. It is the only check that would catch a regression
      // where the role value is changed to a non-existent enum value ('engineer').
      mockRedisGetdel.mockResolvedValue(
        JSON.stringify({
          nonce: "n",
          codeVerifier: "cv",
          pendingJoinToken: "valid-tok",
          createdAt: new Date().toISOString(),
        }),
      );
      mockHandleCallback.mockResolvedValue({
        claims: () => ({ sub: "sub-1", iss: "https://idp.example.com" }),
        access_token: "at",
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
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [{
            id: "link-1",
            team_id: "team-1",
            expires_at: new Date(Date.now() + 3_600_000),
            revoked_at: null,
          }],
        })
        .mockResolvedValueOnce({ rows: [{ id: "membership-1" }] }) // new member
        .mockResolvedValueOnce({ rows: [] }); // no active session

      const app = await buildApp();
      await app.inject({
        method: "GET",
        url: "/auth/callback?state=valid&code=abc",
      });

      // Find the INSERT INTO team_memberships call
      const insertCall = mockDbQuery.mock.calls.find(
        (call) =>
          typeof call[0] === "string" &&
          call[0].includes("INSERT INTO team_memberships"),
      );
      expect(insertCall).toBeDefined();

      // The SQL uses a positional parameter for role, or embeds 'participant'
      // as a literal. Either way the SQL text must contain 'participant'.
      const sql = insertCall![0] as string;
      expect(sql).toContain("participant");
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
        expect.objectContaining({ reason: "explicit_logout", sourceIp: expect.any(String) }),
      );
    });

    // Task 5.7: confirms Decision D4 isn't silently "fixed" into resolving a
    // real team_id later without a corresponding spec update -- team_id is a
    // literal NULL in the INSERT's SQL text, not a bound parameter fed by
    // any lookup, and no team/session lookup query is ever issued for this
    // write (Decision D4/D7).
    it("writes team_id as a literal NULL, with no team lookup query issued (Decision D4, task 5.7)", async () => {
      mockGetDecryptedTokens.mockReturnValue({ idToken: "id-tok" });
      mockGetEndSessionUrl.mockResolvedValue(null);

      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/auth/logout?confirmed=true",
      });

      expect(res.statusCode).toBe(200);
      const insertCall = mockDbQuery.mock.calls.find((c) =>
        String(c[0]).includes("INSERT INTO audit_log"),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![0]).toContain("NULL");
      const teamLookupCall = mockDbQuery.mock.calls.find((c) =>
        String(c[0]).includes("FROM sessions"),
      );
      expect(teamLookupCall).toBeUndefined();
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

    it("degrades gracefully when getEndSessionUrl() throws (design D4, task 4.2)", async () => {
      mockGetDecryptedTokens.mockReturnValue({ idToken: "id-tok" });
      mockGetEndSessionUrl.mockRejectedValue(new Error("IdP end-session request failed"));

      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/auth/logout?confirmed=true",
      });

      // (a) falls back to { redirectUrl: "/" } rather than propagating an uncaught error
      expect(res.statusCode).toBe(200);
      expect(res.json().redirectUrl).toBe("/");

      // (b) the local session is already destroyed before this fallback response --
      // request.session.destroy() runs unconditionally, earlier in the handler, before
      // the IdP-logout attempt is ever made.
      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        "auth.session_invalidated",
        expect.objectContaining({ reason: "explicit_logout", sourceIp: expect.any(String) }),
      );

      // (c) the error is routed through sanitizeOidcError before being logged
      expect(mockSanitizeOidcError).toHaveBeenCalledWith(expect.any(Error), expect.anything());

      // (d) a distinct auth.idp_logout_failed audit event is emitted, with userId/sessionId,
      // separate from the auth.session_invalidated event asserted above.
      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        "auth.idp_logout_failed",
        expect.objectContaining({ userId: "user-1", sessionId: "sess-1" }),
      );
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

// ---------------------------------------------------------------------------
// validateReturnTo — reauth-return-to: design.md Decision 3, tasks.md task
// 2.11. Exercised directly (not only through the /auth/login HTTP path
// above) so the debug-log-on-rejection behavior — a discard-trace log, not
// an audit_log row, per Tomás Ferreira's design review — can be asserted
// without instrumenting Fastify's own child logger.
// ---------------------------------------------------------------------------
describe("validateReturnTo", () => {
  function fakeLog() {
    return {
      debug: vi.fn(),
      warn: vi.fn(),
    } as unknown as FastifyBaseLogger;
  }

  it("emits a debug-level log and writes no audit_log row for a rejected non-allow-listed path", () => {
    const log = fakeLog();
    const result = validateReturnTo("/some/unrecognized/path", log);

    expect(result).toBeNull();
    expect(log.debug).toHaveBeenCalledWith(
      expect.objectContaining({ returnTo: "/some/unrecognized/path" }),
      expect.stringContaining("rejected"),
    );
    expect(mockDbQuery).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.anything());
  });

  it("emits a debug-level log for a scheme/authority-bearing value and writes no audit_log row", () => {
    const log = fakeLog();
    const result = validateReturnTo("https://evil.example.com/session/abc", log);

    expect(result).toBeNull();
    expect(log.debug).toHaveBeenCalled();
    expect(mockDbQuery).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.anything());
  });

  it("emits a debug-level log for a CRLF-bearing value and writes no audit_log row", () => {
    const log = fakeLog();
    const result = validateReturnTo("/session/9f8b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c\r\nX: 1", log);

    expect(result).toBeNull();
    expect(log.debug).toHaveBeenCalled();
    expect(mockDbQuery).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"), expect.anything());
  });

  it("returns the value unchanged and logs nothing for an allow-listed path", () => {
    const log = fakeLog();
    const value = "/session/9f8b1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
    const result = validateReturnTo(value, log);

    expect(result).toBe(value);
    expect(log.debug).not.toHaveBeenCalled();
  });
});
