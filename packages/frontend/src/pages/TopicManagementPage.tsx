import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import type {
  GetAllTopicsResponse,
  ArchiveTopicResponse,
  ArchiveTopicConfirmationRequired,
  RestoreTopicResponse,
  ReorderTopicsResponse,
} from "@dipstick/shared";
import { arraysEqual, moveDown, moveToBottom, moveToTop, moveUp } from "./topicOrder.js";

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

const ORDER_COPY = "Order changes apply to sessions created after you save. Sessions already created keep their order.";
const LOCKED_BY_DRAFT_REASON = "Save or discard your order changes first.";
const STALE_MESSAGE = "The topic list was changed elsewhere since you opened this page.";
const SAVE_FALLBACK_ERROR = "Unable to save the topic order.";
const RELOAD_ERROR = "Unable to reload topics.";

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

  // reorder-topics (design.md Decision 8): the saved order is derived from
  // data.active, never stored separately; draftOrder === null means clean.
  const [draftOrder, setDraftOrder] = useState<string[] | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveConfirmation, setSaveConfirmation] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [moveAnnouncement, setMoveAnnouncement] = useState("");
  const moveButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<{ topicId: string; action: MoveAction } | null>(null);

  const savedOrder = useMemo(() => (data ? data.active.map((topic) => topic.topicId) : []), [data]);
  const displayedOrder = draftOrder ?? savedOrder;
  const isDirty = draftOrder !== null && !arraysEqual(draftOrder, savedOrder);

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

  const moveTopic = useCallback(
    (topicId: string, action: MoveAction) => {
      if (!data) return;
      const current = draftOrder ?? savedOrder;
      const index = current.indexOf(topicId);
      const next = MOVE_FUNCTIONS[action](current, index);
      if (next === current) return;

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
      pendingFocus.current = { topicId, action };
    },
    [data, draftOrder, savedOrder],
  );

  // Task 6.10: React moves keyed rows with insertBefore, which blurs the
  // focused button, so focus is restored explicitly after every move.
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    for (const action of FOCUS_FALLBACKS[pending.action]) {
      const button = moveButtonRefs.current.get(`${pending.topicId}:${action}`);
      if (button && !button.disabled) {
        button.focus();
        return;
      }
    }
  });

  // Task 7.1: close/refresh with an unsaved draft gets the browser's native
  // prompt. In-app navigation is deliberately not intercepted (design.md
  // Decision 8): it discards the draft.
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  // Task 6.8: the stale-recovery refetch. Unlike loadTopics(), a failure
  // here never calls setError (which would replace the whole screen); the
  // page stays stale with the draft shown and Reload still available.
  const reloadAfterStale = useCallback(async () => {
    if (!teamId) return;
    try {
      const res = await fetch(`/api/v1/teams/${teamId}/topics/all`, { credentials: "include" });
      if (!res.ok) {
        setSaveError(RELOAD_ERROR);
        return;
      }
      const json = (await res.json()) as GetAllTopicsResponse;
      setData(json);
      setDraftOrder(null);
      setSaveState("idle");
      setSaveError(null);
    } catch {
      setSaveError(RELOAD_ERROR);
    }
  }, [teamId]);

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
        setSaveState("error");
        setSaveError(body?.error?.message ?? SAVE_FALLBACK_ERROR);
        return;
      }

      const body = (await res.json()) as ReorderTopicsResponse;

      // Rebuild data.active in the response's order with its displayOrder
      // patched in. No refetch: that would cost a round trip and bring back
      // loadTopics()'s full-page error path.
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
          ? `Order saved. The session created on ${SAVED_DATE_FORMAT.format(
              new Date(body.openSessionCreatedAt),
            )} keeps its original order.`
          : "Order saved.",
      );
    } catch {
      setSaveState("error");
      setSaveError(SAVE_FALLBACK_ERROR);
    }
  }, [teamId, draftOrder]);

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
  const movesDisabled = isTopicDialogOpen || isSaving || isStale;
  // Task 6.7(a): Remove and Restore are disabled while the draft is dirty or
  // saving. This is what keeps their post-success loadTopics() refetch from
  // overwriting an unsaved draft -- do not remove it as a simplification.
  const topicActionsLockedByDraft = isDirty || isSaving;

  const activeById = new Map(data.active.map((topic) => [topic.topicId, topic]));
  const displayedTopics = displayedOrder.flatMap((topicId) => {
    const topic = activeById.get(topicId);
    return topic ? [topic] : [];
  });

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
        {reorderEnabled && (
          <p data-testid="reorder-order-copy" style={{ color: "#616161" }}>
            {ORDER_COPY}
          </p>
        )}
        {topicActionsLockedByDraft && (
          <p data-testid="reorder-locked-reason" style={{ color: "#616161" }}>
            {LOCKED_BY_DRAFT_REASON}
          </p>
        )}
        {data.active.length === 0 ? (
          <p data-testid="active-topics-empty">No active topics.</p>
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
                <div style={{ fontWeight: "bold" }}>
                  {/* Position is the row's place in the displayed list, never
                      topic.displayOrder: archives leave gaps in stored values. */}
                  {reorderEnabled && (
                    <span data-testid={`topic-position-${topic.topicId}`} style={{ marginRight: "0.5rem" }}>
                      {index + 1}.
                    </span>
                  )}
                  {topic.name}
                </div>
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

                {reorderEnabled && (
                  <div
                    role="group"
                    aria-label={`Reorder ${topic.name}`}
                    style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}
                  >
                    {MOVE_ACTIONS.map(({ action, label }) => {
                      const atBoundary =
                        action === "top" || action === "up" ? index === 0 : index === displayedTopics.length - 1;
                      const refKey = `${topic.topicId}:${action}`;
                      return (
                        <button
                          key={action}
                          ref={(element) => {
                            if (element) moveButtonRefs.current.set(refKey, element);
                            else moveButtonRefs.current.delete(refKey);
                          }}
                          onClick={() => moveTopic(topic.topicId, action)}
                          disabled={atBoundary || movesDisabled}
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
                      disabled={topicActionsLockedByDraft}
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
                disabled={!isDirty || isTopicDialogOpen || isSaving || isStale}
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
                    <button
                      onClick={() => startRestore(topic)}
                      disabled={topicActionsLockedByDraft}
                      data-testid={`restore-topic-${topic.topicId}`}
                    >
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
