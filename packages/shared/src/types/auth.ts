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
