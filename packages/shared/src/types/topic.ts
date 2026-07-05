import type { VoteType } from "./vote.js";

export type TopicStatus = "active" | "archived";

export interface Topic {
  id: string;
  teamId: string;
  name: string;
  prompt: string;
  voteType: VoteType;
  displayOrder: number;
  status: TopicStatus;
  isDefault: boolean;
  firstSessionDescription: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}
