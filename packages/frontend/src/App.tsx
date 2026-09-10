import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext.js";
import { ProtectedRoute } from "./auth/ProtectedRoute.js";
import { NoTeamPage } from "./pages/NoTeamPage.js";
import { TeamPage } from "./pages/TeamPage.js";
import { AuthErrorPage } from "./pages/AuthErrorPage.js";
import { AuthLoadingPage } from "./pages/AuthLoadingPage.js";
import { JoinErrorPage } from "./pages/JoinErrorPage.js";
import { SessionLobbyPage } from "./pages/SessionLobbyPage.js";
import { SessionConnectionHost } from "./pages/SessionConnectionHost.js";
import { FacilitatorConnectionHost } from "./pages/FacilitatorConnectionHost.js";
import { EmTeamDashboardPage } from "./pages/EmTeamDashboardPage.js";
import { EmSessionHistoryPage } from "./pages/EmSessionHistoryPage.js";
import { EmTrendDataPage } from "./pages/EmTrendDataPage.js";
import { EmActionItemsPage } from "./pages/EmActionItemsPage.js";

function AuthenticatedLanding() {
  const { session, loading } = useAuth();

  if (loading) {
    return <AuthLoadingPage />;
  }

  if (!session) return null;

  if (session.teamMemberships.length === 0) {
    return <Navigate to="/no-team" replace />;
  }

  return <Navigate to={`/team/${session.teamMemberships[0]!.teamId}`} replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/auth/error" element={<AuthErrorPage />} />
          <Route path="/auth/loading" element={<AuthLoadingPage />} />
          {/*
           * /join-error is intentionally NOT wrapped in ProtectedRoute. A user
           * whose join link failed after OIDC authentication may not have an
           * active session; requiring auth here would send them into another
           * redirect loop. Analogous to /auth/error.
           */}
          <Route path="/join-error" element={<JoinErrorPage />} />
          {/*
           * Task 9 verification: The /no-team route is intentionally NOT
           * wrapped in any layout component that contributes navigation
           * elements (no <Layout>, <AppShell>, <Shell>, <Navigation>, or
           * similar). Users who arrive at /no-team have no team memberships
           * and must not see application navigation that presupposes
           * membership. This is a structural requirement enforced at the
           * routing layer — the NoTeamPage component alone cannot guarantee
           * isolation if a layout wrapper is added here. A regression test in
           * src/pages/__tests__/App.test.tsx locks this state so that future
           * additions of layout wrappers to other routes do not silently
           * include this route.
           */}
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
          {/*
           * Session lobby — where participants wait before a session begins.
           * The access model statement (Decision 8, task 7.1) is rendered here
           * as a static contextual note. Both this surface and the team view
           * are required — Decision 8 uses "and" not "or".
           */}
          <Route
            path="/session/:sessionId"
            element={
              <ProtectedRoute>
                <SessionLobbyPage />
              </ProtectedRoute>
            }
          />

          {/*
           * websocket-staleness-signal (design.md Decision D9): minimal host
           * surfaces mounting the connection-health banner and the
           * facilitator grid marker against a real session WebSocket
           * connection. Not feature-complete live-session pages — see
           * design.md's Non-Goals.
           */}
          <Route
            path="/session/:sessionId/live"
            element={
              <ProtectedRoute>
                <SessionConnectionHost />
              </ProtectedRoute>
            }
          />
          <Route
            path="/session/:sessionId/facilitator"
            element={
              <ProtectedRoute>
                <FacilitatorConnectionHost />
              </ProtectedRoute>
            }
          />

          {/*
           * EM read-only views — Phase 3 (establish-manager-team-relationship)
           * Routes are only useful to users with the engineering_manager global role
           * AND an active team_memberships row (TEAM-006 association). The backend
           * enforces both checks (Decision 14 dual authorization). An unauthorized
           * user who navigates here sees the 403 error state from the page component.
           */}
          <Route
            path="/team/:teamId/em"
            element={
              <ProtectedRoute>
                <EmTeamDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/team/:teamId/em/sessions"
            element={
              <ProtectedRoute>
                <EmSessionHistoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/team/:teamId/em/sessions/:sessionId"
            element={
              <ProtectedRoute>
                <EmSessionHistoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/team/:teamId/em/trends"
            element={
              <ProtectedRoute>
                <EmTrendDataPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/team/:teamId/em/trends/:topicId"
            element={
              <ProtectedRoute>
                <EmTrendDataPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/team/:teamId/em/action-items"
            element={
              <ProtectedRoute>
                <EmActionItemsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/team/:teamId/em/action-items/:actionItemId"
            element={
              <ProtectedRoute>
                <EmActionItemsPage />
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
      </AuthProvider>
    </BrowserRouter>
  );
}
