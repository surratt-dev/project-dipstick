import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import type {
  EligibleTeam,
  EligibleTeamsResponse,
  SessionAlreadyExistsResponse,
  TeamNameCollisionResponse,
} from "@dipstick/shared";
import { useAuth } from "../auth/AuthContext.js";
import { ReauthRequiredTreatment } from "../components/ReauthRequiredTreatment.js";
import { SignOutButton } from "../components/SignOutButton.js";
import { detectSessionExpiry } from "../http/sessionExpiry.js";

// ---------------------------------------------------------------------------
// SessionCreationPage — picker -> confirm -> create flow, plus new-team
// creation (inline-team-creation)
//
// session-creation-existing-team, design.md D2/D3/D5/D6. Gated on
// canFacilitateSessions (design.md D5) -- the gate itself lives here, not in
// a route wrapper, matching how NoTeamPage's own bookmark-guard redirect
// already works in this codebase.
//
// Three screens, one component (inline-team-creation design.md D1 -- a
// sibling NewTeamCreationPage.tsx was rejected as the "two components that
// can drift" pattern the existing-team change's own D6 already avoided):
// 'picker' lists eligible teams (GET /api/v1/teams/eligible-for-session);
// 'confirm' shows the selected existing team's context and submits
// POST /api/v1/teams/:teamId/sessions/draft; 'new-team' collects a team name
// and submits POST /api/v1/teams. On any confirm-screen rejection, the
// previously-fetched list is marked stale so returning to the picker
// re-fetches it (task 6.5) rather than risking a second submission against
// data already known to be wrong.
// ---------------------------------------------------------------------------

type Screen = { name: "picker" } | { name: "confirm"; team: EligibleTeam } | { name: "new-team" };

type ConfirmError =
  | { kind: "membership_conflict"; message: string }
  | { kind: "session_already_exists"; body: SessionAlreadyExistsResponse };

// design.md D2 (error-state shape, engineer review Finding 3): a dedicated
// state, not an extension of ConfirmError -- the two screens' error
// vocabularies are unrelated. Reset on every transition into or out of the
// new-team screen.
type NewTeamError = { kind: "empty_name" } | { kind: "name_collision"; providedName: string };

export function SessionCreationPage() {
  const { session, loading: authLoading, refreshSession } = useAuth();
  const navigate = useNavigate();

  const [screen, setScreen] = useState<Screen>({ name: "picker" });
  const [listData, setListData] = useState<EligibleTeamsResponse | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [listStale, setListStale] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState<ConfirmError | null>(null);

  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamSubmitting, setNewTeamSubmitting] = useState(false);
  const [newTeamError, setNewTeamError] = useState<NewTeamError | null>(null);
  // Unexpected failures (network error, 5xx, a non-session-expiry 401) fall
  // outside design.md D2's two-member newTeamError union on purpose -- kept
  // as a separate free-text state rather than overloading "empty_name" with
  // a misleading message.
  const [newTeamGenericError, setNewTeamGenericError] = useState<string | null>(null);

  // http-session-expiry-reauth-parity design.md Decision 1a: always
  // role="facilitator" on this page — gated on canFacilitateSessions before
  // rendering at all, no derivation needed. `returnTo` is this page's fixed
  // route (`/sessions/new`, not window.location.pathname) per design.md
  // Decision 3.
  const [reauthRequired, setReauthRequired] = useState<{ returnTo: string } | null>(null);

  // facilitator-session-entry-point design D5a: held in a ref so that a new
  // context value never changes loadEligibleTeams' identity and re-triggers
  // the fetch below (one 403 -> at most one refresh).
  const refreshSessionRef = useRef(refreshSession);
  useEffect(() => {
    refreshSessionRef.current = refreshSession;
  }, [refreshSession]);

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
        // facilitator-session-entry-point design D5a: this endpoint's only 403
        // is the role denial, so the server no longer treats the caller as a
        // facilitator while this tab's AuthSession still does. Re-sync once;
        // if the refreshed session says canFacilitateSessions is false, the
        // gate below redirects to "/". Keyed on status, not the body, which
        // detectSessionExpiry has already read. No loop: this callback does
        // not depend on `session`. The confirm screen's POST /draft 403 does
        // not refresh; its "Back" re-fetches this list instead.
        if (res.status === 403) {
          void refreshSessionRef.current();
        }
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

  // task 5.2/5.5, design.md D2: pure client-side state transitions. Nothing
  // is created before the form is submitted, so both directions are always
  // safe. newTeamError is reset on every transition into or out of the
  // new-team screen (design.md D2's "reset on every transition" note).
  function goToNewTeam() {
    setNewTeamError(null);
    setNewTeamGenericError(null);
    setNewTeamName("");
    setScreen({ name: "new-team" });
  }

  function backToPickerFromNewTeam() {
    setNewTeamError(null);
    setNewTeamGenericError(null);
    setScreen({ name: "picker" });
  }

  async function submitNewTeam() {
    const trimmedName = newTeamName.trim();
    if (trimmedName.length === 0) {
      setNewTeamError({ kind: "empty_name" });
      return;
    }

    setNewTeamSubmitting(true);
    setNewTeamError(null);
    setNewTeamGenericError(null);
    try {
      const res = await fetch("/api/v1/teams", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName }),
      });

      if (res.status === 201) {
        const body = (await res.json()) as { teamId: string; sessionId: string };
        // task 5.6: straight to the live participant-readiness view, not a
        // draft control view -- the new-team session lands in 'lobby', not
        // 'draft' (design.md D2). newTeamCreated flags the landing
        // acknowledgment copy (task 5.7), scoped to this navigation only.
        navigate(`/team/${body.teamId}/session/${body.sessionId}`, {
          replace: true,
          state: { teamName: trimmedName, lastSessionAt: null, newTeamCreated: true },
        });
        return;
      }

      if (res.status === 401) {
        const { isSessionExpired } = await detectSessionExpiry(res);
        if (isSessionExpired) {
          setReauthRequired({ returnTo: "/sessions/new" + window.location.search });
          return;
        }
        setNewTeamGenericError("Something went wrong creating this team. Please try again.");
        return;
      }

      if (res.status === 409) {
        const body = (await res.json()) as TeamNameCollisionResponse;
        setNewTeamError({ kind: "name_collision", providedName: body.providedName });
        return;
      }

      if (res.status === 400) {
        setNewTeamError({ kind: "empty_name" });
        return;
      }

      setNewTeamGenericError("Something went wrong creating this team. Please try again.");
    } catch {
      setNewTeamGenericError("Network error creating this team. Please try again.");
    } finally {
      setNewTeamSubmitting(false);
    }
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

  if (screen.name === "new-team") {
    const trimmedName = newTeamName.trim();
    // task 5.4, design.md D2: the submit control's label echoes the typed
    // name back -- this is where the real irreversible moment lives, since
    // there is no rename path once the team is created.
    const submitLabel = trimmedName.length > 0 ? `Create team '${trimmedName}' and open session room` : "Create team and open session room";

    return (
      <div
        data-testid="session-creation-new-team"
        style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "480px", margin: "0 auto" }}
      >
        <h1>Create a new team</h1>
        <label htmlFor="new-team-name" style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>
          Team name
        </label>
        <input
          id="new-team-name"
          data-testid="new-team-name-input"
          type="text"
          value={newTeamName}
          disabled={newTeamSubmitting}
          onChange={(e) => setNewTeamName(e.target.value)}
          style={{ width: "100%", padding: "0.5rem", marginBottom: "1rem" }}
        />

        {newTeamError && newTeamError.kind === "empty_name" && (
          <p role="alert" data-testid="new-team-error-empty-name" style={{ color: "#c62828" }}>
            Team name is required.
          </p>
        )}

        {newTeamError && newTeamError.kind === "name_collision" && (
          <p role="alert" data-testid="new-team-error-name-collision" style={{ color: "#c62828" }}>
            A team named "{newTeamError.providedName}" already exists. Choose a different name.
          </p>
        )}

        {newTeamGenericError && (
          <p role="alert" data-testid="new-team-error-generic" style={{ color: "#c62828" }}>
            {newTeamGenericError}
          </p>
        )}

        <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem" }}>
          <button
            type="button"
            data-testid="new-team-submit"
            disabled={newTeamSubmitting}
            onClick={() => void submitNewTeam()}
          >
            {newTeamSubmitting ? "Creating…" : submitLabel}
          </button>
          <button
            type="button"
            data-testid="new-team-back-to-picker"
            onClick={backToPickerFromNewTeam}
            disabled={newTeamSubmitting}
          >
            Back
          </button>
        </div>
      </div>
    );
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

  // facilitator-session-entry-point design D5: "your team" is the same
  // client index AuthenticatedLanding (App.tsx) uses -- no ordering, no
  // switcher. Null-safe on purpose (E3): the gate above lets the picker
  // render with session === null when /auth/session failed, so no `!` here.
  const homeTeam = session?.teamMemberships[0];

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

      {/* task 6.1: the empty-state message now invites new-team creation
          rather than stating only that no teams are available -- once
          new-team creation ships, an empty eligible-teams list is no longer
          a dead end.

          facilitator-session-entry-point design D5 (spec R6/R9): this copy
          and the exclusion copy below name only the membership rule. Teams
          can be absent for reasons the copy does not name (deactivation
          today; the reporting chain after #247, which 01c says must not be
          revealed), so never say "every team", "all other teams" or "no
          other teams". */}
      {!listLoading && !listError && listData && listData.eligibleTeams.length === 0 && (
        <p data-testid="picker-empty-state">
          {listData.callerHasTeamMemberships
            ? "There are no teams you can facilitate right now. Facilitators run sessions for teams they're not on. Don't see the team you're looking for? Create one to get started."
            : "You don't have a home team yet, and there are no teams you can facilitate right now. Don't see your team? Create one to get started."}
        </p>
      )}

      {/* design D5 / N1: keyed on the live listData flag, not on
          session.teamMemberships -- do not "harmonise" the two sources. */}
      {!listLoading && !listError && listData && listData.callerHasTeamMemberships && listData.eligibleTeams.length > 0 && (
        <p data-testid="picker-own-team-excluded" style={{ color: "#616161" }}>
          Your own team isn't listed. Facilitators run sessions for teams they're not on.
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

      {/* task 5.2/6.2: reachable regardless of whether the eligible-teams
          list is populated or empty. */}
      {!listLoading && !listError && listData && (
        <button
          type="button"
          data-testid="picker-create-new-team"
          onClick={goToNewTeam}
          style={{ marginTop: "1rem" }}
        >
          Create a new team
        </button>
      )}

      {/* facilitator-session-entry-point design D5 (BA B2): the way out of
          the picker. Outside every list-state conditional so it renders while
          loading, on a load error (including the 403 after a role change),
          empty or populated. Picker screen only: confirm and new-team have
          their own "Back" (BA B3). The reauth early return above replaces
          the page and owns that path (E4). */}
      <div
        data-testid="picker-way-out"
        style={{ marginTop: "2rem", display: "flex", gap: "0.75rem", alignItems: "center" }}
      >
        {homeTeam && (
          <Link to={`/team/${homeTeam.teamId}`} data-testid="picker-go-to-team">
            Go to your team
          </Link>
        )}
        <SignOutButton />
      </div>
    </div>
  );
}
