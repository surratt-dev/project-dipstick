import type { MembershipRole } from "./user.js";

export interface Team {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  createdByUserId: string;
  deactivatedAt: Date | null;
}

export interface TeamMembership {
  id: string;
  teamId: string;
  userId: string;
  role: MembershipRole;
  joinedAt: Date;
  removedAt: Date | null;
  removedByUserId: string | null;
}

/**
 * A member of a team as returned by GET /api/v1/teams/:teamId/members.
 * Uses UI-facing field names; the `role` maps to `team_memberships.role` in the
 * database and carries the MembershipRole enum value ('participant' |
 * 'engineering_manager'). The view layer maps these to display labels.
 */
export interface TeamMember {
  userId: string;
  displayName: string;
  email: string;
  role: MembershipRole;
}

/**
 * Response shape for GET /api/v1/teams/:teamId/members (legacy endpoint).
 * Retained for backwards compatibility. New code should use TEAM-003
 * (GET /api/v1/teams/:teamId) which returns the split participants/engineeringManagers shape.
 * @deprecated Use TeamMembersResponse from TEAM-003 instead.
 */
export interface LegacyTeamMembersResponse {
  teamId: string;
  teamName: string;
  members: TeamMember[];
  canAssignRoles: boolean;
}

/**
 * Response shape for GET /api/v1/teams/:teamId (TEAM-003).
 *
 * Splits members into two typed arrays so the frontend never needs to filter by
 * role — the backend knows the role at query time and the type system enforces
 * the separation. A new role category added to team_memberships in the future
 * would produce a compile error in the frontend if the client tries to segment
 * by role itself.
 *
 * Decision 12 (design.md — establish-manager-team-relationship):
 * The flat `members` array was replaced with `participants` and `engineeringManagers`
 * so that an EM row created by TEAM-006 never appears in the wrong array in production.
 *
 * Decision 10 (design.md):
 * `canAssociateManagers` is true when the actor's global_role = 'application_admin'.
 * It is evaluated server-side per request. TEAM-006 is admin-only. Using
 * canAssignRoles for this affordance would cause EMs to see the control and
 * receive 403s — that is worse UX than not showing the control.
 */
export interface TeamMembersResponse {
  teamId: string;
  teamName: string;
  /** Team members with role = 'participant' */
  participants: TeamMember[];
  /** Team members with role = 'engineering_manager' */
  engineeringManagers: TeamMember[];
  /** True when the actor can call TEAM-005 (assign roles). Includes Application Admins and EMs on this team. */
  canAssignRoles: boolean;
  /** True when the actor can call TEAM-006 (associate managers). Application Admins only. */
  canAssociateManagers: boolean;
}

/**
 * Request body for PATCH /api/v1/teams/:teamId/members/:userId/role (TEAM-005).
 */
export interface RoleChangeRequest {
  role: MembershipRole;
  /** Present and true on the second submission after a 422 zero-participant warning. */
  confirmedZeroParticipant?: boolean;
}

/**
 * Response body for a successful TEAM-005 role change.
 */
export interface RoleChangeResponse {
  member: TeamMember;
}

/**
 * Request body for POST /api/v1/teams/:teamId/managers (TEAM-006).
 * Establishes the EM/team relationship for a user who has global_role = 'engineering_manager'.
 */
export interface EstablishManagerRequest {
  engineeringManagerUserId: string;
}

/**
 * Response body for TEAM-006 (both 201 Created and 200 OK idempotent cases).
 * The response body is identical regardless of whether a row was created or updated —
 * callers must not rely on the body to distinguish create-new from update-existing.
 */
export interface EstablishManagerResponse {
  teamId: string;
  engineeringManagerUserId: string;
  engineeringManagerDisplayName: string;
  teamMembershipId: string;
}
