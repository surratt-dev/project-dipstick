import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db.js";
import { emitAuditEvent } from "../auth/audit-logger.js";
import {
  evaluateTeamAccess,
  readActiveMembershipRole,
} from "../auth/team-content-access-helper.js";
import { checkStandingFacilitatorOrAdminAuthorization } from "../auth/standing-facilitator-access-helper.js";
import {
  serializeForMemberParticipant,
  serializeForMemberEM,
  serializeForFacilitator,
  buildParticipantQueryResult,
  buildEMQueryResult,
  buildFacilitatorQueryResult,
} from "../content/team-content-serializers.js";
import { applyTimingFloor } from "../content/timing-oracle.js";
import { getTopicLockState } from "../auth/topic-lock-state.js";
import { parseRoleArray } from "../auth/role-map.js";
import type { SessionData } from "../auth/session-store.js";
import type {
  TeamAccessGrant,
  FacilitatorHistoricalDataUnavailable,
  FacilitatorTrendDataUnavailable,
  FacilitatorContentView,
  ConnectionRecoveryEntry,
  GetActiveTopicsResponse,
  GetAllTopicsResponse,
} from "@dipstick/shared";
import { DEFAULT_TOPICS_TEAM_ID } from "../sessions/default-topics.js";
import { teamNotFoundEnvelope } from "./error-envelope.js";
import { isCanonicalUuid } from "./uuid.js";

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
// TOPIC-001 admission predicate — topic-001-authz-contract-reconcile (#187),
// design.md Decision 2. Implements the team-content-access requirement
// "The active-topics endpoint admits only non-manager participant members and
// eligible session facilitators".
//
// Allow-list, pure and synchronous: its only inputs are its two parameters.
// No I/O, no env, no config — no flag, no override. The handler does the
// membership read (readActiveMembershipRole) and passes the result in.
//
// OR semantics (Decision 3): the caller is an EM if their live membership role
// OR their stored global role is 'engineering_manager'. This deliberately
// diverges from Decision E (restrict-team-005-em-promotion) on this endpoint
// only, so it is NOT exported for reuse.
//
// - member: admitted only on equality with 'participant' for both the grant
//   role and the live membership role. null, an EM membership, or any future
//   membership role denies.
// - facilitator: the grant is earned by sessions.facilitator_id, not global
//   role, so only a drifted global EM is denied; liveMembershipRole is ignored.
// - admin: unreachable (the handler denies admins first); false keeps the
//   switch exhaustive without relying on order.
// ---------------------------------------------------------------------------
function isTopicConfigReadAdmitted(
  grant: TeamAccessGrant,
  liveMembershipRole: string | null,
): boolean {
  switch (grant.path) {
    case "member":
      return (
        grant.role === "participant" &&
        liveMembershipRole === "participant" &&
        grant.actorGlobalRole !== "engineering_manager"
      );
    case "facilitator":
      return grant.actorGlobalRole !== "engineering_manager";
    case "admin":
      return false;
    default: {
      const _exhaustive: never = grant;
      void _exhaustive;
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// TOPIC-002 administrator-arm admission predicate —
// 232-topic-002-admin-read-audit-no-manager (#232), design.md D2/D3.
//
// The no-manager rule on TOPIC-002's application_admin arm. Allow-list, not
// deny-list: admitted only when the caller's live active membership role on
// the team is absent (null) or 'participant'. 'engineering_manager' is
// denied as membership_em; ANY other value is denied as
// membership_unrecognised.
//
// Unconditional: no flag, env, config or override. TOPIC-002 only --
// TOPIC-003..006 (topics.ts) keep admitting admins through the shared
// helper; whether a member-admin may write is #208's decision, not this one.
//
// The membership_unrecognised branch is unreachable against today's
// membership_role enum (participant, engineering_manager; migration 1). It
// exists as defence in depth for a future enum value, so ADDING A VALUE TO
// membership_role MUST REVISIT THIS PREDICATE.
//
// Pure and synchronous; not exported (the handler does the membership read
// via readActiveMembershipRole and passes the result in).
// ---------------------------------------------------------------------------
type AdminTopicConfigRead =
  | { admitted: true; membershipRole: null | "participant" }
  | { admitted: false; reason: "membership_em" | "membership_unrecognised" };

function evaluateAdminTopicConfigRead(liveRole: string | null): AdminTopicConfigRead {
  if (liveRole === null) return { admitted: true, membershipRole: null };
  if (liveRole === "participant") return { admitted: true, membershipRole: "participant" };
  if (liveRole === "engineering_manager") return { admitted: false, reason: "membership_em" };
  return { admitted: false, reason: "membership_unrecognised" };
}

/**
 * #232 implementation review (security N1): TOPIC-002 knows exactly two
 * authorized roles -- "facilitator" (unaudited read) and "application_admin"
 * (the audited, no-manager admin arm). Anything else the shared decision
 * authorizes throws (500 via the root handler) before any data read, so a
 * future role added to the shared helper (#208) cannot reach the data
 * unaudited. The message names no role value, team or user.
 */
export function assertTopic002AuthorizedRole(
  role: string,
): asserts role is "facilitator" | "application_admin" {
  if (role !== "facilitator" && role !== "application_admin") {
    throw new Error("TOPIC-002: authorization admitted an unexpected role; refusing to serve");
  }
}

/** #232 D3: 403 message for ADMIN_IS_TEAM_MANAGER (reason membership_em). */
export const ADMIN_IS_TEAM_MANAGER_MESSAGE =
  "Topic configuration for this team isn't available to its engineering manager.";
/** #232 D3: 403 message for ADMIN_MEMBERSHIP_NOT_ADMITTED (reason membership_unrecognised). */
export const ADMIN_MEMBERSHIP_NOT_ADMITTED_MESSAGE = "Topic configuration for this team isn't available to you.";

const TOPIC_002_ENDPOINT = "GET /api/v1/teams/:teamId/topics/all";

type Topic002AdminOperation = "admin.topic_config_accessed" | "admin.topic_config_denied";

/**
 * #232 D5b: run one admin-arm audit step (the role-set read or an audit
 * insert). On a throw, emit the log-only admin.audit_write_failed signal
 * with the SQLSTATE only (never err.message / err.detail, which can echo row
 * values), then rethrow so the request still fails 500 with no data.
 */
async function withAdminAuditFailureSignal<T>(
  request: FastifyRequest,
  ctx: { actorUserId: string; teamId: string; operation: Topic002AdminOperation; stage: "role_set_read" | "audit_insert" },
  step: () => Promise<T>,
): Promise<T> {
  try {
    return await step();
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    emitAuditEvent(request.log, "admin.audit_write_failed", {
      actorUserId: ctx.actorUserId,
      teamId: ctx.teamId,
      endpoint: TOPIC_002_ENDPOINT,
      operation: ctx.operation,
      stage: ctx.stage,
      errorCode: typeof code === "string" ? code : null,
    });
    throw err;
  }
}

/**
 * #232 D5: the caller's stored role set, read once per admin request. The
 * ::text[] cast is required (node-pg does not parse an enum array). Zero
 * rows throws -- never default -- so a vanished identity stays in the
 * fail-closed set. parseRoleArray throws on anything malformed.
 */
async function readActorRoleSet(userId: string): Promise<readonly string[]> {
  const result = await db.query<{ roles: unknown }>(`SELECT roles::text[] AS roles FROM users WHERE id = $1`, [userId]);
  if (result.rows.length !== 1) {
    throw new Error("TOPIC-002 admin arm: caller's users row vanished after authorization");
  }
  return parseRoleArray(result.rows[0]!.roles);
}

/** #232 D5: the admin-arm audit insert; actor_roles last as $7::text[] (insertSignInAuditRow pattern). */
async function insertTopic002AdminAuditRow(args: {
  actorUserId: string;
  actorIp: string;
  operation: Topic002AdminOperation;
  teamId: string;
  metadata: Record<string, unknown>;
  actorRoles: readonly string[];
}): Promise<void> {
  await db.query(
    `INSERT INTO audit_log
       (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata, actor_roles)
     VALUES ($1, $2, $3, $4, $5, $6, $7::text[])`,
    [
      args.actorUserId,
      "application_admin",
      args.actorIp,
      args.operation,
      args.teamId,
      JSON.stringify(args.metadata),
      [...args.actorRoles],
    ],
  );
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
    const grant = await evaluateTeamAccess(session.userId, teamId, request.log);

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

    const grant = await evaluateTeamAccess(session.userId, teamId, request.log);

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

    const grant = await evaluateTeamAccess(session.userId, teamId, request.log);

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

    // harden-topic-write-endpoints (#184) task 3.9 / Decision 11: the same
    // route boundary /topics/all already has. A non-canonical teamId is 404
    // TEAM_NOT_FOUND before any query (it was a 22P02 500), with the timing
    // floor. A malformed id names no team, so this reveals nothing.
    if (!isCanonicalUuid(teamId)) {
      await applyTimingFloor(startTime);
      return noStore(reply).code(404).send(teamNotFoundEnvelope());
    }

    const grant = await evaluateTeamAccess(session.userId, teamId, request.log);

    if (grant === null) {
      // Error State 4: cross-team facilitator detection + timing floor
      return denyNullGrant(session.userId, teamId, reply, startTime);
    }

    if (grant.path === "admin") {
      await applyTimingFloor(startTime);
      return denyAdminContentAccess(request, reply, teamId, "GET /api/v1/teams/:teamId/topics");
    }

    // topic-001-authz-contract-reconcile (#187), design.md Decisions 1 and 2:
    // engineering managers are denied by membership role OR global role. The
    // grant alone cannot show an EM membership that Decision E degraded to
    // role: 'participant' (path 2'), so member grants get a second, live
    // membership read. Not caught: a rejection is a 500, never an admit.
    const liveRole =
      grant.path === "member"
        ? await readActiveMembershipRole(session.userId, teamId)
        : null;

    if (!isTopicConfigReadAdmitted(grant, liveRole)) {
      // Diagnosis only, derived after the predicate has denied; never feeds
      // admission. Membership wins when both signals are EM (Decision 6).
      const reason =
        liveRole === "engineering_manager"
          ? "membership_em"
          : grant.actorGlobalRole === "engineering_manager"
            ? "global_em"
            : "not_admitted";
      // Log-only (audit-logger.ts). No topic data: neither query below runs.
      emitAuditEvent(request.log, "topic.config_read_denied_role", {
        userId: session.userId,
        teamId,
        grantPath: grant.path,
        globalRole: grant.actorGlobalRole,
        membershipRole: liveRole,
        reason,
      });
      await applyTimingFloor(startTime);
      return denyAccess(reply);
    }

    const result = await db.query<{
      id: string;
      name: string;
      prompt: string;
      vote_type: string;
      display_order: number;
      status: string;
    }>(
      // topic-annotation design.md Decision 8: team_annotation and its
      // provenance are DELIBERATELY not selected here. TOPIC-001 has no
      // consumer of the value, and in-session display reads only the session
      // payload's snapshot. Engineering managers are now denied above (#187),
      // but the annotation stays unselected until a consumer exists.
      `SELECT id, name, prompt, vote_type, display_order, status
       FROM topics
       WHERE team_id = $1 AND status = 'active'
       ORDER BY display_order ASC`,
      [teamId],
    );

    // topic-customization-lock-and-add-custom-topic, design.md Decision 1 /
    // Task 2.1: the lock state is never an independently inlined query here.
    // template-team-not-usable (#214) D6: it comes from getTopicLockState,
    // the one function TOPIC-002 also calls (it delegates to the shared
    // hasCompletedFirstSession for every team but the template), with
    // lockReason beside isCustomizationLocked. Present on every 200 for an
    // admitted caller (Task 2.2); EMs and admins never reach this point
    // (#187), and neither function runs for a denied request.
    const { isCustomizationLocked, lockReason } = await getTopicLockState(teamId);

    const response: GetActiveTopicsResponse = {
      teamId,
      topics: result.rows as GetActiveTopicsResponse["topics"],
      isCustomizationLocked,
      lockReason,
    };
    await applyTimingFloor(startTime);
    return noStore(reply).send(response);
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/teams/:teamId/topics/all  (TOPIC-002, remove-topic Task 7)
  //
  // design.md Decision 9: corrected to the standing, org-wide facilitator
  // model TOPIC-003..007 already share (global_role = 'facilitator' AND not
  // an active member of the team, OR application_admin) — NOT
  // evaluateTeamAccess (TOPIC-001's session-scoped model, used by every
  // other handler in this file). Placed here rather than topics.ts because
  // it is a read endpoint and content.ts is this codebase's established
  // home for team-content reads, even though its authorization helper is
  // shared with topics.ts.
  //
  // Powers the Topic Management screen (Task 9): the active list, the
  // archived list with archivedBy provenance (Decision 6), and
  // defaultTopicsNotActive (the canonical default topics currently absent
  // from this team's active list, per the sentinel __default_topics__
  // team's is_default rows — the same provisioning source
  // facilitator-sessions.ts's session-creation copy reads from).
  // -------------------------------------------------------------------------
  // topic-annotation design.md Decision 8 — shared by the active and
  // archived mappings. Provenance is non-null only when both the user id and
  // display name are present (the archivedBy rule).
  function annotationFields(row: {
    team_annotation: string | null;
    annotation_updated_at: Date | null;
    annotation_updated_by: string | null;
    annotation_updated_by_display_name: string | null;
  }) {
    return {
      teamAnnotation: row.team_annotation,
      annotationUpdatedAt: row.annotation_updated_at ? row.annotation_updated_at.toISOString() : null,
      annotationUpdatedBy:
        row.annotation_updated_by && row.annotation_updated_by_display_name
          ? { userId: row.annotation_updated_by, displayName: row.annotation_updated_by_display_name }
          : null,
    };
  }

  app.get<{
    Params: { teamId: string };
  }>("/api/v1/teams/:teamId/topics/all", async (request, reply) => {
    const startTime = Date.now();
    const session = request.session as unknown as SessionData;
    const { teamId } = request.params;

    // Route boundary (session-topics-snapshot-at-creation implementation
    // review M1/MF1): a non-canonical teamId (no hyphens, braces, ...) is
    // 404 before any query, so the member-denial check below and every read
    // after it see the same string. A malformed id names no team, so this
    // reveals nothing about any team's existence.
    if (!isCanonicalUuid(teamId)) {
      await applyTimingFloor(startTime);
      return noStore(reply).code(404).send(teamNotFoundEnvelope());
    }

    // Task 7.1/7.2 — decision-only shared authorization, same function
    // TOPIC-004 (topics.ts) uses. This handler writes its own reply and
    // applies the timing floor itself, on both reason branches — the
    // shared function does neither.
    const decision = await checkStandingFacilitatorOrAdminAuthorization(session.userId, teamId);
    if (!decision.authorized) {
      await applyTimingFloor(startTime);
      return noStore(reply)
        .code(403)
        .send({
          error: {
            category: "forbidden" as const,
            message:
              decision.reason === "FACILITATOR_IS_TEAM_MEMBER"
                ? "A facilitator cannot view topic management for a team they are a member of."
                : "Only a facilitator or an application admin can view this team's topic list.",
            correlationId: crypto.randomUUID(),
          },
        });
    }

    // -----------------------------------------------------------------------
    // #232 (232-topic-002-admin-read-audit-no-manager), design.md D2/D4/D5:
    // the administrator arm's no-manager rule and its audit.
    //
    // Runs ONLY when the shared decision admitted an application_admin, so a
    // facilitator's request never reaches the membership or role-set read
    // (facilitators gain no query). The shared helper
    // (standing-facilitator-access-helper.ts) is deliberately unchanged: it
    // also serves TOPIC-003..006, which keep admitting admins until #208 is
    // decided. Do NOT move this check into the shared helper.
    //
    // Two small reads, not one users/team_memberships join: content.ts runs
    // no SQL against team_memberships (access-control Decision 8) -- the
    // membership role comes from readActiveMembershipRole. Folding both into
    // one local join is the first optimisation someone will try; it breaks
    // that rule.
    //
    // Every admin request runs the same prefix (helper row -> membership row
    // -> role-set row) and both branches end with the same tail: audit insert
    // -> event -> timing floor -> send. The insert never sits between the
    // floor and the send (timing parity, design review M3).
    //
    // Fail closed: a throw from the membership read, the role-set read or
    // either insert propagates (500, no data). The deny branch below returns
    // before any team-name/topic/lock read, so a failed denial insert can
    // never become a 200.
    // -----------------------------------------------------------------------
    // #232 implementation review (security N1): the admin arm is the only
    // audited path, so an authorized role that is neither "facilitator" nor
    // "application_admin" must not fall through to the data reads unaudited.
    // The shared decision types actorGlobalRole as `string` and #208 will
    // reopen that helper; fail closed (500, no data, no read) on anything
    // else instead of silently skipping the no-manager check and audit.
    assertTopic002AuthorizedRole(decision.actorGlobalRole);

    let adminAudit: {
      membershipRole: null | "participant";
      actorRoles: readonly string[];
      actorIdpRolesIncludeEm: boolean;
    } | null = null;
    if (decision.actorGlobalRole === "application_admin") {
      const liveRole = await readActiveMembershipRole(session.userId, teamId);
      const adminRead = evaluateAdminTopicConfigRead(liveRole);
      const dueOperation: Topic002AdminOperation = adminRead.admitted
        ? "admin.topic_config_accessed"
        : "admin.topic_config_denied";
      const auditCtx = { actorUserId: session.userId, teamId, operation: dueOperation };

      const actorRoles = await withAdminAuditFailureSignal(request, { ...auditCtx, stage: "role_set_read" }, () =>
        readActorRoleSet(session.userId),
      );
      // Audit metadata only -- never an admission input (migration 21's boundary).
      const actorIdpRolesIncludeEm = actorRoles.includes("engineering_manager");

      if (!adminRead.admitted) {
        await withAdminAuditFailureSignal(request, { ...auditCtx, stage: "audit_insert" }, () =>
          insertTopic002AdminAuditRow({
            actorUserId: session.userId,
            actorIp: request.ip,
            operation: "admin.topic_config_denied",
            teamId,
            metadata: {
              endpoint: TOPIC_002_ENDPOINT,
              http_status: 403,
              reason: adminRead.reason,
              actor_idp_roles_include_em: actorIdpRolesIncludeEm,
            },
            actorRoles,
          }),
        );
        emitAuditEvent(request.log, "admin.topic_config_denied", {
          actorUserId: session.userId,
          actorGlobalRole: "application_admin",
          actorIp: request.ip,
          teamId,
          endpoint: TOPIC_002_ENDPOINT,
          httpStatus: 403,
          reason: adminRead.reason,
          actorRoles,
          actorIdpRolesIncludeEm,
        });
        await applyTimingFloor(startTime);
        return noStore(reply)
          .code(403)
          .send({
            error: {
              category: "forbidden" as const,
              message:
                adminRead.reason === "membership_em"
                  ? ADMIN_IS_TEAM_MANAGER_MESSAGE
                  : ADMIN_MEMBERSHIP_NOT_ADMITTED_MESSAGE,
              correlationId: crypto.randomUUID(),
            },
          });
      }

      adminAudit = { membershipRole: adminRead.membershipRole, actorRoles, actorIdpRolesIncludeEm };
    }

    // Task 9.2/Decision 10's confirmation-copy requirement: the dialog
    // names both the topic and the team. No other endpoint reachable by a
    // standing, non-member facilitator returns a team's display name, so
    // this handler carries it directly.
    const teamResult = await db.query<{ name: string }>(`SELECT name FROM teams WHERE id = $1`, [teamId]);
    const teamName = teamResult.rows[0]?.name ?? "";

    const activeResult = await db.query<{
      id: string;
      name: string;
      prompt: string;
      vote_type: string;
      display_order: number;
      is_default: boolean;
      first_session_description: string | null;
      created_at: Date;
      updated_at: Date;
      team_annotation: string | null;
      annotation_updated_at: Date | null;
      annotation_updated_by: string | null;
      annotation_updated_by_display_name: string | null;
    }>(
      // topic-annotation design.md Decision 8 — the team's definition and
      // its provenance, via the same LEFT JOIN users pattern as archivedBy.
      `SELECT t.id, t.name, t.prompt, t.vote_type, t.display_order, t.is_default,
              t.first_session_description, t.created_at, t.updated_at,
              t.team_annotation, t.annotation_updated_at, t.annotation_updated_by,
              annotation_user.display_name AS annotation_updated_by_display_name
       FROM topics t
       LEFT JOIN users annotation_user ON annotation_user.id = t.annotation_updated_by
       WHERE t.team_id = $1 AND t.status = 'active'
       ORDER BY t.display_order ASC`,
      [teamId],
    );

    // Task 7.3/Decision 6 — archivedBy via a join to users, not a second
    // round trip. Task 5.2/design.md Decision 4 (re-add-removed-topic) —
    // restoredAt/restoredBy via a second join to users on restored_by, same
    // pattern, still no second round trip.
    const archivedResult = await db.query<{
      id: string;
      name: string;
      prompt: string;
      vote_type: string;
      is_default: boolean;
      archived_at: Date;
      archived_by: string | null;
      archived_by_display_name: string | null;
      restored_at: Date | null;
      restored_by: string | null;
      restored_by_display_name: string | null;
      team_annotation: string | null;
      annotation_updated_at: Date | null;
      annotation_updated_by: string | null;
      annotation_updated_by_display_name: string | null;
    }>(
      `SELECT t.id, t.name, t.prompt, t.vote_type, t.is_default, t.archived_at,
              t.archived_by, archived_by_user.display_name AS archived_by_display_name,
              t.restored_at, t.restored_by, restored_by_user.display_name AS restored_by_display_name,
              t.team_annotation, t.annotation_updated_at, t.annotation_updated_by,
              annotation_user.display_name AS annotation_updated_by_display_name
       FROM topics t
       LEFT JOIN users archived_by_user ON archived_by_user.id = t.archived_by
       LEFT JOIN users restored_by_user ON restored_by_user.id = t.restored_by
       LEFT JOIN users annotation_user ON annotation_user.id = t.annotation_updated_by
       WHERE t.team_id = $1 AND t.status = 'archived'
       ORDER BY t.archived_at DESC`,
      [teamId],
    );

    const defaultTopicsResult = await db.query<{
      default_topic_id: string;
      default_topic_name: string;
      team_topic_id: string | null;
      team_topic_status: string | null;
    }>(
      `SELECT dt.id AS default_topic_id, dt.name AS default_topic_name,
              t.id AS team_topic_id, t.status AS team_topic_status
       FROM topics dt
       LEFT JOIN topics t ON t.team_id = $1 AND t.name = dt.name
       WHERE dt.team_id = $2 AND dt.is_default = true
       ORDER BY dt.display_order ASC`,
      [teamId, DEFAULT_TOPICS_TEAM_ID],
    );

    // template-team-not-usable (#214) D6: the same getTopicLockState TOPIC-001
    // calls. The template reads locked with reason "canonical_defaults".
    const { isCustomizationLocked, lockReason } = await getTopicLockState(teamId);

    // topic-annotation design.md Decision 8: presentation-only flag so the
    // screen never offers an editor that TOPIC-007 would answer with 403.
    // TOPIC-007 enforces independently; both derive from global_role.
    const canEditAnnotations = decision.actorGlobalRole === "facilitator";
    // Presentation-only flag for the screen's "Add custom topic" control.
    // TOPIC-003 enforces independently. True for every caller TOPIC-002
    // admits: a standing facilitator or an application admin (FR-8.2). Both
    // roles are named explicitly so the intent stays readable. Computed
    // separately from canEditAnnotations, whose admin exclusion (FR-8.7) is
    // permanent -- never merge the two. The parity test in
    // __tests__/topic-add-flag-parity.test.ts keeps this expression in step
    // with TOPIC-003's checkAddCustomTopicAuthorization.
    // #232: an application_admin with an engineering_manager (or any
    // non-participant) membership on the team never reaches this line -- the
    // no-manager deny branch above returns first -- even though TOPIC-003
    // still admits that caller until #208 is decided (the parity test's
    // recorded GET 403 / POST 201 exception).
    const canAddTopics =
      decision.actorGlobalRole === "facilitator" || decision.actorGlobalRole === "application_admin";

    const responseBody: GetAllTopicsResponse = {
      teamId,
      teamName,
      isCustomizationLocked,
      lockReason,
      canEditAnnotations,
      canAddTopics,
      active: activeResult.rows.map((row) => ({
        topicId: row.id,
        name: row.name,
        prompt: row.prompt,
        voteType: row.vote_type as GetAllTopicsResponse["active"][number]["voteType"],
        displayOrder: row.display_order,
        isDefault: row.is_default,
        firstSessionDescription: row.first_session_description,
        ...annotationFields(row),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
      archived: archivedResult.rows.map((row) => ({
        topicId: row.id,
        name: row.name,
        prompt: row.prompt,
        voteType: row.vote_type as GetAllTopicsResponse["archived"][number]["voteType"],
        isDefault: row.is_default,
        archivedAt: row.archived_at.toISOString(),
        archivedBy:
          row.archived_by && row.archived_by_display_name
            ? { userId: row.archived_by, displayName: row.archived_by_display_name }
            : null,
        restoredAt: row.restored_at ? row.restored_at.toISOString() : null,
        restoredBy:
          row.restored_by && row.restored_by_display_name
            ? { userId: row.restored_by, displayName: row.restored_by_display_name }
            : null,
        ...annotationFields(row),
      })),
      defaultTopicsNotActive: defaultTopicsResult.rows
        .filter((row) => row.team_topic_status !== "active")
        .map((row) => ({
          topicId: row.team_topic_id ?? row.default_topic_id,
          name: row.default_topic_name,
          isArchived: row.team_topic_status === "archived",
        })),
    };

    // #232 D5: every admin 200 writes exactly one text-free access row (every
    // team, the template team included, annotated or not; never
    // deduplicated), then its event, then the floor, then the send. A plain
    // awaited insert (teams.ts style, not a transaction): if it throws the
    // request is 500 and none of the data read above is sent.
    if (adminAudit !== null) {
      const { membershipRole, actorRoles, actorIdpRolesIncludeEm } = adminAudit;
      const teamFound = teamResult.rows.length > 0;
      const activeCount = responseBody.active.length;
      const archivedCount = responseBody.archived.length;
      const annotatedCount =
        responseBody.active.filter((t) => t.teamAnnotation !== null).length +
        responseBody.archived.filter((t) => t.teamAnnotation !== null).length;

      await withAdminAuditFailureSignal(
        request,
        { actorUserId: session.userId, teamId, operation: "admin.topic_config_accessed", stage: "audit_insert" },
        () =>
          insertTopic002AdminAuditRow({
            actorUserId: session.userId,
            actorIp: request.ip,
            operation: "admin.topic_config_accessed",
            teamId,
            metadata: {
              endpoint: TOPIC_002_ENDPOINT,
              http_status: 200,
              membership_role: membershipRole,
              actor_idp_roles_include_em: actorIdpRolesIncludeEm,
              team_found: teamFound,
              active_count: activeCount,
              archived_count: archivedCount,
              annotated_count: annotatedCount,
            },
            actorRoles,
          }),
      );
      emitAuditEvent(request.log, "admin.topic_config_accessed", {
        actorUserId: session.userId,
        actorGlobalRole: "application_admin",
        actorIp: request.ip,
        teamId,
        endpoint: TOPIC_002_ENDPOINT,
        httpStatus: 200,
        membershipRole,
        actorRoles,
        actorIdpRolesIncludeEm,
        teamFound,
        activeCount,
        archivedCount,
        annotatedCount,
      });
    }

    await applyTimingFloor(startTime);
    return noStore(reply).send(responseBody);
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

    const grant = await evaluateTeamAccess(session.userId, teamId, request.log);

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
