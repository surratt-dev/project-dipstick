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
