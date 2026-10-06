import { useEffect, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { SignOutButton } from "../components/SignOutButton.js";
import { MemberManagement } from "../components/MemberManagement.js";
import type { MembershipRole } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// Vocabulary mapping (Decision 8):
// Database enum values MUST NOT appear as visible UI labels on any
// role-displaying surface — including session.teamMemberships list below.
// 'participant'         → 'Engineer'
// 'engineering_manager' → 'Engineering Manager'
// ---------------------------------------------------------------------------
const ROLE_LABELS: Record<MembershipRole, string> = {
  participant: "Engineer",
  engineering_manager: "Engineering Manager",
};

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

      {/*
       * facilitator-session-entry-point (#237), design D1-D4: a facilitator
       * with memberships reaches session creation in one click from here.
       * Rendered only when the server-computed flag is true (D2), and absent
       * from the DOM otherwise. That absence is a UX property, not an access
       * control; the server authorizes /sessions/new's endpoints.
       *
       * D3: do not add team context to this link (no path segment, query
       * string or `state`). The picker alone decides which teams are offered,
       * from GET /api/v1/teams/eligible-for-session, which already excludes
       * this team.
       */}
      {session.canFacilitateSessions === true && (
        <section data-testid="team-facilitator-block">
          <h2>Facilitator</h2>
          <Link to="/sessions/new" data-testid="nav-facilitate-session">
            Facilitate another team's session
          </Link>
          <p style={{ marginTop: "0.25rem", color: "#616161" }}>
            You can't facilitate your own team.
          </p>
        </section>
      )}

      <h2>Members</h2>
      <ul>
        {session.teamMemberships.map((m) => (
          <li key={m.teamId}>
            {/* Decision 8: render mapped label, never raw DB enum value */}
            {m.teamName} ({ROLE_LABELS[m.role] ?? m.role})
          </li>
        ))}
      </ul>

      {/*
       * remove-topic, design.md Decision 10's nav-entry-point resolution:
       * a "Topics" link alongside the existing MemberManagement render — a
       * screen nobody can navigate to isn't a shipped feature, particularly
       * for a facilitator who inherits a team without a handoff
       * conversation and has no other way to discover it exists. Server-side
       * authorization (TOPIC-002's standing facilitator model) is what
       * actually gates the destination; this link is a discoverable entry
       * point, not an access-control decision.
       */}
      {teamId && (
        <div style={{ marginTop: "2rem" }}>
          <Link to={`/team/${teamId}/topics`} data-testid="nav-topic-management">
            Topics
          </Link>
        </div>
      )}

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
