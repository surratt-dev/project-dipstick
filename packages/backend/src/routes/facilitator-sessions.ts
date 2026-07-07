import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import type { SessionData } from "../auth/session-store.js";

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
}
