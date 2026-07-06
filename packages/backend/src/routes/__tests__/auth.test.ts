import { describe, it, expect, vi, beforeEach } from "vitest";

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
        expect(res.headers.location).toBe("/team/team-joined?alreadyMember=true");
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
      expect(res.headers.location).toBe("/join-error?joinError=expired");
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
      expect(res.headers.location).toBe("/join-error?joinError=expired");
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
      expect(res.headers.location).toBe("/join-error?joinError=invalid");
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
      expect(res.headers.location).toBe("/team/team-new?newMember=true");
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
      expect(res.headers.location).toBe("/team/team-existing?alreadyMember=true");
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
