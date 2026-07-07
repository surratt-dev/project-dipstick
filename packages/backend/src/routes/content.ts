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
import type { TeamAccessGrant } from "@dipstick/shared";

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
  //   null → 403
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
      await applyTimingFloor(startTime);
      return denyAccess(reply);
    }

    // Task 5.10: admin grant is denied for session content endpoints
    if (grant.path === "admin") {
      await applyTimingFloor(startTime);
      return denyAdminContentAccess(request, reply, teamId, "GET /api/v1/teams/:teamId/sessions");
    }

    // Decision 7: Only now do we query the resource. An unauthorized caller
    // never reaches this point, so they cannot determine whether the team exists.
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

    await applyTimingFloor(startTime);
    return noStore(reply).send(responseBody);
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
      await applyTimingFloor(startTime);
      return denyAccess(reply);
    }

    if (grant.path === "admin") {
      await applyTimingFloor(startTime);
      return denyAdminContentAccess(request, reply, teamId, "GET /api/v1/teams/:teamId/trends");
    }

    // Trend data: aggregate across complete sessions by topic
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
      await applyTimingFloor(startTime);
      return denyAccess(reply);
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
      await applyTimingFloor(startTime);
      return denyAccess(reply);
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
      await applyTimingFloor(startTime);
      return denyAccess(reply);
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
    const sessionResult = await db.query<{ id: string; team_id: string; status: string }>(
      `SELECT id, team_id, status FROM sessions WHERE id = $1`,
      [sessionId],
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

    if (sessionRow.team_id !== teamId) {
      await applyTimingFloor(startTime);
      return denyAccess(reply);
    }

    // Return session state
    await applyTimingFloor(startTime);
    return noStore(reply).send({ sessionId, teamId, status: sessionRow.status });
  });
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
        st.id AS session_id,
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
      st.id AS session_id,
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

  if (grant.path === "member" && grant.role === "engineering_manager") {
    const result = buildEMQueryResult(
      "sessions",
      rows as Parameters<typeof buildEMQueryResult>[1],
    );
    return serializeForMemberEM(grant, result);
  }

  // Participant
  const result = buildParticipantQueryResult(
    "sessions",
    "active",
    callerUserId,
    rows as Parameters<typeof buildParticipantQueryResult>[3],
  );
  return serializeForMemberParticipant(
    grant as Extract<TeamAccessGrant, { path: "member"; role: "participant" }>,
    result,
  );
}
