import { useState } from "react";

export function SignOutButton() {
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut(confirmed = false) {
    try {
      const url = confirmed ? "/auth/logout?confirmed=true" : "/auth/logout";
      const response = await fetch(url, {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        setError("Sign-out failed. You can close this browser window as a fallback.");
        return;
      }

      const data = (await response.json()) as {
        confirmRequired?: boolean;
        activeSessions?: string[];
        redirectUrl?: string;
      };

      if (data.confirmRequired) {
        setShowConfirm(true);
        return;
      }

      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else {
        window.location.href = "/";
      }
    } catch {
      setError(
        "Unable to reach the server. You can close this browser window to end your session.",
      );
    }
  }

  if (showConfirm) {
    return (
      <div>
        <p>
          You are in an active session. Signing out will remove you from the
          session. Continue?
        </p>
        <button
          onClick={() => void handleSignOut(true)}
          style={{ marginRight: "0.5rem", cursor: "pointer" }}
        >
          Yes, sign out
        </button>
        <button
          onClick={() => setShowConfirm(false)}
          style={{ cursor: "pointer" }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div>
      {error && <p style={{ color: "#c00" }}>{error}</p>}
      <button
        onClick={() => void handleSignOut()}
        style={{ cursor: "pointer" }}
      >
        Sign out
      </button>
    </div>
  );
}
