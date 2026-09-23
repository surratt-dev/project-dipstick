import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { SignOutButton } from "../components/SignOutButton.js";
import { AuthLoadingPage } from "./AuthLoadingPage.js";

export function NoTeamPage() {
  const { session, loading } = useAuth();

  // Match the loading guard pattern used in AuthenticatedLanding: show a
  // loading state while the session is resolving, then apply the redirect.
  // Without this guard, session would be null and the membership check below
  // would throw.
  if (loading) {
    return <AuthLoadingPage />;
  }

  // Task 6 — Bookmark guard: if the user has joined a team since this page
  // was last rendered, redirect them to their team view. This covers the
  // scenario where a user bookmarks /no-team and returns after joining a team.
  // Reads live session state — the session is re-fetched on each mount via
  // AuthContext.
  if (session && session.teamMemberships.length > 0) {
    return (
      <Navigate to={`/team/${session.teamMemberships[0]!.teamId}`} replace />
    );
  }

  // session-creation-existing-team design.md Decision D5's routing carve-out:
  // a zero-membership facilitator must reach the session-creation entry point,
  // never the participant-facing /no-team copy. The OIDC callback's
  // server-side redirect (packages/backend/src/routes/auth.ts) only looks at
  // team_memberships and sends every zero-membership user here regardless of
  // facilitator status, so this client-side guard is the actual enforcement
  // point for the carve-out on the real sign-in path.
  if (session && session.canFacilitateSessions) {
    return <Navigate to="/sessions/new" replace />;
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "480px", margin: "0 auto" }}>
      <h1>Welcome, {session?.user.displayName}</h1>
      <p>You are signed in but not yet a member of any team.</p>
      <p>
        To get started, ask your facilitator for a join link. Once you follow
        the link, you will be added to the team automatically.
      </p>
      <p style={{ color: "#666", fontSize: "0.9rem" }}>
        No further setup is required on your end.
      </p>
      <div style={{ marginTop: "2rem" }}>
        <SignOutButton />
      </div>
    </div>
  );
}
