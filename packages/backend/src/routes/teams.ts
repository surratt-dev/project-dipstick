import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import { db } from "../db.js";
import { redis } from "../redis.js";
import { emitAuditEvent } from "../auth/audit-logger.js";
import type { SessionData } from "../auth/session-store.js";
import type {
  TeamMember,
  LegacyTeamMembersResponse,
  TeamMembersResponse,
  RoleChangeRequest,
  RoleChangeResponse,
  EstablishManagerRequest,
  EstablishManagerResponse,
} from "@dipstick/shared";

// ---------------------------------------------------------------------------
// TEAM-006 rate limiting (task 3.10 / GitHub issue #13)
//
// Full spec: openspec/changes/archive/2026-07-07-establish-manager-team-relationship/
// q6-rate-limit-decision.md ("Q6 decision"). Co-signed by the Business Analyst
// and the Senior Application Security Analyst. This block implements that
// decision exactly; do not change the thresholds here without a new decision
// document superseding Q6.
//
// Three independent sliding-window limits, all keyed on the caller's
// AUTHENTICATED IDENTITY (session.userId / actor_user_id) rather than source
// IP — this is an internal admin-only endpoint behind shared corporate NAT
// egress, so IP is not a meaningful trust boundary, and the threat model's
// attacker is a compromised credential, which IP-based limiting would not
// constrain (Q6 decision, Section 1):
//
//   1. Per-actor burst:     20 requests / rolling 10 minutes
//   2. Per-actor sustained: 100 requests / rolling 24 hours
//   3. Global secondary:    100 requests / rolling 10 minutes, across every
//                           Application Admin actor combined
//
// All three use a TRUE sliding window (Redis sorted set of request
// timestamps), not a fixed calendar bucket — a fixed window lets an attacker
// double their effective rate by straddling a bucket boundary, which matters
// when these thresholds are deliberately tight.
//
// Redis-backed (the shared ioredis client), not in-process memory, so the
// limit is enforced correctly across multiple backend instances. The
// increment-trim-count sequence for a single key runs as one Lua script so
// it is atomic against concurrent requests for the same key (Q6 decision,
// Section 1: "atomically via a Lua script or MULTI").
//
// This is a small, purpose-built limiter for this one high-value route —
// the Q6 decision explicitly rejects adding @fastify/rate-limit as a new
// dependency for what is a single reviewed threshold, not a general
// cross-cutting policy.
// ---------------------------------------------------------------------------

const TEAM006_BURST_LIMIT = 20;
const TEAM006_BURST_WINDOW_MS = 10 * 60 * 1000;
const TEAM006_BURST_WARN_THRESHOLD = 16; // 80% of TEAM006_BURST_LIMIT

const TEAM006_DAILY_LIMIT = 100;
const TEAM006_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const TEAM006_DAILY_WARN_THRESHOLD = 80; // 80% of TEAM006_DAILY_LIMIT

const TEAM006_GLOBAL_LIMIT = 100;
const TEAM006_GLOBAL_WINDOW_MS = 10 * 60 * 1000;

const TEAM006_GLOBAL_RATE_LIMIT_KEY = "dipstick:ratelimit:team-manager:global";

function team006BurstKey(actorUserId: string): string {
  return `dipstick:ratelimit:team-manager:burst:${actorUserId}`;
}

function team006DailyKey(actorUserId: string): string {
  return `dipstick:ratelimit:team-manager:daily:${actorUserId}`;
}

// Atomically: drop entries older than the window, record this request, and
// return the resulting count plus the oldest surviving entry's timestamp
// (used to compute a precise Retry-After). PEXPIRE bounds how long an idle
// key lingers in Redis once an actor stops making requests.
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local member = ARGV[3]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
local count = redis.call('ZCARD', key)
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local oldestScore = now
if oldest[2] then
  oldestScore = oldest[2]
end
return {count, oldestScore}
`;

interface SlidingWindowResult {
  count: number;
  oldestEntryMs: number;
}

async function recordAndCountSlidingWindow(
  key: string,
  nowMs: number,
  windowMs: number,
): Promise<SlidingWindowResult> {
  const member = `${nowMs}-${crypto.randomUUID()}`;
  const result = (await redis.eval(
    SLIDING_WINDOW_LUA,
    1,
    key,
    nowMs,
    windowMs,
    member,
  )) as [number | string, number | string];

  return {
    count: Number(result[0]),
    oldestEntryMs: Number(result[1]),
  };
}

function retryAfterSeconds(
  window: SlidingWindowResult,
  nowMs: number,
  windowMs: number,
): number {
  return Math.max(1, Math.ceil((window.oldestEntryMs + windowMs - nowMs) / 1000));
}

type Team006RateLimitCode =
  | "TEAM006_BURST_LIMIT_EXCEEDED"
  | "TEAM006_DAILY_LIMIT_EXCEEDED"
  | "TEAM006_GLOBAL_LIMIT_EXCEEDED";

interface Team006RateLimitBreach {
  limited: true;
  code: Team006RateLimitCode;
  limitType: "burst" | "daily" | "global";
  threshold: number;
  observedCount: number;
  retryAfterSeconds: number;
}

interface Team006RateLimitOk {
  limited: false;
}

type Team006RateLimitResult = Team006RateLimitBreach | Team006RateLimitOk;

// Architect + security review findings (implementation-review-architect.md
// Finding 1, implementation-review-security.md Finding 6): thrown by
// enforceTeam006RateLimit when the Redis calls backing the rate limiter
// itself fail (outage, network partition, timeout) — distinct from a
// Team006RateLimitBreach, which means the limiter ran successfully and found
// too many requests. Callers must catch this specifically and deny the
// request (see the route handler below) rather than letting it silently
// resolve to "not limited."
class Team006RateLimiterUnavailableError extends Error {
  constructor(cause: unknown) {
    super("TEAM-006 rate limiter backend (Redis) unavailable", { cause });
    this.name = "Team006RateLimiterUnavailableError";
  }
}

// Evaluates all three limits for this request. Every call to this endpoint —
// including ones this function is about to reject — counts against every
// applicable window: the request genuinely reached the server and consumed
// its resources, and the per-actor windows must reflect that so pacing just
// under a threshold cannot be used to dodge the daily cap. Early-warning log
// events (Q6 decision, Section 2) are emitted here too, independent of
// whether the request also breaches a hard limit.
//
// Fail-closed by design when Redis is unavailable (architect + security
// review, both sign-offs conditioned on this being documented explicitly
// rather than left as an accident of "nobody added a try/catch"): this is a
// security control on a sensitive admin-only endpoint, not a UX nicety — an
// unreachable rate-limiter backend must deny the request, not silently let
// it through as if no limit applied. This mirrors how the rest of the
// codebase already treats this same Redis dependency as hard-required, not
// optional: session-store.ts propagates Redis errors to @fastify/session
// rather than treating a session-store failure as "let the request through,"
// and health.ts marks the whole service unhealthy when Redis doesn't
// respond. Every authenticated route already depends on Redis being
// reachable to deserialize the session before it ever reaches this check, so
// this does not introduce a new class of fragility — it makes an existing
// one an explicit, tested decision for this specific control instead of an
// emergent property of the absence of error handling.
async function enforceTeam006RateLimit(
  actorUserId: string,
  logger: FastifyBaseLogger,
): Promise<Team006RateLimitResult> {
  const now = Date.now();

  let burst: SlidingWindowResult;
  let daily: SlidingWindowResult;
  let global: SlidingWindowResult;
  try {
    burst = await recordAndCountSlidingWindow(
      team006BurstKey(actorUserId),
      now,
      TEAM006_BURST_WINDOW_MS,
    );
    daily = await recordAndCountSlidingWindow(
      team006DailyKey(actorUserId),
      now,
      TEAM006_DAILY_WINDOW_MS,
    );
    global = await recordAndCountSlidingWindow(
      TEAM006_GLOBAL_RATE_LIMIT_KEY,
      now,
      TEAM006_GLOBAL_WINDOW_MS,
    );
  } catch (err) {
    // Distinct, greppable signal so an operator (or Finding 2.3's future
    // monitoring pipeline) can tell "the rate limiter's backing store is
    // down, denying admin traffic as a precaution" apart from an unrelated
    // 500 on this route — a generic 500 alone would give no way to
    // distinguish an outage of the control itself from an ordinary bug.
    logger.error(
      { err, actorUserId },
      "TEAM-006 rate limiter backend (Redis) unavailable — denying request (fail-closed by design)",
    );
    emitAuditEvent(logger, "team.manager_association_rate_limit_check_failed", {
      actorUserId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Team006RateLimiterUnavailableError(err);
  }

  // Early-warning signals (non-blocking, request proceeds normally). Fires
  // the request where the sliding count first reaches the 80% threshold.
  if (burst.count === TEAM006_BURST_WARN_THRESHOLD) {
    emitAuditEvent(logger, "team.manager_association_rate_approaching", {
      actorUserId,
      window: "burst",
      observedCount: burst.count,
      threshold: TEAM006_BURST_LIMIT,
    });
  }
  if (daily.count === TEAM006_DAILY_WARN_THRESHOLD) {
    emitAuditEvent(logger, "team.manager_association_rate_approaching", {
      actorUserId,
      window: "daily",
      observedCount: daily.count,
      threshold: TEAM006_DAILY_LIMIT,
    });
  }

  if (burst.count > TEAM006_BURST_LIMIT) {
    return {
      limited: true,
      code: "TEAM006_BURST_LIMIT_EXCEEDED",
      limitType: "burst",
      threshold: TEAM006_BURST_LIMIT,
      observedCount: burst.count,
      retryAfterSeconds: retryAfterSeconds(burst, now, TEAM006_BURST_WINDOW_MS),
    };
  }
  if (daily.count > TEAM006_DAILY_LIMIT) {
    return {
      limited: true,
      code: "TEAM006_DAILY_LIMIT_EXCEEDED",
      limitType: "daily",
      threshold: TEAM006_DAILY_LIMIT,
      observedCount: daily.count,
      retryAfterSeconds: retryAfterSeconds(daily, now, TEAM006_DAILY_WINDOW_MS),
    };
  }
  if (global.count > TEAM006_GLOBAL_LIMIT) {
    return {
      limited: true,
      code: "TEAM006_GLOBAL_LIMIT_EXCEEDED",
      limitType: "global",
      threshold: TEAM006_GLOBAL_LIMIT,
      observedCount: global.count,
      retryAfterSeconds: retryAfterSeconds(global, now, TEAM006_GLOBAL_WINDOW_MS),
    };
  }

  return { limited: false };
}

// Security review finding (implementation-review-security.md, Finding 7): the
// decision doc's Section 3 JSON example used "[security/support channel]" as
// a bracketed PLACEHOLDER illustrating where a real escalation channel goes —
// it was copied verbatim into these strings on first implementation, which
// shipped non-functional bracket text to real admins. This codebase does not
// yet have a concrete, wired-up "contact your admin/security team" mechanism
// (that gap is tracked separately as tasks.md task 4.2), so these messages
// point at the organization's standard security/support process in general
// terms rather than inventing a specific channel name that doesn't exist yet.
const TEAM006_RATE_LIMIT_MESSAGES: Record<Team006RateLimitCode, string> = {
  TEAM006_BURST_LIMIT_EXCEEDED:
    `You've reached the limit of ${TEAM006_BURST_LIMIT} manager-association requests per 10 minutes. ` +
    "Wait a few minutes and try again. If you're onboarding a large number of teams at once and " +
    "genuinely need a higher rate, escalate through your organization's standard security/support " +
    "process to request a scoped, time-limited increase.",
  TEAM006_DAILY_LIMIT_EXCEEDED:
    `You've reached the limit of ${TEAM006_DAILY_LIMIT} manager-association requests per 24 hours. ` +
    "Wait for the daily window to reset and try again. If you're onboarding a large number of teams " +
    "and genuinely need a higher daily cap, escalate through your organization's standard " +
    "security/support process to request a scoped, time-limited increase.",
  TEAM006_GLOBAL_LIMIT_EXCEEDED:
    `The combined limit of ${TEAM006_GLOBAL_LIMIT} manager-association requests per 10 minutes across ` +
    "all Application Admins has been reached. Wait a few minutes and try again. If you're onboarding a " +
    "large number of teams and genuinely need a higher rate, escalate through your organization's " +
    "standard security/support process to request a scoped, time-limited increase.",
};

// ---------------------------------------------------------------------------
// Authorization helper
//
// Per Decision 3 in design.md: the actor is authorized to assign roles for a
// given team if and only if one of the following is true at request time —
// evaluated from the database, not from session state:
//
//   a) users.global_role = 'application_admin'
//   b) users.global_role = 'engineering_manager'
//      AND team_memberships.role = 'engineering_manager' for the specific teamId
//
// The teamId comes from the request URL path (attacker-controlled input). The
// check must be per-team, per-request, from the database. An EM on Team A
// calling PATCH /api/v1/teams/team-b-id/... MUST receive a 403.
// ---------------------------------------------------------------------------
async function checkAssignRolesAuthorization(
  actorUserId: string,
  teamId: string,
): Promise<{ authorized: boolean; actorGlobalRole: string }> {
  const result = await db.query<{
    global_role: string;
    membership_role: string | null;
  }>(
    `SELECT u.global_role,
            tm.role AS membership_role
     FROM users u
     LEFT JOIN team_memberships tm
           ON tm.user_id = u.id
          AND tm.team_id = $2
          AND tm.removed_at IS NULL
     WHERE u.id = $1`,
    [actorUserId, teamId],
  );

  if (result.rows.length === 0) {
    return { authorized: false, actorGlobalRole: "" };
  }

  const { global_role, membership_role } = result.rows[0] as {
    global_role: string;
    membership_role: string | null;
  };

  const authorized =
    global_role === "application_admin" ||
    (global_role === "engineering_manager" &&
      membership_role === "engineering_manager");

  return { authorized, actorGlobalRole: global_role };
}

export async function teamRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // GET /api/v1/teams/:teamId/members
  //
  // Returns the list of active team members with their current role labels,
  // plus a canAssignRoles flag at the response level (Decision 9). The flag
  // is evaluated from the database per request — not from session state.
  // -------------------------------------------------------------------------
  app.get<{
    Params: { teamId: string };
  }>("/api/v1/teams/:teamId/members", async (request, reply) => {
    const session = request.session as unknown as SessionData;
    const { teamId } = request.params;

    // Verify the caller is a member of this team, or an application_admin.
    const actorResult = await db.query<{
      global_role: string;
      is_member: boolean;
    }>(
      `SELECT u.global_role,
              (tm.id IS NOT NULL) AS is_member
       FROM users u
       LEFT JOIN team_memberships tm
             ON tm.user_id = u.id
            AND tm.team_id = $2
            AND tm.removed_at IS NULL
       WHERE u.id = $1`,
      [session.userId, teamId],
    );

    if (actorResult.rows.length === 0) {
      return reply.code(401).send({
        error: {
          category: "invalid_request" as const,
          message: "User not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const { global_role, is_member } = actorResult.rows[0] as {
      global_role: string;
      is_member: boolean;
    };
    if (!is_member && global_role !== "application_admin") {
      return reply.code(403).send({
        error: {
          category: "invalid_request" as const,
          message: "You are not a member of this team.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Fetch team name
    const teamResult = await db.query<{ name: string }>(
      `SELECT name FROM teams WHERE id = $1`,
      [teamId],
    );

    if (teamResult.rows.length === 0) {
      return reply.code(404).send({
        error: {
          category: "invalid_request" as const,
          message: "Team not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const teamName = (teamResult.rows[0] as { name: string }).name;

    // Fetch active members with their display names and current roles
    const membersResult = await db.query<{
      user_id: string;
      display_name: string;
      email: string;
      role: string;
    }>(
      `SELECT tm.user_id, u.display_name, u.email, tm.role
       FROM team_memberships tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = $1 AND tm.removed_at IS NULL
       ORDER BY u.display_name ASC`,
      [teamId],
    );

    // canAssignRoles: re-use the same per-team, per-request DB check (Decision 3).
    const { authorized: canAssignRoles } = await checkAssignRolesAuthorization(
      session.userId,
      teamId,
    );

    const members: TeamMember[] = membersResult.rows.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      email: row.email,
      role: row.role as "participant" | "engineering_manager",
    }));

    // Decision 2 (Option B) audit: log Application Admin reads of the
    // membership list. actorGlobalRole is available from the auth check above
    // — do not re-query the users table.
    // Task 3.4 / Task 3.6: written immediately (not in a transaction) because
    // this is a read operation; atomicity with a write transaction is not
    // applicable. The audit write executes before the response is sent.
    if (global_role === "application_admin") {
      await db.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          session.userId,
          global_role,
          request.ip,
          "admin.membership_list_accessed",
          teamId,
          JSON.stringify({ member_count: members.length }),
        ],
      );

      emitAuditEvent(request.log, "admin.membership_list_accessed", {
        actorUserId: session.userId,
        actorGlobalRole: global_role,
        actorIp: request.ip,
        teamId,
        memberCount: members.length,
      });
    }

    const response: LegacyTeamMembersResponse = {
      teamId,
      teamName,
      members,
      canAssignRoles,
    };

    return reply.send(response);
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/teams/:teamId   (TEAM-003)
  //
  // Returns team members split into participants and engineeringManagers arrays.
  // Added in Phase 2 of establish-manager-team-relationship (Decision 12).
  //
  // The split is done at the database query level — the backend knows the role
  // at query time and the type system enforces the separation. Sending a flat
  // list and expecting the client to segment creates a dependency between
  // frontend rendering logic and the database schema that the type system
  // cannot enforce.
  //
  // canAssociateManagers (Decision 10): true when actor.global_role =
  // 'application_admin'. TEAM-006 is admin-only. Using canAssignRoles for this
  // affordance would cause EMs to see the control and receive 403s.
  //
  // This endpoint must ship in Phase 2 so that an EM row created by TEAM-006
  // never appears in the wrong array in production.
  // -------------------------------------------------------------------------
  app.get<{
    Params: { teamId: string };
  }>("/api/v1/teams/:teamId", async (request, reply) => {
    const session = request.session as unknown as SessionData;
    const { teamId } = request.params;

    // Verify the caller is a member of this team or an application_admin.
    const actorResult = await db.query<{
      global_role: string;
      is_member: boolean;
    }>(
      `SELECT u.global_role,
              (tm.id IS NOT NULL) AS is_member
       FROM users u
       LEFT JOIN team_memberships tm
             ON tm.user_id = u.id
            AND tm.team_id = $2
            AND tm.removed_at IS NULL
       WHERE u.id = $1`,
      [session.userId, teamId],
    );

    if (actorResult.rows.length === 0) {
      return reply.code(401).send({
        error: {
          category: "invalid_request" as const,
          message: "User not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const { global_role: actorGlobalRole, is_member: isMember } =
      actorResult.rows[0] as { global_role: string; is_member: boolean };

    if (!isMember && actorGlobalRole !== "application_admin") {
      return reply.code(403).send({
        error: {
          category: "invalid_request" as const,
          message: "You are not a member of this team.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Fetch team name — 404 when not found (not 403, to avoid leaking existence
    // information to non-admin callers who are already members)
    const teamResult = await db.query<{ name: string }>(
      `SELECT name FROM teams WHERE id = $1`,
      [teamId],
    );

    if (teamResult.rows.length === 0) {
      return reply.code(404).send({
        error: {
          category: "invalid_request" as const,
          message: "Team not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const teamName = (teamResult.rows[0] as { name: string }).name;

    // Fetch all active members with their roles — split into participants and
    // engineeringManagers at the query level (not in application code)
    const membersResult = await db.query<{
      user_id: string;
      display_name: string;
      email: string;
      role: string;
    }>(
      `SELECT tm.user_id, u.display_name, u.email, tm.role
       FROM team_memberships tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = $1 AND tm.removed_at IS NULL
       ORDER BY u.display_name ASC`,
      [teamId],
    );

    const participants: TeamMember[] = [];
    const engineeringManagers: TeamMember[] = [];

    for (const row of membersResult.rows) {
      const member: TeamMember = {
        userId: row.user_id,
        displayName: row.display_name,
        email: row.email,
        role: row.role as "participant" | "engineering_manager",
      };
      if (row.role === "engineering_manager") {
        engineeringManagers.push(member);
      } else {
        participants.push(member);
      }
    }

    // canAssignRoles: Application Admins and EMs with EM membership on this team
    const { authorized: canAssignRoles } = await checkAssignRolesAuthorization(
      session.userId,
      teamId,
    );

    // canAssociateManagers: Application Admin only (Decision 10)
    // TEAM-006 is restricted to Application Admins. An EM who sees this flag as
    // true will attempt TEAM-006 and receive 403 — worse UX than not showing the
    // control. The escalation message renders when this flag is false.
    const canAssociateManagers = actorGlobalRole === "application_admin";

    // Decision 2 (Option B) audit: log Application Admin reads of team detail
    // (which includes membership lists and role assignments).
    // Task 3.4: audit_log write for admin reads of administrative data.
    if (actorGlobalRole === "application_admin") {
      await db.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          session.userId,
          actorGlobalRole,
          request.ip,
          "admin.team_detail_accessed",
          teamId,
          JSON.stringify({
            participant_count: participants.length,
            em_count: engineeringManagers.length,
          }),
        ],
      );

      emitAuditEvent(request.log, "admin.team_detail_accessed", {
        actorUserId: session.userId,
        actorGlobalRole,
        actorIp: request.ip,
        teamId,
        participantCount: participants.length,
        emCount: engineeringManagers.length,
      });
    }

    const response: TeamMembersResponse = {
      teamId,
      teamName,
      participants,
      engineeringManagers,
      canAssignRoles,
      canAssociateManagers,
    };

    return reply.send(response);
  });

  // -------------------------------------------------------------------------
  // PATCH /api/v1/teams/:teamId/members/:userId/role   (TEAM-005)
  //
  // NOTE: TEAM-006 is NOT called from here and must NEVER be called from here.
  // TEAM-005 changes the team_memberships.role of an existing member. It does
  // not check or modify users.global_role. TEAM-006 establishes the EM/team
  // relationship for a user who was NOT previously a team member and requires
  // global_role = 'engineering_manager' as a hard precondition. These are
  // distinct endpoints serving distinct use cases — see design.md.
  // (Task 3.8 comment — establish-manager-team-relationship)
  //
  // Changes a team member's membership_role between 'participant' and
  // 'engineering_manager'. Authorized actors: Application Admins (any team)
  // and Engineering Managers with an active membership on THIS specific team
  // (Decision 3, Q1 resolution: Option A).
  //
  // Two-submission flow for zero-participant guard (Decision 5):
  //   1st PATCH: no confirmedZeroParticipant → server checks post-update
  //              participant count inside the transaction; if 0, rolls back
  //              and returns 422 { requiresConfirmation: true }.
  //   2nd PATCH: confirmedZeroParticipant: true → applies change regardless.
  //
  // Audit log: written in the same DB transaction as the UPDATE (Decision 7).
  // If the audit write fails the transaction rolls back — a role change with
  // no audit record is not a permitted failure mode.
  //
  // Redis prohibition: membership_role is NOT cached in Redis. Per Decision 4,
  // every authorization check reads directly from the database.
  // -------------------------------------------------------------------------
  app.patch<{
    Params: { teamId: string; userId: string };
    Body: RoleChangeRequest;
  }>("/api/v1/teams/:teamId/members/:userId/role", async (request, reply) => {
    const session = request.session as unknown as SessionData;
    const { teamId, userId: subjectUserId } = request.params;
    const { role: newRole, confirmedZeroParticipant = false } = request.body;

    // Validate the requested role value
    const validRoles = ["participant", "engineering_manager"];
    if (!validRoles.includes(newRole)) {
      return reply.code(400).send({
        error: {
          category: "invalid_request" as const,
          message: `Invalid role value: '${newRole}'. Valid values are: ${validRoles.join(", ")}.`,
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Authorization check: per-team, per-request, from the database.
    // NOT from session state (see Decision 3 Redis prohibition).
    const { authorized, actorGlobalRole } = await checkAssignRolesAuthorization(
      session.userId,
      teamId,
    );

    if (!authorized) {
      return reply.code(403).send({
        error: {
          category: "invalid_request" as const,
          // Q1 resolution: Option A — only Application Admins and Engineering
          // Managers for this specific team are permitted.
          message:
            "Only an Application Admin or an Engineering Manager for this team can change member roles.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Verify the subject user is an active member of this team
    const subjectCheckResult = await db.query<{
      display_name: string;
      email: string;
      current_role: string;
    }>(
      `SELECT u.display_name, u.email, tm.role AS current_role
       FROM team_memberships tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.user_id = $1 AND tm.team_id = $2 AND tm.removed_at IS NULL`,
      [subjectUserId, teamId],
    );

    if (subjectCheckResult.rows.length === 0) {
      return reply.code(404).send({
        error: {
          category: "invalid_request" as const,
          message: "User is not an active member of this team.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const {
      display_name: displayName,
      email,
      current_role: fromRole,
    } = subjectCheckResult.rows[0] as {
      display_name: string;
      email: string;
      current_role: string;
    };

    // No-op: role is already the requested value
    if (fromRole === newRole) {
      const member: TeamMember = {
        userId: subjectUserId,
        displayName,
        email,
        role: newRole,
      };
      const response: RoleChangeResponse = { member };
      return reply.send(response);
    }

    // Transaction: UPDATE + zero-participant check + audit log
    // The count check is evaluated on the POST-UPDATE state within the
    // transaction to prevent the race condition described in Decision 5.
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      // Acquire a team-level lock before any reads or writes within this
      // transaction. By locking every active membership row for this team,
      // a concurrent transaction that also targets this team's memberships
      // will block here until the current transaction commits or rolls back.
      // This ensures the subsequent participant count check is evaluated on
      // fully committed state, closing the race condition identified in
      // Decision 5: two concurrent admins promoting the two participants of a
      // two-person team would otherwise each read count=1, both pass the zero-
      // participant guard, and leave the team with no participants and no 422.
      // (Architect finding #1 — required before ship.)
      await client.query(
        `SELECT id FROM team_memberships WHERE team_id = $1 AND removed_at IS NULL FOR UPDATE`,
        [teamId],
      );

      // Update the role (the team-level lock above serializes all concurrent
      // role changes for this team, so the post-update count below reflects
      // fully committed state from all prior transactions)
      await client.query(
        `UPDATE team_memberships
         SET role = $1
         WHERE user_id = $2 AND team_id = $3 AND removed_at IS NULL`,
        [newRole, subjectUserId, teamId],
      );

      // Post-update participant count — evaluated inside the transaction so
      // the lock prevents a concurrent UPDATE from racing past this check
      const countResult = await client.query<{ participant_count: string }>(
        `SELECT COUNT(*)::text AS participant_count
         FROM team_memberships
         WHERE team_id = $1 AND removed_at IS NULL AND role = 'participant'`,
        [teamId],
      );

      const participantCount = parseInt(
        (countResult.rows[0] as { participant_count: string }).participant_count,
        10,
      );

      // Zero-participant guard (Decision 5):
      // If the change would leave zero Engineers and the actor has not
      // explicitly confirmed, roll back and return 422.
      if (participantCount === 0 && !confirmedZeroParticipant) {
        await client.query("ROLLBACK");
        return reply.code(422).send({ requiresConfirmation: true });
      }

      // Audit log: same transaction — rolls back if this fails.
      // Writes to audit_log (Decision 9, establish-manager-team-relationship).
      // role_change_audit was dropped in migration 8 and replaced by audit_log.
      // from_role and to_role are stored in the metadata JSONB column.
      //
      // NOTE: TEAM-006 is NOT called from here — see task 3.8 comment at the
      // TEAM-006 handler. TEAM-005 writes only to team_memberships.role and
      // does not check users.global_role. They are distinct endpoints serving
      // distinct use cases. Do not conflate them.
      await client.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_global_role, actor_ip, operation,
            target_user_id, team_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          session.userId,
          actorGlobalRole,
          // request.ip resolves to the real client IP via trustProxy: 1
          // configured in buildApp() in app.ts.
          request.ip,
          "team.role_changed",
          subjectUserId,
          teamId,
          JSON.stringify({ from_role: fromRole, to_role: newRole }),
        ],
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Structured-log counterpart to the DB audit row (for operational alerting)
    emitAuditEvent(request.log, "team.role_changed", {
      actorUserId: session.userId,
      actorGlobalRole,
      actorIp: request.ip,
      subjectUserId,
      teamId,
      fromRole,
      toRole: newRole,
    });

    const member: TeamMember = {
      userId: subjectUserId,
      displayName,
      email,
      role: newRole,
    };
    const response: RoleChangeResponse = { member };
    return reply.send(response);
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/teams/:teamId/managers   (TEAM-006)
  //
  // Establishes the EM/team relationship for a user who already has
  // users.global_role = 'engineering_manager'. Creates (or idempotently
  // updates) a team_memberships row with role = 'engineering_manager'.
  //
  // Distinct from TEAM-005: TEAM-005 changes the team_memberships.role of an
  // EXISTING member. TEAM-006 establishes the relationship for a user who was
  // NOT previously a team member. TEAM-006 also enforces the global_role
  // precondition — TEAM-005 does not. These endpoints must remain distinct and
  // must NOT be called in place of each other.
  // (Task 3.7 comment — establish-manager-team-relationship)
  //
  // Authorized actor: Application Admin only (Decision 1 / Decision 10).
  //
  // Idempotency (Decision 3): uses PostgreSQL xmax to distinguish 201 (new row)
  // from 200 (updated row) without a SELECT-before-INSERT. xmax = 0 is true for
  // freshly inserted rows; false for updated rows. This avoids the race
  // condition that SELECT-before-INSERT creates: two concurrent admin calls
  // both reading "no row" and both attempting INSERT, with one failing.
  //
  // 404 information exposure (Decision 4): a 404 for "team not found" is
  // indistinguishable from a 404 for "team found but caller is not authorized
  // to know it exists" when the caller is not an Application Admin.
  //
  // Audit trail (Decision 9): the audit_log entry is written in the same
  // database transaction as the team_memberships write. If the audit write
  // fails, the transaction rolls back and neither row is committed. A committed
  // transaction produces both rows; a rolled-back transaction produces neither.
  //
  // Dual authorization check (Decision 14): both the global_role check and the
  // team_memberships.role check for EM data access remain independent. They
  // serve different purposes — global_role is a global role guard;
  // team_memberships.role is a team-scoped association guard.
  //
  // Rate limiting (task 3.10 / GitHub issue #13): enforced immediately after
  // the Application Admin authorization check below and before the
  // team-existence / global-role-precondition queries, per the Q6 decision's
  // placement requirement — unauthorized callers must not consume rate-limit
  // budget, and rate-limited callers must not generate unnecessary DB load.
  // See the enforceTeam006RateLimit block above this handler for the
  // threshold values and sliding-window implementation.
  // -------------------------------------------------------------------------
  app.post<{
    Params: { teamId: string };
    Body: EstablishManagerRequest;
  }>("/api/v1/teams/:teamId/managers", async (request, reply) => {
    const session = request.session as unknown as SessionData;
    const { teamId } = request.params;
    const { engineeringManagerUserId } = request.body;

    // -----------------------------------------------------------------------
    // Authorization: Application Admin only (Decision 1).
    // Read from the database per request — not from session state.
    // -----------------------------------------------------------------------
    const actorResult = await db.query<{ global_role: string }>(
      `SELECT global_role FROM users WHERE id = $1`,
      [session.userId],
    );

    if (actorResult.rows.length === 0) {
      return reply.code(401).send({
        error: {
          category: "invalid_request" as const,
          message: "User not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const actorGlobalRole = (actorResult.rows[0] as { global_role: string }).global_role;

    if (actorGlobalRole !== "application_admin") {
      return reply.code(403).send({
        error: {
          category: "forbidden" as const,
          message:
            "Only an Application Admin can establish an Engineering Manager/team relationship.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // -----------------------------------------------------------------------
    // Rate limiting (task 3.10 / GitHub issue #13 / Q6 decision).
    // Three sliding-window limits, keyed on session.userId (the authenticated
    // actor already confirmed as an Application Admin above): a 20/10-min
    // per-actor burst limit, a 100/24-hr per-actor daily limit, and a
    // 100/10-min global limit across every admin actor combined. A breach of
    // any limit writes a durable audit_log row synchronously (before the 429
    // is returned) and emits the team.manager_association_rate_limit_exceeded
    // structured event, distinct from the routine per-request audit trail so
    // it is ready for Finding 2.3's future monitoring/alerting work. No
    // account lockout occurs on breach — a rate-limit breach and a
    // suspected-compromise determination are different signals.
    // -----------------------------------------------------------------------
    let rateLimitResult: Team006RateLimitResult;
    try {
      rateLimitResult = await enforceTeam006RateLimit(session.userId, request.log);
    } catch (err) {
      if (err instanceof Team006RateLimiterUnavailableError) {
        // Fail-closed by design (see the comment on enforceTeam006RateLimit):
        // the rate limiter's own backing store is unreachable, so this
        // security control cannot be evaluated. Deny the request rather than
        // letting it through as if no limit applied — an explicit, tested
        // 503, not an accident of an uncaught rejection reaching Fastify's
        // generic error handler.
        return reply.code(503).send({
          error: {
            category: "service_unavailable" as const,
            code: "TEAM006_RATE_LIMIT_UNAVAILABLE",
            message:
              "The manager-association rate limiter is temporarily unavailable, so this request " +
              "has been denied as a precaution rather than let through unlimited. This is a " +
              "rate-limiting safety control, not a data or account issue — retry shortly, or " +
              "escalate through your organization's standard security/support process if this persists.",
            correlationId: crypto.randomUUID(),
          },
        });
      }
      throw err;
    }

    if (rateLimitResult.limited) {
      await db.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_global_role, actor_ip, operation,
            target_user_id, team_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          session.userId,
          actorGlobalRole,
          request.ip,
          "team.manager_association_rate_limited",
          null,
          teamId,
          JSON.stringify({
            limit_type: rateLimitResult.limitType,
            observed_count: rateLimitResult.observedCount,
            threshold: rateLimitResult.threshold,
          }),
        ],
      );

      emitAuditEvent(request.log, "team.manager_association_rate_limit_exceeded", {
        actorUserId: session.userId,
        actorGlobalRole,
        actorIp: request.ip,
        teamId,
        limitType: rateLimitResult.limitType,
        observedCount: rateLimitResult.observedCount,
        threshold: rateLimitResult.threshold,
      });

      return reply
        .code(429)
        .header("Retry-After", String(rateLimitResult.retryAfterSeconds))
        .send({
          error: {
            category: "rate_limited" as const,
            code: rateLimitResult.code,
            message: TEAM006_RATE_LIMIT_MESSAGES[rateLimitResult.code],
            correlationId: crypto.randomUUID(),
          },
        });
    }

    // -----------------------------------------------------------------------
    // Team existence check (Decision 4 information-exposure constraint):
    // For non-admin callers, 404 for "not found" is indistinguishable from
    // "found but not authorized to know it exists." For admin callers (already
    // confirmed above), a genuine 404 is acceptable.
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // Global role precondition check (Decision 3 / Decision 4):
    // The target user MUST have global_role = 'engineering_manager'.
    // 409 Conflict with a specific error code distinguishes this from other
    // failures (team not found, unauthorized, etc.).
    // -----------------------------------------------------------------------
    const targetResult = await db.query<{
      global_role: string;
      display_name: string;
    }>(
      `SELECT global_role, display_name FROM users WHERE id = $1`,
      [engineeringManagerUserId],
    );

    if (targetResult.rows.length === 0) {
      return reply.code(404).send({
        error: {
          category: "not_found" as const,
          message: "Target user not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const { global_role: targetGlobalRole, display_name: targetDisplayName } =
      targetResult.rows[0] as { global_role: string; display_name: string };

    if (targetGlobalRole !== "engineering_manager") {
      // 409 Conflict with machine-readable error code so the escalation UX
      // in the team administration view can display the specific failure reason.
      return reply.code(409).send({
        error: {
          category: "precondition_failed" as const,
          code: "GLOBAL_ROLE_PRECONDITION_NOT_MET",
          message:
            "The target user does not have global_role = 'engineering_manager'. " +
            "The user must sign in with an IdP account that has the engineering_manager role claim " +
            "before they can be established as an Engineering Manager for this team.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // -----------------------------------------------------------------------
    // Upsert with xmax idempotency (Decision 3):
    //
    // INSERT ... ON CONFLICT (user_id, team_id) WHERE removed_at IS NULL
    // DO UPDATE SET role = 'engineering_manager'
    // RETURNING id, (xmax = 0) AS is_new_row
    //
    // xmax = 0 is true for freshly inserted rows (no prior transaction updated
    // this row), false for rows that were updated by DO UPDATE. This gives us
    // 201 vs. 200 atomically from the upsert result without a separate SELECT.
    //
    // Why xmax and not SELECT-before-INSERT:
    // A SELECT-before-INSERT has a race condition identical to the one TEAM-005
    // solved: two concurrent admin calls both read "no row," both attempt
    // INSERT, one fails. The xmax inspection eliminates this window entirely.
    //
    // The partial unique constraint team_memberships_active_unique
    // (user_id, team_id WHERE removed_at IS NULL) from migration 7 is required
    // for this ON CONFLICT clause to work. Without it, the upsert fails at
    // runtime with a constraint mismatch error.
    // -----------------------------------------------------------------------
    const client = await db.connect();
    let membershipId: string;
    let isNewRow: boolean;

    try {
      await client.query("BEGIN");

      const upsertResult = await client.query<{ id: string; is_new_row: boolean }>(
        `INSERT INTO team_memberships (user_id, team_id, role)
         VALUES ($1, $2, 'engineering_manager')
         ON CONFLICT (user_id, team_id) WHERE removed_at IS NULL
         DO UPDATE SET role = 'engineering_manager'
         RETURNING id, (xmax = 0) AS is_new_row`,
        [engineeringManagerUserId, teamId],
      );

      const upsertRow = upsertResult.rows[0] as { id: string; is_new_row: boolean };
      membershipId = upsertRow.id;
      isNewRow = upsertRow.is_new_row;

      // Audit trail (Decision 9): written in the same transaction as the
      // team_memberships write. If this INSERT fails, the transaction rolls back
      // and neither row is committed. A committed transaction produces both.
      // The security analyst will verify atomicity before Phase 3 begins.
      await client.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_global_role, actor_ip, operation,
            target_user_id, team_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          session.userId,
          actorGlobalRole,
          request.ip,
          "team.manager_established",
          engineeringManagerUserId,
          teamId,
          JSON.stringify({ is_new_association: isNewRow }),
        ],
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Structured-log counterpart to the DB audit row (for operational alerting)
    emitAuditEvent(request.log, "team.manager_established", {
      actorUserId: session.userId,
      actorGlobalRole,
      actorIp: request.ip,
      engineeringManagerUserId,
      teamId,
      membershipId,
      isNewAssociation: isNewRow,
    });

    const response: EstablishManagerResponse = {
      teamId,
      engineeringManagerUserId,
      engineeringManagerDisplayName: targetDisplayName,
      teamMembershipId: membershipId!,
    };

    // 201 Created for new associations, 200 OK for idempotent re-associations.
    // The response body is identical in both cases (Decision 3) — callers must
    // not rely on the body to distinguish create-new from update-existing.
    return reply.code(isNewRow ? 201 : 200).send(response);
  });
}
