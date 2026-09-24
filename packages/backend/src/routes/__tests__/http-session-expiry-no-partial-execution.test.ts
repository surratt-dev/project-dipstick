import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// http-session-expiry-reauth-parity, tasks.md 8.1/8.2, design.md Decision 4/7.
//
// Verifies the no-partial-execution guarantee these two mutating call sites
// depend on: because authMiddleware's session-expiry check runs in the
// `onRequest` hook, before any route handler executes, a `session_expired`
// 401 on `advance` or `submitRoleChange` is guaranteed to mean the mutation
// never ran server-side. Unlike the other route test files in this
// directory, THIS file registers the REAL `authMiddleware` (not a stubbed
// onRequest hook that assigns `request.session` directly) ahead of the real
// route plugin, so the 401 short-circuit under test is the actual
// production mechanism, not a simulation of it.
//
// db.js is mocked (matching every other fast/mocked test file in this
// directory) so no real Postgres is required — the assertion is that
// `db.connect()` (the transaction gateway both mutations use for their
// UPDATE) is never called, which is only possible if the route handler body
// never ran at all.
// ---------------------------------------------------------------------------

const mockDbQuery = vi.fn();
const mockDbConnect = vi.fn();
const mockEmitAuditEvent = vi.fn();

vi.mock("../../db.js", () => ({
  db: {
    query: (...args: unknown[]) => mockDbQuery(...args),
    connect: (...args: unknown[]) => mockDbConnect(...args),
  },
}));
vi.mock("../../auth/audit-logger.js", () => ({
  emitAuditEvent: (...args: unknown[]) => mockEmitAuditEvent(...args),
}));
vi.mock("../../realtime/ws-pubsub.js", () => ({
  publishSessionStateChange: vi.fn(),
  publishVoteRevealed: vi.fn(),
  publishTopicHistoryUpdate: vi.fn(),
  publishVoteReadinessUpdate: vi.fn(),
  clearFacilitatorConnectedFlag: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../auth/session-subscriber-access-helper.js", () => ({
  evaluateSessionSubscriberAccess: vi.fn(),
}));
vi.mock("../../content/timing-oracle.js", () => ({
  applyTimingFloor: vi.fn().mockResolvedValue(undefined),
  CONTENT_TIMING_FLOOR_MS: 150,
}));
vi.mock("../../redis.js", () => ({
  redis: { get: vi.fn(), set: vi.fn(), setex: vi.fn(), del: vi.fn(), getdel: vi.fn() },
}));
vi.mock("../../config.js", () => ({
  config: {
    DATABASE_URL: "postgres://test",
    REDIS_URL: "redis://test",
    SESSION_SECRET: "test",
    OIDC_ISSUER: "https://idp.example.com",
    OIDC_CLIENT_ID: "client-id",
    OIDC_CLIENT_SECRET: "client-secret",
    OIDC_REDIRECT_URI: "http://localhost:3000/auth/callback",
    NODE_ENV: "test",
  },
}));

import Fastify from "fastify";
import { authMiddleware } from "../../auth/middleware.js";
import { facilitatorSessionRoutes } from "../facilitator-sessions.js";
import { teamRoutes } from "../teams.js";

/** A session whose absolute lifetime has already elapsed (> 90 minutes old). */
function expiredSession(userId = "facilitator-1") {
  return {
    userId,
    sessionCreatedAt: new Date(Date.now() - 91 * 60 * 1000).toISOString(),
    tokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    encryptedAccessToken: "enc(token)",
    sessionId: "sess-1",
    destroy: vi.fn(),
    touch: vi.fn(),
  };
}

async function buildAppWithRealAuthMiddleware(session: ReturnType<typeof expiredSession>) {
  const app = Fastify();
  app.decorateRequest("session", null);
  // Fake session plumbing only — no real @fastify/session/Redis store.
  // authMiddleware itself is the REAL implementation under test.
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = {
      ...session,
      destroy: session.destroy,
      touch: session.touch,
    };
  });
  await authMiddleware(app);
  await app.register(facilitatorSessionRoutes);
  await app.register(teamRoutes);
  return app.ready().then(() => app);
}

beforeEach(() => {
  vi.clearAllMocks();
  // resolveActorGlobalRole's SELECT and the audit_log INSERT the 401
  // short-circuit's own audit write performs — both go through db.query,
  // and both are irrelevant to the assertions below (which key on
  // db.connect, the mutation transaction gateway).
  mockDbQuery.mockResolvedValue({ rows: [] });
});

describe("8.1: a session_expired 401 on advance guarantees the room did not open", () => {
  it("returns a disclosed session-expiry 401 and never opens a mutation transaction", async () => {
    const app = await buildAppWithRealAuthMiddleware(expiredSession("facilitator-1"));

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/sess-1/advance",
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ category: "session_expired" }) }),
    );

    // The advance handler's own session lookup (`db.query`, "FROM sessions")
    // and its UPDATE transaction (`db.connect()`) never ran — the handler
    // body was never reached.
    expect(mockDbConnect).not.toHaveBeenCalled();
    for (const call of mockDbQuery.mock.calls) {
      expect(String(call[0])).not.toMatch(/FROM sessions/i);
    }
  });

  it("a subsequent facilitator-state re-fetch (fresh, non-expired session) still shows the session in draft", async () => {
    const app = await buildAppWithRealAuthMiddleware(expiredSession("facilitator-1"));

    const advanceRes = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/sess-1/advance",
    });
    expect(advanceRes.statusCode).toBe(401);

    // Re-fetch with a fresh, non-expired session — models the facilitator
    // reauthenticating and returning via `returnTo`.
    const freshApp = await buildAppWithRealAuthMiddleware({
      userId: "facilitator-1",
      sessionCreatedAt: new Date().toISOString(),
      tokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
      encryptedAccessToken: "enc(token)",
      sessionId: "sess-2",
      destroy: vi.fn(),
      touch: vi.fn(),
    });
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ id: "sess-1", team_id: "team-1", facilitator_id: "facilitator-1", status: "draft", join_token: "tok" }],
    });

    const getRes = await freshApp.inject({
      method: "GET",
      url: "/api/v1/teams/team-1/sessions/sess-1/facilitator-state",
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toEqual(expect.objectContaining({ currentSessionState: "draft" }));
  });
});

describe("8.2: a session_expired 401 on submitRoleChange guarantees the role did not change", () => {
  it("returns a disclosed session-expiry 401 on the initial submission and never opens a mutation transaction", async () => {
    const app = await buildAppWithRealAuthMiddleware(expiredSession("manager-1"));

    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/teams/team-1/members/user-2/role",
      payload: { role: "engineering_manager" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ category: "session_expired" }) }),
    );

    expect(mockDbConnect).not.toHaveBeenCalled();
  });

  it("returns a disclosed session-expiry 401 on the confirmedZeroParticipant re-submission and never opens a mutation transaction", async () => {
    const app = await buildAppWithRealAuthMiddleware(expiredSession("manager-1"));

    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/teams/team-1/members/user-2/role",
      payload: { role: "engineering_manager", confirmedZeroParticipant: true },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ category: "session_expired" }) }),
    );

    expect(mockDbConnect).not.toHaveBeenCalled();
  });
});
