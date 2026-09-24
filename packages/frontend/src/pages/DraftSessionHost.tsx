import { useCallback, useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import type { FacilitatorSessionStateResponse } from "@dipstick/shared";
import { ReauthRequiredTreatment } from "../components/ReauthRequiredTreatment.js";
import { detectSessionExpiry } from "../http/sessionExpiry.js";

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

export function DraftSessionHost() {
  const { teamId, sessionId } = useParams<{ teamId: string; sessionId: string }>();
  const location = useLocation();
  const navState = location.state as NavigationState | null;
  const teamNameHint = navState?.teamName;
  const lastSessionAtHint = navState?.lastSessionAt;
  const newTeamCreated = navState?.newTeamCreated ?? false;

  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [advanceState, setAdvanceState] = useState<AdvanceState>({ phase: "idle" });
  // http-session-expiry-reauth-parity design.md Decision 1a: always
  // role="facilitator" on this page — gated on canFacilitateSessions before
  // rendering at all, no derivation needed.
  const [reauthRequired, setReauthRequired] = useState<{ returnTo: string } | null>(null);

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
        <p>The room is open. Session status: {data.currentSessionState}.</p>
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
        <p data-testid="draft-join-link-not-joinable" style={{ color: "#9e9e9e" }}>
          {`${window.location.origin}/join/${data.joinToken}`}{" "}
          <span data-testid="draft-join-link-badge">(not yet joinable)</span>
        </p>
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
