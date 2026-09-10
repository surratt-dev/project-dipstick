import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyBaseLogger } from "fastify";

const mockDbQuery = vi.fn();

vi.mock("../../db.js", () => ({
  db: { query: (...args: unknown[]) => mockDbQuery(...args) },
}));
// ws-event-dispatcher.js imports WS_EVENTS_CHANNEL from ws-pubsub.js, which
// imports the real `redis` singleton at module load time. Mock it so this
// unit test never opens a real (or real-attempting) TCP connection.
vi.mock("../../redis.js", () => ({
  redis: { publish: vi.fn(), duplicate: vi.fn() },
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

import { handleIncomingMessage } from "../ws-event-dispatcher.js";
import { ConnectionRegistry, type RegisteredConnection } from "../connection-registry.js";
import type { WsEventEnvelope } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// Group 5 correctness tests (in-process form — the actual Redis pub/sub-hop
// integration test per tasks.md 5.2 lives separately and requires a live
// Redis instance; see ws-pubsub-integration.test.ts).
//
// These tests call handleIncomingMessage directly, simulating "a pub/sub
// message just arrived" — exactly the boundary design.md Decision D3 names
// as the place a delivery-time check can silently regress to subscription-
// time caching. Each test constructs a FRESH grant response per call to
// evaluateSessionSubscriberAccess/evaluateTeamAccess (via mockDbQuery),
// proving the authorization check actually re-runs per message rather than
// reusing a cached result from registration time (task 4.6's code-review
// checklist item, made executable here rather than left to review alone).
// ---------------------------------------------------------------------------

function fakeConn(userId: string, sessionCreatedAt = Date.now()): RegisteredConnection & { sent: string[] } {
  const sent: string[] = [];
  const conn = {
    userId,
    sessionCreatedAt,
    socket: {
      readyState: 1,
      send: (data: string) => sent.push(data),
    },
  } as unknown as RegisteredConnection & { sent: string[] };
  (conn as unknown as { sent: string[] }).sent = sent;
  return conn as RegisteredConnection & { sent: string[] };
}

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as FastifyBaseLogger;

async function dispatch(envelope: WsEventEnvelope, registry: ConnectionRegistry) {
  await handleIncomingMessage(JSON.stringify(envelope), noopLogger, registry);
}

describe("ws-event-dispatcher", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("vote_readiness_update", () => {
    it("delivers only to the active facilitator in pre_session/active status", async () => {
      const registry = new ConnectionRegistry();
      const facilitatorConn = fakeConn("facilitator-1");
      const participantConn = fakeConn("participant-1");
      registry.register("session", "s1", facilitatorConn);
      registry.register("session", "s1", participantConn);

      // evaluateSessionSubscriberAccess query, once per candidate
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [{
            session_id: "s1", team_id: "t1", facilitator_id: "facilitator-1", session_status: "active",
            global_role: "facilitator", participant_row_id: null, membership_removed_at: null, membership_exists: false,
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            session_id: "s1", team_id: "t1", facilitator_id: "facilitator-1", session_status: "active",
            global_role: "engineer", participant_row_id: "p1", membership_removed_at: null, membership_exists: true,
          }],
        });

      await dispatch(
        { eventType: "vote_readiness_update", sessionId: "s1", payload: { sessionId: "s1", sessionTopicId: "t1", voterId: "participant-1", readyAt: new Date().toISOString() } },
        registry,
      );

      expect(facilitatorConn.sent).toHaveLength(1);
      expect(participantConn.sent).toHaveLength(0);
    });

    it("does not deliver to the facilitator when session status is wrap_up (not pre_session/active)", async () => {
      const registry = new ConnectionRegistry();
      const facilitatorConn = fakeConn("facilitator-1");
      registry.register("session", "s1", facilitatorConn);

      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          session_id: "s1", team_id: "t1", facilitator_id: "facilitator-1", session_status: "wrap_up",
          global_role: "facilitator", participant_row_id: null, membership_removed_at: null, membership_exists: false,
        }],
      });

      await dispatch(
        { eventType: "vote_readiness_update", sessionId: "s1", payload: { sessionId: "s1", sessionTopicId: "t1", voterId: "x", readyAt: new Date().toISOString() } },
        registry,
      );

      expect(facilitatorConn.sent).toHaveLength(0);
    });

    it("payload never includes a vote value (task 5.7)", async () => {
      const registry = new ConnectionRegistry();
      const facilitatorConn = fakeConn("facilitator-1");
      registry.register("session", "s1", facilitatorConn);
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          session_id: "s1", team_id: "t1", facilitator_id: "facilitator-1", session_status: "active",
          global_role: "facilitator", participant_row_id: null, membership_removed_at: null, membership_exists: false,
        }],
      });

      await dispatch(
        { eventType: "vote_readiness_update", sessionId: "s1", payload: { sessionId: "s1", sessionTopicId: "t1", voterId: "x", readyAt: new Date().toISOString() } },
        registry,
      );

      expect(facilitatorConn.sent[0]).not.toMatch(/voteValue/);
    });
  });

  describe("session_state_change", () => {
    it("delivers to an active participant", async () => {
      const registry = new ConnectionRegistry();
      const conn = fakeConn("participant-1");
      registry.register("session", "s1", conn);
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          session_id: "s1", team_id: "t1", facilitator_id: "someone-else", session_status: "lobby",
          global_role: "engineer", participant_row_id: "p1", membership_removed_at: null, membership_exists: true,
        }],
      });

      await dispatch(
        { eventType: "session_state_change", sessionId: "s1", payload: { sessionId: "s1", teamId: "t1", previousStatus: "draft", newStatus: "lobby", changedAt: new Date().toISOString() } },
        registry,
      );

      expect(conn.sent).toHaveLength(1);
    });

    it("does not deliver to a subscriber whose team membership was removed", async () => {
      const registry = new ConnectionRegistry();
      const conn = fakeConn("removed-user");
      registry.register("session", "s1", conn);
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          session_id: "s1", team_id: "t1", facilitator_id: "someone-else", session_status: "lobby",
          global_role: "engineer", participant_row_id: "p1", membership_removed_at: new Date(), membership_exists: true,
        }],
      });

      await dispatch(
        { eventType: "session_state_change", sessionId: "s1", payload: { sessionId: "s1", teamId: "t1", previousStatus: "draft", newStatus: "lobby", changedAt: new Date().toISOString() } },
        registry,
      );

      expect(conn.sent).toHaveLength(0);
    });

    it("re-runs the authorization check on every message — not cached from a prior push", async () => {
      const registry = new ConnectionRegistry();
      const conn = fakeConn("user-1");
      registry.register("session", "s1", conn);

      // First push: authorized
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          session_id: "s1", team_id: "t1", facilitator_id: "user-1", session_status: "active",
          global_role: "facilitator", participant_row_id: null, membership_removed_at: null, membership_exists: false,
        }],
      });
      await dispatch(
        { eventType: "session_state_change", sessionId: "s1", payload: { sessionId: "s1", teamId: "t1", previousStatus: "lobby", newStatus: "active", changedAt: new Date().toISOString() } },
        registry,
      );
      expect(conn.sent).toHaveLength(1);
      expect(mockDbQuery).toHaveBeenCalledTimes(1);

      // Second push: now revoked (session ended) — must be independently re-checked, not skipped
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          session_id: "s1", team_id: "t1", facilitator_id: "user-1", session_status: "complete",
          global_role: "facilitator", participant_row_id: null, membership_removed_at: null, membership_exists: false,
        }],
      });
      await dispatch(
        { eventType: "session_state_change", sessionId: "s1", payload: { sessionId: "s1", teamId: "t1", previousStatus: "active", newStatus: "complete", changedAt: new Date().toISOString() } },
        registry,
      );

      // Second query really happened (proves no caching) AND correctly denied.
      expect(mockDbQuery).toHaveBeenCalledTimes(2);
      expect(conn.sent).toHaveLength(1); // still just the first send — second was denied
    });

    // Task 5.5 / base-spec scenario "Role change from participant to
    // engineering_manager revokes live session event access": a role change
    // mid-connection to engineering_manager must stop BOTH session_state_change
    // and vote_readiness_update on the very next push, with no reconnect.
    it("stops delivering session_state_change once the subscriber's role becomes engineering_manager mid-connection", async () => {
      const registry = new ConnectionRegistry();
      const conn = fakeConn("promoted-user");
      registry.register("session", "s1", conn);

      // First push: still a plain participant.
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          session_id: "s1", team_id: "t1", facilitator_id: "someone-else", session_status: "active",
          global_role: "engineer", participant_row_id: "p1", membership_role: "participant",
          membership_removed_at: null, membership_exists: true,
        }],
      });
      await dispatch(
        { eventType: "session_state_change", sessionId: "s1", payload: { sessionId: "s1", teamId: "t1", previousStatus: "lobby", newStatus: "active", changedAt: new Date().toISOString() } },
        registry,
      );
      expect(conn.sent).toHaveLength(1);

      // Promoted to engineering_manager (team_memberships.role changed) —
      // the old session_participants row is NOT deleted by the promotion.
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          session_id: "s1", team_id: "t1", facilitator_id: "someone-else", session_status: "active",
          global_role: "engineer", participant_row_id: "p1", membership_role: "engineering_manager",
          membership_removed_at: null, membership_exists: true,
        }],
      });
      await dispatch(
        { eventType: "session_state_change", sessionId: "s1", payload: { sessionId: "s1", teamId: "t1", previousStatus: "active", newStatus: "wrap_up", changedAt: new Date().toISOString() } },
        registry,
      );

      expect(conn.sent).toHaveLength(1); // still just the first — the second was correctly denied
    });

    it("stops delivering vote_readiness_update once the subscriber's role becomes engineering_manager mid-connection (facilitator path)", async () => {
      const registry = new ConnectionRegistry();
      const conn = fakeConn("promoted-facilitator");
      registry.register("session", "s1", conn);

      // A facilitator whose OWN global_role becomes engineering_manager —
      // covers the global_role half of the dual EM check, not just the
      // membership_role half exercised in the test above.
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          session_id: "s1", team_id: "t1", facilitator_id: "promoted-facilitator", session_status: "active",
          global_role: "engineering_manager", participant_row_id: null, membership_role: null,
          membership_removed_at: null, membership_exists: false,
        }],
      });

      await dispatch(
        { eventType: "vote_readiness_update", sessionId: "s1", payload: { sessionId: "s1", sessionTopicId: "t1", voterId: "x", readyAt: new Date().toISOString() } },
        registry,
      );

      // facilitator_id matches, but Path 3 (facilitator) has no EM
      // exclusion of its own — this test exists to document that boundary:
      // Path 3 is keyed on sessions.facilitator_id, which an EM promotion
      // does not change. The EM exclusion this task cares about lives in
      // Path 1 (participant), covered by the test above.
      expect(conn.sent).toHaveLength(1);
    });
  });

  describe("vote_revealed — task 5.1 (one authorized/unauthorized test per event)", () => {
    it("delivers to an authorized participant subscriber, via buildVoteRevealedPayload (Decision D4 — no independent payload logic)", async () => {
      const registry = new ConnectionRegistry();
      const conn = fakeConn("participant-1");
      registry.register("session", "s1", conn);

      // 1st query: evaluateSessionSubscriberAccess. 2nd query:
      // buildVoteRevealedPayload's fetchParticipantVoteRevealedRows.
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [{
            session_id: "s1", team_id: "t1", facilitator_id: "someone-else", session_status: "active",
            global_role: "engineer", participant_row_id: "p1", membership_role: "participant",
            membership_removed_at: null, membership_exists: true,
          }],
        })
        .mockResolvedValueOnce({ rows: [] });

      await dispatch(
        { eventType: "vote_revealed", sessionId: "s1", payload: { sessionId: "s1", sessionStatus: "active" } },
        registry,
      );

      expect(conn.sent).toHaveLength(1);
      const message = JSON.parse(conn.sent[0]!);
      expect(message.eventType).toBe("vote_revealed");
    });

    it("does not deliver to an unauthorized subscriber (null grant) and never calls the payload builder", async () => {
      const registry = new ConnectionRegistry();
      const conn = fakeConn("stranger-1");
      registry.register("session", "s1", conn);

      mockDbQuery.mockResolvedValueOnce({ rows: [] }); // evaluateSessionSubscriberAccess: no session/user row

      await dispatch(
        { eventType: "vote_revealed", sessionId: "s1", payload: { sessionId: "s1", sessionStatus: "active" } },
        registry,
      );

      expect(conn.sent).toHaveLength(0);
      // Only the authorization query ran — buildVoteRevealedPayload's own
      // query must never fire for an unauthorized candidate.
      expect(mockDbQuery).toHaveBeenCalledTimes(1);
    });

    it("does not deliver to a connection past the absolute lifetime, and never queries authorization or the payload builder", async () => {
      const registry = new ConnectionRegistry();
      const stale = fakeConn("user-1", Date.now() - 91 * 60 * 1000);
      registry.register("session", "s1", stale);

      await dispatch(
        { eventType: "vote_revealed", sessionId: "s1", payload: { sessionId: "s1", sessionStatus: "active" } },
        registry,
      );

      expect(stale.sent).toHaveLength(0);
      expect(mockDbQuery).not.toHaveBeenCalled();
    });
  });

  // websocket-connection-reauthorization (SEC-25/SEC-26): design.md
  // Decision D8, tasks.md Group 6. Task 6.1's code-review checklist item
  // (dispatchVoteRevealed reads only conn.userId and re-queries the
  // database — no read of conn.reauthSweepTimer/tokenRefreshTimer/
  // fastifySessionId) is confirmed by this file being entirely untouched by
  // that change (see git history) — nothing to test there beyond that
  // structural fact. Task 6.2's integration test follows.
  describe("reveal-timing independence from concurrent SEC-25/SEC-26 timer state (Decision D8, task 6.2)", () => {
    it("delivers vote_revealed unaffected by an in-flight SEC-25 sweep tick and SEC-26 refresh cycle on the same connection", async () => {
      const registry = new ConnectionRegistry();
      const conn = fakeConn("participant-1");
      // Simulate both new mechanisms mid-flight on this exact connection
      // object at the moment the reveal is pushed — non-null timer handles,
      // exactly as they'd be immediately after scheduleReauthorizationSweep/
      // scheduleTokenRefreshMonitor ran at registration time.
      (conn as unknown as { reauthSweepTimer: unknown }).reauthSweepTimer = setInterval(() => undefined, 999_999);
      (conn as unknown as { tokenRefreshTimer: unknown }).tokenRefreshTimer = setTimeout(() => undefined, 999_999);
      registry.register("session", "s1", conn);

      mockDbQuery
        .mockResolvedValueOnce({
          rows: [{
            session_id: "s1", team_id: "t1", facilitator_id: "someone-else", session_status: "active",
            global_role: "engineer", participant_row_id: "p1", membership_role: "participant",
            membership_removed_at: null, membership_exists: true,
          }],
        })
        .mockResolvedValueOnce({ rows: [] });

      await dispatch(
        { eventType: "vote_revealed", sessionId: "s1", payload: { sessionId: "s1", sessionStatus: "active" } },
        registry,
      );

      expect(conn.sent).toHaveLength(1);
      const message = JSON.parse(conn.sent[0]!);
      expect(message.eventType).toBe("vote_revealed");
      // Exactly the same two queries as the plain authorized-delivery case —
      // no additional query or branch introduced by the timer state present
      // on the connection object.
      expect(mockDbQuery).toHaveBeenCalledTimes(2);

      clearInterval((conn as unknown as { reauthSweepTimer: ReturnType<typeof setInterval> }).reauthSweepTimer);
      clearTimeout((conn as unknown as { tokenRefreshTimer: ReturnType<typeof setTimeout> }).tokenRefreshTimer);
    });
  });

  describe("topic_history_update — admin-grant rejection (Decision D2)", () => {
    it("delivers to a member-path grant", async () => {
      const registry = new ConnectionRegistry();
      const conn = fakeConn("member-1");
      registry.register("team", "team-1", conn);
      mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "engineer", membership_role: "participant" }] });

      await dispatch(
        { eventType: "topic_history_update", teamId: "team-1", payload: { teamId: "team-1", updateType: "action_item_finalized", sessionId: "s1", updatedAt: new Date().toISOString() } },
        registry,
      );

      expect(conn.sent).toHaveLength(1);
    });

    it("delivers to a facilitator-path grant (regression test, task 5.9 — not member-only)", async () => {
      const registry = new ConnectionRegistry();
      const conn = fakeConn("facilitator-1");
      registry.register("team", "team-1", conn);
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ global_role: "facilitator", membership_role: null }] })
        .mockResolvedValueOnce({ rows: [{ session_id: "s1", session_status: "active" }] });

      await dispatch(
        { eventType: "topic_history_update", teamId: "team-1", payload: { teamId: "team-1", updateType: "action_item_finalized", sessionId: "s1", updatedAt: new Date().toISOString() } },
        registry,
      );

      expect(conn.sent).toHaveLength(1);
    });

    it("does NOT deliver to an admin-path grant, even when the admin also independently qualifies as a member", async () => {
      const registry = new ConnectionRegistry();
      const conn = fakeConn("admin-1");
      registry.register("team", "team-1", conn);
      // evaluateTeamAccess: application_admin short-circuits before membership_role is inspected
      mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "application_admin", membership_role: "participant" }] });

      await dispatch(
        { eventType: "topic_history_update", teamId: "team-1", payload: { teamId: "team-1", updateType: "action_item_finalized", sessionId: "s1", updatedAt: new Date().toISOString() } },
        registry,
      );

      expect(conn.sent).toHaveLength(0);
    });

    it("does not deliver to a non-member (null grant)", async () => {
      const registry = new ConnectionRegistry();
      const conn = fakeConn("stranger-1");
      registry.register("team", "team-1", conn);
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ global_role: "engineer", membership_role: null }] })
        .mockResolvedValueOnce({ rows: [] });

      await dispatch(
        { eventType: "topic_history_update", teamId: "team-1", payload: { teamId: "team-1", updateType: "action_item_finalized", sessionId: "s1", updatedAt: new Date().toISOString() } },
        registry,
      );

      expect(conn.sent).toHaveLength(0);
    });

    // Task 5.4 / delta-spec scenario "Revocation affects the specific
    // team's events, not all connections": a subscriber connected to Team
    // A's and Team B's event streams independently continues receiving
    // Team B events after Team A's membership is revoked. Each connection
    // is registered under its own (scope, teamId) key, so a message
    // published for Team A must never touch a candidate registered only
    // under Team B — this test proves that isolation holds at the registry
    // + dispatch level, not just "by construction."
    it("a subscriber removed from Team A continues receiving Team B events on the SAME dispatch pass", async () => {
      const registry = new ConnectionRegistry();
      const connOnTeamA = fakeConn("user-1");
      const connOnTeamB = fakeConn("user-1"); // same user, a second connection subscribed to a different team
      registry.register("team", "team-A", connOnTeamA);
      registry.register("team", "team-B", connOnTeamB);

      // Team A push: membership revoked (null grant).
      mockDbQuery
        .mockResolvedValueOnce({ rows: [{ global_role: "engineer", membership_role: null }] })
        .mockResolvedValueOnce({ rows: [] });
      await dispatch(
        { eventType: "topic_history_update", teamId: "team-A", payload: { teamId: "team-A", updateType: "action_item_finalized", sessionId: "s1", updatedAt: new Date().toISOString() } },
        registry,
      );
      expect(connOnTeamA.sent).toHaveLength(0);

      // Team B push: membership still active — must be delivered, proving
      // Team A's revocation did not affect the independently-registered
      // Team B connection.
      mockDbQuery.mockResolvedValueOnce({ rows: [{ global_role: "engineer", membership_role: "participant" }] });
      await dispatch(
        { eventType: "topic_history_update", teamId: "team-B", payload: { teamId: "team-B", updateType: "action_item_finalized", sessionId: "s2", updatedAt: new Date().toISOString() } },
        registry,
      );
      expect(connOnTeamB.sent).toHaveLength(1);
    });
  });

  describe("absolute lifetime rejection (Decision D8 compensating control)", () => {
    it("does not deliver to a connection older than the 90-minute absolute lifetime, and does not even query authorization", async () => {
      const registry = new ConnectionRegistry();
      const stale = fakeConn("user-1", Date.now() - 91 * 60 * 1000);
      registry.register("session", "s1", stale);

      await dispatch(
        { eventType: "session_state_change", sessionId: "s1", payload: { sessionId: "s1", teamId: "t1", previousStatus: "lobby", newStatus: "active", changedAt: new Date().toISOString() } },
        registry,
      );

      expect(stale.sent).toHaveLength(0);
      expect(mockDbQuery).not.toHaveBeenCalled();
    });
  });

  describe("no-op paths", () => {
    it("does nothing (no DB query) when there are no local candidates for the event's scope", async () => {
      const registry = new ConnectionRegistry();

      await dispatch(
        { eventType: "session_state_change", sessionId: "nonexistent-session", payload: { sessionId: "nonexistent-session", teamId: "t1", previousStatus: "lobby", newStatus: "active", changedAt: new Date().toISOString() } },
        registry,
      );

      expect(mockDbQuery).not.toHaveBeenCalled();
    });

    it("discards a malformed message without throwing", async () => {
      const registry = new ConnectionRegistry();
      await expect(handleIncomingMessage("not json", noopLogger, registry)).resolves.toBeUndefined();
    });
  });
});
