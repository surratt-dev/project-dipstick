import type { AddCustomTopicRequest, GetAllTopicsResponse, VoteType } from "@dipstick/shared";

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

export interface DuplicateMatch {
  kind: "archived" | "active";
  topicId: string;
  name: string;
}

type TopicLike = Pick<GetAllTopicsResponse["active"][number], "topicId" | "name" | "prompt">;

// trim() then toLowerCase() with no locale argument; internal whitespace is
// compared exactly as typed (design.md Decision 5). No fuzzy matching.
function normalizeForDuplicate(value: string): string {
  return value.trim().toLowerCase();
}

function firstMatch(list: readonly TopicLike[], name: string, prompt: string): TopicLike | undefined {
  return list.find(
    (topic) => normalizeForDuplicate(topic.name) === name || normalizeForDuplicate(topic.prompt) === prompt,
  );
}

/**
 * A likely duplicate among the topics the screen last loaded: a hint, not an
 * authoritative check. An archived match wins over an active one; within the
 * winning list, the first match in that list's display order is returned.
 */
export function findDuplicate(
  values: Pick<AddFormValues, "name" | "prompt">,
  active: readonly TopicLike[],
  archived: readonly TopicLike[],
): DuplicateMatch | null {
  const name = normalizeForDuplicate(values.name);
  const prompt = normalizeForDuplicate(values.prompt);
  const archivedMatch = firstMatch(archived, name, prompt);
  if (archivedMatch) return { kind: "archived", topicId: archivedMatch.topicId, name: archivedMatch.name };
  const activeMatch = firstMatch(active, name, prompt);
  if (activeMatch) return { kind: "active", topicId: activeMatch.topicId, name: activeMatch.name };
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

export type ActiveEmptyStateVariant = "locked" | "unlocked_with_archived" | "unlocked_none_archived";

/**
 * The empty active-topics state's message and structure are a pure function
 * of the lock and the archived count (topic-003-admin-authorization design.md
 * D4). The variant does not encode add permission: whether "Add custom topic"
 * renders is decided by ActiveTopicsEmptyState's `addAllowed` prop.
 */
export function activeEmptyStateVariant(
  isCustomizationLocked: boolean,
  archivedCount: number,
): ActiveEmptyStateVariant {
  if (isCustomizationLocked) return "locked";
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
