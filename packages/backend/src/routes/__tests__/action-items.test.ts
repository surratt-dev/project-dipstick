import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks (matching facilitator-sessions.test.ts's established pattern)
// ---------------------------------------------------------------------------
const mockDbQuery = vi.fn();
const mockDbConnect = vi.fn();
const mockEvaluateTeamAccess = vi.fn();
const mockApplyTimingFloor = vi.fn().mockResolvedValue(undefined);
const mockEmitAuditEvent = vi.fn();
const mockPublishActionItemStatusUpdated = vi.fn().mockResolvedValue(undefined);

vi.mock("../../db.js", () => ({
  db: {
    query: (...args: unknown[]) => mockDbQuery(...args),
    connect: () => mockDbConnect(),
  },
}));
vi.mock("../../auth/team-content-access-helper.js", () => ({
  evaluateTeamAccess: (...args: unknown[]) => mockEvaluateTeamAccess(...args),
}));
vi.mock("../../content/timing-oracle.js", () => ({
  applyTimingFloor: (...args: unknown[]) => mockApplyTimingFloor(...args),
}));
vi.mock("../../auth/audit-logger.js", () => ({
  emitAuditEvent: (...args: unknown[]) => mockEmitAuditEvent(...args),
}));
vi.mock("../../realtime/ws-pubsub.js", () => ({
  publishActionItemStatusUpdated: (...args: unknown[]) => mockPublishActionItemStatusUpdated(...args),
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
import { actionItemRoutes } from "../action-items.js";

const ITEM_ID = "item-1";
const TEAM_ID = "team-1";
const OWNER_ID = "owner-1";

function buildApp(userId = OWNER_ID) {
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
  });
  app.register(actionItemRoutes);
  return app.ready().then(() => app);
}

/** Matches facilitator-sessions.test.ts's makeMockClient pattern: an ordered
 * queue of responses (or Errors, to simulate a forced failure mid-transaction). */
function makeMockClient(responses: Array<{ rows: unknown[] } | Error> = []) {
  let callIndex = 0;
  const mockClientQuery = vi.fn((..._args: unknown[]) => {
    const resp = responses[callIndex] ?? { rows: [] };
    callIndex++;
    if (resp instanceof Error) return Promise.reject(resp);
    return Promise.resolve(resp);
  });
  return { query: mockClientQuery, release: vi.fn() };
}

function itemRow(overrides: Partial<{ id: string; team_id: string; owner_id: string; status: string }> = {}) {
  return {
    rows: [{ id: ITEM_ID, team_id: TEAM_ID, owner_id: OWNER_ID, status: "open", ...overrides }],
  };
}

describe("PATCH /api/v1/action-items/:actionItemId/status", () => {
  beforeEach(() => vi.clearAllMocks());

  // -------------------------------------------------------------------------
  // 6.1 — owner success, facilitator success, non-owner/non-facilitator 403,
  // backward-transition rejection, already-Resolved rejection, same-status
  // no-op, response body shape.
  // -------------------------------------------------------------------------
  describe("6.1 — core PATCH behavior", () => {
    it("owner success: transitions open -> in_progress, writes history + audit_log, response matches VOTE-002 shape", async () => {
      mockDbQuery
        .mockResolvedValueOnce(itemRow({ status: "open" })) // 3.1a item lookup
        .mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] }); // actor global_role

      const client = makeMockClient([
        { rows: [] }, // BEGIN
        { rows: [{ updated_at: new Date("2026-09-11T00:00:00Z") }] }, // UPDATE action_items
        { rows: [] }, // INSERT action_item_history
        { rows: [] }, // INSERT audit_log
        { rows: [] }, // COMMIT
      ]);
      mockDbConnect.mockResolvedValueOnce(client);

      const app = await buildApp(OWNER_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "in_progress" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        actionItemId: ITEM_ID,
        status: "in_progress",
        resolutionNote: null,
        resolvedInSessionId: null,
        updatedAt: "2026-09-11T00:00:00.000Z",
      });

      const historyCall = client.query.mock.calls.find((c) => String(c[0]).includes("action_item_history"));
      expect(historyCall?.[1]).toEqual([ITEM_ID, OWNER_ID, "open", "in_progress", null, null]);

      const auditCall = client.query.mock.calls.find((c) => String(c[0]).includes("audit_log"));
      expect(auditCall?.[1]).toEqual([
        OWNER_ID,
        "engineer",
        "127.0.0.1",
        "action_item.status_changed",
        TEAM_ID,
        JSON.stringify({
          action_item_id: ITEM_ID,
          previous_status: "open",
          new_status: "in_progress",
          authorization_path: "owner",
          session_id: null,
        }),
      ]);
      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        "action_item.status_changed",
        expect.objectContaining({ authorizationPath: "owner" }),
      );
      // No sessionId supplied — no broadcast.
      expect(mockPublishActionItemStatusUpdated).not.toHaveBeenCalled();
    });

    it("facilitator success: an authorized facilitator (narrow window) can transition an item they do not own", async () => {
      mockDbQuery
        .mockResolvedValueOnce(itemRow({ owner_id: "other-user", status: "open" })) // item lookup
        .mockResolvedValueOnce({ rows: [{ exists: true }] }) // 3.3 facilitator narrow-window check
        .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] }); // actor global_role
      mockEvaluateTeamAccess.mockResolvedValueOnce({
        path: "facilitator",
        sessionId: "s1",
        teamId: TEAM_ID,
        sessionStatus: "active",
        actorGlobalRole: "facilitator",
      });

      const client = makeMockClient([
        { rows: [] },
        { rows: [{ updated_at: new Date("2026-09-11T00:00:00Z") }] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      ]);
      mockDbConnect.mockResolvedValueOnce(client);

      const app = await buildApp("facilitator-1");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "in_progress" },
      });

      expect(res.statusCode).toBe(200);
      const historyCall = client.query.mock.calls.find((c) => String(c[0]).includes("action_item_history"));
      expect(historyCall?.[1]).toEqual([ITEM_ID, "facilitator-1", "open", "in_progress", null, null]);
    });

    it("non-owner, non-facilitator (but a plain team member) is rejected with 403", async () => {
      mockDbQuery
        .mockResolvedValueOnce(itemRow({ owner_id: "other-user" }))
        .mockResolvedValueOnce({ rows: [{ exists: false }] }); // 3.3 facilitator check fails
      mockEvaluateTeamAccess.mockResolvedValueOnce({
        path: "member",
        role: "participant",
        teamId: TEAM_ID,
        actorGlobalRole: "engineer",
      });

      const app = await buildApp("member-1");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "in_progress" },
      });

      expect(res.statusCode).toBe(403);
      expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
      expect(mockDbConnect).not.toHaveBeenCalled();
    });

    it("backward transition (in_progress -> open) is rejected with 409", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "in_progress" }));

      const app = await buildApp(OWNER_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "open" },
      });

      expect(res.statusCode).toBe(409);
      expect(mockDbConnect).not.toHaveBeenCalled();
    });

    it("any PATCH targeting an already-Resolved item is rejected with 409, even status: 'resolved'", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "resolved" }));

      const app = await buildApp(OWNER_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "resolved" },
      });

      expect(res.statusCode).toBe(409);
      expect(mockDbConnect).not.toHaveBeenCalled();
    });

    it("same-status no-op: bumps updated_at only, no history/audit/broadcast", async () => {
      mockDbQuery
        .mockResolvedValueOnce(itemRow({ status: "open" }))
        .mockResolvedValueOnce({
          rows: [{ status: "open", resolution_note: null, resolved_in_session_id: null, updated_at: new Date("2026-09-11T00:00:00Z") }],
        });

      const app = await buildApp(OWNER_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "open" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        actionItemId: ITEM_ID,
        status: "open",
        resolutionNote: null,
        resolvedInSessionId: null,
        updatedAt: "2026-09-11T00:00:00.000Z",
      });
      expect(mockDbConnect).not.toHaveBeenCalled();
      expect(mockEmitAuditEvent).not.toHaveBeenCalled();
      expect(mockPublishActionItemStatusUpdated).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 6.1a-i / 6.1a-ii — facilitator grace-window regression (Decision D10)
  // -------------------------------------------------------------------------
  describe("6.1a-i / 6.1a-ii — D10 regression: grace-window facilitator is rejected", () => {
    it("6.1a-i: a facilitator whose only relationship is a draft-grace session is rejected with 403", async () => {
      mockDbQuery
        .mockResolvedValueOnce(itemRow({ owner_id: "other-user" }))
        .mockResolvedValueOnce({ rows: [{ exists: false }] }); // narrow-window check: draft not in the set
      mockEvaluateTeamAccess.mockResolvedValueOnce({
        path: "facilitator",
        sessionId: "s-draft",
        teamId: TEAM_ID,
        sessionStatus: "draft",
        actorGlobalRole: "facilitator",
      });

      const app = await buildApp("facilitator-draft");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "in_progress" },
      });

      expect(res.statusCode).toBe(403);
    });

    it("6.1a-ii: a facilitator whose only relationship is a complete-grace session is rejected with 403", async () => {
      mockDbQuery
        .mockResolvedValueOnce(itemRow({ owner_id: "other-user" }))
        .mockResolvedValueOnce({ rows: [{ exists: false }] }); // narrow-window check: complete not in the set
      mockEvaluateTeamAccess.mockResolvedValueOnce({
        path: "facilitator",
        sessionId: "s-complete",
        teamId: TEAM_ID,
        sessionStatus: "complete",
        actorGlobalRole: "facilitator",
      });

      const app = await buildApp("facilitator-complete");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "in_progress" },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // 6.1b — anti-enumeration (Decision D12)
  // -------------------------------------------------------------------------
  describe("6.1b — anti-enumeration (D12)", () => {
    it("(a) a nonexistent actionItemId returns 404", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const app = await buildApp(OWNER_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "in_progress" },
      });

      expect(res.statusCode).toBe(404);
      expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
    });

    it("(b) an existing item whose team the caller has zero relationship to returns 404, indistinguishable from (a)", async () => {
      mockDbQuery
        .mockResolvedValueOnce(itemRow({ owner_id: "other-user" }))
        .mockResolvedValueOnce({ rows: [{ exists: false }] }); // everFacilitated: false
      mockEvaluateTeamAccess.mockResolvedValueOnce(null); // zero relationship

      const nonexistentApp = await buildApp("stranger-1");
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const nonexistentRes = await nonexistentApp.inject({
        method: "PATCH",
        url: `/api/v1/action-items/nonexistent-id/status`,
        payload: { status: "in_progress" },
      });

      const zeroRelationshipApp = await buildApp("stranger-1");
      const zeroRelationshipRes = await zeroRelationshipApp.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "in_progress" },
      });

      expect(zeroRelationshipRes.statusCode).toBe(404);
      expect(nonexistentRes.statusCode).toBe(404);
      // Same shape and message — indistinguishable except for the per-request
      // correlationId, which is expected to differ on every response.
      const stripCorrelationId = (body: { error: { category: unknown; message: unknown } }) => ({
        category: body.error.category,
        message: body.error.message,
      });
      expect(stripCorrelationId(zeroRelationshipRes.json())).toEqual(stripCorrelationId(nonexistentRes.json()));
      expect(mockApplyTimingFloor).toHaveBeenCalledTimes(2);
    });

    it("(c) a plain team member (not owner, not facilitator) returns 403, not 404", async () => {
      mockDbQuery
        .mockResolvedValueOnce(itemRow({ owner_id: "other-user" }))
        .mockResolvedValueOnce({ rows: [{ exists: false }] });
      mockEvaluateTeamAccess.mockResolvedValueOnce({
        path: "member",
        role: "participant",
        teamId: TEAM_ID,
        actorGlobalRole: "engineer",
      });

      const app = await buildApp("member-1");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "in_progress" },
      });

      expect(res.statusCode).toBe(403);
    });

    it("(d) the timing floor is applied on both the nonexistent-item and zero-relationship denial branches", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const app1 = await buildApp("stranger-1");
      await app1.inject({
        method: "PATCH",
        url: `/api/v1/action-items/nonexistent-id/status`,
        payload: { status: "in_progress" },
      });
      expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);

      mockDbQuery
        .mockResolvedValueOnce(itemRow({ owner_id: "other-user" }))
        .mockResolvedValueOnce({ rows: [{ exists: false }] });
      mockEvaluateTeamAccess.mockResolvedValueOnce(null);
      const app2 = await buildApp("stranger-2");
      await app2.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "in_progress" },
      });
      expect(mockApplyTimingFloor).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // 6.1c (moved from 3.8) — no Application Administrator bypass
  // -------------------------------------------------------------------------
  describe("6.1c — Application Administrator bypass is absent", () => {
    it("an Application Admin (some relationship via evaluateTeamAccess's admin grant, but not owner/facilitator) is rejected with 403", async () => {
      mockDbQuery
        .mockResolvedValueOnce(itemRow({ owner_id: "other-user" }))
        .mockResolvedValueOnce({ rows: [{ exists: false }] }); // not a facilitator either
      mockEvaluateTeamAccess.mockResolvedValueOnce({ path: "admin", actorGlobalRole: "application_admin" });

      const app = await buildApp("admin-1");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "in_progress" },
      });

      expect(res.statusCode).toBe(403);
      expect(mockDbConnect).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 6.1d — D7/D11 boundary: owner path never requires session context
  // -------------------------------------------------------------------------
  describe("6.1d — owner PATCH with no sessionId", () => {
    it("succeeds normally (200), with no broadcast published and no 422", async () => {
      mockDbQuery
        .mockResolvedValueOnce(itemRow({ status: "open" }))
        .mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] });
      const client = makeMockClient([
        { rows: [] },
        { rows: [{ updated_at: new Date("2026-09-11T00:00:00Z") }] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      ]);
      mockDbConnect.mockResolvedValueOnce(client);

      const app = await buildApp(OWNER_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "in_progress" },
      });

      expect(res.statusCode).toBe(200);
      expect(mockPublishActionItemStatusUpdated).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 6.2 — action_item_history / action_items.status atomicity
  // -------------------------------------------------------------------------
  describe("6.2 — status update and history row are atomic", () => {
    it("rolls back and commits neither write when the history insert fails", async () => {
      mockDbQuery
        .mockResolvedValueOnce(itemRow({ status: "open" }))
        .mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] });

      const client = makeMockClient([
        { rows: [] }, // BEGIN
        { rows: [{ updated_at: new Date() }] }, // UPDATE action_items succeeds
        new Error("simulated failure before action_item_history commits"), // INSERT history fails
      ]);
      mockDbConnect.mockResolvedValueOnce(client);

      const app = await buildApp(OWNER_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "in_progress" },
      });

      expect(res.statusCode).toBe(500);
      expect(client.query.mock.calls.some((c) => c[0] === "ROLLBACK")).toBe(true);
      expect(client.query.mock.calls.some((c) => c[0] === "COMMIT")).toBe(false);
      expect(mockEmitAuditEvent).not.toHaveBeenCalled();
      expect(mockPublishActionItemStatusUpdated).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 6.2a — audit_log write (Decision D13)
  // -------------------------------------------------------------------------
  describe("6.2a — audit_log row (D13)", () => {
    it("writes an audit_log row in the same transaction, with correct metadata", async () => {
      mockDbQuery
        .mockResolvedValueOnce(itemRow({ status: "open" }))
        .mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] });
      const client = makeMockClient([
        { rows: [] },
        { rows: [{ updated_at: new Date("2026-09-11T00:00:00Z") }] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      ]);
      mockDbConnect.mockResolvedValueOnce(client);

      const app = await buildApp(OWNER_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "in_progress" },
      });

      expect(res.statusCode).toBe(200);
      const auditCall = client.query.mock.calls.find((c) => String(c[0]).includes("audit_log"));
      expect(auditCall).toBeDefined();
      const params = (auditCall as unknown[])[1] as unknown[];
      expect(params[0]).toBe(OWNER_ID); // actor_user_id
      expect(params[1]).toBe("engineer"); // actor_global_role
      expect(params[3]).toBe("action_item.status_changed"); // operation
      expect(params[4]).toBe(TEAM_ID); // team_id
      const metadata = JSON.parse(params[5] as string) as {
        action_item_id: string;
        previous_status: string;
        new_status: string;
        authorization_path: string;
        session_id: string | null;
      };
      expect(metadata).toEqual({
        action_item_id: ITEM_ID,
        previous_status: "open",
        new_status: "in_progress",
        authorization_path: "owner",
        session_id: null,
      });
    });

    it("rolls back the audit_log write too when the mutation fails", async () => {
      mockDbQuery
        .mockResolvedValueOnce(itemRow({ status: "open" }))
        .mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] });
      const client = makeMockClient([
        { rows: [] },
        { rows: [{ updated_at: new Date() }] },
        { rows: [] }, // history insert succeeds
        new Error("simulated failure before audit_log commits"), // audit_log insert fails
      ]);
      mockDbConnect.mockResolvedValueOnce(client);

      const app = await buildApp(OWNER_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "in_progress" },
      });

      expect(res.statusCode).toBe(500);
      expect(client.query.mock.calls.some((c) => c[0] === "ROLLBACK")).toBe(true);
      expect(client.query.mock.calls.some((c) => c[0] === "COMMIT")).toBe(false);
    });

    it("writes no audit_log row for a same-status no-op", async () => {
      mockDbQuery
        .mockResolvedValueOnce(itemRow({ status: "open" }))
        .mockResolvedValueOnce({
          rows: [{ status: "open", resolution_note: null, resolved_in_session_id: null, updated_at: new Date() }],
        });

      const app = await buildApp(OWNER_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "open" },
      });

      expect(res.statusCode).toBe(200);
      expect(mockDbConnect).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 6.2b — D7 resilience: a broadcast failure never affects the PATCH
  // -------------------------------------------------------------------------
  describe("6.2b — Redis publish failure does not affect the already-committed PATCH (D7)", () => {
    it("still returns 200 when publishActionItemStatusUpdated rejects, post-commit", async () => {
      mockDbQuery
        .mockResolvedValueOnce(itemRow({ status: "open" }))
        .mockResolvedValueOnce({ rows: [{ status: "pre_session" }] }) // sessionId validation
        .mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] });
      const client = makeMockClient([
        { rows: [] },
        { rows: [{ updated_at: new Date("2026-09-11T00:00:00Z") }] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      ]);
      mockDbConnect.mockResolvedValueOnce(client);
      mockPublishActionItemStatusUpdated.mockRejectedValueOnce(new Error("simulated Redis publish failure"));

      const app = await buildApp(OWNER_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "in_progress", sessionId: "s1" },
      });

      // The transaction already committed (COMMIT is in the client's query
      // log) before the publish call even runs — a rejected publish must not
      // downgrade this to anything other than 200.
      expect(res.statusCode).toBe(200);
      expect(client.query.mock.calls.some((c) => c[0] === "COMMIT")).toBe(true);
      expect(mockPublishActionItemStatusUpdated).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // 6.3 — resolutionNote / resolved_in_session_id (Decision D9, D5)
  // -------------------------------------------------------------------------
  describe("6.3 — resolutionNote / resolved_in_session_id (D9)", () => {
    it("a valid note on a resolving transition is persisted to BOTH action_items.resolution_note and action_item_history.resolution_note", async () => {
      mockDbQuery
        .mockResolvedValueOnce(itemRow({ status: "in_progress" }))
        .mockResolvedValueOnce({ rows: [{ status: "pre_session" }] }) // sessionId validation
        .mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] });
      const client = makeMockClient([
        { rows: [] },
        { rows: [{ updated_at: new Date("2026-09-11T00:00:00Z") }] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      ]);
      mockDbConnect.mockResolvedValueOnce(client);

      const app = await buildApp(OWNER_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "resolved", resolutionNote: "Fixed in PR #123", sessionId: "s1" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ resolutionNote: "Fixed in PR #123", resolvedInSessionId: "s1" });

      // action_items.resolution_note — the SAME column content.ts:433-440 and
      // em-views.ts:800-907 read directly (Marcus Delgado's blocking Finding 2).
      const updateCall = client.query.mock.calls.find(
        (c) => String(c[0]).includes("UPDATE action_items") && String(c[0]).includes("resolution_note"),
      );
      expect(updateCall).toBeDefined();
      expect((updateCall as unknown[])[1]).toEqual(["resolved", "Fixed in PR #123", "s1", ITEM_ID]);

      const historyCall = client.query.mock.calls.find((c) => String(c[0]).includes("action_item_history"));
      expect((historyCall as unknown[])[1]).toEqual([
        ITEM_ID,
        OWNER_ID,
        "in_progress",
        "resolved",
        "Fixed in PR #123",
        "s1",
      ]);
    });

    it("an over-length resolutionNote is rejected with 422, and nothing is written", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "in_progress" }));

      const app = await buildApp(OWNER_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "resolved", resolutionNote: "x".repeat(501) },
      });

      expect(res.statusCode).toBe(422);
      expect(mockDbConnect).not.toHaveBeenCalled();
    });

    it("an omitted note on a resolving transition leaves resolution_note NULL in both places", async () => {
      mockDbQuery
        .mockResolvedValueOnce(itemRow({ status: "in_progress" }))
        .mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] });
      const client = makeMockClient([
        { rows: [] },
        { rows: [{ updated_at: new Date() }] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      ]);
      mockDbConnect.mockResolvedValueOnce(client);

      const app = await buildApp(OWNER_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "resolved" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ resolutionNote: null, resolvedInSessionId: null });
      const updateCall = client.query.mock.calls.find((c) => String(c[0]).includes("UPDATE action_items"));
      expect((updateCall as unknown[])[1]).toEqual(["resolved", null, null, ITEM_ID]);
    });

    it("a note supplied on a non-resolving transition is silently dropped, not persisted, not rejected even if over-length", async () => {
      mockDbQuery
        .mockResolvedValueOnce(itemRow({ status: "open" }))
        .mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] });
      const client = makeMockClient([
        { rows: [] },
        { rows: [{ updated_at: new Date() }] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      ]);
      mockDbConnect.mockResolvedValueOnce(client);

      const app = await buildApp(OWNER_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "in_progress", resolutionNote: "x".repeat(600) },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ resolutionNote: null });
      const updateCall = client.query.mock.calls.find((c) => String(c[0]).includes("UPDATE action_items"));
      expect((updateCall as unknown[])[1]).toEqual(["in_progress", null, null, ITEM_ID]);
    });

    it("resolved_in_session_id is set only on resolution with a sessionId supplied — not on a non-resolving transition with sessionId supplied", async () => {
      mockDbQuery
        .mockResolvedValueOnce(itemRow({ status: "open" }))
        .mockResolvedValueOnce({ rows: [{ status: "pre_session" }] }) // sessionId validation
        .mockResolvedValueOnce({ rows: [{ global_role: "engineer" }] });
      const client = makeMockClient([
        { rows: [] },
        { rows: [{ updated_at: new Date() }] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      ]);
      mockDbConnect.mockResolvedValueOnce(client);

      const app = await buildApp(OWNER_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "in_progress", sessionId: "s1" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ resolvedInSessionId: null });
      // session_id IS still recorded on action_item_history (distinct from resolved_in_session_id).
      const historyCall = client.query.mock.calls.find((c) => String(c[0]).includes("action_item_history"));
      expect((historyCall as unknown[])[1]).toEqual([ITEM_ID, OWNER_ID, "open", "in_progress", null, "s1"]);
    });

    it("an invalid sessionId (not active for this team) is rejected with 422", async () => {
      mockDbQuery
        .mockResolvedValueOnce(itemRow({ status: "open" }))
        .mockResolvedValueOnce({ rows: [{ status: "complete" }] }); // not in the active set

      const app = await buildApp(OWNER_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/status`,
        payload: { status: "in_progress", sessionId: "s-stale" },
      });

      expect(res.statusCode).toBe(422);
      expect(mockDbConnect).not.toHaveBeenCalled();
    });
  });
});
