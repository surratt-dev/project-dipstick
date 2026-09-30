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

// ---------------------------------------------------------------------------
// TOPIC-002 — GET /api/v1/teams/:teamId/topics/all (remove-topic, design.md
// Decision 9/6). Used by the Topic Management screen.
// ---------------------------------------------------------------------------
export interface ArchivedByProvenance {
  userId: string;
  displayName: string;
}

export interface GetAllTopicsResponse {
  teamId: string;
  // Not in the originally drafted TOPIC-002 contract — added so the Topic
  // Management screen's remove-confirmation dialog can name the team, per
  // `specs/topic-management-screen/spec.md`'s "The confirmation names both
  // the topic and the team" requirement (design.md Decision 10). No other
  // endpoint reachable by a standing, non-member facilitator returns a
  // team's display name.
  teamName: string;
  isCustomizationLocked: boolean;
  active: Array<{
    topicId: string;
    name: string;
    prompt: string;
    voteType: VoteType;
    displayOrder: number;
    isDefault: boolean;
    // View Active Topic Configuration's existing acceptance criteria
    // ("prompt, vote type, and description") — not in the originally
    // drafted TOPIC-002 contract; added here so the Topic Management
    // screen's active list can satisfy that AC (remove-topic Task 9.2).
    firstSessionDescription: string | null;
    teamAnnotation: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  archived: Array<{
    topicId: string;
    name: string;
    prompt: string;
    voteType: VoteType;
    isDefault: boolean;
    archivedAt: string;
    // Facilitator-visible provenance (design.md Decision 6) — null only for
    // a pre-existing row archived before the archived_by column existed;
    // none exist today.
    archivedBy: ArchivedByProvenance | null;
    // re-add-removed-topic, design.md Decision 4 — null for a topic that
    // has never been restored. A topic archived and restored more than once
    // shows only the most recent restore event, the same stated limitation
    // archivedAt/archivedBy already carry for multiple archive events.
    restoredAt: string | null;
    restoredBy: ArchivedByProvenance | null;
  }>;
  defaultTopicsNotActive: Array<{
    topicId: string;
    name: string;
    isArchived: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// TOPIC-004 — DELETE /api/v1/teams/:teamId/topics/:topicId (remove-topic,
// design.md Decision 1/3/5).
// ---------------------------------------------------------------------------
export interface ArchiveTopicResponse {
  topicId: string;
  status: "archived";
  archivedAt: string;
}

export interface ArchiveTopicConfirmationRequired {
  requiresConfirmation: true;
  reason: "openActionItems";
  openActionItemCount: number;
  openActionItems: Array<{ actionItemId: string; description: string }>;
  message: string;
}

// ---------------------------------------------------------------------------
// TOPIC-005 — POST /api/v1/teams/:teamId/topics/:topicId/restore
// (re-add-removed-topic, design.md Decision 1/3/4).
// ---------------------------------------------------------------------------
export interface RestoreTopicResponse {
  topicId: string;
  name: string;
  status: "active";
  displayOrder: number;
  restoredAt: string;
}
