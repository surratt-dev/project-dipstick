import { useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { SignOutButton } from "../components/SignOutButton.js";

// ---------------------------------------------------------------------------
// SessionLobbyPage — pre-session participant waiting view
//
// This is the page participants see while waiting for a session to begin.
// The access model statement (Decision 8, task 7.1) is required here as well
// as in the team view. Both surfaces are required — Decision 8 states "and"
// not "or".
//
// Statement: "Your Engineering Manager can see session history but cannot
// join or observe live sessions."
//
// Placement: Findable but NOT prominent (Decision 8 / task 7.2):
//   - No modal, no acknowledgment flow, no notification on page load
//   - Static contextual note below the session info
// ---------------------------------------------------------------------------

export function SessionLobbyPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { session } = useAuth();

  if (!session) return null;

  return (
    <div
      data-testid="session-lobby"
      style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}
    >
      <h1>Session Lobby</h1>

      <p data-testid="session-lobby-info">
        Session <strong>{sessionId}</strong> — waiting for the facilitator to start.
      </p>

      {/* -----------------------------------------------------------------------
          Access model statement (Decision 8, task 7.1):
          Required in BOTH the team view (MemberManagement component) AND the
          session lobby (this component). Both surfaces are required — Decision 8
          uses "and" not "or".

          Placement: findable but not prominent per task 7.2.
          No modal, no acknowledgment, no notification on page load (task 7.3).
      ----------------------------------------------------------------------- */}
      <p
        data-testid="session-lobby-access-model-statement"
        style={{
          fontSize: "0.875rem",
          color: "#555",
          marginTop: "1rem",
          borderTop: "1px solid #e0e0e0",
          paddingTop: "0.75rem",
        }}
      >
        Your Engineering Manager can see session history but cannot join or observe live sessions.
      </p>

      <div style={{ marginTop: "2rem" }}>
        <SignOutButton />
      </div>
    </div>
  );
}
