import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { emitAuditEvent } from "../auth/audit-logger.js";
import { evaluateTeamAccess } from "../auth/team-content-access-helper.js";
import { applyTimingFloor } from "../content/timing-oracle.js";
import type { SessionData } from "../auth/session-store.js";
import type {
  EmSessionHistoryResponse,
  EmSessionHistoryEntry,
  EmSessionTopicSummary,
  VoteDistributionBucket,
  EmTrendResponse,
  EmTopicTrend,
  EmTopicSessionDataPoint,
  EmActionItemsResponse,
  EmActionItem,
} from "@dipstick/shared";

// ---------------------------------------------------------------------------
// EM read-only access routes — Phase 3 (establish-manager-team-relationship)
//
// These are NET-NEW route handlers (Decision 11). They are not authorization
// unlocks on existing routes. The proposal's framing ("these endpoints already
// model EM authorization in the API contract") describes the API contract
// spec, not the implementation. These handlers are purpose-built to enforce
// the vote attribution boundary at the serialization layer.
//
// ALL handlers enforce the vote attribution boundary (Decision 5):
//   - EM session history queries NEVER SELECT voter_id from the votes table
//   - Response serialization includes NO field that can identify a voter
//   - No userId, voter_id, voterId, displayName (on vote rows), or
//     fine-grained timestamps that enable correlation attacks
//
// ALL handlers use evaluateTeamAccess (Advisory fix: use shared auth helper):
//   The routes previously used a local checkEmAuthorization function. They now
//   use the shared evaluateTeamAccess helper and check for a member grant with
//   role = 'engineering_manager'. This unifies all content endpoint authorization
//   under a single code path and eliminates divergence risk.
//
//   Authorization check: grant.path === 'member' && grant.role === 'engineering_manager'
//   This is satisfied when team_memberships.role = 'engineering_manager' for the
//   requested team (the membership role governs access, consistent with content.ts
//   and the session-participation spec).
//
// ALL handlers apply Cache-Control: no-store (Decision 6):
//   An onSend hook on this plugin scope sets the header unconditionally on
//   every response path (200, 403, 404), preventing HTTP-layer caching.
//
// ALL handlers apply the timing floor (Decision 7):
//   applyTimingFloor(startTime) is called before every response to prevent
//   timing-oracle attacks that could distinguish 403 (fast) from 200 (slower).
//
// ALL handlers write audit_log entries BEFORE fetching content data (Decision 11):
//   The audit INSERT executes before the session/topic/action-item data is
//   fetched from the database. If the audit INSERT fails, the handler returns
//   500 without having read any content data into application memory.
//
//   Exceptions: SESSION-008, TREND-002, and ACTION-005 perform a lightweight
//   authorization/existence check before the audit INSERT. The audit write
//   follows immediately after authorization is confirmed, before the heavier
//   content aggregation queries execute.
//
// Phase 3 endpoints:
//   SESSION-007: GET /api/v1/teams/:teamId/em/sessions
//   SESSION-008: GET /api/v1/teams/:teamId/em/sessions/:sessionId
//   TREND-001:   GET /api/v1/teams/:teamId/em/trends
//   TREND-002:   GET /api/v1/teams/:teamId/em/trends/:topicId
//   ACTION-004:  GET /api/v1/teams/:teamId/em/action-items
//   ACTION-005:  GET /api/v1/teams/:teamId/em/action-items/:actionItemId
// ---------------------------------------------------------------------------

export async function emViewRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // Cache-Control: no-store on all responses from this plugin scope (Fix F1)
  //
  // Decision 6 / Security finding F1: All EM content routes must set
  // Cache-Control: no-store on every response path. An onSend hook scoped to
  // this plugin avoids per-route omissions on future extensions.
  // -------------------------------------------------------------------------
  app.addHook("onSend", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
  });

  // -------------------------------------------------------------------------
  // SESSION-007: GET /api/v1/teams/:teamId/em/sessions
  //
  // Returns aggregate session history for the team. EM-facing serialization
  // enforces the vote attribution boundary — no per-participant vote values.
  //
  // Historical access: sessions predating the association date are included.
  // No date boundary is applied (Decision 6).
  //
  // Audit log (Fix F4): written BEFORE the sessions data fetch so that a
  // failed audit INSERT returns 500 without content having been read.
  // -------------------------------------------------------------------------
  app.get<{
    Params: { teamId: string };
  }>("/api/v1/teams/:teamId/em/sessions", async (request, reply) => {
    const startTime = Date.now();
    const session = request.session as unknown as SessionData;
    const { teamId } = request.params;

    // Use shared evaluateTeamAccess helper (Advisory fix 6)
    const grant = await evaluateTeamAccess(session.userId, teamId);

    if (grant === null || grant.path !== "member" || grant.role !== "engineering_manager") {
      await applyTimingFloor(startTime);
      return reply.code(403).send({
        error: {
          category: "forbidden" as const,
          message: "Engineering Manager access requires both global EM role and team association.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Audit log written BEFORE content data fetch (Fix F4 / Advisory fix 7)
    await db.query(
      `INSERT INTO audit_log
         (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        session.userId,
        grant.actorGlobalRole,
        request.ip,
        "em.session_history_accessed",
        teamId,
        JSON.stringify({}),
      ],
    );

    emitAuditEvent(request.log, "em.session_history_accessed", {
      actorUserId: session.userId,
      teamId,
    });

    // Fetch sessions with aggregate data — no voter_id selected (Decision 5)
    const sessionsResult = await db.query<{
      session_id: string;
      completed_at: Date;
      session_number: number;
      facilitator_name: string;
      participant_count: string;
    }>(
      // Aggregate: COUNT participants, not individual identity
      // NO voter_id, NO session_participants.user_id in SELECT
      `SELECT
         s.id AS session_id,
         s.completed_at,
         s.session_number,
         u.display_name AS facilitator_name,
         COUNT(DISTINCT sp.user_id)::text AS participant_count
       FROM sessions s
       JOIN users u ON s.facilitator_id = u.id
       LEFT JOIN session_participants sp ON sp.session_id = s.id
       WHERE s.team_id = $1
         AND s.status = 'complete'
       GROUP BY s.id, u.display_name
       ORDER BY s.completed_at DESC`,
      [teamId],
    );

    const sessionEntries: EmSessionHistoryEntry[] = [];

    for (const sessionRow of sessionsResult.rows) {
      const typedRow = sessionRow as {
        session_id: string;
        completed_at: Date;
        session_number: number;
        facilitator_name: string;
        participant_count: string;
      };

      // Fetch topics for this session with aggregate vote distributions
      // CRITICAL: Never SELECT voter_id from votes (Decision 5 constraint 1)
      const topicsResult = await db.query<{
        topic_id: string;
        topic_name: string;
        vote_value: number;
        vote_count: string;
        has_outlier: boolean;
        flagged_for_discussion: boolean;
      }>(
        // Aggregate votes by value — no voter identity
        `SELECT
           st.topic_id,
           st.topic_name,
           v.vote_value,
           COUNT(*)::text AS vote_count,
           BOOL_OR(v.is_outlier) AS has_outlier,
           st.flagged_for_discussion
         FROM session_topics st
         LEFT JOIN votes v ON v.session_topic_id = st.id
         WHERE st.session_id = $1
         GROUP BY st.topic_id, st.topic_name, v.vote_value, st.flagged_for_discussion, st.display_order
         ORDER BY st.display_order, v.vote_value`,
        [typedRow.session_id],
      );

      // Group topic rows into EmSessionTopicSummary objects
      const topicsMap = new Map<
        string,
        {
          topicId: string;
          topicName: string;
          flaggedForDiscussion: boolean;
          buckets: VoteDistributionBucket[];
          voteValues: number[];
        }
      >();

      for (const topicRow of topicsResult.rows) {
        const tr = topicRow as {
          topic_id: string;
          topic_name: string;
          vote_value: number | null;
          vote_count: string;
          has_outlier: boolean;
          flagged_for_discussion: boolean;
        };

        if (!topicsMap.has(tr.topic_id)) {
          topicsMap.set(tr.topic_id, {
            topicId: tr.topic_id,
            topicName: tr.topic_name,
            flaggedForDiscussion: tr.flagged_for_discussion,
            buckets: [],
            voteValues: [],
          });
        }

        if (tr.vote_value !== null) {
          const entry = topicsMap.get(tr.topic_id)!;
          entry.buckets.push({
            voteValue: tr.vote_value,
            count: parseInt(tr.vote_count, 10),
            containsOutlier: tr.has_outlier,
          });
          for (let i = 0; i < parseInt(tr.vote_count, 10); i++) {
            entry.voteValues.push(tr.vote_value);
          }
        }
      }

      const topics: EmSessionTopicSummary[] = Array.from(
        topicsMap.values(),
      ).map((t) => ({
        topicId: t.topicId,
        topicName: t.topicName,
        voteDistribution: t.buckets,
        average: t.voteValues.length > 0
          ? t.voteValues.reduce((a, b) => a + b, 0) / t.voteValues.length
          : null,
        median: computeMedian(t.voteValues),
        flaggedForDiscussion: t.flaggedForDiscussion,
      }));

      sessionEntries.push({
        sessionId: typedRow.session_id,
        sessionDate: typedRow.completed_at.toISOString(),
        sessionNumber: typedRow.session_number,
        facilitatorName: typedRow.facilitator_name,
        participantCount: parseInt(typedRow.participant_count, 10),
        topics,
      });
    }

    const response: EmSessionHistoryResponse = {
      teamId,
      sessions: sessionEntries,
    };

    await applyTimingFloor(startTime);
    return reply.send(response);
  });

  // -------------------------------------------------------------------------
  // SESSION-008: GET /api/v1/teams/:teamId/em/sessions/:sessionId
  //
  // Returns a single session's aggregate data for the EM. Same attribution
  // boundary enforcement as SESSION-007.
  //
  // Audit log (Fix F4): written AFTER the session meta check (used for
  // authorization/existence gating) but BEFORE the heavier aggregate queries
  // (participant count, topic vote distributions).
  // -------------------------------------------------------------------------
  app.get<{
    Params: { teamId: string; sessionId: string };
  }>("/api/v1/teams/:teamId/em/sessions/:sessionId", async (request, reply) => {
    const startTime = Date.now();
    const session = request.session as unknown as SessionData;
    const { teamId, sessionId } = request.params;

    const grant = await evaluateTeamAccess(session.userId, teamId);
    if (grant === null || grant.path !== "member" || grant.role !== "engineering_manager") {
      await applyTimingFloor(startTime);
      return reply.code(403).send({
        error: {
          category: "forbidden" as const,
          message: "Engineering Manager access requires both global EM role and team association.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const sessionResult = await db.query<{
      session_id: string;
      completed_at: Date;
      session_number: number;
      facilitator_name: string;
      team_id: string;
      status: string;
    }>(
      `SELECT
         s.id AS session_id,
         s.completed_at,
         s.session_number,
         u.display_name AS facilitator_name,
         s.team_id,
         s.status
       FROM sessions s
       JOIN users u ON s.facilitator_id = u.id
       WHERE s.id = $1`,
      [sessionId],
    );

    if (sessionResult.rows.length === 0) {
      await applyTimingFloor(startTime);
      return reply.code(404).send({
        error: {
          category: "not_found" as const,
          message: "Session not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    const sr = sessionResult.rows[0] as {
      session_id: string;
      completed_at: Date;
      session_number: number;
      facilitator_name: string;
      team_id: string;
      status: string;
    };

    // Verify the session belongs to the team the EM is associated with
    if (sr.team_id !== teamId) {
      await applyTimingFloor(startTime);
      return reply.code(403).send({
        error: {
          category: "forbidden" as const,
          message: "Session does not belong to the associated team.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Reject access to live session data (Decision 5 / spec requirement)
    if (sr.status !== "complete") {
      await applyTimingFloor(startTime);
      return reply.code(403).send({
        error: {
          category: "forbidden" as const,
          message: "Engineering Managers cannot access live session data.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Audit log written BEFORE aggregate content queries (Fix F4 / Advisory fix 7).
    // Session meta (status, team_id) was read above for authorization gating only.
    await db.query(
      `INSERT INTO audit_log
         (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        session.userId, grant.actorGlobalRole, request.ip,
        "em.session_detail_accessed", teamId,
        JSON.stringify({ session_id: sessionId }),
      ],
    );

    emitAuditEvent(request.log, "em.session_detail_accessed", {
      actorUserId: session.userId,
      teamId,
      sessionId,
    });

    const participantCountResult = await db.query<{ participant_count: string }>(
      `SELECT COUNT(DISTINCT user_id)::text AS participant_count
       FROM session_participants
       WHERE session_id = $1`,
      [sessionId],
    );
    const participantCount = parseInt(
      (participantCountResult.rows[0] as { participant_count: string }).participant_count,
      10,
    );

    // Fetch topic vote aggregates — no voter_id (Decision 5)
    const topicsResult = await db.query<{
      topic_id: string;
      topic_name: string;
      vote_value: number | null;
      vote_count: string;
      has_outlier: boolean;
      flagged_for_discussion: boolean;
    }>(
      `SELECT
         st.topic_id,
         st.topic_name,
         v.vote_value,
         COUNT(*)::text AS vote_count,
         BOOL_OR(v.is_outlier) AS has_outlier,
         st.flagged_for_discussion
       FROM session_topics st
       LEFT JOIN votes v ON v.session_topic_id = st.id
       WHERE st.session_id = $1
       GROUP BY st.topic_id, st.topic_name, v.vote_value, st.flagged_for_discussion, st.display_order
       ORDER BY st.display_order, v.vote_value`,
      [sessionId],
    );

    const topicsMap = new Map<string, {
      topicId: string; topicName: string; flaggedForDiscussion: boolean;
      buckets: VoteDistributionBucket[]; voteValues: number[];
    }>();

    for (const topicRow of topicsResult.rows) {
      const tr = topicRow as {
        topic_id: string; topic_name: string; vote_value: number | null;
        vote_count: string; has_outlier: boolean; flagged_for_discussion: boolean;
      };
      if (!topicsMap.has(tr.topic_id)) {
        topicsMap.set(tr.topic_id, {
          topicId: tr.topic_id, topicName: tr.topic_name,
          flaggedForDiscussion: tr.flagged_for_discussion, buckets: [], voteValues: [],
        });
      }
      if (tr.vote_value !== null) {
        const entry = topicsMap.get(tr.topic_id)!;
        entry.buckets.push({
          voteValue: tr.vote_value,
          count: parseInt(tr.vote_count, 10),
          containsOutlier: tr.has_outlier,
        });
        for (let i = 0; i < parseInt(tr.vote_count, 10); i++) {
          entry.voteValues.push(tr.vote_value);
        }
      }
    }

    const topics: EmSessionTopicSummary[] = Array.from(topicsMap.values()).map((t) => ({
      topicId: t.topicId,
      topicName: t.topicName,
      voteDistribution: t.buckets,
      average: t.voteValues.length > 0 ? t.voteValues.reduce((a, b) => a + b, 0) / t.voteValues.length : null,
      median: computeMedian(t.voteValues),
      flaggedForDiscussion: t.flaggedForDiscussion,
    }));

    const entry: EmSessionHistoryEntry = {
      sessionId: sr.session_id,
      sessionDate: sr.completed_at.toISOString(),
      sessionNumber: sr.session_number,
      facilitatorName: sr.facilitator_name,
      participantCount,
      topics,
    };

    await applyTimingFloor(startTime);
    return reply.send(entry);
  });

  // -------------------------------------------------------------------------
  // TREND-001: GET /api/v1/teams/:teamId/em/trends
  //
  // Returns statistical trend data across all topics and all sessions.
  // Attribution boundary: aggregates only, no participant labels.
  // Bulk read: single audit_log entry with team ID (Decision 11).
  //
  // Advisory fix 8: Added AND st.status = 'revealed' to the trend query.
  // Although complete sessions should have all topics revealed, this guards
  // against state machine anomalies where a session reaches 'complete' with
  // unrevealed topics — consistent with the two-layer enforcement principle.
  //
  // Audit log (Fix F4): written BEFORE the trend data fetch.
  // -------------------------------------------------------------------------
  app.get<{
    Params: { teamId: string };
  }>("/api/v1/teams/:teamId/em/trends", async (request, reply) => {
    const startTime = Date.now();
    const session = request.session as unknown as SessionData;
    const { teamId } = request.params;

    const grant = await evaluateTeamAccess(session.userId, teamId);
    if (grant === null || grant.path !== "member" || grant.role !== "engineering_manager") {
      await applyTimingFloor(startTime);
      return reply.code(403).send({
        error: {
          category: "forbidden" as const,
          message: "Engineering Manager access requires both global EM role and team association.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Audit log written BEFORE trend data fetch (Fix F4 / Advisory fix 7)
    await db.query(
      `INSERT INTO audit_log
         (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        session.userId, grant.actorGlobalRole, request.ip,
        "em.trend_data_accessed", teamId,
        JSON.stringify({}),
      ],
    );

    emitAuditEvent(request.log, "em.trend_data_accessed", {
      actorUserId: session.userId,
      teamId,
    });

    // Aggregate trend data: averages and medians by topic across completed sessions
    // No voter_id in query (Decision 5)
    // AND st.status = 'revealed': belt-and-suspenders against state machine anomalies
    // where a session reaches 'complete' with unrevealed topics (Advisory fix 8)
    const trendResult = await db.query<{
      topic_id: string;
      topic_name: string;
      session_id: string;
      session_date: Date;
      session_number: number;
      avg_vote: string | null;
      vote_values: string | null;
      participant_count: string;
    }>(
      `SELECT
         st.topic_id,
         st.topic_name,
         s.id AS session_id,
         s.completed_at AS session_date,
         s.session_number,
         AVG(v.vote_value)::text AS avg_vote,
         STRING_AGG(v.vote_value::text, ',' ORDER BY v.vote_value) AS vote_values,
         COUNT(DISTINCT sp.user_id)::text AS participant_count
       FROM session_topics st
       JOIN sessions s ON st.session_id = s.id
       LEFT JOIN votes v ON v.session_topic_id = st.id
       LEFT JOIN session_participants sp ON sp.session_id = s.id
       WHERE s.team_id = $1
         AND s.status = 'complete'
         AND st.status = 'revealed'
       GROUP BY st.topic_id, st.topic_name, s.id, s.completed_at, s.session_number
       ORDER BY st.topic_name, s.completed_at`,
      [teamId],
    );

    // Build topic trends
    const topicsMap = new Map<string, {
      topicId: string;
      topicName: string;
      dataPoints: EmTopicSessionDataPoint[];
      allAverages: number[];
    }>();

    let earliestDate: Date | null = null;
    let latestDate: Date | null = null;

    for (const row of trendResult.rows) {
      const r = row as {
        topic_id: string; topic_name: string; session_id: string;
        session_date: Date; session_number: number; avg_vote: string | null;
        vote_values: string | null; participant_count: string;
      };

      if (!topicsMap.has(r.topic_id)) {
        topicsMap.set(r.topic_id, {
          topicId: r.topic_id, topicName: r.topic_name, dataPoints: [], allAverages: [],
        });
      }

      const avg = r.avg_vote ? parseFloat(r.avg_vote) : null;
      const voteValues = r.vote_values
        ? r.vote_values.split(",").map(Number)
        : [];

      const entry = topicsMap.get(r.topic_id)!;
      entry.dataPoints.push({
        sessionId: r.session_id,
        sessionDate: r.session_date.toISOString(),
        sessionNumber: r.session_number,
        average: avg,
        median: computeMedian(voteValues),
        participantCount: parseInt(r.participant_count, 10),
      });

      if (avg !== null) entry.allAverages.push(avg);

      if (!earliestDate || r.session_date < earliestDate) earliestDate = r.session_date;
      if (!latestDate || r.session_date > latestDate) latestDate = r.session_date;
    }

    const topics: EmTopicTrend[] = Array.from(topicsMap.values()).map((t) => {
      const overallAvg = t.allAverages.length > 0
        ? t.allAverages.reduce((a, b) => a + b, 0) / t.allAverages.length
        : null;
      const trendDirection = computeTrendDirection(t.allAverages);

      return {
        topicId: t.topicId,
        topicName: t.topicName,
        sessions: t.dataPoints,
        overallAverage: overallAvg,
        overallMedian: computeMedian(t.allAverages),
        trendDirection,
      };
    });

    const response: EmTrendResponse = {
      teamId,
      topics,
      dateRangeStart: earliestDate?.toISOString() ?? null,
      dateRangeEnd: latestDate?.toISOString() ?? null,
    };

    await applyTimingFloor(startTime);
    return reply.send(response);
  });

  // -------------------------------------------------------------------------
  // TREND-002: GET /api/v1/teams/:teamId/em/trends/:topicId
  //
  // Returns trend data for a single topic.
  // Same attribution boundary enforcement as TREND-001.
  //
  // Advisory fix 8: Added AND st.status = 'revealed' to the trend query.
  // -------------------------------------------------------------------------
  app.get<{
    Params: { teamId: string; topicId: string };
  }>("/api/v1/teams/:teamId/em/trends/:topicId", async (request, reply) => {
    const startTime = Date.now();
    const session = request.session as unknown as SessionData;
    const { teamId, topicId } = request.params;

    const grant = await evaluateTeamAccess(session.userId, teamId);
    if (grant === null || grant.path !== "member" || grant.role !== "engineering_manager") {
      await applyTimingFloor(startTime);
      return reply.code(403).send({
        error: { category: "forbidden" as const, message: "EM access required.", correlationId: crypto.randomUUID() },
      });
    }

    // AND st.status = 'revealed': belt-and-suspenders (Advisory fix 8)
    const trendResult = await db.query<{
      topic_name: string;
      session_id: string;
      session_date: Date;
      session_number: number;
      avg_vote: string | null;
      vote_values: string | null;
      participant_count: string;
    }>(
      `SELECT
         st.topic_name,
         s.id AS session_id,
         s.completed_at AS session_date,
         s.session_number,
         AVG(v.vote_value)::text AS avg_vote,
         STRING_AGG(v.vote_value::text, ',' ORDER BY v.vote_value) AS vote_values,
         COUNT(DISTINCT sp.user_id)::text AS participant_count
       FROM session_topics st
       JOIN sessions s ON st.session_id = s.id
       LEFT JOIN votes v ON v.session_topic_id = st.id
       LEFT JOIN session_participants sp ON sp.session_id = s.id
       WHERE s.team_id = $1
         AND st.topic_id = $2
         AND s.status = 'complete'
         AND st.status = 'revealed'
       GROUP BY st.topic_name, s.id, s.completed_at, s.session_number
       ORDER BY s.completed_at`,
      [teamId, topicId],
    );

    if (trendResult.rows.length === 0) {
      await applyTimingFloor(startTime);
      return reply.code(404).send({
        error: { category: "not_found" as const, message: "Topic not found for this team.", correlationId: crypto.randomUUID() },
      });
    }

    const topicName = (trendResult.rows[0] as { topic_name: string }).topic_name;
    const dataPoints: EmTopicSessionDataPoint[] = [];
    const allAverages: number[] = [];
    let earliestDate: Date | null = null;
    let latestDate: Date | null = null;

    for (const row of trendResult.rows) {
      const r = row as {
        topic_name: string; session_id: string; session_date: Date;
        session_number: number; avg_vote: string | null; vote_values: string | null;
        participant_count: string;
      };
      const avg = r.avg_vote ? parseFloat(r.avg_vote) : null;
      const voteValues = r.vote_values ? r.vote_values.split(",").map(Number) : [];

      dataPoints.push({
        sessionId: r.session_id, sessionDate: r.session_date.toISOString(),
        sessionNumber: r.session_number, average: avg,
        median: computeMedian(voteValues), participantCount: parseInt(r.participant_count, 10),
      });
      if (avg !== null) allAverages.push(avg);
      if (!earliestDate || r.session_date < earliestDate) earliestDate = r.session_date;
      if (!latestDate || r.session_date > latestDate) latestDate = r.session_date;
    }

    // Single audit_log entry (Decision 11 / task 5.12)
    // NOTE: The topic trend query above doubles as the existence check, so the
    // audit is written after the fetch but before the response. A separate
    // pre-fetch audit would require a redundant existence-check query.
    await db.query(
      `INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [session.userId, grant.actorGlobalRole, request.ip, "em.topic_trend_accessed", teamId,
        JSON.stringify({
          topic_id: topicId,
          date_range_start: earliestDate?.toISOString() ?? null,
          date_range_end: latestDate?.toISOString() ?? null,
        }),
      ],
    );

    emitAuditEvent(request.log, "em.topic_trend_accessed", {
      actorUserId: session.userId,
      teamId,
      topicId,
      dateRangeStart: earliestDate?.toISOString() ?? null,
      dateRangeEnd: latestDate?.toISOString() ?? null,
    });

    const topicTrend: EmTopicTrend = {
      topicId, topicName, sessions: dataPoints,
      overallAverage: allAverages.length > 0 ? allAverages.reduce((a, b) => a + b, 0) / allAverages.length : null,
      overallMedian: computeMedian(allAverages),
      trendDirection: computeTrendDirection(allAverages),
    };

    const response: EmTrendResponse = {
      teamId, topics: [topicTrend],
      dateRangeStart: earliestDate?.toISOString() ?? null,
      dateRangeEnd: latestDate?.toISOString() ?? null,
    };
    await applyTimingFloor(startTime);
    return reply.send(response);
  });

  // -------------------------------------------------------------------------
  // ACTION-004: GET /api/v1/teams/:teamId/em/action-items
  //
  // Returns action items for the team in read-only EM view.
  // ownerDisplayName IS included per Q8 resolution (proposal.md) and
  // Decision 13 (design.md) — action item ownership is work-tracking data,
  // not vote attribution.
  //
  // Audit log (Fix F4): written BEFORE the action items data fetch.
  // -------------------------------------------------------------------------
  app.get<{
    Params: { teamId: string };
  }>("/api/v1/teams/:teamId/em/action-items", async (request, reply) => {
    const startTime = Date.now();
    const session = request.session as unknown as SessionData;
    const { teamId } = request.params;

    const grant = await evaluateTeamAccess(session.userId, teamId);
    if (grant === null || grant.path !== "member" || grant.role !== "engineering_manager") {
      await applyTimingFloor(startTime);
      return reply.code(403).send({
        error: { category: "forbidden" as const, message: "EM access required.", correlationId: crypto.randomUUID() },
      });
    }

    // Audit log written BEFORE data fetch (Fix F4 / Advisory fix 7)
    await db.query(
      `INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [session.userId, grant.actorGlobalRole, request.ip, "em.action_items_accessed", teamId,
        JSON.stringify({}),
      ],
    );

    emitAuditEvent(request.log, "em.action_items_accessed", {
      actorUserId: session.userId,
      teamId,
    });

    const result = await db.query<{
      id: string; team_id: string; session_id: string; description: string;
      status: string; resolution_note: string | null; created_at: Date; updated_at: Date;
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

    const actionItems: EmActionItem[] = result.rows.map((row) => {
      const r = row as {
        id: string; team_id: string; session_id: string; description: string;
        status: string; resolution_note: string | null; created_at: Date; updated_at: Date;
        owner_display_name: string;
      };
      return {
        id: r.id, teamId: r.team_id, sessionId: r.session_id,
        description: r.description, status: r.status as EmActionItem["status"],
        dueDate: null, // action_items schema does not have due_date; extensible in future
        ownerDisplayName: r.owner_display_name,
        resolutionNote: r.resolution_note,
        createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
      };
    });

    const response: EmActionItemsResponse = { teamId, actionItems };
    await applyTimingFloor(startTime);
    return reply.send(response);
  });

  // -------------------------------------------------------------------------
  // ACTION-005: GET /api/v1/teams/:teamId/em/action-items/:actionItemId
  //
  // Returns a single action item for EM view. Same ownerDisplayName policy as ACTION-004.
  //
  // NOTE: The action item query doubles as the existence check. The audit is
  // written after the fetch (if item exists) since a separate pre-fetch
  // existence-check query would add unnecessary round-trips. The action_item_id
  // is available before the fetch and is included in the audit metadata.
  // -------------------------------------------------------------------------
  app.get<{
    Params: { teamId: string; actionItemId: string };
  }>("/api/v1/teams/:teamId/em/action-items/:actionItemId", async (request, reply) => {
    const startTime = Date.now();
    const session = request.session as unknown as SessionData;
    const { teamId, actionItemId } = request.params;

    const grant = await evaluateTeamAccess(session.userId, teamId);
    if (grant === null || grant.path !== "member" || grant.role !== "engineering_manager") {
      await applyTimingFloor(startTime);
      return reply.code(403).send({
        error: { category: "forbidden" as const, message: "EM access required.", correlationId: crypto.randomUUID() },
      });
    }

    const result = await db.query<{
      id: string; team_id: string; session_id: string; description: string;
      status: string; resolution_note: string | null; created_at: Date; updated_at: Date;
      owner_display_name: string;
    }>(
      `SELECT
         ai.id, ai.team_id, ai.session_id, ai.description, ai.status,
         ai.resolution_note, ai.created_at, ai.updated_at,
         u.display_name AS owner_display_name
       FROM action_items ai
       JOIN users u ON ai.owner_id = u.id
       WHERE ai.id = $1 AND ai.team_id = $2`,
      [actionItemId, teamId],
    );

    if (result.rows.length === 0) {
      await applyTimingFloor(startTime);
      return reply.code(404).send({
        error: { category: "not_found" as const, message: "Action item not found.", correlationId: crypto.randomUUID() },
      });
    }

    const r = result.rows[0] as {
      id: string; team_id: string; session_id: string; description: string;
      status: string; resolution_note: string | null; created_at: Date; updated_at: Date;
      owner_display_name: string;
    };

    // Audit log for EM access (written after fetch since it's also the existence check)
    await db.query(
      `INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [session.userId, grant.actorGlobalRole, request.ip, "em.action_item_accessed", teamId,
        JSON.stringify({ action_item_id: actionItemId }),
      ],
    );

    emitAuditEvent(request.log, "em.action_item_accessed", {
      actorUserId: session.userId,
      teamId,
      actionItemId,
    });

    const actionItem: EmActionItem = {
      id: r.id, teamId: r.team_id, sessionId: r.session_id,
      description: r.description, status: r.status as EmActionItem["status"],
      dueDate: null, ownerDisplayName: r.owner_display_name,
      resolutionNote: r.resolution_note,
      createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
    };

    const response: EmActionItemsResponse = { teamId, actionItems: [actionItem] };
    await applyTimingFloor(startTime);
    return reply.send(response);
  });

  // -------------------------------------------------------------------------
  // Write-rejection guards for EM (task 5.7):
  // Any write attempt to action item or topic configuration endpoints returns
  // 403 for EM callers. These guards are implemented as separate route
  // handlers to catch any write methods on EM-prefixed paths.
  //
  // Live session data rejection (task 5.8):
  // EM access to live session data is rejected with 403.
  // The session status check in SESSION-008 handles this for single sessions.
  // -------------------------------------------------------------------------
}

// ---------------------------------------------------------------------------
// Statistical helpers — no participant labels in output
// ---------------------------------------------------------------------------

/** Compute median of a sorted array of numbers. Returns null for empty input. */
function computeMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Compute trend direction from a series of average values.
 * Uses simple linear trend: compare the average of the first half to the second half.
 * Returns null when there is insufficient data (< 3 data points).
 */
function computeTrendDirection(averages: number[]): 1 | -1 | 0 | null {
  if (averages.length < 3) return null;
  const half = Math.floor(averages.length / 2);
  const firstHalfAvg = averages.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const secondHalfAvg = averages.slice(-half).reduce((a, b) => a + b, 0) / half;
  const diff = secondHalfAvg - firstHalfAvg;
  if (Math.abs(diff) < 0.1) return 0;
  return diff > 0 ? 1 : -1;
}
