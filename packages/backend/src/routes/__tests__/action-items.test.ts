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
const NEW_OWNER_ID = "new-owner-1";
const FACILITATOR_ID = "facilitator-1";
const SESSION_ID = "session-1";

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
 * queue of responses (or Errors, to simulate a forced failure mid-transaction).
 * rowCount is optional (default treated as non-zero by callers that only
 * check `=== 0`), matching facilitator-sessions.test.ts's own convention for
 * asserting a conditional-UPDATE guard's zero-rowCount branch. */
function makeMockClient(responses: Array<{ rows: unknown[]; rowCount?: number } | Error> = []) {
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

// ---------------------------------------------------------------------------
// PATCH /api/v1/action-items/:actionItemId/owner test helpers
// (reassign-action-item-owner, VOTE-004, GitHub issue #108)
// ---------------------------------------------------------------------------

/** Queues mockDbQuery responses in the exact order the owner-reassignment
 * handler issues them: 2.2 item lookup (via itemRow, called by the test
 * itself before this helper), 2.4 sessionId validation, 2.5 facilitator
 * authorization, 2.7(b) new-owner existence, 2.7(c)/(d) membership, and the
 * actorResult global_role lookup. Passing `null` for a lookup queues an
 * empty-rows response and stops queuing further steps, since the handler
 * short-circuits at that point. */
/** ACTIVELY_FACILITATING_STATUSES, duplicated here rather than imported —
 * this file mocks db.js/team-content-access-helper.js entirely and has no
 * access to action-items.ts's file-local constant; keeping this list in
 * sync with it is the same trade-off action-items.ts's own file-local
 * constant already accepts (design.md D1). */
const ACTIVELY_FACILITATING_STATUSES_FOR_TESTS = ["lobby", "pre_session", "active", "wrap_up"];

function queueOwnerHandlerQueries(opts: {
  sessionStatus?: string | null;
  facilitatorAuthorized?: boolean;
  /** When true, queues only through the facilitator-authorization query and
   * stops there — mirroring a resolved-item request, where the handler
   * returns 409 immediately after authorization succeeds and never reaches
   * the new-owner cascade at all. Queuing further mocks in that case would
   * leave them unconsumed and leak into the next test, since
   * vi.clearAllMocks() clears call history but not queued
   * mockResolvedValueOnce values (mockReset, not mockClear, does that). */
  itemResolved?: boolean;
  newOwner?: { id: string; display_name: string } | null;
  membership?: { role: string; removed_at: Date | null } | null;
  actorGlobalRole?: string;
} = {}) {
  const {
    sessionStatus = "active",
    facilitatorAuthorized = true,
    itemResolved = false,
    newOwner = { id: NEW_OWNER_ID, display_name: "New Owner" },
    membership = { role: "participant", removed_at: null },
    actorGlobalRole = "facilitator",
  } = opts;

  // 2.3 relationship — evaluateTeamAccess grants directly.
  mockEvaluateTeamAccess.mockResolvedValueOnce({
    path: "facilitator",
    sessionId: SESSION_ID,
    teamId: TEAM_ID,
    sessionStatus: "active",
    actorGlobalRole: "facilitator",
  });

  // 2.4 sessionId validation
  const sessionValid = sessionStatus !== null && ACTIVELY_FACILITATING_STATUSES_FOR_TESTS.includes(sessionStatus);
  mockDbQuery.mockResolvedValueOnce(sessionStatus === null ? { rows: [] } : { rows: [{ status: sessionStatus }] });
  if (!sessionValid) return;

  // 2.5 facilitator authorization
  mockDbQuery.mockResolvedValueOnce({ rows: [{ exists: facilitatorAuthorized }] });
  if (!facilitatorAuthorized) return;

  // 2.6 resolved-item precondition — runs before the new-owner cascade and
  // requires no additional query (item.status was already loaded at 2.2).
  if (itemResolved) return;

  // 2.7(b) new-owner existence
  mockDbQuery.mockResolvedValueOnce(newOwner === null ? { rows: [] } : { rows: [newOwner] });
  if (newOwner === null) return;

  // 2.7(c)/(d) membership
  mockDbQuery.mockResolvedValueOnce(membership === null ? { rows: [] } : { rows: [membership] });
  if (membership === null) return;
  const membershipValid = membership.role === "participant" && membership.removed_at === null;
  if (!membershipValid) return;

  // actorResult
  mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: actorGlobalRole }] });
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

// ---------------------------------------------------------------------------
// PATCH /api/v1/action-items/:actionItemId/owner
// (reassign-action-item-owner, VOTE-004, GitHub issue #108). See tasks.md
// group 4 for the task each describe block below implements.
// ---------------------------------------------------------------------------
describe("PATCH /api/v1/action-items/:actionItemId/owner", () => {
  beforeEach(() => vi.clearAllMocks());

  const PATCH_PAYLOAD = { newOwnerUserId: NEW_OWNER_ID, sessionId: SESSION_ID };

  // -------------------------------------------------------------------------
  // 4.1 — authorization tests
  // -------------------------------------------------------------------------
  describe("4.1 — authorization", () => {
    it("an authorized active facilitator can reassign", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "open" }));
      queueOwnerHandlerQueries();

      const client = makeMockClient([
        { rows: [] }, // BEGIN
        { rows: [{ updated_at: new Date("2026-09-29T00:00:00Z") }], rowCount: 1 }, // UPDATE action_items
        { rows: [] }, // INSERT action_item_history
        { rows: [] }, // INSERT audit_log
        { rows: [] }, // COMMIT
      ]);
      mockDbConnect.mockResolvedValueOnce(client);

      const app = await buildApp(FACILITATOR_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: PATCH_PAYLOAD,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        actionItemId: ITEM_ID,
        ownerUserId: NEW_OWNER_ID,
        ownerDisplayName: "New Owner",
        updatedAt: "2026-09-29T00:00:00.000Z",
      });
    });

    it("a facilitator whose only session for the team is in a draft-grace window (not narrowly active) is rejected 403", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "open" }));
      queueOwnerHandlerQueries({ facilitatorAuthorized: false });

      const app = await buildApp(FACILITATOR_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: PATCH_PAYLOAD,
      });

      expect(res.statusCode).toBe(403);
      expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
      expect(mockDbConnect).not.toHaveBeenCalled();
    });

    it("a plain team member with no facilitator relationship is rejected 403", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "open" }));
      mockEvaluateTeamAccess.mockResolvedValueOnce({
        path: "member",
        role: "participant",
        teamId: TEAM_ID,
        actorGlobalRole: "engineer",
      });
      mockDbQuery.mockResolvedValueOnce({ rows: [{ status: "active" }] }); // sessionId validation
      mockDbQuery.mockResolvedValueOnce({ rows: [{ exists: false }] }); // not an authorized facilitator

      const app = await buildApp("member-1");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: PATCH_PAYLOAD,
      });

      expect(res.statusCode).toBe(403);
      expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // 4.2 — anti-enumeration (Decision D2)
  // -------------------------------------------------------------------------
  describe("4.2 — anti-enumeration", () => {
    it("(a) a nonexistent actionItemId returns 404", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });

      const app = await buildApp(FACILITATOR_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/nonexistent-id/owner`,
        payload: PATCH_PAYLOAD,
      });

      expect(res.statusCode).toBe(404);
      expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
    });

    it("(b) an existing item whose team the caller has zero relationship to returns 404, indistinguishable from (a)", async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const nonexistentApp = await buildApp("stranger-1");
      const nonexistentRes = await nonexistentApp.inject({
        method: "PATCH",
        url: `/api/v1/action-items/nonexistent-id/owner`,
        payload: PATCH_PAYLOAD,
      });

      mockDbQuery
        .mockResolvedValueOnce(itemRow({ status: "open" }))
        .mockResolvedValueOnce({ rows: [{ exists: false }] }); // everFacilitated: false
      mockEvaluateTeamAccess.mockResolvedValueOnce(null); // zero relationship

      const zeroRelationshipApp = await buildApp("stranger-1");
      const zeroRelationshipRes = await zeroRelationshipApp.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: PATCH_PAYLOAD,
      });

      expect(nonexistentRes.statusCode).toBe(404);
      expect(zeroRelationshipRes.statusCode).toBe(404);
      const stripCorrelationId = (body: { error: { category: unknown; message: unknown } }) => ({
        category: body.error.category,
        message: body.error.message,
      });
      expect(stripCorrelationId(zeroRelationshipRes.json())).toEqual(stripCorrelationId(nonexistentRes.json()));
      expect(mockApplyTimingFloor).toHaveBeenCalledTimes(2);
    });

    it("(c) a caller with some relationship (member) but no active facilitator authorization returns 403, not 404", async () => {
      mockDbQuery
        .mockResolvedValueOnce(itemRow({ status: "open" }))
        .mockResolvedValueOnce({ rows: [{ status: "active" }] }) // sessionId validation
        .mockResolvedValueOnce({ rows: [{ exists: false }] }); // not authorized facilitator
      mockEvaluateTeamAccess.mockResolvedValueOnce({
        path: "member",
        role: "participant",
        teamId: TEAM_ID,
        actorGlobalRole: "engineer",
      });

      const app = await buildApp("member-1");
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: PATCH_PAYLOAD,
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // 4.3 — new-owner validation cascade (Decision D5)
  // -------------------------------------------------------------------------
  describe("4.3 — new-owner validation cascade", () => {
    it("a nonexistent new-owner user returns 404", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "open" }));
      queueOwnerHandlerQueries({ newOwner: null });

      const app = await buildApp(FACILITATOR_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: PATCH_PAYLOAD,
      });

      expect(res.statusCode).toBe(404);
      expect(mockDbConnect).not.toHaveBeenCalled();
    });

    it("a new owner with no team_memberships row at all for this team returns 404", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "open" }));
      queueOwnerHandlerQueries({ membership: null });

      const app = await buildApp(FACILITATOR_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: PATCH_PAYLOAD,
      });

      expect(res.statusCode).toBe(404);
      expect(mockDbConnect).not.toHaveBeenCalled();
    });

    it("a soft-removed member (removed_at IS NOT NULL) is rejected 422", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "open" }));
      queueOwnerHandlerQueries({ membership: { role: "participant", removed_at: new Date("2026-01-01T00:00:00Z") } });

      const app = await buildApp(FACILITATOR_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: PATCH_PAYLOAD,
      });

      expect(res.statusCode).toBe(422);
      expect(mockDbConnect).not.toHaveBeenCalled();
    });

    it("an Engineering Manager cannot be reassigned an item (422, no-manager-participation constraint)", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "open" }));
      queueOwnerHandlerQueries({ membership: { role: "engineering_manager", removed_at: null } });

      const app = await buildApp(FACILITATOR_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: PATCH_PAYLOAD,
      });

      expect(res.statusCode).toBe(422);
      expect(mockDbConnect).not.toHaveBeenCalled();
    });

    it("an active participant member is a valid new owner (passes the cascade)", async () => {
      // Covered end-to-end by 4.1's happy-path test; this test pins the
      // cascade's final accept branch down independently by asserting the
      // real-reassignment write actually happens.
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "open" }));
      queueOwnerHandlerQueries();
      const client = makeMockClient([
        { rows: [] },
        { rows: [{ updated_at: new Date() }], rowCount: 1 },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      ]);
      mockDbConnect.mockResolvedValueOnce(client);

      const app = await buildApp(FACILITATOR_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: PATCH_PAYLOAD,
      });

      expect(res.statusCode).toBe(200);
      expect(mockDbConnect).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // 4.4 — self-facilitator reassignment target (independently tested gate)
  // -------------------------------------------------------------------------
  describe("4.4 — new owner is the calling facilitator", () => {
    it("is rejected with 422, independent of that user's own membership state, with no DB round-trip", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "open" }));
      mockEvaluateTeamAccess.mockResolvedValueOnce({
        path: "facilitator",
        sessionId: SESSION_ID,
        teamId: TEAM_ID,
        sessionStatus: "active",
        actorGlobalRole: "facilitator",
      });
      mockDbQuery.mockResolvedValueOnce({ rows: [{ status: "active" }] }); // sessionId validation
      mockDbQuery.mockResolvedValueOnce({ rows: [{ exists: true }] }); // authorized facilitator

      const app = await buildApp(FACILITATOR_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: { newOwnerUserId: FACILITATOR_ID, sessionId: SESSION_ID },
      });

      expect(res.statusCode).toBe(422);
      expect(mockDbConnect).not.toHaveBeenCalled();
      // No existence/membership query issued — the self-check short-circuits
      // before any DB round-trip (Decision D5, step (a)).
      expect(mockDbQuery).toHaveBeenCalledTimes(3);
    });
  });

  // -------------------------------------------------------------------------
  // 4.5 — resolved-item precondition (Decision D3)
  // -------------------------------------------------------------------------
  describe("4.5 — resolved-item precondition", () => {
    it("a reassignment against a resolved item is rejected 409", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "resolved" }));
      queueOwnerHandlerQueries({ itemResolved: true });

      const app = await buildApp(FACILITATOR_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: PATCH_PAYLOAD,
      });

      expect(res.statusCode).toBe(409);
      expect(mockDbConnect).not.toHaveBeenCalled();
    });

    it("a resolved item with an also-invalid new owner is rejected 409 for the resolved reason, not the cascade's 404", async () => {
      // The resolved-item check (2.6) runs before the new-owner cascade
      // (2.7), so the payload's newOwnerUserId here is never even looked
      // up — itemResolved: true reflects that the handler stops at 2.6.
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "resolved" }));
      queueOwnerHandlerQueries({ itemResolved: true });

      const app = await buildApp(FACILITATOR_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: { ...PATCH_PAYLOAD, newOwnerUserId: "nonexistent-user" },
      });

      expect(res.statusCode).toBe(409);
    });

    it("a resolved item with a missing sessionId is rejected 422 for the session reason, not 409 (sessionId validation runs first)", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "resolved" }));
      mockEvaluateTeamAccess.mockResolvedValueOnce({
        path: "facilitator",
        sessionId: SESSION_ID,
        teamId: TEAM_ID,
        sessionStatus: "active",
        actorGlobalRole: "facilitator",
      });

      const app = await buildApp(FACILITATOR_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: { newOwnerUserId: NEW_OWNER_ID },
      });

      expect(res.statusCode).toBe(422);
    });
  });

  // -------------------------------------------------------------------------
  // 4.6 — same-owner no-op (Decision D6, amended per Security review Finding 2)
  // -------------------------------------------------------------------------
  describe("4.6 — same-owner no-op", () => {
    it("returns 200, bumps updated_at, writes no action_item_history row, writes an audit_log row with metadata.no_op = true", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "open", owner_id: NEW_OWNER_ID }));
      queueOwnerHandlerQueries();

      const client = makeMockClient([
        { rows: [] }, // BEGIN
        { rows: [{ updated_at: new Date("2026-09-29T00:00:00Z") }] }, // UPDATE action_items (updated_at only)
        { rows: [] }, // INSERT audit_log
        { rows: [] }, // COMMIT
      ]);
      mockDbConnect.mockResolvedValueOnce(client);

      const app = await buildApp(FACILITATOR_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: { newOwnerUserId: NEW_OWNER_ID, sessionId: SESSION_ID },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        actionItemId: ITEM_ID,
        ownerUserId: NEW_OWNER_ID,
        ownerDisplayName: "New Owner",
        updatedAt: "2026-09-29T00:00:00.000Z",
      });

      const historyCall = client.query.mock.calls.find((c) => String(c[0]).includes("action_item_history"));
      expect(historyCall).toBeUndefined();

      const auditCall = client.query.mock.calls.find((c) => String(c[0]).includes("audit_log"));
      expect(auditCall).toBeDefined();
      const auditParams = (auditCall as unknown[])[1] as unknown[];
      const metadata = JSON.parse(auditParams[5] as string) as unknown;
      expect(metadata).toEqual({
        action_item_id: ITEM_ID,
        previous_owner_id: NEW_OWNER_ID,
        new_owner_id: NEW_OWNER_ID,
        session_id: SESSION_ID,
        no_op: true,
      });
      expect(mockEmitAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        "action_item.owner_reassigned",
        expect.objectContaining({ noOp: true }),
      );
      expect(mockPublishActionItemStatusUpdated).not.toHaveBeenCalled();
    });

    it("a second, repeated no-op call writes its own separate audit_log row, not deduplicated", async () => {
      for (let i = 0; i < 2; i++) {
        mockDbQuery.mockResolvedValueOnce(itemRow({ status: "open", owner_id: NEW_OWNER_ID }));
        queueOwnerHandlerQueries();
        const client = makeMockClient([
          { rows: [] },
          { rows: [{ updated_at: new Date() }] },
          { rows: [] },
          { rows: [] },
        ]);
        mockDbConnect.mockResolvedValueOnce(client);

        const app = await buildApp(FACILITATOR_ID);
        const res = await app.inject({
          method: "PATCH",
          url: `/api/v1/action-items/${ITEM_ID}/owner`,
          payload: { newOwnerUserId: NEW_OWNER_ID, sessionId: SESSION_ID },
        });
        expect(res.statusCode).toBe(200);
      }

      expect(mockDbConnect).toHaveBeenCalledTimes(2);
      expect(mockEmitAuditEvent).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // 4.7 — sessionId validation (Decision D4)
  // -------------------------------------------------------------------------
  describe("4.7 — sessionId validation", () => {
    it("a sessionId referencing a different team's session is rejected 422", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "open" }));
      mockEvaluateTeamAccess.mockResolvedValueOnce({
        path: "facilitator",
        sessionId: SESSION_ID,
        teamId: TEAM_ID,
        sessionStatus: "active",
        actorGlobalRole: "facilitator",
      });
      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // no session row for this team_id + sessionId pair

      const app = await buildApp(FACILITATOR_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: { newOwnerUserId: NEW_OWNER_ID, sessionId: "other-team-session" },
      });

      expect(res.statusCode).toBe(422);
      expect(mockDbConnect).not.toHaveBeenCalled();
    });

    it("a sessionId referencing an inactive-status session is rejected 422", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "open" }));
      queueOwnerHandlerQueries({ sessionStatus: "complete" });

      const app = await buildApp(FACILITATOR_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: PATCH_PAYLOAD,
      });

      expect(res.statusCode).toBe(422);
      expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
      expect(mockDbConnect).not.toHaveBeenCalled();
    });

    it("a missing sessionId is rejected 422, and applyTimingFloor is applied on this branch", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "open" }));
      mockEvaluateTeamAccess.mockResolvedValueOnce({
        path: "facilitator",
        sessionId: SESSION_ID,
        teamId: TEAM_ID,
        sessionStatus: "active",
        actorGlobalRole: "facilitator",
      });

      const app = await buildApp(FACILITATOR_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: { newOwnerUserId: NEW_OWNER_ID },
      });

      expect(res.statusCode).toBe(422);
      expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1);
      expect(mockDbConnect).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 4.8 — atomicity
  // -------------------------------------------------------------------------
  describe("4.8 — owner update and history row are atomic", () => {
    it("rolls back and commits neither write when the history insert fails", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "open" }));
      queueOwnerHandlerQueries();

      const client = makeMockClient([
        { rows: [] }, // BEGIN
        { rows: [{ updated_at: new Date() }], rowCount: 1 }, // UPDATE action_items succeeds
        new Error("simulated failure before action_item_history commits"),
      ]);
      mockDbConnect.mockResolvedValueOnce(client);

      const app = await buildApp(FACILITATOR_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: PATCH_PAYLOAD,
      });

      expect(res.statusCode).toBe(500);
      expect(client.query.mock.calls.some((c) => c[0] === "ROLLBACK")).toBe(true);
      expect(client.query.mock.calls.some((c) => c[0] === "COMMIT")).toBe(false);
      expect(mockEmitAuditEvent).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 4.9 — audit trail (Decision D10)
  // -------------------------------------------------------------------------
  describe("4.9 — audit_log metadata", () => {
    it("a real reassignment writes audit_log with correct metadata and no no_op flag", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "open" }));
      queueOwnerHandlerQueries();
      const client = makeMockClient([
        { rows: [] },
        { rows: [{ updated_at: new Date() }], rowCount: 1 },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      ]);
      mockDbConnect.mockResolvedValueOnce(client);

      const app = await buildApp(FACILITATOR_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: PATCH_PAYLOAD,
      });

      expect(res.statusCode).toBe(200);
      const auditCall = client.query.mock.calls.find((c) => String(c[0]).includes("audit_log"));
      expect(auditCall).toBeDefined();
      const params = (auditCall as unknown[])[1] as unknown[];
      expect(params[3]).toBe("action_item.owner_reassigned");
      const metadata = JSON.parse(params[5] as string) as Record<string, unknown>;
      expect(metadata).toEqual({
        action_item_id: ITEM_ID,
        previous_owner_id: OWNER_ID,
        new_owner_id: NEW_OWNER_ID,
        session_id: SESSION_ID,
      });
      expect(metadata["no_op"]).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 4.10 — staleness clock (Decision D9)
  // -------------------------------------------------------------------------
  describe("4.10 — staleness clock", () => {
    it("a real reassignment bumps action_items.updated_at to the write's returned value", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "open" }));
      queueOwnerHandlerQueries();
      const freshTimestamp = new Date("2026-09-29T12:00:00Z");
      const client = makeMockClient([
        { rows: [] },
        { rows: [{ updated_at: freshTimestamp }], rowCount: 1 },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      ]);
      mockDbConnect.mockResolvedValueOnce(client);

      const app = await buildApp(FACILITATOR_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: PATCH_PAYLOAD,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ updatedAt: freshTimestamp.toISOString() });
      const updateCall = client.query.mock.calls.find(
        (c) => String(c[0]).includes("UPDATE action_items") && String(c[0]).includes("owner_id"),
      );
      expect(String((updateCall as unknown[])[0])).toContain("updated_at = NOW()");
    });
  });

  // -------------------------------------------------------------------------
  // 4.11 — no WebSocket broadcast (Decision D8)
  // -------------------------------------------------------------------------
  describe("4.11 — no WebSocket broadcast", () => {
    it("no message is published for a real reassignment or a no-op", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "open" }));
      queueOwnerHandlerQueries();
      const client = makeMockClient([
        { rows: [] },
        { rows: [{ updated_at: new Date() }], rowCount: 1 },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      ]);
      mockDbConnect.mockResolvedValueOnce(client);

      const app = await buildApp(FACILITATOR_ID);
      await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: PATCH_PAYLOAD,
      });

      expect(mockPublishActionItemStatusUpdated).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 4.13 — concurrency (Decision D11)
  //
  // This codebase has no existing "two real interleaved DB connections"
  // integration-test pattern to reuse (tasks.md 4.13 asks for one "where
  // available"). Consistent with this file's own established approach
  // (and facilitator-sessions.test.ts's identical technique for its own
  // conditional-UPDATE guards), the race is exercised at the unit level by
  // simulating its observable outcome directly: the guarded UPDATE's
  // rowCount is 0, exactly as it would be if a concurrent VOTE-002 resolve
  // committed between this handler's 2.2 snapshot read and its own 2.9
  // write.
  // -------------------------------------------------------------------------
  describe("4.13 — concurrent resolve discovered only at write time", () => {
    it("a zero-rowCount guarded UPDATE is rejected 409, rolls back, and writes neither history nor audit_log", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "open" })); // snapshot read still sees 'open'
      queueOwnerHandlerQueries();

      const client = makeMockClient([
        { rows: [] }, // BEGIN
        { rows: [], rowCount: 0 }, // guarded UPDATE — concurrent resolve won the race
      ]);
      mockDbConnect.mockResolvedValueOnce(client);

      const app = await buildApp(FACILITATOR_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: PATCH_PAYLOAD,
      });

      expect(res.statusCode).toBe(409);
      expect(client.query.mock.calls.some((c) => c[0] === "ROLLBACK")).toBe(true);
      expect(client.query.mock.calls.some((c) => c[0] === "COMMIT")).toBe(false);
      expect(client.query.mock.calls.some((c) => String(c[0]).includes("action_item_history"))).toBe(false);
      expect(client.query.mock.calls.some((c) => String(c[0]).includes("INSERT INTO audit_log"))).toBe(false);
      expect(mockEmitAuditEvent).not.toHaveBeenCalled();
    });

    // Security review, implementation-stage finding — the same-owner no-op
    // branch's UPDATE has the identical TOCTOU shape (snapshot read at 2.2,
    // resolved-check at 2.6 evaluated against that possibly-stale snapshot)
    // as the real-reassignment path above, so it needs the same
    // `status != 'resolved'` guard and 409/rollback treatment on a
    // zero-rowCount result.
    it("a zero-rowCount guarded no-op UPDATE is rejected 409, rolls back, and writes no audit_log", async () => {
      mockDbQuery.mockResolvedValueOnce(itemRow({ status: "open", owner_id: NEW_OWNER_ID })); // snapshot read still sees 'open'
      queueOwnerHandlerQueries();

      const client = makeMockClient([
        { rows: [] }, // BEGIN
        { rows: [], rowCount: 0 }, // guarded no-op UPDATE — concurrent resolve won the race
      ]);
      mockDbConnect.mockResolvedValueOnce(client);

      const app = await buildApp(FACILITATOR_ID);
      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/action-items/${ITEM_ID}/owner`,
        payload: { newOwnerUserId: NEW_OWNER_ID, sessionId: SESSION_ID },
      });

      expect(res.statusCode).toBe(409);
      expect(client.query.mock.calls.some((c) => c[0] === "ROLLBACK")).toBe(true);
      expect(client.query.mock.calls.some((c) => c[0] === "COMMIT")).toBe(false);
      expect(client.query.mock.calls.some((c) => String(c[0]).includes("INSERT INTO audit_log"))).toBe(false);
      expect(mockEmitAuditEvent).not.toHaveBeenCalled();
    });
  });
});
