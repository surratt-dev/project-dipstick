import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext.js";
import { ProtectedRoute } from "./auth/ProtectedRoute.js";
import { NoTeamPage } from "./pages/NoTeamPage.js";
import { TeamPage } from "./pages/TeamPage.js";
import { AuthErrorPage } from "./pages/AuthErrorPage.js";
import { AuthLoadingPage } from "./pages/AuthLoadingPage.js";

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
            path="/session/:sessionId"
            element={
              <ProtectedRoute>
                <div style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
                  <h1>Session</h1>
                  <p>Session view placeholder.</p>
                </div>
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
