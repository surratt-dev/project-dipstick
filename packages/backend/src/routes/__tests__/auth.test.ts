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

  mockRedisGet.mockResolvedValue(
    JSON.stringify({ nonce: "n", codeVerifier: "cv", createdAt: new Date().toISOString() }),
  );
  mockRedisDel.mockResolvedValue(1);
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

    it("should complete sign-in flow and redirect to team page for user with memberships", async () => {
      // isNewUser: false — returning user with existing team membership
      setupValidCallbackMocks({ isNewUser: false, teamMemberships: [{ team_id: "team-1" }] });

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/auth/callback?state=valid&code=abc",
      });

      expect(res.statusCode).toBe(302);
      // Task 5: server-side redirect to /team/:teamId
      expect(res.headers.location).toBe("/team/team-1");
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

    it("should emit first_access_created with all required fields for new users (Task 21)", async () => {
      // isNewUser: true, no team memberships → redirect to /no-team
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
      // Task 5: no team memberships → /no-team
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/auth/callback?state=valid&code=abc",
      });

      // Task 5: redirects to /no-team when no memberships
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("/no-team");

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
    });

    // Task 12: Missing claims rejection

    describe("missing claims rejection (Task 12)", () => {
      const validStateData = JSON.stringify({
        nonce: "n",
        codeVerifier: "cv",
        createdAt: new Date().toISOString(),
      });

      beforeEach(() => {
        mockRedisGet.mockResolvedValue(validStateData);
        mockRedisDel.mockResolvedValue(1);
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
        expect(auditFields.missingClaim).toBeDefined();
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
        expect(res.headers.location).toBe("/no-team");
      });

      it("redirects user with team memberships to /team/:teamId", async () => {
        setupValidCallbackMocks({ teamMemberships: [{ team_id: "team-abc" }] });

        const app = await buildApp();
        const res = await app.inject({
          method: "GET",
          url: "/auth/callback?state=valid&code=abc",
        });

        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe("/team/team-abc");
      });

      it("uses join flow redirect (team URL) when join token is processed successfully", async () => {
        mockRedisGet.mockResolvedValue(
          JSON.stringify({
            nonce: "n",
            codeVerifier: "cv",
            pendingJoinToken: "join-tok-1",
            createdAt: new Date().toISOString(),
          }),
        );
        mockRedisDel.mockResolvedValue(1);
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
        // 2. INSERT INTO team_memberships (ON CONFLICT DO NOTHING)
        mockDbQuery.mockResolvedValueOnce({ rows: [] });
        // 3. Sessions query — no active session
        mockDbQuery.mockResolvedValueOnce({ rows: [] });
        // Join flow returns /team/team-joined, so no further db query for memberships

        const app = await buildApp();
        const res = await app.inject({
          method: "GET",
          url: "/auth/callback?state=valid&code=abc",
        });

        expect(res.statusCode).toBe(302);
        // Redirected to the joined team — not to /no-team
        expect(res.headers.location).toBe("/team/team-joined");
        expect(res.headers.location).not.toBe("/no-team");
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
      expect(res.headers.location).toBe("/no-team");
      // Not a team URL
      expect(res.headers.location).not.toContain("/team/");
    });

    // Task 15: Database failure during account creation

    it("redirects to error page when resolveOrCreateAccount throws (Task 15)", async () => {
      mockRedisGet.mockResolvedValue(
        JSON.stringify({ nonce: "n", codeVerifier: "cv", createdAt: new Date().toISOString() }),
      );
      mockRedisDel.mockResolvedValue(1);
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
