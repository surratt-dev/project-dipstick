import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be defined before importing the modules under test
// ---------------------------------------------------------------------------
const mockDbQuery = vi.fn();
const mockDbConnect = vi.fn();
const mockEmitAuditEvent = vi.fn();
const mockPublishVoteRevealed = vi.fn();

vi.mock("../../db.js", () => ({
  db: {
    query: (...args: unknown[]) => mockDbQuery(...args),
    connect: () => mockDbConnect(),
  },
}));
vi.mock("../../auth/audit-logger.js", () => ({
  emitAuditEvent: (...args: unknown[]) => mockEmitAuditEvent(...args),
}));
// facilitator-sessions.js now imports publishSessionStateChange and
// publishVoteRevealed from ws-pubsub.js, which imports the real `redis`
// singleton at module load time. Mock it so this test never opens a real
// (or real-attempting) TCP connection. Since session-lifecycle-transitions,
// a successful reveal DOES call db.connect() (the reveal write's
// transaction) and publishVoteRevealed (after commit) — both are mocked
// below for the "reveal succeeds" case.
vi.mock("../../realtime/ws-pubsub.js", () => ({
  publishSessionStateChange: vi.fn(),
  publishVoteRevealed: (...args: unknown[]) => mockPublishVoteRevealed(...args),
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

// Mock timing oracle to skip floor delay in tests
vi.mock("../../content/timing-oracle.js", () => ({
  applyTimingFloor: vi.fn().mockResolvedValue(undefined),
  CONTENT_TIMING_FLOOR_MS: 150,
}));

import Fastify from "fastify";
import { contentRoutes } from "../content.js";
import { facilitatorSessionRoutes } from "../facilitator-sessions.js";

/** Returns a mock transaction client that records calls, matching teams.test.ts's pattern. */
function makeMockClient(queryResponses: Array<{ rows: unknown[]; rowCount?: number }> = []) {
  let callIndex = 0;
  const mockClientQuery = vi.fn((..._args: unknown[]) => {
    const resp = queryResponses[callIndex] ?? { rows: [] };
    callIndex++;
    return Promise.resolve(resp);
  });
  return {
    query: mockClientQuery,
    release: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Group 10 — Live Session Facilitator Error States
//
// Task 10.1 — Error State 1: Reveal failure (recoverable vs non-recoverable)
// Task 10.2 — Error State 2: Historical data unavailable during active session
// Task 10.3 — Error State 3: Session status transition (non-blocking banner)
// Task 10.4 — Error State 4: Cross-team denial ("not in your current session")
// Task 10.5 — Error State 4: Response must not include Team A identifiers
// Task 10.6 — Facilitator UX tests for each named error state
//
// Spec: team-content-access spec / Requirement: Live session error states
//
// These error states MUST NOT inherit the general 403/404 error presentation.
// An authorization failure during a live session is a UX emergency: the
// facilitator is in a room with participants and cannot navigate away.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// App builders
// ---------------------------------------------------------------------------

function buildContentApp(userId = "facilitator-1") {
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
  });
  app.register(contentRoutes);
  return app.ready().then(() => app);
}

function buildFacilitatorApp(userId = "facilitator-1") {
  const app = Fastify();
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
  });
  app.register(facilitatorSessionRoutes);
  return app.ready().then(() => app);
}

// ---------------------------------------------------------------------------
// Mock sequence helpers for evaluateTeamAccess (content routes)
//
// The authorization helper (evaluateTeamAccess) makes two DB calls:
//   Q1: SELECT u.global_role, tm.role AS membership_role FROM users u
//       LEFT JOIN team_memberships tm ... WHERE u.id = $1 AND tm.team_id = $2
//   Q2: SELECT s.id, s.status FROM sessions s WHERE facilitator_id = $1
//       AND team_id = $2 AND (...status conditions...)
// ---------------------------------------------------------------------------

function mockQ1NoMembership(globalRole = "facilitator") {
  mockDbQuery.mockResolvedValueOnce({
    rows: [{ global_role: globalRole, membership_role: null }],
  });
}

function mockQ2FacilitatorSession(sessionId = "sess-1", sessionStatus = "active") {
  mockDbQuery.mockResolvedValueOnce({
    rows: [{ session_id: sessionId, session_status: sessionStatus }],
  });
}

function mockQ2NoSession() {
  mockDbQuery.mockResolvedValueOnce({ rows: [] });
}

// ---------------------------------------------------------------------------
// Task 10.1 / Task 10.6 — Error State 1: Reveal failure
//
// Spec: "The facilitator triggers the reveal and the backend authorization
// check fails. The response distinguishes:
//   - Recoverable: session is still active → 'Your session is still active.
//     Try again.'
//   - Non-recoverable: session is no longer in an active state → 'This session
//     is no longer in an active state. Please review the session status.'
// MUST NOT display: A generic error modal, blank results panel, or technical details."
// ---------------------------------------------------------------------------
describe("Task 10.1 / 10.6: Error State 1 — Reveal failure", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reveal succeeds: facilitator is authorized and session is active", async () => {
    // Session exists, user IS the facilitator, session is 'active', and has
    // a current topic (session-lifecycle-transitions: reveal now performs a
    // real state-transition write against that topic).
    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{
          id: "sess-1",
          team_id: "team-1",
          facilitator_id: "facilitator-1",
          status: "active",
          current_topic_id: "topic-1",
        }],
      })
      .mockResolvedValueOnce({ rows: [{ global_role: "facilitator" }] }); // actor global_role

    const client = makeMockClient([
      { rows: [] }, // BEGIN
      { rows: [{ id: "session-topic-1", revealed_at: new Date("2026-09-08T00:00:00Z") }], rowCount: 1 }, // conditional UPDATE
      { rows: [] }, // INSERT audit_log (recordRevealTriggeredAudit)
      { rows: [] }, // COMMIT
    ]);
    mockDbConnect.mockResolvedValueOnce(client);

    const app = await buildFacilitatorApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/sess-1/reveal",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { revealed: boolean; sessionId: string; teamId: string };
    expect(body.revealed).toBe(true);
    expect(body.sessionId).toBe("sess-1");
    expect(body.teamId).toBe("team-1");
    // Task 10.6: recovery path is not needed because reveal succeeded

    expect(mockPublishVoteRevealed).toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({ sessionId: "sess-1", sessionStatus: "active" }),
    );
  });

  it("reveal fails — recoverable: user is not the facilitator but session IS active", async () => {
    // The session is active but a DIFFERENT user is the facilitator.
    // This simulates a transient authorization failure while the session is still live.
    // Recovery path: "Try again" — session is still running.
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "sess-1",
        team_id: "team-1",
        facilitator_id: "other-facilitator",  // not the requesting user
        status: "active",                       // but session IS still active
      }],
    });

    const app = await buildFacilitatorApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/sess-1/reveal",
    });

    // Task 10.6: correct message, session view not blocked, recovery path clear
    expect(res.statusCode).toBe(503); // transient — safe to retry
    const body = res.json() as {
      errorState: string;
      recoverable: boolean;
      message: string;
    };
    expect(body.errorState).toBe("reveal_failure");
    expect(body.recoverable).toBe(true);
    // Spec exact message
    expect(body.message).toBe(
      "The reveal could not be completed. Your session is still active. Try again."
    );
    // Task 10.6: recovery path is clear ("Try again" in the message)
    expect(body.message).toContain("Try again");
    // Task 10.6: session view is not blocked — no generic error modal
    // (verified by the structured errorState shape, not a generic 403 body)
    expect(body).not.toHaveProperty("error"); // not the generic error shape
  });

  it("reveal fails — non-recoverable: session has transitioned to complete", async () => {
    // The session is no longer active (it completed while the reveal was triggered).
    // Recovery path: review session status before retrying.
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "sess-1",
        team_id: "team-1",
        facilitator_id: "facilitator-1",  // user IS the facilitator
        status: "complete",                // but session is no longer active
      }],
    });

    const app = await buildFacilitatorApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/sess-1/reveal",
    });

    // Task 10.6: non-recoverable error, directs facilitator to review session status
    expect(res.statusCode).toBe(409); // state conflict — review required before retry
    const body = res.json() as {
      errorState: string;
      recoverable: boolean;
      message: string;
      currentSessionStatus: string;
    };
    expect(body.errorState).toBe("reveal_failure");
    expect(body.recoverable).toBe(false);
    // Spec exact message
    expect(body.message).toBe(
      "This session is no longer in an active state. Please review the session status."
    );
    // Includes current state so facilitator knows what happened
    expect(body.currentSessionStatus).toBe("complete");
    // Task 10.6: session view is not blocked (structured error, not generic 403)
    expect(body).not.toHaveProperty("error");
  });

  it("reveal fails — non-recoverable: session not found", async () => {
    // Session was deleted or belongs to a different team — facilitator's session row
    // is not found. Cannot determine session state, so non-recoverable.
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // session not found

    const app = await buildFacilitatorApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/nonexistent-session/reveal",
    });

    expect(res.statusCode).toBe(409);
    const body = res.json() as {
      errorState: string;
      recoverable: boolean;
      message: string;
    };
    expect(body.errorState).toBe("reveal_failure");
    expect(body.recoverable).toBe(false);
    expect(body.message).toContain("no longer in an active state");
    // Task 10.6: recovery path is "review session status" (embedded in message)
  });

  it("reveal fails — non-recoverable: authorized facilitator but session is in wrap_up", async () => {
    // The facilitator IS the session owner but the session transitioned to wrap_up,
    // which is not the 'active' state required for a reveal to make sense.
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "sess-1",
        team_id: "team-1",
        facilitator_id: "facilitator-1",
        status: "wrap_up",
      }],
    });

    const app = await buildFacilitatorApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/sess-1/reveal",
    });

    expect(res.statusCode).toBe(409);
    const body = res.json() as { errorState: string; recoverable: boolean };
    expect(body.errorState).toBe("reveal_failure");
    expect(body.recoverable).toBe(false);
  });

  it("reveal response is a structured error object, not the general 403/404 shape", async () => {
    // Spec: "MUST NOT display: A generic error modal, a blank results panel, or technical details."
    // Verified by checking the response body shape is errorState-based, not category-based.
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // session not found

    const app = await buildFacilitatorApp("facilitator-1");
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams/team-1/sessions/sess-1/reveal",
    });

    const body = res.json() as Record<string, unknown>;
    // Must be errorState shape
    expect(body).toHaveProperty("errorState");
    expect(body).toHaveProperty("recoverable");
    expect(body).toHaveProperty("message");
    // Must NOT be the general error shape
    expect(body).not.toHaveProperty("error");
    expect(body).not.toHaveProperty("error.category");
  });
});

// ---------------------------------------------------------------------------
// Task 10.2 / Task 10.6 — Error State 2: Historical data unavailable
//
// Spec: "If a facilitator's trend or history endpoint call fails DURING an
// active session, return an empty state response with
// 'Historical data is temporarily unavailable. Your session is still active.'
// — NOT a 403 response in this context."
//
// MUST NOT display: "You do not have access to this data." — that phrasing
// suggests a session problem and may cause the facilitator to end the session.
// ---------------------------------------------------------------------------
describe("Task 10.2 / 10.6: Error State 2 — Historical data unavailable during active session", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sessions endpoint: data query failure returns empty state with correct message (not 403)", async () => {
    // Q1: facilitator has no membership for this team
    mockQ1NoMembership("facilitator");
    // Q2: facilitator has an active session for this team
    mockQ2FacilitatorSession("sess-1", "active");
    // Data query (Q3): throws to simulate DB failure
    mockDbQuery.mockRejectedValueOnce(new Error("DB connection timeout"));

    const app = await buildContentApp("facilitator-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-1/sessions",
    });

    // Task 10.6: correct message, session view not blocked, recovery path clear
    expect(res.statusCode).toBe(200); // NOT a 403 — data issue, not access issue
    expect(res.headers["cache-control"]).toBe("no-store");

    const body = res.json() as {
      errorState: string;
      message: string;
      sessions: unknown[];
      sessionActive: boolean;
    };
    // Spec exact message
    expect(body.errorState).toBe("historical_data_unavailable");
    expect(body.message).toBe(
      "Historical data is temporarily unavailable. Your session is still active."
    );
    // Empty sessions list — frontend renders as empty state, not error
    expect(body.sessions).toEqual([]);
    // Explicitly confirms session is still active — recovery path is clear
    expect(body.sessionActive).toBe(true);
    // Task 10.6: message confirms "Your session is still active"
    expect(body.message).toContain("still active");
  });

  it("trends endpoint: data query failure returns empty trends with correct message (not 403)", async () => {
    // Q1: facilitator has no membership for this team
    mockQ1NoMembership("facilitator");
    // Q2: facilitator has an active session for this team
    mockQ2FacilitatorSession("sess-1", "active");
    // Trend data query throws
    mockDbQuery.mockRejectedValueOnce(new Error("Query timeout"));

    const app = await buildContentApp("facilitator-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-1/trends",
    });

    expect(res.statusCode).toBe(200); // NOT a 403
    const body = res.json() as {
      errorState: string;
      message: string;
      trends: unknown[];
      sessionActive: boolean;
    };
    expect(body.errorState).toBe("historical_data_unavailable");
    expect(body.message).toContain("temporarily unavailable");
    expect(body.message).toContain("still active");
    expect(body.trends).toEqual([]);
    expect(body.sessionActive).toBe(true);
  });

  it("message does NOT say 'you do not have access' (would cause facilitator to end session)", async () => {
    // Spec: "MUST NOT display: 'You do not have access to this data.'"
    mockQ1NoMembership("facilitator");
    mockQ2FacilitatorSession("sess-1", "active");
    mockDbQuery.mockRejectedValueOnce(new Error("DB error"));

    const app = await buildContentApp("facilitator-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-1/sessions",
    });

    const body = res.json() as { message: string };
    expect(body.message).not.toContain("do not have access");
    expect(body.message).not.toContain("forbidden");
    expect(body.message).not.toContain("unauthorized");
  });

  it("data query failure for a non-facilitator (EM) propagates as error, not empty state", async () => {
    // Error State 2 is ONLY for facilitators in active sessions.
    // An EM's data query failure should NOT return the "temporarily unavailable" message —
    // that message would be misleading since EMs don't have "sessions."
    mockDbQuery.mockResolvedValueOnce({
      rows: [{ global_role: "engineering_manager", membership_role: "engineering_manager" }],
    });
    // Data query throws
    mockDbQuery.mockRejectedValueOnce(new Error("DB error"));

    const app = await buildContentApp("em-user");
    // We expect this to throw (propagated to Fastify's error handler → 500)
    // rather than returning the empty-state message.
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-1/sessions",
    });

    // A propagated error becomes a Fastify 500
    expect(res.statusCode).toBe(500);
    // NOT the Error State 2 shape
    const body = res.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty("errorState");
    expect(body).not.toHaveProperty("sessions");
  });

  it("data query failure for a facilitator in completed session (outside grace window): not Error State 2", async () => {
    // A facilitator whose session has ended (null grant) gets generic 403,
    // not Error State 2 — they're no longer "in an active session."
    //
    // Mock sequence:
    //   Q1: no membership for this team
    //   Q2: no active/grace-window facilitator session → null grant
    //   Q3: cross-team check (Error State 4): also no other active sessions
    //       → generic 403 "You do not have access"
    mockQ1NoMembership("facilitator");
    mockQ2NoSession(); // no active/grace-window session → null grant
    // Q3: cross-team check (denyNullGrant always runs this after null grant)
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // no other team sessions either

    const app = await buildContentApp("facilitator-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-1/sessions",
    });

    // No grant → denial, not Error State 2
    expect(res.statusCode).toBe(403);
    const body = res.json() as Record<string, unknown>;
    // Not the Error State 2 response
    expect(body).not.toHaveProperty("errorState");
  });
});

// ---------------------------------------------------------------------------
// Task 10.3 / Task 10.6 — Error State 3: Session status transition
//
// Spec: "When session status changes unexpectedly, push a non-blocking banner
// state to the facilitator's client (not a modal); include current session state
// and action 'Resume or review'."
//
// MUST NOT display: A modal that blocks the screen or hides the session view.
// displayType: 'banner' is the normative constraint in the response.
// ---------------------------------------------------------------------------
describe("Task 10.3 / 10.6: Error State 3 — Session status transition during live facilitation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null bannerState when session is in normal active state (no unexpected transition)", async () => {
    // Session is in 'active' state — no banner needed.
    // Facilitator is in the normal live facilitation flow.
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "sess-1",
        team_id: "team-1",
        facilitator_id: "facilitator-1",
        status: "active",
      }],
    });

    const app = await buildFacilitatorApp("facilitator-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-1/sessions/sess-1/facilitator-state",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      sessionId: string;
      teamId: string;
      currentSessionState: string;
      bannerState: null | Record<string, unknown>;
    };
    expect(body.sessionId).toBe("sess-1");
    expect(body.teamId).toBe("team-1");
    expect(body.currentSessionState).toBe("active");
    // No unexpected transition — banner is null
    expect(body.bannerState).toBeNull();
  });

  it("returns non-blocking banner state when session has transitioned to wrap_up", async () => {
    // Session unexpectedly moved to 'wrap_up' while the facilitator was mid-flow.
    // Response includes a banner (NOT a modal) with the current state and the action.
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "sess-1",
        team_id: "team-1",
        facilitator_id: "facilitator-1",
        status: "wrap_up",
      }],
    });

    const app = await buildFacilitatorApp("facilitator-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-1/sessions/sess-1/facilitator-state",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      currentSessionState: string;
      bannerState: {
        type: string;
        displayType: string;
        currentSessionState: string;
        message: string;
        action: string;
      } | null;
    };

    // Task 10.6: current session state is included in the response
    expect(body.currentSessionState).toBe("wrap_up");

    // Task 10.6: bannerState is non-null — transition was detected
    expect(body.bannerState).not.toBeNull();
    const banner = body.bannerState!;

    // Spec: "Session state has changed. [Current state]. Resume or review."
    expect(banner.type).toBe("session_status_changed");

    // Task 10.6: displayType 'banner' confirms non-modal; facilitator can see session view
    expect(banner.displayType).toBe("banner"); // NOT 'modal'

    // Task 10.6: current state is included in banner
    expect(banner.currentSessionState).toBe("wrap_up");

    // Spec message format: "Session state has changed. wrap_up. Resume or review."
    expect(banner.message).toContain("Session state has changed");
    expect(banner.message).toContain("wrap_up");
    expect(banner.message).toContain("Resume or review");

    // Task 10.6: recovery path is clear — action field states "Resume or review"
    expect(banner.action).toBe("Resume or review");
  });

  it("returns non-blocking banner state when session has transitioned to complete", async () => {
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "sess-1",
        team_id: "team-1",
        facilitator_id: "facilitator-1",
        status: "complete",
      }],
    });

    const app = await buildFacilitatorApp("facilitator-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-1/sessions/sess-1/facilitator-state",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { bannerState: { displayType: string; action: string } | null };
    expect(body.bannerState).not.toBeNull();
    // Non-blocking: displayType is 'banner', not 'modal'
    expect(body.bannerState!.displayType).toBe("banner");
    expect(body.bannerState!.action).toBe("Resume or review");
  });

  it("non-facilitator cannot access facilitator-state endpoint (403)", async () => {
    // The facilitator-state endpoint is only for the session's own facilitator.
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "sess-1",
        team_id: "team-1",
        facilitator_id: "different-facilitator", // not the requesting user
        status: "active",
      }],
    });

    const app = await buildFacilitatorApp("participant-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-1/sessions/sess-1/facilitator-state",
    });

    expect(res.statusCode).toBe(403);
  });

  it("banner displayType 'banner' confirms the response is non-modal (spec constraint)", async () => {
    // Spec: "MUST NOT display: A modal that blocks the screen or hides the session view."
    // The backend enforces this by setting displayType: 'banner' in the response.
    // Frontend implementations MUST read this field and render a persistent banner.
    mockDbQuery.mockResolvedValueOnce({
      rows: [{
        id: "sess-1",
        team_id: "team-1",
        facilitator_id: "facilitator-1",
        status: "abandoned",
      }],
    });

    const app = await buildFacilitatorApp("facilitator-1");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-1/sessions/sess-1/facilitator-state",
    });

    const body = res.json() as { bannerState: { displayType: string } | null };
    expect(body.bannerState).not.toBeNull();
    // 'banner' is the normative non-modal constraint
    expect(body.bannerState!.displayType).toBe("banner");
    // Confirm it is NOT 'modal'
    expect(body.bannerState!.displayType).not.toBe("modal");
  });
});

// ---------------------------------------------------------------------------
// Task 10.4 / Task 10.5 / Task 10.6 — Error State 4: Cross-team denial
//
// Spec: "When a facilitator in a session for Team B requests Team A's
// historical data, the response message reads
// 'This data is not available in your current session'
// — NOT 'You do not have access to Team A's data'."
//
// Task 10.5: "Response must NOT include Team A's team ID, team name, or any
// identifier confirming Team A's existence."
// ---------------------------------------------------------------------------
describe("Task 10.4 / 10.5 / 10.6: Error State 4 — Cross-team denial", () => {
  beforeEach(() => vi.clearAllMocks());

  it("facilitator in Team B's session gets session-context message when requesting Team A", async () => {
    // The facilitator is actively running Team B's session but requests Team A's content.
    // evaluateTeamAccess for Team A returns null (no Team A membership, no Team A session).
    // The cross-team check finds the user IS a facilitator for Team B.
    //
    // Mock sequence:
    //   Q1: user+membership check for Team A → no membership
    //   Q2: facilitator session check for Team A → no session for Team A
    //   Q3: cross-team check → active session for Team B found
    mockQ1NoMembership("facilitator"); // no Team A membership
    mockQ2NoSession(); // no Team A facilitator session
    // Cross-team check: has active session for ANOTHER team (Team B)
    mockDbQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });

    const app = await buildContentApp("facilitator-in-team-b");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-A/sessions",
    });

    // Task 10.6: correct message, session view is not blocked
    expect(res.statusCode).toBe(403);
    expect(res.headers["cache-control"]).toBe("no-store");

    const body = res.json() as { error: { message: string; category: string } };
    // Task 10.4: spec exact message — session-context, not team-based
    expect(body.error.message).toBe("This data is not available in your current session");
    // NOT the generic forbidden message
    expect(body.error.message).not.toContain("You do not have access");
    expect(body.error.category).toBe("forbidden");
  });

  it("cross-team denial response contains no Team A identifiers (Task 10.5)", async () => {
    // Spec: "MUST NOT include Team A's team ID, team name, or any other
    // identifier that confirms Team A's existence."
    const teamAId = "team-A-sensitive-uuid-12345";

    mockQ1NoMembership("facilitator");
    mockQ2NoSession();
    mockDbQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });

    const app = await buildContentApp("facilitator-in-team-b");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/teams/${teamAId}/sessions`,
    });

    expect(res.statusCode).toBe(403);

    // Task 10.5: verify the response body contains no reference to Team A's ID
    const rawBody = res.body;
    expect(rawBody).not.toContain(teamAId);
    expect(rawBody).not.toContain("team-A");

    // The response body must not confirm whether Team A exists or has data
    const body = res.json() as { error: { message: string } };
    expect(body.error.message).not.toContain(teamAId);
    expect(body.error.message).not.toContain("Team A");
    expect(body.error.message).not.toContain("session history");
  });

  it("facilitator with no active session gets generic forbidden (not cross-team message)", async () => {
    // A facilitator who has no active sessions at all is denied with the generic
    // message, not the session-context message. "In your current session" only
    // applies when there IS a current session.
    mockQ1NoMembership("facilitator");
    mockQ2NoSession(); // no Team A facilitator session
    // Cross-team check: no active sessions for any other team either
    mockDbQuery.mockResolvedValueOnce({ rows: [] });

    const app = await buildContentApp("facilitator-no-session");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-A/sessions",
    });

    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: { message: string } };
    // Generic message — not the cross-team message
    expect(body.error.message).toBe("You do not have access to this team's content.");
    // NOT the cross-team message
    expect(body.error.message).not.toBe("This data is not available in your current session");
  });

  it("cross-team denial does not say 'You do not have access to Team A' (existence disclosure)", async () => {
    // Spec: "MUST NOT display: 'You do not have access to Team A's session history.'
    // This reveals Team A's existence and that it has session data."
    mockQ1NoMembership("facilitator");
    mockQ2NoSession();
    mockDbQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] }); // has Team B session

    const app = await buildContentApp("facilitator-in-team-b");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-A/sessions",
    });

    const body = res.json() as { error: { message: string } };
    // Must NOT reference Team A or confirm it has session history
    expect(body.error.message).not.toMatch(/team.a/i);
    expect(body.error.message).not.toContain("session history");
    expect(body.error.message).not.toContain("access to");
  });

  it("facilitator in Team B's session gets cross-team denial on trends endpoint too", async () => {
    // Error State 4 applies to ALL content endpoints, not just session history.
    mockQ1NoMembership("facilitator");
    mockQ2NoSession();
    mockDbQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] }); // Team B session

    const app = await buildContentApp("facilitator-in-team-b");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/teams/team-A/trends",
    });

    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: { message: string } };
    expect(body.error.message).toBe("This data is not available in your current session");
  });

  it("Team B session is unaffected by the Team A denial (Task 10.6 — session view not blocked)", async () => {
    // When a facilitator gets the cross-team denial for Team A, their Team B session
    // should still be fully accessible. This test verifies Team B access succeeds
    // independently of the Team A denial.
    //
    // Note: This test uses two separate app instances to simulate two independent
    // requests (one denied, one authorized).

    // Team A request: denied with cross-team message
    mockQ1NoMembership("facilitator");
    mockQ2NoSession(); // no Team A session
    mockDbQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] }); // has Team B session

    const appA = await buildContentApp("facilitator-in-team-b");
    const resA = await appA.inject({
      method: "GET",
      url: "/api/v1/teams/team-A/sessions",
    });
    expect(resA.statusCode).toBe(403);
    expect((resA.json() as { error: { message: string } }).error.message).toBe(
      "This data is not available in your current session"
    );

    // Team B request: authorized (separate request, separate mock)
    vi.clearAllMocks();
    mockQ1NoMembership("facilitator"); // no Team B membership row
    mockQ2FacilitatorSession("sess-B-1", "active"); // but has Team B facilitator session
    mockDbQuery.mockResolvedValueOnce({ rows: [] }); // resource query returns empty

    const appB = await buildContentApp("facilitator-in-team-b");
    const resB = await appB.inject({
      method: "GET",
      url: "/api/v1/teams/team-B/sessions",
    });
    // Team B session is fully accessible — not blocked by the Team A denial
    expect(resB.statusCode).toBe(200);
  });
});
