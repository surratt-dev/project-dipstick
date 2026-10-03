// ---------------------------------------------------------------------------
// buildErrorEnvelope — the house error envelope for route handlers
//
// Moved out of topics.ts by session-topics-snapshot-at-creation (#175)
// design.md Decision 3 so facilitator-sessions.ts can use the same shape
// and categories. Not a Fastify route plugin: this file is a shared helper
// for the plugins in this directory.
//
// topic-customization-lock design.md Decision 4 (corrected per engineer
// review M1): the codebase's standard error envelope -- { error: { category,
// code, message, correlationId } } -- the same shape teams.ts's
// GLOBAL_ROLE_PRECONDITION_NOT_MET (409) and TEAM006_BURST_LIMIT_EXCEEDED
// (429) already use. Never a bare top-level { code, message } body.
//
// Coded 409s use "precondition_failed"; server-side faults that a handler
// reports itself (rather than via the global error handler) use
// "internal_error". There is deliberately no "conflict" or "server_error"
// category. No shared-package type: the frontend reads error.code ad hoc.
// ---------------------------------------------------------------------------

export type ErrorCategory =
  | "forbidden"
  | "not_found"
  | "precondition_failed"
  | "invalid_request"
  | "internal_error"
  // harden-topic-write-endpoints (#184) Decision 1/6: the topic-write
  // limiter's 429 and fail-closed 503. TEAM-006 used these two strings as
  // inline literals before they were part of the union (task 2.5).
  | "rate_limited"
  | "service_unavailable";

export interface ErrorEnvelope {
  error: { category: ErrorCategory; code?: string; field?: string; message: string; correlationId: string };
}

export function buildErrorEnvelope(
  category: ErrorCategory,
  message: string,
  code?: string,
  field?: string,
): ErrorEnvelope {
  return {
    error: {
      category,
      ...(code ? { code } : {}),
      ...(field ? { field } : {}),
      message,
      correlationId: crypto.randomUUID(),
    },
  };
}

// ---------------------------------------------------------------------------
// teamNotFoundEnvelope — the ONE "team does not exist" body in the backend
//
// harden-topic-write-endpoints (#184 m5) design.md Decision 11: every 404
// that means "this team does not exist" (topic routes, content routes, draft
// session creation, the teams.ts GET/managers routes) sends this envelope,
// so a missing team, a malformed team id and the template team all look the
// same by construction. Moved here from topics.ts. A structural test
// (team-not-found-envelope-structural.test.ts) fails if the message literal
// appears anywhere else in backend source.
// ---------------------------------------------------------------------------
export function teamNotFoundEnvelope(): ErrorEnvelope {
  return buildErrorEnvelope("not_found", "Team not found.", "TEAM_NOT_FOUND");
}
