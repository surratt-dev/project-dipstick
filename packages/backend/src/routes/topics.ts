import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { db } from "../db.js";
import { emitAuditEvent } from "../auth/audit-logger.js";
import {
  evaluateStandingFacilitatorAccess,
  checkStandingFacilitatorOrAdminAuthorization,
} from "../auth/standing-facilitator-access-helper.js";
import { hasCompletedFirstSession } from "../auth/topic-lock-helper.js";
import { getOpenActionItemsForTopic } from "../auth/open-action-items-helper.js";
import { applyTimingFloor } from "../content/timing-oracle.js";
import type { SessionData } from "../auth/session-store.js";
import type {
  ArchiveTopicResponse,
  ArchiveTopicConfirmationRequired,
  RestoreTopicResponse,
  ReorderedTopic,
  ReorderTopicsResponse,
} from "@dipstick/shared";

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
    await reply.code(404).send(buildErrorEnvelope("not_found", "Team not found.", "TEAM_NOT_FOUND"));
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
  params: {
    actorUserId: string;
    actorGlobalRole: string;
    teamId: string;
    endpoint: string;
    attemptedOperation: string;
  },
  startTime: number,
): Promise<{ rejected: boolean }> {
  const unlocked = await hasCompletedFirstSession(params.teamId);

  if (!unlocked) {
    await writeLockDenialAudit(request, {
      actorUserId: params.actorUserId,
      actorGlobalRole: params.actorGlobalRole,
      teamId: params.teamId,
      endpoint: params.endpoint,
      attemptedOperation: params.attemptedOperation,
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

// ---------------------------------------------------------------------------
// Task 3.1 — TOPIC-004 identity/role check
//
// design.md Decision 1 (engineer-review correction, Finding 1, BLOCKING):
// calls the shared, decision-only checkStandingFacilitatorOrAdminAuthorization
// (auth/standing-facilitator-access-helper.ts) rather than reusing
// checkStandingFacilitatorAuthorization (TOPIC-003, above) verbatim -- that
// check has no application_admin branch and would violate FR-8.2 [HARD] for
// this endpoint. Because the shared function is decision-only (no reply, no
// applyTimingFloor), this wrapper writes its own TOPIC-004-appropriate
// message and applies the timing floor itself, on both reason branches.
// ---------------------------------------------------------------------------
async function checkArchiveTopicAuthorization(
  reply: FastifyReply,
  userId: string,
  teamId: string,
  startTime: number,
): Promise<AuthorizationResult> {
  const decision = await checkStandingFacilitatorOrAdminAuthorization(userId, teamId);

  if (!decision.authorized) {
    const message =
      decision.reason === "FACILITATOR_IS_TEAM_MEMBER"
        ? "A facilitator cannot archive a topic for a team they are a member of."
        : "Only a facilitator or an application admin can archive a topic.";

    await applyTimingFloor(startTime);
    await reply.code(403).send(buildErrorEnvelope("forbidden", message, decision.reason));
    return { rejected: true };
  }

  return { rejected: false, actorGlobalRole: decision.actorGlobalRole };
}

// ---------------------------------------------------------------------------
// Task 3.2/3.3 — topic existence/ownership and status checks
//
// Evaluated only after Task 3.1 (identity/role), team existence, and the
// customization lock all pass (design.md Decision 2's cascade, steps 4-5).
// ---------------------------------------------------------------------------
async function checkTopicExistsAndActive(
  reply: FastifyReply,
  teamId: string,
  topicId: string,
  startTime: number,
): Promise<{ rejected: boolean }> {
  const result = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM topics WHERE id = $1 AND team_id = $2`,
    [topicId, teamId],
  );

  if (result.rows.length === 0) {
    await applyTimingFloor(startTime);
    await reply.code(404).send(buildErrorEnvelope("not_found", "Topic not found.", "TOPIC_NOT_FOUND"));
    return { rejected: true };
  }

  const topicRow = result.rows[0] as { id: string; status: string };
  if (topicRow.status !== "active") {
    await applyTimingFloor(startTime);
    await reply
      .code(422)
      .send(
        buildErrorEnvelope("invalid_request", "This topic is already archived.", "TOPIC_ALREADY_ARCHIVED"),
      );
    return { rejected: true };
  }

  return { rejected: false };
}

// ---------------------------------------------------------------------------
// Task 2.1 — TOPIC-005 identity/role check
//
// design.md Decision 1: calls the shared, decision-only
// checkStandingFacilitatorOrAdminAuthorization verbatim — the same function
// TOPIC-002/TOPIC-004 already call — not a new, TOPIC-005-specific check.
// Because the shared function is decision-only (no reply, no
// applyTimingFloor), this wrapper writes its own TOPIC-005-appropriate
// message and applies the timing floor itself, on both reason branches.
// ---------------------------------------------------------------------------
async function checkRestoreTopicAuthorization(
  reply: FastifyReply,
  userId: string,
  teamId: string,
  startTime: number,
): Promise<AuthorizationResult> {
  const decision = await checkStandingFacilitatorOrAdminAuthorization(userId, teamId);

  if (!decision.authorized) {
    const message =
      decision.reason === "FACILITATOR_IS_TEAM_MEMBER"
        ? "A facilitator cannot restore a topic for a team they are a member of."
        : "Only a facilitator or an application admin can restore a topic.";

    await applyTimingFloor(startTime);
    await reply.code(403).send(buildErrorEnvelope("forbidden", message, decision.reason));
    return { rejected: true };
  }

  return { rejected: false, actorGlobalRole: decision.actorGlobalRole };
}

// ---------------------------------------------------------------------------
// Task 2.3/2.4 — TOPIC-005 topic existence/ownership and status checks
//
// Evaluated only after the identity/role, team existence, and customization
// lock checks all pass (design.md Decision 2's cascade, steps 4-5). Mirrors
// checkTopicExistsAndActive's shape, inverted for restore's direction: the
// precondition is status = 'archived', not status = 'active'.
// ---------------------------------------------------------------------------
async function checkTopicExistsAndArchived(
  reply: FastifyReply,
  teamId: string,
  topicId: string,
  startTime: number,
): Promise<{ rejected: boolean }> {
  const result = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM topics WHERE id = $1 AND team_id = $2`,
    [topicId, teamId],
  );

  if (result.rows.length === 0) {
    await applyTimingFloor(startTime);
    await reply.code(404).send(buildErrorEnvelope("not_found", "Topic not found.", "TOPIC_NOT_FOUND"));
    return { rejected: true };
  }

  const topicRow = result.rows[0] as { id: string; status: string };
  if (topicRow.status !== "archived") {
    await applyTimingFloor(startTime);
    await reply
      .code(422)
      .send(buildErrorEnvelope("invalid_request", "This topic is already active.", "TOPIC_ALREADY_ACTIVE"));
    return { rejected: true };
  }

  return { rejected: false };
}

// ---------------------------------------------------------------------------
// reorder-topics Task 3.2 — TOPIC-006 identity/role check
//
// design.md Decision 2 step 1: calls the shared, decision-only
// checkStandingFacilitatorOrAdminAuthorization, mirroring
// checkRestoreTopicAuthorization. Must not be copied from TOPIC-003's
// facilitator-only checkStandingFacilitatorAuthorization, which would
// silently drop the application_admin branch. Writes its own message and
// applies the timing floor itself, on both reason branches.
// ---------------------------------------------------------------------------
async function checkReorderTopicsAuthorization(
  reply: FastifyReply,
  userId: string,
  teamId: string,
  startTime: number,
): Promise<AuthorizationResult> {
  const decision = await checkStandingFacilitatorOrAdminAuthorization(userId, teamId);

  if (!decision.authorized) {
    const message =
      decision.reason === "FACILITATOR_IS_TEAM_MEMBER"
        ? "A facilitator cannot reorder topics for a team they are a member of."
        : "Only a facilitator or an application admin can reorder topics.";

    await applyTimingFloor(startTime);
    await reply.code(403).send(buildErrorEnvelope("forbidden", message, decision.reason));
    return { rejected: true };
  }

  return { rejected: false, actorGlobalRole: decision.actorGlobalRole };
}

// ---------------------------------------------------------------------------
// reorder-topics Task 3.4 — TOPIC-006 body validation
//
// design.md Decision 2 step 4 (security review F2/F3/F4, engineer review
// M2/M7), evaluated in this order:
//   1. the body is a non-array object (null, bare-array, and string bodies
//      are a 422, never a TypeError -> 500);
//   2. orderedTopicIds is an array;
//   3. length is 1..MAX_REORDER_TOPICS, checked BEFORE any per-entry work so
//      pre-lock work is bounded by the cap, not by the body-size limit;
//   4. every entry is a string matching the strict UUID pattern,
//      case-insensitively;
//   5. every entry is lowercased, then checked for duplicates.
// Unknown top-level keys are ignored, matching TOPIC-003's destructuring.
// Messages state the rule and never echo submitted values.
// ---------------------------------------------------------------------------
const MAX_REORDER_TOPICS = 200;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReorderValidationResult = { valid: true; orderedTopicIds: string[] } | { valid: false; message: string };

function validateReorderTopicsBody(body: unknown): ReorderValidationResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { valid: false, message: "The request body must be an object with an orderedTopicIds array." };
  }

  const raw = (body as { orderedTopicIds?: unknown }).orderedTopicIds;
  if (!Array.isArray(raw)) {
    return { valid: false, message: "orderedTopicIds is required and must be an array." };
  }

  if (raw.length < 1 || raw.length > MAX_REORDER_TOPICS) {
    return {
      valid: false,
      message: `orderedTopicIds must contain between 1 and ${MAX_REORDER_TOPICS} entries.`,
    };
  }

  if (!raw.every((entry) => typeof entry === "string" && UUID_PATTERN.test(entry))) {
    return { valid: false, message: "Every entry in orderedTopicIds must be a topic ID (UUID)." };
  }

  const lowered = (raw as string[]).map((id) => id.toLowerCase());
  if (new Set(lowered).size !== lowered.length) {
    return { valid: false, message: "orderedTopicIds must not contain the same topic ID more than once." };
  }

  return { valid: true, orderedTopicIds: lowered };
}

// ---------------------------------------------------------------------------
// reorder-topics Task 4.4 — thrown when either renumber phase updates a row
// count other than N. Cannot happen under the per-team advisory lock; it is
// the defense in depth that keeps a foreign or archived ID from ever being
// renumbered even if the in-memory set check were wrong (design.md
// Decision 3). Rolled back and rethrown to the global error handler (500).
// ---------------------------------------------------------------------------
export class ReorderRowCountMismatchError extends Error {
  constructor(phase: 1 | 2, expected: number, actual: number | null) {
    super(`Reorder phase ${phase} updated ${actual ?? "unknown"} rows; expected ${expected}.`);
    this.name = "ReorderRowCountMismatchError";
  }
}

// ---------------------------------------------------------------------------
// reorder-topics Task 4.2 — open-session hint
//
// design.md Decision 7: only for a caller whose global_role is
// 'facilitator'. For application_admin the query is NOT issued at all
// (admins are denied session content; this must not become an unaudited
// way to learn a team's session state). 'draft' is deliberately excluded:
// the topic snapshot belongs at lobby entry (#175). ORDER BY ... LIMIT 1 so
// a drift in migration 10's one-open-session invariant degrades to "the
// newest one" rather than a 500.
// ---------------------------------------------------------------------------
async function readOpenSessionCreatedAt(
  client: PoolClient,
  teamId: string,
  actorGlobalRole: string,
): Promise<string | null> {
  if (actorGlobalRole !== "facilitator") {
    return null;
  }

  const result = await client.query<{ created_at: Date }>(
    `SELECT created_at FROM sessions
      WHERE team_id = $1 AND status IN ('lobby', 'pre_session', 'active', 'wrap_up')
      ORDER BY created_at DESC
      LIMIT 1`,
    [teamId],
  );
  const row = result.rows[0];
  return row ? new Date(row.created_at).toISOString() : null;
}

const TOPIC_ORDER_STALE_MESSAGE =
  "The team's topic list has changed since it was loaded. Reload the topics and try again.";

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
        attemptedOperation: "topic.custom_added",
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

  // -------------------------------------------------------------------------
  // DELETE /api/v1/teams/:teamId/topics/:topicId  (TOPIC-004, Archive Topic)
  //
  // Check-ordering cascade (design.md Decision 2, spec.md "Archive Topic
  // evaluates checks in a fixed order"):
  //   1. Identity/role authorization (Task 3.1) -- 403 NOT_A_FACILITATOR /
  //      FACILITATOR_IS_TEAM_MEMBER, extended to admit application_admin.
  //   2. Team existence (reused unchanged from TOPIC-003) -- 404.
  //   3. Customization lock (reused unchanged from TOPIC-003) -- 409
  //      TOPIC_CUSTOMIZATION_LOCKED, audited via writeLockDenialAudit.
  //   4. Topic existence/ownership (Task 3.2) -- 404 TOPIC_NOT_FOUND.
  //   5. Topic status (Task 3.3) -- 422 TOPIC_ALREADY_ARCHIVED.
  //   6. Last-active-topic guard (Task 4.1) -- 409 TOPIC_LAST_ACTIVE, inside
  //      a per-team advisory-lock-held transaction.
  //   7. Open-action-item confirmation (Task 5.1/5.2) -- 200
  //      requiresConfirmation, same transaction.
  //   8. Success: archive UPDATE + audit row (Task 5.3/6.1), same
  //      transaction, 200.
  //
  // Every early-return in this cascade, plus both 200 outcomes in steps
  // 7-8, applies applyTimingFloor(startTime) (design.md Decision 2's
  // amendment, Task 3.4/4.2/5.4) -- no branch is exempt.
  // -------------------------------------------------------------------------
  app.delete<{
    Params: { teamId: string; topicId: string };
    Querystring: { confirm?: string };
  }>("/api/v1/teams/:teamId/topics/:topicId", async (request, reply) => {
    const startTime = Date.now();
    const session = request.session as unknown as SessionData;
    const { teamId, topicId } = request.params;
    const endpoint = "DELETE /api/v1/teams/:teamId/topics/:topicId";
    const confirmed = request.query.confirm === "true";

    // Task 3.1 / Task 3.6 — 403, checked first.
    const authResult = await checkArchiveTopicAuthorization(reply, session.userId, teamId, startTime);
    if (authResult.rejected) {
      return reply;
    }

    // Team existence — 404, checked second. Reused unchanged from TOPIC-003.
    const existsResult = await checkTeamExists(reply, teamId, startTime);
    if (existsResult.rejected) {
      return reply;
    }

    // Customization lock — 409, checked third. Reused unchanged from
    // TOPIC-003, including its writeLockDenialAudit call (the shared
    // topic.write_denied_locked operation, no new per-endpoint variant).
    const lockResult = await checkCustomizationLockGate(
      request,
      reply,
      {
        actorUserId: session.userId,
        actorGlobalRole: authResult.actorGlobalRole,
        teamId,
        endpoint,
        attemptedOperation: "topic.archived",
      },
      startTime,
    );
    if (lockResult.rejected) {
      return reply;
    }

    // Task 3.2/3.3 — topic existence (404) then topic status (422), checked
    // fourth and fifth.
    const topicCheck = await checkTopicExistsAndActive(reply, teamId, topicId, startTime);
    if (topicCheck.rejected) {
      return reply;
    }

    // Task 4.1/5.1-5.3/6.1 — last-active-topic guard, open-action-item
    // confirmation flow, and the archive transition, all inside one
    // transaction guarded by the same per-team advisory lock TOPIC-003's
    // POST /topics already uses (design.md Decision 3's SQL block).
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [teamId]);

      const activeCountResult = await client.query<{ active_count: string }>(
        `SELECT COUNT(*) AS active_count FROM topics WHERE team_id = $1 AND status = 'active'`,
        [teamId],
      );
      const activeCount = parseInt(
        (activeCountResult.rows[0] as { active_count: string }).active_count,
        10,
      );

      // Task 4.1/4.2 — last-active-topic guard.
      if (activeCount <= 1) {
        await client.query("ROLLBACK");
        await applyTimingFloor(startTime);
        return reply
          .code(409)
          .send(
            buildErrorEnvelope(
              "precondition_failed",
              "This is the team's last active topic. At least one active topic must remain.",
              "TOPIC_LAST_ACTIVE",
            ),
          );
      }

      let openActionItemCount: number;

      if (!confirmed) {
        // Task 5.1 — unconfirmed path: one or more open action items
        // rolls back and returns 200 requiresConfirmation without
        // archiving. Zero open items proceeds to archive with a known
        // count of 0.
        const openItems = await getOpenActionItemsForTopic(topicId, client);
        if (openItems.length > 0) {
          await client.query("ROLLBACK");
          await applyTimingFloor(startTime);
          const confirmationResponse: ArchiveTopicConfirmationRequired = {
            requiresConfirmation: true,
            reason: "openActionItems",
            openActionItemCount: openItems.length,
            openActionItems: openItems,
            message: `${openItems.length} open action item${
              openItems.length === 1 ? "" : "s"
            } will stay open, but nothing will remind anyone about them going forward.`,
          };
          return reply.code(200).send(confirmationResponse);
        }
        openActionItemCount = 0;
      } else {
        // Task 5.2 — confirm=true: never trust a client-supplied count or
        // list. Independently re-derive it inside this transaction. This
        // re-derivation does not gate the outcome (the archive proceeds
        // regardless of what it returns), but the result is not discarded
        // — it is written into the success audit row below (design.md
        // Decision 5's engineer-review correction, Finding 2), so the
        // re-derivation is an observable record, not inert work.
        const reDerivedItems = await getOpenActionItemsForTopic(topicId, client);
        openActionItemCount = reDerivedItems.length;
      }

      // Task 5.3 — archive UPDATE.
      const archiveResult = await client.query<{ archived_at: Date }>(
        `UPDATE topics SET status = 'archived', archived_at = now(), archived_by = $1
         WHERE id = $2 AND team_id = $3 AND status = 'active'
         RETURNING archived_at`,
        [session.userId, topicId, teamId],
      );

      if (archiveResult.rows.length === 0) {
        // Topic was archived by a concurrent request between Task 3.3's
        // pre-check and this UPDATE (both serialized per-team by the
        // advisory lock, but the pre-check itself runs before the lock is
        // taken) — same state the pre-check would have rejected.
        await client.query("ROLLBACK");
        await applyTimingFloor(startTime);
        return reply
          .code(422)
          .send(
            buildErrorEnvelope("invalid_request", "This topic is already archived.", "TOPIC_ALREADY_ARCHIVED"),
          );
      }

      const archivedAt = (archiveResult.rows[0] as { archived_at: Date }).archived_at;

      // Task 6.1 — success audit row, same transaction as the UPDATE.
      await client.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          session.userId,
          authResult.actorGlobalRole,
          request.ip,
          "topic.archived",
          teamId,
          JSON.stringify({ topic_id: topicId, openActionItemCount }),
        ],
      );

      await client.query("COMMIT");

      // Task 6.2 — structured-log counterpart, matching topic.custom_added's
      // pairing.
      emitAuditEvent(request.log, "topic.archived", {
        actorUserId: session.userId,
        actorGlobalRole: authResult.actorGlobalRole,
        actorIp: request.ip,
        teamId,
        topicId,
        openActionItemCount,
      });

      await applyTimingFloor(startTime);
      const successResponse: ArchiveTopicResponse = {
        topicId,
        status: "archived",
        archivedAt: archivedAt.toISOString(),
      };
      return reply.code(200).send(successResponse);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/teams/:teamId/topics/:topicId/restore  (TOPIC-005, Restore
  // Topic)
  //
  // Check-ordering cascade (design.md Decision 2, spec.md "Restore Topic
  // evaluates checks in a fixed order"):
  //   1. Identity/role authorization (Decision 1) -- 403 NOT_A_FACILITATOR /
  //      FACILITATOR_IS_TEAM_MEMBER, admits application_admin.
  //   2. Team existence (reused unchanged from TOPIC-003/004) -- 404.
  //   3. Customization lock (reused unchanged from TOPIC-003/004) -- 409
  //      TOPIC_CUSTOMIZATION_LOCKED, audited via writeLockDenialAudit.
  //   4. Topic existence/ownership -- 404 TOPIC_NOT_FOUND.
  //   5. Topic status -- 422 TOPIC_ALREADY_ACTIVE.
  //   6. Advisory-lock-guarded append-position reposition and status flip
  //      (Decision 3) -- 200 OK.
  //
  // One step shorter than TOPIC-004's cascade by design: restoring a topic
  // only ever increases a team's active count, so no last-active-topic-shaped
  // guard exists in this direction (design.md Decision 2).
  //
  // Every early-return in this cascade, plus the 200 success outcome,
  // applies applyTimingFloor(startTime) -- no branch is exempt.
  // -------------------------------------------------------------------------
  app.post<{
    Params: { teamId: string; topicId: string };
  }>("/api/v1/teams/:teamId/topics/:topicId/restore", async (request, reply) => {
    const startTime = Date.now();
    const session = request.session as unknown as SessionData;
    const { teamId, topicId } = request.params;
    const endpoint = "POST /api/v1/teams/:teamId/topics/:topicId/restore";

    // Step 1 -- 403, checked first.
    const authResult = await checkRestoreTopicAuthorization(reply, session.userId, teamId, startTime);
    if (authResult.rejected) {
      return reply;
    }

    // Step 2 -- 404, checked second. Reused unchanged from TOPIC-003/004.
    const existsResult = await checkTeamExists(reply, teamId, startTime);
    if (existsResult.rejected) {
      return reply;
    }

    // Step 3 -- 409, checked third. Reused unchanged from TOPIC-003/004,
    // including its writeLockDenialAudit call (the shared
    // topic.write_denied_locked operation, no new per-endpoint variant).
    const lockResult = await checkCustomizationLockGate(
      request,
      reply,
      {
        actorUserId: session.userId,
        actorGlobalRole: authResult.actorGlobalRole,
        teamId,
        endpoint,
        attemptedOperation: "topic.restored",
      },
      startTime,
    );
    if (lockResult.rejected) {
      return reply;
    }

    // Steps 4/5 -- topic existence (404) then topic status (422).
    const topicCheck = await checkTopicExistsAndArchived(reply, teamId, topicId, startTime);
    if (topicCheck.rejected) {
      return reply;
    }

    // Step 6 -- append-position reposition, status flip, and provenance,
    // all inside one transaction guarded by the same per-team advisory lock
    // TOPIC-003/004 already use (design.md Decision 3's SQL block).
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [teamId]);

      const maxResult = await client.query<{ new_position: number }>(
        `SELECT COALESCE(MAX(display_order), 0) + 1 AS new_position
         FROM topics
         WHERE team_id = $1 AND status = 'active'`,
        [teamId],
      );
      const newPosition = (maxResult.rows[0] as { new_position: number }).new_position;

      const restoreResult = await client.query<{ name: string; restored_at: Date }>(
        `UPDATE topics
            SET status = 'active',
                display_order = $1,
                restored_at = now(),
                restored_by = $2
          WHERE id = $3 AND team_id = $4 AND status = 'archived'
          RETURNING name, restored_at`,
        [newPosition, session.userId, topicId, teamId],
      );

      if (restoreResult.rows.length === 0) {
        // Topic was restored (or re-archived) by a concurrent request
        // between the topic-status pre-check and this UPDATE -- both
        // serialized per-team by the advisory lock, but the pre-check
        // itself runs before the lock is taken. Same race shape as the
        // DELETE handler's TOPIC_ALREADY_ARCHIVED branch above, mirrored
        // for restore (design.md Decision 3).
        await client.query("ROLLBACK");
        await applyTimingFloor(startTime);
        return reply
          .code(422)
          .send(
            buildErrorEnvelope("invalid_request", "This topic is already active.", "TOPIC_ALREADY_ACTIVE"),
          );
      }

      const restoredRow = restoreResult.rows[0] as { name: string; restored_at: Date };

      // Task 4.1 — success audit row, same transaction as the UPDATE.
      await client.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          session.userId,
          authResult.actorGlobalRole,
          request.ip,
          "topic.restored",
          teamId,
          JSON.stringify({ topic_id: topicId }),
        ],
      );

      await client.query("COMMIT");

      // Task 4.2 — structured-log counterpart, matching topic.archived's
      // pairing.
      emitAuditEvent(request.log, "topic.restored", {
        actorUserId: session.userId,
        actorGlobalRole: authResult.actorGlobalRole,
        actorIp: request.ip,
        teamId,
        topicId,
      });

      await applyTimingFloor(startTime);
      const successResponse: RestoreTopicResponse = {
        topicId,
        name: restoredRow.name,
        status: "active",
        displayOrder: newPosition,
        restoredAt: restoredRow.restored_at.toISOString(),
      };
      return reply.code(200).send(successResponse);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  // -------------------------------------------------------------------------
  // PUT /api/v1/teams/:teamId/topics/order  (TOPIC-006, Reorder Topics)
  //
  // Check-ordering cascade (reorder-topics design.md Decision 2,
  // specs/reorder-topics/spec.md "Reorder Topics evaluates checks in a fixed
  // order"):
  //   1. Identity/role authorization -- 403 NOT_A_FACILITATOR /
  //      FACILITATOR_IS_TEAM_MEMBER, admits application_admin.
  //   2. Team existence (reused unchanged) -- 404 TEAM_NOT_FOUND.
  //   3. Customization lock (reused unchanged) -- 409
  //      TOPIC_CUSTOMIZATION_LOCKED, audited via writeLockDenialAudit.
  //      Before body validation, so a locked team gets 409 whatever the body.
  //   4. Body structure -- 422 INVALID_TOPIC_ORDER.
  //   5. Set equality against the team's active set, inside the per-team
  //      advisory lock -- 409 TOPIC_ORDER_STALE.
  //   6. No-op -- 200, no write, no audit.
  //   7. Two-phase renumber + topic.reordered audit row, same transaction --
  //      200.
  //
  // Every handled exit applies applyTimingFloor(startTime). The thrown path
  // (catch -> ROLLBACK -> rethrow to the global error handler) is exempt, an
  // inherited gap shared with TOPIC-003/004/005 (design.md Decision 2).
  // -------------------------------------------------------------------------
  app.put<{
    Params: { teamId: string };
    Body: unknown;
  }>("/api/v1/teams/:teamId/topics/order", async (request, reply) => {
    // Set once, first, so every exit carries it -- including the 500 the
    // global error handler writes on this same reply (security review F6).
    reply.header("Cache-Control", "no-store");

    const startTime = Date.now();
    const session = request.session as unknown as SessionData;
    const { teamId } = request.params;
    const endpoint = "PUT /api/v1/teams/:teamId/topics/order";

    // Step 1 -- 403, checked first.
    const authResult = await checkReorderTopicsAuthorization(reply, session.userId, teamId, startTime);
    if (authResult.rejected) {
      return reply;
    }

    // Step 2 -- 404, checked second.
    const existsResult = await checkTeamExists(reply, teamId, startTime);
    if (existsResult.rejected) {
      return reply;
    }

    // Step 3 -- 409, checked third.
    const lockResult = await checkCustomizationLockGate(
      request,
      reply,
      {
        actorUserId: session.userId,
        actorGlobalRole: authResult.actorGlobalRole,
        teamId,
        endpoint,
        attemptedOperation: "topic.reordered",
      },
      startTime,
    );
    if (lockResult.rejected) {
      return reply;
    }

    // Step 4 -- 422. From here on only the lowercased list is used.
    const validation = validateReorderTopicsBody(request.body ?? {});
    if (!validation.valid) {
      await applyTimingFloor(startTime);
      return reply
        .code(422)
        .send(buildErrorEnvelope("invalid_request", validation.message, "INVALID_TOPIC_ORDER", "orderedTopicIds"));
    }
    const newOrder = validation.orderedTopicIds;

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [teamId]);

      // Step 5 -- set equality, computed in memory against this team-scoped
      // read. Submitted IDs are never looked up individually (security
      // review F3), so the 409 cannot act as an existence oracle.
      const currentResult = await client.query<{ id: string; name: string; display_order: number }>(
        `SELECT id, name, display_order FROM topics
          WHERE team_id = $1 AND status = 'active'
          ORDER BY display_order, id`,
        [teamId],
      );
      const currentRows = currentResult.rows;
      const previousOrder = currentRows.map((row) => row.id);
      const currentIds = new Set(previousOrder);

      if (newOrder.length !== currentIds.size || !newOrder.every((id) => currentIds.has(id))) {
        await client.query("ROLLBACK");
        await applyTimingFloor(startTime);
        return reply
          .code(409)
          .send(buildErrorEnvelope("precondition_failed", TOPIC_ORDER_STALE_MESSAGE, "TOPIC_ORDER_STALE"));
      }

      // Step 6 -- no-op: nothing is written and nothing is audited. topics
      // carries the stored displayOrder values, since none were rewritten.
      if (newOrder.every((id, index) => id === previousOrder[index])) {
        const openSessionCreatedAt = await readOpenSessionCreatedAt(client, teamId, authResult.actorGlobalRole);
        await client.query("COMMIT");

        await applyTimingFloor(startTime);
        const noOpResponse: ReorderTopicsResponse = {
          topics: currentRows.map((row) => ({ topicId: row.id, name: row.name, displayOrder: row.display_order })),
          openSessionCreatedAt,
        };
        return reply.code(200).send(noOpResponse);
      }

      // Step 7 -- two-phase renumber (design.md Decision 3). The active-only
      // unique index is non-deferrable, so a one-statement swap can collide
      // partway. Phase 1 moves every active row to its negated target, which
      // collides with nothing; phase 2 flips them to the final 1..N.
      const expected = newOrder.length;
      const phase1 = await client.query(
        `UPDATE topics t
            SET display_order = -v.pos, updated_at = now()
           FROM unnest($2::uuid[]) WITH ORDINALITY AS v(id, pos)
          WHERE t.id = v.id AND t.team_id = $1 AND t.status = 'active'`,
        [teamId, newOrder],
      );
      if (phase1.rowCount !== expected) {
        throw new ReorderRowCountMismatchError(1, expected, phase1.rowCount);
      }

      // Assumes every active display_order was >= 0 before this request, so
      // the only negative active values are the ones phase 1 just wrote.
      const phase2 = await client.query(
        `UPDATE topics SET display_order = -display_order
          WHERE team_id = $1 AND status = 'active' AND display_order < 0`,
        [teamId],
      );
      if (phase2.rowCount !== expected) {
        throw new ReorderRowCountMismatchError(2, expected, phase2.rowCount);
      }

      // Success audit row, same transaction as the renumber (design.md
      // Decision 6). IDs only, lowercase, no names.
      await client.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          session.userId,
          authResult.actorGlobalRole,
          request.ip,
          "topic.reordered",
          teamId,
          JSON.stringify({ previous_order: previousOrder, new_order: newOrder }),
        ],
      );

      const openSessionCreatedAt = await readOpenSessionCreatedAt(client, teamId, authResult.actorGlobalRole);

      await client.query("COMMIT");

      // Structured-log counterpart, after COMMIT. Counts only; the ID arrays
      // live in the durable audit_log row (security review F6).
      emitAuditEvent(request.log, "topic.reordered", {
        actorUserId: session.userId,
        actorGlobalRole: authResult.actorGlobalRole,
        actorIp: request.ip,
        teamId,
        topicCount: expected,
      });

      const namesById = new Map(currentRows.map((row) => [row.id, row.name]));
      const topics: ReorderedTopic[] = newOrder.map((id, index) => ({
        topicId: id,
        name: namesById.get(id) as string,
        displayOrder: index + 1,
      }));

      await applyTimingFloor(startTime);
      const successResponse: ReorderTopicsResponse = { topics, openSessionCreatedAt };
      return reply.code(200).send(successResponse);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });
}
