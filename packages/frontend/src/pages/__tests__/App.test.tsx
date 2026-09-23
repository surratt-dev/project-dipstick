import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Navigate } from "react-router-dom";
import type { AuthSession } from "@dipstick/shared";

// We test the integrated routing by reconstructing the key pieces
// but using MemoryRouter instead of BrowserRouter for test isolation.

vi.mock("../AuthErrorPage.js", async (importOriginal) => importOriginal());
vi.mock("../AuthLoadingPage.js", async (importOriginal) => importOriginal());

// Mock AuthContext to control session state
const mockUseAuth = vi.fn<() => { session: AuthSession | null; loading: boolean }>();

vi.mock("../../auth/AuthContext.js", () => ({
  useAuth: () => mockUseAuth(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../../components/SignOutButton.js", () => ({
  SignOutButton: () => <button>Sign out mock</button>,
}));

// Import components that use the mocked auth
import { AuthErrorPage } from "../AuthErrorPage.js";
import { AuthLoadingPage } from "../AuthLoadingPage.js";
import { NoTeamPage } from "../NoTeamPage.js";
import { TeamPage } from "../TeamPage.js";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = mockUseAuth();
  if (loading) return <p>Loading...</p>;
  if (!session) return null;
  return <>{children}</>;
}

// session-creation-existing-team design.md Decision D5's routing carve-out
// order, reconstructed here the same way this file already reconstructs the
// rest of App's routing rather than importing App directly.
function AuthenticatedLanding() {
  const { session, loading } = mockUseAuth();
  if (loading) return <AuthLoadingPage />;
  if (!session) return null;
  if (session.teamMemberships.length > 0) {
    return <Navigate to={`/team/${session.teamMemberships[0]!.teamId}`} replace />;
  }
  if (session.canFacilitateSessions) {
    return <Navigate to="/sessions/new" replace />;
  }
  return <Navigate to="/no-team" replace />;
}

function SessionCreationPageStub() {
  return <p>Session creation entry point</p>;
}

function TestApp({ initialEntry = "/" }: { initialEntry?: string }) {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/auth/error" element={<AuthErrorPage />} />
        <Route path="/auth/loading" element={<AuthLoadingPage />} />
        <Route
          path="/no-team"
          element={
            <ProtectedRoute>
              <NoTeamPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/team/:teamId"
          element={
            <ProtectedRoute>
              <TeamPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sessions/new"
          element={
            <ProtectedRoute>
              <SessionCreationPageStub />
            </ProtectedRoute>
          }
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AuthenticatedLanding />
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("App routing", () => {
  it("renders auth error page at /auth/error", () => {
    mockUseAuth.mockReturnValue({ session: null, loading: false });
    render(<TestApp initialEntry="/auth/error?message=bad" />);
    expect(screen.getByText("Sign-in Error")).toBeInTheDocument();
  });

  it("renders auth loading page at /auth/loading", () => {
    mockUseAuth.mockReturnValue({ session: null, loading: false });
    render(<TestApp initialEntry="/auth/loading" />);
    expect(screen.getByText("Signing you in...")).toBeInTheDocument();
  });

  it("redirects to /no-team when user has no teams", () => {
    const session: AuthSession = {
      user: { id: "u1", displayName: "Alice", email: "a@b.com" },
      teamMemberships: [],
      sessionCreatedAt: "",
      expiresAt: "",
      canFacilitateSessions: false,
    };
    mockUseAuth.mockReturnValue({ session, loading: false });
    render(<TestApp initialEntry="/" />);
    expect(screen.getByText(/Welcome, Alice/)).toBeInTheDocument();
  });

  it("redirects to team page when user has teams", () => {
    const session: AuthSession = {
      user: { id: "u1", displayName: "Alice", email: "a@b.com" },
      teamMemberships: [{ teamId: "t1", teamName: "Alpha", role: "member" }],
      sessionCreatedAt: "",
      expiresAt: "",
      canFacilitateSessions: false,
    };
    mockUseAuth.mockReturnValue({ session, loading: false });
    render(<TestApp initialEntry="/" />);
    expect(screen.getByText("Team")).toBeInTheDocument();
  });

  it("shows loading state at root when loading", () => {
    mockUseAuth.mockReturnValue({ session: null, loading: true });
    render(<TestApp initialEntry="/" />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  // Task 18: Routing layer test — /no-team renders no navigation elements.
  //
  // This test locks in the constraint from Task 9 / design.md: the /no-team
  // route must never be rendered inside a layout component that contributes
  // navigation elements. If any future change wraps this route in a <Layout>,
  // <AppShell>, or similar, this test will fail and make the regression visible.
  it("Task 18 — renders no navigation elements at /no-team", () => {
    const session: AuthSession = {
      user: { id: "u1", displayName: "Alice", email: "a@b.com" },
      teamMemberships: [],
      sessionCreatedAt: "",
      expiresAt: "",
      canFacilitateSessions: false,
    };
    mockUseAuth.mockReturnValue({ session, loading: false });
    render(<TestApp initialEntry="/no-team" />);

    // No <nav> element
    expect(document.querySelector("nav")).toBeNull();

    // No element with the navigation landmark role
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();

    // The no-team content IS rendered (verify the page loaded correctly)
    expect(screen.getByText(/Welcome, Alice/)).toBeInTheDocument();
  });

  // session-creation-existing-team design.md Decision D5, tasks.md 5.4-5.6
  describe("canFacilitateSessions routing carve-out (design.md Decision D5)", () => {
    it("5.4: a user with canFacilitateSessions: false never sees the session-creation entry point, even with zero team memberships", () => {
      const session: AuthSession = {
        user: { id: "u1", displayName: "Alice", email: "a@b.com" },
        teamMemberships: [],
        sessionCreatedAt: "",
        expiresAt: "",
        canFacilitateSessions: false,
      };
      mockUseAuth.mockReturnValue({ session, loading: false });
      render(<TestApp initialEntry="/" />);
      expect(screen.queryByText("Session creation entry point")).not.toBeInTheDocument();
      expect(screen.getByText(/Welcome, Alice/)).toBeInTheDocument();
    });

    it("5.5: a user with zero team memberships and canFacilitateSessions: true is routed to the session-creation entry point, not /no-team", () => {
      const session: AuthSession = {
        user: { id: "u1", displayName: "Alice", email: "a@b.com" },
        teamMemberships: [],
        sessionCreatedAt: "",
        expiresAt: "",
        canFacilitateSessions: true,
      };
      mockUseAuth.mockReturnValue({ session, loading: false });
      render(<TestApp initialEntry="/" />);
      expect(screen.getByText("Session creation entry point")).toBeInTheDocument();
      expect(screen.queryByText(/Welcome, Alice/)).not.toBeInTheDocument();
    });

    it("5.6: /no-team page content and copy are unchanged for a canFacilitateSessions: false user", () => {
      const session: AuthSession = {
        user: { id: "u1", displayName: "Alice", email: "a@b.com" },
        teamMemberships: [],
        sessionCreatedAt: "",
        expiresAt: "",
        canFacilitateSessions: false,
      };
      mockUseAuth.mockReturnValue({ session, loading: false });
      render(<TestApp initialEntry="/no-team" />);
      expect(
        screen.getByText(/ask your facilitator for a join link/i),
      ).toBeInTheDocument();
    });

    // Closes the drift the Solution Architect found: the real OIDC callback
    // redirect keys only on team_memberships and lands a zero-membership
    // facilitator on /no-team directly (never on "/"), so
    // AuthenticatedLanding's carve-out above is dead code for that path. This
    // test drives NoTeamPage the way the real redirect does -- entering at
    // /no-team, not at "/" -- to prove the carve-out holds there too.
    it("a zero-membership facilitator landing directly on /no-team (the real post-auth redirect target) is routed to /sessions/new", () => {
      const session: AuthSession = {
        user: { id: "u1", displayName: "Alice", email: "a@b.com" },
        teamMemberships: [],
        sessionCreatedAt: "",
        expiresAt: "",
        canFacilitateSessions: true,
      };
      mockUseAuth.mockReturnValue({ session, loading: false });
      render(<TestApp initialEntry="/no-team" />);
      expect(screen.getByText("Session creation entry point")).toBeInTheDocument();
      expect(screen.queryByText(/not yet a member of any team/)).not.toBeInTheDocument();
    });

    it("a user with existing team memberships is routed to their team regardless of canFacilitateSessions", () => {
      const session: AuthSession = {
        user: { id: "u1", displayName: "Alice", email: "a@b.com" },
        teamMemberships: [{ teamId: "t1", teamName: "Alpha", role: "participant" }],
        sessionCreatedAt: "",
        expiresAt: "",
        canFacilitateSessions: true,
      };
      mockUseAuth.mockReturnValue({ session, loading: false });
      render(<TestApp initialEntry="/" />);
      expect(screen.getByText("Team")).toBeInTheDocument();
    });
  });
});
