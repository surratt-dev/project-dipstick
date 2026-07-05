import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { AuthSession } from "@dipstick/shared";
import { NoTeamPage } from "../NoTeamPage.js";

const mockUseAuth = vi.fn<() => { session: AuthSession | null; loading: boolean }>();

vi.mock("../../auth/AuthContext.js", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("../../components/SignOutButton.js", () => ({
  SignOutButton: () => <button>Sign out</button>,
}));

vi.mock("../AuthLoadingPage.js", () => ({
  AuthLoadingPage: () => <p>Loading...</p>,
}));

/** Render NoTeamPage within a MemoryRouter (required by Navigate). */
function renderNoTeamPage(additionalRoutes?: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={["/no-team"]}>
      <Routes>
        <Route path="/no-team" element={<NoTeamPage />} />
        {additionalRoutes}
      </Routes>
    </MemoryRouter>,
  );
}

const noTeamSession: AuthSession = {
  user: { id: "u1", displayName: "Bob", email: "bob@test.com" },
  teamMemberships: [],
  sessionCreatedAt: "",
  expiresAt: "",
};

const withTeamSession: AuthSession = {
  user: { id: "u1", displayName: "Bob", email: "bob@test.com" },
  teamMemberships: [{ teamId: "team-1", teamName: "Alpha", role: "participant" }],
  sessionCreatedAt: "",
  expiresAt: "",
};

describe("NoTeamPage", () => {
  it("displays user name and instructions when session has no teams", () => {
    mockUseAuth.mockReturnValue({ loading: false, session: noTeamSession });
    renderNoTeamPage();
    expect(screen.getByText("Welcome, Bob")).toBeInTheDocument();
    expect(screen.getByText(/not yet a member of any team/)).toBeInTheDocument();
    expect(screen.getByText("Sign out")).toBeInTheDocument();
  });

  it("shows loading page while session is loading", () => {
    mockUseAuth.mockReturnValue({ loading: true, session: null });
    renderNoTeamPage();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText(/not yet a member of any team/)).not.toBeInTheDocument();
  });

  // Task 16: No-team guard (bookmark redirect)

  it("Task 16a — renders no-team content when session has no team memberships", () => {
    mockUseAuth.mockReturnValue({ loading: false, session: noTeamSession });
    renderNoTeamPage(
      <Route path="/team/:teamId" element={<div>Team Page</div>} />,
    );
    expect(screen.getByText(/not yet a member of any team/)).toBeInTheDocument();
    expect(screen.queryByText("Team Page")).not.toBeInTheDocument();
  });

  it("Task 16b — redirects to /team/:teamId when session has team memberships", () => {
    mockUseAuth.mockReturnValue({ loading: false, session: withTeamSession });
    renderNoTeamPage(
      <Route path="/team/:teamId" element={<div>Team Page</div>} />,
    );
    // No-team content must not render
    expect(screen.queryByText(/not yet a member of any team/)).not.toBeInTheDocument();
    // The Navigate redirected to the team page
    expect(screen.getByText("Team Page")).toBeInTheDocument();
  });

  // Task 17: Content element assertions

  it("Task 17 — renders exactly the four required content elements and only one interactive element", () => {
    mockUseAuth.mockReturnValue({ loading: false, session: noTeamSession });
    renderNoTeamPage();

    // (a) User's display name
    expect(screen.getByText("Welcome, Bob")).toBeInTheDocument();

    // (b) Statement of no team membership
    expect(screen.getByText(/not yet a member of any team/)).toBeInTheDocument();

    // (c) Instruction to request a join link
    expect(screen.getByText(/ask your facilitator for a join link/i)).toBeInTheDocument();

    // (d) Sign-out affordance — the only interactive element
    const signOutButton = screen.getByRole("button");
    expect(signOutButton).toBeInTheDocument();
    expect(signOutButton).toHaveTextContent("Sign out");

    // Exactly one button — no other interactive elements
    expect(screen.getAllByRole("button")).toHaveLength(1);

    // No links or form inputs beyond the sign-out affordance
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });
});
