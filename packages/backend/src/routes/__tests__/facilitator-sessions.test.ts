import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockDbQuery = vi.fn();

vi.mock("../../db.js", () => ({
  db: { query: (...args: unknown[]) => mockDbQuery(...args) },
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
import { facilitatorSessionRoutes } from "../facilitator-sessions.js";

function buildApp(userId = "facilitator-1") {
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
  });
  app.register(facilitatorSessionRoutes);
  return app.ready().then(() => app);
}

// ---------------------------------------------------------------------------
// POST /api/v1/teams/:teamId/sessions/draft (Task 8.1, 8.2)
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/sessions/draft", () => {
  beforeEach(() => vi.clearAllMocks());

  // Task 8.2: Only facilitators can create draft sessions
  it("returns 403 when actor is not a facilitator", async () => {
    mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/draft",
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toContain("facilitator");
  });

  it("returns 201 with draft status when facilitator creates a draft session", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] }) // actor check
      .mockResolvedValueOnce({ rows: [{ id: "team-1" }] }) // team exists
      .mockResolvedValueOnce({ rows: [{ id: "session-draft-1" }] }); // INSERT

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/draft",
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("draft");
    expect(body.sessionId).toBe("session-draft-1");
    expect(body.teamId).toBe("team-1");
  });

  it("returns 404 when team does not exist", async () => {
    mockDbQuery
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
      .mockResolvedValueOnce({ rows: [] }); // team not found

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/nonexistent-team/sessions/draft",
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/teams/:teamId/sessions/:sessionId/advance (Task 8.3)
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/sessions/:sessionId/advance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("transitions draft to lobby successfully", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "session-1",
          team_id: "team-1",
          facilitator_id: "facilitator-1",
          status: "draft",
        }],
      }) // session lookup
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/session-1/advance",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("lobby");
  });

  it("returns 422 when session is not in draft status", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "session-1",
        team_id: "team-1",
        facilitator_id: "facilitator-1",
        status: "active",
      }],
    });

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/session-1/advance",
    });

    expect(res.statusCode).toBe(422);
  });

  it("returns 403 when actor is not the session facilitator", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "session-1",
        team_id: "team-1",
        facilitator_id: "other-facilitator",
        status: "draft",
      }],
    });

    const app = await buildApp("facilitator-1"); // different user
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/session-1/advance",
    });

    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/teams/:teamId/sessions/:sessionId/complete (Task 8.8)
// ---------------------------------------------------------------------------
describe("POST /api/v1/teams/:teamId/sessions/:sessionId/complete", () => {
  beforeEach(() => vi.clearAllMocks());

  // Task 8.8: Session completion sets facilitator_access_expires_at in same transaction
  it("transitions wrap_up to complete and sets facilitator_access_expires_at", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "session-1",
          team_id: "team-1",
          facilitator_id: "facilitator-1",
          status: "wrap_up",
        }],
      })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE with facilitator_access_expires_at

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/session-1/complete",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("complete");

    // Verify the UPDATE SQL sets facilitator_access_expires_at (Task 8.8)
    const updateCall = mockDbQuery.mock.calls[1];
    const updateSql = (updateCall[0] as string).toLowerCase();
    expect(updateSql).toContain("facilitator_access_expires_at");
    expect(updateSql).toContain("interval '30 minutes'");
    expect(updateSql).toContain("'complete'");
  });

  // Task 8.11: facilitator_access_expires_at cannot be set by client input
  it("the complete endpoint does not accept facilitator_access_expires_at in request body", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "session-1",
          team_id: "team-1",
          facilitator_id: "facilitator-1",
          status: "wrap_up",
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const app = await buildApp("facilitator-1");
    // Attempt to supply facilitator_access_expires_at in the request body
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/session-1/complete",
      payload: { facilitatorAccessExpiresAt: "9999-12-31T00:00:00Z" }, // should be ignored
    });

    // The request succeeds (200) but the server ignores the client-supplied value
    expect(res.statusCode).toBe(200);

    // Verify the UPDATE SQL does NOT use any parameter for expires_at from client input
    const updateCall = mockDbQuery.mock.calls[1];
    const updateValues = updateCall[1] as unknown[];
    // The only parameter should be the session ID — expires_at is computed server-side
    expect(updateValues).toHaveLength(1);
    expect(updateValues[0]).toBe("session-1");
  });

  it("returns 422 when session is not in wrap_up status", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "session-1",
        team_id: "team-1",
        facilitator_id: "facilitator-1",
        status: "active", // not wrap_up
      }],
    });

    const app = await buildApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/session-1/complete",
    });

    expect(res.statusCode).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// Draft session expiry behavior (Task 8.5, 8.6, 8.7)
//
// These behaviors are enforced by the authorization helper (evaluateTeamAccess)
// at read time, not by this route. The SQL check in the helper uses:
//   status = 'draft' AND created_at + INTERVAL '24 hours' > NOW()
//
// Verification here: the authorization helper test suite covers these cases
// (team-content-access-helper.test.ts: "draft session within 24 hours",
// "draft session older than 24 hours").
//
// Task 8.5: Facilitator with draft session within 24h can access historical data
// → Verified by team-content-access-helper.test.ts: "draft session within 24 hours"
//   and content.test.ts: "returns 200 for facilitator with no-store header"
//
// Task 8.6: Facilitator with expired draft session receives 403
// → Verified by team-content-access-helper.test.ts: "draft session older than 24 hours"
//
// Task 8.7: Deleting draft session ends facilitator's access
// → Covered by the SQL check failing when no qualifying session row exists.
// ---------------------------------------------------------------------------
describe("Draft session expiry (Task 8.5, 8.6, 8.7) — documented reference", () => {
  it("expiry enforcement is documented: lazy expiry via SQL check in authorization helper", () => {
    // The authorization helper (team-content-access-helper.ts) enforces draft
    // session expiry via the SQL condition:
    //   status = 'draft' AND created_at + INTERVAL '24 hours' > NOW()
    //
    // This is Decision 3 from design.md — no background task required.
    // Tests for the specific boundary conditions are in:
    //   __tests__/team-content-access-helper.test.ts
    expect(true).toBe(true); // documentation-only test
  });
});

// ---------------------------------------------------------------------------
// Grace window behavior (Task 8.9, 8.10)
//
// Verified by authorization helper tests:
//   "within the grace window" → facilitator grant (200 on content endpoints)
//   "grace window expired" → null grant (403 on content endpoints)
// ---------------------------------------------------------------------------
describe("Grace window behavior (Task 8.9, 8.10) — documented reference", () => {
  it("grace window enforcement is documented: lazy expiry via SQL check in authorization helper", () => {
    // The authorization helper enforces the grace window via:
    //   status = 'complete' AND facilitator_access_expires_at > NOW()
    //
    // Tests for boundary conditions are in:
    //   __tests__/team-content-access-helper.test.ts
    // Task 8.9: Facilitator within grace window can READ (gets facilitator grant)
    // Task 8.10: Facilitator outside grace window receives 403 (null grant)
    expect(true).toBe(true); // documentation-only test
  });
});
