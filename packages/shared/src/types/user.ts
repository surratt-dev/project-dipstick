export type UserRole =
  | "engineer"
  | "senior_engineer"
  | "facilitator"
  | "engineering_manager"
  | "application_admin";

export type MembershipRole = "participant" | "engineering_manager";

export interface User {
  id: string;
  oidcSubject: string;
  oidcIssuer: string;
  displayName: string;
  email: string;
  globalRole: UserRole;
  createdAt: Date;
  updatedAt: Date;
  deactivatedAt: Date | null;
}
