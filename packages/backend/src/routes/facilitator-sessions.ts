import type { FastifyInstance, FastifyBaseLogger } from "fastify";
import type { PoolClient } from "pg";
import { DatabaseError } from "pg";
import { db } from "../db.js";
import type { SessionData } from "../auth/session-store.js";
import { emitAuditEvent } from "../auth/audit-logger.js";
import {
  publishSessionStateChange,
  publishVoteRevealed,
  publishTopicHistoryUpdate,
  clearFacilitatorConnectedFlag,
} from "../realtime/ws-pubsub.js";
import { evaluateSessionSubscriberAccess } from "../auth/session-subscriber-access-helper.js";
import { applyTimingFloor } from "../content/timing-oracle.js";
import { createJoinLink, JOIN_LINK_ACTIVE_SQL } from "../auth/join-link-creation.js";
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
  ActionItemsReviewResponse,
  ActionItemsReviewWrongStatusResponse,
  SessionAlreadyExistsResponse,
  EligibleTeam,
  EligibleTeamsResponse,
  TeamNameCollisionResponse,
} from "@dipstick/shared";

// ---------------------------------------------------------------------------
// TeamNameCollisionSignal — internal marker thrown from inside the
// POST /api/v1/teams transaction (below) to distinguish "the teams INSERT
// itself hit a 23505" from any other DB error during the same transaction,
// without rolling back twice or inspecting err.constraint (design.md D4,
// engineer review Finding 1 -- see that handler's inline comment).
// ---------------------------------------------------------------------------
class TeamNameCollisionSignal extends Error {}

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
// Staleness level mapping (pre-session-action-item-review design.md
// Decision 7): fixed at the literal 1/2/3-session boundaries UC: Flag Stale
// Action Items decided — none at 0, yellow at 1, orange at 2, red at 3+.
// This does NOT read application_settings.staleness_threshold_sessions; an
// earlier version of this function stepped levels at multiples of that
// configurable value (1x/2x/3x), which never actually matched the decided
// requirement (at the shipped default of 2, 3 sessions elapsed computed
// "yellow", not "red"). That setting's row is left in place, unmodified,
// but is no longer read here — see design.md Decision 7 for the full
// rationale and the alternatives that were considered and rejected.
// ---------------------------------------------------------------------------
export function computeStalenessLevel(
  sessionsSinceUpdate: number,
): "none" | "yellow" | "orange" | "red" {
  if (sessionsSinceUpdate >= 3) return "red";
  if (sessionsSinceUpdate >= 2) return "orange";
  if (sessionsSinceUpdate >= 1) return "yellow";
  return "none";
}

export async function fetchPreSessionActionItems(teamId: string): Promise<StartSessionResponse["actionItems"]> {
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
    stalenessLevel: computeStalenessLevel(parseInt(row.sessions_since_update, 10)),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// getOrCreateJoinLink — join-link-redemption-wiring, design.md Decisions 1
// and 3, tasks.md Task 2.1.
//
// Reuses a team's most-recently-created active join_links row (the shared
// JOIN_LINK_ACTIVE_SQL predicate from join-link-creation.ts), or creates one
// via the shared audited createJoinLink helper on a miss. A concurrent race
// on the miss branch (two callers both observing no active row) is accepted
// as ordinary, spec-legal state (Decision 3) -- not database-constrained.
//
// resolveActorGlobalRole is a callback rather than a plain value so it is
// paid only on the miss path: POST /draft already has global_role in scope
// and passes a closure that just returns it; facilitator-state has no such
// value in scope and passes a closure that issues a fresh SELECT, run only
// when a new join_links row is about to be created.
// ---------------------------------------------------------------------------
export async function getOrCreateJoinLink(params: {
  teamId: string;
  createdByUserId: string;
  actorIp: string;
  logger: FastifyBaseLogger;
  resolveActorGlobalRole: () => Promise<string>;
}): Promise<string> {
  const activeResult = await db.query<{ token: string }>(
    `SELECT token FROM join_links
     WHERE team_id = $1 AND ${JOIN_LINK_ACTIVE_SQL}
     ORDER BY created_at DESC LIMIT 1`,
    [params.teamId],
  );

  if (activeResult.rows.length > 0) {
    return (activeResult.rows[0] as { token: string }).token;
  }

  const actorGlobalRole = await params.resolveActorGlobalRole();
  const joinLink = await createJoinLink({
    teamId: params.teamId,
    createdByUserId: params.createdByUserId,
    actorGlobalRole,
    actorIp: params.actorIp,
    logger: params.logger,
  });
  return joinLink.token;
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
  // session-creation-existing-team, design.md Decision D1: the facilitator
  // eligibility check and the facilitator-from-another-team constraint are
  // resolved in a single combined query (the checkAssignRolesAuthorization /
  // evaluateTeamAccess LEFT JOIN shape), read live on every call. Check
  // order, made explicit:
  //   1. No row for the caller -> 401 (unchanged).
  //   2. global_role !== 'facilitator' -> 403, "not a facilitator" message.
  //      Runs first because it depends only on the actor's identity, not on
  //      :teamId.
  //   3. Team existence -> 404 if missing. Runs before the membership
  //      rejection so a nonexistent :teamId never reaches that rejection's
  //      audit write, mirroring every other handler in this file.
  //   4. is_member (already fetched in step 1's query) -> 403,
  //      cross-team-constraint message, audited (Decision D1) -- this is the
  //      check that closes the previously-invisible enforcement gap.
  //   5. Insert, inside a transaction with the session.draft_created audit
  //      write (Decision D1/D3); a sessions_team_active_unique violation
  //      (Decision D3) rolls back and becomes a 409.
  // -------------------------------------------------------------------------
  app.post<{
    Params: { teamId: string };
  }>("/api/v1/teams/:teamId/sessions/draft", async (request, reply) => {
    const session = request.session as unknown as SessionData;
    const { teamId } = request.params;

    const actorResult = await db.query<{ global_role: string; is_member: boolean }>(
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
          category: "session_expired" as const,
          message: "User not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const { global_role, is_member } = actorResult.rows[0] as {
      global_role: string;
      is_member: boolean;
    };

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

    // Facilitator-from-another-team constraint (Decision D1): a facilitator
    // with an active team_memberships row for this team may not create a
    // session for it -- distinct wording from the "not a facilitator" 403
    // above so the two rejections stay distinguishable at the API boundary.
    if (is_member) {
      await db.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_global_role, actor_ip, operation, team_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          session.userId,
          global_role,
          request.ip,
          "session.draft_denied_membership_conflict",
          teamId,
        ],
      );

      emitAuditEvent(request.log, "session.draft_denied_membership_conflict", {
        actorUserId: session.userId,
        actorGlobalRole: global_role,
        actorIp: request.ip,
        teamId,
      });

      return reply.code(403).send({
        error: {
          category: "forbidden" as const,
          message: "A facilitator cannot create a session for a team they are a member of.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Create the draft session
    // join-link-redemption-wiring, task 4.2: join_token is no longer
    // generated or inserted here -- Migration A (task 4.1) has already
    // relaxed the column's NOT NULL constraint, and the response's
    // joinToken is sourced from the real join_links table via get-or-create
    // below, not this dead session-scoped column.
    //
    // Decision D1/D3: the INSERT and its session.draft_created audit_log row
    // are one transaction. A sessions_team_active_unique violation (Decision
    // D3's partial unique index) rolls back and becomes a 409 -- matched on
    // the concrete node-postgres DatabaseError fields, not a message
    // substring, so an unrelated 23505 or any other error propagates
    // unchanged as a 500.
    const client = await db.connect();
    let draftSessionId: string;
    try {
      await client.query("BEGIN");

      const sessionResult = await client.query<{ id: string }>(
        `INSERT INTO sessions
           (team_id, facilitator_id, status, is_first_session, session_number)
         VALUES ($1, $2, 'draft', false,
           COALESCE(
             (SELECT MAX(session_number) + 1 FROM sessions WHERE team_id = $1),
             1
           )
         )
         RETURNING id`,
        [teamId, session.userId],
      );

      draftSessionId = (sessionResult.rows[0] as { id: string }).id;

      await client.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          session.userId,
          global_role,
          request.ip,
          "session.draft_created",
          teamId,
          JSON.stringify({ session_id: draftSessionId }),
        ],
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");

      if (
        err instanceof DatabaseError &&
        err.code === "23505" &&
        err.constraint === "sessions_team_active_unique"
      ) {
        const existingResult = await db.query<{ id: string; status: string }>(
          `SELECT id, status FROM sessions
           WHERE team_id = $1
             AND status IN ('draft', 'lobby', 'pre_session', 'active', 'wrap_up')`,
          [teamId],
        );
        const existing = existingResult.rows[0] as { id: string; status: string };

        const response: SessionAlreadyExistsResponse = {
          errorState: "session_already_exists",
          existingSessionId: existing.id,
          existingSessionStatus: existing.status as SessionStatus,
          teamId,
        };
        return reply.code(409).send(response);
      }

      throw err;
    } finally {
      client.release();
    }

    emitAuditEvent(request.log, "session.draft_created", {
      actorUserId: session.userId,
      actorGlobalRole: global_role,
      actorIp: request.ip,
      teamId,
      sessionId: draftSessionId,
    });

    // join-link-redemption-wiring, design.md Decision 1, tasks.md Task 2.2:
    // the response's joinToken is now a real, redeemable join_links token,
    // sourced via get-or-create -- not the dead session-scoped value above.
    // actor_global_role is the global_role value already resolved and
    // confirmed "facilitator" earlier in this handler; no additional lookup.
    const joinToken = await getOrCreateJoinLink({
      teamId,
      createdByUserId: session.userId,
      actorIp: request.ip,
      logger: request.log,
      resolveActorGlobalRole: async () => global_role,
    });

    return reply.code(201).send({
      sessionId: draftSessionId,
      teamId,
      status: "draft",
      joinToken,
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/teams  (inline-team-creation)
  //
  // Creates a new team, assigns it the canonical default topic set
  // (default-topic-provisioning), and creates that team's first session --
  // all in a single transaction (design.md D3).
  //
  // Route file placement (design.md D3, engineer review Finding 2):
  // implemented here, alongside POST /draft, not in teams.ts -- teams.ts is
  // the existing TEAM-005/TEAM-006 admin/role-management route file, an
  // unrelated domain (team administration, not team creation).
  // facilitator-sessions.ts already owns every other piece of machinery this
  // transaction extends: the POST /draft handler this is a sibling of, the
  // audit-write-in-transaction pattern, the DatabaseError/err.constraint
  // import, and GET /eligible-for-session.
  //
  // Check order, fixed and spec-level (design.md D8, spec's check-ordering
  // requirement): authenticate (global middleware) -> authorize role
  // (facilitator) -> validate name non-empty -> check normalized
  // uniqueness. This bounds the endpoint's enumeration surface to "an
  // already-authenticated facilitator can learn whether a normalized name
  // is taken" -- do not reorder behind a shared "validate the request body"
  // helper or equivalent refactor; a non-facilitator caller must receive an
  // identical 403 regardless of whether the submitted name collides with an
  // existing team (spec's "a non-facilitator caller cannot probe name
  // existence" scenario).
  //
  // is_first_session = true / session_number = 1 are named, explicit
  // literals for this flow (design.md D3), not inherited from POST /draft's
  // hardcoded false -- a team just created in this same transaction can
  // only ever have zero prior sessions. status = 'lobby', not 'draft'
  // (design.md D2): a brand-new team has no prior context for the
  // facilitator to review before opening the room.
  //
  // No team_memberships row is inserted for the creating facilitator
  // anywhere in this handler (design.md D6 -- facilitator-neutrality, a
  // SECURITY-relevant invariant, not a style choice). teams.created_by_user_id
  // is set, but that is not membership: inserting one here would manufacture
  // a same-team-facilitator conflict the first time this person tries to
  // facilitate the team they just created. See this invariant's regression
  // test in facilitator-sessions.test.ts, which carries its own inline
  // comment marking it security-critical per design.md D6.
  // -------------------------------------------------------------------------
  app.post<{
    Body: { name?: string };
  }>("/api/v1/teams", async (request, reply) => {
    const session = request.session as unknown as SessionData;

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

    const { global_role: globalRole } = actorResult.rows[0] as { global_role: string };

    // Check order (design.md D8): role authorization is the first
    // name-independent check, run before name validation or uniqueness.
    if (globalRole !== "facilitator") {
      await db.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_global_role, actor_ip, operation)
         VALUES ($1, $2, $3, $4)`,
        [session.userId, globalRole, request.ip, "team.creation_denied_role"],
      );

      emitAuditEvent(request.log, "team.creation_denied_role", {
        actorUserId: session.userId,
        actorGlobalRole: globalRole,
        actorIp: request.ip,
      });

      return reply.code(403).send({
        error: {
          category: "forbidden" as const,
          message: "Only a facilitator can create a team.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const rawName = request.body?.name;
    const trimmedName = typeof rawName === "string" ? rawName.trim() : "";

    if (trimmedName.length === 0) {
      return reply.code(400).send({
        error: {
          category: "invalid_request" as const,
          message: "Team name is required.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Normalized-name pre-check (design.md D4): fast, clear inline error
    // for the common case. Not the sole enforcement -- the
    // teams_name_unique_normalized functional index (migration 12) is the
    // authoritative backstop against the concurrent-duplicate race this
    // pre-check alone cannot close (see the 23505 handling below).
    const collisionPrecheck = await db.query<{ id: string }>(
      `SELECT id FROM teams WHERE lower(btrim(name)) = lower(btrim($1))`,
      [trimmedName],
    );
    if (collisionPrecheck.rows.length > 0) {
      const body: TeamNameCollisionResponse = {
        errorState: "team_name_collision",
        providedName: trimmedName,
      };
      return reply.code(409).send(body);
    }

    const client = await db.connect();
    let teamId: string;
    let newSessionId: string;
    try {
      await client.query("BEGIN");

      let teamResult;
      try {
        teamResult = await client.query<{ id: string }>(
          `INSERT INTO teams (name, created_by_user_id) VALUES ($1, $2) RETURNING id`,
          [trimmedName, session.userId],
        );
      } catch (err) {
        // design.md D4, engineer review Finding 1: both teams_name_unique
        // and teams_name_unique_normalized are live on this INSERT. An
        // exact-duplicate name violates both simultaneously, and Postgres
        // does not guarantee which constraint's violation is reported first
        // for a concurrent exact-duplicate race -- so any 23505 here is
        // treated as the same collision, regardless of which named
        // constraint fired. Scoped to this specific INSERT (via the
        // TeamNameCollisionSignal marker, rethrown below) rather than a
        // blanket "any 23505 anywhere in this transaction" catch, so a
        // 23505 from a later, unrelated statement is not mistaken for a
        // name collision.
        if (err instanceof DatabaseError && err.code === "23505") {
          throw new TeamNameCollisionSignal();
        }
        throw err;
      }
      teamId = (teamResult.rows[0] as { id: string }).id;

      // default-topic-provisioning: a real, independent row copy from the
      // sentinel __default_topics__ team's is_default rows -- not a
      // reference (design.md D5). display_order is preserved. No "locked"
      // column or flag is written here or anywhere else in this step.
      await client.query(
        `INSERT INTO topics
           (team_id, name, prompt, vote_type, display_order, is_default, first_session_description)
         SELECT $1, name, prompt, vote_type, display_order, is_default, first_session_description
         FROM topics
         WHERE team_id = '00000000-0000-0000-0000-000000000001' AND is_default = true`,
        [teamId],
      );

      const sessionResult = await client.query<{ id: string }>(
        `INSERT INTO sessions
           (team_id, facilitator_id, status, is_first_session, session_number)
         VALUES ($1, $2, 'lobby', true, 1)
         RETURNING id`,
        [teamId, session.userId],
      );
      newSessionId = (sessionResult.rows[0] as { id: string }).id;

      await client.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          session.userId,
          globalRole,
          request.ip,
          "team.created_with_session",
          teamId,
          JSON.stringify({ team_id: teamId, session_id: newSessionId }),
        ],
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");

      if (err instanceof TeamNameCollisionSignal) {
        const body: TeamNameCollisionResponse = {
          errorState: "team_name_collision",
          providedName: trimmedName,
        };
        return reply.code(409).send(body);
      }

      throw err;
    } finally {
      client.release();
    }

    emitAuditEvent(request.log, "team.created_with_session", {
      actorUserId: session.userId,
      actorGlobalRole: globalRole,
      actorIp: request.ip,
      teamId,
      sessionId: newSessionId,
    });

    // join-link-redemption-wiring, design.md Decision 1's note: no joinToken
    // field here (deliberately, not an oversight) -- this endpoint creates a
    // lobby-status session with no control view that needs to display a
    // join link. Verified unconsumed by the frontend (SessionCreationPage's
    // new-team handler reads only { teamId, sessionId }, and DraftSessionHost
    // independently re-fetches facilitator-state for its own joinToken).
    return reply.code(201).send({
      teamId,
      sessionId: newSessionId,
      status: "lobby",
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
  // GET /api/v1/sessions/:sessionId/action-items-review
  // (pre-session-action-item-review, design.md Decision 1)
  //
  // Participant-facing counterpart to POST /start's action-items payload:
  // any authorized session subscriber (not only the facilitator) can fetch
  // the same pre-session review data, while the session is in pre_session
  // status. Reuses evaluateSessionSubscriberAccess and
  // fetchPreSessionActionItems without modifying either.
  //
  // Every response path (404, 409, 200) applies applyTimingFloor() and sets
  // Cache-Control: no-store inline, as it is built — design review security
  // findings F1/F2, treated as design requirements from the start, not
  // hardening bolted on afterward.
  // -------------------------------------------------------------------------
  app.get<{
    Params: { sessionId: string };
  }>("/api/v1/sessions/:sessionId/action-items-review", async (request, reply) => {
    const startTime = Date.now();
    const userSession = request.session as unknown as SessionData;
    const { sessionId } = request.params;

    const grant = await evaluateSessionSubscriberAccess(userSession.userId, sessionId);

    if (grant === null) {
      await applyTimingFloor(startTime);
      reply.header("Cache-Control", "no-store");
      return reply.code(404).send({
        error: {
          category: "not_found" as const,
          message: "Session not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const isFacilitator = grant.path === "facilitator";

    // Decision 1 step 3: a single explicit read, applied uniformly to both
    // grant variants, rather than branching on whether the grant happens to
    // carry sessionStatus (only the facilitator variant does).
    const sessionStatusResult = await db.query<{ status: string }>(
      `SELECT status FROM sessions WHERE id = $1`,
      [sessionId],
    );
    const currentSessionStatus = (sessionStatusResult.rows[0] as { status: string } | undefined)
      ?.status as SessionStatus | undefined;

    if (currentSessionStatus !== "pre_session") {
      await applyTimingFloor(startTime);
      reply.header("Cache-Control", "no-store");
      const body: ActionItemsReviewWrongStatusResponse = {
        currentSessionStatus: currentSessionStatus as SessionStatus,
        isFacilitator,
      };
      return reply.code(409).send(body);
    }

    const actionItems = await fetchPreSessionActionItems(grant.teamId);

    await applyTimingFloor(startTime);
    reply.header("Cache-Control", "no-store");
    const body: ActionItemsReviewResponse = { actionItems, isFacilitator };
    return reply.code(200).send(body);
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
    //
    // serverTimestamp (FR-4.6.1, websocket-specification Decision D2): captured
    // exactly once, here, before publish — never inside dispatchVoteRevealed,
    // which runs once per pod and would otherwise produce a different value
    // per pod for the same reveal.
    await publishVoteRevealed(sessionId, {
      sessionId,
      sessionStatus: sr.status as SessionStatus,
      serverTimestamp: new Date().toISOString(),
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
      // facilitator-reconnect-indicator (design.md Decision 5): the session
      // has just left `active` — the same lifecycle boundary that gates the
      // facilitator_connection_status broadcast itself — so the "prior
      // disconnect" flag no longer describes a live session and is cleared
      // rather than left to outlive it.
      await clearFacilitatorConnectedFlag(sessionId).catch((err: unknown) => {
        request.log.warn({ err, sessionId }, "facilitator_connection_status: failed to clear flag on wrap-up, skipping");
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
    // join-link-redemption-wiring, tasks.md Task 2.3/4.3: join_token is no
    // longer selected here -- joinToken is sourced via get-or-create below.
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

    // join-link-redemption-wiring, design.md Decision 2 (blocking gap closed
    // per engineer/security review): this handler has no global_role value
    // in scope anywhere else -- it authorizes purely on
    // sr.facilitator_id === userSession.userId above. resolveActorGlobalRole
    // issues a fresh SELECT, but only on get-or-create's miss path (i.e.
    // only when a new join_links row is about to be created), matching the
    // "re-read global_role live" convention already used elsewhere in this
    // file (e.g. /advance, /start).
    const joinToken = await getOrCreateJoinLink({
      teamId,
      createdByUserId: userSession.userId,
      actorIp: request.ip,
      logger: request.log,
      resolveActorGlobalRole: async () => {
        const actorResult = await db.query<{ global_role: string }>(
          `SELECT global_role FROM users WHERE id = $1`,
          [userSession.userId],
        );
        return (actorResult.rows[0] as { global_role: string }).global_role;
      },
    });

    const response: FacilitatorSessionStateResponse = {
      sessionId,
      teamId,
      currentSessionState: sr.status as SessionStatus,
      bannerState,
      joinToken,
    };

    return reply.send(response);
  });

  // -------------------------------------------------------------------------
  // GET /api/v1/teams/eligible-for-session
  //
  // session-creation-existing-team, design.md Decision D2. Returns the teams
  // a facilitator may create a session for -- any non-deactivated team with
  // no active team_memberships row for the caller. Deliberately does NOT
  // exclude teams with a live non-terminal session: the 409 at submission
  // time (POST /draft, Decision D3) is the only enforcement point for that,
  // not list-filtering (see design.md D2's Resolved decision).
  //
  // The 403-vs-200 gate here is a live read of users.global_role, run fresh
  // on every call -- never derived from canFacilitateSessions or any other
  // request.session-carried value, matching every other authorization
  // decision in this codebase (evaluateTeamAccess, session-participation's
  // dual-check, POST /draft's own check above).
  // -------------------------------------------------------------------------
  app.get("/api/v1/teams/eligible-for-session", async (request, reply) => {
    const session = request.session as unknown as SessionData;

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
          message: "Only a facilitator can view eligible teams for session creation.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // lastSessionAt: MAX(completed_at) over this team's status = 'complete'
    // sessions only (design.md D2) -- mirrors fetchPreSessionActionItems's
    // existing convention of sourcing only from completed sessions. A live
    // or draft session never masquerades as "last session" context.
    const eligibleResult = await db.query<{
      team_id: string;
      team_name: string;
      last_session_at: Date | null;
    }>(
      `SELECT t.id AS team_id,
              t.name AS team_name,
              (SELECT MAX(s.completed_at) FROM sessions s
                 WHERE s.team_id = t.id AND s.status = 'complete'
              ) AS last_session_at
       FROM teams t
       LEFT JOIN team_memberships tm
             ON tm.team_id = t.id
            AND tm.user_id = $1
            AND tm.removed_at IS NULL
       WHERE tm.id IS NULL
         AND t.deactivated_at IS NULL`,
      [session.userId],
    );

    const eligibleTeams: EligibleTeam[] = eligibleResult.rows.map((row) => ({
      teamId: row.team_id,
      teamName: row.team_name,
      lastSessionAt: row.last_session_at ? row.last_session_at.toISOString() : null,
    }));

    const membershipResult = await db.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM team_memberships
         WHERE user_id = $1 AND removed_at IS NULL
       ) AS exists`,
      [session.userId],
    );
    const callerHasTeamMemberships = (membershipResult.rows[0] as { exists: boolean }).exists;

    const response: EligibleTeamsResponse = {
      eligibleTeams,
      callerHasTeamMemberships,
    };

    return reply.send(response);
  });
}
