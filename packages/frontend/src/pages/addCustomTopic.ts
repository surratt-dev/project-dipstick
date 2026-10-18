import type { AddCustomTopicRequest, GetAllTopicsResponse, TopicConflictError, VoteType } from "@dipstick/shared";
import {
  TOPIC_CUSTOMIZATION_LOCKED_CODE,
  TOPIC_NAME_ACTIVE_CODE,
  findActiveNameConflict,
  normalizeTopicNameForMatch,
} from "@dipstick/shared";

// ---------------------------------------------------------------------------
// addCustomTopic — topic-add-form-and-empty-state, design.md Decisions 4, 5,
// 7 and 10 (engineer review S6). Pure, React-free logic for the Topic
// Management screen's add form and its empty active-topics state, following
// the topicOrder.ts precedent so the rules are table-testable on their own.
// ---------------------------------------------------------------------------

export type AddFormField = keyof AddCustomTopicRequest;

export interface AddFormValues {
  name: string;
  prompt: string;
  // No default: a preselected Finger is how a team ends up with a scale it
  // never chose (design.md Decision 5).
  voteType: VoteType | null;
  description: string;
}

export const EMPTY_ADD_FORM_VALUES: AddFormValues = { name: "", prompt: "", voteType: null, description: "" };

export type AddFieldErrors = Partial<Record<AddFormField, string>>;

// Form order; the first failing field in this order receives focus.
export const ADD_FORM_FIELD_ORDER: readonly AddFormField[] = ["name", "prompt", "voteType", "firstSessionDescription"];

export const NAME_MAX_LENGTH = 100;
export const PROMPT_MAX_LENGTH = 500;
export const DESCRIPTION_MAX_LENGTH = 500;

// Client-side required-field messages (spec "Submitting validates required
// fields on the client before any request").
export const NAME_REQUIRED_MESSAGE = "Enter a topic name.";
export const PROMPT_REQUIRED_MESSAGE = "Enter a prompt.";
export const VOTE_TYPE_REQUIRED_MESSAGE = "Choose a vote type.";

// Client-owned copy for a server 422 (design.md Decision 5, engineer review
// S3). The validator's error.message is API-contract text and is never shown.
export const SERVER_FIELD_MESSAGES: Record<AddFormField, string> = {
  name: "Enter a topic name of up to 100 characters.",
  prompt: "Enter a prompt of up to 500 characters.",
  voteType: "Choose a vote type.",
  firstSessionDescription: "Keep the description to 500 characters or fewer.",
};
export const SERVER_UNKNOWN_FIELD_MESSAGE = "The topic couldn't be added. Check each field and try again.";

/** Dirty = name, prompt, or description non-empty after trimming, or a vote type selected (Decision 4). */
export function isAddFormDirty(values: AddFormValues): boolean {
  return (
    values.name.trim() !== "" ||
    values.prompt.trim() !== "" ||
    values.description.trim() !== "" ||
    values.voteType !== null
  );
}

/** Required-field validation. Returns an empty object when the form may be submitted. */
export function validateAddForm(values: AddFormValues): AddFieldErrors {
  const errors: AddFieldErrors = {};
  if (values.name.trim() === "") errors.name = NAME_REQUIRED_MESSAGE;
  if (values.prompt.trim() === "") errors.prompt = PROMPT_REQUIRED_MESSAGE;
  if (values.voteType === null) errors.voteType = VOTE_TYPE_REQUIRED_MESSAGE;
  return errors;
}

/** The first field, in form order, that has an error. */
export function firstErrorField(errors: AddFieldErrors): AddFormField | null {
  return ADD_FORM_FIELD_ORDER.find((field) => errors[field] !== undefined) ?? null;
}

// #299: a non-blocking warning offered before the request. The active-name
// match is NOT one of these: it blocks (see DuplicateFindings.activeName).
export interface DuplicateMatch {
  kind: "archived" | "activePrompt";
  topicId: string;
  name: string;
}

export interface DuplicateFindings {
  // An ACTIVE topic with the same normalized name: blocking, governs over
  // every other finding. Decided by the shared findActiveNameConflict, the
  // same function the server runs, so hint and server cannot disagree.
  activeName?: { topicId: string; name: string };
  // An archived topic matching on name or prompt (non-blocking).
  archived?: { topicId: string; name: string };
  // An active topic matching on prompt only (non-blocking).
  activePromptOnly?: { topicId: string; name: string };
}

type TopicLike = Pick<GetAllTopicsResponse["active"][number], "topicId" | "name" | "prompt">;

// trim() then toLowerCase() with no locale argument; internal whitespace is
// compared exactly as typed (design.md Decision 5). No fuzzy matching. The
// name rule is the shared normalizer; prompts use it too (same rule).
const normalizeForDuplicate = normalizeTopicNameForMatch;

function firstMatch(list: readonly TopicLike[], name: string, prompt: string): TopicLike | undefined {
  return list.find(
    (topic) => normalizeForDuplicate(topic.name) === name || normalizeForDuplicate(topic.prompt) === prompt,
  );
}

/**
 * Likely duplicates among the topics the screen last loaded: a hint, the
 * server being the authority. Within each list the first match in that
 * list's display order is returned. Callers apply the precedence: activeName
 * blocks and governs; otherwise archived is shown before activePromptOnly.
 */
export function findDuplicate(
  values: Pick<AddFormValues, "name" | "prompt">,
  active: readonly TopicLike[],
  archived: readonly TopicLike[],
): DuplicateFindings {
  const name = normalizeForDuplicate(values.name);
  const prompt = normalizeForDuplicate(values.prompt);
  const findings: DuplicateFindings = {};

  // The lists arrive in display order, so the index stands in for displayOrder.
  const conflict = findActiveNameConflict(
    active.map((topic, index) => ({ id: topic.topicId, name: topic.name, displayOrder: index + 1 })),
    values.name,
  );
  if (conflict) findings.activeName = { topicId: conflict.id, name: conflict.name };

  const archivedMatch = firstMatch(archived, name, prompt);
  if (archivedMatch) findings.archived = { topicId: archivedMatch.topicId, name: archivedMatch.name };

  const promptMatch = active.find((topic) => normalizeForDuplicate(topic.prompt) === prompt);
  if (promptMatch && !conflict) findings.activePromptOnly = { topicId: promptMatch.topicId, name: promptMatch.name };

  return findings;
}

// #299 copy. The phrase is shared by the Add blocking message and the
// restore-row message and is NOT in the locked-team message (tests assert it
// by phrase, case-insensitively). A blank stored name reads "a topic with no
// name" in place of the quoted name. Stored names are rendered as React text
// nodes only.
export const ACTIVE_NAME_PHRASE = "an active topic with this name already exists";
const NO_NAME = "a topic with no name";

function quotedStoredName(storedName: string): string {
  return storedName.trim() === "" ? NO_NAME : `"${storedName}"`;
}

export function addNameBlockedMessage(storedName: string): string {
  return `An active topic with this name already exists: ${quotedStoredName(storedName)}. Choose a different name, or use the existing topic.`;
}

export function restoreNameActiveMessage(storedName: string): string {
  return `Not restored. An active topic with this name already exists: ${quotedStoredName(storedName)}. Nothing was changed. Archive the active topic first if you want to restore this one.`;
}

// Submit's own disabled reason while an active-name block stands (the inline
// message at the Name field is always visible; this is the button's reason).
export const ADD_NAME_BLOCKED_SUBMIT_REASON = "Change the name first: the team already has an active topic with it.";

/**
 * Reads a 409 body as one of the two coded conflicts, or null (unknown code,
 * wrong shape). Callers switch on `code` with a `never` default and never
 * branch on a bare 409.
 */
export function parseTopicConflict(body: unknown): TopicConflictError | null {
  const error = (body as { error?: Record<string, unknown> } | null)?.error;
  if (typeof error !== "object" || error === null) return null;
  const { code, message, correlationId } = error;
  if (code === TOPIC_CUSTOMIZATION_LOCKED_CODE) {
    return {
      category: "precondition_failed",
      code,
      message: typeof message === "string" ? message : "",
      correlationId: typeof correlationId === "string" ? correlationId : "",
    };
  }
  if (code === TOPIC_NAME_ACTIVE_CODE) {
    const { conflictingTopicId, conflictingName } = error;
    if (typeof conflictingTopicId !== "string" || typeof conflictingName !== "string") return null;
    return {
      category: "precondition_failed",
      code,
      message: typeof message === "string" ? message : "",
      correlationId: typeof correlationId === "string" ? correlationId : "",
      conflictingTopicId,
      conflictingName,
    };
  }
  return null;
}

/**
 * The POST body: name and prompt trimmed; the description trimmed and sent as
 * null when empty (the server does not trim it). Call only after
 * validateAddForm has passed.
 */
export function buildAddTopicRequest(values: AddFormValues): AddCustomTopicRequest {
  if (values.voteType === null) {
    throw new Error("buildAddTopicRequest called without a vote type");
  }
  const description = values.description.trim();
  return {
    name: values.name.trim(),
    prompt: values.prompt.trim(),
    voteType: values.voteType,
    firstSessionDescription: description === "" ? null : description,
  };
}

/**
 * Maps a server 422's error.field to the screen's own message. A known field
 * lands on that field; anything else is a fixed form-level message.
 */
export function fieldErrorForServerField(
  field: unknown,
): { field: AddFormField; message: string } | { field: null; message: string } {
  if (typeof field === "string" && (ADD_FORM_FIELD_ORDER as readonly string[]).includes(field)) {
    const known = field as AddFormField;
    return { field: known, message: SERVER_FIELD_MESSAGES[known] };
  }
  return { field: null, message: SERVER_UNKNOWN_FIELD_MESSAGE };
}

// zero-topic-team-recovery (#200): the locked team splits in two. "locked" is
// the viewer who must ask someone else (the original variant); "locked_assign"
// is the application admin, who can assign the default topics here.
export type ActiveEmptyStateVariant =
  | "locked"
  | "locked_assign"
  | "unlocked_with_archived"
  // bulk-restore-default-topics (#218): an unlocked empty team that has at
  // least one archived default the shared planner would restore. Restore is
  // the primary action.
  | "unlocked_restorable"
  | "unlocked_none_archived";

/**
 * The empty active-topics state's message and structure are a pure function
 * of the lock, the archived count and the server's canAssignDefaults flag
 * (topic-003-admin-authorization design.md D4; #200 design.md D7). This is
 * the single place that decides. The flag is read with `=== true`, so a
 * missing value (a frontend deployed ahead of its backend) fails closed to
 * the ask-an-administrator variant, and it matters only on a locked team:
 * an unlocked team keeps its Add / Show archived variants even for an admin.
 * The variant does not encode add permission: whether "Add custom topic"
 * renders is decided by ActiveTopicsEmptyState's `addAllowed` prop.
 */
export function activeEmptyStateVariant(
  isCustomizationLocked: boolean,
  archivedCount: number,
  canAssignDefaults?: boolean,
  canBulkRestore?: boolean,
): ActiveEmptyStateVariant {
  if (isCustomizationLocked) return canAssignDefaults === true ? "locked_assign" : "locked";
  if (canBulkRestore === true) return "unlocked_restorable";
  return archivedCount > 0 ? "unlocked_with_archived" : "unlocked_none_archived";
}

/** A counter is shown once a field's length reaches 80% of its limit. */
export function shouldShowCounter(length: number, limit: number): boolean {
  return length >= limit * 0.8;
}

// Display labels for each vote type, shared by the active rows and the add
// form's radio group.
// Record<VoteType, …> (architect implementation review N6): a new vote type
// is a compile error here until it has a label. Readers of server data keep
// a `?? voteType` fallback for values outside the shared union.
export const VOTE_TYPE_LABELS: Readonly<Record<VoteType, string>> = {
  finger: "Finger Voting",
  roman: "Roman Voting",
  modified_roman: "Modified Roman Voting",
};
