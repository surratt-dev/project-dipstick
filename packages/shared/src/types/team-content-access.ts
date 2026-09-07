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

// ---------------------------------------------------------------------------
// Facilitator live session error state types (Group 10 — Task 10.1–10.5)
//
// These types define the structured HTTP response bodies for the four named
// facilitator error states. They are distinct from the general 403/404 error
// presentation: a facilitator in a live session cannot navigate away to
// investigate, so each error state carries the information needed to recover
// or understand the situation without leaving the session view.
// ---------------------------------------------------------------------------

/**
 * Error State 1 — Reveal failure.
 *
 * Returned when the facilitator triggers a reveal and the authorization or
 * session state check fails. Recoverable vs. non-recoverable is determined by
 * whether the session is still in an active state.
 *
 * Spec: team-content-access spec / Requirement: Live session error states.
 */
export type RevealFailureResponse =
  | {
      errorState: "reveal_failure";
      /** true = session is still active; the facilitator can retry the reveal */
      recoverable: true;
      /** Displayed in the facilitator view WITHOUT a generic error modal */
      message: "The reveal could not be completed. Your session is still active. Try again.";
      sessionId: string;
      teamId: string;
    }
  | {
      errorState: "reveal_failure";
      /** false = session is no longer in an active state; no retry is appropriate */
      recoverable: false;
      /** Displayed in the facilitator view; directs them to review session status */
      message: "This session is no longer in an active state. Please review the session status.";
      sessionId: string;
      teamId: string;
      /** The actual current session status — lets the frontend display what happened */
      currentSessionStatus: SessionStatus;
    };

/**
 * Error State 2 — Historical data unavailable during active session.
 *
 * Returned with HTTP 200 when a facilitator's trend or session-history endpoint
 * call fails DURING an active session. Communicates a transient data issue,
 * not an access denial. The frontend renders this as an empty state, NOT a
 * 403 error.
 *
 * Spec message (exact): "Historical data is temporarily unavailable. Your
 * session is still active."
 *
 * MUST NOT use: "You do not have access to this data." — that phrasing
 * suggests a session problem and may cause the facilitator to end the session.
 */
export interface FacilitatorHistoricalDataUnavailable {
  errorState: "historical_data_unavailable";
  message: "Historical data is temporarily unavailable. Your session is still active.";
  /** Empty sessions array — frontend renders as empty state, not error */
  sessions: [];
  sessionActive: true;
}

/**
 * Error State 2 variant for trend data endpoints.
 */
export interface FacilitatorTrendDataUnavailable {
  errorState: "historical_data_unavailable";
  message: "Historical data is temporarily unavailable. Your session is still active.";
  /** Empty trends array — frontend renders as empty state, not error */
  trends: [];
  sessionActive: true;
}

/**
 * Non-blocking banner state for Error State 3.
 *
 * displayType: 'banner' is the normative constraint that distinguishes this
 * from a modal. The facilitator MUST be able to see the participant grid and
 * topic state while the banner is displayed. A modal that blocks the screen
 * violates the spec requirement.
 */
export interface SessionStatusBannerState {
  type: "session_status_changed";
  /** 'banner' = non-modal; the session view behind it must remain visible */
  displayType: "banner";
  currentSessionState: SessionStatus;
  /** Spec format: "Session state has changed. [currentState]. Resume or review." */
  message: string;
  /** Required action text: must be "Resume or review" per spec */
  action: "Resume or review";
}

/**
 * Error State 3 — Facilitator session state response.
 *
 * Returned by GET /api/v1/teams/:teamId/sessions/:sessionId/facilitator-state.
 * Includes bannerState when the session has transitioned to an unexpected state
 * (wrap_up, complete, abandoned) while the facilitator is mid-flow. bannerState
 * is null when the session is in a normal active state (lobby, pre_session, active).
 */
export interface FacilitatorSessionStateResponse {
  sessionId: string;
  teamId: string;
  currentSessionState: SessionStatus;
  /**
   * Non-null when the session has transitioned unexpectedly.
   * The frontend must render this as a persistent non-blocking banner,
   * NOT a modal that hides the session view.
   */
  bannerState: SessionStatusBannerState | null;
}
