/**
 * EM-facing view types — Phase 3 (establish-manager-team-relationship)
 *
 * These types enforce the vote attribution boundary at the type layer:
 * - No userId or voter-identifying fields on vote distribution entries
 * - No per-participant vote values (only aggregates)
 * - Statistical displays do not label individual participants
 *
 * Decision 5 (design.md): EM-facing views must not surface the connection
 * between a specific vote value and the participant who cast it.
 * Decision 14: Dual authorization checks (global_role AND team_memberships.role)
 * are enforced at the route handler level, not here.
 */

/** One vote value bucket in an aggregate distribution — no voter identity */
export interface VoteDistributionBucket {
  voteValue: number;
  count: number;
  /** True if this bucket contains the outlier threshold — never identifies WHO was the outlier */
  containsOutlier: boolean;
}

/**
 * Session history entry for EM-facing view (SESSION-007/SESSION-008).
 *
 * Attribution boundary: no per-participant vote values, no voter IDs.
 * Fields permitted per Decision 5 and spec:
 * - Aggregate vote distributions
 * - Session date
 * - Participant count (aggregate number, not names)
 * - Facilitator name
 * - Topic names
 */
export interface EmSessionHistoryEntry {
  sessionId: string;
  sessionDate: string; // ISO 8601
  sessionNumber: number;
  facilitatorName: string;
  /** Aggregate count of participants — never individual names */
  participantCount: number;
  topics: EmSessionTopicSummary[];
}

export interface EmSessionTopicSummary {
  topicId: string;
  topicName: string;
  /** Aggregate vote distribution — no voter identity */
  voteDistribution: VoteDistributionBucket[];
  /** Statistical summary — no participant labels */
  average: number | null;
  median: number | null;
  flaggedForDiscussion: boolean;
}

/**
 * Response shape for SESSION-007 — list of session history entries for a team.
 * SESSION-008 returns a single EmSessionHistoryEntry.
 */
export interface EmSessionHistoryResponse {
  teamId: string;
  sessions: EmSessionHistoryEntry[];
}

/**
 * Trend data entry for a single topic across sessions (TREND-001/TREND-002).
 *
 * Attribution boundary: statistical aggregates only, no participant labels.
 */
export interface EmTopicTrend {
  topicId: string;
  topicName: string;
  /** Statistical aggregates across all historical sessions — no participant labels */
  sessions: EmTopicSessionDataPoint[];
  overallAverage: number | null;
  overallMedian: number | null;
  /** +1 = improving, -1 = declining, 0 = stable, null = insufficient data */
  trendDirection: 1 | -1 | 0 | null;
}

export interface EmTopicSessionDataPoint {
  sessionId: string;
  sessionDate: string;
  sessionNumber: number;
  average: number | null;
  median: number | null;
  participantCount: number;
}

/**
 * Response shape for TREND-001 (all topics) and TREND-002 (single topic).
 */
export interface EmTrendResponse {
  teamId: string;
  topics: EmTopicTrend[];
  /** Date range covered — used for bulk audit log entry (Decision 11) */
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
}

/**
 * Action item as seen by an EM (ACTION-004/ACTION-005).
 *
 * Per Q8 resolution (proposal.md) and Decision 13 (design.md):
 * ownerDisplayName IS visible to EMs. Action item ownership is work-tracking
 * data, not vote attribution. This decision is reflected in the type explicitly.
 *
 * Attribution boundary: no vote values, no voter IDs. The action item body
 * text is visible per Decision 13.
 */
export interface EmActionItem {
  id: string;
  teamId: string;
  sessionId: string;
  description: string;
  status: "open" | "in_progress" | "resolved";
  dueDate: string | null; // ISO 8601
  /** ownerDisplayName visible to EM per Q8/Decision 13 */
  ownerDisplayName: string;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Response shape for ACTION-004 (list) and ACTION-005 (single).
 */
export interface EmActionItemsResponse {
  teamId: string;
  actionItems: EmActionItem[];
}
