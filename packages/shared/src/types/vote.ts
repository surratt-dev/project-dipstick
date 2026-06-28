export type VoteType = "finger" | "roman" | "modified_roman";

export interface Vote {
  id: string;
  sessionId: string;
  sessionTopicId: string;
  voterId: string;
  voteValue: number;
  voteType: VoteType;
  isOutlier: boolean;
  outlierThreshold: number | null;
  revealedAt: Date;
  createdAt: Date;
}
