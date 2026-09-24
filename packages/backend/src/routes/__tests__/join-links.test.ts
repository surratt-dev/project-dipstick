import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDbQuery = vi.fn();
const mockDbConnect = vi.fn();
const mockEmitAuditEvent = vi.fn();

vi.mock("../../db.js", () => ({
  db: {
    query: (...args: unknown[]) => mockDbQuery(...args),
    connect: () => mockDbConnect(),
  },
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

// ---------------------------------------------------------------------------
// auth-events-audit-log-coverage, tasks.md 1.6 (Architect review Finding 3):
// join-links.ts had no transactional (db.connect()-based) writes before this
// change; both POST /api/teams/:teamId/join-links (join.link_created) and
// GET /api/join/:token (join.link_redeemed) now open one via
// withAuditTransaction. mockDbConnect must return a distinct mock client
// instance per call, matching auth.test.ts's task 1.5 fixture shape.
// ---------------------------------------------------------------------------
function makeMockClient(queryResponses: Array<{ rows: unknown[] }> = []) {
  let callIndex = 0;
  const mockClientQuery = vi.fn((..._args: unknown[]) => {
    const resp = queryResponses[callIndex] ?? { rows: [] };
    callIndex++;
    return Promise.resolve(resp);
  });
  return { query: mockClientQuery, release: vi.fn() };
}

describe("joinLinkRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: a working client for any withAuditTransaction call whose
    // specific responses this test doesn't otherwise care about.
    mockDbConnect.mockImplementation(() => Promise.resolve(makeMockClient()));
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
        .mockResolvedValueOnce({ rows: [{ global_role: "participant" }] }); // global role
      mockDbConnect.mockResolvedValueOnce(
        makeMockClient([
          { rows: [] }, // BEGIN
          {
            rows: [
              {
                id: "link-1",
                team_id: "team-1",
                token: "generated-token",
                created_at: new Date("2025-06-01"),
                expires_at: new Date("2025-06-08"),
              },
            ],
          }, // INSERT INTO join_links
        ]),
      );

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
        .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });
      mockDbConnect.mockResolvedValueOnce(
        makeMockClient([
          { rows: [] },
          {
            rows: [
              {
                id: "link-2",
                team_id: "team-1",
                token: "tok",
                created_at: new Date("2025-06-01"),
                expires_at: new Date("2025-06-08"),
              },
            ],
          },
        ]),
      );

      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/teams/team-1/join-links",
      });

      expect(res.statusCode).toBe(201);
    });

    // task 5.2: the audit_log row's actor_global_role/team_id/metadata shape.
    it("5.2: the join.link_created audit_log row carries actor_global_role, team_id, linkId, and expiresAt", async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ role: "participant" }] })
        .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] });
      const client = makeMockClient([
        { rows: [] },
        {
          rows: [
            {
              id: "link-3",
              team_id: "team-1",
              token: "tok3",
              created_at: new Date("2025-06-01"),
              expires_at: new Date("2025-06-08"),
            },
          ],
        },
      ]);
      mockDbConnect.mockResolvedValueOnce(client);

      const app = await buildApp();
      await app.inject({ method: "POST", url: "/api/teams/team-1/join-links" });

      const auditInsertCall = client.query.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO audit_log"),
      );
      expect(auditInsertCall).toBeDefined();
      const params = auditInsertCall![1] as unknown[];
      expect(params[0]).toBe("user-1"); // actor_user_id
      expect(params[1]).toBe("facilitator"); // actor_global_role, from userRole
      expect(params[3]).toBe("team-1"); // team_id
      const metadata = JSON.parse(params[4] as string);
      expect(metadata).toEqual({ linkId: "link-3", expiresAt: new Date("2025-06-08").toISOString() });
    });

    // auth-events-audit-log-coverage, design.md Decision D2/D3, tasks 5.3-5.5.
    it("5.3: a failed audit INSERT rolls back the join_links row, and join.link_created is never emitted", async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ role: "engineering_manager" }] })
        .mockResolvedValueOnce({ rows: [{ global_role: "participant" }] });
      const failingClient = {
        query: vi.fn((sql: string) => {
          if (typeof sql === "string" && sql.includes("INSERT INTO audit_log")) {
            return Promise.reject(new Error("constraint violation"));
          }
          if (typeof sql === "string" && sql.includes("INSERT INTO join_links")) {
            return Promise.resolve({
              rows: [{ id: "link-1", team_id: "team-1", token: "tok", created_at: new Date(), expires_at: new Date() }],
            });
          }
          return Promise.resolve({ rows: [] });
        }),
        release: vi.fn(),
      };
      mockDbConnect.mockResolvedValueOnce(failingClient);

      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: "/api/teams/team-1/join-links" });

      // 5.4: not sanitized/reclassified -- plain Fastify default 500, no
      // mapAuthError/sanitizeOidcError involvement (no catch block exists
      // in this file, unlike GET /auth/callback).
      expect(res.statusCode).toBe(500);
      const calls = failingClient.query.mock.calls.map((c) => c[0]);
      expect(calls).toContain("ROLLBACK");
      expect(calls).not.toContain("COMMIT");
      expect(mockEmitAuditEvent).not.toHaveBeenCalledWith(
        expect.anything(),
        "join.link_created",
        expect.anything(),
      );
    });

    // task 5.5: a failed db.connect() at this call site also surfaces as a
    // plain, unclassified 500 -- same asymmetry as 5.4.
    it("5.5: a failed db.connect() surfaces as a plain 500", async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ role: "engineering_manager" }] })
        .mockResolvedValueOnce({ rows: [{ global_role: "participant" }] });
      mockDbConnect.mockRejectedValueOnce(new Error("pool exhausted"));

      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: "/api/teams/team-1/join-links" });

      expect(res.statusCode).toBe(500);
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

    // Task 2.6: is_active is now a computed column built from the shared
    // JOIN_LINK_ACTIVE_SQL constant (join-link-creation.ts), gating this
    // branch; revoked_at/expires_at are still read separately below only to
    // pick *which* rejection reason to report.
    it("should redirect to /join-error?joinError=expired when link is revoked (Task 6.4 / 11.7 / 2.6)", async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "link-1",
            team_id: "team-1",
            expires_at: new Date(Date.now() + 86400000),
            revoked_at: new Date(),
            is_active: false,
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
      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        "join.link_rejected",
        expect.objectContaining({ reason: "revoked" }),
      );
    });

    it("should redirect to /join-error?joinError=expired when link is expired (Task 6.4 / 11.7 / 2.6)", async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "link-1",
            team_id: "team-1",
            expires_at: new Date(Date.now() - 86400000), // expired yesterday
            revoked_at: null,
            is_active: false,
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
      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        "join.link_rejected",
        expect.objectContaining({ reason: "expired" }),
      );
    });

    it("should redirect to login when user is not authenticated", async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [
          {
            id: "link-1",
            team_id: "team-1",
            expires_at: new Date(Date.now() + 86400000),
            revoked_at: null,
            is_active: true,
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
              is_active: true,
            },
          ],
        })
        // Decision D5: a new SELECT global_role query, on the plain pool,
        // before the transaction opens.
        .mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] })
        .mockResolvedValueOnce({ rows: [] }); // no active session
      // INSERT INTO team_memberships now runs on the withAuditTransaction
      // client, not the plain pool.
      mockDbConnect.mockResolvedValueOnce(
        makeMockClient([{ rows: [] }, { rows: [{ id: "membership-1" }] }]),
      );

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
              is_active: true,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] })
        .mockResolvedValueOnce({ rows: [{ id: "session-abc" }] }); // active session
      mockDbConnect.mockResolvedValueOnce(
        makeMockClient([{ rows: [] }, { rows: [{ id: "membership-1" }] }]),
      );

      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/join/valid-token",
      });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("/session/session-abc");
    });

    // auth-events-audit-log-coverage, design.md Decision D5, tasks 6.3-6.7.
    it("6.3: actor_global_role comes from a SELECT on the plain pool, using session.userId", async () => {
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [{ id: "link-1", team_id: "team-1", expires_at: new Date(Date.now() + 86400000), revoked_at: null, is_active: true }],
        })
        .mockResolvedValueOnce({ rows: [{ global_role: "engineering_manager" }] })
        .mockResolvedValueOnce({ rows: [] });
      const client = makeMockClient([{ rows: [] }, { rows: [{ id: "membership-1" }] }]);
      mockDbConnect.mockResolvedValueOnce(client);

      const app = await buildApp();
      await app.inject({ method: "GET", url: "/api/join/valid-token" });

      // The role SELECT ran on the plain pool, using session.userId.
      const roleSelectCall = mockDbQuery.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("SELECT global_role"),
      );
      expect(roleSelectCall).toBeDefined();
      expect((roleSelectCall as unknown[])[1]).toEqual(["user-1"]);

      // The audit INSERT on the transaction client carries that resolved value.
      const auditInsertCall = client.query.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO audit_log"),
      );
      expect(auditInsertCall).toBeDefined();
      expect((auditInsertCall![1] as unknown[])[1]).toBe("engineering_manager");
    });

    it("6.4: idempotent re-join (ON CONFLICT suppresses the insert) produces no audit row and no structured log", async () => {
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [{ id: "link-1", team_id: "team-1", expires_at: new Date(Date.now() + 86400000), revoked_at: null, is_active: true }],
        })
        .mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] })
        .mockResolvedValueOnce({ rows: [] });
      const client = makeMockClient([{ rows: [] }, { rows: [] }]); // ON CONFLICT DO NOTHING -- no row
      mockDbConnect.mockResolvedValueOnce(client);

      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/api/join/valid-token" });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("/team/team-1?alreadyMember=true");
      expect(mockEmitAuditEvent).not.toHaveBeenCalledWith(
        expect.anything(),
        "join.link_redeemed",
        expect.anything(),
      );
      // No audit_log INSERT was issued at all (the auditInsert closure no-op'd).
      const auditInsertCall = client.query.mock.calls.find(
        (c) => typeof c[0] === "string" && c[0].includes("INSERT INTO audit_log"),
      );
      expect(auditInsertCall).toBeUndefined();
      // The transaction still committed (the membership INSERT's no-op result stands).
      const calls = client.query.mock.calls.map((c) => c[0]);
      expect(calls).toContain("COMMIT");
    });

    it("6.5: a failed audit INSERT rolls back the team_memberships insert, and join.link_redeemed never fires", async () => {
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [{ id: "link-1", team_id: "team-1", expires_at: new Date(Date.now() + 86400000), revoked_at: null, is_active: true }],
        })
        .mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] });
      const failingClient = {
        query: vi.fn((sql: string) => {
          if (typeof sql === "string" && sql.includes("INSERT INTO audit_log")) {
            return Promise.reject(new Error("constraint violation"));
          }
          if (typeof sql === "string" && sql.includes("INSERT INTO team_memberships")) {
            return Promise.resolve({ rows: [{ id: "membership-1" }] });
          }
          return Promise.resolve({ rows: [] });
        }),
        release: vi.fn(),
      };
      mockDbConnect.mockResolvedValueOnce(failingClient);

      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/api/join/valid-token" });

      // 6.6: not sanitized/reclassified -- plain 500, no catch block in this file.
      expect(res.statusCode).toBe(500);
      const calls = failingClient.query.mock.calls.map((c) => c[0]);
      expect(calls).toContain("ROLLBACK");
      expect(calls).not.toContain("COMMIT");
      expect(mockEmitAuditEvent).not.toHaveBeenCalledWith(
        expect.anything(),
        "join.link_redeemed",
        expect.anything(),
      );
    });

    // task 6.7: a failed db.connect() at this call site surfaces as a plain
    // 500, same asymmetry as 6.6/5.5.
    it("6.7: a failed db.connect() surfaces as a plain 500", async () => {
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [{ id: "link-1", team_id: "team-1", expires_at: new Date(Date.now() + 86400000), revoked_at: null, is_active: true }],
        })
        .mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] });
      mockDbConnect.mockRejectedValueOnce(new Error("pool exhausted"));

      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/api/join/valid-token" });

      expect(res.statusCode).toBe(500);
    });
  });
});
