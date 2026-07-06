import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDbQuery = vi.fn();
const mockEmitAuditEvent = vi.fn();

vi.mock("../../db.js", () => ({
  db: { query: (...args: unknown[]) => mockDbQuery(...args) },
}));
vi.mock("../../auth/audit-logger.js", () => ({
  emitAuditEvent: (...args: unknown[]) => mockEmitAuditEvent(...args),
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
import { joinLinkRoutes } from "../join-links.js";

function buildApp(sessionData: Record<string, unknown> = {}) {
  const app = Fastify();

  // Decorate request with a mock session
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = {
      userId: "user-1",
      ...sessionData,
    };
  });

  app.register(joinLinkRoutes);
  return app.ready().then(() => app);
}

describe("joinLinkRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/teams/:teamId/join-links", () => {
    it("should return 403 when user is not a team member", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // membership check

      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/teams/team-1/join-links",
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.message).toContain("not a member");
    });

    it("should return 403 when user lacks permission", async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ role: "participant" }] }) // member but participant
        .mockResolvedValueOnce({ rows: [{ global_role: "participant" }] }); // not facilitator

      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/teams/team-1/join-links",
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.message).toContain("do not have permission");
    });

    it("should create a join link when user is engineering_manager on team", async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ role: "engineering_manager" }] }) // member role
        .mockResolvedValueOnce({ rows: [{ global_role: "participant" }] }) // global role
        .mockResolvedValueOnce({
          rows: [
            {
              id: "link-1",
              team_id: "team-1",
              token: "generated-token",
              created_at: new Date("2025-06-01"),
              expires_at: new Date("2025-06-08"),
            },
          ],
        });

      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/teams/team-1/join-links",
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBe("link-1");
      expect(body.teamId).toBe("team-1");
      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        "join.link_created",
        expect.objectContaining({ teamId: "team-1", linkId: "link-1" }),
      );
    });

    it("should create a join link when user has facilitator global role", async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ role: "participant" }] })
        .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "link-2",
              team_id: "team-1",
              token: "tok",
              created_at: new Date("2025-06-01"),
              expires_at: new Date("2025-06-08"),
            },
          ],
        });

      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/teams/team-1/join-links",
      });

      expect(res.statusCode).toBe(201);
    });
  });

  describe("GET /api/join/:token", () => {
    // Task 6.4: direct path now redirects to /join-error?joinError=... so both
    // the direct and through-auth paths converge on the same error destination.

    it("should redirect to /join-error?joinError=invalid when token not found (Task 6.4 / 11.7)", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/join/bad-token",
      });

      expect(res.statusCode).toBe(302);
      // Task 6.4: must use /join-error?joinError=invalid, NOT /auth/error
      expect(res.headers.location).toBe("/join-error?joinError=invalid");
      expect(res.headers.location).not.toContain("/auth/error");
      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        "join.link_rejected",
        expect.objectContaining({ reason: "not_found" }),
      );
    });

    it("should redirect to /join-error?joinError=expired when link is revoked (Task 6.4 / 11.7)", async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "link-1",
            team_id: "team-1",
            expires_at: new Date(Date.now() + 86400000),
            revoked_at: new Date(),
          },
        ],
      });

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/join/revoked-token",
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("/join-error?joinError=expired");
      expect(res.headers.location).not.toContain("/auth/error");
    });

    it("should redirect to /join-error?joinError=expired when link is expired (Task 6.4 / 11.7)", async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "link-1",
            team_id: "team-1",
            expires_at: new Date(Date.now() - 86400000), // expired yesterday
            revoked_at: null,
          },
        ],
      });

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/join/expired-token",
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("/join-error?joinError=expired");
      expect(res.headers.location).not.toContain("/auth/error");
    });

    it("should redirect to login when user is not authenticated", async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "link-1",
            team_id: "team-1",
            expires_at: new Date(Date.now() + 86400000),
            revoked_at: null,
          },
        ],
      });

      const app = await buildApp({ userId: undefined });
      const res = await app.inject({
        method: "GET",
        url: "/api/join/valid-token",
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain("/auth/login?joinToken=valid-token");
    });

    it("should join team and redirect when authenticated", async () => {
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: "link-1",
              team_id: "team-1",
              expires_at: new Date(Date.now() + 86400000),
              revoked_at: null,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ id: "membership-1" }] }) // INSERT membership
        .mockResolvedValueOnce({ rows: [] }); // no active session

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/join/valid-token",
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("/team/team-1");
      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        "join.link_redeemed",
        expect.objectContaining({
          sourceIp: expect.any(String),
          userId: "user-1",
          teamId: "team-1",
        }),
      );
    });

    it("should redirect to active session if one exists", async () => {
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: "link-1",
              team_id: "team-1",
              expires_at: new Date(Date.now() + 86400000),
              revoked_at: null,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ id: "membership-1" }] })
        .mockResolvedValueOnce({ rows: [{ id: "session-abc" }] }); // active session

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/join/valid-token",
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("/session/session-abc");
    });
  });
});
