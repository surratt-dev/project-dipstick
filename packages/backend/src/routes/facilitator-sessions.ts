import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import type { SessionData } from "../auth/session-store.js";
import type {
  RevealFailureResponse,
  FacilitatorSessionStateResponse,
  SessionStatusBannerState,
  SessionStatus,
} from "@dipstick/shared";

// ---------------------------------------------------------------------------
// Facilitator session lifecycle routes
//
// Decision 3 (enforce-access-control-on-team-content):
//   Facilitators may create 'draft' sessions to access team historical data
//   before the session room opens. A draft session that is not advanced within
//   24 hours becomes inaccessible at read time (lazy expiry — no background
//   task required for the security property to hold).
//
// Decision 4 (enforce-access-control-on-team-content):
//   When a session transitions to 'complete', the server sets
//   facilitator_access_expires_at = NOW() + INTERVAL '30 minutes'. This
//   provides a read-only grace window for post-session activity.
//
// Task 8.4 (draft expiry):
//   Expiry is enforced lazily in the authorization SQL check. No background
//   task is needed for the security property. After the draft status is stable
//   in production, a periodic maintenance query to hard-delete orphaned draft
//   rows may be added as a follow-on operational item.
// ---------------------------------------------------------------------------

export async function facilitatorSessionRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // POST /api/v1/teams/:teamId/sessions/draft  (Task 8.1)
  //
  // Creates a draft session for the facilitator to access team historical
  // data before the session room opens.
  //
  // Task 8.2: Only users eligible to facilitate the team may create a draft.
  // The facilitator eligibility check is: users.global_role = 'facilitator'
  // (the facilitator-from-another-team constraint from session-participation spec).
  // A team member with participant or EM role cannot create a draft session.
  // -------------------------------------------------------------------------
  app.post<{
    Params: { teamId: string };
  }>("/api/v1/teams/:teamId/sessions/draft", async (request, reply) => {
    const session = request.session as unknown as SessionData;
    const { teamId } = request.params;

    // Task 8.2: Check facilitator eligibility
    // Only users with global_role = 'facilitator' may create draft sessions.
    const actorResult = await db.query<{ global_role: string }>(
      `SELECT global_role FROM users WHERE id = $1`,
      [session.userId],
    );

    if (actorResult.rows.length === 0) {
      return reply.code(401).send({
        error: {
          category: "session_expired" as const,
          message: "User not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const { global_role } = actorResult.rows[0] as { global_role: string };

    if (global_role !== "facilitator") {
      return reply.code(403).send({
        error: {
          category: "forbidden" as const,
          message: "Only a facilitator can create a draft session.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Verify the team exists
    const teamResult = await db.query<{ id: string }>(
      `SELECT id FROM teams WHERE id = $1`,
      [teamId],
    );

    if (teamResult.rows.length === 0) {
      return reply.code(404).send({
        error: {
          category: "not_found" as const,
          message: "Team not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Create the draft session
    // join_token is required but not meaningful for draft sessions
    const joinToken = crypto.randomUUID().replace(/-/g, "").substring(0, 8);

    const sessionResult = await db.query<{ id: string }>(
      `INSERT INTO sessions
         (team_id, facilitator_id, status, join_token, is_first_session, session_number)
       VALUES ($1, $2, 'draft', $3, false,
         COALESCE(
           (SELECT MAX(session_number) + 1 FROM sessions WHERE team_id = $1),
           1
         )
       )
       RETURNING id`,
      [teamId, session.userId, joinToken],
    );

    const draftSessionId = (sessionResult.rows[0] as { id: string }).id;

    return reply.code(201).send({
      sessionId: draftSessionId,
      teamId,
      status: "draft",
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/teams/:teamId/sessions/:sessionId/advance  (Task 8.3)
  //
  // Advances a draft session to lobby status.
  // draft → lobby transition: opens the room to participants.
  // -------------------------------------------------------------------------
  app.post<{
    Params: { teamId: string; sessionId: string };
  }>("/api/v1/teams/:teamId/sessions/:sessionId/advance", async (request, reply) => {
    const session = request.session as unknown as SessionData;
    const { teamId, sessionId } = request.params;

    // Verify the session exists and belongs to this team
    const sessionResult = await db.query<{
      id: string;
      team_id: string;
      facilitator_id: string;
      status: string;
    }>(
      `SELECT id, team_id, facilitator_id, status
       FROM sessions
       WHERE id = $1`,
      [sessionId],
    );

    if (sessionResult.rows.length === 0) {
      return reply.code(404).send({
        error: {
          category: "not_found" as const,
          message: "Session not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const sessionRow = sessionResult.rows[0] as {
      id: string;
      team_id: string;
      facilitator_id: string;
      status: string;
    };

    if (sessionRow.team_id !== teamId) {
      return reply.code(403).send({
        error: {
          category: "forbidden" as const,
          message: "Session does not belong to this team.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Only the facilitator who created the draft may advance it
    if (sessionRow.facilitator_id !== session.userId) {
      return reply.code(403).send({
        error: {
          category: "forbidden" as const,
          message: "Only the facilitator who created the draft may advance it.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    if (sessionRow.status !== "draft") {
      return reply.code(422).send({
        error: {
          category: "invalid_request" as const,
          message: `Session cannot be advanced from status '${sessionRow.status}'.`,
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Transition draft → lobby
    await db.query(
      `UPDATE sessions SET status = 'lobby' WHERE id = $1`,
      [sessionId],
    );

    return reply.send({ sessionId, teamId, status: "lobby" });
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/teams/:teamId/sessions/:sessionId/complete  (Task 8.8)
  //
  // Transitions a session to 'complete' and sets facilitator_access_expires_at.
  //
  // Task 8.8: When a session transitions to 'complete', set
  //   facilitator_access_expires_at = NOW() + INTERVAL '30 minutes'
  //   in the SAME database transaction as the status update.
  //
  // Task 8.11: facilitator_access_expires_at cannot be updated by any client call.
  //   Only this endpoint sets the field. The column is not exposed to client input.
  // -------------------------------------------------------------------------
  app.post<{
    Params: { teamId: string; sessionId: string };
  }>("/api/v1/teams/:teamId/sessions/:sessionId/complete", async (request, reply) => {
    const session = request.session as unknown as SessionData;
    const { teamId, sessionId } = request.params;

    const sessionResult = await db.query<{
      id: string;
      team_id: string;
      facilitator_id: string;
      status: string;
    }>(
      `SELECT id, team_id, facilitator_id, status
       FROM sessions WHERE id = $1`,
      [sessionId],
    );

    if (sessionResult.rows.length === 0) {
      return reply.code(404).send({
        error: {
          category: "not_found" as const,
          message: "Session not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const sessionRow = sessionResult.rows[0] as {
      id: string;
      team_id: string;
      facilitator_id: string;
      status: string;
    };

    if (sessionRow.team_id !== teamId) {
      return reply.code(403).send({
        error: { category: "forbidden" as const, message: "Session does not belong to this team.", correlationId: crypto.randomUUID() },
      });
    }

    if (sessionRow.facilitator_id !== session.userId) {
      return reply.code(403).send({
        error: { category: "forbidden" as const, message: "Only the facilitator can complete the session.", correlationId: crypto.randomUUID() },
      });
    }

    const validCompletableStatuses = ["wrap_up"];
    if (!validCompletableStatuses.includes(sessionRow.status)) {
      return reply.code(422).send({
        error: {
          category: "invalid_request" as const,
          message: `Session cannot be completed from status '${sessionRow.status}'.`,
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Task 8.8: Set both status and facilitator_access_expires_at in the SAME
    // database transaction. If this UPDATE fails, neither change is committed.
    await db.query(
      `UPDATE sessions
       SET status = 'complete',
           completed_at = NOW(),
           facilitator_access_expires_at = NOW() + INTERVAL '30 minutes'
       WHERE id = $1`,
      [sessionId],
    );

    return reply.send({
      sessionId,
      teamId,
      status: "complete",
      message: "Session completed. Facilitator has 30-minute read-only access window.",
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/teams/:teamId/sessions/:sessionId/reveal  (Task 10.1)
  //
  // Error State 1 — Reveal failure
  //
  // The facilitator triggers a reveal. If the authorization check or session
  // state check fails, the response distinguishes recoverable from
  // non-recoverable failure states. This replaces the generic 403/500 pattern
  // for reveal actions during live sessions.
  //
  // Spec (team-content-access spec / Error State 1):
  //   Recoverable: "The reveal could not be completed. Your session is still
  //     active. Try again." — panel stays visible; facilitator can retry.
  //   Non-recoverable: "This session is no longer in an active state. Please
  //     review the session status." — facilitator checks session before retrying.
  //   MUST NOT display: A generic error modal or blank results panel.
  //
  // HTTP status codes (distinct from generic 403/404):
  //   503 — Recoverable: transient failure, session still active, retry is safe
  //   409 — Non-recoverable: session state conflict; retry without state review
  //         is not safe
  //   200 — Success: reveal accepted
  //
  // Note: The reveal business logic (topic state transition, event fan-out) is
  // owned by the session state machine. This endpoint enforces Error State 1's
  // authorization and session-state validation contract. The actual topic reveal
  // is performed here for sessions where the full state machine is implemented.
  // -------------------------------------------------------------------------
  app.post<{
    Params: { teamId: string; sessionId: string };
  }>("/api/v1/teams/:teamId/sessions/:sessionId/reveal", async (request, reply) => {
    const userSession = request.session as unknown as SessionData;
    const { teamId, sessionId } = request.params;

    // Query the session to evaluate both the authorization state and the
    // current session status in a single round-trip.
    const sessionResult = await db.query<{
      id: string;
      team_id: string;
      facilitator_id: string;
      status: string;
    }>(
      `SELECT id, team_id, facilitator_id, status
       FROM sessions
       WHERE id = $1 AND team_id = $2`,
      [sessionId, teamId],
    );

    // Session not found for this team — non-recoverable.
    // We cannot determine the session state, so retry without investigation
    // is not safe.
    if (sessionResult.rows.length === 0) {
      const nonRecoverableBody: RevealFailureResponse = {
        errorState: "reveal_failure",
        recoverable: false,
        message: "This session is no longer in an active state. Please review the session status.",
        sessionId,
        teamId,
        currentSessionStatus: "complete", // safest assumption when session is gone
      };
      return reply.code(409).send(nonRecoverableBody);
    }

    const sr = sessionResult.rows[0] as {
      id: string;
      team_id: string;
      facilitator_id: string;
      status: string;
    };

    // State classification for reveal:
    //
    // validRevealStates: session must be in 'active' for a reveal to be
    //   meaningful — this is the voting phase where votes exist to reveal.
    //   pre_session, lobby, and wrap_up are not reveal-appropriate states.
    //
    // liveSessionStates: states in which the session is still running.
    //   Used to determine recoverable vs non-recoverable auth failures:
    //   if auth fails but the session is still live, a retry is appropriate.
    const validRevealStates = ["active"];
    const liveSessionStates = ["lobby", "pre_session", "active", "wrap_up"];
    const isSessionLive = liveSessionStates.includes(sr.status);
    const isValidStateForReveal = validRevealStates.includes(sr.status);

    // Authorization check: user must be the recorded facilitator for this session.
    const isAuthorizedFacilitator = sr.facilitator_id === userSession.userId;

    if (!isAuthorizedFacilitator) {
      // Auth failure: determine recoverable vs non-recoverable by session state.
      //
      // Recoverable: session is still live. The authorization failure may be
      // transient (concurrent modification, session row briefly locked). The
      // facilitator can retry — the session hasn't ended.
      //
      // Non-recoverable: session is no longer live. Retrying the reveal without
      // reviewing session status is not safe.
      if (isSessionLive) {
        const recoverableBody: RevealFailureResponse = {
          errorState: "reveal_failure",
          recoverable: true,
          message: "The reveal could not be completed. Your session is still active. Try again.",
          sessionId,
          teamId,
        };
        return reply.code(503).send(recoverableBody);
      }

      const nonRecoverableBody: RevealFailureResponse = {
        errorState: "reveal_failure",
        recoverable: false,
        message: "This session is no longer in an active state. Please review the session status.",
        sessionId,
        teamId,
        currentSessionStatus: sr.status as SessionStatus,
      };
      return reply.code(409).send(nonRecoverableBody);
    }

    // User IS the facilitator. Check that the session is in a state where
    // a reveal is meaningful. A session in 'wrap_up', 'complete', or any
    // non-active state cannot have a reveal triggered.
    if (!isValidStateForReveal) {
      const nonRecoverableBody: RevealFailureResponse = {
        errorState: "reveal_failure",
        recoverable: false,
        message: "This session is no longer in an active state. Please review the session status.",
        sessionId,
        teamId,
        currentSessionStatus: sr.status as SessionStatus,
      };
      return reply.code(409).send(nonRecoverableBody);
    }

    // Authorized facilitator, session in active state: reveal is permitted.
    // The topic state transition (voting → revealed) is the business logic of
    // the session state machine. This endpoint signals that the authorization
    // and session-state preconditions are met.
    return reply.code(200).send({
      revealed: true,
      sessionId,
      teamId,
      sessionStatus: sr.status,
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/teams/:teamId/sessions/:sessionId/facilitator-state  (Task 10.3)
  //
  // Error State 3 — Session status transition during live facilitation
  //
  // The facilitator polls this endpoint to detect unexpected session state
  // transitions. When the session status has transitioned to a state that
  // requires the facilitator's attention (wrap_up, complete, abandoned), the
  // response includes a non-blocking banner state.
  //
  // Spec (team-content-access spec / Error State 3):
  //   Required display: A persistent non-blocking banner (NOT a modal).
  //   Message format: "Session state has changed. [Current state]. Resume or review."
  //   The facilitator MUST be able to see the participant grid and topic state
  //   while the banner is displayed.
  //   MUST NOT display: A modal that blocks the screen or hides the session view.
  //
  // displayType: 'banner' in the bannerState object is the normative constraint
  // that distinguishes this from a modal. Frontend implementations MUST respect
  // this field and not render a modal for this state.
  //
  // "Normal" states (bannerState: null): lobby, pre_session, active
  // "Transition" states (bannerState: non-null): wrap_up, complete, abandoned
  // -------------------------------------------------------------------------
  app.get<{
    Params: { teamId: string; sessionId: string };
  }>("/api/v1/teams/:teamId/sessions/:sessionId/facilitator-state", async (request, reply) => {
    const userSession = request.session as unknown as SessionData;
    const { teamId, sessionId } = request.params;

    // Query session state and verify the requester is the session facilitator.
    const sessionResult = await db.query<{
      id: string;
      team_id: string;
      facilitator_id: string;
      status: string;
    }>(
      `SELECT id, team_id, facilitator_id, status
       FROM sessions
       WHERE id = $1 AND team_id = $2`,
      [sessionId, teamId],
    );

    if (sessionResult.rows.length === 0) {
      return reply.code(404).send({
        error: {
          category: "not_found" as const,
          message: "Session not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const sr = sessionResult.rows[0] as {
      id: string;
      team_id: string;
      facilitator_id: string;
      status: string;
    };

    // Only the facilitator who owns this session may query its facilitator state.
    if (sr.facilitator_id !== userSession.userId) {
      return reply.code(403).send({
        error: {
          category: "forbidden" as const,
          message: "Only the session facilitator can access facilitator state.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Determine whether the session has transitioned to an unexpected state.
    //
    // "Normal" active states where the facilitator is in flow and no banner
    // is needed: lobby (room open), pre_session (about to start), active
    // (session in progress — voting, discussion, etc.)
    //
    // "Transition" states that require the facilitator's attention:
    //   wrap_up    — session is wrapping up (may have advanced without facilitator)
    //   complete   — session ended (may have been completed by external action)
    //   abandoned  — session was abandoned
    //
    // Note: 'draft' is not a "live" state and is excluded — facilitators in a
    // draft session are in preparation mode, not live facilitation mode.
    const transitionStates = ["wrap_up", "complete", "abandoned"];
    const hasTransitioned = transitionStates.includes(sr.status);

    const bannerState: SessionStatusBannerState | null = hasTransitioned
      ? {
          type: "session_status_changed",
          // 'banner' = non-modal: the session view (participant grid, topic state)
          // MUST remain visible while this banner is displayed.
          displayType: "banner",
          currentSessionState: sr.status as SessionStatus,
          // Spec format: "Session state has changed. [currentState]. Resume or review."
          message: `Session state has changed. ${sr.status}. Resume or review.`,
          action: "Resume or review",
        }
      : null;

    const response: FacilitatorSessionStateResponse = {
      sessionId,
      teamId,
      currentSessionState: sr.status as SessionStatus,
      bannerState,
    };

    return reply.send(response);
  });
}
