import type { SessionStatus } from "./session.js";

// ---------------------------------------------------------------------------
// session-creation-existing-team response shapes (design.md D2/D3).
// ---------------------------------------------------------------------------

/**
 * One team a facilitator may create a session for, as returned by
 * GET /api/v1/teams/eligible-for-session.
 *
 * lastSessionAt is MAX(completed_at) over that team's `status = 'complete'`
 * sessions only (design.md D2) -- never a live or draft session's timestamp.
 */
export interface EligibleTeam {
  teamId: string;
  teamName: string;
  /** Null when the team has no completed session yet. */
  lastSessionAt: string | null;
}

/**
 * Response body for GET /api/v1/teams/eligible-for-session (200 only --
 * non-facilitators receive a 403 with the standard error body instead).
 *
 * callerHasTeamMemberships distinguishes the two reasons `eligibleTeams` can
 * still be an empty array: a facilitator with no home team at all (false) vs.
 * a facilitator who already belongs to every team in the organization (true)
 * (design.md D2).
 */
export interface EligibleTeamsResponse {
  eligibleTeams: EligibleTeam[];
  callerHasTeamMemberships: boolean;
}

/**
 * 409 response body for POST /api/v1/teams/:teamId/sessions/draft when the
 * target team already has a non-terminal session (design.md D3). Lets the
 * facilitator navigate directly to the session that already exists rather
 * than being left at a dead end.
 */
export interface SessionAlreadyExistsResponse {
  errorState: "session_already_exists";
  existingSessionId: string;
  existingSessionStatus: SessionStatus;
  teamId: string;
}

// ---------------------------------------------------------------------------
// inline-team-creation response shapes (design.md D2/D4).
// ---------------------------------------------------------------------------

/**
 * 409 response body for POST /api/v1/teams when the submitted team name
 * collides with an existing team's name, normalized (lowercased, trimmed).
 * Returned regardless of whether the exact-match constraint or the
 * normalized-match constraint is the one that reports the violation
 * (design.md D4) -- the caller-visible outcome does not depend on that.
 */
export interface TeamNameCollisionResponse {
  errorState: "team_name_collision";
  providedName: string;
}
