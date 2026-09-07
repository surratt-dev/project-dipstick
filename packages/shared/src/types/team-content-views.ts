// ---------------------------------------------------------------------------
// Team content view types — grant-path-specific query result types and
// serialized response shapes.
//
// Design Decision 9 (enforce-access-control-on-team-content):
//   Three distinct query result types enforce the attribution boundary at the
//   query layer. No shared "rawData" type bridges the three paths.
//
//   ParticipantQueryResult — includes voter_id (needed to identify own vote)
//   EMQueryResult          — never includes voter_id (EM cannot see attribution)
//   FacilitatorQueryResult — includes full session data, topic reveal status
// ---------------------------------------------------------------------------

import type { VoteDistributionBucket } from "./em-views.js";

// ---------------------------------------------------------------------------
// VoteTopicResult — common fields for topic-level data included in all views
// ---------------------------------------------------------------------------
export interface VoteTopicResultBase {
  topicId: string;
  topicName: string;
  revealStatus: "waiting" | "voting" | "revealed" | "complete";
  flaggedForDiscussion: boolean;
}

// ---------------------------------------------------------------------------
// ParticipantQueryResult — for serializeForMemberParticipant
//
// Includes voter_id so the serializer can identify the caller's own vote.
// MUST NOT be passed to serializeForMemberEM (compile-time enforcement via
// nominal types — the two function signatures accept different result types).
// ---------------------------------------------------------------------------
export interface ParticipantVoteRow {
  topicId: string;
  topicName: string;
  revealStatus: "waiting" | "voting" | "revealed" | "complete";
  flaggedForDiscussion: boolean;
  /** voter_id is present in participant queries — used to identify own vote */
  voterId: string | null;
  voteValue: number | null;
  voteCount: number;
  containsOutlier: boolean;
}

export interface ParticipantQueryResult {
  __brand: "ParticipantQueryResult";
  sessionId: string;
  sessionStatus: string;
  callerUserId: string;
  rows: ParticipantVoteRow[];
}

// ---------------------------------------------------------------------------
// EMQueryResult — for serializeForMemberEM
//
// voter_id is NEVER selected in the query that produces this type.
// Passing an EMQueryResult to serializeForMemberParticipant (or vice versa)
// is a TypeScript compile error.
// ---------------------------------------------------------------------------
export interface EMVoteRow {
  topicId: string;
  topicName: string;
  revealStatus: "waiting" | "voting" | "revealed" | "complete";
  flaggedForDiscussion: boolean;
  voteValue: number | null;
  voteCount: number;
  containsOutlier: boolean;
  // voter_id is ABSENT — enforced at the query layer, not by filtering in application code
}

export interface EMQueryResult {
  __brand: "EMQueryResult";
  sessionId: string;
  rows: EMVoteRow[];
}

// ---------------------------------------------------------------------------
// FacilitatorQueryResult — for serializeForFacilitator
//
// Includes full session data: topic reveal status and per-voter attribution
// for revealed topics. The serializer enforces the pre-reveal / post-reveal
// boundary by checking revealStatus before including voteValue.
// ---------------------------------------------------------------------------
export interface FacilitatorVoteRow {
  topicId: string;
  topicName: string;
  revealStatus: "waiting" | "voting" | "revealed" | "complete";
  flaggedForDiscussion: boolean;
  /** voterId present for facilitator — used for individual attribution on revealed topics */
  voterId: string | null;
  voterDisplayName: string | null;
  voteValue: number | null;
}

export interface FacilitatorQueryResult {
  __brand: "FacilitatorQueryResult";
  sessionId: string;
  sessionStatus: string;
  rows: FacilitatorVoteRow[];
}

// ---------------------------------------------------------------------------
// Serialized response shapes — what the endpoint sends to the client
// ---------------------------------------------------------------------------

/** Aggregate vote distribution with outlier flag — same shape as EM views */
export type { VoteDistributionBucket };

export interface ParticipantTopicResult {
  topicId: string;
  topicName: string;
  revealStatus: string;
  flaggedForDiscussion: boolean;
  /** Aggregate: count-per-bucket, team average, outlier count */
  voteDistribution: VoteDistributionBucket[];
  average: number | null;
  outlierCount: number;
  /** Own vote — null if not yet revealed or participant has not voted */
  ownVoteValue: number | null;
}

export interface EMTopicResult {
  topicId: string;
  topicName: string;
  revealStatus: string;
  flaggedForDiscussion: boolean;
  /** Aggregate only — no individual vote attribution */
  voteDistribution: VoteDistributionBucket[];
  average: number | null;
  outlierCount: number;
  // voter_id / ownVoteValue are deliberately absent
}

export interface FacilitatorVoteAttribution {
  voterId: string;
  voterDisplayName: string;
  voteValue: number;
}

export interface FacilitatorTopicResult {
  topicId: string;
  topicName: string;
  revealStatus: string;
  flaggedForDiscussion: boolean;
  /**
   * Individual vote attribution — populated only for revealed topics.
   * For unrevealed topics this array is empty (enforced at serializer layer,
   * independently of the authorization check — Decision 9).
   */
  votes: FacilitatorVoteAttribution[];
}

export interface ParticipantContentView {
  sessionId: string;
  sessionStatus: string;
  topics: ParticipantTopicResult[];
}

export interface EMContentView {
  sessionId: string;
  topics: EMTopicResult[];
}

export interface FacilitatorContentView {
  sessionId: string;
  sessionStatus: string;
  topics: FacilitatorTopicResult[];
}
