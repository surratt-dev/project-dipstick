import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useParams, Link } from "react-router-dom";
import { MAX_ANNOTATION_LENGTH, normalizeAnnotation } from "@dipstick/shared";
import type {
  AddCustomTopicResponse,
  GetAllTopicsResponse,
  ArchiveTopicResponse,
  ArchiveTopicConfirmationRequired,
  RestoreTopicResponse,
  ReorderTopicsResponse,
  UpdateTopicAnnotationResponse,
} from "@dipstick/shared";
import { arraysEqual, moveDown, moveToBottom, moveToTop, moveUp } from "./topicOrder.js";
import { isTopicWritePause, topicWriteErrorMessage } from "./topicWriteRateLimit.js";
import {
  EMPTY_ADD_FORM_VALUES,
  VOTE_TYPE_LABELS,
  activeEmptyStateVariant,
  buildAddTopicRequest,
  fieldErrorForServerField,
  findDuplicate,
  firstErrorField,
  isAddFormDirty,
  validateAddForm,
} from "./addCustomTopic.js";
import type { AddFieldErrors, AddFormValues, DuplicateMatch } from "./addCustomTopic.js";
import { ADD_FORM_IDS, AddCustomTopicForm } from "../components/AddCustomTopicForm.js";
import type { AddFormPhase } from "../components/AddCustomTopicForm.js";
import { ActiveTopicsEmptyState, EMPTY_STATE_ADD_BUTTON_ID } from "../components/ActiveTopicsEmptyState.js";

// ---------------------------------------------------------------------------
// TopicManagementPage — remove-topic, design.md Decision 10, tasks.md
// Section 9. Extended by re-add-removed-topic, design.md Decision 5, tasks.md
// Section 6.
//
// A minimal, calm screen: the active topic list with a "Remove" action per
// row (Task 9.2), a single confirmation dialog that escalates in place when
// the topic has open action items rather than opening a second dialog
// (Task 9.3, following MemberManagement.tsx's existing two-step
// confirm/re-submit pattern — no new shared Modal/ConfirmDialog component),
// a specific message for the last-active-topic hard block (Task 9.4), and
// the archived-topics view with facilitator-visible provenance (Task 9.5),
// now extended with a "Restore" action and a single-step confirmation
// dialog (re-add-removed-topic Task 6.1-6.3) reusing this same local-state,
// no-shared-Modal pattern.
//
// Extended by reorder-topics, design.md Decision 8, tasks.md Sections 6-7:
// position numbers and Move to top / up / down / to bottom buttons on each
// active row, a local draft order with a sticky Save order / Discard bar,
// stale-save recovery, and a beforeunload-only unsaved-draft guard.
//
// Extended by topic-annotation, design.md Decision 10, tasks.md Section 8:
// "Our team's definition" (the TOPIC-007 team annotation) shown on active
// and archived rows with provenance, and an inline, one-at-a-time editor on
// active rows that protects the facilitator's words: plain text, a
// clear-confirm, failed saves keep the text, and definition drafts and
// reorder drafts disable each other's destructive controls.
//
// Extended by topic-add-form-and-empty-state (design.md Decisions 1-11):
// an inline "Add custom topic" form (TOPIC-003), a "Custom" tag and h3
// headings on every row, a counted Active Topics heading, one screen-level
// message region, quiet (never full-screen) refetches after Remove/Restore,
// and a small, honest empty active-topics state.
// ---------------------------------------------------------------------------

// template-team-not-usable (#214), specs/topic-management-screen "The
// canonical default topics are shown as a read-only reference". Chosen from
// TOPIC-002's lockReason only, never from the team id. The template's stored
// team name (__default_topics__) is never displayed: these replace it
// wherever the screen would show the team's name.
export const CANONICAL_DEFAULTS_TITLE = "Default topics";
export const CANONICAL_DEFAULTS_NOTICE =
  "These are the canonical default topics every new team starts from. They can't be edited here.";

type ActiveTopic = GetAllTopicsResponse["active"][number];
type ArchivedTopic = GetAllTopicsResponse["archived"][number];

type RemoveTopicState =
  | { status: "idle" }
  | { status: "confirming"; topic: ActiveTopic }
  | { status: "submitting"; topic: ActiveTopic }
  | {
      status: "awaiting_open_items_confirmation";
      topic: ActiveTopic;
      openActionItemCount: number;
      openActionItems: Array<{ actionItemId: string; description: string }>;
      message: string;
      // harden-topic-write-endpoints (#184) task 6.5: a 429/503 on the
      // ?confirm=true call keeps this escalated confirmation open, with its
      // list, and shows the message here instead of dropping to "error".
      error?: string;
    }
  | { status: "blocked_last_active"; topicId: string; message: string }
  | { status: "error"; topicId: string; message: string };

// Task 6.2 (design.md Decision 5): a single-step confirmation — no
// escalation branch exists in this direction, since restoring only ever
// increases the active count.
type RestoreTopicState =
  | { status: "idle" }
  | { status: "confirming"; topic: ArchivedTopic }
  | { status: "submitting"; topic: ArchivedTopic }
  | { status: "error"; topicId: string; message: string };

type MoveAction = "top" | "up" | "down" | "bottom";

type SaveState = "idle" | "saving" | "stale" | "error";

const MOVE_ACTIONS: ReadonlyArray<{ action: MoveAction; label: string }> = [
  { action: "top", label: "Move to top" },
  { action: "up", label: "Move up" },
  { action: "down", label: "Move down" },
  { action: "bottom", label: "Move to bottom" },
];

const MOVE_FUNCTIONS: Record<MoveAction, (ids: readonly string[], index: number) => string[]> = {
  top: moveToTop,
  up: moveUp,
  down: moveDown,
  bottom: moveToBottom,
};

// Focus fallback when the pressed button is now disabled at a boundary:
// the same button first, then the nearest enabled one in the row.
const FOCUS_FALLBACKS: Record<MoveAction, MoveAction[]> = {
  top: ["top", "up", "down", "bottom"],
  up: ["up", "top", "down", "bottom"],
  down: ["down", "bottom", "up", "top"],
  bottom: ["bottom", "down", "up", "top"],
};

// topic-add-form-and-empty-state design.md Decision 8: every post-render
// focus target is found by element id. Ids are built from topicId, never
// from a topic name, and are only ever passed to document.getElementById
// (no selector is built, so no CSS escaping is needed).
const ACTIVE_HEADING_ID = "active-topics-heading";
const ARCHIVED_TOGGLE_ID = "archived-topics-toggle";
const ADD_TRIGGER_ID = "add-topic-trigger";
const moveButtonId = (topicId: string, action: MoveAction) => `move-${action}-${topicId}`;
const activeRowHeadingId = (topicId: string) => `topic-heading-${topicId}`;
const archivedRowHeadingId = (topicId: string) => `archived-topic-heading-${topicId}`;

// session-topics-snapshot-at-creation (#175): a session's order is fixed at
// room open, so the copy speaks of sessions being opened, not created.
const ORDER_COPY = "Order changes apply to sessions opened after you save. Sessions already open keep their order.";
const LOCKED_BY_DRAFT_REASON = "Save or discard your order changes first.";
const STALE_MESSAGE = "The topic list was changed elsewhere since you opened this page.";
const SAVE_FALLBACK_ERROR = "Unable to save the topic order.";
const RELOAD_ERROR = "Unable to reload topics.";

// topic-annotation (design.md Decision 10). "annotation" is a code/API word
// only; every user-facing string says "Our team's definition".
const DEFINITION_LABEL = "Our team's definition";
const DEFINITION_HELP =
  "What this topic means for this team, in the team's words. Not for notes about people or how to vote.";
const DEFINITION_LIMIT_REACHED = `${MAX_ANNOTATION_LENGTH} character limit reached.`;
const DEFINITION_BLOCKED = "Save or cancel this definition first.";
// topic-annotation implementation review S-1: why Edit is unavailable while
// a Remove/Restore dialog is open.
const DEFINITION_DIALOG_OPEN_REASON = "Finish or cancel the open remove or restore first.";
const DEFINITION_LOCKS_ACTIONS_REASON = "Save or cancel your definition changes first.";
const DEFINITION_CLEAR_CONFIRM = "Remove this team's definition? This can't be undone.";
const DEFINITION_SAVED = "Saved. Sessions that already exist keep the previous definition.";
const DEFINITION_SAVE_FALLBACK_ERROR = "Unable to save the team's definition.";

// topic-add-form-and-empty-state design.md Decision 3: the one reason every
// control disabled by an in-flight add carries. It takes precedence over
// every other reason on those controls.
const ADD_TOPIC_SUBMITTING_REASON = "Wait for the new topic to finish saving.";
// Design.md Decision 6 outcome copy. No outcome mentions sessions (#175).
const ADD_RETRY_MESSAGE = "The topic couldn't be added. Try again.";
const ADD_LOCKED_MESSAGE = "Topics can't be added to this team right now.";
const ADD_LOCKED_REFETCH_FAILED_MESSAGE =
  "Topics can't be added to this team right now. Reload the page to see the current state.";
const addedMessage = (name: string) =>
  `Added '${name}' to the end of the list. Use the move buttons to change where it falls.`;
const addedOnlyTopicMessage = (name: string) => `Added '${name}'.`;
const addedRefetchFailedMessage = (name: string) =>
  `Added '${name}', but the list couldn't be refreshed. Reload the page to see it.`;
const archivedRefetchFailedMessage = (name: string) =>
  `Archived '${name}', but the list couldn't be refreshed. Reload the page to see it.`;
const restoredRefetchFailedMessage = (name: string) =>
  `Restored '${name}', but the list couldn't be refreshed. Reload the page to see it.`;

// Design.md Decision 11: a quiet TOPIC-002 refetch either applies, failed,
// or was superseded by a later-issued one. Superseded is NOT failed: the
// caller applies nothing and reports nothing.
type RefetchOutcome =
  | { status: "ok"; data: GetAllTopicsResponse }
  | { status: "failed" }
  | { status: "superseded" };

// Design.md Decision 6/11: one screen-level message region under the Active
// Topics heading. At most one message; a new one replaces the previous.
type ScreenMessage = { kind: "status" | "alert"; text: string } | null;

// Design.md Decision 4: one local union, so only one add form can exist.
type AddFormOpener = "heading" | "emptyState";
type AddFormState = {
  opener: AddFormOpener;
  phase: AddFormPhase;
  values: AddFormValues;
  fieldErrors: AddFieldErrors;
  formError: string | null;
  duplicate: DuplicateMatch | null;
  // Set once "Add anyway" / "Add as a new topic anyway" is chosen; cleared
  // when Name or Prompt is edited, so a retry does not re-ask.
  duplicateOverride: boolean;
} | null;

type ErrorEnvelope = { error?: { code?: unknown; field?: unknown; message?: unknown } };

function hasEnvelopeMessage(body: unknown): body is { error: { code?: unknown; field?: unknown; message: string } } {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as ErrorEnvelope).error === "object" &&
    (body as ErrorEnvelope).error !== null &&
    typeof (body as ErrorEnvelope).error?.message === "string"
  );
}

// normalizeAnnotation / MAX_ANNOTATION_LENGTH come from @dipstick/shared --
// the same definitions TOPIC-007 uses -- so every dirty / unchanged / clear
// comparison and the character count agree with the server by construction
// (implementation review S-2).

type AnnotationEditorState = {
  topicId: string;
  draft: string;
  phase: "editing" | "confirmingClear" | "saving";
  error?: string;
  // Shown when another row's editor was requested while this one is dirty.
  blocked?: boolean;
  // Set after 404 TOPIC_NOT_FOUND / 422 TOPIC_ALREADY_ARCHIVED: the row is
  // no longer active on the server, so closing this editor re-fetches.
  refetchOnClose?: boolean;
} | null;

const SAVED_DATE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

const ALERT_STYLE = {
  marginTop: "0.75rem",
  padding: "0.75rem 1rem",
  backgroundColor: "#fce4e4",
  border: "1px solid #e57373",
  borderRadius: "4px",
} as const;

const VISUALLY_HIDDEN = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

function isArchiveConfirmationRequired(
  body: ArchiveTopicResponse | ArchiveTopicConfirmationRequired,
): body is ArchiveTopicConfirmationRequired {
  return "requiresConfirmation" in body && body.requiresConfirmation === true;
}

// topic-add-form-and-empty-state design.md Decision 8: a text tag inside the
// row heading, so "Custom" is part of the accessible name and is not
// conveyed by colour alone. Unconditional on lock state.
function CustomTag({ topicId }: { topicId: string }) {
  return (
    <span
      data-testid={`custom-tag-${topicId}`}
      style={{
        marginLeft: "0.5rem",
        padding: "0 0.375rem",
        fontSize: "0.75rem",
        fontWeight: 600,
        border: "1px solid #9e9e9e",
        borderRadius: "4px",
        color: "#424242",
      }}
    >
      {" "}
      Custom
    </span>
  );
}

interface TeamDefinitionProps {
  topicId: string;
  teamAnnotation: string | null;
  annotationUpdatedAt: string | null;
  annotationUpdatedBy: { userId: string; displayName: string } | null;
}

// Task 8.1: the saved definition and its muted provenance line, shared by
// active and (read-only) archived rows. Plain text only: React text nodes
// with pre-wrap, never dangerouslySetInnerHTML.
function TeamDefinition({ topicId, teamAnnotation, annotationUpdatedAt, annotationUpdatedBy }: TeamDefinitionProps) {
  if (teamAnnotation === null) return null;
  return (
    <div data-testid={`team-definition-${topicId}`} style={{ marginTop: "0.5rem" }}>
      <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>{DEFINITION_LABEL}</div>
      <div data-testid={`team-definition-text-${topicId}`} style={{ whiteSpace: "pre-wrap" }}>
        {teamAnnotation}
      </div>
      {annotationUpdatedAt && (
        <div
          data-testid={`team-definition-provenance-${topicId}`}
          style={{ color: "#616161", fontSize: "0.875rem" }}
        >
          Last edited {SAVED_DATE_FORMAT.format(new Date(annotationUpdatedAt))}
          {annotationUpdatedBy ? ` by ${annotationUpdatedBy.displayName}` : ""}
        </div>
      )}
    </div>
  );
}

interface DefinitionEditorProps {
  topicId: string;
  editor: NonNullable<AnnotationEditorState>;
  inputRef: MutableRefObject<HTMLTextAreaElement | null>;
  onChange: (draft: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onConfirmClear: () => void;
  onCancelClear: () => void;
}

// Tasks 8.3/8.4: the inline editor. maxLength stays (BA B5): the server
// limit can never be reached from the UI, and reaching the field's limit is
// shown and announced instead of being silent.
function DefinitionEditor({
  topicId,
  editor,
  inputRef,
  onChange,
  onSave,
  onCancel,
  onConfirmClear,
  onCancelClear,
}: DefinitionEditorProps) {
  const inputId = `definition-input-${topicId}`;
  const helpId = `definition-help-${topicId}`;
  const isSaving = editor.phase === "saving";
  // The counter shows the server's unit on the normalized value; the
  // limit-reached signal keys on the RAW length, which is what maxLength
  // enforces (trailing whitespace can hide it from the counter).
  const count = normalizeAnnotation(editor.draft).length;
  const limitReached = editor.draft.length >= MAX_ANNOTATION_LENGTH;

  return (
    <div data-testid={`definition-editor-${topicId}`} style={{ marginTop: "0.5rem" }}>
      <label htmlFor={inputId} style={{ display: "block", fontSize: "0.875rem", fontWeight: 600 }}>
        {DEFINITION_LABEL}
      </label>
      <textarea
        id={inputId}
        ref={inputRef}
        data-testid={inputId}
        aria-describedby={helpId}
        maxLength={MAX_ANNOTATION_LENGTH}
        rows={4}
        value={editor.draft}
        readOnly={isSaving}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !isSaving) {
            event.preventDefault();
            onCancel();
          }
        }}
        style={{ display: "block", width: "100%", maxWidth: "40rem", boxSizing: "border-box" }}
      />
      <div id={helpId} data-testid={`definition-help-${topicId}`} style={{ color: "#616161", fontSize: "0.875rem" }}>
        {DEFINITION_HELP}
      </div>
      <div
        data-testid={`definition-counter-${topicId}`}
        data-limit-reached={limitReached ? "true" : "false"}
        style={{
          fontSize: "0.875rem",
          color: limitReached ? "#b71c1c" : "#616161",
          fontWeight: limitReached ? 600 : 400,
        }}
      >
        {count} / {MAX_ANNOTATION_LENGTH}
      </div>
      <div aria-live="polite" data-testid={`definition-limit-${topicId}`} style={{ fontSize: "0.875rem", color: "#b71c1c" }}>
        {limitReached ? DEFINITION_LIMIT_REACHED : ""}
      </div>

      {editor.blocked && (
        <div role="alert" data-testid={`definition-blocked-${topicId}`} style={ALERT_STYLE}>
          {DEFINITION_BLOCKED}
        </div>
      )}

      {editor.error && (
        <div role="alert" data-testid={`definition-error-${topicId}`} style={ALERT_STYLE}>
          {editor.error}
        </div>
      )}

      {editor.phase === "confirmingClear" ? (
        <div
          role="group"
          aria-labelledby={`definition-clear-confirm-${topicId}`}
          data-testid={`definition-clear-confirm-${topicId}`}
          style={{ marginTop: "0.5rem", padding: "0.75rem 1rem", backgroundColor: "#fff8e1", border: "1px solid #ffe082", borderRadius: "4px" }}
        >
          <p id={`definition-clear-confirm-${topicId}`} style={{ marginTop: 0 }}>
            {DEFINITION_CLEAR_CONFIRM}
          </p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={onConfirmClear} data-testid={`definition-clear-remove-${topicId}`}>
              Remove
            </button>
            <button onClick={onCancelClear} data-testid={`definition-clear-cancel-${topicId}`}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
          <button onClick={onSave} disabled={isSaving} data-testid={`definition-save-${topicId}`}>
            {isSaving ? "Saving…" : "Save"}
          </button>
          <button onClick={onCancel} disabled={isSaving} data-testid={`definition-cancel-${topicId}`}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

interface RemoveTopicDialogProps {
  state: Extract<
    RemoveTopicState,
    { status: "confirming" | "submitting" | "awaiting_open_items_confirmation" }
  >;
  teamName: string;
  onCancel: () => void;
  onConfirm: (topic: ActiveTopic) => void;
  onConfirmAnyway: (topic: ActiveTopic) => void;
}

// Task 9.3: one dialog whose content is replaced in place, not a second
// dialog appended below (design.md Decision 10 / Priya's review).
function RemoveTopicDialog({ state, teamName, onCancel, onConfirm, onConfirmAnyway }: RemoveTopicDialogProps) {
  const topic = state.topic;
  const isSubmitting = state.status === "submitting";

  return (
    <div
      role="alertdialog"
      aria-labelledby="remove-topic-dialog-heading"
      data-testid="remove-topic-dialog"
      style={{
        marginTop: "1rem",
        padding: "1rem",
        backgroundColor: "#fff8e1",
        border: "1px solid #ffe082",
        borderRadius: "4px",
      }}
    >
      {state.status !== "awaiting_open_items_confirmation" ? (
        <>
          <p id="remove-topic-dialog-heading" data-testid="remove-topic-dialog-heading">
            Archive &ldquo;{topic.name}&rdquo; for {teamName}?
          </p>
          <p>
            This topic&apos;s historical data will be retained and stays visible in trend views.
          </p>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
            <button
              onClick={() => onConfirm(topic)}
              disabled={isSubmitting}
              data-testid={`confirm-remove-${topic.topicId}`}
            >
              {isSubmitting ? "Archiving…" : "Confirm"}
            </button>
            <button onClick={onCancel} disabled={isSubmitting} data-testid={`cancel-remove-${topic.topicId}`}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p id="remove-topic-dialog-heading" data-testid="open-action-items-warning-heading">
            {state.message}
          </p>
          {state.openActionItems.length > 0 && (
            <ul data-testid={`open-action-items-list-${topic.topicId}`}>
              {state.openActionItems.map((item) => (
                <li key={item.actionItemId}>{item.description}</li>
              ))}
            </ul>
          )}
          {state.error && (
            <div
              role="alert"
              data-testid={`open-items-confirm-error-${topic.topicId}`}
              style={{
                marginTop: "0.75rem",
                padding: "0.75rem 1rem",
                backgroundColor: "#fce4e4",
                border: "1px solid #e57373",
                borderRadius: "4px",
              }}
            >
              {state.error}
            </div>
          )}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
            <button
              onClick={() => onConfirmAnyway(topic)}
              data-testid={`confirm-archive-anyway-${topic.topicId}`}
            >
              Archive anyway
            </button>
            <button onClick={onCancel} data-testid={`cancel-remove-${topic.topicId}`}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

interface RestoreTopicDialogProps {
  state: Extract<RestoreTopicState, { status: "confirming" | "submitting" }>;
  teamName: string;
  onCancel: () => void;
  onConfirm: (topic: ArchivedTopic) => void;
}

// Task 6.3 (design.md Decision 5): a single dialog, matching
// RemoveTopicDialog's plain, one-line tone. No "gap will be visible in
// trend views" clause — the trend-gap signal is deferred to a follow-up
// change (proposal.md "Scope Decision").
function RestoreTopicDialog({ state, teamName, onCancel, onConfirm }: RestoreTopicDialogProps) {
  const topic = state.topic;
  const isSubmitting = state.status === "submitting";

  return (
    <div
      role="alertdialog"
      aria-labelledby="restore-topic-dialog-heading"
      data-testid="restore-topic-dialog"
      style={{
        marginTop: "1rem",
        padding: "1rem",
        backgroundColor: "#e8f5e9",
        border: "1px solid #a5d6a7",
        borderRadius: "4px",
      }}
    >
      <p id="restore-topic-dialog-heading" data-testid="restore-topic-dialog-heading">
        Restore &ldquo;{topic.name}&rdquo; for {teamName}? Historical data will be restored.
      </p>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
        <button
          onClick={() => onConfirm(topic)}
          disabled={isSubmitting}
          data-testid={`confirm-restore-${topic.topicId}`}
        >
          {isSubmitting ? "Restoring…" : "Confirm"}
        </button>
        <button onClick={onCancel} disabled={isSubmitting} data-testid={`cancel-restore-${topic.topicId}`}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// Mount through TopicManagementRoute (below), never unkeyed: the "a change
// of team resets all local state" guarantee depends on the teamId key
// (implementation review N2). The bare export exists only for the older
// page suites, which render a single team and never change it.
export function TopicManagementPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const [data, setData] = useState<GetAllTopicsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [removeState, setRemoveState] = useState<RemoveTopicState>({ status: "idle" });
  const [restoreState, setRestoreState] = useState<RestoreTopicState>({ status: "idle" });

  // reorder-topics (design.md Decision 8): the saved order is derived from
  // data.active, never stored separately; draftOrder === null means clean.
  const [draftOrder, setDraftOrder] = useState<string[] | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveConfirmation, setSaveConfirmation] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [moveAnnouncement, setMoveAnnouncement] = useState("");

  // topic-add-form-and-empty-state design.md Decision 8 (generalising the
  // reorder-topics move-button focus): one queue of candidate element ids,
  // resolved after render -- the first that exists and is not disabled gets
  // focus. focusTick forces that render when no other state changes.
  const pendingFocusIds = useRef<string[] | null>(null);
  const [, setFocusTick] = useState(0);
  const queueFocus = useCallback((ids: string[]) => {
    pendingFocusIds.current = ids;
    setFocusTick((tick) => tick + 1);
  }, []);

  // Design.md Decisions 6 and 11: the screen message region.
  const [screenMessage, setScreenMessage] = useState<ScreenMessage>(null);
  const clearScreenMessage = useCallback(() => setScreenMessage(null), []);

  // Design.md Decision 4: the add form.
  const [addForm, setAddForm] = useState<AddFormState>(null);
  const addDirty = addForm !== null && isAddFormDirty(addForm.values);
  const addSubmitting = addForm?.phase === "submitting";

  // Design.md Decision 11 (engineer review M1): only the latest-issued
  // quiet refetch may apply its response.
  const latestRefetchId = useRef(0);

  const savedOrder = useMemo(() => (data ? data.active.map((topic) => topic.topicId) : []), [data]);
  const displayedOrder = draftOrder ?? savedOrder;
  const isDirty = draftOrder !== null && !arraysEqual(draftOrder, savedOrder);

  // topic-annotation (design.md Decision 10): at most one definition editor
  // exists, by construction.
  const [annotationEditor, setAnnotationEditor] = useState<AnnotationEditorState>(null);
  // The row whose "Saved." message is showing. No timeout: it clears on the
  // next action on that row or the next successful definition save.
  const [annotationSavedTopicId, setAnnotationSavedTopicId] = useState<string | null>(null);
  const [annotationRefetchError, setAnnotationRefetchError] = useState<string | null>(null);
  const annotationInputRef = useRef<HTMLTextAreaElement | null>(null);

  // An editor whose row is no longer in data.active (removed, archived
  // elsewhere, or gone after a refetch) is never dirty, so it can neither
  // arm beforeunload nor disable controls with nothing on screen to save.
  const annotationEditorRow = annotationEditor
    ? (data?.active.find((topic) => topic.topicId === annotationEditor.topicId) ?? null)
    : null;
  const annotationDirty =
    annotationEditor !== null &&
    annotationEditorRow !== null &&
    normalizeAnnotation(annotationEditor.draft) !== (annotationEditorRow.teamAnnotation ?? "");
  const annotationBusy =
    annotationDirty || (annotationEditorRow !== null && annotationEditor?.phase === "saving");

  const loadTopics = useCallback(async () => {
    if (!teamId) return;
    setError(null);
    try {
      const res = await fetch(`/api/v1/teams/${teamId}/topics/all`, {
        credentials: "include",
      });
      if (res.status === 403) {
        // #232 (design.md D7): show the server's reason (e.g. the
        // member-facilitator message, FACILITATOR_IS_TEAM_MEMBER). The body
        // is parsed defensively: a non-JSON 403 (proxy/WAF page, empty body)
        // must not throw into the catch below and show the network error.
        const body: unknown = await res.json().catch(() => null);
        setError(
          hasEnvelopeMessage(body) ? body.error.message : "You do not have access to this team's topic management.",
        );
        return;
      }
      if (!res.ok) {
        setError("Failed to load topics.");
        return;
      }
      const json = (await res.json()) as GetAllTopicsResponse;
      setData(json);
    } catch {
      setError("Network error loading topics.");
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void loadTopics();
  }, [loadTopics]);

  // topic-annotation Task 8.0: a quiet TOPIC-002 fetch shared by every
  // post-write refetch on this screen (stale-order reload, definition-save
  // recovery, Remove, Restore, and Add). It never calls setError, so a
  // failure can never replace the whole screen; each caller decides what
  // else to reset.
  //
  // topic-add-form-and-empty-state design.md Decision 11: a request counter
  // makes the latest-issued refetch win. An older response that settles
  // after a newer one was issued is "superseded" -- not "failed" -- and the
  // caller applies nothing and reports nothing.
  const fetchAllTopics = useCallback(async (): Promise<RefetchOutcome> => {
    const requestId = ++latestRefetchId.current;
    const isLatest = () => requestId === latestRefetchId.current;
    if (!teamId) return { status: "failed" };
    try {
      const res = await fetch(`/api/v1/teams/${teamId}/topics/all`, { credentials: "include" });
      if (!isLatest()) return { status: "superseded" };
      if (!res.ok) return { status: "failed" };
      const json = (await res.json()) as GetAllTopicsResponse;
      if (!isLatest()) return { status: "superseded" };
      return { status: "ok", data: json };
    } catch {
      return isLatest() ? { status: "failed" } : { status: "superseded" };
    }
  }, [teamId]);

  // Quiet refetch after a 404/422 save failure, run when that editor
  // closes. A failure is reported inline and never calls setError.
  const refetchAfterAnnotationFailure = useCallback(async () => {
    const outcome = await fetchAllTopics();
    if (outcome.status === "superseded") return;
    if (outcome.status === "failed") {
      setAnnotationRefetchError(RELOAD_ERROR);
      return;
    }
    setAnnotationRefetchError(null);
    setData(outcome.data);
  }, [fetchAllTopics]);

  // Task 8.6: a clean editor closes when a Remove/Restore dialog opens or a
  // move begins (a dirty one has already disabled those controls). Like
  // every other close path, it runs the pending quiet refetch of a 404/422
  // editor (implementation review N-3).
  const closeCleanAnnotationEditor = useCallback(() => {
    if (!annotationEditor || annotationEditor.phase === "saving") return;
    if (annotationEditor.refetchOnClose) {
      void refetchAfterAnnotationFailure();
    }
    setAnnotationEditor(null);
  }, [annotationEditor, refetchAfterAnnotationFailure]);

  // Design.md Decision 2: the quiet refetch after a successful Remove or
  // Restore. "ok" applies the lists; "failed" leaves them as last loaded
  // (no local row move) and reports inline; "superseded" does neither.
  const finishAfterTopicWrite = useCallback(
    async (failureMessage: string) => {
      const outcome = await fetchAllTopics();
      if (outcome.status === "ok") {
        setData(outcome.data);
      } else if (outcome.status === "failed") {
        setScreenMessage({ kind: "alert", text: failureMessage });
      }
    },
    [fetchAllTopics],
  );

  const startRemove = useCallback(
    (topic: ActiveTopic) => {
      clearScreenMessage();
      closeCleanAnnotationEditor();
      setAnnotationSavedTopicId((current) => (current === topic.topicId ? null : current));
      setRemoveState({ status: "confirming", topic });
    },
    [closeCleanAnnotationEditor, clearScreenMessage],
  );

  const cancelRemove = useCallback(() => {
    setRemoveState({ status: "idle" });
  }, []);

  const submitArchive = useCallback(
    async (
      topic: ActiveTopic,
      confirm: boolean,
      escalation?: Extract<RemoveTopicState, { status: "awaiting_open_items_confirmation" }>,
    ) => {
      if (!teamId) return;
      setRemoveState({ status: "submitting", topic });

      try {
        const url = `/api/v1/teams/${teamId}/topics/${topic.topicId}${confirm ? "?confirm=true" : ""}`;
        const res = await fetch(url, { method: "DELETE", credentials: "include" });

        if (!res.ok) {
          // topic-add-form-and-empty-state task 2.3 (engineer review S4):
          // parse defensively and show the server's message when one parses
          // (e.g. a stale second Remove's 422 TOPIC_ALREADY_ARCHIVED).
          const body = (await res.json().catch(() => null)) as {
            error?: { code?: string; message?: string };
          } | null;
          if (res.status === 409 && body?.error?.code === "TOPIC_LAST_ACTIVE") {
            // Task 9.4: a specific, clear message — not a generic error banner.
            setRemoveState({
              status: "blocked_last_active",
              topicId: topic.topicId,
              message:
                "This is the team's last active topic. At least one active topic must remain — add or restore another topic before removing this one.",
            });
            return;
          }
          // #184 6.2: rate-limit copy for a 429 (by error.code), the
          // server's message otherwise.
          const message = topicWriteErrorMessage(res, body, "Unable to archive this topic.");
          if (confirm && escalation && isTopicWritePause(res.status, body)) {
            // #184 6.5: a pause keeps the escalated confirmation, its list
            // and its Archive anyway button. Nothing is retried.
            setRemoveState({ ...escalation, error: message });
            return;
          }
          setRemoveState({ status: "error", topicId: topic.topicId, message });
          return;
        }

        const body = (await res.json()) as ArchiveTopicResponse | ArchiveTopicConfirmationRequired;

        if (isArchiveConfirmationRequired(body)) {
          // Task 9.3(d): replace the same dialog's content in place with the
          // escalated warning — no second dialog, no navigation away.
          setRemoveState({
            status: "awaiting_open_items_confirmation",
            topic,
            openActionItemCount: body.openActionItemCount,
            openActionItems: body.openActionItems,
            message: body.message,
          });
          return;
        }

        // Success — refresh the list quietly, then close the dialog (Task
        // 9.3(c); topic-add-form-and-empty-state design.md Decision 2). The
        // dialog stays "submitting" until the refetch settles, so the
        // controls it disables stay disabled, and a refetch failure never
        // replaces the screen (an open add form or draft survives it).
        await finishAfterTopicWrite(archivedRefetchFailedMessage(topic.name));
        // Implementation review S1: Remove stays enabled on other rows while
        // this one submits, so by now the dialog may belong to a second
        // Remove whose write is still in flight. Close it only if it is
        // still this call's; otherwise that dialog (and the controls it
        // disables) would be released early.
        setRemoveState((current) =>
          current.status === "submitting" && current.topic.topicId === topic.topicId ? { status: "idle" } : current,
        );
      } catch {
        setRemoveState({
          status: "error",
          topicId: topic.topicId,
          message: "Network error while archiving.",
        });
      }
    },
    [teamId, finishAfterTopicWrite],
  );

  const startRestore = useCallback(
    (topic: ArchivedTopic) => {
      clearScreenMessage();
      closeCleanAnnotationEditor();
      setRestoreState({ status: "confirming", topic });
    },
    [closeCleanAnnotationEditor, clearScreenMessage],
  );

  const cancelRestore = useCallback(() => {
    setRestoreState({ status: "idle" });
  }, []);

  const submitRestore = useCallback(
    async (topic: ArchivedTopic) => {
      if (!teamId) return;
      setRestoreState({ status: "submitting", topic });

      try {
        const res = await fetch(`/api/v1/teams/${teamId}/topics/${topic.topicId}/restore`, {
          method: "POST",
          credentials: "include",
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
          setRestoreState({
            status: "error",
            topicId: topic.topicId,
            // #184 6.2: rate-limit copy for a 429; no refetch on this path.
            message: topicWriteErrorMessage(res, body, "Unable to restore this topic."),
          });
          return;
        }

        (await res.json()) as RestoreTopicResponse;

        // Success — refresh the list quietly, then close the dialog (Task
        // 6.3; topic-add-form-and-empty-state design.md Decision 2): the
        // restored topic disappears from archived[] and appears in
        // active[] on the next fetch.
        await finishAfterTopicWrite(restoredRefetchFailedMessage(topic.name));
        // Implementation review S1: as in submitArchive, close the dialog
        // only if it still belongs to this call.
        setRestoreState((current) =>
          current.status === "submitting" && current.topic.topicId === topic.topicId ? { status: "idle" } : current,
        );
      } catch {
        setRestoreState({
          status: "error",
          topicId: topic.topicId,
          message: "Network error while restoring.",
        });
      }
    },
    [teamId, finishAfterTopicWrite],
  );

  const moveTopic = useCallback(
    (topicId: string, action: MoveAction) => {
      if (!data) return;
      const current = draftOrder ?? savedOrder;
      const index = current.indexOf(topicId);
      const next = MOVE_FUNCTIONS[action](current, index);
      if (next === current) return;

      clearScreenMessage();
      closeCleanAnnotationEditor();
      setAnnotationSavedTopicId((saved) => (saved === topicId ? null : saved));

      // A draft that is back to the saved order is stored as clean (null),
      // so a later Remove/Restore refetch can never leave a stale draft.
      setDraftOrder(arraysEqual(next, savedOrder) ? null : next);
      setSaveConfirmation(null);
      // A failed-save message describes an attempt that is no longer
      // pending once the draft changes, so the next move clears it. Moves
      // are disabled while saving or stale, so only 'error' is reset here.
      setSaveError(null);
      setSaveState((prev) => (prev === "error" ? "idle" : prev));

      const name = data.active.find((topic) => topic.topicId === topicId)?.name ?? "Topic";
      setMoveAnnouncement(`${name} moved to position ${next.indexOf(topicId) + 1} of ${next.length}`);
      queueFocus(FOCUS_FALLBACKS[action].map((fallback) => moveButtonId(topicId, fallback)));
    },
    [data, draftOrder, savedOrder, closeCleanAnnotationEditor, clearScreenMessage, queueFocus],
  );

  // Task 6.10: React moves keyed rows with insertBefore, which blurs the
  // focused button, so focus is restored explicitly after every move.
  // topic-add-form-and-empty-state design.md Decision 8: the same mechanism
  // serves every post-render focus move. The first candidate id that exists
  // and is not disabled receives focus (move buttons fall back through the
  // row's other move buttons; outcomes fall back to the Active heading).
  useLayoutEffect(() => {
    const candidates = pendingFocusIds.current;
    if (!candidates) return;
    pendingFocusIds.current = null;
    for (const id of candidates) {
      const element = document.getElementById(id);
      if (element && !(element as HTMLButtonElement).disabled) {
        element.focus();
        return;
      }
    }
  });

  // Design.md Decision 8: shared by the duplicate warning's "Show it in
  // Archived topics" and the empty state's "Show archived topics (n)".
  const expandArchivedAndFocus = useCallback(
    (targetId: string) => {
      setShowArchived(true);
      queueFocus([targetId]);
    },
    [queueFocus],
  );

  // Task 7.1: close/refresh with an unsaved draft gets the browser's native
  // prompt. In-app navigation is deliberately not intercepted (design.md
  // Decision 8): it discards the draft.
  //
  // topic-annotation Task 8.5: unsaved definition text arms the same guard.
  // topic-add-form-and-empty-state design.md Decision 4: so does a dirty
  // add form.
  const hasUnsavedChanges = isDirty || annotationDirty || addDirty;
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);

  // Task 6.8: the stale-recovery refetch. Unlike loadTopics(), a failure
  // here never calls setError (which would replace the whole screen); the
  // page stays stale with the draft shown and Reload still available.
  const reloadAfterStale = useCallback(async () => {
    const outcome = await fetchAllTopics();
    if (outcome.status === "superseded") return;
    if (outcome.status === "failed") {
      setSaveError(RELOAD_ERROR);
      return;
    }
    setData(outcome.data);
    setDraftOrder(null);
    setSaveState("idle");
    setSaveError(null);
  }, [fetchAllTopics]);

  const discardDraft = useCallback(() => {
    // After a stale save the pre-save order no longer exists on the server,
    // so Discard goes to the server's current order instead.
    if (saveState === "stale") {
      void reloadAfterStale();
      return;
    }
    setDraftOrder(null);
    setSaveState("idle");
    setSaveError(null);
  }, [saveState, reloadAfterStale]);

  const saveOrder = useCallback(async () => {
    if (!teamId || !draftOrder) return;
    setSaveState("saving");
    setSaveConfirmation(null);
    setSaveError(null);

    try {
      const res = await fetch(`/api/v1/teams/${teamId}/topics/order`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedTopicIds: draftOrder }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
        if (res.status === 409 && body?.error?.code === "TOPIC_ORDER_STALE") {
          setSaveState("stale");
          return;
        }
        // #184 6.2: the draft stays, marked unsaved, with Save order enabled.
        setSaveState("error");
        setSaveError(topicWriteErrorMessage(res, body, SAVE_FALLBACK_ERROR));
        return;
      }

      const body = (await res.json()) as ReorderTopicsResponse;

      // Rebuild data.active in the response's order with its displayOrder
      // patched in. No refetch: the response already carries the new order,
      // so a round trip would add nothing.
      setData((prev) => {
        if (!prev) return prev;
        const rowsById = new Map(prev.active.map((topic) => [topic.topicId, topic]));
        const active = body.topics.flatMap((saved) => {
          const row = rowsById.get(saved.topicId);
          return row ? [{ ...row, displayOrder: saved.displayOrder }] : [];
        });
        return { ...prev, active };
      });
      setDraftOrder(null);
      setSaveState("idle");
      setSaveConfirmation(
        body.openSessionCreatedAt
          ? `Order saved. The session opened on ${SAVED_DATE_FORMAT.format(
              new Date(body.openSessionCreatedAt),
            )} keeps its original order.`
          : "Order saved.",
      );
    } catch {
      setSaveState("error");
      setSaveError(SAVE_FALLBACK_ERROR);
    }
  }, [teamId, draftOrder]);

  // -------------------------------------------------------------------------
  // topic-annotation Tasks 8.2-8.4 — definition editor
  // -------------------------------------------------------------------------

  // #214: the canonical defaults' tab title, restored when the screen leaves
  // that view. Other teams keep whatever title the app already shows.
  const isCanonicalDefaultsView = data?.lockReason === "canonical_defaults";
  useEffect(() => {
    if (!isCanonicalDefaultsView) return;
    const previous = document.title;
    document.title = CANONICAL_DEFAULTS_TITLE;
    return () => {
      document.title = previous;
    };
  }, [isCanonicalDefaultsView]);

  // Orphaned editor (engineer review M2): reset whenever its row has left
  // data.active. A 404/422 save failure does not trigger this -- that row
  // stays in data.active until the facilitator closes the editor.
  useEffect(() => {
    if (annotationEditor && data && !data.active.some((topic) => topic.topicId === annotationEditor.topicId)) {
      setAnnotationEditor(null);
    }
  }, [annotationEditor, data]);

  const closeAnnotationEditor = useCallback(() => {
    if (annotationEditor?.refetchOnClose) {
      void refetchAfterAnnotationFailure();
    }
    setAnnotationEditor(null);
  }, [annotationEditor, refetchAfterAnnotationFailure]);

  const openAnnotationEditor = useCallback(
    (topic: ActiveTopic) => {
      clearScreenMessage();
      if (annotationEditor && annotationEditor.topicId !== topic.topicId) {
        if (annotationBusy) {
          // Never discard unsaved words: keep the open editor, point at it.
          setAnnotationEditor({ ...annotationEditor, blocked: true });
          annotationInputRef.current?.focus();
          return;
        }
        if (annotationEditor.refetchOnClose) {
          void refetchAfterAnnotationFailure();
        }
      }
      setAnnotationSavedTopicId((current) => (current === topic.topicId ? null : current));
      setAnnotationEditor({ topicId: topic.topicId, draft: topic.teamAnnotation ?? "", phase: "editing" });
    },
    [annotationEditor, annotationBusy, refetchAfterAnnotationFailure, clearScreenMessage],
  );

  const submitAnnotation = useCallback(
    async (topicId: string, draft: string, refetchPending: boolean) => {
      if (!teamId) return;
      // A retry after a 404/422 keeps that editor's pending refetch, so a
      // later network failure cannot drop it (implementation review N-4).
      const pending = refetchPending ? { refetchOnClose: true } : {};
      setAnnotationEditor({ topicId, draft, phase: "saving", ...pending });

      try {
        const res = await fetch(`/api/v1/teams/${teamId}/topics/${topicId}/annotation`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ annotation: draft }),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
          const code = body?.error?.code;
          const rowGone =
            (res.status === 404 && code === "TOPIC_NOT_FOUND") ||
            (res.status === 422 && code === "TOPIC_ALREADY_ARCHIVED");
          // The text stays in the editor so the facilitator can copy it.
          setAnnotationEditor({
            topicId,
            draft,
            phase: "editing",
            error: topicWriteErrorMessage(res, body, DEFINITION_SAVE_FALLBACK_ERROR), // #184 6.2
            ...(rowGone || refetchPending ? { refetchOnClose: true } : {}),
          });
          return;
        }

        const body = (await res.json()) as UpdateTopicAnnotationResponse;
        // Patch the row in place -- no refetch, so every other piece of
        // local state on the screen survives the save.
        setData((prev) =>
          prev
            ? {
                ...prev,
                active: prev.active.map((topic) =>
                  topic.topicId === body.topicId
                    ? {
                        ...topic,
                        teamAnnotation: body.teamAnnotation,
                        annotationUpdatedAt: body.annotationUpdatedAt,
                        annotationUpdatedBy: body.annotationUpdatedBy,
                      }
                    : topic,
                ),
              }
            : prev,
        );
        setAnnotationEditor(null);
        setAnnotationSavedTopicId(topicId);
      } catch {
        setAnnotationEditor({ topicId, draft, phase: "editing", error: DEFINITION_SAVE_FALLBACK_ERROR, ...pending });
      }
    },
    [teamId],
  );

  const saveAnnotation = useCallback(() => {
    if (!annotationEditor || !annotationEditorRow) return;
    const normalized = normalizeAnnotation(annotationEditor.draft);
    const saved = annotationEditorRow.teamAnnotation ?? "";

    // Unchanged (an empty value equals no definition): close, send nothing,
    // show nothing.
    if (normalized === saved) {
      closeAnnotationEditor();
      return;
    }

    // Clearing an existing definition asks first. Overwriting one with
    // different text deliberately does NOT confirm (design.md Decision 10,
    // exploration D8): a routine edit should not cost an extra click, and the
    // saved text and provenance stay visible while editing. Do not add a
    // confirm here "for consistency".
    if (normalized === "") {
      setAnnotationEditor({ ...annotationEditor, phase: "confirmingClear", blocked: false });
      return;
    }

    void submitAnnotation(annotationEditor.topicId, annotationEditor.draft, annotationEditor.refetchOnClose === true);
  }, [annotationEditor, annotationEditorRow, closeAnnotationEditor, submitAnnotation]);

  if (loading) return <p>Loading topics…</p>;

  if (error) {
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <p role="alert" data-testid="topic-management-error">
          {error}
        </p>
        <Link to={`/team/${teamId ?? ""}`}>Back to team</Link>
      </div>
    );
  }

  if (!data) return null;

  const dialogState =
    removeState.status === "confirming" ||
    removeState.status === "submitting" ||
    removeState.status === "awaiting_open_items_confirmation"
      ? removeState
      : null;

  const restoreDialogState =
    restoreState.status === "confirming" || restoreState.status === "submitting" ? restoreState : null;

  // #214: the canonical default topics (the template team). Read-only, with
  // "Default topics" in place of the stored team name everywhere.
  const isCanonicalDefaults = data.lockReason === "canonical_defaults";
  const displayTeamName = isCanonicalDefaults ? CANONICAL_DEFAULTS_TITLE : data.teamName;

  const reorderEnabled = !data.isCustomizationLocked && data.active.length >= 2;
  const isSaving = saveState === "saving";
  const isStale = saveState === "stale";
  // Task 6.7(b): no draft may be started or saved while a Remove/Restore
  // dialog is open or submitting -- the post-archive/restore refetch would
  // otherwise leave a draft that references a topic no longer active.
  const isTopicDialogOpen = dialogState !== null || restoreDialogState !== null;
  // Task 6.7(c) and 6.8: every move is disabled while a save is in flight
  // (the 200 handler would overwrite it) and after a stale save (it would
  // be thrown away by Reload/Discard).
  //
  // topic-annotation Task 8.6: and while a definition is dirty or saving, so
  // no move can be made that a definition save would have to reconcile.
  //
  // topic-add-form-and-empty-state design.md Decision 3: and while an add
  // request is in flight (until its outcome's refetch settles).
  const movesDisabled = isTopicDialogOpen || isSaving || isStale || annotationBusy || addSubmitting;
  // Task 6.7(a): Remove and Restore are disabled while the draft is dirty or
  // saving. Their post-success refetch is quiet now (topic-add-form-and-
  // empty-state design.md Decision 2), but a successful refetch still
  // replaces the lists and saved order under a dirty draft, so this lock
  // still protects drafts -- do not remove it as a simplification.
  const topicActionsLockedByDraft = isDirty || isSaving;
  // topic-annotation Task 8.6 (BA B1/B2, engineer M3): the symmetric rule.
  // While a definition is dirty or saving, EVERY row's Remove and Restore is
  // disabled: a successful post-Remove/Restore refetch replaces the rows a
  // definition draft belongs to.
  const topicActionsDisabled = topicActionsLockedByDraft || annotationBusy || addSubmitting;
  // Remove/Restore's reason: an in-flight add takes precedence.
  const topicActionsReason = addSubmitting
    ? ADD_TOPIC_SUBMITTING_REASON
    : annotationBusy
      ? DEFINITION_LOCKS_ACTIONS_REASON
      : undefined;
  // Definition controls exist only on an unlocked team for a caller
  // TOPIC-007 would accept (canEditAnnotations is presentation only).
  const definitionsEditable = !data.isCustomizationLocked && data.canEditAnnotations;
  const activeById = new Map(data.active.map((topic) => [topic.topicId, topic]));
  const displayedTopics = displayedOrder.flatMap((topicId) => {
    const topic = activeById.get(topicId);
    return topic ? [topic] : [];
  });

  // -------------------------------------------------------------------------
  // topic-add-form-and-empty-state — Add Custom Topic (TOPIC-003)
  // -------------------------------------------------------------------------

  // Design.md Decision 1: `=== true`, so a missing flag (frontend-first
  // deploy) fails closed. Do not refactor to `!!` or a default.
  const canAddTopics = data.canAddTopics === true;
  const addAllowed = !data.isCustomizationLocked && canAddTopics;
  const activeEmpty = data.active.length === 0;

  // Design.md Decision 3: Submit (and "Add anyway") is gated by the other
  // busy states, first applicable reason in this order. The trigger and
  // fields stay usable meanwhile; only sending is gated.
  const addSubmitBlockedReason =
    isDirty || isSaving
      ? LOCKED_BY_DRAFT_REASON
      : annotationBusy
        ? DEFINITION_LOCKS_ACTIONS_REASON
        : isTopicDialogOpen
          ? DEFINITION_DIALOG_OPEN_REASON
          : null;

  const openerFocusIds = (opener: AddFormOpener) =>
    opener === "emptyState"
      ? [EMPTY_STATE_ADD_BUTTON_ID, ADD_TRIGGER_ID, ACTIVE_HEADING_ID]
      : [ADD_TRIGGER_ID, EMPTY_STATE_ADD_BUTTON_ID, ACTIVE_HEADING_ID];

  const openAddForm = (opener: AddFormOpener) => {
    clearScreenMessage();
    setAddForm({
      opener,
      phase: "editing",
      values: EMPTY_ADD_FORM_VALUES,
      fieldErrors: {},
      formError: null,
      duplicate: null,
      duplicateOverride: false,
    });
    queueFocus([ADD_FORM_IDS.name]);
  };

  const closeAddForm = () => {
    if (!addForm) return;
    const opener = addForm.opener;
    setAddForm(null);
    queueFocus(openerFocusIds(opener));
  };

  const changeAddField = <K extends keyof AddFormValues>(field: K, value: AddFormValues[K]) => {
    setAddForm((current) => {
      if (!current || current.phase === "submitting") return current;
      const values = { ...current.values, [field]: value };
      // Editing Name or Prompt dismisses a duplicate warning and forgets an
      // "Add anyway" override (design.md Decision 5).
      return field === "name" || field === "prompt"
        ? { ...current, values, duplicate: null, duplicateOverride: false }
        : { ...current, values };
    });
  };

  const cancelAddForm = () => {
    if (!addForm || addForm.phase === "submitting") return;
    if (addDirty) {
      setAddForm({ ...addForm, phase: "confirmingDiscard" });
      return;
    }
    closeAddForm();
  };

  // Every failure that leaves the form open restores "Submit" and editable
  // fields (design.md Decision 6).
  const returnAddFormToEditing = (patch: Partial<NonNullable<AddFormState>>) =>
    setAddForm((current) => (current ? { ...current, phase: "editing", ...patch } : current));

  // Network error, 5xx, or a body that is not the error envelope: the topic
  // may have been created, so refresh the lists quietly first, then keep the
  // form open for a retry whose duplicate check sees the refreshed lists.
  const refetchThenOfferRetry = async () => {
    const outcome = await fetchAllTopics();
    if (outcome.status === "ok") setData(outcome.data);
    returnAddFormToEditing({ formError: ADD_RETRY_MESSAGE });
  };

  const sendAddRequest = async (form: NonNullable<AddFormState>, override: boolean) => {
    if (!teamId) return;
    const payload = buildAddTopicRequest(form.values);
    const name = payload.name;
    setAddForm({
      ...form,
      phase: "submitting",
      fieldErrors: {},
      formError: null,
      duplicate: null,
      duplicateOverride: override,
    });
    // Design.md Decision 3: sending closes a clean open definition editor.
    closeCleanAnnotationEditor();

    // Design.md Decision 6 (engineer review S2): the catch that maps to
    // "Try again" wraps fetch() only.
    let res: Response;
    try {
      res = await fetch(`/api/v1/teams/${teamId}/topics`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      await refetchThenOfferRetry();
      return;
    }

    if (res.status === 201) {
      // From here every path ends in an "Added '<name>' …" message, using
      // the trimmed name that was sent: a post-commit problem must never
      // invite a retry that creates a duplicate.
      let createdId: string | null = null;
      try {
        const created = (await res.json()) as Partial<AddCustomTopicResponse> | null;
        createdId = typeof created?.topicId === "string" ? created.topicId : null;
      } catch {
        createdId = null;
      }
      const outcome = await fetchAllTopics();
      setAddForm(null);
      if (outcome.status === "ok") {
        setData(outcome.data);
        const found = createdId !== null && outcome.data.active.some((topic) => topic.topicId === createdId);
        const onlyTopic =
          outcome.data.active.length === 1 && (createdId === null || outcome.data.active[0]?.topicId === createdId);
        setScreenMessage({ kind: "status", text: onlyTopic ? addedOnlyTopicMessage(name) : addedMessage(name) });
        queueFocus(found && createdId !== null ? [activeRowHeadingId(createdId), ACTIVE_HEADING_ID] : [ACTIVE_HEADING_ID]);
      } else if (outcome.status === "failed") {
        setScreenMessage({ kind: "alert", text: addedRefetchFailedMessage(name) });
        queueFocus([ACTIVE_HEADING_ID]);
      } else {
        // Superseded (design.md Decision 11): the list that would locate
        // the new row is not this call's to read.
        setScreenMessage({ kind: "status", text: addedMessage(name) });
        queueFocus([ACTIVE_HEADING_ID]);
      }
      return;
    }

    // Security review S3.4: the server's message is shown only from a body
    // that parsed as the JSON error envelope with a string message.
    const body: unknown = await res.json().catch(() => null);
    if (hasEnvelopeMessage(body)) {
      // #184 6.2: a 429/503 from the topic-write limiter is a pause. The form
      // stays open with every field, the message goes in its error area, and
      // nothing is retried or refetched.
      if (isTopicWritePause(res.status, body)) {
        returnAddFormToEditing({ formError: topicWriteErrorMessage(res, body, body.error.message) });
        return;
      }
      if (res.status === 403 || res.status === 404) {
        returnAddFormToEditing({ formError: body.error.message });
        return;
      }
      if (res.status === 422) {
        // Engineer review S3: client-owned copy; the validator's message is
        // API-contract text and is never shown.
        const mapped = fieldErrorForServerField(body.error.field);
        if (mapped.field !== null) {
          const field = mapped.field;
          returnAddFormToEditing({ fieldErrors: { [field]: mapped.message } });
          queueFocus([ADD_FORM_IDS[field]]);
        } else {
          returnAddFormToEditing({ formError: mapped.message });
        }
        return;
      }
      if (res.status === 409 && body.error.code === "TOPIC_CUSTOMIZATION_LOCKED") {
        const outcome = await fetchAllTopics();
        setAddForm(null);
        if (outcome.status === "ok") setData(outcome.data);
        setScreenMessage({
          kind: "alert",
          text: outcome.status === "failed" ? ADD_LOCKED_REFETCH_FAILED_MESSAGE : ADD_LOCKED_MESSAGE,
        });
        queueFocus([ACTIVE_HEADING_ID]);
        return;
      }
    }
    await refetchThenOfferRetry();
  };

  // Order on Submit: required fields -> duplicate check -> request
  // (design.md Decision 5).
  const submitAddForm = (override: boolean) => {
    if (!addForm || addForm.phase !== "editing" || addSubmitBlockedReason !== null) return;
    const errors = validateAddForm(addForm.values);
    const firstFailing = firstErrorField(errors);
    if (firstFailing !== null) {
      setAddForm({ ...addForm, fieldErrors: errors, formError: null, duplicate: null });
      queueFocus([ADD_FORM_IDS[firstFailing]]);
      return;
    }
    const skipDuplicateCheck = override || addForm.duplicateOverride;
    if (!skipDuplicateCheck) {
      const duplicate = findDuplicate(addForm.values, data.active, data.archived);
      if (duplicate) {
        setAddForm({ ...addForm, fieldErrors: {}, formError: null, duplicate });
        return;
      }
    }
    void sendAddRequest(addForm, skipDuplicateCheck);
  };

  const addFormElement = addForm && (
    <AddCustomTopicForm
      values={addForm.values}
      phase={addForm.phase}
      fieldErrors={addForm.fieldErrors}
      formError={addForm.formError}
      duplicate={addForm.duplicate}
      submitDisabledReason={addForm.phase === "submitting" ? null : addSubmitBlockedReason}
      onChange={changeAddField}
      onSubmit={() => submitAddForm(false)}
      onCancel={cancelAddForm}
      onDiscard={closeAddForm}
      onKeepEditing={() => {
        setAddForm({ ...addForm, phase: "editing" });
        queueFocus(["add-topic-cancel"]);
      }}
      onShowArchivedMatch={() => {
        if (addForm.duplicate) expandArchivedAndFocus(archivedRowHeadingId(addForm.duplicate.topicId));
      }}
      onAddAnyway={() => submitAddForm(true)}
    />
  );

  return (
    <div
      data-testid="topic-management-view"
      style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}
    >
      <nav style={{ marginBottom: "1rem", fontSize: "0.875rem" }}>
        <Link to={`/team/${teamId}`} data-testid="back-to-team-page">
          ← {displayTeamName || "Team"}
        </Link>
      </nav>

      <h1 data-testid="topic-management-heading">
        {isCanonicalDefaults ? CANONICAL_DEFAULTS_TITLE : "Topic Management"}
      </h1>

      {isCanonicalDefaults && (
        <p
          data-testid="canonical-defaults-notice"
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            backgroundColor: "#f5f5f5",
            border: "1px dashed #bdbdbd",
            borderRadius: "4px",
          }}
        >
          {CANONICAL_DEFAULTS_NOTICE}
        </p>
      )}

      {data.isCustomizationLocked && !isCanonicalDefaults && (
        <p
          data-testid="customization-lock-notice"
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            backgroundColor: "#f5f5f5",
            border: "1px dashed #bdbdbd",
            borderRadius: "4px",
          }}
        >
          Topics cannot be customized until this team completes its first session. Topics are
          shown read-only below. Team definitions can be added after the team&apos;s first session.
        </p>
      )}

      <section aria-labelledby={ACTIVE_HEADING_ID}>
        {/* Design.md Decision 8: the trigger sits BESIDE the h2, never inside
            it, so the heading's accessible name stays "Active Topics (n)".
            The heading is programmatically focusable for outcome focus. */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "1rem" }}>
          <h2 id={ACTIVE_HEADING_ID} tabIndex={-1} data-testid="active-topics-heading">
            Active Topics ({data.active.length})
          </h2>
          {/* Design.md Decisions 1 and 7: shown iff unlocked AND
              canAddTopics === true, with no disabled or teaser variant;
              hidden while the form is open and while the empty state (which
              has its own entry point) is shown. */}
          {addAllowed && !activeEmpty && !addForm && (
            <button
              type="button"
              id={ADD_TRIGGER_ID}
              onClick={() => openAddForm("heading")}
              data-testid={ADD_TRIGGER_ID}
            >
              Add custom topic
            </button>
          )}
        </div>
        {/* Design.md Decisions 6 and 11: the one screen message region,
            directly under the Active Topics heading. */}
        {screenMessage && (
          <div
            role={screenMessage.kind === "status" ? "status" : "alert"}
            data-testid="screen-message"
            style={
              screenMessage.kind === "status"
                ? { ...ALERT_STYLE, backgroundColor: "#e8f5e9", border: "1px solid #a5d6a7" }
                : ALERT_STYLE
            }
          >
            {screenMessage.text}
          </div>
        )}
        {/* Design.md Decision 3 (engineer review M2): while an add is in
            flight this is the only visible disabled reason. */}
        {addSubmitting && (
          <p data-testid="add-submitting-reason" style={{ color: "#616161" }}>
            {ADD_TOPIC_SUBMITTING_REASON}
          </p>
        )}
        {!activeEmpty && addFormElement}
        {reorderEnabled && (
          <p data-testid="reorder-order-copy" style={{ color: "#616161" }}>
            {ORDER_COPY}
          </p>
        )}
        {topicActionsLockedByDraft && !addSubmitting && (
          <p data-testid="reorder-locked-reason" style={{ color: "#616161" }}>
            {LOCKED_BY_DRAFT_REASON}
          </p>
        )}
        {annotationBusy && !addSubmitting && (
          <p data-testid="definition-locked-reason" style={{ color: "#616161" }}>
            {DEFINITION_LOCKS_ACTIONS_REASON}
          </p>
        )}
        {annotationRefetchError && (
          <div role="alert" data-testid="definition-refetch-error" style={ALERT_STYLE}>
            {annotationRefetchError}
          </div>
        )}
        {activeEmpty ? (
          // Design.md Decision 7. The screen never reads
          // data.defaultTopicsNotActive (its name join is wrong when a custom
          // topic shares a default's name, and its topicId can point at the
          // template team): see #197.
          <ActiveTopicsEmptyState
            variant={activeEmptyStateVariant(data.isCustomizationLocked, data.archived.length)}
            addAllowed={addAllowed}
            archivedCount={data.archived.length}
            onShowArchived={() => expandArchivedAndFocus(ARCHIVED_TOGGLE_ID)}
            onAddTopic={() => openAddForm("emptyState")}
            form={addFormElement ?? undefined}
          />
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {displayedTopics.map((topic, index) => (
              <li
                key={topic.topicId}
                data-testid={`topic-row-${topic.topicId}`}
                style={{
                  padding: "1rem",
                  marginBottom: "0.5rem",
                  border: "1px solid #e0e0e0",
                  borderRadius: "4px",
                }}
              >
                {/* Design.md Decision 8 (engineer review S5): the row title is a
                    real, programmatically focusable h3 whose id derives from
                    topicId; the "Custom" tag is part of its accessible name. */}
                <h3
                  id={activeRowHeadingId(topic.topicId)}
                  tabIndex={-1}
                  data-testid={`topic-heading-${topic.topicId}`}
                  style={{ fontSize: "1rem", margin: 0 }}
                >
                  {/* Position is the row's place in the displayed list, never
                      topic.displayOrder: archives leave gaps in stored values. */}
                  {reorderEnabled && (
                    <span data-testid={`topic-position-${topic.topicId}`} style={{ marginRight: "0.5rem" }}>
                      {index + 1}.
                    </span>
                  )}
                  {topic.name}
                  {!topic.isDefault && <CustomTag topicId={topic.topicId} />}
                </h3>
                <div data-testid={`topic-prompt-${topic.topicId}`}>{topic.prompt}</div>
                <div data-testid={`topic-vote-type-${topic.topicId}`} style={{ color: "#616161" }}>
                  {VOTE_TYPE_LABELS[topic.voteType] ?? topic.voteType}
                </div>

                {/* topic-annotation Task 8.1: the saved definition stays
                    visible while its editor is open (design.md Decision 10). */}
                <TeamDefinition
                  topicId={topic.topicId}
                  teamAnnotation={topic.teamAnnotation}
                  annotationUpdatedAt={topic.annotationUpdatedAt}
                  annotationUpdatedBy={topic.annotationUpdatedBy}
                />
                {definitionsEditable &&
                  (annotationEditor?.topicId === topic.topicId ? (
                    <DefinitionEditor
                      topicId={topic.topicId}
                      editor={annotationEditor}
                      inputRef={annotationInputRef}
                      onChange={(draft) =>
                        setAnnotationEditor((current) =>
                          current && current.topicId === topic.topicId
                            ? { ...current, draft, blocked: false }
                            : current,
                        )
                      }
                      onSave={saveAnnotation}
                      onCancel={closeAnnotationEditor}
                      onConfirmClear={() =>
                        void submitAnnotation(
                          topic.topicId,
                          annotationEditor.draft,
                          annotationEditor.refetchOnClose === true,
                        )
                      }
                      onCancelClear={() =>
                        setAnnotationEditor((current) => (current ? { ...current, phase: "editing" } : current))
                      }
                    />
                  ) : (
                    <div style={{ marginTop: "0.5rem" }}>
                      <button
                        onClick={() => openAnnotationEditor(topic)}
                        // Also unavailable while a Remove/Restore dialog is
                        // open (design.md Decision 10): that dialog's Confirm
                        // triggers a refetch that replaces the rows a draft
                        // opened behind it belongs to. And while an add is in
                        // flight, whose reason takes precedence.
                        disabled={topicActionsLockedByDraft || isTopicDialogOpen || addSubmitting}
                        title={
                          addSubmitting
                            ? ADD_TOPIC_SUBMITTING_REASON
                            : topicActionsLockedByDraft
                              ? LOCKED_BY_DRAFT_REASON
                              : isTopicDialogOpen
                                ? DEFINITION_DIALOG_OPEN_REASON
                                : undefined
                        }
                        data-testid={`edit-definition-${topic.topicId}`}
                      >
                        {topic.teamAnnotation === null ? "Add team definition" : "Edit"}
                      </button>
                    </div>
                  ))}
                {/* Mounted (empty) while this row's editor is open, so the
                    "Saved." text lands in an existing live region. */}
                {definitionsEditable &&
                  (annotationEditor?.topicId === topic.topicId || annotationSavedTopicId === topic.topicId) && (
                  <div role="status" data-testid={`definition-saved-${topic.topicId}`}>
                    {annotationSavedTopicId === topic.topicId ? DEFINITION_SAVED : ""}
                  </div>
                )}

                {/* Design.md Decision 5: an empty or whitespace-only stored
                    description is not rendered. */}
                {topic.firstSessionDescription && topic.firstSessionDescription.trim() !== "" && (
                  <div
                    data-testid={`topic-description-${topic.topicId}`}
                    style={{ color: "#616161", fontSize: "0.875rem", marginTop: "0.25rem" }}
                  >
                    {topic.firstSessionDescription}
                  </div>
                )}

                {reorderEnabled && (
                  <div
                    role="group"
                    aria-label={`Reorder ${topic.name}`}
                    style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}
                  >
                    {MOVE_ACTIONS.map(({ action, label }) => {
                      const atBoundary =
                        action === "top" || action === "up" ? index === 0 : index === displayedTopics.length - 1;
                      return (
                        <button
                          key={action}
                          id={moveButtonId(topic.topicId, action)}
                          onClick={() => moveTopic(topic.topicId, action)}
                          disabled={atBoundary || movesDisabled}
                          title={addSubmitting ? ADD_TOPIC_SUBMITTING_REASON : undefined}
                          aria-label={`${label}: ${topic.name}`}
                          data-testid={`move-${action}-${topic.topicId}`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}

                {!data.isCustomizationLocked && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <button
                      onClick={() => startRemove(topic)}
                      disabled={topicActionsDisabled}
                      title={topicActionsReason}
                      data-testid={`remove-topic-${topic.topicId}`}
                    >
                      Remove
                    </button>
                  </div>
                )}

                {removeState.status === "blocked_last_active" &&
                  removeState.topicId === topic.topicId && (
                    <div
                      role="alert"
                      data-testid={`last-active-blocked-${topic.topicId}`}
                      style={{
                        marginTop: "0.75rem",
                        padding: "0.75rem 1rem",
                        backgroundColor: "#fce4e4",
                        border: "1px solid #e57373",
                        borderRadius: "4px",
                      }}
                    >
                      {removeState.message}
                    </div>
                  )}

                {removeState.status === "error" && removeState.topicId === topic.topicId && (
                  <div
                    role="alert"
                    data-testid={`remove-error-${topic.topicId}`}
                    style={{
                      marginTop: "0.75rem",
                      padding: "0.75rem 1rem",
                      backgroundColor: "#fce4e4",
                      border: "1px solid #e57373",
                      borderRadius: "4px",
                    }}
                  >
                    {removeState.message}
                  </div>
                )}

                {dialogState && dialogState.topic.topicId === topic.topicId && (
                  <RemoveTopicDialog
                    state={dialogState}
                    teamName={displayTeamName || "this team"}
                    onCancel={cancelRemove}
                    onConfirm={(t) => void submitArchive(t, false)}
                    onConfirmAnyway={(t) =>
                      void submitArchive(
                        t,
                        true,
                        dialogState.status === "awaiting_open_items_confirmation" ? dialogState : undefined,
                      )
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Task 6.5: while dirty the bar is sticky to the bottom of the
            viewport (the window scrolls; no ancestor sets overflow), so Save
            stays reachable at the last row at tablet width. While clean it
            sits below the list with Save disabled. */}
        {reorderEnabled && (
          <div
            data-testid="reorder-save-bar"
            style={{
              position: isDirty ? "sticky" : "static",
              bottom: 0,
              padding: "0.75rem 1rem",
              backgroundColor: "#ffffff",
              borderTop: "1px solid #e0e0e0",
              boxShadow: isDirty ? "0 -2px 4px rgba(0, 0, 0, 0.08)" : "none",
            }}
          >
            {isStale && (
              <p role="alert" data-testid="reorder-stale-message" style={{ marginTop: 0 }}>
                {STALE_MESSAGE}
              </p>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              <button
                onClick={() => void saveOrder()}
                disabled={!isDirty || isTopicDialogOpen || isSaving || isStale || addSubmitting}
                title={addSubmitting ? ADD_TOPIC_SUBMITTING_REASON : undefined}
                data-testid="reorder-save"
              >
                {isSaving ? "Saving…" : "Save order"}
              </button>
              <button
                onClick={discardDraft}
                disabled={!isDirty || isTopicDialogOpen || isSaving}
                data-testid="reorder-discard"
              >
                Discard
              </button>
              {isStale && (
                <button onClick={() => void reloadAfterStale()} data-testid="reorder-reload">
                  Reload
                </button>
              )}
            </div>
            {saveError && (
              <div role="alert" data-testid="reorder-save-error" style={ALERT_STYLE}>
                {saveError}
              </div>
            )}
          </div>
        )}

        {reorderEnabled && (
          <div role="status" data-testid="reorder-save-confirmation" style={{ marginTop: "0.5rem" }}>
            {saveConfirmation}
          </div>
        )}

        {/* Task 6.10: mounted with the screen, before any move, so the first
            announcement is not lost. */}
        <div aria-live="polite" data-testid="reorder-announcement" style={VISUALLY_HIDDEN}>
          {moveAnnouncement}
        </div>
      </section>

      <section aria-labelledby="archived-topics-heading" style={{ marginTop: "2rem" }}>
        <h2 id="archived-topics-heading">
          <button
            id={ARCHIVED_TOGGLE_ID}
            onClick={() => setShowArchived((shown) => !shown)}
            data-testid="toggle-archived-topics"
            style={{ fontSize: "1rem", fontWeight: "bold" }}
          >
            Archived Topics ({data.archived.length}) {showArchived ? "▲" : "▼"}
          </button>
        </h2>

        {showArchived &&
          (data.archived.length === 0 ? (
            <p data-testid="archived-topics-empty">No archived topics.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {data.archived.map((topic) => (
                <li
                  key={topic.topicId}
                  data-testid={`archived-topic-row-${topic.topicId}`}
                  style={{
                    padding: "1rem",
                    marginBottom: "0.5rem",
                    border: "1px solid #e0e0e0",
                    borderRadius: "4px",
                    color: "#616161",
                  }}
                >
                  <h3
                    id={archivedRowHeadingId(topic.topicId)}
                    tabIndex={-1}
                    data-testid={`archived-topic-heading-${topic.topicId}`}
                    style={{ fontSize: "1rem", margin: 0 }}
                  >
                    {topic.name}
                    {!topic.isDefault && <CustomTag topicId={topic.topicId} />}
                  </h3>
                  {/* topic-annotation Task 8.1 (BA B3): read-only, so the
                      facilitator can see what returns on restore. */}
                  <TeamDefinition
                    topicId={topic.topicId}
                    teamAnnotation={topic.teamAnnotation}
                    annotationUpdatedAt={topic.annotationUpdatedAt}
                    annotationUpdatedBy={topic.annotationUpdatedBy}
                  />
                  {/* Task 9.5/Decision 6: facilitator-visible provenance — who
                      archived this topic and when, right here on the screen. */}
                  <div data-testid={`archived-provenance-${topic.topicId}`}>
                    Archived {new Date(topic.archivedAt).toLocaleString()}
                    {topic.archivedBy ? ` by ${topic.archivedBy.displayName}` : ""}
                  </div>
                  {/* Task 6.1b/Decision 4: a second provenance line, present
                      only when this topic has previously been restored. */}
                  {topic.restoredAt && (
                    <div data-testid={`restored-provenance-${topic.topicId}`}>
                      Restored {new Date(topic.restoredAt).toLocaleString()}
                      {topic.restoredBy ? ` by ${topic.restoredBy.displayName}` : ""}
                    </div>
                  )}

                  {/* #214: the canonical defaults offer no write control. */}
                  {!isCanonicalDefaults && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <button
                        onClick={() => startRestore(topic)}
                        disabled={topicActionsDisabled}
                        title={topicActionsReason}
                        data-testid={`restore-topic-${topic.topicId}`}
                      >
                        Restore
                      </button>
                    </div>
                  )}

                  {restoreState.status === "error" && restoreState.topicId === topic.topicId && (
                    <div
                      role="alert"
                      data-testid={`restore-error-${topic.topicId}`}
                      style={{
                        marginTop: "0.75rem",
                        padding: "0.75rem 1rem",
                        backgroundColor: "#fce4e4",
                        border: "1px solid #e57373",
                        borderRadius: "4px",
                      }}
                    >
                      {restoreState.message}
                    </div>
                  )}

                  {restoreDialogState && restoreDialogState.topic.topicId === topic.topicId && (
                    <RestoreTopicDialog
                      state={restoreDialogState}
                      teamName={displayTeamName || "this team"}
                      onCancel={cancelRestore}
                      onConfirm={(t) => void submitRestore(t)}
                    />
                  )}
                </li>
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}

// topic-add-form-and-empty-state design.md Decision 11 (engineer review M3):
// the route renders the page keyed on teamId, so a change of team discards
// every piece of local state (an open add form and its values, a reorder
// draft, an open definition editor) instead of carrying it to the new team,
// where an add form's values could otherwise be POSTed.
export function TopicManagementRoute() {
  const { teamId } = useParams<{ teamId: string }>();
  return <TopicManagementPage key={teamId} />;
}
