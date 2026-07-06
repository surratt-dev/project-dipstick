import { useSearchParams } from "react-router-dom";

// JoinErrorPage renders the error destination for both the direct join path
// (GET /api/join/:token) and the through-auth join path (GET /auth/callback
// with a pendingJoinToken). Both paths redirect to /join-error?joinError=...
// so users see the same error experience regardless of which code path their
// browser followed.
//
// This route must remain accessible without authentication (no ProtectedRoute
// wrapper). A user whose join link failed after OIDC may not have an active
// session, and requiring auth would send them into another redirect loop.
//
// No "Try Again" CTA is included. The correct path forward is to contact the
// person who shared the link — re-initiating the OIDC flow without a valid
// join token produces a second failure, not a recovery.
export function JoinErrorPage() {
  const [searchParams] = useSearchParams();
  const joinError = searchParams.get("joinError");

  let primaryMessage: string;
  if (joinError === "expired") {
    primaryMessage =
      "This link has expired. Ask your facilitator for a new one.";
  } else {
    // Treat any unrecognised or missing joinError value as invalid.
    primaryMessage = "This link is not valid.";
  }

  const secondaryMessage =
    "If this is your first time using this tool, sign out and ask the person who invited you for a new link.";

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "2rem",
        maxWidth: "480px",
        margin: "0 auto",
      }}
    >
      <p>{primaryMessage}</p>
      <p style={{ color: "#555", fontSize: "0.9rem" }}>{secondaryMessage}</p>
    </div>
  );
}
