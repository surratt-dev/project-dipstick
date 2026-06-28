import { useSearchParams } from "react-router-dom";

export function AuthErrorPage() {
  const [searchParams] = useSearchParams();
  const category = searchParams.get("category") ?? "authentication_failed";
  const message =
    searchParams.get("message") ??
    "An error occurred during sign-in. Please try again.";
  const correlationId = searchParams.get("correlationId");

  const isRetryable =
    category === "provider_unavailable" || category === "invalid_request";

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "2rem",
        maxWidth: "480px",
        margin: "0 auto",
      }}
    >
      <h1>Sign-in Error</h1>
      <p>{message}</p>

      {isRetryable && (
        <button
          onClick={() => {
            window.location.href = "/auth/login";
          }}
          style={{
            padding: "0.5rem 1rem",
            marginTop: "1rem",
            cursor: "pointer",
          }}
        >
          Try Again
        </button>
      )}

      {!isRetryable && (
        <p style={{ color: "#666", fontSize: "0.9rem", marginTop: "1rem" }}>
          If this problem persists, contact your IT administrator.
        </p>
      )}

      {correlationId && (
        <p
          style={{ color: "#999", fontSize: "0.8rem", marginTop: "1rem" }}
        >
          Reference: {correlationId}
        </p>
      )}
    </div>
  );
}
