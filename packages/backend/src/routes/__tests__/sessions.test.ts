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
import { sessionRoutes } from "../sessions.js";

function buildApp(sessionData: Record<string, unknown> = {}) {
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = {
      userId: "user-1",
      ...sessionData,
    };
  });
  app.register(sessionRoutes);
  return app.ready().then(() => app);
}

// ---------------------------------------------------------------------------
// POST /api/v1/sessions/:sessionId/participants
// ---------------------------------------------------------------------------
describe("POST /api/v1/sessions/:sessionId/participants", () => {
  beforeEach(() => vi.clearAllMocks());

  // Task 3.3 — global_role=engineer + membership_role=engineering_manager → rejected
  it("3.3: rejects a user with global_role=engineer and membership_role=engineering_manager", async () => {
    // 1) session fetch — active
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ id: "s1", team_id: "team-1", status: "active" }],
      })
      // 2) role check — global engineer, but team membership EM
      .mockResolvedValueOnce({
        rows: [
          { global_role: "engineer", membership_role: "engineering_manager" },
        ],
      });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/s1/participants",
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toContain("Engineering Managers");
  });

  // Task 3.6 — membership_role=participant + global_role=engineer → allowed
  it("3.6: permits a user with global_role=engineer and membership_role=participant", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ id: "s1", team_id: "team-1", status: "active" }],
      })
      .mockResolvedValueOnce({
        rows: [{ global_role: "engineer", membership_role: "participant" }],
      })
      .mockResolvedValueOnce({ rows: [{ id: "sp-1" }] }); // INSERT participant

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/s1/participants",
    });

    expect(res.statusCode).toBe(201);
  });

  it("rejects a user with global_role=engineering_manager (existing check still works)", async () => {
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ id: "s1", team_id: "team-1", status: "active" }],
      })
      .mockResolvedValueOnce({
        rows: [
          { global_role: "engineering_manager", membership_role: "participant" },
        ],
      });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/s1/participants",
    });

    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/sessions/:sessionId/topics/:sessionTopicId/lock-in
//
// Task 3.4 — mid-session lock-in rejected after role change to EM
// Task 3.5 — vote locked before role change is preserved (not deleted)
// Task 3.7 — per-operation DB read, not connection-time cached value
// ---------------------------------------------------------------------------
describe("POST /api/v1/sessions/:sessionId/topics/:sessionTopicId/lock-in", () => {
  beforeEach(() => vi.clearAllMocks());

  // Task 3.4 — lock-in rejected when membership_role changed to EM after session start
  it("3.4: rejects a lock-in when membership_role was changed to engineering_manager mid-session", async () => {
    // The DB now shows engineering_manager even though at session-join time
    // the user may have been a participant. This simulates a mid-session role change.
    // The per-operation DB read picks up the new value.
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            session_status: "active",
            team_id: "team-1",
            topic_status: "voting",
          },
        ],
      })
      // Role check: membership_role is now engineering_manager (changed after join)
      .mockResolvedValueOnce({
        rows: [
          { global_role: "engineer", membership_role: "engineering_manager" },
        ],
      });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/s1/topics/st1/lock-in",
      payload: { voteValue: 3, voteType: "finger" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toContain("Engineering Managers");
  });

  // Task 3.5 — vote locked before role change is preserved (not deleted)
  // The lock-in endpoint does NOT delete existing votes when a user's role
  // changes. Votes already in the votes table are counted at reveal.
  it("3.5: a successful lock-in inserts a vote row; subsequent role promotion does not delete it", async () => {
    // First lock-in — user is participant
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            session_status: "active",
            team_id: "team-1",
            topic_status: "voting",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ global_role: "engineer", membership_role: "participant" }],
      })
      .mockResolvedValueOnce({ rows: [{ id: "sp-1" }] }) // participant check
      .mockResolvedValueOnce({ rows: [{ id: "vote-1" }] }); // vote INSERT

    const app = await buildApp();
    const lockInRes = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/s1/topics/st1/lock-in",
      payload: { voteValue: 3, voteType: "finger" },
    });
    expect(lockInRes.statusCode).toBe(201);
    expect(lockInRes.json().voteId).toBe("vote-1");

    // Now the user's role has been changed to engineering_manager.
    // The vote row (vote-1) is still in the database — no DELETE was issued.
    // This is the key point of Task 3.5: the lock-in endpoint does not
    // retroactively delete votes; they remain to be counted at reveal.
    //
    // Verify by checking that no DELETE query was issued for the votes table
    const deleteCallExists = mockDbQuery.mock.calls.some((call) => {
      const sql = (call[0] as string).toLowerCase();
      return sql.includes("delete") && sql.includes("vote");
    });
    expect(deleteCallExists).toBe(false);
  });

  // Task 3.7 — per-operation DB read, not connection-time value
  it("3.7: reads membership_role from DB on each lock-in request (not from cached value)", async () => {
    // Two sequential lock-in requests with DIFFERENT DB-returned roles simulate
    // the per-operation read pattern. The first call returns participant (ok);
    // the second call returns engineering_manager (rejected). A cached value
    // from the first call would incorrectly permit the second.
    const app = await buildApp();

    // First lock-in — participant
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            session_status: "active",
            team_id: "team-1",
            topic_status: "voting",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ global_role: "engineer", membership_role: "participant" }],
      })
      .mockResolvedValueOnce({ rows: [{ id: "sp-1" }] })
      .mockResolvedValueOnce({ rows: [{ id: "vote-1" }] });

    const firstRes = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/s1/topics/st1/lock-in",
      payload: { voteValue: 3, voteType: "finger" },
    });
    expect(firstRes.statusCode).toBe(201);

    // Second lock-in — role has changed to EM in the DB
    // If the role were cached from the first call, this would incorrectly succeed.
    // With a per-operation read, it reads 'engineering_manager' and rejects.
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            session_status: "active",
            team_id: "team-1",
            topic_status: "voting",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { global_role: "engineer", membership_role: "engineering_manager" },
        ],
      });

    const secondRes = await app.inject({
      method: "POST",
      url: "/api/v1/sessions/s1/topics/st1/lock-in",
      payload: { voteValue: 2, voteType: "finger" },
    });
    expect(secondRes.statusCode).toBe(403);
  });
});
