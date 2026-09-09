import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import type { PoolClient } from "pg";
import { db } from "../db.js";
import type { SessionData } from "../auth/session-store.js";
import { emitAuditEvent } from "../auth/audit-logger.js";
import {
  publishSessionStateChange,
  publishVoteRevealed,
  publishTopicHistoryUpdate,
} from "../realtime/ws-pubsub.js";
import type {
  RevealFailureResponse,
  RevealAlreadyRevealedResponse,
  TopicAdvanceBlockedResponse,
  FacilitatorSessionStateResponse,
  SessionStatusBannerState,
  SessionStatus,
  StartSessionResponse,
  BeginVotingResponse,
  TopicAdvanceResponse,
} from "@dipstick/shared";

// ---------------------------------------------------------------------------
// recordRevealTriggeredAudit — SEC-13/SEC-14 audit write for the reveal
// action (websocket-delivery-time-authorization design.md Decision D7).
//
// Wired into POST /api/v1/teams/:teamId/sessions/:sessionId/reveal (below),
// in the same transaction as the reveal-status flip (voting -> revealed)
// (session-lifecycle-transitions design.md Decision D2/D3, tasks.md task
// 3.5). GitHub issue #26 is resolved by this change.
// ---------------------------------------------------------------------------
export async function recordRevealTriggeredAudit(
  client: Pick<PoolClient, "query">,
  logger: FastifyBaseLogger,
  params: {
    actorUserId: string;
    actorGlobalRole: string;
    actorIp: string;
    teamId: string;
    sessionId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log
       (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.actorUserId,
      params.actorGlobalRole,
      params.actorIp,
      "session.reveal_triggered",
      params.teamId,
      JSON.stringify({ session_id: params.sessionId }),
    ],
  );

  emitAuditEvent(logger, "session.reveal_triggered", {
    actorUserId: params.actorUserId,
    actorGlobalRole: params.actorGlobalRole,
    actorIp: params.actorIp,
    sessionId: params.sessionId,
    teamId: params.teamId,
  });
}

// ---------------------------------------------------------------------------
// fetchPreSessionActionItems — SESSION-004 (tasks.md task 1.3)
//
// Open/in-progress action items for a team, sourced only from sessions with
// status = 'complete' (draft items from an in-progress wrap_up are
// excluded), oldest first. Staleness is computed at query time as the count
// of the team's completed sessions since each item's updated_at.
//
// Staleness level mapping: the REST API Contract and design.md specify a
// single application_settings.staleness_threshold_sessions value (default
// 2), not four separate per-level thresholds — no code or contract text
// anywhere in this codebase specifies how the four levels
// (none/yellow/orange/red) map onto that one number. This implementation
// steps levels at multiples of the configured threshold (1x/2x/3x); if a
// different mapping is intended, this is the function to revisit.
// ---------------------------------------------------------------------------
function computeStalenessLevel(
  sessionsSinceUpdate: number,
  threshold: number,
): "none" | "yellow" | "orange" | "red" {
  if (sessionsSinceUpdate >= threshold * 3) return "red";
  if (sessionsSinceUpdate >= threshold * 2) return "orange";
  if (sessionsSinceUpdate >= threshold) return "yellow";
  return "none";
}

async function fetchPreSessionActionItems(teamId: string): Promise<StartSessionResponse["actionItems"]> {
  const thresholdResult = await db.query<{ value: string }>(
    `SELECT value FROM application_settings WHERE key = 'staleness_threshold_sessions'`,
  );
  const threshold = parseInt(
    (thresholdResult.rows[0] as { value: string } | undefined)?.value ?? "2",
    10,
  );

  const itemsResult = await db.query<{
    action_item_id: string;
    description: string;
    owner_user_id: string;
    owner_display_name: string;
    status: string;
    originating_session_id: string;
    originating_session_number: number;
    created_at: Date;
    updated_at: Date;
    sessions_since_update: string;
  }>(
    `SELECT
       ai.id AS action_item_id,
       ai.description,
       ai.owner_id AS owner_user_id,
       u.display_name AS owner_display_name,
       ai.status,
       ai.session_id AS originating_session_id,
       s.session_number AS originating_session_number,
       ai.created_at,
       ai.updated_at,
       (SELECT COUNT(*) FROM sessions comp
          WHERE comp.team_id = $1 AND comp.status = 'complete' AND comp.completed_at > ai.updated_at
       ) AS sessions_since_update
     FROM action_items ai
     JOIN users u ON u.id = ai.owner_id
     JOIN sessions s ON s.id = ai.session_id
     WHERE ai.team_id = $1 AND ai.status IN ('open', 'in_progress') AND s.status = 'complete'
     ORDER BY ai.created_at ASC`,
    [teamId],
  );

  return itemsResult.rows.map((row) => ({
    actionItemId: row.action_item_id,
    description: row.description,
    ownerUserId: row.owner_user_id,
    ownerDisplayName: row.owner_display_name,
    status: row.status as "open" | "in_progress",
    originatingSessionId: row.originating_session_id,
    originatingSessionNumber: row.originating_session_number,
    stalenessLevel: computeStalenessLevel(parseInt(row.sessions_since_update, 10), threshold),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}

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

    const actorResult = await db.query<{ global_role: string }>(
      `SELECT global_role FROM users WHERE id = $1`,
      [session.userId],
    );
    const actorGlobalRole = (actorResult.rows[0] as { global_role: string } | undefined)?.global_role ?? "unknown";

    // Transition draft → lobby, and write the SEC-13/SEC-14 audit_log row,
    // in the SAME transaction (websocket-delivery-time-authorization
    // design.md Decision D7, transaction-pattern correction). Not blocked
    // on GitHub issue #26 — this UPDATE already commits today.
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE sessions SET status = 'lobby' WHERE id = $1`,
        [sessionId],
      );

      await client.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          session.userId,
          actorGlobalRole,
          request.ip,
          "session.state_changed",
          teamId,
          JSON.stringify({ session_id: sessionId, prior_status: "draft", new_status: "lobby" }),
        ],
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    emitAuditEvent(request.log, "session.state_changed", {
      actorUserId: session.userId,
      actorGlobalRole,
      actorIp: request.ip,
      sessionId,
      teamId,
      priorStatus: "draft",
      newStatus: "lobby",
    });

    // Publish-after-commit ordering (design.md Decision D2/D7, tasks.md
    // tasks 1.4/7.3): only after the transaction above has committed.
    await publishSessionStateChange(sessionId, {
      sessionId,
      teamId,
      previousStatus: "draft",
      newStatus: "lobby",
      changedAt: new Date().toISOString(),
    });

    return reply.send({ sessionId, teamId, status: "lobby" });
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/sessions/:sessionId/start  (SESSION-004)
  //
  // Transitions lobby -> pre_session, beginning the action item review
  // phase. Returns the team's open/in-progress action items from completed
  // sessions, oldest first, with staleness indicators.
  //
  // session-lifecycle-transitions design.md Decision D1: same
  // authorize/BEGIN/UPDATE/audit/COMMIT/publish-after-commit shape already
  // used by the draft->lobby (/advance) handler above.
  // -------------------------------------------------------------------------
  app.post<{
    Params: { sessionId: string };
  }>("/api/v1/sessions/:sessionId/start", async (request, reply) => {
    const session = request.session as unknown as SessionData;
    const { sessionId } = request.params;

    const sessionResult = await db.query<{
      id: string;
      team_id: string;
      facilitator_id: string;
      status: string;
    }>(
      `SELECT id, team_id, facilitator_id, status FROM sessions WHERE id = $1`,
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
    const teamId = sessionRow.team_id;

    if (sessionRow.facilitator_id !== session.userId) {
      return reply.code(403).send({
        error: {
          category: "forbidden" as const,
          message: "Only the session's facilitator can start the session.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    if (sessionRow.status !== "lobby") {
      return reply.code(409).send({
        error: {
          category: "invalid_request" as const,
          message: `Session cannot be started from status '${sessionRow.status}'.`,
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const actorResult = await db.query<{ global_role: string }>(
      `SELECT global_role FROM users WHERE id = $1`,
      [session.userId],
    );
    const actorGlobalRole = (actorResult.rows[0] as { global_role: string } | undefined)?.global_role ?? "unknown";

    let startedAt: string;
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const updateResult = await client.query<{ started_at: Date }>(
        `UPDATE sessions SET status = 'pre_session', started_at = NOW()
         WHERE id = $1 RETURNING started_at`,
        [sessionId],
      );
      startedAt = (updateResult.rows[0] as { started_at: Date }).started_at.toISOString();

      await client.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          session.userId,
          actorGlobalRole,
          request.ip,
          "session.state_changed",
          teamId,
          JSON.stringify({ session_id: sessionId, prior_status: "lobby", new_status: "pre_session" }),
        ],
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    emitAuditEvent(request.log, "session.state_changed", {
      actorUserId: session.userId,
      actorGlobalRole,
      actorIp: request.ip,
      sessionId,
      teamId,
      priorStatus: "lobby",
      newStatus: "pre_session",
    });

    // Publish-after-commit ordering (design.md Decision D1/D7, tasks.md task 1.4).
    await publishSessionStateChange(sessionId, {
      sessionId,
      teamId,
      previousStatus: "lobby",
      newStatus: "pre_session",
      changedAt: new Date().toISOString(),
    });

    // Task 1.3: open/in-progress action items from the team's completed
    // sessions, oldest first, staleness computed at query time.
    const actionItems = await fetchPreSessionActionItems(teamId);

    const response: StartSessionResponse = {
      sessionId,
      status: "pre_session",
      startedAt,
      actionItems,
      hasOpenItems: actionItems.length > 0,
    };
    return reply.send(response);
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/sessions/:sessionId/begin-voting  (SESSION-005)
  //
  // Transitions pre_session -> active, sets the first topic (by
  // display_order) to voting, and sets sessions.current_topic_id.
  //
  // session-lifecycle-transitions design.md Decision D1: two id spaces are
  // in play here and must never share a variable —
  //   firstSessionTopicId (session_topics.id) drives the session_topics
  //     UPDATE's WHERE id = ...
  //   firstTopicId (topics.id) drives sessions.current_topic_id
  // Both writes commit together in the same transaction or neither does.
  // -------------------------------------------------------------------------
  app.post<{
    Params: { sessionId: string };
  }>("/api/v1/sessions/:sessionId/begin-voting", async (request, reply) => {
    const session = request.session as unknown as SessionData;
    const { sessionId } = request.params;

    const sessionResult = await db.query<{
      id: string;
      team_id: string;
      facilitator_id: string;
      status: string;
      is_first_session: boolean;
    }>(
      `SELECT id, team_id, facilitator_id, status, is_first_session FROM sessions WHERE id = $1`,
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
      is_first_session: boolean;
    };
    const teamId = sessionRow.team_id;

    if (sessionRow.facilitator_id !== session.userId) {
      return reply.code(403).send({
        error: {
          category: "forbidden" as const,
          message: "Only the session's facilitator can begin voting.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    if (sessionRow.status !== "pre_session") {
      return reply.code(409).send({
        error: {
          category: "invalid_request" as const,
          message: `Session cannot begin voting from status '${sessionRow.status}'.`,
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const actorResult = await db.query<{ global_role: string }>(
      `SELECT global_role FROM users WHERE id = $1`,
      [session.userId],
    );
    const actorGlobalRole = (actorResult.rows[0] as { global_role: string } | undefined)?.global_role ?? "unknown";

    let votingStartedAt: string;
    let currentTopic: BeginVotingResponse["currentTopic"];

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const firstTopicResult = await client.query<{
        id: string;
        topic_id: string;
        topic_name: string;
        topic_prompt: string;
        vote_type: string;
        first_session_description: string | null;
      }>(
        `SELECT st.id, st.topic_id, st.topic_name, st.topic_prompt, st.vote_type,
                t.first_session_description
         FROM session_topics st
         JOIN topics t ON t.id = st.topic_id
         WHERE st.session_id = $1 AND st.display_order = 1`,
        [sessionId],
      );

      if (firstTopicResult.rows.length === 0) {
        throw new Error(`Session ${sessionId} has no topic at display_order 1.`);
      }

      const firstTopicRow = firstTopicResult.rows[0] as {
        id: string;
        topic_id: string;
        topic_name: string;
        topic_prompt: string;
        vote_type: string;
        first_session_description: string | null;
      };
      // id-space note (design.md): firstSessionTopicId is session_topics.id,
      // firstTopicId is topics.id — never the same variable against both tables.
      const firstSessionTopicId = firstTopicRow.id;
      const firstTopicId = firstTopicRow.topic_id;

      const updateSessionResult = await client.query<{ voting_started_at: Date }>(
        `UPDATE sessions
         SET status = 'active', voting_started_at = NOW(), current_topic_id = $2
         WHERE id = $1
         RETURNING voting_started_at`,
        [sessionId, firstTopicId],
      );
      votingStartedAt = (updateSessionResult.rows[0] as { voting_started_at: Date }).voting_started_at.toISOString();

      await client.query(
        `UPDATE session_topics SET status = 'voting' WHERE id = $1`,
        [firstSessionTopicId],
      );

      await client.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          session.userId,
          actorGlobalRole,
          request.ip,
          "session.state_changed",
          teamId,
          JSON.stringify({ session_id: sessionId, prior_status: "pre_session", new_status: "active" }),
        ],
      );

      await client.query("COMMIT");

      currentTopic = {
        sessionTopicId: firstSessionTopicId,
        topicName: firstTopicRow.topic_name,
        topicPrompt: firstTopicRow.topic_prompt,
        voteType: firstTopicRow.vote_type as BeginVotingResponse["currentTopic"]["voteType"],
        phase: "voting",
        firstSessionDescription: sessionRow.is_first_session ? firstTopicRow.first_session_description : null,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    emitAuditEvent(request.log, "session.state_changed", {
      actorUserId: session.userId,
      actorGlobalRole,
      actorIp: request.ip,
      sessionId,
      teamId,
      priorStatus: "pre_session",
      newStatus: "active",
    });

    // Publish-after-commit ordering (design.md Decision D1/D7, tasks.md task 1.7).
    await publishSessionStateChange(sessionId, {
      sessionId,
      teamId,
      previousStatus: "pre_session",
      newStatus: "active",
      changedAt: new Date().toISOString(),
    });

    const response: BeginVotingResponse = {
      sessionId,
      status: "active",
      votingStartedAt,
      currentTopic,
    };
    return reply.send(response);
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

    const actorResult = await db.query<{ global_role: string }>(
      `SELECT global_role FROM users WHERE id = $1`,
      [session.userId],
    );
    const actorGlobalRole = (actorResult.rows[0] as { global_role: string } | undefined)?.global_role ?? "unknown";

    // Task 8.8: Set both status and facilitator_access_expires_at in the SAME
    // database transaction. Also writes the SEC-13/SEC-14 audit_log row in
    // the same transaction (websocket-delivery-time-authorization design.md
    // Decision D7, transaction-pattern correction) — not blocked on GitHub
    // issue #26, this UPDATE already commits today. If any statement fails,
    // nothing commits.
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE sessions
         SET status = 'complete',
             completed_at = NOW(),
             facilitator_access_expires_at = NOW() + INTERVAL '30 minutes'
         WHERE id = $1`,
        [sessionId],
      );

      await client.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          session.userId,
          actorGlobalRole,
          request.ip,
          "session.state_changed",
          teamId,
          JSON.stringify({ session_id: sessionId, prior_status: sessionRow.status, new_status: "complete" }),
        ],
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    emitAuditEvent(request.log, "session.state_changed", {
      actorUserId: session.userId,
      actorGlobalRole,
      actorIp: request.ip,
      sessionId,
      teamId,
      priorStatus: sessionRow.status,
      newStatus: "complete",
    });

    // Publish-after-commit ordering (design.md Decision D2/D7, tasks.md
    // tasks 1.4/7.3): only after the transaction above has committed.
    await publishSessionStateChange(sessionId, {
      sessionId,
      teamId,
      previousStatus: sessionRow.status as SessionStatus,
      newStatus: "complete",
      changedAt: new Date().toISOString(),
    });

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
  // session-lifecycle-transitions design.md Decision D2/D3: this endpoint
  // now performs the actual reveal write (session_topics.status
  // voting -> revealed), atomically, guarded by a hard precondition. A
  // second reveal on an already-revealed topic returns 409/already_revealed
  // (Error State 1a) rather than the generic reveal_failure body above —
  // Error State 1's recoverable/non-recoverable responses remain for
  // authorization and session-state failures; they do not cover the
  // already-revealed case, which is a success-shaped state, not a failure.
  // -------------------------------------------------------------------------
  app.post<{
    Params: { teamId: string; sessionId: string };
  }>("/api/v1/teams/:teamId/sessions/:sessionId/reveal", async (request, reply) => {
    const userSession = request.session as unknown as SessionData;
    const { teamId, sessionId } = request.params;

    // Query the session to evaluate both the authorization state and the
    // current session status in a single round-trip.
    //
    // current_topic_id (session-lifecycle-transitions design.md Decision D2)
    // is added here — the reveal endpoint's URL carries no sessionTopicId
    // (only teamId/sessionId), so "the current topic" is identified via
    // sessions.current_topic_id. This is a topics.id (design.md's id-space
    // note) — named topicId below.
    const sessionResult = await db.query<{
      id: string;
      team_id: string;
      facilitator_id: string;
      status: string;
      current_topic_id: string | null;
    }>(
      `SELECT id, team_id, facilitator_id, status, current_topic_id
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
      current_topic_id: string | null;
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
    //
    // session-lifecycle-transitions design.md Decision D2/D3: the reveal
    // write itself, atomic and precondition-guarded. topicId is
    // sr.current_topic_id (a topics.id, per the id-space note) — the value
    // that identifies which session_topics row to transition.
    const topicId = sr.current_topic_id;
    if (topicId === null) {
      // An active session with no current topic is not a state this change's
      // own transitions can produce (SESSION-005 always sets current_topic_id
      // when entering 'active'; SESSION-012's wrap-up branch clears it, but
      // that also leaves 'active'). Treat as a non-recoverable state
      // inconsistency rather than attempting a reveal against nothing.
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

    const actorResult = await db.query<{ global_role: string }>(
      `SELECT global_role FROM users WHERE id = $1`,
      [userSession.userId],
    );
    const actorGlobalRole = (actorResult.rows[0] as { global_role: string } | undefined)?.global_role ?? "unknown";

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Decision D2: a conditional UPDATE is the sole concurrency mechanism
      // — Postgres takes the row lock as part of evaluating this statement's
      // own WHERE clause. A second, concurrent reveal for the same topic
      // blocks on that lock, then re-evaluates against the now-committed row
      // and affects zero rows. No separate SELECT ... FOR UPDATE is needed.
      const revealResult = await client.query<{ id: string; revealed_at: Date }>(
        `UPDATE session_topics
         SET status = 'revealed', revealed_at = NOW()
         WHERE session_id = $1 AND topic_id = $2 AND status = 'voting'
         RETURNING id, revealed_at`,
        [sessionId, topicId],
      );

      if (revealResult.rowCount === 0) {
        // The topic was not 'voting' — already revealed, or a stale request.
        // This follow-up read is for response content only; the conditional
        // UPDATE above is the sole concurrency mechanism (Decision D2).
        await client.query("ROLLBACK");

        const alreadyRevealedResult = await db.query<{ id: string; revealed_at: Date }>(
          `SELECT id, revealed_at FROM session_topics WHERE session_id = $1 AND topic_id = $2`,
          [sessionId, topicId],
        );
        const alreadyRevealedRow = alreadyRevealedResult.rows[0] as
          | { id: string; revealed_at: Date }
          | undefined;

        const body: RevealAlreadyRevealedResponse = {
          errorState: "already_revealed",
          sessionId,
          teamId,
          sessionTopicId: alreadyRevealedRow?.id ?? "",
          revealedAt: alreadyRevealedRow?.revealed_at.toISOString() ?? new Date().toISOString(),
        };
        return reply.code(409).send(body);
      }

      // Decision D2/D3: recordRevealTriggeredAudit is called in the SAME
      // transaction as the reveal write, so the audit row and the state
      // transition commit — or roll back — atomically. This is now the real
      // call site (issue #26 is resolved by this change).
      await recordRevealTriggeredAudit(client, request.log, {
        actorUserId: userSession.userId,
        actorGlobalRole,
        actorIp: request.ip,
        teamId,
        sessionId,
      });

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Publish-after-commit ordering: only after the transaction above has
    // committed — never before, never inside it. This is now the real call
    // site (issue #26 is resolved by this change).
    await publishVoteRevealed(sessionId, {
      sessionId,
      sessionStatus: sr.status as SessionStatus,
    });

    return reply.code(200).send({
      revealed: true,
      sessionId,
      teamId,
      sessionStatus: sr.status,
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/teams/:teamId/sessions/:sessionId/topics/advance  (SESSION-012)
  //
  // Topic-to-topic advance and active -> wrap_up entry, one endpoint
  // branching on whether a next topic exists in display_order (design.md
  // Decision D4). Guarded by a hard precondition: the current topic must be
  // 'revealed'.
  // -------------------------------------------------------------------------
  app.post<{
    Params: { teamId: string; sessionId: string };
  }>("/api/v1/teams/:teamId/sessions/:sessionId/topics/advance", async (request, reply) => {
    const userSession = request.session as unknown as SessionData;
    const { teamId, sessionId } = request.params;

    const sessionResult = await db.query<{
      id: string;
      team_id: string;
      facilitator_id: string;
      status: string;
      current_topic_id: string | null;
    }>(
      `SELECT id, team_id, facilitator_id, status, current_topic_id FROM sessions WHERE id = $1`,
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

    const sr = sessionResult.rows[0] as {
      id: string;
      team_id: string;
      facilitator_id: string;
      status: string;
      current_topic_id: string | null;
    };

    // Decision D4's "Authorization, named explicitly" note: both checks the
    // existing advance/complete handlers perform for the same two-path-param
    // shape, not "facilitator only" alone. Both must complete, and pass,
    // before the advance_blocked precondition check below (Decision D3's
    // ordering requirement, mirrored here).
    if (sr.team_id !== teamId) {
      return reply.code(403).send({
        error: {
          category: "forbidden" as const,
          message: "Session does not belong to this team.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    if (sr.facilitator_id !== userSession.userId) {
      return reply.code(403).send({
        error: {
          category: "forbidden" as const,
          message: "Only the facilitator can advance the session's topic.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // topicId is sr.current_topic_id (a topics.id, per the id-space note) —
    // the value that identifies which session_topics row to transition.
    const topicId = sr.current_topic_id;
    if (topicId === null) {
      return reply.code(409).send({
        error: {
          category: "invalid_request" as const,
          message: `Session cannot advance its topic from status '${sr.status}'.`,
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const actorResult = await db.query<{ global_role: string }>(
      `SELECT global_role FROM users WHERE id = $1`,
      [userSession.userId],
    );
    const actorGlobalRole = (actorResult.rows[0] as { global_role: string } | undefined)?.global_role ?? "unknown";

    let response: TopicAdvanceResponse;
    // topics.id of the newly-active topic, for the topic-to-topic branch's
    // post-commit publish. Left null in the wrap-up-entry branch, whose
    // publish reuses topicId (the just-completed topic) instead.
    let publishNextTopicId: string | null = null;

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Decision D2's pattern, applied here: the conditional UPDATE is the
      // sole concurrency mechanism. Extends the RETURNING clause with
      // topic_name/completed_at beyond design.md's literal `RETURNING id` —
      // both are needed to populate TopicAdvanceResponse.completedTopic
      // without a second round-trip; this is an additive read, not a change
      // to the WHERE clause or the locking behavior.
      const completeResult = await client.query<{
        id: string;
        topic_name: string;
        completed_at: Date;
      }>(
        `UPDATE session_topics
         SET status = 'complete', completed_at = NOW()
         WHERE session_id = $1 AND topic_id = $2 AND status = 'revealed'
         RETURNING id, topic_name, completed_at`,
        [sessionId, topicId],
      );

      if (completeResult.rowCount === 0) {
        await client.query("ROLLBACK");

        // Follow-up read for response content only (mirrors Decision D2's
        // already_revealed follow-up read) — design.md's D4 SQL block does
        // not separately spell this out, but TopicAdvanceBlockedResponse
        // requires the current (unrevealed) topic's session_topics.id,
        // which the failed conditional UPDATE did not return.
        const currentTopicRowResult = await db.query<{ id: string }>(
          `SELECT id FROM session_topics WHERE session_id = $1 AND topic_id = $2`,
          [sessionId, topicId],
        );
        const currentSessionTopicId = (currentTopicRowResult.rows[0] as { id: string } | undefined)?.id ?? "";

        const body: TopicAdvanceBlockedResponse = {
          errorState: "advance_blocked",
          sessionId,
          teamId,
          sessionTopicId: currentSessionTopicId,
          requiresReveal: true,
        };
        return reply.code(409).send(body);
      }

      const completedRow = completeResult.rows[0] as { id: string; topic_name: string; completed_at: Date };
      const completedSessionTopicId = completedRow.id;

      // Task 4.4: whether a next topic exists in display_order, selecting
      // the denormalized topic fields directly off session_topics — no join
      // to topics (Decision D4a's "Query cost" note).
      const nextTopicResult = await client.query<{
        id: string;
        topic_id: string;
        topic_name: string;
        topic_prompt: string;
        vote_type: string;
      }>(
        `SELECT id, topic_id, topic_name, topic_prompt, vote_type
         FROM session_topics
         WHERE session_id = $1 AND display_order = (
           SELECT display_order + 1 FROM session_topics WHERE session_id = $1 AND topic_id = $2
         )`,
        [sessionId, topicId],
      );

      if (nextTopicResult.rows.length > 0) {
        // Next-topic branch (task 4.7).
        const nextRow = nextTopicResult.rows[0] as {
          id: string;
          topic_id: string;
          topic_name: string;
          topic_prompt: string;
          vote_type: string;
        };
        // id-space note: nextSessionTopicId is session_topics.id,
        // nextTopicId is topics.id — never the same variable against both.
        const nextSessionTopicId = nextRow.id;
        const nextTopicId = nextRow.topic_id;

        await client.query(
          `UPDATE session_topics SET status = 'voting' WHERE id = $1`,
          [nextSessionTopicId],
        );
        await client.query(
          `UPDATE sessions SET current_topic_id = $2 WHERE id = $1`,
          [sessionId, nextTopicId],
        );

        await client.query(
          `INSERT INTO audit_log
             (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            userSession.userId,
            actorGlobalRole,
            request.ip,
            "session.topic_advanced",
            teamId,
            JSON.stringify({
              session_id: sessionId,
              completed_session_topic_id: completedSessionTopicId,
              new_session_topic_id: nextSessionTopicId,
            }),
          ],
        );

        await client.query("COMMIT");

        publishNextTopicId = nextTopicId;
        response = {
          sessionId,
          teamId,
          status: "active",
          completedTopic: {
            sessionTopicId: completedSessionTopicId,
            topicName: completedRow.topic_name,
            completedAt: completedRow.completed_at.toISOString(),
          },
          currentTopic: {
            sessionTopicId: nextSessionTopicId,
            topicName: nextRow.topic_name,
            topicPrompt: nextRow.topic_prompt,
            voteType: nextRow.vote_type as "finger" | "roman" | "modified_roman",
            phase: "voting",
          },
        };
      } else {
        // Wrap-up-entry branch (task 4.8). Additive RETURNING beyond
        // design.md's literal SQL, needed to populate
        // TopicAdvanceResponse.wrapUpStartedAt without a second round-trip.
        const wrapUpResult = await client.query<{ wrap_up_started_at: Date }>(
          `UPDATE sessions
           SET status = 'wrap_up', wrap_up_started_at = NOW(), current_topic_id = NULL
           WHERE id = $1
           RETURNING wrap_up_started_at`,
          [sessionId],
        );
        const wrapUpStartedAt = (wrapUpResult.rows[0] as { wrap_up_started_at: Date }).wrap_up_started_at.toISOString();

        await client.query(
          `INSERT INTO audit_log
             (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            userSession.userId,
            actorGlobalRole,
            request.ip,
            "session.state_changed",
            teamId,
            JSON.stringify({
              session_id: sessionId,
              prior_status: "active",
              new_status: "wrap_up",
              completed_session_topic_id: completedSessionTopicId,
            }),
          ],
        );

        await client.query("COMMIT");

        response = {
          sessionId,
          teamId,
          status: "wrap_up",
          completedTopic: {
            sessionTopicId: completedSessionTopicId,
            topicName: completedRow.topic_name,
            completedAt: completedRow.completed_at.toISOString(),
          },
          wrapUpStartedAt,
        };
      }
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Structured-log counterpart to the DB audit row (for operational
    // alerting), matching the pattern every other state-transition endpoint
    // in this file already uses (draft->lobby, start, begin-voting,
    // complete, reveal via recordRevealTriggeredAudit) — called after
    // commit, before the publish call(s) below.
    if (response.status === "active") {
      emitAuditEvent(request.log, "session.topic_advanced", {
        actorUserId: userSession.userId,
        actorGlobalRole,
        actorIp: request.ip,
        sessionId,
        teamId,
        completedSessionTopicId: response.completedTopic.sessionTopicId,
        newSessionTopicId: response.currentTopic!.sessionTopicId,
      });
    } else {
      emitAuditEvent(request.log, "session.state_changed", {
        actorUserId: userSession.userId,
        actorGlobalRole,
        actorIp: request.ip,
        sessionId,
        teamId,
        priorStatus: "active",
        newStatus: "wrap_up",
        completedSessionTopicId: response.completedTopic.sessionTopicId,
      });
    }

    // Publish-after-commit ordering — never before, never inside the
    // transaction above.
    if (response.status === "active") {
      await publishTopicHistoryUpdate(teamId, {
        teamId,
        updateType: "topic_advanced",
        sessionId,
        topicId: publishNextTopicId!,
        updatedAt: new Date().toISOString(),
      });
    } else {
      await publishSessionStateChange(sessionId, {
        sessionId,
        teamId,
        previousStatus: "active",
        newStatus: "wrap_up",
        changedAt: new Date().toISOString(),
      });
      // The just-completed last topic's completion is team-content-relevant
      // on its own, independent of the session-phase change (design.md
      // Decision D4). topicId here is the just-completed topic's topics.id.
      await publishTopicHistoryUpdate(teamId, {
        teamId,
        updateType: "topic_advanced",
        sessionId,
        topicId,
        updatedAt: new Date().toISOString(),
      });
    }

    return reply.send(response);
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
