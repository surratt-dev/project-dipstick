import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { SessionCreationPage } from "../SessionCreationPage.js";
import type { EligibleTeamsResponse, SessionAlreadyExistsResponse, TeamNameCollisionResponse } from "@dipstick/shared";
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/sessions/new"]}>
      <Routes>
        <Route path="/sessions/new" element={<SessionCreationPage />} />
      </Routes>
    </MemoryRouter>,
  );
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

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(screen.getByTestId("picker-empty-state").textContent).toMatch(/already a member of every team/i);
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
