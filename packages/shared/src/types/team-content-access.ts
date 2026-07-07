import type { SessionStatus } from "./session.js";

// ---------------------------------------------------------------------------
// TeamAccessGrant — the typed discriminated union returned by evaluateTeamAccess
//
// Design Decision 8 (enforce-access-control-on-team-content):
//   The authorization helper returns a grant object (not a boolean) so that the
//   serializer knows which role-specific response shape to produce.
//   Every variant carries actorGlobalRole to avoid a second DB query in handlers
//   that must write to the audit_log.
//
// Design Decision 2 (Application Admin boundary — Option B):
//   The helper returns { path: 'admin' } for all Application Admin callers
//   regardless of which endpoint is calling. The endpoint handler decides
//   whether to proceed (admin data endpoints) or return 403 (content endpoints).
// ---------------------------------------------------------------------------
export type TeamAccessGrant =
  | {
      path: "member";
      role: "participant";
      teamId: string;
      actorGlobalRole: string;
    }
  | {
      path: "member";
      role: "engineering_manager";
      teamId: string;
      actorGlobalRole: string;
    }
  | {
      path: "facilitator";
      sessionId: string;
      teamId: string;
      sessionStatus: SessionStatus;
      actorGlobalRole: string;
    }
  | {
      path: "admin";
      actorGlobalRole: "application_admin";
    };
