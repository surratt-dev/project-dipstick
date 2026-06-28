import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

function AuthenticatedLanding() {
  const { session, loading } = mockUseAuth();
  if (loading) return <AuthLoadingPage />;
  if (!session) return null;
  if (session.teamMemberships.length === 0) {
    return <Navigate to="/no-team" replace />;
  }
  return <Navigate to={`/team/${session.teamMemberships[0]!.teamId}`} replace />;
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
});
