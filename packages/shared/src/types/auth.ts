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

/**
 * The backend's registered join-redemption route path for a given token.
 * join-link-redemption-wiring: this is the ONE place the "/api/join/:token"
 * path is written -- both `DraftSessionHost.tsx` (which renders it into the
 * link a facilitator copies) and this change's end-to-end verification test
 * (which follows that exact path against a running backend) import this
 * function rather than each independently hard-coding the path string. Two
 * independently-typed copies of this path is exactly how the original bug
 * (a frontend link built against an unregistered "/join/:token" path)
 * shipped undetected.
 */
export function buildJoinLinkPath(token: string): string {
  return `/api/join/${token}`;
}

export type AuthErrorCategory =
  | "provider_unavailable"
  | "authentication_failed"
  | "session_expired"
  | "invalid_request"
  // internal_error: auth-events-audit-log-coverage, design.md Decision D7.
  // Distinguishes a failure in this application's own database
  // infrastructure (an AuditWriteError -- a failed audit_log INSERT inside
  // the transactional group's transaction, or a failed db.connect() before
  // it) from an actual sign-in/IdP problem. Treated as retryable, the same
  // as provider_unavailable.
  | "internal_error";

export interface AuthError {
  error: {
    category: AuthErrorCategory;
    message: string;
    correlationId: string;
  };
}
