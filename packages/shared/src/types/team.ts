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
