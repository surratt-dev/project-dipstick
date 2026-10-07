import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { SessionCreationPage } from "../SessionCreationPage.js";
import { useAuth } from "../../auth/AuthContext.js";
import type {
  AuthSession,
  EligibleTeamsResponse,
  SessionAlreadyExistsResponse,
  TeamNameCollisionResponse,
} from "@dipstick/shared";
import type * as ReactRouterDom from "react-router-dom";

// ---------------------------------------------------------------------------
// SessionCreationPage — picker -> confirm -> create flow
// session-creation-existing-team, tasks.md task 6.6.
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterDom>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("../../auth/AuthContext.js", () => ({
  useAuth: vi.fn().mockReturnValue({
    session: {
      user: { id: "fac-1", displayName: "Frankie Facilitator", email: "frankie@test.com" },
      teamMemberships: [],
      sessionCreatedAt: "",
      expiresAt: "",
      canFacilitateSessions: true,
    },
    loading: false,
    refreshSession: vi.fn(),
  }),
}));

function pageTree() {
  return (
    <MemoryRouter initialEntries={["/sessions/new"]}>
      <Routes>
        <Route path="/sessions/new" element={<SessionCreationPage />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderPage() {
  return render(pageTree());
}

function mockFetchSequence(...responses: Array<Partial<Response> & { jsonBody?: unknown }>) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: () => Promise.resolve(r.jsonBody),
    } as unknown as Response);
  }
  global.fetch = fn;
  return fn;
}

// facilitator-session-entry-point (#237), tasks.md 2.1 harness (E5):
// vi.clearAllMocks() does not reset mockReturnValue, so a membership or flag
// override in one test would leak into every later test. setSession() is the
// only way tests change the auth state, and beforeEach restores the
// zero-membership facilitator default the module-scope mock started with.
const mockRefreshSession = vi.fn(async () => {});

const DEFAULT_SESSION: AuthSession = {
  user: { id: "fac-1", displayName: "Frankie Facilitator", email: "frankie@test.com" },
  teamMemberships: [],
  sessionCreatedAt: "",
  expiresAt: "",
  canFacilitateSessions: true,
};

function setSession(overrides: Partial<AuthSession> | null) {
  vi.mocked(useAuth).mockReturnValue({
    session: overrides === null ? null : { ...DEFAULT_SESSION, ...overrides },
    loading: false,
    refreshSession: mockRefreshSession,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setSession({});
});

describe("SessionCreationPage — picker empty states", () => {
  it("6.1: renders the zero-home-team empty state when callerHasTeamMemberships is false", async () => {
    const body: EligibleTeamsResponse = { eligibleTeams: [], callerHasTeamMemberships: false };
    mockFetchSequence({ jsonBody: body });

    renderPage();

    await waitFor(() => expect(screen.getByTestId("picker-empty-state")).toBeInTheDocument());
    expect(screen.getByTestId("picker-empty-state").textContent).toMatch(/don't have a home team/i);
  });

  it("6.1: renders the zero-eligible-targets empty state when callerHasTeamMemberships is true", async () => {
    const body: EligibleTeamsResponse = { eligibleTeams: [], callerHasTeamMemberships: true };
    mockFetchSequence({ jsonBody: body });

    renderPage();

    await waitFor(() => expect(screen.getByTestId("picker-empty-state")).toBeInTheDocument());
    // facilitator-session-entry-point task 2.1(c): replaces the former
    // /already a member of every team/ assertion, which defended the copy
    // defect BA B1 identified (see the "picker copy" describe below).
    expect(screen.getByTestId("picker-empty-state").textContent).toBe(EMPTY_STATE_WITH_MEMBERSHIPS);
  });

  it("renders the eligible teams list when non-empty", async () => {
    const body: EligibleTeamsResponse = {
      eligibleTeams: [{ teamId: "team-2", teamName: "Team Two", lastSessionAt: "2026-08-01T00:00:00Z" }],
      callerHasTeamMemberships: false,
    };
    mockFetchSequence({ jsonBody: body });

    renderPage();

    await waitFor(() => expect(screen.getByTestId("picker-team-team-2")).toBeInTheDocument());
    expect(screen.getByText("Team Two")).toBeInTheDocument();
  });
});

describe("SessionCreationPage — confirm screen", () => {
  it("6.2/6.6: confirm screen displays team name plus lastSessionAt context, not the bare team name alone", async () => {
    const body: EligibleTeamsResponse = {
      eligibleTeams: [{ teamId: "team-2", teamName: "Team Two", lastSessionAt: "2026-08-01T00:00:00Z" }],
      callerHasTeamMemberships: false,
    };
    mockFetchSequence({ jsonBody: body });

    renderPage();
    await waitFor(() => expect(screen.getByTestId("picker-team-team-2")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("picker-team-team-2"));

    expect(screen.getByTestId("confirm-team-name").textContent).toBe("Team Two");
    expect(screen.getByTestId("confirm-last-session-context").textContent).toMatch(/last session/i);
    expect(screen.getByText(/Frankie Facilitator/)).toBeInTheDocument();
  });

  it("6.3: submits POST to /api/v1/teams/:teamId/sessions/draft on confirm", async () => {
    const listBody: EligibleTeamsResponse = {
      eligibleTeams: [{ teamId: "team-2", teamName: "Team Two", lastSessionAt: null }],
      callerHasTeamMemberships: false,
    };
    const fetchMock = mockFetchSequence(
      { jsonBody: listBody },
      { status: 201, jsonBody: { sessionId: "sess-9", teamId: "team-2", status: "draft", joinToken: "abc123" } },
    );

    renderPage();
    await waitFor(() => expect(screen.getByTestId("picker-team-team-2")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("picker-team-team-2"));
    await userEvent.click(screen.getByTestId("confirm-create-session"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/teams/team-2/sessions/draft",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(mockNavigate).toHaveBeenCalledWith(
      "/team/team-2/session/sess-9",
      expect.objectContaining({ replace: true }),
    );
  });

  it("6.4: handles the 403 cross-team-constraint rejection with an inline, named error", async () => {
    const listBody: EligibleTeamsResponse = {
      eligibleTeams: [{ teamId: "team-2", teamName: "Team Two", lastSessionAt: null }],
      callerHasTeamMemberships: false,
    };
    mockFetchSequence(
      { jsonBody: listBody },
      { ok: false, status: 403, jsonBody: { error: { message: "A facilitator cannot create a session for a team they are a member of." } } },
    );

    renderPage();
    await waitFor(() => expect(screen.getByTestId("picker-team-team-2")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("picker-team-team-2"));
    await userEvent.click(screen.getByTestId("confirm-create-session"));

    await waitFor(() => expect(screen.getByTestId("confirm-error-membership-conflict")).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("6.4: handles the 409 concurrent-session rejection with a resume-existing-session affordance", async () => {
    const listBody: EligibleTeamsResponse = {
      eligibleTeams: [{ teamId: "team-2", teamName: "Team Two", lastSessionAt: null }],
      callerHasTeamMemberships: false,
    };
    const conflictBody: SessionAlreadyExistsResponse = {
      errorState: "session_already_exists",
      existingSessionId: "sess-existing",
      existingSessionStatus: "lobby",
      teamId: "team-2",
    };
    mockFetchSequence({ jsonBody: listBody }, { ok: false, status: 409, jsonBody: conflictBody });

    renderPage();
    await waitFor(() => expect(screen.getByTestId("picker-team-team-2")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("picker-team-team-2"));
    await userEvent.click(screen.getByTestId("confirm-create-session"));

    await waitFor(() => expect(screen.getByTestId("confirm-error-session-already-exists")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("resume-existing-session"));
    expect(mockNavigate).toHaveBeenCalledWith(
      "/team/team-2/session/sess-existing",
      expect.objectContaining({ state: { teamName: "Team Two", lastSessionAt: null } }),
    );
  });

  it("6.5: after a confirm-screen rejection, the picker's eligible-teams list is re-fetched on next open", async () => {
    const listBody: EligibleTeamsResponse = {
      eligibleTeams: [{ teamId: "team-2", teamName: "Team Two", lastSessionAt: null }],
      callerHasTeamMemberships: false,
    };
    const fetchMock = mockFetchSequence(
      { jsonBody: listBody },
      { ok: false, status: 403, jsonBody: { error: { message: "cross-team" } } },
      { jsonBody: listBody },
    );

    renderPage();
    await waitFor(() => expect(screen.getByTestId("picker-team-team-2")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("picker-team-team-2"));
    await userEvent.click(screen.getByTestId("confirm-create-session"));
    await waitFor(() => expect(screen.getByTestId("confirm-error-membership-conflict")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("confirm-back-to-picker"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2]![0]).toBe("/api/v1/teams/eligible-for-session");
  });
});

// ---------------------------------------------------------------------------
// SessionCreationPage — new-team screen (inline-team-creation, tasks.md
// task 7.2)
// ---------------------------------------------------------------------------
describe("SessionCreationPage — new-team screen", () => {
  async function goToNewTeamScreen(listBody: EligibleTeamsResponse = { eligibleTeams: [], callerHasTeamMemberships: false }) {
    mockFetchSequence({ jsonBody: listBody });
    renderPage();
    await waitFor(() => expect(screen.getByTestId("picker-create-new-team")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("picker-create-new-team"));
    await waitFor(() => expect(screen.getByTestId("session-creation-new-team")).toBeInTheDocument());
  }

  it("navigates from the picker to the new-team screen without a full page navigation", async () => {
    await goToNewTeamScreen();
    expect(screen.queryByTestId("session-creation-picker")).not.toBeInTheDocument();
  });

  it("happy path: submits POST /api/v1/teams and navigates to the new session's live view with newTeamCreated state", async () => {
    await goToNewTeamScreen();

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ teamId: "new-team-1", sessionId: "new-sess-1" }),
    } as unknown as Response);

    await userEvent.type(screen.getByTestId("new-team-name-input"), "Platform Team");
    await userEvent.click(screen.getByTestId("new-team-submit"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/teams",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "Platform Team" }),
        }),
      ),
    );

    expect(mockNavigate).toHaveBeenCalledWith(
      "/team/new-team-1/session/new-sess-1",
      expect.objectContaining({
        replace: true,
        state: { teamName: "Platform Team", lastSessionAt: null, newTeamCreated: true },
      }),
    );
  });

  it("the submit control's name-echo label updates live as the Facilitator types", async () => {
    await goToNewTeamScreen();

    expect(screen.getByTestId("new-team-submit").textContent).not.toContain("'");

    await userEvent.type(screen.getByTestId("new-team-name-input"), "Platform Team");

    expect(screen.getByTestId("new-team-submit").textContent).toBe("Create team 'Platform Team' and open session room");
  });

  it("empty-name submission shows an inline validation error and fires no request", async () => {
    await goToNewTeamScreen();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const callsBefore = fetchMock.mock.calls.length;

    await userEvent.click(screen.getByTestId("new-team-submit"));

    expect(screen.getByTestId("new-team-error-empty-name")).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it("whitespace-only name submission is treated as empty", async () => {
    await goToNewTeamScreen();

    await userEvent.type(screen.getByTestId("new-team-name-input"), "   ");
    await userEvent.click(screen.getByTestId("new-team-submit"));

    expect(screen.getByTestId("new-team-error-empty-name")).toBeInTheDocument();
  });

  it("a 409 name-collision response shows an inline, named error identifying the submitted name", async () => {
    await goToNewTeamScreen();

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const collisionBody: TeamNameCollisionResponse = {
      errorState: "team_name_collision",
      providedName: "Platform Team",
    };
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: () => Promise.resolve(collisionBody),
    } as unknown as Response);

    await userEvent.type(screen.getByTestId("new-team-name-input"), "Platform Team");
    await userEvent.click(screen.getByTestId("new-team-submit"));

    await waitFor(() => expect(screen.getByTestId("new-team-error-name-collision")).toBeInTheDocument());
    expect(screen.getByTestId("new-team-error-name-collision").textContent).toContain("Platform Team");
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("back-navigation from the new-team screen fires no request and clears newTeamError, returning to the picker", async () => {
    await goToNewTeamScreen();

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({}),
    } as unknown as Response);

    await userEvent.click(screen.getByTestId("new-team-submit")); // empty name -> local validation error, no request
    expect(screen.getByTestId("new-team-error-empty-name")).toBeInTheDocument();

    const callsBeforeBack = fetchMock.mock.calls.length;
    await userEvent.click(screen.getByTestId("new-team-back-to-picker"));

    expect(screen.getByTestId("session-creation-picker")).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(callsBeforeBack); // back-navigation itself fired nothing

    // Returning to the new-team screen shows no leftover error state.
    await userEvent.click(screen.getByTestId("picker-create-new-team"));
    await waitFor(() => expect(screen.getByTestId("session-creation-new-team")).toBeInTheDocument());
    expect(screen.queryByTestId("new-team-error-empty-name")).not.toBeInTheDocument();
  });

  it("design.md D2: confirmError from a prior existing-team confirm-screen rejection does not leak onto the new-team screen", async () => {
    const listBody: EligibleTeamsResponse = {
      eligibleTeams: [{ teamId: "team-2", teamName: "Team Two", lastSessionAt: null }],
      callerHasTeamMemberships: false,
    };
    const fetchMock = mockFetchSequence(
      { jsonBody: listBody },
      { ok: false, status: 403, jsonBody: { error: { message: "cross-team" } } },
    );

    renderPage();
    await waitFor(() => expect(screen.getByTestId("picker-team-team-2")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("picker-team-team-2"));
    await userEvent.click(screen.getByTestId("confirm-create-session"));
    await waitFor(() => expect(screen.getByTestId("confirm-error-membership-conflict")).toBeInTheDocument());

    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(listBody) } as unknown as Response);
    await userEvent.click(screen.getByTestId("confirm-back-to-picker"));
    await waitFor(() => expect(screen.getByTestId("picker-create-new-team")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("picker-create-new-team"));

    await waitFor(() => expect(screen.getByTestId("session-creation-new-team")).toBeInTheDocument());
    expect(screen.queryByTestId("confirm-error-membership-conflict")).not.toBeInTheDocument();
  });
});

describe("SessionCreationPage — empty-state copy invites new-team creation (task 6.1/6.2)", () => {
  it("6.1: the zero-home-team empty state invites new-team creation, and the affordance remains reachable", async () => {
    const body: EligibleTeamsResponse = { eligibleTeams: [], callerHasTeamMemberships: false };
    mockFetchSequence({ jsonBody: body });

    renderPage();

    await waitFor(() => expect(screen.getByTestId("picker-empty-state")).toBeInTheDocument());
    expect(screen.getByTestId("picker-empty-state").textContent).toMatch(/create one to get started/i);
    expect(screen.getByTestId("picker-create-new-team")).toBeInTheDocument();
  });

  it("6.1: the zero-eligible-targets empty state also invites new-team creation", async () => {
    const body: EligibleTeamsResponse = { eligibleTeams: [], callerHasTeamMemberships: true };
    mockFetchSequence({ jsonBody: body });

    renderPage();

    await waitFor(() => expect(screen.getByTestId("picker-empty-state")).toBeInTheDocument());
    expect(screen.getByTestId("picker-empty-state").textContent).toMatch(/create one to get started/i);
    expect(screen.getByTestId("picker-create-new-team")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// http-session-expiry-reauth-parity, tasks.md task 5.3, design.md Decisions
// 1a and 3.
// ---------------------------------------------------------------------------
const SESSION_EXPIRED_BODY = {
  error: { category: "session_expired", message: "Your session has expired. Please sign in again." },
};

describe("http-session-expiry-reauth-parity: SessionCreationPage reauth parity", () => {
  it("5.3: session-expiry on the picker's GET renders the treatment", async () => {
    mockFetchSequence({ ok: false, status: 401, jsonBody: SESSION_EXPIRED_BODY });

    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: /log in again/i })).toBeInTheDocument());
    expect(screen.queryByTestId("picker-error")).not.toBeInTheDocument();
  });

  it("5.3: session-expiry on the confirm screen's POST renders the treatment, not the 409/403 branches", async () => {
    const listBody: EligibleTeamsResponse = {
      eligibleTeams: [{ teamId: "team-2", teamName: "Team Two", lastSessionAt: null }],
      callerHasTeamMemberships: false,
    };
    mockFetchSequence({ jsonBody: listBody }, { ok: false, status: 401, jsonBody: SESSION_EXPIRED_BODY });

    renderPage();
    await waitFor(() => expect(screen.getByTestId("picker-team-team-2")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("picker-team-team-2"));
    await userEvent.click(screen.getByTestId("confirm-create-session"));

    await waitFor(() => expect(screen.getByRole("button", { name: /log in again/i })).toBeInTheDocument());
    expect(screen.queryByTestId("confirm-error-session-already-exists")).not.toBeInTheDocument();
    expect(screen.queryByTestId("confirm-error-membership-conflict")).not.toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("a non-session-expiry 401 still falls into the existing generic-error branch (regression)", async () => {
    const listBody: EligibleTeamsResponse = {
      eligibleTeams: [{ teamId: "team-2", teamName: "Team Two", lastSessionAt: null }],
      callerHasTeamMemberships: false,
    };
    mockFetchSequence(
      { jsonBody: listBody },
      { ok: false, status: 401, jsonBody: { error: { category: "provider_unavailable", message: "x" } } },
    );

    renderPage();
    await waitFor(() => expect(screen.getByTestId("picker-team-team-2")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("picker-team-team-2"));
    await userEvent.click(screen.getByTestId("confirm-create-session"));

    await waitFor(() => expect(screen.getByTestId("confirm-error-membership-conflict")).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// facilitator-session-entry-point (#237), tasks.md 2.1, design D5/D5a.
// ---------------------------------------------------------------------------

// REVIEWER NOTE (spec R6/R9, 01c "the chain must not be revealed"): these are
// the exact shipped strings. They name only the membership rule. After #247,
// teams in the caller's reporting chain will also be absent from the list, so
// no string may say or imply "every team", "all other teams" or "no other
// teams". If you change a string here, re-check it against that rule first.
const EXCLUSION_COPY =
  "Your own team isn't listed. Facilitators run sessions for teams they're not on.";
const EMPTY_STATE_WITH_MEMBERSHIPS =
  "There are no teams you can facilitate right now. Facilitators run sessions for teams they're not on. Don't see the team you're looking for? Create one to get started.";
const EMPTY_STATE_WITHOUT_MEMBERSHIPS =
  "You don't have a home team yet, and there are no teams you can facilitate right now. Don't see your team? Create one to get started.";

const POPULATED_LIST = (callerHasTeamMemberships: boolean): EligibleTeamsResponse => ({
  eligibleTeams: [{ teamId: "team-2", teamName: "Other", lastSessionAt: null }],
  callerHasTeamMemberships,
});

const HOME_MEMBERSHIPS: AuthSession["teamMemberships"] = [
  { teamId: "home-1", teamName: "Home", role: "participant" },
  { teamId: "home-2", teamName: "Second", role: "participant" },
];

const FORBIDDEN_403 = {
  ok: false,
  status: 403,
  jsonBody: { error: { category: "forbidden", message: "Only a facilitator can view eligible teams." } },
};

function getWayOut() {
  return screen.getByTestId("picker-way-out");
}

function getSignOutInWayOut() {
  return within(getWayOut()).getByRole("button", { name: /sign out/i });
}

describe("facilitator-session-entry-point: picker copy (D5)", () => {
  it("(a) shows the own-team exclusion copy when the caller has memberships and the list is non-empty", async () => {
    mockFetchSequence({ jsonBody: POPULATED_LIST(true) });
    renderPage();

    await waitFor(() => expect(screen.getByTestId("picker-own-team-excluded")).toBeInTheDocument());
  });

  it("(b) omits the exclusion copy when the caller has no memberships", async () => {
    mockFetchSequence({ jsonBody: POPULATED_LIST(false) });
    renderPage();

    await waitFor(() => expect(screen.getByTestId("picker-team-team-2")).toBeInTheDocument());
    expect(screen.queryByTestId("picker-own-team-excluded")).toBeNull();
  });

  it.each([
    [true, EMPTY_STATE_WITH_MEMBERSHIPS],
    [false, EMPTY_STATE_WITHOUT_MEMBERSHIPS],
  ])(
    "(c) empty list with callerHasTeamMemberships=%s renders the D5 copy, still offers new-team creation, and claims neither 'every' nor 'no other teams'",
    async (callerHasTeamMemberships, expected) => {
      mockFetchSequence({ jsonBody: { eligibleTeams: [], callerHasTeamMemberships } });
      renderPage();

      await waitFor(() => expect(screen.getByTestId("picker-empty-state")).toBeInTheDocument());
      const text = screen.getByTestId("picker-empty-state").textContent ?? "";
      expect(text).toBe(expected);
      expect(text.toLowerCase()).not.toContain("every");
      expect(text.toLowerCase()).not.toContain("no other teams");
      expect(screen.getByTestId("picker-create-new-team")).toBeInTheDocument();
      expect(screen.queryByTestId("picker-own-team-excluded")).toBeNull();
    },
  );

  // REVIEWER NOTE: see the note on the string constants above (R6/R9, 01c).
  it("(d) the exclusion and both empty-state strings are exactly the shipped strings and never say 'every' or 'all other'", async () => {
    mockFetchSequence({ jsonBody: POPULATED_LIST(true) });
    renderPage();

    await waitFor(() => expect(screen.getByTestId("picker-own-team-excluded")).toBeInTheDocument());
    expect(screen.getByTestId("picker-own-team-excluded").textContent).toBe(EXCLUSION_COPY);

    for (const str of [EXCLUSION_COPY, EMPTY_STATE_WITH_MEMBERSHIPS, EMPTY_STATE_WITHOUT_MEMBERSHIPS]) {
      expect(str.toLowerCase()).not.toContain("every");
      expect(str.toLowerCase()).not.toContain("all other");
    }
  });
});

describe("facilitator-session-entry-point: picker way out (D5)", () => {
  it("(e) a facilitator with memberships sees 'Go to your team' to their first membership and sign-out, both inside picker-way-out", async () => {
    setSession({ teamMemberships: HOME_MEMBERSHIPS });
    mockFetchSequence({ jsonBody: POPULATED_LIST(true) });
    renderPage();

    await waitFor(() => expect(screen.getByTestId("picker-team-team-2")).toBeInTheDocument());
    const wayOut = getWayOut();
    const goToTeam = within(wayOut).getByTestId("picker-go-to-team");
    expect(goToTeam).toHaveAttribute("href", `/team/${HOME_MEMBERSHIPS[0]!.teamId}`);
    expect(getSignOutInWayOut()).toBeInTheDocument();
  });

  it("(f) a zero-membership facilitator sees sign-out and no 'Go to your team'", async () => {
    mockFetchSequence({ jsonBody: POPULATED_LIST(false) });
    renderPage();

    await waitFor(() => expect(screen.getByTestId("picker-team-team-2")).toBeInTheDocument());
    expect(getSignOutInWayOut()).toBeInTheDocument();
    expect(screen.queryByTestId("picker-go-to-team")).toBeNull();
  });

  it("(g) the way out is not rendered on the confirm screen", async () => {
    setSession({ teamMemberships: HOME_MEMBERSHIPS });
    mockFetchSequence({ jsonBody: POPULATED_LIST(true) });
    renderPage();

    await waitFor(() => expect(screen.getByTestId("picker-team-team-2")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("picker-team-team-2"));

    expect(screen.getByTestId("session-creation-confirm")).toBeInTheDocument();
    expect(screen.queryByTestId("picker-way-out")).toBeNull();
  });

  it("(g) the way out is not rendered on the new-team screen", async () => {
    setSession({ teamMemberships: HOME_MEMBERSHIPS });
    mockFetchSequence({ jsonBody: POPULATED_LIST(true) });
    renderPage();

    await waitFor(() => expect(screen.getByTestId("picker-create-new-team")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("picker-create-new-team"));

    expect(screen.getByTestId("session-creation-new-team")).toBeInTheDocument();
    expect(screen.queryByTestId("picker-way-out")).toBeNull();
  });

  it("(h) while the list is still loading, the way out is already present", () => {
    setSession({ teamMemberships: HOME_MEMBERSHIPS });
    global.fetch = vi.fn(() => new Promise<Response>(() => {}));
    renderPage();

    expect(screen.getByText(/loading teams/i)).toBeInTheDocument();
    expect(within(getWayOut()).getByTestId("picker-go-to-team")).toBeInTheDocument();
    expect(getSignOutInWayOut()).toBeInTheDocument();
  });

  it("(h) after a 403 from eligible-teams, the load error, 'Go to your team' and sign-out are all present", async () => {
    setSession({ teamMemberships: HOME_MEMBERSHIPS });
    mockFetchSequence(FORBIDDEN_403);
    renderPage();

    await waitFor(() => expect(screen.getByTestId("picker-error")).toBeInTheDocument());
    expect(within(getWayOut()).getByTestId("picker-go-to-team")).toBeInTheDocument();
    expect(getSignOutInWayOut()).toBeInTheDocument();
  });

  it("(h) after a network error from eligible-teams, the load error, 'Go to your team' and sign-out are all present", async () => {
    setSession({ teamMemberships: HOME_MEMBERSHIPS });
    global.fetch = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderPage();

    await waitFor(() => expect(screen.getByTestId("picker-error")).toBeInTheDocument());
    expect(within(getWayOut()).getByTestId("picker-go-to-team")).toBeInTheDocument();
    expect(getSignOutInWayOut()).toBeInTheDocument();
  });

  it("(j) with no AuthSession (session null, not loading) the picker renders sign-out only, without throwing", async () => {
    setSession(null);
    mockFetchSequence({ jsonBody: POPULATED_LIST(false) });
    renderPage();

    await waitFor(() => expect(screen.getByTestId("picker-team-team-2")).toBeInTheDocument());
    expect(getSignOutInWayOut()).toBeInTheDocument();
    expect(screen.queryByTestId("picker-go-to-team")).toBeNull();
  });
});

describe("facilitator-session-entry-point: re-sync on a role-denied picker (D5a)", () => {
  it("(i) a 403 from eligible-teams calls refreshSession exactly once", async () => {
    setSession({ teamMemberships: HOME_MEMBERSHIPS });
    mockFetchSequence(FORBIDDEN_403);
    renderPage();

    await waitFor(() => expect(screen.getByTestId("picker-error")).toBeInTheDocument());
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
  });

  it("(i) a network error from eligible-teams does not call refreshSession", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderPage();

    await waitFor(() => expect(screen.getByTestId("picker-error")).toBeInTheDocument());
    expect(mockRefreshSession).not.toHaveBeenCalled();
  });

  it("(i) a 500 from eligible-teams does not call refreshSession", async () => {
    mockFetchSequence({
      ok: false,
      status: 500,
      jsonBody: { error: { category: "internal_error", message: "boom" } },
    });
    renderPage();

    await waitFor(() => expect(screen.getByTestId("picker-error")).toBeInTheDocument());
    expect(mockRefreshSession).not.toHaveBeenCalled();
  });

  it("(i) a 401 session_expired from eligible-teams renders the reauth treatment and does not call refreshSession", async () => {
    mockFetchSequence({ ok: false, status: 401, jsonBody: SESSION_EXPIRED_BODY });
    renderPage();

    await waitFor(() => expect(screen.getByRole("button", { name: /log in again/i })).toBeInTheDocument());
    expect(mockRefreshSession).not.toHaveBeenCalled();
  });

  // Implementation review, security F-1: the refresh actually produces a new
  // session object (still a facilitator). A future change that made
  // loadEligibleTeams depend on `session` would re-fetch and re-refresh here.
  it("(i) a refresh that yields a new, still-facilitator session does not re-fetch the list or refresh again", async () => {
    setSession({ teamMemberships: HOME_MEMBERSHIPS });
    const fetchMock = mockFetchSequence(FORBIDDEN_403, FORBIDDEN_403);
    mockRefreshSession.mockImplementationOnce(async () => {
      setSession({ teamMemberships: [...HOME_MEMBERSHIPS] });
    });
    const { rerender } = render(pageTree());

    await waitFor(() => expect(screen.getByTestId("picker-error")).toBeInTheDocument());
    await waitFor(() => expect(mockRefreshSession).toHaveBeenCalledTimes(1));
    rerender(pageTree());

    await waitFor(() => expect(screen.getByTestId("picker-error")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
  });

  // Implementation review, architect finding 4: the reason refreshSession is
  // held in a ref. AuthProvider's refreshSession changes identity on
  // navigation; a new identity must not re-run loadEligibleTeams.
  it("(i) a new refreshSession identity from the context does not re-fetch the list or call the new function", async () => {
    setSession({ teamMemberships: HOME_MEMBERSHIPS });
    const fetchMock = mockFetchSequence(FORBIDDEN_403, FORBIDDEN_403);
    const { rerender } = render(pageTree());

    await waitFor(() => expect(screen.getByTestId("picker-error")).toBeInTheDocument());
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);

    const refreshB = vi.fn(async () => {});
    vi.mocked(useAuth).mockReturnValue({
      session: { ...DEFAULT_SESSION, teamMemberships: HOME_MEMBERSHIPS },
      loading: false,
      refreshSession: refreshB,
    });
    rerender(pageTree());

    await waitFor(() => expect(screen.getByTestId("picker-error")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshB).not.toHaveBeenCalled();
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
  });

  it("(i) negative (A4): a 403 from the confirm screen's POST /draft does not call refreshSession", async () => {
    mockFetchSequence(
      { jsonBody: POPULATED_LIST(false) },
      { ok: false, status: 403, jsonBody: { error: { category: "forbidden", message: "cross-team" } } },
    );
    renderPage();

    await waitFor(() => expect(screen.getByTestId("picker-team-team-2")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("picker-team-team-2"));
    await userEvent.click(screen.getByTestId("confirm-create-session"));

    await waitFor(() => expect(screen.getByTestId("confirm-error-membership-conflict")).toBeInTheDocument());
    expect(mockRefreshSession).not.toHaveBeenCalled();
  });

  // A2: the gate half of R8's alternative outcome. <Navigate> does not call
  // the module-mocked useNavigate, so a sentinel "/" route is asserted.
  it("(i) gate: when the session says canFacilitateSessions is false, the page redirects to /", () => {
    setSession({ canFacilitateSessions: false });
    global.fetch = vi.fn(() => new Promise<Response>(() => {}));

    render(
      <MemoryRouter initialEntries={["/sessions/new"]}>
        <Routes>
          <Route path="/" element={<div data-testid="at-landing" />} />
          <Route path="/sessions/new" element={<SessionCreationPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("at-landing")).toBeInTheDocument();
    expect(screen.queryByTestId("session-creation-picker")).toBeNull();
  });
});

describe("facilitator-session-entry-point: no client pre-selection (G1, R2)", () => {
  it("(k) incoming navigation state naming an eligible team is ignored: the list renders and nothing is pre-selected", async () => {
    mockFetchSequence({ jsonBody: POPULATED_LIST(true) });

    render(
      <MemoryRouter initialEntries={[{ pathname: "/sessions/new", state: { teamId: "team-2" } }]}>
        <Routes>
          <Route path="/sessions/new" element={<SessionCreationPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("picker-team-team-2")).toBeInTheDocument());
    expect(screen.getByTestId("session-creation-picker")).toBeInTheDocument();
    expect(screen.queryByTestId("session-creation-confirm")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// template-team-not-usable (#214) tasks.md 7.2: the confirm step explains a
// team that is no longer available (any 404 from POST /draft), and
// "Choose another team" returns to the picker and re-fetches the list.
// 409 and 403 keep their copy; 5xx and network errors keep the generic one.
// ---------------------------------------------------------------------------
describe("SessionCreationPage — confirm step, a team that is no longer available (#214)", () => {
  const UNAVAILABLE = "This team is no longer available. Go back to choose another team.";
  const listBody: EligibleTeamsResponse = {
    eligibleTeams: [{ teamId: "team-2", teamName: "Team Two", lastSessionAt: null }],
    callerHasTeamMemberships: false,
  };

  async function confirmWith(...draftReplies: Array<Partial<Response> & { jsonBody?: unknown }>) {
    const fetchMock = mockFetchSequence({ jsonBody: listBody }, ...draftReplies);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("picker-team-team-2")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("picker-team-team-2"));
    await userEvent.click(screen.getByTestId("confirm-create-session"));
    return fetchMock;
  }

  it.each([
    ["TEAM_NOT_FOUND", { error: { category: "not_found", code: "TEAM_NOT_FOUND", message: "Team not found.", correlationId: "c" } }],
    ["a body without a code", { error: { message: "anything" } }],
  ])("a stale selection (404, %s) shows the unavailable-team message, not the generic retry error", async (_label, body) => {
    await confirmWith({ ok: false, status: 404, jsonBody: body });

    await waitFor(() => expect(screen.getByTestId("confirm-error-team-unavailable")).toBeInTheDocument());
    expect(screen.getByTestId("confirm-error-team-unavailable").textContent).toContain(UNAVAILABLE);
    expect(screen.getByRole("button", { name: "Choose another team" })).toBeInTheDocument();
    expect(screen.queryByTestId("confirm-error-membership-conflict")).toBeNull();
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
  });

  it("'Choose another team' shows the picker and requests eligible-for-session again", async () => {
    const fetchMock = await confirmWith(
      { ok: false, status: 404, jsonBody: { error: { code: "TEAM_NOT_FOUND", message: "Team not found." } } },
      { jsonBody: { eligibleTeams: [], callerHasTeamMemberships: false } },
    );
    await waitFor(() => expect(screen.getByTestId("choose-another-team")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("choose-another-team"));

    await waitFor(() => expect(screen.getByTestId("session-creation-picker")).toBeInTheDocument());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2]![0]).toBe("/api/v1/teams/eligible-for-session");
    // The stale entry is gone: the re-fetched list is what renders.
    await waitFor(() => expect(screen.getByTestId("picker-empty-state")).toBeInTheDocument());
    expect(screen.queryByTestId("picker-team-team-2")).toBeNull();
  });

  it("a live-session conflict (409) keeps its existing copy", async () => {
    await confirmWith({
      ok: false,
      status: 409,
      jsonBody: {
        errorState: "session_already_exists",
        existingSessionId: "s-1",
        existingSessionStatus: "lobby",
        teamId: "team-2",
      } satisfies SessionAlreadyExistsResponse,
    });
    await waitFor(() => expect(screen.getByTestId("confirm-error-session-already-exists")).toBeInTheDocument());
    expect(screen.queryByTestId("confirm-error-team-unavailable")).toBeNull();
  });

  it("a 5xx keeps the existing generic error", async () => {
    await confirmWith({ ok: false, status: 500, jsonBody: { error: { message: "boom" } } });
    await waitFor(() =>
      expect(screen.getByTestId("confirm-error-membership-conflict").textContent).toBe(
        "Something went wrong creating this session. Please try again.",
      ),
    );
    expect(screen.queryByTestId("confirm-error-team-unavailable")).toBeNull();
  });

  it("a network error keeps the existing generic error", async () => {
    const fetchMock = mockFetchSequence({ jsonBody: listBody });
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderPage();
    await waitFor(() => expect(screen.getByTestId("picker-team-team-2")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("picker-team-team-2"));
    await userEvent.click(screen.getByTestId("confirm-create-session"));
    await waitFor(() =>
      expect(screen.getByTestId("confirm-error-membership-conflict").textContent).toBe(
        "Network error creating this session. Please try again.",
      ),
    );
    expect(screen.queryByTestId("confirm-error-team-unavailable")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// template-team-not-usable (#214) tasks.md 7.3: the template is no longer
// listed, so an empty list can now mean "the template was the only otherwise
// eligible team". The existing empty states render, with no new copy.
// ---------------------------------------------------------------------------
describe("SessionCreationPage — empty list because the template was the only eligible team (#214)", () => {
  it("a facilitator who belongs to every real team sees the existing with-memberships empty state", async () => {
    setSession({ teamMemberships: [{ teamId: "team-1", teamName: "Home Team", role: "participant" }] as AuthSession["teamMemberships"] });
    mockFetchSequence({ jsonBody: { eligibleTeams: [], callerHasTeamMemberships: true } });
    renderPage();

    await waitFor(() => expect(screen.getByTestId("picker-empty-state")).toBeInTheDocument());
    expect(screen.getByTestId("picker-empty-state").textContent).toBe(EMPTY_STATE_WITH_MEMBERSHIPS);
    expect(screen.getByTestId("picker-create-new-team")).toBeInTheDocument();
  });

  it("a fresh install (zero memberships, the template is the only team) shows the zero-home-team empty state with its Create control", async () => {
    mockFetchSequence({ jsonBody: { eligibleTeams: [], callerHasTeamMemberships: false } });
    renderPage();

    await waitFor(() => expect(screen.getByTestId("picker-empty-state")).toBeInTheDocument());
    expect(screen.getByTestId("picker-empty-state").textContent).toBe(EMPTY_STATE_WITHOUT_MEMBERSHIPS);
    expect(screen.getByTestId("picker-create-new-team")).toBeInTheDocument();
    expect(screen.queryByText("__default_topics__")).toBeNull();
  });
});
