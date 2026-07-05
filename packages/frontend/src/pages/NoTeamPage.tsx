import { useAuth } from "../auth/AuthContext.js";
import { SignOutButton } from "../components/SignOutButton.js";

export function NoTeamPage() {
  const { session } = useAuth();

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
