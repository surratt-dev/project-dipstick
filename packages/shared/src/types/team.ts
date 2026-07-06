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
 * Response shape for GET /api/v1/teams/:teamId/members.
 * `canAssignRoles` is evaluated server-side per request — not derived from
 * session state — and tells the frontend whether to show the role selector or
 * the escalation message (Decision 9).
 */
export interface TeamMembersResponse {
  teamId: string;
  teamName: string;
  members: TeamMember[];
  canAssignRoles: boolean;
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
