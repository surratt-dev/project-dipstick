import type { MembershipRole } from "./user.js";

export interface AuthSession {
  user: {
    id: string;
    displayName: string;
    email: string;
  };
  teamMemberships: Array<{
    teamId: string;
    teamName: string;
    role: MembershipRole;
  }>;
  sessionCreatedAt: string;
  expiresAt: string;
  /**
   * Server-computed capability flag, evaluated fresh from users.global_role
   * on every /auth/session call (never cached in the Redis session blob).
   *
   * session-creation-existing-team design.md Decision D4: this follows the
   * role-assignment capability's canAssignRoles precedent -- the client
   * reacts to a server-computed authorization result, it does not derive
   * one from a raw role value. `globalRole` itself MUST NOT be added to
   * AuthSession.user; this flag is additive to AuthSession, not nested
   * under `user`, to keep that same identity-data/authorization-signal
   * distinction.
   */
  canFacilitateSessions: boolean;
}

// Persona login (local-dev-only sign-in shortcut). Shared so the frontend's
// unseeded-caveat rendering keys off the same `seeded` field the backend
// computes, rather than a frontend-maintained list of account ids (design.md D5).
export interface DevLoginOption {
  accountId: string;
  roleLabel: string;
  seeded: boolean;
}

export interface DevLoginOptionsResponse {
  options: DevLoginOption[];
}

export interface JoinLink {
  id: string;
  teamId: string;
  token: string;
  expiresAt: string;
  createdAt: string;
}

export type AuthErrorCategory =
  | "provider_unavailable"
  | "authentication_failed"
  | "session_expired"
  | "invalid_request";

export interface AuthError {
  error: {
    category: AuthErrorCategory;
    message: string;
    correlationId: string;
  };
}
