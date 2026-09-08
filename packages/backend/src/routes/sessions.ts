import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import type { SessionData } from "../auth/session-store.js";
import { emitAuditEvent } from "../auth/audit-logger.js";
import { publishVoteReadinessUpdate } from "../realtime/ws-pubsub.js";

// ---------------------------------------------------------------------------
// Session participation routes
//
// POST /api/v1/sessions/:sessionId/participants
//   Records a user as an active participant in a session. Enforces the
//   no-EM-participation rule by checking BOTH:
//     - users.global_role (existing check)
//     - team_memberships.role for the relevant team (new check per this change)
//
//   Per Decision 4 in design.md: reads from the database at each request.
//   Does NOT use session-cached role values.
//
// POST /api/v1/sessions/:sessionId/topics/:sessionTopicId/lock-in
//   Records a vote from a participant. Performs a per-operation DB read of
//   team_memberships.role at each lock-in attempt (Task 3.7 / Decision 4).
//
//   A long-lived connection opened before a role change MUST NOT permit
//   lock-in operations the role change prohibits. Every operation independently
//   verifies the current role from the database.
// ---------------------------------------------------------------------------

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // POST /api/v1/sessions/:sessionId/participants
  //
  // Records the authenticated user as a session participant.
  // Rejects any user who is an Engineering Manager by either:
  //   - users.global_role = 'engineering_manager'
  //   - team_memberships.role = 'engineering_manager' for this session's team
  //
  // (Task 3.1, 3.2 — reads from DB, not cache)
  // -------------------------------------------------------------------------
  app.post<{
    Params: { sessionId: string };
  }>("/api/v1/sessions/:sessionId/participants", async (request, reply) => {
    const session = request.session as unknown as SessionData;
    const { sessionId } = request.params;

    // Fetch the session and its owning team
    const sessionResult = await db.query<{
      id: string;
      team_id: string;
      status: string;
    }>(
      `SELECT id, team_id, status FROM sessions WHERE id = $1`,
      [sessionId],
    );

    if (sessionResult.rows.length === 0) {
      return reply.code(404).send({
        error: {
          category: "invalid_request" as const,
          message: "Session not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const { team_id: teamId, status } = sessionResult.rows[0] as {
      id: string;
      team_id: string;
      status: string;
    };

    if (status !== "active") {
      return reply.code(422).send({
        error: {
          category: "invalid_request" as const,
          message: "Session is not active.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // EM non-participation check (Tasks 3.1, 3.2):
    // Query BOTH users.global_role AND team_memberships.role from the DB.
    // NOT from session state, in-memory cache, or middleware-level state.
    // This is the per-request DB read required by Decision 4.
    const roleCheckResult = await db.query<{
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
      [session.userId, teamId],
    );

    if (roleCheckResult.rows.length === 0) {
      return reply.code(401).send({
        error: {
          category: "session_expired" as const,
          message: "User not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const { global_role, membership_role } = roleCheckResult.rows[0] as {
      global_role: string;
      membership_role: string | null;
    };

    // Reject if EITHER global_role OR membership_role indicates EM
    if (
      global_role === "engineering_manager" ||
      membership_role === "engineering_manager"
    ) {
      return reply.code(403).send({
        error: {
          category: "invalid_request" as const,
          message:
            "Engineering Managers cannot participate as voters in sessions.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Insert participant record (idempotent)
    const insertResult = await db.query<{ id: string }>(
      `INSERT INTO session_participants (session_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (session_id, user_id) DO NOTHING
       RETURNING id`,
      [sessionId, session.userId],
    );

    const alreadyParticipant = insertResult.rows.length === 0;

    return reply
      .code(alreadyParticipant ? 200 : 201)
      .send({ sessionId, alreadyParticipant });
  });

  // -------------------------------------------------------------------------
  // POST /api/v1/sessions/:sessionId/topics/:sessionTopicId/lock-in
  //
  // Records a vote for the authenticated user on the given session topic.
  //
  // Task 3.7 / Decision 4 — per-operation DB read requirement:
  //   The handler reads team_memberships.role DIRECTLY FROM THE DATABASE at
  //   the time of each lock-in attempt. It DOES NOT use a role value
  //   established at connection time. A user promoted to EM after a connection
  //   was opened cannot lock in votes after the promotion.
  //
  //   Votes already locked in BEFORE a role change are NOT invalidated (the
  //   vote row is not deleted when the role changes). They are counted at
  //   reveal. See Decision 4 and Task 3.5.
  // -------------------------------------------------------------------------
  app.post<{
    Params: { sessionId: string; sessionTopicId: string };
    Body: { voteValue: number; voteType: string };
  }>(
    "/api/v1/sessions/:sessionId/topics/:sessionTopicId/lock-in",
    async (request, reply) => {
      const session = request.session as unknown as SessionData;
      const { sessionId, sessionTopicId } = request.params;
      const { voteValue, voteType } = request.body;

      // Fetch session and topic together
      const sessionTopicResult = await db.query<{
        session_status: string;
        team_id: string;
        topic_status: string;
      }>(
        `SELECT s.status AS session_status,
                s.team_id,
                st.status AS topic_status
         FROM sessions s
         JOIN session_topics st ON st.session_id = s.id AND st.id = $2
         WHERE s.id = $1`,
        [sessionId, sessionTopicId],
      );

      if (sessionTopicResult.rows.length === 0) {
        return reply.code(404).send({
          error: {
            category: "invalid_request" as const,
            message: "Session or topic not found.",
            correlationId: crypto.randomUUID(),
          },
        });
      }

      const { session_status, team_id: teamId, topic_status } =
        sessionTopicResult.rows[0] as {
          session_status: string;
          team_id: string;
          topic_status: string;
        };

      if (session_status !== "active") {
        return reply.code(422).send({
          error: {
            category: "invalid_request" as const,
            message: "Session is not active.",
            correlationId: crypto.randomUUID(),
          },
        });
      }

      if (topic_status !== "voting") {
        return reply.code(422).send({
          error: {
            category: "invalid_request" as const,
            message: "Voting is not open for this topic.",
            correlationId: crypto.randomUUID(),
          },
        });
      }

      // Per-operation role check (Task 3.7 / Decision 4):
      // Read membership_role FROM THE DATABASE at this exact moment.
      // NOT from the session, a WebSocket connection-time cache, or any
      // in-memory store. A role change that happened AFTER the connection
      // was established must be picked up here.
      //
      // Redis prohibition (Decision 4): membership_role data MUST NOT be
      // cached in Redis. No Redis read or write for membership_role is
      // permitted in this handler.
      const roleCheckResult = await db.query<{
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
        [session.userId, teamId],
      );

      if (roleCheckResult.rows.length === 0) {
        return reply.code(401).send({
          error: {
            category: "session_expired" as const,
            message: "User not found.",
            correlationId: crypto.randomUUID(),
          },
        });
      }

      const { global_role, membership_role } = roleCheckResult.rows[0] as {
        global_role: string;
        membership_role: string | null;
      };

      // Reject if EITHER global_role OR membership_role is 'engineering_manager'.
      // A user promoted to EM after the connection was opened is caught here.
      // A vote they submitted BEFORE the promotion is already in the votes table
      // and is NOT removed by this check — it will be counted at reveal.
      if (
        global_role === "engineering_manager" ||
        membership_role === "engineering_manager"
      ) {
        return reply.code(403).send({
          error: {
            category: "invalid_request" as const,
            message:
              "Engineering Managers cannot lock in votes.",
            correlationId: crypto.randomUUID(),
          },
        });
      }

      // Verify the user is a registered participant in this session
      const participantResult = await db.query<{ id: string }>(
        `SELECT id FROM session_participants
         WHERE session_id = $1 AND user_id = $2`,
        [sessionId, session.userId],
      );

      if (participantResult.rows.length === 0) {
        return reply.code(403).send({
          error: {
            category: "invalid_request" as const,
            message: "You are not a registered participant in this session.",
            correlationId: crypto.randomUUID(),
          },
        });
      }

      // Insert the vote (upsert — re-submitting replaces the previous value)
      // and the SEC-13/SEC-14 audit_log row, in the SAME transaction
      // (websocket-delivery-time-authorization design.md Decision D7,
      // transaction-pattern correction). This handler previously executed a
      // single bare db.query() against the shared pool; adding the audit
      // write requires the same explicit BEGIN/COMMIT pattern teams.ts
      // already uses, so the vote and its audit record commit — or roll
      // back — atomically. Not blocked on GitHub issue #26: this INSERT
      // already commits today.
      const client = await db.connect();
      let voteId: string;
      try {
        await client.query("BEGIN");

        const voteResult = await client.query<{ id: string }>(
          `INSERT INTO votes
             (session_id, session_topic_id, voter_id, vote_value, vote_type, revealed_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (session_topic_id, voter_id)
             DO UPDATE SET vote_value = EXCLUDED.vote_value,
                           vote_type  = EXCLUDED.vote_type
           RETURNING id`,
          [sessionId, sessionTopicId, session.userId, voteValue, voteType],
        );
        voteId = (voteResult.rows[0] as { id: string }).id;

        // Audit metadata deliberately EXCLUDES vote_value and vote_type
        // (SEC-16/SEC-22) — this is the one triggering action in this
        // change where the excluded field and the field the handler is
        // actively processing are the same value, so the exclusion is
        // easiest to get wrong here (design.md Decision D7's extension).
        await client.query(
          `INSERT INTO audit_log
             (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            session.userId,
            global_role,
            request.ip,
            "session.vote_submitted",
            teamId,
            JSON.stringify({ session_id: sessionId, session_topic_id: sessionTopicId }),
          ],
        );

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      // Structured-log counterpart to the DB audit row.
      emitAuditEvent(request.log, "session.vote_submitted", {
        actorUserId: session.userId,
        actorGlobalRole: global_role,
        actorIp: request.ip,
        sessionId,
        sessionTopicId,
      });

      // Publish-after-commit ordering (design.md Decision D2/D7, tasks.md
      // task 1.4 and 7.6): this PUBLISH runs only after the transaction
      // above has successfully committed — never before, never inside it.
      // Publishing before a successful commit would risk notifying the
      // facilitator of a readiness update that a rolled-back transaction
      // never actually persisted.
      await publishVoteReadinessUpdate(sessionId, {
        sessionId,
        sessionTopicId,
        voterId: session.userId,
        readyAt: new Date().toISOString(),
      });

      return reply.code(201).send({ voteId });
    },
  );
}
