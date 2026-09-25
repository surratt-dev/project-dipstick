import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { buildJoinLinkPath, type FacilitatorSessionStateResponse } from "@dipstick/shared";
import { ReauthRequiredTreatment } from "../components/ReauthRequiredTreatment.js";
import { detectSessionExpiry } from "../http/sessionExpiry.js";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard.js";

// ---------------------------------------------------------------------------
// DraftSessionHost — the real, refresh-safe route from design.md Decision D6
// (/team/:teamId/session/:sessionId).
//
// One shared host component, rehydrated the same way regardless of how it's
// reached (create-flow navigation, a refresh, a direct/bookmarked hit, or
// the POST /draft 409's resume affordance): it always fetches
// GET .../facilitator-state on mount and renders the draft control view when
// currentSessionState === 'draft', or a live participant-readiness view
// otherwise. No new backend endpoint is needed -- the authorization
// (facilitator_id === caller) and the data this route needs already exist on
// that endpoint (task 7.2).
//
// teamName is not part of facilitator-state's response (a facilitator is, by
// design, not a member of this team, so the membership-gated
// GET /api/v1/teams/:teamId cannot be used here without dragging in a second
// authorization path). When available -- the create flow's navigation, or
// the confirm screen's 409 resume affordance, both of which already know the
// team's name from the eligible-teams list -- it's passed through router
// state as a display hint. On a refresh or a bare bookmark hit there is no
// such hint, and the view falls back to the bare teamId, which is what
// design.md's "lightweight team context" scope leaves room for.
// ---------------------------------------------------------------------------

interface NavigationState {
  teamName?: string;
  lastSessionAt?: string | null;
  // inline-team-creation, tasks.md 5.6/5.7: set only by SessionCreationPage's
  // new-team submit navigation. Scoped to that one navigation so the
  // existing-team landing copy is never altered by this flag's absence.
  newTeamCreated?: boolean;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; data: FacilitatorSessionStateResponse };

type AdvanceState = { phase: "idle" } | { phase: "confirming" } | { phase: "submitting" } | { phase: "failed"; message: string };

// session-lobby-routing-gap design.md D1: no "confirming" phase -- Start
// Session has no confirmation step, matching SessionLobbyPage's
// handleStartSession (SessionLobbyPage.tsx) rather than openTheRoom's.
type StartSessionState = { phase: "idle" } | { phase: "submitting" } | { phase: "failed"; message: string };

export function DraftSessionHost() {
  const { teamId, sessionId } = useParams<{ teamId: string; sessionId: string }>();
  const location = useLocation();
  const navState = location.state as NavigationState | null;
  const teamNameHint = navState?.teamName;
  const lastSessionAtHint = navState?.lastSessionAt;
  const newTeamCreated = navState?.newTeamCreated ?? false;

  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [advanceState, setAdvanceState] = useState<AdvanceState>({ phase: "idle" });
  const [startSessionState, setStartSessionState] = useState<StartSessionState>({ phase: "idle" });
  // http-session-expiry-reauth-parity design.md Decision 1a: always
  // role="facilitator" on this page — gated on canFacilitateSessions before
  // rendering at all, no derivation needed.
  const [reauthRequired, setReauthRequired] = useState<{ returnTo: string } | null>(null);
  // join-link-display-copy design.md D1: invoked once at this level so both
  // branches (draft-control-view, live-readiness-view) share one status --
  // the "Link copied" banner and its timer survive the draft->lobby
  // transition performed in place by openTheRoom() (design.md D4).
  const { copy, status: copyStatus } = useCopyToClipboard();

  const loadFacilitatorState = useCallback(async () => {
    if (!teamId || !sessionId) return;
    setLoadState({ status: "loading" });
    try {
      const res = await fetch(`/api/v1/teams/${teamId}/sessions/${sessionId}/facilitator-state`, {
        credentials: "include",
      });
      if (!res.ok) {
        const { isSessionExpired, body } = await detectSessionExpiry(res);
        if (isSessionExpired) {
          setReauthRequired({ returnTo: window.location.pathname + window.location.search });
          return;
        }
        setLoadState({
          status: "error",
          message: (body as { error?: { message: string } } | null)?.error?.message ?? "Unable to load this session.",
        });
        return;
      }
      const data = (await res.json()) as FacilitatorSessionStateResponse;
      setLoadState({ status: "loaded", data });
    } catch {
      setLoadState({ status: "error", message: "Network error loading this session." });
    }
  }, [teamId, sessionId]);

  useEffect(() => {
    void loadFacilitatorState();
  }, [loadFacilitatorState]);

  async function openTheRoom() {
    if (!teamId || !sessionId) return;
    setAdvanceState({ phase: "submitting" });
    try {
      const res = await fetch(`/api/v1/teams/${teamId}/sessions/${sessionId}/advance`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const { isSessionExpired, body } = await detectSessionExpiry(res);
        if (isSessionExpired) {
          setReauthRequired({ returnTo: window.location.pathname + window.location.search });
          return;
        }
        setAdvanceState({
          phase: "failed",
          message: (body as { error?: { message: string } } | null)?.error?.message ?? "Could not open the room. Please try again.",
        });
        return;
      }
      // Task 7.5: update in place, no navigation.
      setLoadState((prev) =>
        prev.status === "loaded"
          ? { status: "loaded", data: { ...prev.data, currentSessionState: "lobby" } }
          : prev,
      );
      setAdvanceState({ phase: "idle" });
    } catch {
      setAdvanceState({ phase: "failed", message: "Network error opening the room. Please try again." });
    }
  }

  // session-lobby-routing-gap design.md D1: the lobby -> pre_session
  // trigger. Same POST /api/v1/sessions/:sessionId/start SessionLobbyPage's
  // handleStartSession calls, and the same in-place-update-on-success /
  // inline-retry-on-failure pattern as openTheRoom above.
  async function startSession() {
    if (!sessionId) return;
    setStartSessionState({ phase: "submitting" });
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/start`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const { isSessionExpired, body } = await detectSessionExpiry(res);
        if (isSessionExpired) {
          setReauthRequired({ returnTo: window.location.pathname + window.location.search });
          return;
        }
        setStartSessionState({
          phase: "failed",
          message: (body as { error?: { message: string } } | null)?.error?.message ?? "Couldn't start the session. Try again.",
        });
        return;
      }
      setLoadState((prev) =>
        prev.status === "loaded"
          ? { status: "loaded", data: { ...prev.data, currentSessionState: "pre_session" } }
          : prev,
      );
      setStartSessionState({ phase: "idle" });
    } catch {
      setStartSessionState({ phase: "failed", message: "Network error starting the session. Please try again." });
    }
  }

  if (!teamId || !sessionId) return null;

  if (reauthRequired) {
    return <ReauthRequiredTreatment role="facilitator" returnTo={reauthRequired.returnTo} />;
  }

  if (loadState.status === "loading") {
    return <p>Loading session…</p>;
  }

  if (loadState.status === "error") {
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <p role="alert" data-testid="draft-session-host-error">
          {loadState.message}
        </p>
      </div>
    );
  }

  const { data } = loadState;
  const teamLabel = teamNameHint ?? `Team ${teamId}`;
  // join-link-display-copy design.md D1: computed exactly once and passed
  // into whichever branch renders, never rebuilt separately per branch.
  const joinUrl = `${window.location.origin}${buildJoinLinkPath(data.joinToken)}`;

  // join-link-display-copy design.md D4: shared banner/fallback rendering
  // for both branches -- only the badge (draft-only) differs between them.
  function renderCopyControl(testidPrefix: string) {
    return (
      <>
        <button type="button" data-testid={`${testidPrefix}-copy-button`} onClick={() => void copy(joinUrl)}>
          Copy link
        </button>
        {copyStatus === "copied" && (
          <div
            role="status"
            aria-live="polite"
            data-testid={`${testidPrefix}-copied-banner`}
            style={{
              marginTop: "0.5rem",
              padding: "0.75rem 1rem",
              backgroundColor: "#e8f5e9",
              border: "1px solid #a5d6a7",
              borderRadius: "4px",
            }}
          >
            Link copied
          </div>
        )}
      </>
    );
  }

  if (data.currentSessionState !== "draft") {
    return (
      <div
        data-testid="live-readiness-view"
        style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}
      >
        <h1>{teamLabel}</h1>
        {/* task 5.7, design.md D2: new-team-specific acknowledgment, scoped
            to the navigation that just created this team -- does not alter
            the existing-team flow's landing copy, which never sets
            newTeamCreated. */}
        {newTeamCreated && (
          <p data-testid="new-team-landing-acknowledgment">
            Team created. Default topics assigned.
          </p>
        )}
        {/* session-lobby-routing-gap design.md D1/D2/D5: the lobby -> pre_session
            trigger (Start Session), the navigate-away link that closes the
            transition instead of relocating the dead end (pre_session/active/
            wrap_up), and the untouched static text for genuinely terminal
            statuses (complete/abandoned) -- not a new dead end, since nothing
            about those statuses is actionable. */}
        {data.currentSessionState === "lobby" && (
          <div data-testid="live-readiness-lobby">
            {/* design.md D5/task 4.1: heading and control label aligned with
                SessionLobbyPage's lobby-branch "Session Lobby" heading and
                "Start Session" button, so landing on either surface
                mid-transition reads as the same product. */}
            <h2>Session Lobby</h2>
            <p>Waiting for participants to join. Start the session when you're ready.</p>
            <button
              type="button"
              data-testid="start-session-button"
              onClick={() => void startSession()}
              disabled={startSessionState.phase === "submitting"}
            >
              {startSessionState.phase === "submitting" ? "Starting…" : "Start Session"}
            </button>
            {startSessionState.phase === "failed" && (
              <p role="alert" data-testid="start-session-error" style={{ color: "#c62828", marginTop: "0.5rem" }}>
                {startSessionState.message}
              </p>
            )}
          </div>
        )}

        {(data.currentSessionState === "pre_session" ||
          data.currentSessionState === "active" ||
          data.currentSessionState === "wrap_up") && (
          <div data-testid="live-readiness-navigate">
            <p>The room is open. Session status: {data.currentSessionState}.</p>
            <Link to={`/session/${sessionId}`} data-testid="live-session-navigate-link">
              Go to the session
            </Link>
          </div>
        )}

        {(data.currentSessionState === "complete" || data.currentSessionState === "abandoned") && (
          <p>The room is open. Session status: {data.currentSessionState}.</p>
        )}

        <div style={{ marginTop: "1rem" }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#757575" }}>JOIN LINK</div>
          {/* design.md D5: full-emphasis body text once joinable -- no muted
              color, no badge (badge is draft-only, per spec.md). */}
          <p data-testid="live-join-link">{joinUrl}</p>
          {renderCopyControl("live-join-link")}
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="draft-control-view"
      style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "480px", margin: "0 auto" }}
    >
      <h1>{teamLabel}</h1>
      <p>This session is in draft. Review the details below before opening the room.</p>
      <p data-testid="draft-last-session-context" style={{ color: "#616161" }}>
        {lastSessionAtHint
          ? `Last session: ${new Date(lastSessionAtHint).toLocaleDateString()}`
          : "No completed sessions on record for this team."}
      </p>

      <div style={{ marginTop: "1rem" }}>
        <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#757575" }}>JOIN LINK</div>
        <p data-testid="draft-join-link" style={{ color: "#9e9e9e" }}>
          {joinUrl}{" "}
          <span data-testid="draft-join-link-badge">
            This link works already — anyone who opens it before you open the room won't see a waiting screen yet.
          </span>
        </p>
        {renderCopyControl("draft-join-link")}
      </div>

      {advanceState.phase === "failed" && (
        <p role="alert" data-testid="advance-error">
          {advanceState.message}
        </p>
      )}

      {advanceState.phase !== "confirming" && (
        <button
          type="button"
          data-testid="open-the-room"
          disabled={advanceState.phase === "submitting"}
          onClick={() => setAdvanceState({ phase: "confirming" })}
        >
          Open the room
        </button>
      )}

      {advanceState.phase === "confirming" && (
        <div data-testid="open-the-room-confirm" style={{ marginTop: "0.75rem" }}>
          <p>
            Opening the room lets participants join immediately, and cannot be undone. Continue?
          </p>
          <button type="button" data-testid="open-the-room-confirm-yes" onClick={() => void openTheRoom()}>
            Yes, open the room
          </button>
          <button
            type="button"
            data-testid="open-the-room-confirm-cancel"
            onClick={() => setAdvanceState({ phase: "idle" })}
            style={{ marginLeft: "0.5rem" }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
