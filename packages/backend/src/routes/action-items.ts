import type { FastifyInstance, FastifyReply } from "fastify";
import { db } from "../db.js";
import { evaluateTeamAccess } from "../auth/team-content-access-helper.js";
import { applyTimingFloor } from "../content/timing-oracle.js";
import { emitAuditEvent } from "../auth/audit-logger.js";
import { publishActionItemStatusUpdated } from "../realtime/ws-pubsub.js";
import type { SessionData } from "../auth/session-store.js";
import type { ActionItemStatus, SessionStatus } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// action-items.ts — actionitem-updated-live-broadcast (GitHub issues
// #64 + #65 + #95, combined). See design.md for the full decision record
// (D1-D14) this route implements; inline comments below cite the specific
// decision/task each block follows.
//
// PATCH /api/v1/action-items/:actionItemId/status — the first write path for
// action_items.status in this codebase.
// ---------------------------------------------------------------------------

/** "Actively facilitating" for both facilitator write-authorization (D10) and
 * sessionId active-state validation (D11) — deliberately narrower than
 * evaluateTeamAccess's Path 3, which also grants during a session's
 * draft/complete grace windows (per Tomás Ferreira's F1 finding). */
const ACTIVELY_FACILITATING_STATUSES = ["lobby", "pre_session", "active", "wrap_up"];

const VALID_TRANSITIONS: Record<ActionItemStatus, ActionItemStatus[]> = {
  open: ["in_progress", "resolved"],
  in_progress: ["resolved"],
  resolved: [],
};

function notFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: {
      category: "not_found" as const,
      message: "Action item not found.",
      correlationId: crypto.randomUUID(),
    },
  });
}

function forbidden(reply: FastifyReply, message: string) {
  return reply.code(403).send({
    error: {
      category: "forbidden" as const,
      message,
      correlationId: crypto.randomUUID(),
    },
  });
}

export async function actionItemRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // PATCH /api/v1/action-items/:actionItemId/status  (VOTE-002)
  // -------------------------------------------------------------------------
  app.patch<{
    Params: { actionItemId: string };
    Body: { status: ActionItemStatus; resolutionNote?: string; sessionId?: string };
  }>("/api/v1/action-items/:actionItemId/status", async (request, reply) => {
    const startTime = Date.now();
    const userSession = request.session as unknown as SessionData;
    const userId = userSession.userId;
    const { actionItemId } = request.params;
    const { status: requestedStatus, resolutionNote, sessionId } = request.body;

    // -----------------------------------------------------------------------
    // 3.1a (Decision D12) — load by ID alone, before any authorization check.
    // The URL carries no teamId to gate on, unlike content.ts's team-scoped
    // routes, so the item must be loaded to learn its team before
    // authorization can be evaluated at all.
    // -----------------------------------------------------------------------
    const itemResult = await db.query<{
      id: string;
      team_id: string;
      owner_id: string;
      status: ActionItemStatus;
    }>(`SELECT id, team_id, owner_id, status FROM action_items WHERE id = $1`, [actionItemId]);

    if (itemResult.rows.length === 0) {
      await applyTimingFloor(startTime);
      return notFound(reply);
    }

    const item = itemResult.rows[0] as {
      id: string;
      team_id: string;
      owner_id: string;
      status: ActionItemStatus;
    };

    // -----------------------------------------------------------------------
    // 3.1b (Decision D12, corrected per Ingrid Sollenberger's task-review
    // Finding 1) — the caller's RELATIONSHIP to the item's team, a
    // disclosure-safety boundary deliberately broader than 3.3/D10's
    // write-authorization gate below. Self-contained: does NOT reuse 3.3's
    // narrow ACTIVELY_FACILITATING_STATUSES query as its facilitator signal.
    // -----------------------------------------------------------------------
    const isOwner = item.owner_id === userId;
    let hasRelationship = isOwner;
    if (!hasRelationship) {
      const teamAccessGrant = await evaluateTeamAccess(userId, item.team_id);
      hasRelationship = teamAccessGrant !== null;
    }
    if (!hasRelationship) {
      const everFacilitatedResult = await db.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM sessions WHERE facilitator_id = $1 AND team_id = $2) AS exists`,
        [userId, item.team_id],
      );
      hasRelationship = Boolean((everFacilitatedResult.rows[0] as { exists: boolean } | undefined)?.exists);
    }
    if (!hasRelationship) {
      // Indistinguishable from 3.1a's 404 — closes the enumeration oracle
      // content.ts:521-526 already closed once for the session case.
      await applyTimingFloor(startTime);
      return notFound(reply);
    }

    // -----------------------------------------------------------------------
    // 3.1c (repositioned from 3.6a per Ingrid Sollenberger's Finding 4;
    // Decision D11) — validate an optional sessionId independently of
    // owner/facilitator authorization (3.2/3.3 below). Captures the
    // session's status for reuse at publish time (4.1) rather than
    // re-querying it after the transaction commits.
    // -----------------------------------------------------------------------
    let validatedSessionId: string | null = null;
    let validatedSessionStatus: SessionStatus | null = null;
    if (sessionId !== undefined) {
      const sessionResult = await db.query<{ status: SessionStatus }>(
        `SELECT status FROM sessions WHERE id = $1 AND team_id = $2`,
        [sessionId, item.team_id],
      );
      const sessionRow = sessionResult.rows[0] as { status: SessionStatus } | undefined;
      if (sessionRow === undefined || !ACTIVELY_FACILITATING_STATUSES.includes(sessionRow.status)) {
        await applyTimingFloor(startTime);
        return reply.code(422).send({
          error: {
            category: "invalid_request" as const,
            message: "sessionId does not reference a session in an active state for this team.",
            correlationId: crypto.randomUUID(),
          },
        });
      }
      validatedSessionId = sessionId;
      validatedSessionStatus = sessionRow.status;
    }

    // -----------------------------------------------------------------------
    // 3.2 / 3.3 (Decision D10) — owner or narrowly-scoped facilitator only.
    // -----------------------------------------------------------------------
    let authorizationPath: "owner" | "facilitator";
    if (isOwner) {
      authorizationPath = "owner";
    } else {
      const facilitatorResult = await db.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM sessions
           WHERE facilitator_id = $1 AND team_id = $2 AND status = ANY($3::text[])
         ) AS exists`,
        [userId, item.team_id, ACTIVELY_FACILITATING_STATUSES],
      );
      const isAuthorizedFacilitator = Boolean(
        (facilitatorResult.rows[0] as { exists: boolean } | undefined)?.exists,
      );
      if (!isAuthorizedFacilitator) {
        await applyTimingFloor(startTime);
        return forbidden(
          reply,
          "You do not have permission to update this action item's status. Only the item's owner, " +
            "or a facilitator actively facilitating a session for this team, may update it.",
        );
      }
      authorizationPath = "facilitator";
    }

    // -----------------------------------------------------------------------
    // 3.4 — transition-validity checks (FR-7.3). Resolved is terminal: not
    // merely protected against backward movement, not a valid PATCH target
    // at all (Open Question 3 — 409, unhedged).
    // -----------------------------------------------------------------------
    const currentStatus = item.status;
    if (currentStatus === "resolved") {
      return reply.code(409).send({
        error: {
          category: "precondition_failed" as const,
          message: "This action item is already resolved. Resolved is a terminal state.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const isSameStatusNoOp = requestedStatus === currentStatus;
    const isValidForwardTransition = VALID_TRANSITIONS[currentStatus].includes(requestedStatus);

    if (!isSameStatusNoOp && !isValidForwardTransition) {
      return reply.code(409).send({
        error: {
          category: "precondition_failed" as const,
          message: `Invalid transition: ${currentStatus} -> ${requestedStatus}.`,
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // -----------------------------------------------------------------------
    // 3.5 — same-status no-op: bump updated_at only, skip history/audit/
    // broadcast entirely (D6). A single-row update; no multi-table
    // transaction required (3.4a's note).
    // -----------------------------------------------------------------------
    if (isSameStatusNoOp) {
      const noOpResult = await db.query<{
        status: ActionItemStatus;
        resolution_note: string | null;
        resolved_in_session_id: string | null;
        updated_at: Date;
      }>(
        `UPDATE action_items SET updated_at = NOW() WHERE id = $1
         RETURNING status, resolution_note, resolved_in_session_id, updated_at`,
        [item.id],
      );
      const noOpRow = noOpResult.rows[0] as {
        status: ActionItemStatus;
        resolution_note: string | null;
        resolved_in_session_id: string | null;
        updated_at: Date;
      };
      return reply.code(200).send({
        actionItemId: item.id,
        status: noOpRow.status,
        resolutionNote: noOpRow.resolution_note,
        resolvedInSessionId: noOpRow.resolved_in_session_id,
        updatedAt: noOpRow.updated_at.toISOString(),
      });
    }

    // -----------------------------------------------------------------------
    // 3.6 — resolutionNote handling (Decision D9, issue #65). Only meaningful
    // when the transition targets Resolved; validated here, before any write,
    // so an over-length note is rejected 422 with nothing written (6.3).
    // -----------------------------------------------------------------------
    const isResolving = requestedStatus === "resolved";
    if (isResolving && resolutionNote !== undefined && resolutionNote.length > 500) {
      return reply.code(422).send({
        error: {
          category: "invalid_request" as const,
          message: "resolutionNote must be 500 characters or fewer.",
          correlationId: crypto.randomUUID(),
        },
      });
    }
    const noteToPersist = isResolving && resolutionNote !== undefined ? resolutionNote : null;
    const resolvedInSessionIdToPersist = isResolving && validatedSessionId !== null ? validatedSessionId : null;

    const actorResult = await db.query<{ global_role: string }>(
      `SELECT global_role FROM users WHERE id = $1`,
      [userId],
    );
    const actorGlobalRole = (actorResult.rows[0] as { global_role: string } | undefined)?.global_role ?? "unknown";

    // -----------------------------------------------------------------------
    // 3.4a — open the transaction and execute the action_items.status UPDATE
    // (combined with 3.6's resolution_note/resolved_in_session_id writes in
    // the same statement, since both target the same row in the same
    // transaction). 3.7 (history) and 3.9 (audit_log) write inside it; all
    // three commit or roll back together.
    // -----------------------------------------------------------------------
    const client = await db.connect();
    let updatedAt: Date;
    try {
      await client.query("BEGIN");

      const updateResult = await client.query<{ updated_at: Date }>(
        `UPDATE action_items
         SET status = $1, resolution_note = $2, resolved_in_session_id = $3, updated_at = NOW()
         WHERE id = $4
         RETURNING updated_at`,
        [requestedStatus, noteToPersist, resolvedInSessionIdToPersist, item.id],
      );
      updatedAt = (updateResult.rows[0] as { updated_at: Date }).updated_at;

      // 3.7 — action_item_history row, same transaction.
      await client.query(
        `INSERT INTO action_item_history
           (action_item_id, changed_by_user_id, previous_status, new_status, resolution_note, session_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [item.id, userId, currentStatus, requestedStatus, noteToPersist, validatedSessionId],
      );

      // 3.9 (Decision D13) — audit_log row, same transaction, matching
      // recordRevealTriggeredAudit's shape.
      await client.query(
        `INSERT INTO audit_log
           (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userId,
          actorGlobalRole,
          request.ip,
          "action_item.status_changed",
          item.team_id,
          JSON.stringify({
            action_item_id: item.id,
            previous_status: currentStatus,
            new_status: requestedStatus,
            authorization_path: authorizationPath,
            session_id: validatedSessionId,
          }),
        ],
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    emitAuditEvent(request.log, "action_item.status_changed", {
      actorUserId: userId,
      actorGlobalRole,
      actorIp: request.ip,
      actionItemId: item.id,
      teamId: item.team_id,
      previousStatus: currentStatus,
      newStatus: requestedStatus,
      authorizationPath: authorizationPath,
    });

    // -----------------------------------------------------------------------
    // 4.2 (Decision D7) — publish-after-commit, only when a session context
    // resolved. Mutation success is never gated on this: the transaction
    // above has already committed, so a missing session context or a
    // publish failure here must only ever cost the broadcast, never the
    // PATCH's own 200 response — this is why the publish call is guarded
    // rather than awaited bare (6.2b pins this down directly).
    // -----------------------------------------------------------------------
    if (validatedSessionId !== null && validatedSessionStatus !== null) {
      try {
        await publishActionItemStatusUpdated(
          validatedSessionId,
          {
            sessionId: validatedSessionId,
            actionItemId: item.id,
            previousStatus: currentStatus,
            newStatus: requestedStatus,
            updatedAt: updatedAt.toISOString(),
          },
          validatedSessionStatus,
        );
      } catch (err) {
        request.log.warn(
          { err, actionItemId: item.id, sessionId: validatedSessionId },
          "action_item_status_updated broadcast publish failed — mutation already committed, response unaffected (Decision D7)",
        );
      }
    }

    return reply.code(200).send({
      actionItemId: item.id,
      status: requestedStatus,
      resolutionNote: noteToPersist,
      resolvedInSessionId: resolvedInSessionIdToPersist,
      updatedAt: updatedAt.toISOString(),
    });
  });
}
