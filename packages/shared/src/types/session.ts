import type { VoteType } from "./vote.js";

export type SessionStatus =
  | "draft"
  | "lobby"
  | "pre_session"
  | "active"
  | "wrap_up"
  | "complete"
  | "abandoned";

export type SessionTopicStatus = "waiting" | "voting" | "revealed" | "complete";

export interface Session {
  id: string;
  teamId: string;
  facilitatorId: string;
  status: SessionStatus;
  joinToken: string;
  isFirstSession: boolean;
  sessionNumber: number;
  currentTopicId: string | null;
  createdAt: Date;
  startedAt: Date | null;
  votingStartedAt: Date | null;
  wrapUpStartedAt: Date | null;
  completedAt: Date | null;
  abandonedAt: Date | null;
  /** Null for all non-complete sessions and for complete sessions outside the grace window. */
  facilitatorAccessExpiresAt: Date | null;
}

export interface SessionTopic {
  id: string;
  sessionId: string;
  topicId: string;
  displayOrder: number;
  topicName: string;
  topicPrompt: string;
  voteType: VoteType;
  status: SessionTopicStatus;
  revealedAt: Date | null;
  completedAt: Date | null;
  flaggedForDiscussion: boolean;
  discussionNote: string | null;
}

export interface SessionParticipant {
  id: string;
  sessionId: string;
  userId: string;
  joinedAt: Date;
}

// ---------------------------------------------------------------------------
// session-lifecycle-transitions: SESSION-004 / SESSION-005 / SESSION-012
// response shapes (design.md Decision D1 / D4a).
// ---------------------------------------------------------------------------

export interface StartSessionResponse {
  sessionId: string;
  status: "pre_session";
  startedAt: string;
  actionItems: Array<{
    actionItemId: string;
    description: string;
    ownerUserId: string;
    ownerDisplayName: string;
    status: "open" | "in_progress";
    originatingSessionId: string;
    originatingSessionNumber: number;
    stalenessLevel: "none" | "yellow" | "orange" | "red";
    createdAt: string;
    updatedAt: string;
  }>;
  hasOpenItems: boolean;
}

export interface BeginVotingResponse {
  sessionId: string;
  status: "active";
  votingStartedAt: string;
  currentTopic: {
    /** firstSessionTopicId — session_topics.id, never topics.id (design.md's id-space note) */
    sessionTopicId: string;
    topicName: string;
    topicPrompt: string;
    voteType: VoteType;
    phase: "voting";
    firstSessionDescription: string | null;
  };
}

// ---------------------------------------------------------------------------
// pre-session-action-item-review: GET /api/v1/sessions/:sessionId/action-items-review
// design.md Decision 1/3.
// ---------------------------------------------------------------------------

/** Success (200) shape — same action item item-shape StartSessionResponse already carries. */
export interface ActionItemsReviewResponse {
  actionItems: StartSessionResponse["actionItems"];
  isFacilitator: boolean;
}

/**
 * Non-pre_session (409) shape — design.md Decision 1/2/3. currentSessionStatus
 * lets the frontend distinguish "still in lobby" from "already active" (or any
 * other non-pre_session status) without a second, team-scoped status call.
 * isFacilitator is resolved from the same grant as the 200 path, before this
 * gate runs, so it is present here too — this is what lets SessionLobbyPage's
 * lobby branch know whether to render the "Start Session" control.
 */
export interface ActionItemsReviewWrongStatusResponse {
  currentSessionStatus: SessionStatus;
  isFacilitator: boolean;
}

export interface TopicAdvanceResponse {
  sessionId: string;
  teamId: string;
  /** sessions.status after this transition — the discriminant (design.md Decision D4a) */
  status: "active" | "wrap_up";
  completedTopic: {
    sessionTopicId: string;
    topicName: string;
    completedAt: string;
  };
  /** Present only when status === 'active' */
  currentTopic?: {
    /** nextSessionTopicId — session_topics.id, never topics.id */
    sessionTopicId: string;
    topicName: string;
    topicPrompt: string;
    voteType: VoteType;
    phase: "voting";
  };
  /** Present only when status === 'wrap_up' */
  wrapUpStartedAt?: string;
}
