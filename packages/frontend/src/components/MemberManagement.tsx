import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext.js";
import type { TeamMember, TeamMembersResponse, MembershipRole } from "@dipstick/shared";

// MemberManagement fetches from TEAM-003 (GET /api/v1/teams/:teamId) which
// returns the split TeamMembersResponse with participants/engineeringManagers.
// The legacy GET /api/v1/teams/:teamId/members endpoint is no longer used here.

// ---------------------------------------------------------------------------
// Vocabulary mapping (Decision 8):
// Database enum values MUST NOT appear as visible UI labels.
// 'participant'         → 'Engineer'
// 'engineering_manager' → 'Engineering Manager'
// ---------------------------------------------------------------------------
const ROLE_LABELS: Record<MembershipRole, string> = {
  participant: "Engineer",
  engineering_manager: "Engineering Manager",
};

const ROLE_DESCRIPTIONS: Record<MembershipRole, string> = {
  participant: "participates in session voting",
  engineering_manager: "can view session history; will not vote",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Props {
  teamId: string;
}

type RoleChangeState =
  | { status: "idle" }
  | { status: "submitting"; memberId: string }
  | { status: "awaiting_confirmation"; memberId: string; pendingRole: MembershipRole }
  | { status: "confirmed"; memberId: string; memberName: string; newRole: MembershipRole }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// MemberManagement
//
// Renders the team member list with role management UI. Consumed by TeamPage.
//
// Key behaviours:
// - Renders 'Engineer' / 'Engineering Manager' labels — never raw DB values
// - Role selector with exactly two options and inline descriptions (Task 5.2, 5.3)
// - Two-step confirmation when server returns 422 { requiresConfirmation: true }
//   (Task 5.4, 5.5, Decision 5)
// - Escalation message when canAssignRoles: false (Task 5.7, Decision 3 Option A)
// - Plain-language confirmation after successful change (Task 5.6)
// - Refreshes AuthContext after role change (Task 5 stale-session note)
// ---------------------------------------------------------------------------
export function MemberManagement({ teamId }: Props) {
  const { refreshSession } = useAuth();
  const [data, setData] = useState<TeamMembersResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [roleChangeState, setRoleChangeState] = useState<RoleChangeState>({
    status: "idle",
  });

  const loadMembers = useCallback(async () => {
    setFetchError(null);
    try {
      // Fetch from TEAM-003 (GET /api/v1/teams/:teamId) — returns the split
      // participants/engineeringManagers shape (Decision 12, design.md).
      const res = await fetch(`/api/v1/teams/${teamId}`, {
        credentials: "include",
      });
      if (!res.ok) {
        setFetchError("Failed to load team members.");
        return;
      }
      const json = (await res.json()) as TeamMembersResponse;
      setData(json);
    } catch {
      setFetchError("Network error loading team members.");
    }
  }, [teamId]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  // -------------------------------------------------------------------------
  // submitRoleChange — handles the two-step confirmation flow (Decision 5)
  // -------------------------------------------------------------------------
  const submitRoleChange = useCallback(
    async (member: TeamMember, newRole: MembershipRole, confirmed = false) => {
      setRoleChangeState({ status: "submitting", memberId: member.userId });

      try {
        const res = await fetch(
          `/api/v1/teams/${teamId}/members/${member.userId}/role`,
          {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              role: newRole,
              ...(confirmed ? { confirmedZeroParticipant: true } : {}),
            }),
          },
        );

        if (res.status === 422) {
          const body = (await res.json()) as { requiresConfirmation?: boolean };
          // Task 5.4 / Decision 5: signal is the 422 status code, not a field
          // in a 200 response. Show the warning and require explicit confirmation.
          if (body.requiresConfirmation) {
            setRoleChangeState({
              status: "awaiting_confirmation",
              memberId: member.userId,
              pendingRole: newRole,
            });
            return;
          }
        }

        if (!res.ok) {
          const body = (await res.json()) as { error?: { message?: string } };
          setRoleChangeState({
            status: "error",
            message: body.error?.message ?? "Role change failed.",
          });
          return;
        }

        // Success — refresh member list and AuthContext
        await loadMembers();
        await refreshSession();

        setRoleChangeState({
          status: "confirmed",
          memberId: member.userId,
          memberName: member.displayName,
          newRole,
        });

        // Auto-clear confirmation message after 5 seconds
        setTimeout(() => {
          setRoleChangeState({ status: "idle" });
        }, 5000);
      } catch {
        setRoleChangeState({
          status: "error",
          message: "Network error during role change.",
        });
      }
    },
    [teamId, loadMembers, refreshSession],
  );

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------
  if (fetchError) {
    return <p role="alert">{fetchError}</p>;
  }

  if (!data) {
    return <p>Loading team members…</p>;
  }

  const { teamName, participants, engineeringManagers, canAssignRoles, canAssociateManagers } = data;

  return (
    <section aria-labelledby="member-management-heading">
      <h2 id="member-management-heading">Team Members</h2>

      {/* ---------------------------------------------------------------
          Success confirmation banner (Task 5.6)
          "plainLanguage confirmation after a successful role change"
      --------------------------------------------------------------- */}
      {roleChangeState.status === "confirmed" && (
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            backgroundColor: "#e8f5e9",
            border: "1px solid #a5d6a7",
            borderRadius: "4px",
          }}
        >
          {roleChangeState.memberName} is now{" "}
          {roleChangeState.newRole === "engineering_manager"
            ? "an Engineering Manager"
            : "an Engineer"}{" "}
          for this team.
        </div>
      )}

      {/* Error banner */}
      {roleChangeState.status === "error" && (
        <div
          role="alert"
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            backgroundColor: "#fce4e4",
            border: "1px solid #e57373",
            borderRadius: "4px",
          }}
        >
          {roleChangeState.message}
        </div>
      )}

      {/* ---------------------------------------------------------------
          Escalation message (Task 5.7 / Decision 3 Option A hard req.)
          Shown when canAssignRoles is false. A grayed-out control with
          no explanation is NOT acceptable per the spec.

          TRACKED RISK — escalation UX incomplete (architect finding #3):
          The current message satisfies the minimum spec (plain-language
          explanation is present and non-dismissible). It does NOT satisfy
          the preferred spec: surfacing the admin contact or an in-app
          request path. Rachel Okonkwo's (VP Engineering) sign-off on
          Option A was conditioned on the escalation path being built in,
          not deferred indefinitely. If facilitators hit a dead end with
          no admin contact surfaced, the adoption risk named in Decision 3
          will materialize. This is not a stretch goal — it is a required
          follow-on with a named stakeholder condition attached.
          Owner: Marcus Oyelaran. Must complete before declaring Option A
          fully implemented.
      --------------------------------------------------------------- */}
      {!canAssignRoles && (
        <p
          data-testid="escalation-message"
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            backgroundColor: "#fff8e1",
            border: "1px solid #ffe082",
            borderRadius: "4px",
          }}
        >
          Only an Application Admin or an Engineering Manager for this team can
          change roles. Contact your admin to update this before the session.
        </p>
      )}

      {/* -----------------------------------------------------------------------
          Participants section (Decision 12, Decision 7 — labeled sections)
          Shows team members with role = 'participant'. Section heading makes
          clear these are the session participants (people who will vote).
      ----------------------------------------------------------------------- */}
      <section aria-labelledby="participants-heading">
        <h3
          id="participants-heading"
          data-testid="participants-section-heading"
          style={{ marginBottom: "0.5rem" }}
        >
          Session Participants
          <span
            style={{ fontWeight: "normal", fontSize: "0.875rem", marginLeft: "0.5rem", color: "#555" }}
          >
            (these users will receive session invites and vote)
          </span>
        </h3>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {participants.map((member) => {
            const isSubmitting =
              roleChangeState.status === "submitting" &&
              roleChangeState.memberId === member.userId;

            const isAwaitingConfirm =
              roleChangeState.status === "awaiting_confirmation" &&
              roleChangeState.memberId === member.userId;

            const pendingRole =
              isAwaitingConfirm &&
              roleChangeState.status === "awaiting_confirmation"
                ? roleChangeState.pendingRole
                : null;

            return (
              <li
                key={member.userId}
                data-testid={`member-row-${member.userId}`}
                style={{
                  padding: "1rem",
                  marginBottom: "0.5rem",
                  border: "1px solid #e0e0e0",
                  borderRadius: "4px",
                }}
              >
                <div style={{ fontWeight: "bold" }}>{member.displayName}</div>
                <div style={{ color: "#666", fontSize: "0.875rem" }}>
                  {member.email}
                </div>

                <div
                  data-testid={`role-label-${member.userId}`}
                  style={{ marginTop: "0.5rem" }}
                >
                  Current role:{" "}
                  <strong>{ROLE_LABELS[member.role] ?? member.role}</strong>
                </div>

                {isAwaitingConfirm && pendingRole !== null && (
                  <div
                    role="alertdialog"
                    aria-labelledby={`warn-heading-${member.userId}`}
                    data-testid={`zero-participant-warning-${member.userId}`}
                    style={{
                      marginTop: "1rem",
                      padding: "1rem",
                      backgroundColor: "#fff3e0",
                      border: "1px solid #ffb74d",
                      borderRadius: "4px",
                    }}
                  >
                    <p id={`warn-heading-${member.userId}`}>
                      This change will leave {teamName} with no Engineers. A
                      session cannot start without at least one Engineer. You can
                      still make this change.
                    </p>
                    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                      <button
                        onClick={() =>
                          submitRoleChange(member, pendingRole, true)
                        }
                        data-testid={`confirm-zero-participant-${member.userId}`}
                      >
                        Confirm change
                      </button>
                      <button
                        onClick={() => setRoleChangeState({ status: "idle" })}
                        data-testid={`cancel-zero-participant-${member.userId}`}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {canAssignRoles && !isAwaitingConfirm && (
                  <div style={{ marginTop: "0.75rem" }}>
                    <label
                      htmlFor={`role-select-${member.userId}`}
                      style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem" }}
                    >
                      Change role:
                    </label>
                    <select
                      id={`role-select-${member.userId}`}
                      data-testid={`role-select-${member.userId}`}
                      value={member.role}
                      disabled={isSubmitting}
                      onChange={(e) => {
                        const newRole = e.target.value as MembershipRole;
                        if (newRole !== member.role) {
                          void submitRoleChange(member, newRole);
                        }
                      }}
                      aria-label={`Change role for ${member.displayName}`}
                    >
                      {(["participant", "engineering_manager"] as MembershipRole[]).map(
                        (role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]} — {ROLE_DESCRIPTIONS[role]}
                          </option>
                        ),
                      )}
                    </select>
                    {isSubmitting && (
                      <span style={{ marginLeft: "0.5rem", fontSize: "0.875rem" }}>
                        Saving…
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* -----------------------------------------------------------------------
          Associated Managers section (Decision 7, Decision 12)
          Shows team members with role = 'engineering_manager'.
          Section heading must make clear these users are NOT session participants.
          When no EM is associated, shows a visually distinct incomplete-setup
          indicator — not an error state (Decision 7 acceptance criterion).
          (Tasks 6.1, 6.2, 6.3, 6.4 — establish-manager-team-relationship)
      ----------------------------------------------------------------------- */}
      <section
        aria-labelledby="associated-managers-heading"
        data-testid="associated-managers-section"
        style={{ marginTop: "2rem" }}
      >
        <h3
          id="associated-managers-heading"
          data-testid="associated-managers-heading"
          style={{ marginBottom: "0.5rem" }}
        >
          Associated Engineering Manager
          <span
            style={{ fontWeight: "normal", fontSize: "0.875rem", marginLeft: "0.5rem", color: "#555" }}
          >
            (views history only — does not attend sessions)
          </span>
        </h3>

        {/* Access model statement (Decision 8, Tasks 7.1, 7.2)
            Findable but not prominent: no modal, no acknowledgment flow.
            Present in both the team view and the session lobby. */}
        <p
          data-testid="access-model-statement"
          style={{ fontSize: "0.875rem", color: "#555", marginBottom: "0.75rem" }}
        >
          Your Engineering Manager can see session history but cannot join or observe live sessions.
        </p>

        {engineeringManagers.length === 0 ? (
          /* Incomplete-setup indicator — not an error (Decision 7) */
          <div
            data-testid="no-em-association-indicator"
            style={{
              padding: "0.75rem 1rem",
              backgroundColor: "#f5f5f5",
              border: "1px dashed #bdbdbd",
              borderRadius: "4px",
              color: "#757575",
            }}
          >
            No Engineering Manager is associated with this team yet.
            {/* Escalation path (Decision 1, Tasks 4.1, 4.2):
                When canAssociateManagers is false (facilitator/engineer view),
                show the explanation and specific contact path.
                When canAssociateManagers is true (admin view), show the affordance
                to establish the association. */}
            {canAssociateManagers ? (
              <span style={{ marginLeft: "0.5rem" }}>
                {/* Admin sees the affordance — actual TEAM-006 call is wired separately */}
                Use the admin panel to associate an Engineering Manager.
              </span>
            ) : (
              <span
                data-testid="associate-manager-escalation"
                style={{ marginLeft: "0.5rem" }}
              >
                Associating an Engineering Manager requires Application Admin access.
                Contact your admin to complete this before the session.
              </span>
            )}
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {engineeringManagers.map((em) => (
              <li
                key={em.userId}
                data-testid={`em-row-${em.userId}`}
                style={{
                  padding: "1rem",
                  marginBottom: "0.5rem",
                  border: "1px solid #c8e6c9",
                  borderRadius: "4px",
                  backgroundColor: "#f9fbe7",
                }}
              >
                {/* Display by display name (not userId) — Decision 7 / task 6.4 */}
                <div style={{ fontWeight: "bold" }} data-testid={`em-display-name-${em.userId}`}>
                  {em.displayName}
                </div>
                <div style={{ color: "#666", fontSize: "0.875rem" }}>
                  {em.email}
                </div>
                <div style={{ marginTop: "0.25rem", fontSize: "0.875rem", color: "#388e3c" }}>
                  Engineering Manager — views session history only
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
