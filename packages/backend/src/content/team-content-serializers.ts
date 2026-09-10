// ---------------------------------------------------------------------------
// Team content serializers — grant-path-specific response shape builders
//
// Design Decision 9 (enforce-access-control-on-team-content):
//   Three distinct serializer functions enforce the content type access matrix
//   at the serializer layer, INDEPENDENT of the authorization check. Both
//   enforcement points are required; neither is sufficient alone.
//
// The pre-reveal constraint is enforced at TWO independent layers:
//   1. Authorization layer: the grant correctly identifies the caller's role
//   2. Serializer layer: checks topic.revealStatus before including vote data
//      — regardless of the grant path
//
// Named integration tests (acceptance criteria, Task 4.9):
//   facilitator-unrevealed-topic    — vote values absent for unrevealed topics
//   facilitator-revealed-topic      — vote values present for revealed topics
//   layer-removal-serializer-check  — test fails when serializer check removed
//   layer-removal-auth-check        — test fails when auth check bypassed
//
// Type safety (Task 4.8):
//   Each serializer accepts a distinct query result type. Passing an EMQueryResult
//   to serializeForMemberParticipant (or vice versa) is a TypeScript compile error
//   because __brand fields differ.
// ---------------------------------------------------------------------------

import type {
  TeamAccessGrant,
  ParticipantQueryResult,
  ParticipantVoteRow,
  EMQueryResult,
  EMVoteRow,
  FacilitatorQueryResult,
  FacilitatorVoteRow,
  ParticipantTopicResult,
  EMTopicResult,
  FacilitatorTopicResult,
  FacilitatorVoteAttribution,
  ParticipantContentView,
  EMContentView,
  FacilitatorContentView,
  VoteDistributionBucket,
} from "@dipstick/shared";

// ---------------------------------------------------------------------------
// serializeForMemberParticipant
//
// Task 4.3: Engineer serializer path.
//   - Aggregate vote distribution (count-per-bucket, team average, outlier count)
//   - Own individual vote identified via voter_id matching callerUserId
//   - Other engineers' individual votes are NOT included
// ---------------------------------------------------------------------------
export function serializeForMemberParticipant(
  grant: Extract<TeamAccessGrant, { path: "member"; role: "participant" }>,
  result: ParticipantQueryResult,
): ParticipantContentView {
  const topicsMap = new Map<string, {
    topicId: string;
    topicName: string;
    revealStatus: string;
    flaggedForDiscussion: boolean;
    voteValues: number[];
    buckets: Map<number, { count: number; containsOutlier: boolean }>;
    ownVoteValue: number | null;
    outlierCount: number;
  }>();

  for (const row of result.rows) {
    if (!topicsMap.has(row.topicId)) {
      topicsMap.set(row.topicId, {
        topicId: row.topicId,
        topicName: row.topicName,
        revealStatus: row.revealStatus,
        flaggedForDiscussion: row.flaggedForDiscussion,
        voteValues: [],
        buckets: new Map(),
        ownVoteValue: null,
        outlierCount: 0,
      });
    }

    const topic = topicsMap.get(row.topicId)!;

    if (row.voteValue !== null) {
      const bucket = topic.buckets.get(row.voteValue);
      if (bucket) {
        bucket.count += row.voteCount;
        if (row.containsOutlier) bucket.containsOutlier = true;
      } else {
        topic.buckets.set(row.voteValue, {
          count: row.voteCount,
          containsOutlier: row.containsOutlier,
        });
      }

      // Accumulate for average calculation
      for (let i = 0; i < row.voteCount; i++) {
        topic.voteValues.push(row.voteValue);
      }

      if (row.containsOutlier) {
        topic.outlierCount += row.voteCount;
      }
    }

    // Identify own vote — only match when voter_id = callerUserId
    // NEVER expose other voters' individual vote values
    if (row.voterId === result.callerUserId && row.voteValue !== null) {
      topic.ownVoteValue = row.voteValue;
    }
  }

  const topics: ParticipantTopicResult[] = Array.from(topicsMap.values()).map((t) => {
    const voteDistribution: VoteDistributionBucket[] = Array.from(t.buckets.entries())
      .sort(([a], [b]) => a - b)
      .map(([voteValue, { count, containsOutlier }]) => ({
        voteValue,
        count,
        containsOutlier,
      }));

    const average =
      t.voteValues.length > 0
        ? t.voteValues.reduce((a, b) => a + b, 0) / t.voteValues.length
        : null;

    return {
      topicId: t.topicId,
      topicName: t.topicName,
      revealStatus: t.revealStatus,
      flaggedForDiscussion: t.flaggedForDiscussion,
      voteDistribution,
      average,
      outlierCount: t.outlierCount,
      ownVoteValue: t.ownVoteValue,
    };
  });

  return {
    sessionId: result.sessionId,
    sessionStatus: result.sessionStatus,
    topics,
  };
}

// ---------------------------------------------------------------------------
// serializeForMemberEM
//
// Task 4.4: EM serializer path.
//   - Aggregate vote distributions only (count-per-bucket, team average, outlier count)
//   - ALL individual vote attribution is excluded
//   - voter_id MUST NOT appear in the EMQueryResult — enforced at query layer
// ---------------------------------------------------------------------------
export function serializeForMemberEM(
  grant: Extract<TeamAccessGrant, { path: "member"; role: "engineering_manager" }>,
  result: EMQueryResult,
): EMContentView {
  const topicsMap = new Map<string, {
    topicId: string;
    topicName: string;
    revealStatus: string;
    flaggedForDiscussion: boolean;
    voteValues: number[];
    buckets: Map<number, { count: number; containsOutlier: boolean }>;
    outlierCount: number;
  }>();

  for (const row of result.rows) {
    if (!topicsMap.has(row.topicId)) {
      topicsMap.set(row.topicId, {
        topicId: row.topicId,
        topicName: row.topicName,
        revealStatus: row.revealStatus,
        flaggedForDiscussion: row.flaggedForDiscussion,
        voteValues: [],
        buckets: new Map(),
        outlierCount: 0,
      });
    }

    const topic = topicsMap.get(row.topicId)!;

    if (row.voteValue !== null) {
      const bucket = topic.buckets.get(row.voteValue);
      if (bucket) {
        bucket.count += row.voteCount;
        if (row.containsOutlier) bucket.containsOutlier = true;
      } else {
        topic.buckets.set(row.voteValue, {
          count: row.voteCount,
          containsOutlier: row.containsOutlier,
        });
      }

      for (let i = 0; i < row.voteCount; i++) {
        topic.voteValues.push(row.voteValue);
      }

      if (row.containsOutlier) {
        topic.outlierCount += row.voteCount;
      }
    }
  }

  const topics: EMTopicResult[] = Array.from(topicsMap.values()).map((t) => {
    const voteDistribution: VoteDistributionBucket[] = Array.from(t.buckets.entries())
      .sort(([a], [b]) => a - b)
      .map(([voteValue, { count, containsOutlier }]) => ({
        voteValue,
        count,
        containsOutlier,
      }));

    const average =
      t.voteValues.length > 0
        ? t.voteValues.reduce((a, b) => a + b, 0) / t.voteValues.length
        : null;

    return {
      topicId: t.topicId,
      topicName: t.topicName,
      revealStatus: t.revealStatus,
      flaggedForDiscussion: t.flaggedForDiscussion,
      voteDistribution,
      average,
      outlierCount: t.outlierCount,
      // voter_id / ownVoteValue deliberately absent from EMTopicResult
    };
  });

  return {
    sessionId: result.sessionId,
    topics,
  };
}

// ---------------------------------------------------------------------------
// serializeForFacilitator
//
// Task 4.5: Facilitator serializer path.
//   - Full session data including individual attribution for revealed topics
//   - Pre-reveal topics return empty votes array (no vote values)
//
// Task 4.6 / Decision 9: The pre-reveal constraint is enforced HERE
//   (independently of the authorization check) by checking
//   topic.revealStatus === 'revealed' before populating the votes array.
//   This is the SECOND enforcement point. The authorization check is the first.
//   Both are required; removing either causes the named integration tests to fail.
// ---------------------------------------------------------------------------
export function serializeForFacilitator(
  grant: Extract<TeamAccessGrant, { path: "facilitator" }>,
  result: FacilitatorQueryResult,
): FacilitatorContentView {
  const topicsMap = new Map<string, {
    topicId: string;
    topicName: string;
    revealStatus: string;
    flaggedForDiscussion: boolean;
    votes: FacilitatorVoteAttribution[];
  }>();

  for (const row of result.rows) {
    if (!topicsMap.has(row.topicId)) {
      topicsMap.set(row.topicId, {
        topicId: row.topicId,
        topicName: row.topicName,
        revealStatus: row.revealStatus,
        flaggedForDiscussion: row.flaggedForDiscussion,
        votes: [],
      });
    }

    const topic = topicsMap.get(row.topicId)!;

    // ---------------------------------------------------------------------------
    // SERIALIZER-LAYER PRE-REVEAL ENFORCEMENT (Decision 9)
    //
    // Vote values are ONLY included for topics whose revealStatus === 'revealed'.
    // For all other statuses (waiting, voting, complete), vote values are excluded.
    // This check runs independently of the authorization check.
    //
    // Named test: facilitator-unrevealed-topic — verifies vote values are absent
    // Named test: layer-removal-serializer-check — removing THIS CHECK causes
    //   the test to fail (vote values appear on unrevealed topic)
    // ---------------------------------------------------------------------------
    if (
      row.revealStatus === "revealed" &&
      row.voterId !== null &&
      row.voterDisplayName !== null &&
      row.voteValue !== null
    ) {
      topic.votes.push({
        voterId: row.voterId,
        voterDisplayName: row.voterDisplayName,
        voteValue: row.voteValue,
      });
    }
    // If revealStatus !== 'revealed', row is NOT added to votes — regardless of
    // whether vote data is present in the row. This is the key constraint.
  }

  const topics: FacilitatorTopicResult[] = Array.from(topicsMap.values()).map((t) => ({
    topicId: t.topicId,
    topicName: t.topicName,
    revealStatus: t.revealStatus,
    flaggedForDiscussion: t.flaggedForDiscussion,
    votes: t.votes,
  }));

  return {
    sessionId: result.sessionId,
    sessionStatus: result.sessionStatus,
    topics,
    // Populated by the route handler (content.ts), which queries audit_log
    // for session.connection_recovered rows (websocket-connection-
    // reauthorization, design.md Decision D9) — this serializer has no DB
    // dependency of its own and always returns the empty default here.
    connectionRecoveries: [],
  };
}

// ---------------------------------------------------------------------------
// Query builder helpers
//
// Task 4.2: grant-path-specific query functions. These ensure no shared
// rawData type bridges the participant and EM paths.
// ---------------------------------------------------------------------------

/**
 * Build a ParticipantQueryResult from raw database rows.
 * Caller must ensure voter_id IS included in the query.
 */
export function buildParticipantQueryResult(
  sessionId: string,
  sessionStatus: string,
  callerUserId: string,
  rows: Array<{
    topic_id: string;
    topic_name: string;
    reveal_status: string;
    flagged_for_discussion: boolean;
    voter_id: string | null;
    vote_value: number | null;
    vote_count: number;
    contains_outlier: boolean;
  }>,
): ParticipantQueryResult {
  return {
    __brand: "ParticipantQueryResult" as const,
    sessionId,
    sessionStatus,
    callerUserId,
    rows: rows.map((r) => ({
      topicId: r.topic_id,
      topicName: r.topic_name,
      revealStatus: r.reveal_status as ParticipantVoteRow["revealStatus"],
      flaggedForDiscussion: r.flagged_for_discussion,
      voterId: r.voter_id,
      voteValue: r.vote_value,
      voteCount: r.vote_count,
      containsOutlier: r.contains_outlier,
    })),
  };
}

/**
 * Build an EMQueryResult from raw database rows.
 * Caller MUST ensure voter_id is NOT selected in the query (enforced at DB layer).
 */
export function buildEMQueryResult(
  sessionId: string,
  rows: Array<{
    topic_id: string;
    topic_name: string;
    reveal_status: string;
    flagged_for_discussion: boolean;
    vote_value: number | null;
    vote_count: number;
    contains_outlier: boolean;
    // voter_id intentionally absent from parameter type
  }>,
): EMQueryResult {
  return {
    __brand: "EMQueryResult" as const,
    sessionId,
    rows: rows.map((r) => ({
      topicId: r.topic_id,
      topicName: r.topic_name,
      revealStatus: r.reveal_status as EMVoteRow["revealStatus"],
      flaggedForDiscussion: r.flagged_for_discussion,
      voteValue: r.vote_value,
      voteCount: r.vote_count,
      containsOutlier: r.contains_outlier,
    })),
  };
}

/**
 * Build a FacilitatorQueryResult from raw database rows.
 * Caller must ensure voter_id and voterDisplayName are included.
 */
export function buildFacilitatorQueryResult(
  sessionId: string,
  sessionStatus: string,
  rows: Array<{
    topic_id: string;
    topic_name: string;
    reveal_status: string;
    flagged_for_discussion: boolean;
    voter_id: string | null;
    voter_display_name: string | null;
    vote_value: number | null;
  }>,
): FacilitatorQueryResult {
  return {
    __brand: "FacilitatorQueryResult" as const,
    sessionId,
    sessionStatus,
    rows: rows.map((r) => ({
      topicId: r.topic_id,
      topicName: r.topic_name,
      revealStatus: r.reveal_status as FacilitatorVoteRow["revealStatus"],
      flaggedForDiscussion: r.flagged_for_discussion,
      voterId: r.voter_id,
      voterDisplayName: r.voter_display_name,
      voteValue: r.vote_value,
    })),
  };
}
