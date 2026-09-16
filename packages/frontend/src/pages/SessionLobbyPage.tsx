import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type {
  ActionItemsReviewResponse,
  ActionItemsReviewWrongStatusResponse,
  WsClientMessage,
} from "@dipstick/shared";
import { useAuth } from "../auth/AuthContext.js";
import { SignOutButton } from "../components/SignOutButton.js";
import { PreSessionActionItemReview } from "../components/PreSessionActionItemReview.js";
import { useConnectionHealth } from "../realtime/connectionHealth.js";
import { buildSessionWebSocketUrl } from "./SessionConnectionHost.js";

// ---------------------------------------------------------------------------
// SessionLobbyPage — pre-session-action-item-review, tasks.md Section 4
//
// Branches entirely off GET /api/v1/sessions/:sessionId/action-items-review
// (design.md Decision 3) — no separate status call:
//   200                                  -> "pre_session" (render the review)
//   409, currentSessionStatus: "lobby"   -> "lobby" (waiting message + Start
//                                           Session, facilitator-only)
//   409, any other currentSessionStatus  -> "left" (session has moved past
//                                           the phase this screen covers —
//                                           see design.md's Non-Goals on not
//                                           building a full lobby->active
//                                           routing story)
//   404                                  -> "no-access"
//   network/5xx failure                  -> "error" (inline retry)
//
// The WebSocket subscription to session_state_change (useConnectionHealth,
// the sole connection-health implementation — see connectionHealth.ts) is
// established in the same render pass as the initial fetch below, not after
// it (design review engineer finding #4 / design.md Risks) — closing the
// window where a transition committed between this page's initial fetch and
// its subscription going live would otherwise strand a participant on a
// stale branch until manual refresh.
//
// Access model statement (Decision 8, task 7.1, enforce-access-control-on-
// team-content): required in the session lobby "and" the team view — this
// page keeps rendering it, unconditionally, in every branch except
// no-access/error, where the participant was never actually in the room.
// ---------------------------------------------------------------------------

type ReviewBranch =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "no-access" }
  | { kind: "left" }
  | { kind: "lobby"; isFacilitator: boolean }
  | { kind: "pre_session"; data: ActionItemsReviewResponse };

const ACCESS_MODEL_STATEMENT =
  "Your Engineering Manager can see session history but cannot join or observe live sessions.";

function isSessionStateChangeMessage(
  message: WsClientMessage,
): message is Extract<WsClientMessage, { eventType: "session_state_change" }> {
  return message.eventType === "session_state_change";
}

export function SessionLobbyPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { session } = useAuth();

  const [branch, setBranch] = useState<ReviewBranch>({ kind: "loading" });
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [beginVotingPending, setBeginVotingPending] = useState(false);
  const [beginVotingError, setBeginVotingError] = useState<string | null>(null);

  const fetchReview = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/action-items-review`, {
        credentials: "include",
      });

      if (res.status === 200) {
        const data = (await res.json()) as ActionItemsReviewResponse;
        setBranch({ kind: "pre_session", data });
        return;
      }

      if (res.status === 409) {
        const body = (await res.json()) as ActionItemsReviewWrongStatusResponse;
        if (body.currentSessionStatus === "lobby") {
          setBranch({ kind: "lobby", isFacilitator: body.isFacilitator });
        } else {
          setBranch({ kind: "left" });
        }
        return;
      }

      if (res.status === 404) {
        setBranch({ kind: "no-access" });
        return;
      }

      // Any other status (network-adjacent 5xx etc.) — task 4.3's error state.
      setBranch({ kind: "error" });
    } catch {
      setBranch({ kind: "error" });
    }
  }, [sessionId]);

  // Task 4.1: the WebSocket subscription is established in the same effect
  // pass as the fetch below, not gated behind the fetch resolving.
  const connect = useCallback(() => {
    return new WebSocket(buildSessionWebSocketUrl(sessionId ?? ""));
  }, [sessionId]);
  const { socket } = useConnectionHealth(connect);

  useEffect(() => {
    void fetchReview();
  }, [fetchReview]);

  // Task 4.7: on session_state_change, re-fetch the same endpoint that
  // already owns branch determination — one source of truth, not a second
  // branching path driven off the event payload directly.
  const fetchReviewRef = useRef(fetchReview);
  useEffect(() => {
    fetchReviewRef.current = fetchReview;
  }, [fetchReview]);

  useEffect(() => {
    if (!socket) return;
    function onMessage(event: MessageEvent): void {
      let parsed: unknown;
      try {
        parsed = typeof event.data === "string" ? JSON.parse(event.data) : null;
      } catch {
        return;
      }
      if (parsed === null || typeof parsed !== "object" || !("eventType" in parsed)) return;
      const message = parsed as WsClientMessage;
      if (isSessionStateChangeMessage(message)) {
        void fetchReviewRef.current();
      }
    }
    socket.addEventListener("message", onMessage);
    return () => socket.removeEventListener("message", onMessage);
  }, [socket]);

  const handleStartSession = useCallback(async () => {
    if (!sessionId) return;
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/start`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        setStartError("Couldn't start the session. Try again.");
        return;
      }
      // Success: the session_state_change broadcast (received above) moves
      // every subscriber — including this facilitator — to the pre_session
      // branch. This response's own actionItems payload is not consumed
      // here (design.md Decision 3/4's reconciliation).
    } catch {
      setStartError("Couldn't start the session. Try again.");
    } finally {
      setStarting(false);
    }
  }, [sessionId]);

  const handleBeginVoting = useCallback(() => {
    if (!sessionId) return;
    setBeginVotingPending(true);
    setBeginVotingError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/v1/sessions/${sessionId}/begin-voting`, {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) {
          // Generic fallback — does not assume a clean 4xx body. Covers the
          // pre-existing "no topics configured" bare-Error/500 (SESSION-005
          // rough edge, out of scope for this change to fix; see proposal.md).
          setBeginVotingError("Couldn't start voting. Try again.");
          return;
        }
        // Success: session_state_change moves every subscriber off the
        // review screen once received.
      } catch {
        setBeginVotingError("Couldn't start voting. Try again.");
      } finally {
        setBeginVotingPending(false);
      }
    })();
  }, [sessionId]);

  if (!session) return null;

  return (
    <div
      data-testid="session-lobby"
      style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}
    >
      <h1>Session Lobby</h1>

      {branch.kind === "loading" && <p data-testid="session-lobby-loading">Loading…</p>}

      {branch.kind === "error" && (
        <div>
          <p role="alert" data-testid="session-lobby-review-error">
            Couldn't load this session. Try again.
          </p>
          <button type="button" onClick={() => void fetchReview()} data-testid="session-lobby-review-retry">
            Retry
          </button>
        </div>
      )}

      {branch.kind === "no-access" && (
        <p data-testid="session-lobby-no-access">
          You don't have access to this session.
        </p>
      )}

      {branch.kind === "left" && (
        <p data-testid="session-lobby-left">
          This session has moved past the pre-session review.
        </p>
      )}

      {branch.kind === "lobby" && (
        <div data-testid="session-lobby-waiting">
          <p data-testid="session-lobby-info">
            Session <strong>{sessionId}</strong> — waiting for the facilitator to start.
          </p>
          {branch.isFacilitator && (
            <div style={{ marginTop: "1rem" }}>
              <button
                type="button"
                data-testid="start-session-button"
                onClick={() => void handleStartSession()}
                disabled={starting}
              >
                {starting ? "Starting…" : "Start Session"}
              </button>
              {startError && (
                <p role="alert" data-testid="start-session-error" style={{ color: "#c62828", marginTop: "0.5rem" }}>
                  {startError}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {branch.kind === "pre_session" && (
        <PreSessionActionItemReview
          actionItems={branch.data.actionItems}
          isFacilitator={branch.data.isFacilitator}
          onBeginVoting={handleBeginVoting}
          beginVotingPending={beginVotingPending}
          beginVotingError={beginVotingError}
        />
      )}

      {/* -----------------------------------------------------------------------
          Access model statement (Decision 8, task 7.1):
          Required in BOTH the team view (MemberManagement component) AND the
          session lobby (this component). Both surfaces are required — Decision 8
          uses "and" not "or". Shown in every branch where the participant has
          standing on this session — omitted only for no-access/error, where
          they were never actually in the room.

          Placement: findable but not prominent per task 7.2.
          No modal, no acknowledgment, no notification on page load (task 7.3).
      ----------------------------------------------------------------------- */}
      {branch.kind !== "no-access" && branch.kind !== "error" && (
        <p
          data-testid="session-lobby-access-model-statement"
          style={{
            fontSize: "0.875rem",
            color: "#555",
            marginTop: "1rem",
            borderTop: "1px solid #e0e0e0",
            paddingTop: "0.75rem",
          }}
        >
          {ACCESS_MODEL_STATEMENT}
        </p>
      )}

      <div style={{ marginTop: "2rem" }}>
        <SignOutButton />
      </div>
    </div>
  );
}
