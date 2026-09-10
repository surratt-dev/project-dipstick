import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db.js";
import { emitAuditEvent } from "../auth/audit-logger.js";
import { evaluateTeamAccess } from "../auth/team-content-access-helper.js";
import {
  serializeForMemberParticipant,
  serializeForMemberEM,
  serializeForFacilitator,
  buildParticipantQueryResult,
  buildEMQueryResult,
  buildFacilitatorQueryResult,
} from "../content/team-content-serializers.js";
import { applyTimingFloor } from "../content/timing-oracle.js";
import type { SessionData } from "../auth/session-store.js";
import type {
  TeamAccessGrant,
  FacilitatorHistoricalDataUnavailable,
  FacilitatorTrendDataUnavailable,
  FacilitatorContentView,
  ConnectionRecoveryEntry,
} from "@dipstick/shared";

// ---------------------------------------------------------------------------
// Team content routes — enforce-access-control-on-team-content
//
// All routes in this module enforce Decision 7's authorization-before-lookup
// pattern: the authorization helper is called BEFORE any resource query.
// An unauthorized caller receives 403 without the server revealing whether
// the resource exists.
//
// Authorization gate (Task 5.6):
//   1. Call evaluateTeamAccess(userId, teamId) — live DB read, no cache.
//   2. If null → 403 (no access path matched).
//   3. If { path: 'admin' } → 403 for session content (Decision 2 / Task 5.10).
//   4. If { path: 'member' | 'facilitator' } → proceed with role-appropriate query.
//
// Cache prohibition (Task 5.7):
//   All content endpoint responses include `Cache-Control: no-store`.
//   Prevents HTTP-layer caching by browsers, proxies, and CDNs.
//
// ORM cache prohibition (Task 5.8):
//   evaluateTeamAccess performs live DB reads on every call. node-postgres
//   (pg) does not cache queries. The authorization helper comment documents
//   this explicitly.
//
// Application-session cache prohibition (Task 5.9):
//   Authorization is derived from the database (not from the session cookie's
//   role snapshot) on every request. A role change takes effect immediately
//   on the next content request without requiring re-authentication.
//
// Application Admin session-content denial audit (Task 5.11):
//   When an Application Admin requests a session content endpoint, a 403 is
//   returned AND the audit_log entry is written BEFORE the response is sent.
//   The audit entry includes the HTTP status code.
//
// Timing floor (Decision 7 / Group 6):
//   All content endpoint responses — both authorized and denied — pass through
//   applyTimingFloor() to prevent timing-oracle attacks.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared guard: deny admin access to session content and log the attempt
// Task 5.10 / Task 5.11
// ---------------------------------------------------------------------------
async function denyAdminContentAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  teamId: string,
  endpoint: string,
): Promise<FastifyReply> {
  const session = request.session as unknown as SessionData;

  // Task 5.11: Audit entry MUST be written before the 403 response is sent.
  // The audit entry includes HTTP status code 403.
  await db.query(
    `INSERT INTO audit_log
       (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      session.userId,
      "application_admin",
      request.ip,
      "admin.session_content_denied",
      teamId,
      JSON.stringify({ endpoint, http_status: 403 }),
    ],
  );

  emitAuditEvent(request.log, "admin.session_content_denied", {
    actorUserId: session.userId,
    actorGlobalRole: "application_admin",
    actorIp: request.ip,
    teamId,
    endpoint,
    httpStatus: 403,
  });

  return reply.header("Cache-Control", "no-store").code(403).send({
    error: {
      category: "forbidden" as const,
      message: "Application Admins do not have access to session content.",
      correlationId: crypto.randomUUID(),
    },
  });
}

// ---------------------------------------------------------------------------
// Shared guard: return 403 for any null grant (no access path matched)
// Decision 7: authorization-before-lookup — resource existence is not revealed
// ---------------------------------------------------------------------------
function denyAccess(reply: FastifyReply): FastifyReply {
  return reply.header("Cache-Control", "no-store").code(403).send({
    error: {
      category: "forbidden" as const,
      message: "You do not have access to this team's content.",
      correlationId: crypto.randomUUID(),
    },
  });
}

// ---------------------------------------------------------------------------
// Helper: add Cache-Control: no-store to all content responses
// Task 5.7
// ---------------------------------------------------------------------------
function noStore(reply: FastifyReply): FastifyReply {
  reply.header("Cache-Control", "no-store");
  return reply;
}

// ---------------------------------------------------------------------------
// Error State 4 — Cross-team denial (Task 10.4 / Task 10.5)
//
// When a facilitator in an active session for Team B requests Team A's
// historical data, the response message MUST NOT confirm Team A's existence.
// The message "This data is not available in your current session" communicates
// a session-scope constraint without revealing anything about Team A.
//
// Task 10.5: This response body MUST NOT include Team A's team ID, team name,
// or any other identifier that confirms Team A's existence.
// ---------------------------------------------------------------------------

/**
 * Query whether the user has an active facilitator session for any team OTHER
 * than the requested team. Used to distinguish cross-team denial (Error State 4)
 * from a plain forbidden response.
 *
 * Only live session statuses are checked (draft preparation sessions are not
 * "in session" in the UX sense the spec describes).
 */
async function checkIsFacilitatorInDifferentSession(
  userId: string,
  requestedTeamId: string,
): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM sessions
     WHERE facilitator_id = $1
       AND team_id <> $2
       AND status IN ('lobby', 'pre_session', 'active', 'wrap_up')
     LIMIT 1`,
    [userId, requestedTeamId],
  );
  return result.rows.length > 0;
}

/**
 * 403 response for cross-team facilitator access (Error State 4).
 *
 * Spec message (exact): "This data is not available in your current session"
 * — NOT "You do not have access to Team A's data."
 *
 * No team IDs, team names, or existence-confirming identifiers in the body.
 */
function denyCrossTeamFacilitator(reply: FastifyReply): FastifyReply {
  return reply.header("Cache-Control", "no-store").code(403).send({
    error: {
      category: "forbidden" as const,
      // Task 10.4 / 10.5: Session-context message — confirms nothing about
      // the requested team's identity or existence.
      message: "This data is not available in your current session",
      correlationId: crypto.randomUUID(),
    },
  });
}

/**
 * Unified null-grant denial handler.
 *
 * When evaluateTeamAccess returns null, check whether the user is a facilitator
 * in a different team's session (Error State 4). If so, return the cross-team
 * denial message. Otherwise return the generic forbidden response.
 *
 * The timing floor is applied inside this function so every null-grant path
 * has a single, consistent timing floor call site.
 */
async function denyNullGrant(
  userId: string,
  teamId: string,
  reply: FastifyReply,
  startTime: number,
): Promise<FastifyReply> {
  const isCrossTeamFacilitator = await checkIsFacilitatorInDifferentSession(userId, teamId);
  await applyTimingFloor(startTime);
  if (isCrossTeamFacilitator) {
    return denyCrossTeamFacilitator(reply);
  }
  return denyAccess(reply);
}

// ---------------------------------------------------------------------------
// Error State 2 — Historical data unavailable during active session (Task 10.2)
//
// When a facilitator's trend or session-history data query fails DURING an
// active session, the endpoint returns an empty-state 200 response instead of
// propagating the error as a 500. This communicates a transient data issue,
// NOT an access denial. The facilitator's session is unaffected.
//
// Spec message (exact): "Historical data is temporarily unavailable. Your
// session is still active."
//
// MUST NOT display: A generic 403 or "you do not have access" message in this
// context — that phrasing may cause the facilitator to end the session.
// ---------------------------------------------------------------------------

/**
 * Returns true when the facilitator's session grant covers a live active session.
 * Used to gate Error State 2: only return the "temporarily unavailable" message
 * when the facilitator is in a session that is actively running.
 */
function isFacilitatorInActiveSession(grant: Extract<TeamAccessGrant, { path: "facilitator" }>): boolean {
  return (["lobby", "pre_session", "active", "wrap_up"] as string[]).includes(grant.sessionStatus);
}

/**
 * Empty-state response for Error State 2 — sessions history variant.
 */
function buildHistoricalSessionsUnavailable(): FacilitatorHistoricalDataUnavailable {
  return {
    errorState: "historical_data_unavailable",
    message: "Historical data is temporarily unavailable. Your session is still active.",
    sessions: [],
    sessionActive: true,
  };
}

/**
 * Empty-state response for Error State 2 — trend data variant.
 */
function buildTrendDataUnavailable(): FacilitatorTrendDataUnavailable {
  return {
    errorState: "historical_data_unavailable",
    message: "Historical data is temporarily unavailable. Your session is still active.",
    trends: [],
    sessionActive: true,
  };
}

export async function contentRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // GET /api/v1/teams/:teamId/sessions  (Task 5.1)
  //
  // Returns session history for the team in the role-appropriate serialized
  // shape:
  //   member/participant → ParticipantContentView (aggregate + own votes)
  //   member/engineering_manager → EMContentView (aggregate only)
  //   facilitator → FacilitatorContentView (full data, reveal-gated)
  //   admin → 403 (Decision 2 Option B)
  //   null → 403 (or cross-team denial if facilitator in different session)
  // -------------------------------------------------------------------------
  app.get<{
    Params: { teamId: string };
  }>("/api/v1/teams/:teamId/sessions", async (request, reply) => {
    const startTime = Date.now();
    const session = request.session as unknown as SessionData;
    const { teamId } = request.params;

    // Task 5.6: Authorization check BEFORE any resource query
    // Task 5.8: evaluateTeamAccess uses live DB reads — no cache
    // Task 5.9: authorization is NOT read from the session cookie
    const grant = await evaluateTeamAccess(session.userId, teamId);

    if (grant === null) {
      // Error State 4: detect cross-team facilitator and return session-context message.
      // denyNullGrant applies the timing floor internally.
      return denyNullGrant(session.userId, teamId, reply, startTime);
    }

    // Task 5.10: admin grant is denied for session content endpoints
    if (grant.path === "admin") {
      await applyTimingFloor(startTime);
      return denyAdminContentAccess(request, reply, teamId, "GET /api/v1/teams/:teamId/sessions");
    }

    // Decision 7: Only now do we query the resource. An unauthorized caller
    // never reaches this point, so they cannot determine whether the team exists.
    //
    // Error State 2 (Task 10.2): if the data query fails while the facilitator
    // is in an active session, return an empty-state 200 instead of a 500.
    try {
      const sessionsResult = await db.query<{
        session_id: string;
        session_status: string;
        topic_id: string | null;
        topic_name: string | null;
        reveal_status: string | null;
        flagged_for_discussion: boolean | null;
        voter_id: string | null;
        voter_display_name: string | null;
        vote_value: number | null;
        vote_count: number;
        contains_outlier: boolean;
      }>(
        buildSessionHistoryQuery(grant),
        buildSessionHistoryParams(grant, teamId, session.userId),
      );

      const responseBody = serializeContentResponse(grant, session.userId, sessionsResult.rows);

      if (grant.path === "facilitator") {
        (responseBody as FacilitatorContentView).connectionRecoveries =
          await fetchConnectionRecoveries(grant.sessionId);
      }

      await applyTimingFloor(startTime);
      return noStore(reply).send(responseBody);
    } catch (_err) {
      // Apply timing floor before responding from the error path.
      await applyTimingFloor(startTime);
      if (grant.path === "facilitator" && isFacilitatorInActiveSession(grant)) {
        // Error State 2: transient data failure during active session.
        // Return empty state — NOT a 403 or generic error.
        return noStore(reply).code(200).send(buildHistoricalSessionsUnavailable());
      }
      // Non-facilitator data failure: propagate as 500.
      throw _err;
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/teams/:teamId/trends  (Task 5.2)
  // -------------------------------------------------------------------------
  app.get<{
    Params: { teamId: string };
  }>("/api/v1/teams/:teamId/trends", async (request, reply) => {
    const startTime = Date.now();
    const session = request.session as unknown as SessionData;
    const { teamId } = request.params;

    const grant = await evaluateTeamAccess(session.userId, teamId);

    if (grant === null) {
      // Error State 4: cross-team facilitator detection + timing floor
      return denyNullGrant(session.userId, teamId, reply, startTime);
    }

    if (grant.path === "admin") {
      await applyTimingFloor(startTime);
      return denyAdminContentAccess(request, reply, teamId, "GET /api/v1/teams/:teamId/trends");
    }

    // Trend data: aggregate across complete sessions by topic.
    // Error State 2 (Task 10.2): if the data query fails while the facilitator
    // is in an active session, return an empty-state 200 instead of a 500.
    try {
      const trendResult = await db.query<{
        topic_id: string;
        topic_name: string;
        session_id: string;
        session_date: string;
        session_number: number;
        avg_vote: string | null;
        participant_count: string;
      }>(
        `SELECT
           st.topic_id,
           st.topic_name,
           s.id AS session_id,
           s.completed_at AS session_date,
           s.session_number,
           AVG(v.vote_value)::text AS avg_vote,
           COUNT(DISTINCT sp.user_id)::text AS participant_count
         FROM session_topics st
         JOIN sessions s ON st.session_id = s.id
         LEFT JOIN votes v ON v.session_topic_id = st.id
         LEFT JOIN session_participants sp ON sp.session_id = s.id
         WHERE s.team_id = $1
           AND s.status = 'complete'
         GROUP BY st.topic_id, st.topic_name, s.id, s.completed_at, s.session_number
         ORDER BY st.topic_name, s.completed_at`,
        [teamId],
      );

      await applyTimingFloor(startTime);
      return noStore(reply).send({ teamId, trends: trendResult.rows });
    } catch (_err) {
      await applyTimingFloor(startTime);
      if (grant.path === "facilitator" && isFacilitatorInActiveSession(grant)) {
        // Error State 2: transient data failure for facilitator in active session.
        // Return empty trend state — NOT a 403 or generic error.
        return noStore(reply).code(200).send(buildTrendDataUnavailable());
      }
      throw _err;
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/teams/:teamId/action-items  (Task 5.3)
  // -------------------------------------------------------------------------
  app.get<{
    Params: { teamId: string };
  }>("/api/v1/teams/:teamId/action-items", async (request, reply) => {
    const startTime = Date.now();
    const session = request.session as unknown as SessionData;
    const { teamId } = request.params;

    const grant = await evaluateTeamAccess(session.userId, teamId);

    if (grant === null) {
      // Error State 4: cross-team facilitator detection + timing floor
      return denyNullGrant(session.userId, teamId, reply, startTime);
    }

    if (grant.path === "admin") {
      await applyTimingFloor(startTime);
      return denyAdminContentAccess(request, reply, teamId, "GET /api/v1/teams/:teamId/action-items");
    }

    const result = await db.query<{
      id: string;
      team_id: string;
      session_id: string;
      description: string;
      status: string;
      resolution_note: string | null;
      created_at: Date;
      updated_at: Date;
      owner_display_name: string;
    }>(
      `SELECT
         ai.id, ai.team_id, ai.session_id, ai.description, ai.status,
         ai.resolution_note, ai.created_at, ai.updated_at,
         u.display_name AS owner_display_name
       FROM action_items ai
       JOIN users u ON ai.owner_id = u.id
       WHERE ai.team_id = $1
       ORDER BY ai.created_at DESC`,
      [teamId],
    );

    await applyTimingFloor(startTime);
    return noStore(reply).send({ teamId, actionItems: result.rows });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/teams/:teamId/topics  (Task 5.4)
  // -------------------------------------------------------------------------
  app.get<{
    Params: { teamId: string };
  }>("/api/v1/teams/:teamId/topics", async (request, reply) => {
    const startTime = Date.now();
    const session = request.session as unknown as SessionData;
    const { teamId } = request.params;

    const grant = await evaluateTeamAccess(session.userId, teamId);

    if (grant === null) {
      // Error State 4: cross-team facilitator detection + timing floor
      return denyNullGrant(session.userId, teamId, reply, startTime);
    }

    if (grant.path === "admin") {
      await applyTimingFloor(startTime);
      return denyAdminContentAccess(request, reply, teamId, "GET /api/v1/teams/:teamId/topics");
    }

    const result = await db.query<{
      id: string;
      name: string;
      prompt: string;
      vote_type: string;
      display_order: number;
      status: string;
    }>(
      `SELECT id, name, prompt, vote_type, display_order, status
       FROM topics
       WHERE team_id = $1 AND status = 'active'
       ORDER BY display_order ASC`,
      [teamId],
    );

    await applyTimingFloor(startTime);
    return noStore(reply).send({ teamId, topics: result.rows });
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/teams/:teamId/sessions/:sessionId  (Task 5.5 — live session)
  // -------------------------------------------------------------------------
  app.get<{
    Params: { teamId: string; sessionId: string };
  }>("/api/v1/teams/:teamId/sessions/:sessionId", async (request, reply) => {
    const startTime = Date.now();
    const session = request.session as unknown as SessionData;
    const { teamId, sessionId } = request.params;

    const grant = await evaluateTeamAccess(session.userId, teamId);

    if (grant === null) {
      // Error State 4: cross-team facilitator detection + timing floor
      return denyNullGrant(session.userId, teamId, reply, startTime);
    }

    if (grant.path === "admin") {
      await applyTimingFloor(startTime);
      return denyAdminContentAccess(
        request,
        reply,
        teamId,
        "GET /api/v1/teams/:teamId/sessions/:sessionId",
      );
    }

    // Task 7.3: Authorized caller to nonexistent session → 404
    //
    // Decision 7 / Blocking Issue 2: filter by BOTH id AND team_id so that a
    // session belonging to a different team returns the same 404 as a session
    // that does not exist anywhere. Without team_id = $2, an authorized Team A
    // member could probe whether a Team B UUID exists by observing 403 vs 404.
    const sessionResult = await db.query<{ id: string; team_id: string; status: string }>(
      `SELECT id, team_id, status FROM sessions WHERE id = $1 AND team_id = $2`,
      [sessionId, teamId],
    );

    if (sessionResult.rows.length === 0) {
      await applyTimingFloor(startTime);
      return noStore(reply).code(404).send({
        error: {
          category: "not_found" as const,
          message: "Session not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const sessionRow = sessionResult.rows[0] as { id: string; team_id: string; status: string };

    // Return session state
    await applyTimingFloor(startTime);
    return noStore(reply).send({ sessionId, teamId, status: sessionRow.status });
  });
}

// ---------------------------------------------------------------------------
// fetchConnectionRecoveries — websocket-connection-reauthorization (SEC-26),
// design.md Decision D9, tasks.md task 5.2.
//
// The facilitator-scoped diagnostic trail: SEC-26 grace-period recoveries
// for THIS session, and nothing else. audit_log also holds
// session.access_revoked_live (task 2.3) and session.token_refresh_failed_live
// (task 3.4) rows for the same session — neither is facilitator-visible, and
// disclosing either would leak a SEC-25 revocation cause or a participant's
// auth-failure detail. The filter below is an explicit equality match on
// operation = 'session.connection_recovered' — NEVER a wildcard or prefix
// match across session.* — so those two operations can never leak through
// this query, including if a future operation is added to the same table.
// ---------------------------------------------------------------------------
async function fetchConnectionRecoveries(sessionId: string): Promise<ConnectionRecoveryEntry[]> {
  const result = await db.query<{ actor_user_id: string; timestamp: Date }>(
    `SELECT actor_user_id, timestamp
     FROM audit_log
     WHERE operation = 'session.connection_recovered'
       AND metadata->>'scope' = 'session'
       AND metadata->>'scopeId' = $1
     ORDER BY timestamp DESC`,
    [sessionId],
  );

  return result.rows.map((row) => ({
    userId: row.actor_user_id,
    recoveredAt: new Date(row.timestamp).toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Role-based SQL query builders
// The query sent to the DB differs by grant path to enforce the attribution
// boundary at the query layer (not just in application code).
// ---------------------------------------------------------------------------

function buildSessionHistoryQuery(grant: TeamAccessGrant): string {
  if (grant.path === "member" && grant.role === "engineering_manager") {
    // EM query: NEVER SELECT voter_id (enforced at the query layer per Decision 9)
    return `
      SELECT
        s.id AS session_id,
        s.status AS session_status,
        st.topic_id,
        st.topic_name,
        st.status AS reveal_status,
        st.flagged_for_discussion,
        NULL::uuid AS voter_id,
        NULL::text AS voter_display_name,
        v.vote_value,
        COUNT(v.id)::integer AS vote_count,
        COALESCE(BOOL_OR(v.is_outlier), false) AS contains_outlier
      FROM sessions s
      JOIN session_topics st ON st.session_id = s.id
      LEFT JOIN votes v ON v.session_topic_id = st.id
      WHERE s.team_id = $1
        AND s.status = 'complete'
      GROUP BY s.id, s.status, st.id, st.topic_id, st.topic_name, st.status,
               st.flagged_for_discussion, v.vote_value
      ORDER BY s.completed_at DESC, st.display_order, v.vote_value`;
  }

  if (grant.path === "facilitator") {
    // Facilitator query: includes voter_id and voterDisplayName for revealed topics
    return `
      SELECT
        st.id AS session_id,
        s.status AS session_status,
        st.topic_id,
        st.topic_name,
        st.status AS reveal_status,
        st.flagged_for_discussion,
        v.voter_id,
        u.display_name AS voter_display_name,
        v.vote_value,
        0 AS vote_count,
        false AS contains_outlier
      FROM sessions s
      JOIN session_topics st ON st.session_id = s.id
      LEFT JOIN votes v ON v.session_topic_id = st.id
      LEFT JOIN users u ON u.id = v.voter_id
      WHERE s.team_id = $1
        AND s.id = $2
      ORDER BY st.display_order, u.display_name`;
  }

  // Participant query: SELECT voter_id to identify own vote
  return `
    SELECT
      s.id AS session_id,
      s.status AS session_status,
      st.topic_id,
      st.topic_name,
      st.status AS reveal_status,
      st.flagged_for_discussion,
      v.voter_id,
      NULL::text AS voter_display_name,
      v.vote_value,
      COUNT(v.id) OVER (PARTITION BY st.id, v.vote_value)::integer AS vote_count,
      COALESCE(v.is_outlier, false) AS contains_outlier
    FROM sessions s
    JOIN session_topics st ON st.session_id = s.id
    LEFT JOIN votes v ON v.session_topic_id = st.id
    WHERE s.team_id = $1
      AND s.status = 'complete'
    ORDER BY s.completed_at DESC, st.display_order, v.vote_value`;
}

function buildSessionHistoryParams(
  grant: TeamAccessGrant,
  teamId: string,
  _userId: string,
): unknown[] {
  if (grant.path === "facilitator") {
    return [teamId, grant.sessionId];
  }
  return [teamId];
}

// ---------------------------------------------------------------------------
// Serialize content response based on grant path
//
// Blocking Issue 1 fix: The /teams/:teamId/sessions endpoint is a session
// history endpoint returning rows from multiple completed sessions. The EM and
// participant serializers require a per-session session ID and status. Rows are
// grouped by the actual sessions.id (s.id in SQL, now correctly aliased as
// session_id) before each session group is serialized. The response is
// { sessions: [...] } — a list of per-session views in descending date order.
// ---------------------------------------------------------------------------
function serializeContentResponse(
  grant: TeamAccessGrant,
  callerUserId: string,
  rows: Array<Record<string, unknown>>,
): unknown {
  if (grant.path === "admin") {
    // Should not reach here — admin is denied above
    throw new Error("Admin grant reached serializer — this is a bug");
  }

  if (grant.path === "facilitator") {
    const result = buildFacilitatorQueryResult(
      grant.sessionId,
      grant.sessionStatus,
      rows as Parameters<typeof buildFacilitatorQueryResult>[2],
    );
    return serializeForFacilitator(grant, result);
  }

  // ---------------------------------------------------------------------------
  // Helper: group raw DB rows by their session_id value (s.id from the SQL
  // query), preserving encounter order so sessions appear in descending
  // completed_at order (as ordered by the SQL ORDER BY clause).
  // ---------------------------------------------------------------------------
  function groupRowsBySession(
    rawRows: Array<Record<string, unknown>>,
  ): Map<string, { sessionStatus: string; rows: Array<Record<string, unknown>> }> {
    const groups = new Map<string, { sessionStatus: string; rows: Array<Record<string, unknown>> }>();
    for (const row of rawRows) {
      const sid = row["session_id"] as string;
      if (!groups.has(sid)) {
        groups.set(sid, { sessionStatus: row["session_status"] as string, rows: [] });
      }
      groups.get(sid)!.rows.push(row);
    }
    return groups;
  }

  if (grant.path === "member" && grant.role === "engineering_manager") {
    const groups = groupRowsBySession(rows);
    const sessions = Array.from(groups.entries()).map(([sessionId, { rows: sessionRows }]) => {
      const result = buildEMQueryResult(
        sessionId,
        sessionRows as Parameters<typeof buildEMQueryResult>[1],
      );
      return serializeForMemberEM(grant, result);
    });
    return { sessions };
  }

  // Participant: group by session, serialize each separately
  const groups = groupRowsBySession(rows);
  const sessions = Array.from(groups.entries()).map(([sessionId, { sessionStatus, rows: sessionRows }]) => {
    const result = buildParticipantQueryResult(
      sessionId,
      sessionStatus,
      callerUserId,
      sessionRows as Parameters<typeof buildParticipantQueryResult>[3],
    );
    return serializeForMemberParticipant(
      grant as Extract<TeamAccessGrant, { path: "member"; role: "participant" }>,
      result,
    );
  });
  return { sessions };
}
