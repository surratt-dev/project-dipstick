import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
});
