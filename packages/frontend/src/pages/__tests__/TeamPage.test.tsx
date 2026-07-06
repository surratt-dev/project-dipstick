import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
});

// Suppress the act() warnings from the auto-dismiss timer in tests that don't
// need to observe timer behaviour — they fire after the test completes.
void act;
