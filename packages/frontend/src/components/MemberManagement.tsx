import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext.js";
import type { TeamMember, TeamMembersResponse, MembershipRole } from "@dipstick/shared";

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
      const res = await fetch(`/api/v1/teams/${teamId}/members`, {
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

  const { teamName, members, canAssignRoles } = data;

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

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {members.map((member) => {
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

              {/* Task 5.1 / Decision 8: role label visible in list form
                  without requiring drill-downs or entering an edit state */}
              <div
                data-testid={`role-label-${member.userId}`}
                style={{ marginTop: "0.5rem" }}
              >
                Current role:{" "}
                <strong>{ROLE_LABELS[member.role] ?? member.role}</strong>
              </div>

              {/* -------------------------------------------------------
                  Zero-participant warning modal (Task 5.4, 5.5 / Decision 5)
                  Shown BEFORE confirmation — not after. The actor can cancel.
              ------------------------------------------------------- */}
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

              {/* -------------------------------------------------------
                  Role selector (Tasks 5.2, 5.3)
                  Exactly two options: Engineer and Engineering Manager.
                  Facilitator is NEVER present.
                  Inline descriptions below each option.
                  Only shown when canAssignRoles: true.
              ------------------------------------------------------- */}
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
                    {/* Task 5.2 / 5.3: exactly two options with inline descriptions */}
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
  );
}
