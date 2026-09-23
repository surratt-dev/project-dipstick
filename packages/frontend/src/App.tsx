import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext.js";
import { ProtectedRoute } from "./auth/ProtectedRoute.js";
import { NoTeamPage } from "./pages/NoTeamPage.js";
import { TeamPage } from "./pages/TeamPage.js";
import { AuthErrorPage } from "./pages/AuthErrorPage.js";
import { AuthLoadingPage } from "./pages/AuthLoadingPage.js";
import { DevLoginPage } from "./pages/DevLoginPage.js";
import { JoinErrorPage } from "./pages/JoinErrorPage.js";
import { SessionLobbyPage } from "./pages/SessionLobbyPage.js";
import { SessionConnectionHost } from "./pages/SessionConnectionHost.js";
import { FacilitatorConnectionHost } from "./pages/FacilitatorConnectionHost.js";
import { EmTeamDashboardPage } from "./pages/EmTeamDashboardPage.js";
import { EmSessionHistoryPage } from "./pages/EmSessionHistoryPage.js";
import { EmTrendDataPage } from "./pages/EmTrendDataPage.js";
import { EmActionItemsPage } from "./pages/EmActionItemsPage.js";
import { SessionCreationPage } from "./pages/SessionCreationPage.js";
import { DraftSessionHost } from "./pages/DraftSessionHost.js";

// session-creation-existing-team design.md Decision D5. Routing carve-out
// order:
//   1. teamMemberships.length > 0 -> existing team-view routing (unchanged).
//   2. Else, canFacilitateSessions === true -> session-creation entry point.
//   3. Else -> /no-team (unchanged participant-facing copy).
function AuthenticatedLanding() {
  const { session, loading } = useAuth();

  if (loading) {
    return <AuthLoadingPage />;
  }

  if (!session) return null;

  if (session.teamMemberships.length > 0) {
    return <Navigate to={`/team/${session.teamMemberships[0]!.teamId}`} replace />;
  }

  if (session.canFacilitateSessions) {
    return <Navigate to="/sessions/new" replace />;
  }

  return <Navigate to="/no-team" replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/auth/error" element={<AuthErrorPage />} />
          <Route path="/auth/loading" element={<AuthLoadingPage />} />
          {/*
           * persona-login design.md D9: registered alongside /auth/error and
           * /auth/loading, outside ProtectedRoute, no shared layout. This is
           * the same pattern those routes already use -- a public page
           * AuthContext client-side navigates to on a 401 when the local-dev
           * shortcut is available, instead of the standard hard redirect.
           */}
          <Route path="/auth/dev-login" element={<DevLoginPage />} />
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
           * session-creation-existing-team: the picker -> confirm -> create
           * flow for a facilitator creating a session for an existing team.
           * SessionCreationPage itself checks canFacilitateSessions and
           * redirects (design.md D5's gate) -- ProtectedRoute only verifies
           * session presence, matching every other route in this file.
           */}
          <Route
            path="/sessions/new"
            element={
              <ProtectedRoute>
                <SessionCreationPage />
              </ProtectedRoute>
            }
          />
          {/*
           * session-creation-existing-team, design.md Decision D6: a real,
           * bookmarkable route for the facilitator's own draft control view
           * (before "Open the room") and, after advancing, the live
           * participant-readiness view -- one shared host component,
           * rehydrated via GET .../facilitator-state on every mount so a
           * refresh, direct hit, or the POST /draft 409's resume affordance
           * all land in the same place. No client-side facilitator-only
           * gate here beyond ProtectedRoute's session check: the
           * facilitator-state endpoint already enforces
           * facilitator_id === caller server-side (task 7.12).
           */}
          <Route
            path="/team/:teamId/session/:sessionId"
            element={
              <ProtectedRoute>
                <DraftSessionHost />
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
          {/*
           * KNOWN DEFERRED GAP (implementation-review-architect.md item 2,
           * websocket-staleness-signal): ProtectedRoute only checks session
           * presence, not whether this user is the facilitator of
           * :sessionId. There is currently no client-side concept of
           * "session facilitator" to check against — AuthSession carries
           * only global identity and per-team MembershipRole
           * ("participant" | "engineering_manager"); the facilitator
           * determination (sessions.facilitator_id, see
           * session-subscriber-access-helper.ts) is per-session backend
           * state the frontend never fetches. This is harmless today
           * because FacilitatorConnectionHost renders only STUB_ROWS, a
           * hardcoded fixture — no real participant data is reachable here.
           * The server-side WS-subscription check
           * (evaluateSessionSubscriberAccess, websocket-routes.ts) already
           * enforces facilitator-only access to the underlying event
           * stream, so there is no live vulnerability. BUT: the moment real
           * per-participant data is wired into this host (the natural next
           * step once disconnected_voted/disconnected_no_vote rows become
           * real, OR-4.4's facilitator-only readiness grid), a client-side
           * facilitator-role check MUST be added here — either a
           * role-aware ProtectedRoute variant or a check inside
           * FacilitatorConnectionHost — matching the server-side
           * enforcement that already exists. Do not treat the absence of a
           * client-side gate today as evidence one isn't needed later.
           */}
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
