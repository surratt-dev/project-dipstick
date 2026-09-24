import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import type { EligibleTeam, EligibleTeamsResponse, SessionAlreadyExistsResponse } from "@dipstick/shared";
import { useAuth } from "../auth/AuthContext.js";
import { ReauthRequiredTreatment } from "../components/ReauthRequiredTreatment.js";
import { detectSessionExpiry } from "../http/sessionExpiry.js";

// ---------------------------------------------------------------------------
// SessionCreationPage — picker -> confirm -> create flow
//
// session-creation-existing-team, design.md D2/D3/D5/D6. Gated on
// canFacilitateSessions (design.md D5) -- the gate itself lives here, not in
// a route wrapper, matching how NoTeamPage's own bookmark-guard redirect
// already works in this codebase.
//
// Two screens, one component: 'picker' lists eligible teams
// (GET /api/v1/teams/eligible-for-session); 'confirm' shows the selected
// team's context and submits POST /api/v1/teams/:teamId/sessions/draft. On
// any confirm-screen rejection, the previously-fetched list is marked stale
// so returning to the picker re-fetches it (task 6.5) rather than risking a
// second submission against data already known to be wrong.
// ---------------------------------------------------------------------------

type Screen = { name: "picker" } | { name: "confirm"; team: EligibleTeam };

type ConfirmError =
  | { kind: "membership_conflict"; message: string }
  | { kind: "session_already_exists"; body: SessionAlreadyExistsResponse };

export function SessionCreationPage() {
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [screen, setScreen] = useState<Screen>({ name: "picker" });
  const [listData, setListData] = useState<EligibleTeamsResponse | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [listStale, setListStale] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState<ConfirmError | null>(null);

  // http-session-expiry-reauth-parity design.md Decision 1a: always
  // role="facilitator" on this page — gated on canFacilitateSessions before
  // rendering at all, no derivation needed. `returnTo` is this page's fixed
  // route (`/sessions/new`, not window.location.pathname) per design.md
  // Decision 3.
  const [reauthRequired, setReauthRequired] = useState<{ returnTo: string } | null>(null);

  const loadEligibleTeams = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetch("/api/v1/teams/eligible-for-session", {
        credentials: "include",
      });
      if (!res.ok) {
        const { isSessionExpired } = await detectSessionExpiry(res);
        if (isSessionExpired) {
          setReauthRequired({ returnTo: "/sessions/new" + window.location.search });
          return;
        }
        setListError("Failed to load teams you can create a session for.");
        return;
      }
      const json = (await res.json()) as EligibleTeamsResponse;
      setListData(json);
      setListStale(false);
    } catch {
      setListError("Network error loading eligible teams.");
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEligibleTeams();
  }, [loadEligibleTeams]);

  // task 6.5: a stale list (set after any confirm-screen rejection) is
  // re-fetched the next time the picker is shown, not silently reused.
  useEffect(() => {
    if (screen.name === "picker" && listStale) {
      void loadEligibleTeams();
    }
  }, [screen, listStale, loadEligibleTeams]);

  if (authLoading) return <p>Loading…</p>;

  // design.md D5's gate: this route is only meaningful for a facilitator.
  if (session && !session.canFacilitateSessions) {
    return <Navigate to="/" replace />;
  }

  if (reauthRequired) {
    return <ReauthRequiredTreatment role="facilitator" returnTo={reauthRequired.returnTo} />;
  }

  function selectTeam(team: EligibleTeam) {
    setConfirmError(null);
    setScreen({ name: "confirm", team });
  }

  function backToPicker() {
    setConfirmError(null);
    setScreen({ name: "picker" });
  }

  async function confirmCreate(team: EligibleTeam) {
    setSubmitting(true);
    setConfirmError(null);
    try {
      const res = await fetch(`/api/v1/teams/${team.teamId}/sessions/draft`, {
        method: "POST",
        credentials: "include",
      });

      if (res.status === 201) {
        const body = (await res.json()) as { sessionId: string; teamId: string };
        navigate(`/team/${body.teamId}/session/${body.sessionId}`, {
          replace: true,
          state: { teamName: team.teamName, lastSessionAt: team.lastSessionAt },
        });
        return;
      }

      if (res.status === 401) {
        const { isSessionExpired } = await detectSessionExpiry(res);
        if (isSessionExpired) {
          setReauthRequired({ returnTo: "/sessions/new" + window.location.search });
          return;
        }
        // A non-session-expiry 401 falls through to the generic-error
        // branch below, unaltered.
      }

      if (res.status === 409) {
        const body = (await res.json()) as SessionAlreadyExistsResponse;
        setConfirmError({ kind: "session_already_exists", body });
        setListStale(true);
        return;
      }

      if (res.status === 403) {
        const body = (await res.json()) as { error: { message: string } };
        setConfirmError({ kind: "membership_conflict", message: body.error.message });
        setListStale(true);
        return;
      }

      setConfirmError({
        kind: "membership_conflict",
        message: "Something went wrong creating this session. Please try again.",
      });
      setListStale(true);
    } catch {
      setConfirmError({
        kind: "membership_conflict",
        message: "Network error creating this session. Please try again.",
      });
      setListStale(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (screen.name === "confirm") {
    const { team } = screen;
    return (
      <div
        data-testid="session-creation-confirm"
        style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "480px", margin: "0 auto" }}
      >
        <h1>Confirm session</h1>
        <p>
          You are about to create a session for <strong data-testid="confirm-team-name">{team.teamName}</strong>,
          facilitated by <strong>{session?.user.displayName}</strong>.
        </p>
        <p data-testid="confirm-last-session-context" style={{ color: "#616161" }}>
          {team.lastSessionAt
            ? `Last session: ${new Date(team.lastSessionAt).toLocaleDateString()}`
            : "This team has no completed sessions yet."}
        </p>

        {confirmError && confirmError.kind === "membership_conflict" && (
          <p role="alert" data-testid="confirm-error-membership-conflict" style={{ color: "#c62828" }}>
            {confirmError.message}
          </p>
        )}

        {confirmError && confirmError.kind === "session_already_exists" && (
          <div role="alert" data-testid="confirm-error-session-already-exists" style={{ color: "#c62828" }}>
            <p>
              This team already has a session in progress (status: {confirmError.body.existingSessionStatus}).
            </p>
            <button
              type="button"
              data-testid="resume-existing-session"
              onClick={() =>
                navigate(
                  `/team/${confirmError.body.teamId}/session/${confirmError.body.existingSessionId}`,
                  { state: { teamName: team.teamName, lastSessionAt: team.lastSessionAt } },
                )
              }
            >
              Go to your existing session
            </button>
          </div>
        )}

        <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem" }}>
          <button type="button" data-testid="confirm-create-session" disabled={submitting} onClick={() => void confirmCreate(team)}>
            {submitting ? "Creating…" : "Create session"}
          </button>
          <button type="button" data-testid="confirm-back-to-picker" onClick={backToPicker} disabled={submitting}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="session-creation-picker"
      style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "480px", margin: "0 auto" }}
    >
      <h1>Create a session</h1>

      {listLoading && <p>Loading teams…</p>}

      {!listLoading && listError && (
        <p role="alert" data-testid="picker-error">
          {listError}
        </p>
      )}

      {!listLoading && !listError && listData && listData.eligibleTeams.length === 0 && (
        <p data-testid="picker-empty-state">
          {listData.callerHasTeamMemberships
            ? "You're already a member of every team in the organization — there's no other team to create a session for."
            : "You don't have a home team yet, and there are no other teams to create a session for right now."}
        </p>
      )}

      {!listLoading && !listError && listData && listData.eligibleTeams.length > 0 && (
        <ul data-testid="picker-team-list" style={{ listStyle: "none", padding: 0 }}>
          {listData.eligibleTeams.map((team) => (
            <li key={team.teamId} style={{ marginBottom: "0.5rem" }}>
              <button
                type="button"
                data-testid={`picker-team-${team.teamId}`}
                onClick={() => selectTeam(team)}
                style={{ width: "100%", textAlign: "left", padding: "0.75rem 1rem" }}
              >
                <div style={{ fontWeight: 600 }}>{team.teamName}</div>
                <div style={{ fontSize: "0.875rem", color: "#616161" }}>
                  {team.lastSessionAt
                    ? `Last session: ${new Date(team.lastSessionAt).toLocaleDateString()}`
                    : "No completed sessions yet"}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
