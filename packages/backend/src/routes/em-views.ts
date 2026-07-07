import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { emitAuditEvent } from "../auth/audit-logger.js";
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
// ALL handlers enforce DUAL authorization (Decision 14):
//   - Check 1: users.global_role = 'engineering_manager' (global role guard)
//   - Check 2: team_memberships.role = 'engineering_manager' for the specific
//     team (team-scoped association guard)
//   Both checks are independent and must remain independent. They serve
//   different purposes — a future change that sets global_role without
//   TEAM-006 would bypass the team_memberships check if they were consolidated.
//
// ALL handlers write audit_log entries when returning data (Decision 11).
// EM access attempts that return 403 do NOT produce audit records.
//
// Phase 3 endpoints:
//   SESSION-007: GET /api/v1/teams/:teamId/em/sessions
//   SESSION-008: GET /api/v1/teams/:teamId/em/sessions/:sessionId
//   TREND-001:   GET /api/v1/teams/:teamId/em/trends
//   TREND-002:   GET /api/v1/teams/:teamId/em/trends/:topicId
//   ACTION-004:  GET /api/v1/teams/:teamId/em/action-items
//   ACTION-005:  GET /api/v1/teams/:teamId/em/action-items/:actionItemId
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Authorization helper — dual check per Decision 14
//
// Both checks are independent; consolidating them is explicitly prohibited.
// Returns { authorized, actorId } — never throws on auth failure (callers check).
// ---------------------------------------------------------------------------
async function checkEmAuthorization(
  actorUserId: string,
  teamId: string,
): Promise<{ authorized: boolean; reason?: string; globalRole?: string }> {
  const result = await db.query<{
    global_role: string;
    membership_role: string | null;
  }>(
    // Check 1: global_role = 'engineering_manager' (global role guard)
    // Check 2: team_memberships.role = 'engineering_manager' for this team (association guard)
    // Both must be true. Evaluated independently — not as a single OR clause.
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
    return { authorized: false, reason: "user_not_found" };
  }

  const { global_role, membership_role } = result.rows[0] as {
    global_role: string;
    membership_role: string | null;
  };

  // Check 1: global role guard
  if (global_role !== "engineering_manager") {
    return { authorized: false, reason: "not_engineering_manager_global_role" };
  }

  // Check 2: team-scoped association guard
  if (membership_role !== "engineering_manager") {
    return { authorized: false, reason: "not_associated_with_team" };
  }

  return { authorized: true, globalRole: global_role };
}

// ---------------------------------------------------------------------------
// Verify the team exists — returns teamId if found, null if not
// ---------------------------------------------------------------------------
async function teamExists(teamId: string): Promise<boolean> {
  const result = await db.query<{ id: string }>(
    `SELECT id FROM teams WHERE id = $1`,
    [teamId],
  );
  return result.rows.length > 0;
}

export async function emViewRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  // SESSION-007: GET /api/v1/teams/:teamId/em/sessions
  //
  // Returns aggregate session history for the team. EM-facing serialization
  // enforces the vote attribution boundary — no per-participant vote values.
  //
  // Historical access: sessions predating the association date are included.
  // No date boundary is applied (Decision 6).
  // -------------------------------------------------------------------------
  app.get<{
    Params: { teamId: string };
  }>("/api/v1/teams/:teamId/em/sessions", async (request, reply) => {
    const session = request.session as unknown as SessionData;
    const { teamId } = request.params;

    // Dual authorization check (Decision 14) — both checks are independent
    const { authorized, reason, globalRole } = await checkEmAuthorization(
      session.userId,
      teamId,
    );

    if (!authorized) {
      return reply.code(403).send({
        error: {
          category: "forbidden" as const,
          message: "Engineering Manager access requires both global EM role and team association.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    if (!(await teamExists(teamId))) {
      return reply.code(404).send({
        error: {
          category: "not_found" as const,
          message: "Team not found.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

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

    // Audit log: EM access to session history that returns data (Decision 11)
    await db.query(
      `INSERT INTO audit_log
         (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        session.userId,
        globalRole!,
        request.ip,
        "em.session_history_accessed",
        teamId,
        JSON.stringify({ session_count: sessionEntries.length }),
      ],
    );

    emitAuditEvent(request.log, "em.session_history_accessed", {
      actorUserId: session.userId,
      teamId,
      sessionCount: sessionEntries.length,
    });

    const response: EmSessionHistoryResponse = {
      teamId,
      sessions: sessionEntries,
    };

    return reply.send(response);
  });

  // -------------------------------------------------------------------------
  // SESSION-008: GET /api/v1/teams/:teamId/em/sessions/:sessionId
  //
  // Returns a single session's aggregate data for the EM. Same attribution
  // boundary enforcement as SESSION-007.
  // -------------------------------------------------------------------------
  app.get<{
    Params: { teamId: string; sessionId: string };
  }>("/api/v1/teams/:teamId/em/sessions/:sessionId", async (request, reply) => {
    const session = request.session as unknown as SessionData;
    const { teamId, sessionId } = request.params;

    const { authorized, globalRole } = await checkEmAuthorization(session.userId, teamId);
    if (!authorized) {
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
      return reply.code(403).send({
        error: {
          category: "forbidden" as const,
          message: "Engineering Managers cannot access live session data.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

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

    // Audit log for EM access (Decision 11)
    await db.query(
      `INSERT INTO audit_log
         (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        session.userId, globalRole!, request.ip,
        "em.session_detail_accessed", teamId,
        JSON.stringify({ session_id: sessionId }),
      ],
    );

    emitAuditEvent(request.log, "em.session_detail_accessed", {
      actorUserId: session.userId,
      teamId,
      sessionId,
    });

    const entry: EmSessionHistoryEntry = {
      sessionId: sr.session_id,
      sessionDate: sr.completed_at.toISOString(),
      sessionNumber: sr.session_number,
      facilitatorName: sr.facilitator_name,
      participantCount,
      topics,
    };

    return reply.send(entry);
  });

  // -------------------------------------------------------------------------
  // TREND-001: GET /api/v1/teams/:teamId/em/trends
  //
  // Returns statistical trend data across all topics and all sessions.
  // Attribution boundary: aggregates only, no participant labels.
  // Bulk read: single audit_log entry with team ID and date range (Decision 11).
  // -------------------------------------------------------------------------
  app.get<{
    Params: { teamId: string };
  }>("/api/v1/teams/:teamId/em/trends", async (request, reply) => {
    const session = request.session as unknown as SessionData;
    const { teamId } = request.params;

    const { authorized, globalRole } = await checkEmAuthorization(session.userId, teamId);
    if (!authorized) {
      return reply.code(403).send({
        error: {
          category: "forbidden" as const,
          message: "Engineering Manager access requires both global EM role and team association.",
          correlationId: crypto.randomUUID(),
        },
      });
    }

    // Aggregate trend data: averages and medians by topic across completed sessions
    // No voter_id in query (Decision 5)
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

    // Single audit_log entry for bulk read (Decision 11 / task 5.12):
    // Log team ID and date range — not one row per session
    await db.query(
      `INSERT INTO audit_log
         (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        session.userId, globalRole!, request.ip,
        "em.trend_data_accessed", teamId,
        JSON.stringify({
          date_range_start: earliestDate?.toISOString() ?? null,
          date_range_end: latestDate?.toISOString() ?? null,
          topic_count: topics.length,
        }),
      ],
    );

    emitAuditEvent(request.log, "em.trend_data_accessed", {
      actorUserId: session.userId,
      teamId,
      topicCount: topics.length,
      dateRangeStart: earliestDate?.toISOString() ?? null,
      dateRangeEnd: latestDate?.toISOString() ?? null,
    });

    const response: EmTrendResponse = {
      teamId,
      topics,
      dateRangeStart: earliestDate?.toISOString() ?? null,
      dateRangeEnd: latestDate?.toISOString() ?? null,
    };

    return reply.send(response);
  });

  // -------------------------------------------------------------------------
  // TREND-002: GET /api/v1/teams/:teamId/em/trends/:topicId
  //
  // Returns trend data for a single topic.
  // Same attribution boundary enforcement as TREND-001.
  // -------------------------------------------------------------------------
  app.get<{
    Params: { teamId: string; topicId: string };
  }>("/api/v1/teams/:teamId/em/trends/:topicId", async (request, reply) => {
    const session = request.session as unknown as SessionData;
    const { teamId, topicId } = request.params;

    const { authorized, globalRole } = await checkEmAuthorization(session.userId, teamId);
    if (!authorized) {
      return reply.code(403).send({
        error: { category: "forbidden" as const, message: "EM access required.", correlationId: crypto.randomUUID() },
      });
    }

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
       GROUP BY st.topic_name, s.id, s.completed_at, s.session_number
       ORDER BY s.completed_at`,
      [teamId, topicId],
    );

    if (trendResult.rows.length === 0) {
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
    await db.query(
      `INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [session.userId, globalRole!, request.ip, "em.topic_trend_accessed", teamId,
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
    return reply.send(response);
  });

  // -------------------------------------------------------------------------
  // ACTION-004: GET /api/v1/teams/:teamId/em/action-items
  //
  // Returns action items for the team in read-only EM view.
  // ownerDisplayName IS included per Q8 resolution (proposal.md) and
  // Decision 13 (design.md) — action item ownership is work-tracking data,
  // not vote attribution.
  // -------------------------------------------------------------------------
  app.get<{
    Params: { teamId: string };
  }>("/api/v1/teams/:teamId/em/action-items", async (request, reply) => {
    const session = request.session as unknown as SessionData;
    const { teamId } = request.params;

    const { authorized, globalRole } = await checkEmAuthorization(session.userId, teamId);
    if (!authorized) {
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
       WHERE ai.team_id = $1
       ORDER BY ai.created_at DESC`,
      [teamId],
    );

    // Audit log for EM access
    await db.query(
      `INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [session.userId, globalRole!, request.ip, "em.action_items_accessed", teamId,
        JSON.stringify({ item_count: result.rows.length }),
      ],
    );

    emitAuditEvent(request.log, "em.action_items_accessed", {
      actorUserId: session.userId,
      teamId,
      itemCount: result.rows.length,
    });

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
    return reply.send(response);
  });

  // -------------------------------------------------------------------------
  // ACTION-005: GET /api/v1/teams/:teamId/em/action-items/:actionItemId
  //
  // Returns a single action item for EM view. Same ownerDisplayName policy as ACTION-004.
  // -------------------------------------------------------------------------
  app.get<{
    Params: { teamId: string; actionItemId: string };
  }>("/api/v1/teams/:teamId/em/action-items/:actionItemId", async (request, reply) => {
    const session = request.session as unknown as SessionData;
    const { teamId, actionItemId } = request.params;

    const { authorized, globalRole } = await checkEmAuthorization(session.userId, teamId);
    if (!authorized) {
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
      return reply.code(404).send({
        error: { category: "not_found" as const, message: "Action item not found.", correlationId: crypto.randomUUID() },
      });
    }

    const r = result.rows[0] as {
      id: string; team_id: string; session_id: string; description: string;
      status: string; resolution_note: string | null; created_at: Date; updated_at: Date;
      owner_display_name: string;
    };

    // Audit log for EM access
    await db.query(
      `INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [session.userId, globalRole!, request.ip, "em.action_item_accessed", teamId,
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
