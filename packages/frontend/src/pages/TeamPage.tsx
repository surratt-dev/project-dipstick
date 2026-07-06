import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { SignOutButton } from "../components/SignOutButton.js";
import { MemberManagement } from "../components/MemberManagement.js";

export function TeamPage() {
  const { session } = useAuth();
  const { teamId } = useParams<{ teamId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showAlreadyMemberNotification, setShowAlreadyMemberNotification] =
    useState(false);
  const [showNewMemberNotification, setShowNewMemberNotification] =
    useState(false);

  useEffect(() => {
    if (searchParams.get("alreadyMember") === "true") {
      setShowAlreadyMemberNotification(true);
      searchParams.delete("alreadyMember");
      setSearchParams(searchParams, { replace: true });
      const timer = setTimeout(
        () => setShowAlreadyMemberNotification(false),
        4000,
      );
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (searchParams.get("newMember") === "true") {
      setShowNewMemberNotification(true);
      // Remove ?newMember=true from the URL without adding a browser history
      // entry, consistent with ?alreadyMember=true handling.
      searchParams.delete("newMember");
      setSearchParams(searchParams, { replace: true });
      const timer = setTimeout(
        () => setShowNewMemberNotification(false),
        4000,
      );
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [searchParams, setSearchParams]);

  if (!session) return null;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      {showAlreadyMemberNotification && (
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
      {showNewMemberNotification && (
        <div
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            backgroundColor: "#e8f5e9",
            border: "1px solid #a5d6a7",
            borderRadius: "4px",
          }}
        >
          You've joined the team. Your facilitator will share what comes next.
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

      {/* Member management view — shown for the team identified by the URL param */}
      {teamId && (
        <div style={{ marginTop: "2rem" }}>
          <MemberManagement teamId={teamId} />
        </div>
      )}

      <div style={{ marginTop: "2rem" }}>
        <SignOutButton />
      </div>
    </div>
  );
}
