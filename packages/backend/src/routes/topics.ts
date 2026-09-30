import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db.js";
import { emitAuditEvent } from "../auth/audit-logger.js";
import { evaluateStandingFacilitatorAccess } from "../auth/standing-facilitator-access-helper.js";
import { hasCompletedFirstSession } from "../auth/topic-lock-helper.js";
import { applyTimingFloor } from "../content/timing-oracle.js";
import type { SessionData } from "../auth/session-store.js";

// ---------------------------------------------------------------------------
// Topic write routes — topic-customization-lock-and-add-custom-topic (#49/#50)
//
// design.md Decision 5: this file is new, holds only the topic-write
// endpoint(s) this change (and future TOPIC-004..007) introduce, and does
// NOT move the existing GET /api/v1/teams/:teamId/topics handler out of
// content.ts.
//
// Check-ordering cascade for POST /api/v1/teams/:teamId/topics
// (design.md Decision 9, tasks.md Section 3):
//
//   1. Identity/role authorization (Task 3.1) -- 403 NOT_A_FACILITATOR /
//      FACILITATOR_IS_TEAM_MEMBER. Reveals nothing about any specific team.
//   2. Team existence (Task 3.2) -- 404. Runs only after step 1 passes.
//   3. Customization lock (Task 3.3) -- 409 TOPIC_CUSTOMIZATION_LOCKED.
//      Runs only after step 2 passes.
//   4. Request body validation (Task 5.3) -- 422. Runs only after step 3
//      passes.
//
// Every early-return in this cascade -- 403, 404, 409, 422, and the 201
// success path -- applies applyTimingFloor(startTime) before responding
// (design.md Decision 9's security-review Finding 1 amendment): a fixed
// status-code ordering alone does not close the enumeration-resistance
// guarantee this cascade exists to provide; response latency is a separate
// channel that must be flattened too.
// ---------------------------------------------------------------------------

const LOCK_MESSAGE = "Topics cannot be customized until this team's first session is completed.";

type ErrorCategory = "forbidden" | "not_found" | "precondition_failed" | "invalid_request";

// design.md Decision 4 (corrected per engineer review M1): the codebase's
// standard error envelope -- { error: { category, code, message,
// correlationId } } -- the same shape teams.ts's GLOBAL_ROLE_PRECONDITION_NOT_MET
// (409) and TEAM006_BURST_LIMIT_EXCEEDED (429) already use. Never a bare
// top-level { code, message } body.
function buildErrorEnvelope(
  category: ErrorCategory,
  message: string,
  code?: string,
  field?: string,
): {
  error: { category: ErrorCategory; code?: string; field?: string; message: string; correlationId: string };
} {
  return {
    error: {
      category,
      ...(code ? { code } : {}),
      ...(field ? { field } : {}),
      message,
      correlationId: crypto.randomUUID(),
    },
  };
}

// ---------------------------------------------------------------------------
// Task 3.1 — standing-facilitator authorization check
//
// design.md Decision 3 (Philosophy 1): global_role = 'facilitator' AND the
// caller is not an active member of the target team. Evaluated and returned
// before any team-existence or lock check. Does not require the target team
// to exist: the role sub-check touches no team data, and the membership
// sub-check against a nonexistent teamId is vacuously "not a member" and
// passes through to Task 3.2 (design.md Decision 9's ordering rationale).
//
// design.md Decision 9's engineer-review (M2) addendum: reuses
// facilitator-sessions.ts's POST /draft authorization query verbatim, via
// the extracted evaluateStandingFacilitatorAccess helper -- not a third
// independent copy of it.
// ---------------------------------------------------------------------------
type AuthorizationResult =
  | { rejected: false; actorGlobalRole: string }
  | { rejected: true };

async function checkStandingFacilitatorAuthorization(
  reply: FastifyReply,
  userId: string,
  teamId: string,
  startTime: number,
): Promise<AuthorizationResult> {
  const grant = await evaluateStandingFacilitatorAccess(userId, teamId);

  // No user row for the caller at all -- treated the same as "not a
  // facilitator" for this endpoint's cascade (no separate 401 branch is
  // specified anywhere in this change's design/spec deltas; the
  // authenticated session middleware already guarantees a user row exists
  // for any normal request that reaches this handler).
  if (grant === null || grant.globalRole !== "facilitator") {
    await applyTimingFloor(startTime);
    await reply
      .code(403)
      .send(
        buildErrorEnvelope(
          "forbidden",
          "Only a facilitator can add a custom topic.",
          "NOT_A_FACILITATOR",
        ),
      );
    return { rejected: true };
  }

  if (grant.isMember) {
    await applyTimingFloor(startTime);
    await reply
      .code(403)
      .send(
        buildErrorEnvelope(
          "forbidden",
          "A facilitator cannot add a custom topic to a team they are a member of.",
          "FACILITATOR_IS_TEAM_MEMBER",
        ),
      );
    return { rejected: true };
  }

  return { rejected: false, actorGlobalRole: grant.globalRole };
}

// ---------------------------------------------------------------------------
// Task 3.2 — team-existence check
//
// design.md Decision 11: SELECT id FROM teams WHERE id = $1, with NO
// deactivated_at filter. A deactivated team is treated as existing, matching
// POST /draft's identical check -- this is a stated decision, not an
// oversight.
// ---------------------------------------------------------------------------
async function checkTeamExists(
  reply: FastifyReply,
  teamId: string,
  startTime: number,
): Promise<{ rejected: boolean }> {
  const result = await db.query<{ id: string }>(`SELECT id FROM teams WHERE id = $1`, [teamId]);

  if (result.rows.length === 0) {
    await applyTimingFloor(startTime);
    await reply.code(404).send(buildErrorEnvelope("not_found", "Team not found."));
    return { rejected: true };
  }

  return { rejected: false };
}

// ---------------------------------------------------------------------------
// Task 4.1/4.2/4.4 — audit write for a denied lock-bypass attempt
//
// design.md Decision 8: a synchronous audit_log row (operation =
// 'topic.write_denied_locked'), written BEFORE the 409 response is sent.
// Shared across every topic-write endpoint this lock ever gates -- callers
// are distinguished only by metadata (endpoint, attempted_operation), never
// by a per-endpoint operation variant (per
// specs/topic-customization-lock/spec.md's "Denied attempts against
// different endpoints all use the same audit operation" scenario).
// ---------------------------------------------------------------------------
async function writeLockDenialAudit(
  request: FastifyRequest,
  params: {
    actorUserId: string;
    actorGlobalRole: string;
    teamId: string;
    endpoint: string;
    attemptedOperation: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log
       (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.actorUserId,
      params.actorGlobalRole,
      request.ip,
      "topic.write_denied_locked",
      params.teamId,
      JSON.stringify({ endpoint: params.endpoint, attempted_operation: params.attemptedOperation }),
    ],
  );

  emitAuditEvent(request.log, "topic.write_denied_locked", {
    actorUserId: params.actorUserId,
    actorGlobalRole: params.actorGlobalRole,
    actorIp: request.ip,
    teamId: params.teamId,
    endpoint: params.endpoint,
    attemptedOperation: params.attemptedOperation,
  });
}

// ---------------------------------------------------------------------------
// Task 3.3/3.4 — customization lock gate
//
// design.md Decision 1: uses the single shared lock-check function
// (hasCompletedFirstSession) -- no inline COUNT(*)/EXISTS query against
// sessions.status = 'complete' anywhere in this file. Evaluated only after
// Task 3.2's team-existence check passes.
// ---------------------------------------------------------------------------
async function checkCustomizationLockGate(
  request: FastifyRequest,
  reply: FastifyReply,
  params: { actorUserId: string; actorGlobalRole: string; teamId: string; endpoint: string },
  startTime: number,
): Promise<{ rejected: boolean }> {
  const unlocked = await hasCompletedFirstSession(params.teamId);

  if (!unlocked) {
    await writeLockDenialAudit(request, {
      actorUserId: params.actorUserId,
      actorGlobalRole: params.actorGlobalRole,
      teamId: params.teamId,
      endpoint: params.endpoint,
      attemptedOperation: "topic.custom_added",
    });

    await applyTimingFloor(startTime);
    await reply
      .code(409)
      .send(buildErrorEnvelope("precondition_failed", LOCK_MESSAGE, "TOPIC_CUSTOMIZATION_LOCKED"));
    return { rejected: true };
  }

  return { rejected: false };
}

// ---------------------------------------------------------------------------
// Task 5.3 — request body validation
//
// name required, non-empty after trim, <=100 chars; prompt required,
// non-empty after trim, <=500 chars; voteType required, one of
// finger/roman/modified_roman; firstSessionDescription optional, <=500
// chars. Evaluated in this order, returning the first failing field.
// ---------------------------------------------------------------------------
interface AddCustomTopicRequestBody {
  name?: unknown;
  prompt?: unknown;
  voteType?: unknown;
  firstSessionDescription?: unknown;
}

interface ValidatedAddCustomTopicBody {
  name: string;
  prompt: string;
  voteType: "finger" | "roman" | "modified_roman";
  firstSessionDescription: string | null;
}

const VALID_VOTE_TYPES = ["finger", "roman", "modified_roman"] as const;

type ValidationResult =
  | { valid: true; data: ValidatedAddCustomTopicBody }
  | { valid: false; field: string; message: string };

function validateAddCustomTopicBody(body: AddCustomTopicRequestBody): ValidationResult {
  const rawName = body.name;
  const trimmedName = typeof rawName === "string" ? rawName.trim() : "";
  if (typeof rawName !== "string" || trimmedName.length === 0 || trimmedName.length > 100) {
    return {
      valid: false,
      field: "name",
      message: "name is required, must be non-empty after trimming, and at most 100 characters.",
    };
  }

  const rawPrompt = body.prompt;
  const trimmedPrompt = typeof rawPrompt === "string" ? rawPrompt.trim() : "";
  if (typeof rawPrompt !== "string" || trimmedPrompt.length === 0 || trimmedPrompt.length > 500) {
    return {
      valid: false,
      field: "prompt",
      message: "prompt is required, must be non-empty after trimming, and at most 500 characters.",
    };
  }

  const rawVoteType = body.voteType;
  if (
    typeof rawVoteType !== "string" ||
    !(VALID_VOTE_TYPES as readonly string[]).includes(rawVoteType)
  ) {
    return {
      valid: false,
      field: "voteType",
      message: "voteType is required and must be one of 'finger', 'roman', 'modified_roman'.",
    };
  }

  let firstSessionDescription: string | null = null;
  if (body.firstSessionDescription !== undefined && body.firstSessionDescription !== null) {
    if (typeof body.firstSessionDescription !== "string" || body.firstSessionDescription.length > 500) {
      return {
        valid: false,
        field: "firstSessionDescription",
        message: "firstSessionDescription must be a string of at most 500 characters.",
      };
    }
    firstSessionDescription = body.firstSessionDescription;
  }

  return {
    valid: true,
    data: {
      name: trimmedName,
      prompt: trimmedPrompt,
      voteType: rawVoteType as ValidatedAddCustomTopicBody["voteType"],
      firstSessionDescription,
    },
  };
}

export async function topicRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // POST /api/v1/teams/:teamId/topics  (TOPIC-003, Add Custom Topic)
  // -------------------------------------------------------------------------
  app.post<{
    Params: { teamId: string };
    Body: AddCustomTopicRequestBody;
  }>("/api/v1/teams/:teamId/topics", async (request, reply) => {
    const startTime = Date.now();
    const session = request.session as unknown as SessionData;
    const { teamId } = request.params;
    const endpoint = "POST /api/v1/teams/:teamId/topics";

    // Task 3.1 / Task 3.6 — 403, checked first.
    const authResult = await checkStandingFacilitatorAuthorization(
      reply,
      session.userId,
      teamId,
      startTime,
    );
    if (authResult.rejected) {
      return reply;
    }

    // Task 3.2 / Task 3.6 — 404, checked second.
    const existsResult = await checkTeamExists(reply, teamId, startTime);
    if (existsResult.rejected) {
      return reply;
    }

    // Task 3.3 / Task 3.6 — 409, checked third.
    const lockResult = await checkCustomizationLockGate(
      request,
      reply,
      {
        actorUserId: session.userId,
        actorGlobalRole: authResult.actorGlobalRole,
        teamId,
        endpoint,
      },
      startTime,
    );
    if (lockResult.rejected) {
      return reply;
    }

    // Task 5.3 — 422, checked last.
    const validation = validateAddCustomTopicBody(request.body ?? {});
    if (!validation.valid) {
      await applyTimingFloor(startTime);
      return reply
        .code(422)
        .send(
          buildErrorEnvelope("invalid_request", validation.message, "VALIDATION_FAILED", validation.field),
        );
    }

    const { name, prompt, voteType, firstSessionDescription } = validation.data;

    // -------------------------------------------------------------------
    // Task 5.4 — insert, guarded by design.md Decision 10 (corrected per
    // engineer review B1, blocking): a per-team Postgres advisory
    // transaction lock is taken BEFORE the MAX(display_order) read, so a
    // second concurrent request's own MAX read is not merely
    // unblocked-and-rechecked against a stale snapshot -- it is not issued
    // at all until after the lock is granted, and therefore sees the
    // sibling's newly committed row.
    // -------------------------------------------------------------------
    const client = await db.connect();
    let topicId: string;
    let createdAt: Date;
    let displayOrder: number;
    try {
      await client.query("BEGIN");

      await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [teamId]);

      const maxResult = await client.query<{ next_display_order: number }>(
        `SELECT COALESCE(MAX(display_order), -1) + 1 AS next_display_order
         FROM topics
         WHERE team_id = $1 AND status = 'active'`,
        [teamId],
      );
      displayOrder = (maxResult.rows[0] as { next_display_order: number }).next_display_order;

      const insertResult = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO topics
           (team_id, name, prompt, vote_type, display_order, status, is_default, first_session_description)
         VALUES ($1, $2, $3, $4, $5, 'active', false, $6)
         RETURNING id, created_at`,
        [teamId, name, prompt, voteType, displayOrder, firstSessionDescription],
      );
      const insertedRow = insertResult.rows[0] as { id: string; created_at: Date };
      topicId = insertedRow.id;
      createdAt = insertedRow.created_at;

      // Task 5.4.1 — success audit, same transaction as the INSERT
      // (design.md Decision 8's engineer/security-review amendment,
      // Finding 3).
      await client.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          session.userId,
          authResult.actorGlobalRole,
          request.ip,
          "topic.custom_added",
          teamId,
          JSON.stringify({ topic_id: topicId }),
        ],
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    emitAuditEvent(request.log, "topic.custom_added", {
      actorUserId: session.userId,
      actorGlobalRole: authResult.actorGlobalRole,
      actorIp: request.ip,
      teamId,
      topicId,
    });

    await applyTimingFloor(startTime);
    return reply.code(201).send({
      topicId,
      name,
      prompt,
      voteType,
      displayOrder,
      isDefault: false,
      createdAt: createdAt.toISOString(),
    });
  });
}
