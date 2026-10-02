import type { VoteType } from "@dipstick/shared";
import {
  DESCRIPTION_MAX_LENGTH,
  NAME_MAX_LENGTH,
  PROMPT_MAX_LENGTH,
  VOTE_TYPE_LABELS,
  shouldShowCounter,
} from "../pages/addCustomTopic.js";
import type { AddFieldErrors, AddFormValues, DuplicateMatch } from "../pages/addCustomTopic.js";

// ---------------------------------------------------------------------------
// AddCustomTopicForm — topic-add-form-and-empty-state, design.md Decision 10
// (engineer review S6). Presentational and controlled: it owns no fetch, no
// interlock logic, and no focus management. The page passes the form state,
// the reason Submit is unavailable (if any), and callbacks.
//
// Copy rule (spec): nothing here may state or imply that the topic, its
// description, or a team definition will appear in a session (#175).
// Plain text only: every value is rendered as a React text node.
// ---------------------------------------------------------------------------

export const ADD_FORM_IDS = {
  name: "add-topic-name",
  prompt: "add-topic-prompt",
  voteType: "add-topic-vote-type-finger",
  firstSessionDescription: "add-topic-description",
} as const;

const VOTE_TYPE_OPTIONS: ReadonlyArray<{ value: VoteType; explanation: string }> = [
  {
    value: "finger",
    explanation:
      "Everyone shows 1 to 4 fingers, where 1 is poor and 4 is good. There's no middle option, so people have to lean one way.",
  },
  { value: "roman", explanation: "Thumbs up or thumbs down. Use it for yes-or-no questions." },
  {
    value: "modified_roman",
    explanation:
      "Thumbs up, sideways, or down. Use it for whether something is getting better, staying the same, or getting worse.",
  },
];

export type AddFormPhase = "editing" | "confirmingDiscard" | "submitting";

export interface AddCustomTopicFormProps {
  values: AddFormValues;
  phase: AddFormPhase;
  fieldErrors: AddFieldErrors;
  formError: string | null;
  duplicate: DuplicateMatch | null;
  // Why Submit (and "Add anyway") is unavailable, or null. Never set while
  // submitting: the page shows its own in-flight reason then.
  submitDisabledReason: string | null;
  onChange: <K extends keyof AddFormValues>(field: K, value: AddFormValues[K]) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onDiscard: () => void;
  onKeepEditing: () => void;
  onShowArchivedMatch: () => void;
  onAddAnyway: () => void;
}

const HELP_STYLE = { color: "#616161", fontSize: "0.875rem" } as const;
const ERROR_STYLE = { color: "#b71c1c", fontSize: "0.875rem" } as const;
const LABEL_STYLE = { display: "block", fontWeight: 600, marginTop: "0.75rem" } as const;
const INPUT_STYLE = { display: "block", width: "100%", maxWidth: "40rem", boxSizing: "border-box" } as const;
const ALERT_STYLE = {
  marginTop: "0.75rem",
  padding: "0.75rem 1rem",
  backgroundColor: "#fce4e4",
  border: "1px solid #e57373",
  borderRadius: "4px",
} as const;

function describedBy(...ids: Array<string | false | null | undefined>): string {
  return ids.filter((id): id is string => typeof id === "string").join(" ");
}

function Counter({ id, length, limit }: { id: string; length: number; limit: number }) {
  // Not a live region: per-keystroke announcements are noise. It is wired
  // into the field's aria-describedby while shown.
  return (
    <div id={id} data-testid={id} style={HELP_STYLE}>
      {length} / {limit}
    </div>
  );
}

export function AddCustomTopicForm({
  values,
  phase,
  fieldErrors,
  formError,
  duplicate,
  submitDisabledReason,
  onChange,
  onSubmit,
  onCancel,
  onDiscard,
  onKeepEditing,
  onShowArchivedMatch,
  onAddAnyway,
}: AddCustomTopicFormProps) {
  const submitting = phase === "submitting";
  const sendBlocked = submitting || submitDisabledReason !== null;

  const nameCounter = shouldShowCounter(values.name.length, NAME_MAX_LENGTH);
  const promptCounter = shouldShowCounter(values.prompt.length, PROMPT_MAX_LENGTH);
  const descriptionCounter = shouldShowCounter(values.description.length, DESCRIPTION_MAX_LENGTH);

  return (
    <form
      data-testid="add-topic-form"
      aria-labelledby="add-topic-form-heading"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!sendBlocked && phase === "editing") onSubmit();
      }}
      style={{
        marginTop: "0.75rem",
        marginBottom: "1rem",
        padding: "1rem",
        border: "1px solid #e0e0e0",
        borderRadius: "4px",
      }}
    >
      <h3 id="add-topic-form-heading" style={{ marginTop: 0 }}>
        Add custom topic
      </h3>

      {/* Name */}
      <label htmlFor={ADD_FORM_IDS.name} style={LABEL_STYLE}>
        Name <span style={HELP_STYLE}>(required)</span>
      </label>
      <input
        id={ADD_FORM_IDS.name}
        data-testid={ADD_FORM_IDS.name}
        type="text"
        aria-required="true"
        aria-invalid={fieldErrors.name ? "true" : undefined}
        aria-describedby={describedBy(
          "add-topic-name-help",
          nameCounter && "add-topic-name-counter",
          fieldErrors.name && "add-topic-name-error",
        )}
        maxLength={NAME_MAX_LENGTH}
        value={values.name}
        readOnly={submitting}
        onChange={(event) => onChange("name", event.target.value)}
        style={INPUT_STYLE}
      />
      <div id="add-topic-name-help" style={HELP_STYLE}>
        A short label for this screen and trend views.
      </div>
      {nameCounter && <Counter id="add-topic-name-counter" length={values.name.length} limit={NAME_MAX_LENGTH} />}
      {fieldErrors.name && (
        <div id="add-topic-name-error" data-testid="add-topic-name-error" style={ERROR_STYLE}>
          {fieldErrors.name}
        </div>
      )}

      {/* Prompt */}
      <label htmlFor={ADD_FORM_IDS.prompt} style={LABEL_STYLE}>
        Prompt <span style={HELP_STYLE}>(required)</span>
      </label>
      <textarea
        id={ADD_FORM_IDS.prompt}
        data-testid={ADD_FORM_IDS.prompt}
        rows={2}
        aria-required="true"
        aria-invalid={fieldErrors.prompt ? "true" : undefined}
        aria-describedby={describedBy(
          "add-topic-prompt-help",
          promptCounter && "add-topic-prompt-counter",
          fieldErrors.prompt && "add-topic-prompt-error",
        )}
        maxLength={PROMPT_MAX_LENGTH}
        value={values.prompt}
        readOnly={submitting}
        onChange={(event) => onChange("prompt", event.target.value)}
        style={INPUT_STYLE}
      />
      <div id="add-topic-prompt-help" style={HELP_STYLE}>
        The question you&apos;ll read aloud for people to vote on.
      </div>
      {promptCounter && (
        <Counter id="add-topic-prompt-counter" length={values.prompt.length} limit={PROMPT_MAX_LENGTH} />
      )}
      {fieldErrors.prompt && (
        <div id="add-topic-prompt-error" data-testid="add-topic-prompt-error" style={ERROR_STYLE}>
          {fieldErrors.prompt}
        </div>
      )}

      {/* Vote type: a radio group with no default. */}
      <fieldset
        data-testid="add-topic-vote-type"
        aria-describedby={describedBy("add-topic-vote-type-help", fieldErrors.voteType && "add-topic-vote-type-error")}
        style={{ border: "none", padding: 0, margin: "0.75rem 0 0" }}
      >
        <legend style={{ fontWeight: 600, padding: 0 }}>
          Vote type <span style={HELP_STYLE}>(required)</span>
        </legend>
        <div id="add-topic-vote-type-help" style={HELP_STYLE}>
          You can&apos;t change the vote type after the topic is created. Changing it later means removing this
          topic and adding a new one, which starts a new trend.
        </div>
        {VOTE_TYPE_OPTIONS.map(({ value, explanation }) => {
          const inputId = `add-topic-vote-type-${value}`;
          return (
            <div key={value} style={{ marginTop: "0.5rem" }}>
              <input
                type="radio"
                id={inputId}
                data-testid={inputId}
                name="add-topic-vote-type"
                value={value}
                checked={values.voteType === value}
                // Radios cannot be read-only; disabled is their equivalent
                // while the request is in flight.
                disabled={submitting}
                aria-describedby={`${inputId}-explanation`}
                onChange={() => onChange("voteType", value)}
              />{" "}
              <label htmlFor={inputId} style={{ fontWeight: 600 }}>
                {VOTE_TYPE_LABELS[value]}
              </label>
              <div id={`${inputId}-explanation`} style={{ ...HELP_STYLE, marginLeft: "1.5rem" }}>
                {explanation}
              </div>
            </div>
          );
        })}
        {fieldErrors.voteType && (
          <div id="add-topic-vote-type-error" data-testid="add-topic-vote-type-error" style={ERROR_STYLE}>
            {fieldErrors.voteType}
          </div>
        )}
      </fieldset>

      {/* Description */}
      <label htmlFor={ADD_FORM_IDS.firstSessionDescription} style={LABEL_STYLE}>
        Description (optional, shown on this screen only)
      </label>
      <textarea
        id={ADD_FORM_IDS.firstSessionDescription}
        data-testid={ADD_FORM_IDS.firstSessionDescription}
        rows={3}
        aria-invalid={fieldErrors.firstSessionDescription ? "true" : undefined}
        aria-describedby={describedBy(
          "add-topic-description-help",
          descriptionCounter && "add-topic-description-counter",
          fieldErrors.firstSessionDescription && "add-topic-description-error",
        )}
        maxLength={DESCRIPTION_MAX_LENGTH}
        value={values.description}
        readOnly={submitting}
        onChange={(event) => onChange("description", event.target.value)}
        style={INPUT_STYLE}
      />
      <div id="add-topic-description-help" style={HELP_STYLE}>
        Engineers won&apos;t see this during sessions. Use it as a note for whoever facilitates this team. A team
        definition is the place to explain what this topic means for this team.
      </div>
      {descriptionCounter && (
        <Counter
          id="add-topic-description-counter"
          length={values.description.length}
          limit={DESCRIPTION_MAX_LENGTH}
        />
      )}
      {fieldErrors.firstSessionDescription && (
        <div id="add-topic-description-error" data-testid="add-topic-description-error" style={ERROR_STYLE}>
          {fieldErrors.firstSessionDescription}
        </div>
      )}

      {duplicate && (
        <div
          role="alert"
          data-testid="add-duplicate-warning"
          style={{ ...ALERT_STYLE, backgroundColor: "#fff8e1", border: "1px solid #ffe082" }}
        >
          {duplicate.kind === "archived" ? (
            <>
              <p style={{ marginTop: 0 }}>
                This team has an archived topic called &apos;{duplicate.name}&apos;. Restoring it keeps its history in
                one trend.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                <button type="button" onClick={onShowArchivedMatch} data-testid="add-duplicate-show-archived">
                  Show it in Archived topics
                </button>
                <button
                  type="button"
                  onClick={onAddAnyway}
                  disabled={sendBlocked}
                  title={submitDisabledReason ?? undefined}
                  data-testid="add-duplicate-add-anyway"
                >
                  Add as a new topic anyway
                </button>
              </div>
            </>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>
                This team already has an active topic called &apos;{duplicate.name}&apos;. Two topics with the same
                name or question can confuse people during the vote.
              </p>
              <button
                type="button"
                onClick={onAddAnyway}
                disabled={sendBlocked}
                title={submitDisabledReason ?? undefined}
                data-testid="add-duplicate-add-anyway"
              >
                Add anyway
              </button>
            </>
          )}
        </div>
      )}

      {formError && (
        <div role="alert" data-testid="add-form-error" style={ALERT_STYLE}>
          {formError}
        </div>
      )}

      {phase === "confirmingDiscard" ? (
        <div
          role="group"
          aria-labelledby="add-topic-discard-confirm"
          data-testid="add-topic-discard-confirm"
          style={{ ...ALERT_STYLE, backgroundColor: "#fff8e1", border: "1px solid #ffe082" }}
        >
          <p id="add-topic-discard-confirm" style={{ marginTop: 0 }}>
            Discard this topic?
          </p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="button" onClick={onDiscard} data-testid="add-topic-discard">
              Discard
            </button>
            <button type="button" onClick={onKeepEditing} data-testid="add-topic-keep-editing">
              Keep editing
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
            <button
              type="submit"
              disabled={sendBlocked}
              title={submitDisabledReason ?? undefined}
              data-testid="add-topic-submit"
            >
              {submitting ? "Adding…" : "Submit"}
            </button>
            <button
              type="button"
              id="add-topic-cancel"
              onClick={onCancel}
              disabled={submitting}
              data-testid="add-topic-cancel"
            >
              Cancel
            </button>
          </div>
          {!submitting && submitDisabledReason && (
            <p data-testid="add-topic-submit-reason" style={{ ...HELP_STYLE, marginBottom: 0 }}>
              {submitDisabledReason}
            </p>
          )}
        </>
      )}
    </form>
  );
}
