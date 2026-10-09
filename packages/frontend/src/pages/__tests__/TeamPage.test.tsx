import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import type { AuthSession } from "@dipstick/shared";
import { TeamPage } from "../TeamPage.js";

vi.mock("../../auth/AuthContext.js", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../components/SignOutButton.js", () => ({
  SignOutButton: () => <button>Sign out mock</button>,
}));

import { useAuth } from "../../auth/AuthContext.js";

const mockSession = {
  user: { id: "u1", displayName: "Alice", email: "alice@test.com" },
  teamMemberships: [
    { teamId: "t1", teamName: "Alpha", role: "facilitator" as const },
    { teamId: "t2", teamName: "Beta", role: "member" as const },
  ],
  sessionCreatedAt: "",
  expiresAt: "",
};

describe("TeamPage", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ loading: false, session: mockSession });
  });

  it("renders null when no session", () => {
    vi.mocked(useAuth).mockReturnValue({ loading: false, session: null });
    const { container } = render(
      <MemoryRouter>
        <TeamPage />
      </MemoryRouter>,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders team memberships", () => {
    render(
      <MemoryRouter>
        <TeamPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(screen.getByText("Alpha (facilitator)")).toBeInTheDocument();
    expect(screen.getByText("Beta (member)")).toBeInTheDocument();
  });

  it("shows alreadyMember notification when param is present", () => {
    render(
      <MemoryRouter initialEntries={["/team/t1?alreadyMember=true"]}>
        <TeamPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("You are already a member of this team.")).toBeInTheDocument();
  });

  it("does not show notification without alreadyMember param", () => {
    render(
      <MemoryRouter initialEntries={["/team/t1"]}>
        <TeamPage />
      </MemoryRouter>,
    );
    expect(screen.queryByText("You are already a member of this team.")).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Task 11.10 — New-member welcome banner (?newMember=true)
  // ---------------------------------------------------------------------------

  it("11.10: renders new-member banner with correct content when ?newMember=true is present", () => {
    render(
      <MemoryRouter initialEntries={["/team/t1?newMember=true"]}>
        <TeamPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        "You've joined the team. Your facilitator will share what comes next.",
      ),
    ).toBeInTheDocument();
  });

  it("11.10: does not render new-member banner when ?newMember=true is absent", () => {
    render(
      <MemoryRouter initialEntries={["/team/t1"]}>
        <TeamPage />
      </MemoryRouter>,
    );

    expect(
      screen.queryByText(
        "You've joined the team. Your facilitator will share what comes next.",
      ),
    ).not.toBeInTheDocument();
  });

  it("11.10: a fresh render without ?newMember=true does not show the banner (replace navigation removes the param)", () => {
    // The component calls setSearchParams(params, { replace: true }) to remove
    // ?newMember=true without adding a browser history entry. We verify the
    // complement of this behavior in a unit test: a component mounted without
    // the param shows no banner. This is the observable end state after the
    // replace navigation has run.
    render(
      <MemoryRouter initialEntries={["/team/t1"]}>
        <TeamPage />
      </MemoryRouter>,
    );

    expect(
      screen.queryByText(
        "You've joined the team. Your facilitator will share what comes next.",
      ),
    ).not.toBeInTheDocument();
  });

  it("11.10: does not show already-member banner when only ?newMember=true is present", () => {
    render(
      <MemoryRouter initialEntries={["/team/t1?newMember=true"]}>
        <TeamPage />
      </MemoryRouter>,
    );

    // Only the new-member banner, not the already-member banner
    expect(
      screen.queryByText("You are already a member of this team."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "You've joined the team. Your facilitator will share what comes next.",
      ),
    ).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // remove-topic, design.md Decision 10's nav-entry-point resolution
  // (tasks.md Task 9.6) — a discoverable link to Topic Management.
  //
  // #232 (design.md D7): this link must NOT be hidden by role or membership
  // (for example for an administrator who manages the team). The server
  // (TOPIC-002) is the only gate; the screen explains a 403 itself.
  // ---------------------------------------------------------------------------
  it("renders a discoverable Topics nav link to /team/:teamId/topics", () => {
    render(
      <MemoryRouter initialEntries={["/team/t1"]}>
        <Routes>
          <Route path="/team/:teamId" element={<TeamPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const link = screen.getByTestId("nav-topic-management");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/team/t1/topics");
  });
});

// ---------------------------------------------------------------------------
// facilitator-session-entry-point (#237), tasks.md 1.1, design D1-D4.
//
// Fixture note (E6): the `mockSession` above predates canFacilitateSessions
// and uses membership roles that do not exist ("facilitator", "member"). It
// is deliberately left alone (D2 checks `=== true`, so the existing tests run
// with the flag undefined and the block absent). These tests use a correctly
// typed sibling fixture with real membership roles and team names that
// cannot collide with words in the link label.
// ---------------------------------------------------------------------------
function makeSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    user: { id: "u1", displayName: "Alice", email: "alice@test.com" },
    teamMemberships: [{ teamId: "t1", teamName: "Alpha", role: "participant" }],
    sessionCreatedAt: "",
    expiresAt: "",
    canFacilitateSessions: true,
    ...overrides,
  };
}

function setSession(session: AuthSession) {
  vi.mocked(useAuth).mockReturnValue({
    loading: false,
    session,
    refreshSession: vi.fn(async () => {}),
  });
}

// Renders `data-testid="at-picker"` and exposes the navigation state it was
// reached with, so a test can assert the link carried no team context (G1).
function PickerSentinel() {
  const location = useLocation();
  return (
    <div data-testid="at-picker" data-has-state={String(location.state != null)} />
  );
}

function renderTeamRoute(teamId: string) {
  return render(
    <MemoryRouter initialEntries={[`/team/${teamId}`]}>
      <Routes>
        <Route path="/team/:teamId" element={<TeamPage />} />
        <Route path="/sessions/new" element={<PickerSentinel />} />
      </Routes>
    </MemoryRouter>,
  );
}

const FORBIDDEN_LABELS = ["start a session", "create a session", "facilitate"];

describe("TeamPage — facilitator entry point (facilitator-session-entry-point)", () => {
  it("(a) a facilitator with one membership sees a link to exactly /sessions/new and one click reaches the picker with no navigation state", () => {
    setSession(makeSession());
    renderTeamRoute("t1");

    const link = screen.getByTestId("nav-facilitate-session");
    expect(link).toHaveAttribute("href", "/sessions/new");

    fireEvent.click(link);

    const sentinel = screen.getByTestId("at-picker");
    expect(sentinel).toBeInTheDocument();
    // D3 / G1: the link carries no team context in navigation state.
    expect(sentinel).toHaveAttribute("data-has-state", "false");
  });

  it("(b) the same link and navigation work on the second team's view for a facilitator with two memberships", () => {
    setSession(
      makeSession({
        teamMemberships: [
          { teamId: "t1", teamName: "Alpha", role: "participant" },
          { teamId: "t2", teamName: "Beta", role: "participant" },
        ],
      }),
    );
    renderTeamRoute("t2");

    const link = screen.getByTestId("nav-facilitate-session");
    expect(link).toHaveAttribute("href", "/sessions/new");

    fireEvent.click(link);

    const sentinel = screen.getByTestId("at-picker");
    expect(sentinel).toHaveAttribute("data-has-state", "false");
  });

  it("(c) the link label names no team and is not a bare start/create/facilitate label", () => {
    const session = makeSession({
      teamMemberships: [
        { teamId: "t1", teamName: "Alpha", role: "participant" },
        { teamId: "t2", teamName: "Beta", role: "participant" },
      ],
    });
    setSession(session);
    renderTeamRoute("t1");

    const text = (screen.getByTestId("nav-facilitate-session").textContent ?? "").trim();
    expect(text.length).toBeGreaterThan(0);
    for (const m of session.teamMemberships) {
      expect(text.toLowerCase()).not.toContain(m.teamName.toLowerCase());
    }
    expect(FORBIDDEN_LABELS).not.toContain(text.toLowerCase());
  });

  it("(c2) the shipped label and helper strings are exact", () => {
    setSession(makeSession());
    renderTeamRoute("t1");

    expect(screen.getByTestId("nav-facilitate-session")).toHaveTextContent(
      /^Facilitate another team's session$/,
    );
    expect(screen.getByText("You can't facilitate your own team.")).toBeInTheDocument();
  });

  it("(d) an Engineer (canFacilitateSessions false, participant membership) gets no link to /sessions/new", () => {
    setSession(makeSession({ canFacilitateSessions: false }));
    const { container } = renderTeamRoute("t1");

    expect(screen.queryByTestId("nav-facilitate-session")).toBeNull();
    expect(screen.queryByTestId("team-facilitator-block")).toBeNull();
    expect(container.querySelector('[href="/sessions/new"]')).toBeNull();
  });

  // R4, frontend half. An EM who was also sent the facilitator group resolves
  // to engineering_manager by the #243 role precedence, so /auth/session
  // reports canFacilitateSessions: false and this is the state the page sees.
  // The backend half is covered by:
  //   - auth.test.ts: "returns canFacilitateSessions: false for an engineering_manager caller (R4)"
  //   - role-map.test.ts: the resolveRoleSet precedence row
  //     ["Eng-Managers", "Retro-Facilitators"] -> engineering_manager
  //   - account-resolver.test.ts: "[engineering_manager, facilitator] returning"
  //   - role-claim-persistence-integration.test.ts: "a user sent both the
  //     manager and facilitator groups is stored as engineering_manager (#238)"
  it("(e) an Engineering Manager (canFacilitateSessions false, engineering_manager membership) gets no link to /sessions/new", () => {
    setSession(
      makeSession({
        canFacilitateSessions: false,
        teamMemberships: [{ teamId: "t1", teamName: "Alpha", role: "engineering_manager" }],
      }),
    );
    const { container } = renderTeamRoute("t1");

    expect(screen.queryByTestId("nav-facilitate-session")).toBeNull();
    expect(screen.queryByTestId("team-facilitator-block")).toBeNull();
    expect(container.querySelector('[href="/sessions/new"]')).toBeNull();
  });

  // R5. The "that team is not offered by the picker" half is server-side:
  // facilitator-sessions.test.ts "the eligibility query excludes the caller's
  // own team memberships via its WHERE clause" (no membership-role predicate).
  it("(f) a facilitator holding an engineering_manager membership on the viewed team still sees the link", () => {
    setSession(
      makeSession({
        teamMemberships: [{ teamId: "t1", teamName: "Alpha", role: "engineering_manager" }],
      }),
    );
    renderTeamRoute("t1");

    expect(screen.getByTestId("nav-facilitate-session")).toHaveAttribute("href", "/sessions/new");
  });

  it("(g) the Facilitator block sits after the Team heading, before Members, and does not contain the Topics link", () => {
    setSession(makeSession());
    renderTeamRoute("t1");

    const block = screen.getByTestId("team-facilitator-block");
    const teamHeading = screen.getByRole("heading", { level: 1, name: "Team" });
    const membersHeading = screen.getByRole("heading", { level: 2, name: "Members" });
    const topicsLink = screen.getByTestId("nav-topic-management");

    expect(
      teamHeading.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      block.compareDocumentPosition(membersHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(block.contains(topicsLink)).toBe(false);
  });
});

// Suppress the act() warnings from the auto-dismiss timer in tests that don't
// need to observe timer behaviour — they fire after the test completes.
void act;
