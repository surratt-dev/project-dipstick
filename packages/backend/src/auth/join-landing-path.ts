import { db } from "../db.js";
import type { SessionStatus } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// resolveJoinLandingPath — session-lobby-routing-gap, design.md Decision D6.
//
// The join-link redirect destination, decided once and shared by both
// call sites that redeem a join link and then need to know where to send
// the user: join-links.ts's GET /api/join/:token (direct/already-
// authenticated path) and auth.ts's executeJoinFlow (through-OIDC path,
// reached from GET /auth/callback). Both previously carried their own
// independently-maintained `status = 'active'` query; this is the third
// time that pattern would have needed hand-synchronizing, so the bucket
// logic is extracted here instead.
//
// Bucket assignment is a full seven-SessionStatus enumeration (delta spec,
// join-link capability) — deliberately exhaustive, not an allowlist with an
// implicit else:
//   lobby, pre_session, active               -> /session/:sessionId
//   draft, wrap_up, complete, abandoned      -> /team/:teamId
//   no session exists for the team           -> /team/:teamId
//
// Callers append their own outcome-signal query params (?alreadyMember=true,
// ?newMember=true) to the returned path; this helper only resolves the base
// destination.
// ---------------------------------------------------------------------------

const SESSION_LANDING_STATUSES: ReadonlySet<SessionStatus> = new Set([
  "lobby",
  "pre_session",
  "active",
]);

export async function resolveJoinLandingPath(teamId: string): Promise<string> {
  const result = await db.query(
    `SELECT id, status FROM sessions WHERE team_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [teamId],
  );

  if (result.rows.length === 0) {
    return `/team/${teamId}`;
  }

  const session = result.rows[0] as { id: string; status: SessionStatus };
  if (SESSION_LANDING_STATUSES.has(session.status)) {
    return `/session/${session.id}`;
  }

  return `/team/${teamId}`;
}
