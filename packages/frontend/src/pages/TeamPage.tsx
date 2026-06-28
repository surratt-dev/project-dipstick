import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { SignOutButton } from "../components/SignOutButton.js";

export function TeamPage() {
  const { session } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showNotification, setShowNotification] = useState(false);

  useEffect(() => {
    if (searchParams.get("alreadyMember") === "true") {
      setShowNotification(true);
      // Remove the query param
      searchParams.delete("alreadyMember");
      setSearchParams(searchParams, { replace: true });
      // Auto-dismiss after 4 seconds
      const timer = setTimeout(() => setShowNotification(false), 4000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [searchParams, setSearchParams]);

  if (!session) return null;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      {showNotification && (
        <div
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            backgroundColor: "#e8f4fd",
            border: "1px solid #b3d9f2",
            borderRadius: "4px",
          }}
        >
          You are already a member of this team.
        </div>
      )}

      <h1>Team</h1>
      <h2>Members</h2>
      <ul>
        {session.teamMemberships.map((m) => (
          <li key={m.teamId}>
            {m.teamName} ({m.role})
          </li>
        ))}
      </ul>

      <div style={{ marginTop: "2rem" }}>
        <SignOutButton />
      </div>
    </div>
  );
}
