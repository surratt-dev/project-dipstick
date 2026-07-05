export type ActionItemStatus = "open" | "in_progress" | "resolved";

export interface ActionItem {
  id: string;
  teamId: string;
  sessionId: string;
  sessionTopicId: string | null;
  ownerId: string;
  description: string;
  status: ActionItemStatus;
  resolutionNote: string | null;
  resolvedInSessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActionItemHistory {
  id: string;
  actionItemId: string;
  changedByUserId: string;
  previousStatus: ActionItemStatus;
  newStatus: ActionItemStatus;
  resolutionNote: string | null;
  sessionId: string | null;
  changedAt: Date;
}
