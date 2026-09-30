import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import type {
  GetAllTopicsResponse,
  ArchiveTopicResponse,
  ArchiveTopicConfirmationRequired,
  RestoreTopicResponse,
} from "@dipstick/shared";

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
// ---------------------------------------------------------------------------

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

const VOTE_TYPE_LABELS: Record<string, string> = {
  finger: "Finger Voting",
  roman: "Roman Voting",
  modified_roman: "Modified Roman Voting",
};

function isArchiveConfirmationRequired(
  body: ArchiveTopicResponse | ArchiveTopicConfirmationRequired,
): body is ArchiveTopicConfirmationRequired {
  return "requiresConfirmation" in body && body.requiresConfirmation === true;
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

export function TopicManagementPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const [data, setData] = useState<GetAllTopicsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [removeState, setRemoveState] = useState<RemoveTopicState>({ status: "idle" });
  const [restoreState, setRestoreState] = useState<RestoreTopicState>({ status: "idle" });

  const loadTopics = useCallback(async () => {
    if (!teamId) return;
    setError(null);
    try {
      const res = await fetch(`/api/v1/teams/${teamId}/topics/all`, {
        credentials: "include",
      });
      if (res.status === 403) {
        setError("You do not have access to this team's topic management.");
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

  const startRemove = useCallback((topic: ActiveTopic) => {
    setRemoveState({ status: "confirming", topic });
  }, []);

  const cancelRemove = useCallback(() => {
    setRemoveState({ status: "idle" });
  }, []);

  const submitArchive = useCallback(
    async (topic: ActiveTopic, confirm: boolean) => {
      if (!teamId) return;
      setRemoveState({ status: "submitting", topic });

      try {
        const url = `/api/v1/teams/${teamId}/topics/${topic.topicId}${confirm ? "?confirm=true" : ""}`;
        const res = await fetch(url, { method: "DELETE", credentials: "include" });

        if (res.status === 409) {
          const body = (await res.json()) as { error?: { code?: string; message?: string } };
          if (body.error?.code === "TOPIC_LAST_ACTIVE") {
            // Task 9.4: a specific, clear message — not a generic error banner.
            setRemoveState({
              status: "blocked_last_active",
              topicId: topic.topicId,
              message:
                "This is the team's last active topic. At least one active topic must remain — add or restore another topic before removing this one.",
            });
            return;
          }
          setRemoveState({
            status: "error",
            topicId: topic.topicId,
            message: body.error?.message ?? "Unable to archive this topic.",
          });
          return;
        }

        if (!res.ok) {
          setRemoveState({
            status: "error",
            topicId: topic.topicId,
            message: "Unable to archive this topic.",
          });
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

        // Success — close the dialog and refresh the list (Task 9.3(c)).
        setRemoveState({ status: "idle" });
        await loadTopics();
      } catch {
        setRemoveState({
          status: "error",
          topicId: topic.topicId,
          message: "Network error while archiving.",
        });
      }
    },
    [teamId, loadTopics],
  );

  const startRestore = useCallback((topic: ArchivedTopic) => {
    setRestoreState({ status: "confirming", topic });
  }, []);

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
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          setRestoreState({
            status: "error",
            topicId: topic.topicId,
            message: body?.error?.message ?? "Unable to restore this topic.",
          });
          return;
        }

        (await res.json()) as RestoreTopicResponse;

        // Success — close the dialog and refresh the list (Task 6.3): the
        // restored topic disappears from archived[] and appears in
        // active[] on the next fetch.
        setRestoreState({ status: "idle" });
        await loadTopics();
      } catch {
        setRestoreState({
          status: "error",
          topicId: topic.topicId,
          message: "Network error while restoring.",
        });
      }
    },
    [teamId, loadTopics],
  );

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

  return (
    <div
      data-testid="topic-management-view"
      style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}
    >
      <nav style={{ marginBottom: "1rem", fontSize: "0.875rem" }}>
        <Link to={`/team/${teamId}`} data-testid="back-to-team-page">
          ← {data.teamName || "Team"}
        </Link>
      </nav>

      <h1 data-testid="topic-management-heading">Topic Management</h1>

      {data.isCustomizationLocked && (
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
          shown read-only below.
        </p>
      )}

      <section aria-labelledby="active-topics-heading">
        <h2 id="active-topics-heading">Active Topics</h2>
        {data.active.length === 0 ? (
          <p data-testid="active-topics-empty">No active topics.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {data.active.map((topic) => (
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
                <div style={{ fontWeight: "bold" }}>{topic.name}</div>
                <div data-testid={`topic-prompt-${topic.topicId}`}>{topic.prompt}</div>
                <div data-testid={`topic-vote-type-${topic.topicId}`} style={{ color: "#616161" }}>
                  {VOTE_TYPE_LABELS[topic.voteType] ?? topic.voteType}
                </div>
                {topic.firstSessionDescription && (
                  <div
                    data-testid={`topic-description-${topic.topicId}`}
                    style={{ color: "#616161", fontSize: "0.875rem", marginTop: "0.25rem" }}
                  >
                    {topic.firstSessionDescription}
                  </div>
                )}

                {!data.isCustomizationLocked && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <button
                      onClick={() => startRemove(topic)}
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
                    teamName={data.teamName || "this team"}
                    onCancel={cancelRemove}
                    onConfirm={(t) => void submitArchive(t, false)}
                    onConfirmAnyway={(t) => void submitArchive(t, true)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="archived-topics-heading" style={{ marginTop: "2rem" }}>
        <h2 id="archived-topics-heading">
          <button
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
                  <div style={{ fontWeight: "bold" }}>{topic.name}</div>
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

                  <div style={{ marginTop: "0.5rem" }}>
                    <button onClick={() => startRestore(topic)} data-testid={`restore-topic-${topic.topicId}`}>
                      Restore
                    </button>
                  </div>

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
                      teamName={data.teamName || "this team"}
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
