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
  // topic-annotation (design.md Decision 8). Optional so no existing fixture
  // breaks. TOPIC-001 (GET /api/v1/teams/:teamId/topics) deliberately does
  // NOT return these: it has no consumer, and its authorization currently
  // admits engineering managers. No response may be typed as Topic[] to
  // carry them without that decision being revisited (and EMs denied first).
  teamAnnotation?: string | null;
  annotationUpdatedBy?: ArchivedByProvenance | null;
  annotationUpdatedAt?: Date | null;
}

// ---------------------------------------------------------------------------
// TOPIC-003 — POST /api/v1/teams/:teamId/topics (Add Custom Topic).
// topic-add-form-and-empty-state design.md Decision 9: one compile-time
// contract shared by the Topic Management screen's add form and the
// backend validator (whose 422 `error.field` is typed
// `keyof AddCustomTopicRequest`).
// ---------------------------------------------------------------------------
export interface AddCustomTopicRequest {
  name: string;
  prompt: string;
  voteType: VoteType;
  // Optional; null or omitted means "no description". The server does not
  // trim it, so the screen sends the trimmed text or null.
  firstSessionDescription?: string | null;
}

// Deliberately omits firstSessionDescription (and the annotation fields):
// TOPIC-003 does not echo the description, so the screen refetches
// TOPIC-002 after a 201 rather than building a row from this body.
export interface AddCustomTopicResponse {
  topicId: string;
  name: string;
  prompt: string;
  voteType: VoteType;
  displayOrder: number;
  isDefault: false;
  createdAt: string;
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
  // topic-annotation design.md Decision 8: true for a standing facilitator,
  // false for an application_admin (TOPIC-007 is facilitator-only, FR-8.7).
  // Presentation only -- TOPIC-007 enforces independently.
  canEditAnnotations: boolean;
  // topic-add-form-and-empty-state design.md Decision 1: true for a standing
  // facilitator TOPIC-002 admits, false for an application_admin. The false
  // value for administrators is TEMPORARY, pending #176 (TOPIC-003 rejects
  // admins today); it is not a product rule and must never be merged with
  // canEditAnnotations, whose admin exclusion (FR-8.7) is permanent.
  // Presentation only -- TOPIC-003 enforces authorization and the lock
  // independently. Does not consider isCustomizationLocked.
  canAddTopics: boolean;
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
    // topic-annotation: the team's definition ("Our team's definition") and
    // provenance of its last change. Admins receive these read-only.
    teamAnnotation: string | null;
    annotationUpdatedAt: string | null;
    annotationUpdatedBy: ArchivedByProvenance | null;
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
    // topic-annotation: carried on archived entries so the facilitator can
    // see what returns on restore (displayed read-only).
    teamAnnotation: string | null;
    annotationUpdatedAt: string | null;
    annotationUpdatedBy: ArchivedByProvenance | null;
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

// ---------------------------------------------------------------------------
// TOPIC-006 — PUT /api/v1/teams/:teamId/topics/order (reorder-topics,
// design.md Decision 2/7/8).
// ---------------------------------------------------------------------------
export interface ReorderTopicsRequest {
  orderedTopicIds: string[];
}

// Named so the Topic Management screen's 200 handler has a type to map
// against when it patches data.active in response order (design.md
// Decision 8). displayOrder is 1-based and dense (1..N) after a save that
// changes the order; on a no-op save it is the stored value, which may have
// gaps left by archives.
export interface ReorderedTopic {
  topicId: string;
  name: string;
  displayOrder: number;
}

export interface ReorderTopicsResponse {
  topics: ReorderedTopic[];
  // Creation time of the team's lobby/pre_session/active/wrap_up session, if
  // one exists. Always null for an application_admin (design.md Decision 7).
  openSessionCreatedAt: string | null;
}

// ---------------------------------------------------------------------------
// TOPIC-007 — PUT /api/v1/teams/:teamId/topics/:topicId/annotation
// (topic-annotation, design.md Decision 3/6). Facilitator-only (FR-8.7).
// ---------------------------------------------------------------------------
export interface UpdateTopicAnnotationRequest {
  // Required string. An empty value after "\r\n" -> "\n" and trim clears the
  // definition; null is rejected (422), never an alias for clear.
  annotation: string;
}

export interface UpdateTopicAnnotationResponse {
  topicId: string;
  teamAnnotation: string | null;
  annotationUpdatedAt: string | null;
  // Non-null only when both the user id and display name are present.
  annotationUpdatedBy: ArchivedByProvenance | null;
}

// ---------------------------------------------------------------------------
// TOPIC-007 annotation rules shared by client and server (topic-annotation
// design.md Decisions 3 and 10; implementation review S-2). The Topic
// Management screen's dirty / unchanged / clear comparisons and its
// character count must agree exactly with what TOPIC-007 stores, so both
// sides import these rather than each keeping its own copy. The
// character-rejection rules stay server-only (Decision 3).
// ---------------------------------------------------------------------------

// Maximum length of a normalized team definition, in UTF-16 code units
// (String.length -- the same unit as a browser <textarea maxlength>).
export const MAX_ANNOTATION_LENGTH = 500;

// "\r\n" -> "\n", then trim (interior whitespace kept). An empty result
// means "clear".
export function normalizeAnnotation(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}
